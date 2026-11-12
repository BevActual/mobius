//! A GitHub Copilot plan, through GitHub's own Copilot CLI and its documented ACP server
//! (https://docs.github.com/en/copilot/reference/acp-server). GitHub offers no plain API for other apps, so this works
//! like the Claude Code route: one Mobius model call is one short ACP session with `copilot --acp`.
//!
//! - The CLI runs with the person's GitHub sign-in (`COPILOT_GITHUB_TOKEN`), in a private empty folder.
//! - The conversation so far goes in as one prompt. Mobius's tools are offered through the inert MCP server, which lists
//!   them but never runs one.
//! - When the model asks for one of Mobius's tools, Mobius takes the call, refuses it inside the CLI, ends the session
//!   and runs the tool itself, under its own approvals. The CLI's own tools (shell, files) are always refused.
use std::collections::{BTreeMap, HashMap, VecDeque};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{Receiver, RecvTimeoutError, channel};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use mobius_agent::message::{Message, ToolCall};
use mobius_agent::provider::{ChatRequest, Completion, Provider, ProviderError, StopReason};
use serde_json::{Value, json};

use crate::cli;

pub const INSTALL_HINT: &str = "GitHub Copilot CLI is not installed. Install it with: winget install GitHub.Copilot (or npm install -g @github/copilot)";
pub const SIGN_IN_HINT: &str = "Sign in with GitHub in Settings, Gateways first.";
/// The variable the CLI reads the person's GitHub sign-in from.
pub const TOKEN_VARIABLE: &str = "COPILOT_GITHUB_TOKEN";
/// Models offered before the CLI has said which it has. `auto` lets Copilot choose.
pub const MODELS: &[(&str, &str)] = &[("auto", "Auto"), ("claude-sonnet-4.5", "Claude Sonnet 4.5"), ("gpt-5", "GPT-5"), ("gpt-5-mini", "GPT-5 mini"), ("gemini-2.5-pro", "Gemini 2.5 Pro")];
const DEFAULT_TIMEOUT: Duration = Duration::from_secs(180);
/// Variables that would point the CLI at another account or provider.
const REMOVED: &[&str] = &["COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN", "COPILOT_API_URL", "GITHUB_COPILOT_API_TOKEN"];

pub struct CopilotProvider {
    program: PathBuf,
    inert_mcp: PathBuf,
    workdir: PathBuf,
    token: String,
    timeout: Duration,
}

impl std::fmt::Debug for CopilotProvider {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CopilotProvider").field("program", &self.program).finish()
    }
}

/// The Copilot CLI: an explicit path if given, else `copilot` where it is usually installed.
pub fn find(explicit: Option<&Path>) -> Option<PathBuf> {
    match explicit {
        Some(p) => p.is_file().then(|| p.to_path_buf()),
        None => cli::find_named("copilot"),
    }
}

/// The name a Mobius tool has inside the CLI (`files.read` is `files-read`).
pub fn wire_name(mobius: &str) -> String {
    mobius.chars().map(|c| if c.is_ascii_alphanumeric() || c == '_' || c == '-' { c } else { '-' }).collect()
}

fn protocol(message: impl Into<String>) -> ProviderError {
    ProviderError::Protocol(message.into())
}

/// The conversation as one prompt: the CLI starts a new session for each model call.
pub fn prompt(request: &ChatRequest) -> String {
    let mut out = String::new();
    if !request.system.trim().is_empty() {
        out.push_str("<instructions>\n");
        out.push_str(request.system.trim());
        out.push_str("\n</instructions>\n\n");
    }
    out.push_str("Use only the tools from the mobius server; the others are switched off. The conversation so far:\n\n");
    for m in &request.messages {
        match m {
            Message::User { text, .. } => out.push_str(&format!("<user>\n{text}\n</user>\n\n")),
            Message::Assistant { text, tool_calls } => {
                out.push_str("<assistant>\n");
                out.push_str(text);
                for c in tool_calls {
                    out.push_str(&format!("\n[called {} with {}]", c.name, c.arguments));
                }
                out.push_str("\n</assistant>\n\n");
            }
            Message::Tool { name, content, is_error, .. } => {
                out.push_str(&format!("<tool_result name=\"{name}\"{}>\n{content}\n</tool_result>\n\n", if *is_error { " error=\"true\"" } else { "" }));
            }
        }
    }
    out.push_str("Answer the last message as the assistant.");
    out
}

impl CopilotProvider {
    /// `program` is an explicit CLI path, else it is looked for; `inert_mcp` is the `mobius-inert-mcp` program;
    /// `token` is the person's GitHub sign-in.
    pub fn new(program: Option<&Path>, inert_mcp: PathBuf, workdir: PathBuf, token: &str) -> Result<CopilotProvider, String> {
        let program = find(program).ok_or(INSTALL_HINT)?;
        if !inert_mcp.is_file() {
            return Err(format!("{} is missing next to Mobius", inert_mcp.display()));
        }
        if token.trim().is_empty() {
            return Err(SIGN_IN_HINT.into());
        }
        std::fs::create_dir_all(&workdir).map_err(|e| e.to_string())?;
        Ok(CopilotProvider { program, inert_mcp, workdir, token: token.trim().to_owned(), timeout: DEFAULT_TIMEOUT })
    }

    pub fn with_timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self
    }

    fn env(&self) -> BTreeMap<String, String> {
        let mut env: BTreeMap<String, String> = std::env::vars().filter(|(k, _)| !REMOVED.iter().any(|r| r.eq_ignore_ascii_case(k))).collect();
        env.insert(TOKEN_VARIABLE.into(), self.token.clone());
        env
    }
}

/// One running `copilot --acp`, spoken to in JSON-RPC lines.
struct Session {
    child: Child,
    stdin: ChildStdin,
    lines: Receiver<Option<Value>>,
    stderr: Arc<Mutex<VecDeque<String>>>,
    next_id: u64,
    timeout: Duration,
}

impl Session {
    fn send(&mut self, v: &Value) -> Result<(), ProviderError> {
        writeln!(self.stdin, "{v}").and_then(|()| self.stdin.flush()).map_err(|_| protocol(format!("Copilot stopped reading{}", self.tail())))
    }

    fn request(&mut self, method: &str, params: Value) -> Result<u64, ProviderError> {
        self.next_id += 1;
        let id = self.next_id;
        self.send(&json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }))?;
        Ok(id)
    }

    fn next(&self) -> Result<Option<Value>, ProviderError> {
        match self.lines.recv_timeout(self.timeout) {
            Ok(v) => Ok(v),
            Err(RecvTimeoutError::Disconnected) => Ok(None),
            Err(RecvTimeoutError::Timeout) => Err(ProviderError::Network("Copilot did not answer in time".into())),
        }
    }

    /// Wait for the answer to request `id`, refusing anything the CLI asks for meanwhile.
    fn answer(&mut self, id: u64) -> Result<Value, ProviderError> {
        loop {
            let Some(v) = self.next()? else { return Err(protocol(format!("Copilot stopped{}", self.tail()))) };
            if v.get("id").and_then(Value::as_u64) == Some(id) && v.get("method").is_none() {
                return match v.get("error") {
                    Some(e) => Err(rpc_error(e)),
                    None => Ok(v.get("result").cloned().unwrap_or(Value::Null)),
                };
            }
            if v.get("method").is_some() && v.get("id").is_some() {
                self.refuse(&v)?;
            }
        }
    }

    /// Answer a request from the CLI: permission is always turned down, anything else is not offered.
    fn refuse(&mut self, v: &Value) -> Result<(), ProviderError> {
        let id = v["id"].clone();
        if v["method"] == "session/request_permission" {
            self.send(&json!({ "jsonrpc": "2.0", "id": id, "result": { "outcome": { "outcome": "cancelled" } } }))
        } else {
            self.send(&json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32601, "message": "Mobius does not offer this." } }))
        }
    }

    fn tail(&self) -> String {
        let lines = self.stderr.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        if lines.is_empty() { String::new() } else { format!(" (Copilot said: {})", lines.iter().cloned().collect::<Vec<_>>().join(" ").chars().take(400).collect::<String>()) }
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        if matches!(self.child.try_wait(), Ok(None)) {
            #[cfg(windows)]
            {
                let mut taskkill = Command::new("taskkill");
                let _ = cli::quiet(taskkill.args(["/F", "/T", "/PID", &self.child.id().to_string()]).stdout(Stdio::null()).stderr(Stdio::null())).status();
            }
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
    }
}

/// An error the CLI answers with, as the status Mobius's fallback rules read.
fn rpc_error(e: &Value) -> ProviderError {
    let message = e["message"].as_str().unwrap_or("Copilot refused the request").chars().take(300).collect::<String>();
    let lower = message.to_lowercase();
    let status = if lower.contains("auth") || lower.contains("sign in") || lower.contains("login") || lower.contains("token") {
        401
    } else if lower.contains("rate") || lower.contains("quota") || lower.contains("limit") {
        429
    } else {
        503
    };
    ProviderError::Http { status, message: if status == 401 { format!("{message} {SIGN_IN_HINT}") } else { message } }
}

/// Which of Mobius's tools a tool call from the CLI is, if any: the CLI shows MCP tools under their names.
fn mobius_tool(call: &Value, names: &HashMap<String, String>) -> Option<String> {
    let said = [call.get("title"), call.get("name"), call.get("toolName"), call.pointer("/_meta/toolName"), call.pointer("/rawInput/tool")].into_iter().flatten().filter_map(Value::as_str).collect::<Vec<_>>().join(" ");
    names.iter().filter(|(wire, _)| said.split(|c: char| !(c.is_ascii_alphanumeric() || c == '_' || c == '-')).any(|w| w == wire.as_str() || w.ends_with(&format!("-{wire}")) || w.ends_with(&format!("__{wire}")))).max_by_key(|(wire, _)| wire.len()).map(|(_, mobius)| mobius.clone())
}

impl Provider for CopilotProvider {
    fn complete(&self, request: &ChatRequest, on_text: &mut dyn FnMut(&str) -> bool) -> Result<Completion, ProviderError> {
        let tmp = tempdir().map_err(|e| protocol(e.to_string()))?;
        let mut names = HashMap::new();
        let manifest: Vec<Value> = request
            .tools
            .iter()
            .map(|t| {
                let wire = wire_name(&t.name);
                names.insert(wire.clone(), t.name.clone());
                json!({ "name": wire, "description": t.description, "inputSchema": t.input_schema })
            })
            .collect();
        let tools = tmp.0.join("tools.json");
        std::fs::write(&tools, Value::Array(manifest).to_string()).map_err(|e| protocol(e.to_string()))?;

        let mut args = vec!["--acp".to_owned()];
        if !request.model.is_empty() && request.model != "auto" {
            args.extend(["--model".to_owned(), request.model.clone()]);
        }
        let mut command = Command::new(&self.program);
        command.args(&args).current_dir(&self.workdir).env_clear().envs(self.env()).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
        #[cfg(windows)]
        std::os::windows::process::CommandExt::creation_flags(&mut command, 0x0800_0000 | 0x0000_0200);
        let mut child = command.spawn().map_err(|e| protocol(format!("could not start Copilot: {e}")))?;
        let (Some(stdin), Some(stdout), Some(stderr)) = (child.stdin.take(), child.stdout.take(), child.stderr.take()) else {
            let _ = child.kill();
            return Err(protocol("could not talk to Copilot"));
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
                if let Ok(v) = serde_json::from_str::<Value>(&line) {
                    let _ = tx.send(Some(v));
                }
            }
            let _ = tx.send(None);
        });
        let mut s = Session { child, stdin, lines: rx, stderr: err_lines, next_id: 0, timeout: self.timeout };

        let id = s.request("initialize", json!({ "protocolVersion": 1, "clientCapabilities": { "fs": { "readTextFile": false, "writeTextFile": false }, "terminal": false } }))?;
        s.answer(id)?;
        let mcp = json!([{ "name": "mobius", "command": self.inert_mcp, "args": [tools], "env": [] }]);
        let id = s.request("session/new", json!({ "cwd": self.workdir, "mcpServers": mcp }))?;
        let session = s.answer(id)?.get("sessionId").and_then(Value::as_str).map(str::to_owned).ok_or_else(|| protocol("Copilot did not start a session"))?;
        let prompt_id = s.request("session/prompt", json!({ "sessionId": session, "prompt": [{ "type": "text", "text": prompt(request) }] }))?;

        let started = Instant::now();
        let mut text = String::new();
        let mut calls: Vec<ToolCall> = Vec::new();
        let mut seen: HashMap<String, usize> = HashMap::new();
        loop {
            if started.elapsed() > self.timeout * 4 {
                return Err(ProviderError::Network("Copilot took too long".into()));
            }
            let Some(v) = s.next()? else { return Err(protocol(format!("Copilot stopped before it answered{}", s.tail()))) };
            // The end of the turn.
            if v.get("id").and_then(Value::as_u64) == Some(prompt_id) && v.get("method").is_none() {
                if let Some(e) = v.get("error") {
                    return Err(rpc_error(e));
                }
                let stop = v.pointer("/result/stopReason").and_then(Value::as_str).unwrap_or("end_turn");
                return Ok(Completion { text, tool_calls: Vec::new(), stop: if stop == "max_tokens" { StopReason::Length } else { StopReason::EndTurn } });
            }
            let method = v.get("method").and_then(Value::as_str).unwrap_or("");
            // Whether the call is complete enough to run: it has its arguments, or the CLI has moved past asking.
            let mut ready = false;
            let mut take = |call: &Value, calls: &mut Vec<ToolCall>| {
                let Some(name) = mobius_tool(call, &names) else { return };
                let key = call.get("toolCallId").and_then(Value::as_str).unwrap_or("").to_owned();
                let arguments = call.get("rawInput").cloned().filter(Value::is_object).unwrap_or_else(|| json!({}));
                match seen.get(&key) {
                    Some(&i) if !key.is_empty() => {
                        if arguments.as_object().is_some_and(|a| !a.is_empty()) {
                            calls[i].arguments = arguments;
                        }
                    }
                    _ => {
                        seen.insert(key.clone(), calls.len());
                        calls.push(ToolCall { id: if key.is_empty() { format!("copilot-{}", calls.len()) } else { key }, name, arguments });
                    }
                }
            };
            if method == "session/update" {
                let update = &v["params"]["update"];
                match update["sessionUpdate"].as_str() {
                    Some("agent_message_chunk") => {
                        if let Some(t) = update.pointer("/content/text").and_then(Value::as_str) {
                            text.push_str(t);
                            if !on_text(t) {
                                return Err(ProviderError::Cancelled);
                            }
                        }
                    }
                    Some("tool_call" | "tool_call_update") => {
                        take(update, &mut calls);
                        ready = update.get("status").and_then(Value::as_str).is_some_and(|st| st != "pending");
                    }
                    _ => {}
                }
            } else if method == "session/request_permission" {
                take(&v["params"]["toolCall"], &mut calls);
                s.refuse(&v)?;
                ready = true;
            } else if v.get("id").is_some() && !method.is_empty() {
                s.refuse(&v)?;
            }
            // A call for one of Mobius's tools ends the turn here: Mobius runs it, and asks again with its result.
            if !calls.is_empty() && (ready || calls.iter().all(|c| c.arguments.as_object().is_some_and(|a| !a.is_empty()))) {
                let _ = s.send(&json!({ "jsonrpc": "2.0", "method": "session/cancel", "params": { "sessionId": session } }));
                return Ok(Completion { text, tool_calls: calls, stop: StopReason::ToolUse });
            }
        }
    }
}

struct TempDir(PathBuf);

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn tempdir() -> std::io::Result<TempDir> {
    static COUNT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_nanos());
    let n = COUNT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let dir = std::env::temp_dir().join(format!("mobius-copilot-{}-{nanos}-{n}", std::process::id()));
    std::fs::create_dir(&dir)?;
    Ok(TempDir(dir))
}

#[cfg(test)]
mod tests {
    use super::*;
    use mobius_agent::provider::ToolDef;

    fn names() -> HashMap<String, String> {
        HashMap::from([("files-read".to_owned(), "files.read".to_owned()), ("files-read-all".to_owned(), "files.read_all".to_owned())])
    }

    #[test]
    fn mobius_tools_are_found_by_name_however_the_cli_shows_them() {
        assert_eq!(mobius_tool(&json!({ "title": "files-read" }), &names()).as_deref(), Some("files.read"));
        assert_eq!(mobius_tool(&json!({ "title": "mobius-files-read" }), &names()).as_deref(), Some("files.read"));
        assert_eq!(mobius_tool(&json!({ "title": "mcp__mobius__files-read" }), &names()).as_deref(), Some("files.read"));
        assert_eq!(mobius_tool(&json!({ "title": "Run shell command" }), &names()), None);
        assert_eq!(mobius_tool(&json!({ "title": "shell", "rawInput": { "command": "files-read" } }), &names()), None, "only the tool's own name counts");
        assert_eq!(wire_name("files.read"), "files-read");
    }

    #[test]
    fn the_conversation_goes_in_as_one_prompt() {
        let request = ChatRequest {
            model: "auto".into(),
            system: "Be brief.".into(),
            messages: vec![
                Message::user("hi"),
                Message::Assistant { text: "Let me look.".into(), tool_calls: vec![ToolCall { id: "1".into(), name: "files.read".into(), arguments: json!({ "path": "a" }) }] },
                Message::Tool { call_id: "1".into(), name: "files.read".into(), content: "hello".into(), is_error: false },
            ],
            tools: vec![ToolDef { name: "files.read".into(), description: "Read".into(), input_schema: json!({}) }],
            effort: None,
            max_tokens: None,
        };
        let p = prompt(&request);
        assert!(p.starts_with("<instructions>\nBe brief."));
        assert!(p.contains("<user>\nhi\n</user>") && p.contains("[called files.read with {\"path\":\"a\"}]") && p.contains("<tool_result name=\"files.read\">\nhello"));
    }

    #[test]
    fn the_cli_never_gets_another_account() {
        let p = CopilotProvider { program: PathBuf::new(), inert_mcp: PathBuf::new(), workdir: PathBuf::new(), token: "gho_mine".into(), timeout: DEFAULT_TIMEOUT };
        let env = p.env();
        assert_eq!(env.get(TOKEN_VARIABLE).map(String::as_str), Some("gho_mine"));
        assert!(!env.contains_key("GH_TOKEN") && !env.contains_key("GITHUB_TOKEN") && !env.contains_key("COPILOT_API_URL"));
    }
}
