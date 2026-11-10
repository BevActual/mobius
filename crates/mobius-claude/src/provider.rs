//! The model provider: one Mobius model call is one run of the Claude Code CLI, behind the admission relay.
use std::collections::{BTreeMap, VecDeque};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc::{Receiver, RecvTimeoutError, channel};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use mobius_agent::provider::{ChatRequest, Completion, Provider, ProviderError};
use serde_json::{Value, json};

use crate::cli::{self, INSTALL_HINT, SIGN_IN_HINT};
use crate::frames::{self, NativeTurns};
use crate::relay::Relay;

pub const UPSTREAM: &str = "https://api.anthropic.com";
const DEFAULT_TIMEOUT: Duration = Duration::from_secs(180);

pub struct ClaudeCodeProvider {
    program: PathBuf,
    inert_mcp: PathBuf,
    upstream: String,
    workdir: PathBuf,
    timeout: Duration,
    natives: Arc<NativeTurns>,
}

impl std::fmt::Debug for ClaudeCodeProvider {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ClaudeCodeProvider").field("program", &self.program).finish()
    }
}

/// Kill the CLI and anything it started (the inert MCP server, a Node child behind a shim).
fn kill_tree(child: &mut Child) {
    #[cfg(windows)]
    {
        let mut taskkill = Command::new("taskkill");
        let _ = cli::quiet(taskkill.args(["/F", "/T", "/PID", &child.id().to_string()]).stdout(Stdio::null()).stderr(Stdio::null())).status();
    }
    let _ = child.kill();
    let _ = child.wait();
}

struct TempDir(PathBuf);

impl TempDir {
    /// A folder of its own for each request. Two requests in the same instant once shared one, and the first to finish
    /// removed the other's files (its system prompt read as empty): each name now has a count, and the folder must be new.
    fn new() -> std::io::Result<TempDir> {
        static COUNT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        loop {
            let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_nanos());
            let n = COUNT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            let dir = std::env::temp_dir().join(format!("mobius-claude-{}-{nanos}-{n}", std::process::id()));
            match std::fs::create_dir(&dir) {
                Ok(()) => return Ok(TempDir(dir)),
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
                Err(e) => return Err(e),
            }
        }
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn protocol(message: impl Into<String>) -> ProviderError {
    ProviderError::Protocol(message.into())
}

/// The status Mobius's fallback rules read, for an error the CLI answers itself.
fn native_status(code: &str) -> u16 {
    match code {
        "rate_limit" => 429,
        "billing_error" => 402,
        "authentication_failed" => 401,
        "overloaded" => 529,
        _ => 503,
    }
}

impl ClaudeCodeProvider {
    /// `program` is an explicit CLI path, else it is looked for; `inert_mcp` is the `mobius-inert-mcp` program;
    /// `workdir` is a private folder the CLI runs in (it must not be a project folder).
    pub fn new(program: Option<&Path>, inert_mcp: PathBuf, workdir: PathBuf) -> Result<ClaudeCodeProvider, String> {
        let program = cli::find(program).ok_or(INSTALL_HINT)?;
        if !inert_mcp.is_file() {
            return Err(format!("{} is missing next to Mobius", inert_mcp.display()));
        }
        std::fs::create_dir_all(&workdir).map_err(|e| e.to_string())?;
        Ok(ClaudeCodeProvider { program, inert_mcp, upstream: UPSTREAM.into(), workdir, timeout: DEFAULT_TIMEOUT, natives: Arc::default() })
    }

    /// For tests: a local fake Anthropic server instead of the real one.
    pub fn with_upstream(mut self, upstream: &str) -> Result<Self, String> {
        crate::relay::check_upstream(upstream)?;
        self.upstream = upstream.trim_end_matches('/').to_owned();
        Ok(self)
    }

    pub fn with_timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self
    }
}

struct Run {
    child: Child,
    events: Receiver<Option<Result<Value, String>>>,
    stderr: Arc<Mutex<VecDeque<String>>>,
    timeout: Duration,
}

impl Run {
    fn next(&self) -> Result<Option<Value>, ProviderError> {
        match self.events.recv_timeout(self.timeout) {
            Ok(Some(Ok(v))) => Ok(Some(v)),
            Ok(Some(Err(line))) => Err(protocol(format!("Claude Code wrote something that is not stream-json: {}{}", line.chars().take(200).collect::<String>(), self.tail()))),
            Ok(None) | Err(RecvTimeoutError::Disconnected) => Ok(None),
            Err(RecvTimeoutError::Timeout) => Err(ProviderError::Network("Claude Code did not answer in time".into())),
        }
    }

    fn tail(&self) -> String {
        let lines = self.stderr.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        if lines.is_empty() { String::new() } else { format!(" (Claude Code said: {})", lines.iter().cloned().collect::<Vec<_>>().join(" ").chars().take(400).collect::<String>()) }
    }
}

impl Drop for Run {
    fn drop(&mut self) {
        if matches!(self.child.try_wait(), Ok(None)) {
            kill_tree(&mut self.child);
        }
    }
}

impl Provider for ClaudeCodeProvider {
    fn complete(&self, request: &ChatRequest, on_text: &mut dyn FnMut(&str) -> bool) -> Result<Completion, ProviderError> {
        let prepared = frames::prepare(request, &self.natives).map_err(protocol)?;
        let tmp = TempDir::new().map_err(|e| protocol(e.to_string()))?;
        let file = |name: &str, body: &str| -> Result<PathBuf, ProviderError> {
            let p = tmp.0.join(name);
            std::fs::write(&p, body).map_err(|e| protocol(e.to_string()))?;
            Ok(p)
        };
        let tools = file("tools.json", &Value::Array(prepared.manifest.clone()).to_string())?;
        let system = file("system.md", &prepared.system)?;
        // The body travels as a setting, not an argument or variable, so a large tool list never hits OS limits.
        let settings = file("settings.json", &json!({ "env": { "CLAUDE_CODE_EXTRA_BODY": prepared.body.to_string() } }).to_string())?;
        let mcp = file("mcp.json", &json!({ "mcpServers": { "mobius": { "command": self.inert_mcp, "args": [tools] } } }).to_string())?;
        let relay = Relay::start(&self.upstream, self.timeout).map_err(protocol)?;
        let env = cli::child_env(&BTreeMap::from([("ANTHROPIC_BASE_URL".to_owned(), relay.url.clone())]));
        let mut args: Vec<String> = [
            "-p", "--model", &prepared.model, "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--include-partial-messages",
            "--tools", "", "--setting-sources", "", "--strict-mcp-config", "--disable-slash-commands", "--max-turns", "1", "--permission-mode", "dontAsk",
            "--no-session-persistence",
        ]
        .iter()
        .map(|s| (*s).to_owned())
        .collect();
        for (flag, path) in [("--system-prompt-file", &system), ("--settings", &settings), ("--mcp-config", &mcp)] {
            args.push(flag.into());
            args.push(path.display().to_string());
        }
        if let Some(e) = &prepared.effort {
            args.extend(["--effort".to_owned(), e.clone()]);
        }
        args.extend(["--session-id".to_owned(), frames::session_id(&prepared.system, &prepared.frames)]);

        let mut command = Command::new(&self.program);
        command.args(&args).current_dir(&self.workdir).env_clear().envs(&env).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
        #[cfg(windows)]
        std::os::windows::process::CommandExt::creation_flags(&mut command, 0x0800_0000 | 0x0000_0200); // no window, own group
        let mut child = command.spawn().map_err(|e| protocol(format!("could not start Claude Code: {e}")))?;
        let (Some(mut stdin), Some(stdout), Some(stderr)) = (child.stdin.take(), child.stdout.take(), child.stderr.take()) else {
            kill_tree(&mut child);
            return Err(protocol("could not talk to Claude Code"));
        };
        let err_lines: Arc<Mutex<VecDeque<String>>> = Arc::default();
        let sink = err_lines.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                let mut l = sink.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
                l.push_back(line);
                while l.len() > 40 {
                    l.pop_front();
                }
            }
        });
        let (tx, rx) = channel();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let Ok(line) = line else { break };
                if line.trim().is_empty() {
                    continue;
                }
                let _ = tx.send(Some(serde_json::from_str::<Value>(&line).map_err(|_| line)));
            }
            let _ = tx.send(None);
        });
        let run = Run { child, events: rx, stderr: err_lines, timeout: self.timeout };

        // History first: every earlier user turn is replayed without asking the model, and acknowledged with no turn.
        let last = prepared.frames.len() - 1;
        for (i, frame) in prepared.frames.iter().enumerate() {
            let mut frame = frame.clone();
            let replay = frame["type"] == "user" && i < last;
            if replay {
                frame["shouldQuery"] = json!(false);
            }
            writeln!(stdin, "{frame}").and_then(|()| stdin.flush()).map_err(|_| protocol(format!("Claude Code stopped reading{}", run.tail())))?;
            if replay {
                loop {
                    let Some(ack) = run.next()? else { return Err(protocol(format!("Claude Code stopped while reading the conversation{}", run.tail()))) };
                    if ack["type"] == "result" {
                        if ack["num_turns"] != 0 || ack["is_error"] == true {
                            return Err(protocol("Claude Code did not accept the conversation history"));
                        }
                        break;
                    }
                }
            }
        }
        drop(stdin);

        let started = Instant::now();
        let mut emitted = String::new();
        let mut native_error: Option<(String, String)> = None;
        while let Some(event) = run.next()? {
            match event["type"].as_str() {
                Some("stream_event") => {
                    let delta = &event["event"]["delta"];
                    if delta["type"] == "text_delta"
                        && let Some(t) = delta["text"].as_str()
                    {
                        emitted.push_str(t);
                        if !on_text(t) {
                            return Err(ProviderError::Cancelled);
                        }
                    }
                }
                Some("assistant") if event.get("error").is_some() || event["message"].get("error").is_some() => {
                    let code = event["error"].as_str().or_else(|| event["message"]["error"].as_str()).unwrap_or("").to_owned();
                    let text: String = event["message"]["content"].as_array().into_iter().flatten().filter_map(|b| b["text"].as_str()).collect();
                    native_error = Some((code, text));
                }
                _ => {}
            }
            if started.elapsed() > self.timeout * 4 {
                return Err(ProviderError::Network("Claude Code took too long".into()));
            }
        }
        let outcome = relay.outcome();
        let message = if outcome.used {
            match (outcome.status, outcome.capture.message()) {
                (Some(200), Some(m)) => m,
                (Some(status), _) if status != 200 => return Err(ProviderError::Http { status, message: outcome.error_text().chars().take(500).collect() }),
                _ => return Err(ProviderError::Network(format!("the answer from Anthropic was cut short{}", outcome.failure.as_ref().map(|f| format!(" ({f})")).unwrap_or_default()))),
            }
        } else {
            return Err(match native_error {
                Some((code, _)) if code == "authentication_failed" => ProviderError::Http { status: 401, message: SIGN_IN_HINT.into() },
                Some((code, text)) => ProviderError::Http { status: native_status(&code), message: if text.is_empty() { code } else { text } },
                None => protocol(format!("Claude Code finished without asking the model{}", run.tail())),
            });
        };
        drop(outcome);
        let completion = frames::completion(&message, &prepared.names);
        // The relay's copy is the truth; say whatever the stream did not.
        if let Some(rest) = completion.text.strip_prefix(emitted.as_str())
            && !rest.is_empty()
            && !on_text(rest)
        {
            return Err(ProviderError::Cancelled);
        }
        self.natives.remember(&completion.text, &completion.tool_calls, vec![message]);
        Ok(completion)
    }
}
