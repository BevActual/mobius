//! `mobius-cored`: the Mobius core as a separate process.
//!
//! The desktop app starts it and speaks JSON-RPC 2.0 to it, one message per line on stdin and stdout. Logs go to
//! stderr only, so stdout carries nothing but protocol messages. It exits when its input closes, so it can never
//! outlive the app that started it.
//!
//! The main thread owns the core and handles one thing at a time. Reading input and calling models happen on other
//! threads and report back through a channel, so a slow model never makes the core unresponsive. Besides replies,
//! the daemon sends notifications (`agent.event`, `agent.delta`) that have no id.
mod agent_rpc;
mod inbox;
mod models_rpc;

use std::io::{self, BufRead, Read, Write};
use std::path::PathBuf;
use std::process::ExitCode;
use std::sync::mpsc::sync_channel;

use mobius_agent::conversations::{ConversationStore, MemoryStore, SqliteStore};
use mobius_core::builtin::register_builtin_tools;
use mobius_core::core::{Core, ToolSpec, system_clock};
use mobius_agent::host::Out;
use mobius_core::rpc::{Extension, ExtensionError, handle_line_with};
use serde_json::{Value, json};

use crate::agent_rpc::Agent;
use crate::inbox::{Inbox, Line};
use crate::models_rpc::{Models, ModelsConfig};

/// The longest message accepted. A longer line is refused and skipped, never buffered.
const MAX_LINE_BYTES: usize = 1024 * 1024;
const INBOX_CAPACITY: usize = 1024;

fn read_bounded_line(reader: &mut impl BufRead) -> io::Result<Line> {
    let mut buffer = Vec::new();
    let read = reader.by_ref().take(MAX_LINE_BYTES as u64 + 1).read_until(b'\n', &mut buffer)?;
    if read == 0 {
        return Ok(Line::Eof);
    }
    if buffer.last() == Some(&b'\n') {
        buffer.pop();
        if buffer.last() == Some(&b'\r') {
            buffer.pop();
        }
        return Ok(Line::Text(String::from_utf8_lossy(&buffer).into_owned()));
    }
    if buffer.len() <= MAX_LINE_BYTES {
        // The input ended in the middle of a line.
        return Ok(Line::Text(String::from_utf8_lossy(&buffer).into_owned()));
    }
    // Too long: throw away the rest of this line without holding it in memory.
    loop {
        let mut chunk = Vec::new();
        let n = reader.by_ref().take(64 * 1024).read_until(b'\n', &mut chunk)?;
        if n == 0 || chunk.last() == Some(&b'\n') {
            return Ok(Line::TooLong);
        }
    }
}

/// Searching past conversations. It reads the saved conversations on its own connection, so it never waits on a turn.
fn register_session_search(core: &mut Core, path: PathBuf) -> Result<(), mobius_core::core::CoreError> {
    let spec = ToolSpec::new(
        "sessions.search",
        "Search the person's past conversations with Mobius for words that were said in them (not tool output). Returns the matching conversations, newest first, each with a short snippet. Use it when they refer to something discussed before.",
        "sessions.read",
    )?
    .with_input_schema(json!({ "type": "object", "properties": { "query": { "type": "string", "description": "Words to look for; every word must appear." } }, "required": ["query"] }));
    core.register_tool(spec, Box::new(move |args| {
        let query = args.get("query").and_then(serde_json::Value::as_str).ok_or("query is required")?;
        let store = SqliteStore::open(&path).map_err(|e| format!("past conversations cannot be read: {e}"))?;
        let all = store.load_all(500).map_err(|e| format!("past conversations cannot be read: {e}"))?;
        Ok(mobius_agent::sessions::search(&all, query, None))
    }))
}

fn register_demo_tools(core: &mut Core) -> Result<(), mobius_core::core::CoreError> {
    let spec = |name: &str, description: &str, capability: &str| ToolSpec::new(name, description, capability);
    core.register_tool(spec("demo.echo", "Returns its arguments.", "demo.echo")?, Box::new(|args| Ok(json!({ "echo": args.clone() }))))?;
    // Exists to exercise a capability that always needs per-use approval. It does not run anything.
    core.register_tool(spec("demo.exec_probe", "Stands in for a command that needs approval each time.", "process.exec")?, Box::new(|_| Ok(json!("probe"))))?;
    Ok(())
}

fn usage() -> ExitCode {
    eprintln!("usage: mobius-cored [--db <path>] [--conversations <path>] [--models-dir <path>]... [--download-dir <path>] [--state-dir <path>] [--hub <url>] [--engine-releases <url>] [--llama-server <path>] [--claude-command <path>] [--claude-upstream <url>] [--claude-inert-mcp <path>] [--chatgpt-upstream <url>] [--demo-tools] [--version]");
    ExitCode::from(2)
}

fn too_long_reply() -> String {
    json!({ "jsonrpc": "2.0", "id": null, "error": { "code": -32600, "message": "message too long" } }).to_string()
}

fn main() -> ExitCode {
    let mut db: Option<PathBuf> = None;
    let mut conversations: Option<PathBuf> = None;
    let mut demo_tools = false;
    let mut hub = "https://huggingface.co".to_owned();
    let mut roots: Vec<PathBuf> = Vec::new();
    let mut default_models = true;
    let mut state_dir: Option<PathBuf> = None;
    let mut download_dir: Option<PathBuf> = None;
    let mut llama_server: Option<PathBuf> = None;
    let mut llama_env: Vec<(String, String)> = Vec::new();
    let mut claude = agent_rpc::ClaudeSetup::default();
    let mut engine_releases: Option<String> = None;
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--version" => {
                println!("mobius-cored {}", env!("CARGO_PKG_VERSION"));
                return ExitCode::SUCCESS;
            }
            "--demo-tools" => demo_tools = true,
            "--hub" => match args.next() {
                Some(url) => hub = url,
                None => return usage(),
            },
            // Tests: a pretend GitHub. Files are then only taken from that server's /download/.
            "--engine-releases" => match args.next() {
                Some(url) => engine_releases = Some(url),
                None => return usage(),
            },
            "--models-dir" => match args.next() {
                Some(path) => roots.push(PathBuf::from(path)),
                None => return usage(),
            },
            "--no-default-models" => default_models = false,
            "--state-dir" => match args.next() {
                Some(path) => state_dir = Some(PathBuf::from(path)),
                None => return usage(),
            },
            "--download-dir" => match args.next() {
                Some(path) => download_dir = Some(PathBuf::from(path)),
                None => return usage(),
            },
            "--llama-server" => match args.next() {
                Some(path) => llama_server = Some(PathBuf::from(path)),
                None => return usage(),
            },
            "--llama-env" => match args.next().and_then(|pair| pair.split_once('=').map(|(k, v)| (k.to_owned(), v.to_owned()))) {
                Some(pair) => llama_env.push(pair),
                None => return usage(),
            },
            "--claude-command" => match args.next() {
                Some(path) => claude.command = Some(PathBuf::from(path)),
                None => return usage(),
            },
            "--copilot-command" => match args.next() {
                Some(path) => claude.copilot_command = Some(PathBuf::from(path)),
                None => return usage(),
            },
            "--claude-upstream" => match args.next() {
                Some(url) => claude.upstream = Some(url),
                None => return usage(),
            },
            "--chatgpt-upstream" => match args.next() {
                Some(url) => claude.chatgpt_upstream = Some(url),
                None => return usage(),
            },
            "--claude-inert-mcp" => match args.next() {
                Some(path) => claude.inert_mcp = Some(PathBuf::from(path)),
                None => return usage(),
            },
            "--conversations" => match args.next() {
                Some(path) => conversations = Some(PathBuf::from(path)),
                None => return usage(),
            },
            "--db" => match args.next() {
                Some(path) => db = Some(PathBuf::from(path)),
                None => return usage(),
            },
            _ => return usage(),
        }
    }

    let opened = match &db {
        Some(path) => Core::open(path, system_clock()),
        None => Core::open_in_memory(system_clock()),
    };
    let mut core = match opened {
        Ok(core) => core,
        Err(error) => {
            eprintln!("mobius-cored: cannot open the core: {error}");
            return ExitCode::from(1);
        }
    };
    if let Err(error) = register_builtin_tools(&mut core) {
        eprintln!("mobius-cored: cannot register built-in tools: {error}");
        return ExitCode::from(1);
    }
    if let Some(path) = &conversations
        && let Err(error) = register_session_search(&mut core, path.clone())
    {
        eprintln!("mobius-cored: cannot register session search: {error}");
    }
    if demo_tools && let Err(error) = register_demo_tools(&mut core) {
        eprintln!("mobius-cored: cannot register demo tools: {error}");
        return ExitCode::from(1);
    }

    let (sender, receiver) = sync_channel::<Inbox>(INBOX_CAPACITY);
    let reader = sender.clone();
    std::thread::spawn(move || {
        let stdin = io::stdin();
        let mut input = stdin.lock();
        loop {
            match read_bounded_line(&mut input) {
                Ok(Line::Eof) => {
                    reader.send(Inbox::Line(Line::Eof)).ok();
                    return;
                }
                Ok(line) => {
                    if reader.send(Inbox::Line(line)).is_err() {
                        return;
                    }
                }
                Err(error) => {
                    reader.send(Inbox::InputFailed(error.to_string())).ok();
                    return;
                }
            }
        }
    });
    // Conversations that cannot be saved are still usable. A file that cannot be opened is left exactly as it is.
    let store: Box<dyn ConversationStore> = match &conversations {
        Some(path) => match SqliteStore::open(path) {
            Ok(store) => Box::new(store),
            Err(error) => {
                eprintln!("mobius-cored: conversations will not be saved: {error}");
                Box::new(MemoryStore::default())
            }
        },
        None => Box::new(MemoryStore::default()),
    };
    let mut agent = match Agent::new(sender.clone(), store) {
        Ok(agent) => agent,
        Err(error) => {
            eprintln!("mobius-cored: cannot start the agent: {error}");
            return ExitCode::from(1);
        }
    };
    // Claude Code runs in a folder of its own, never a project folder.
    claude.workdir = state_dir.as_ref().map(|d| d.join("claude-code"));
    agent.set_claude(claude);

    let home = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).map(PathBuf::from).unwrap_or_default();
    if default_models {
        // Where Hugging Face tools keep what they download.
        let cache = std::env::var_os("HF_HUB_CACHE").map(PathBuf::from).unwrap_or_else(|| std::env::var_os("HF_HOME").map(|h| PathBuf::from(h).join("hub")).unwrap_or_else(|| home.join(".cache").join("huggingface").join("hub")));
        roots.push(cache);
    }
    let engine_dir = state_dir.as_ref().map(|d| d.join("engine"));
    let (engine_releases, engine_prefix) = match engine_releases {
        Some(url) => {
            let origin = url.split('/').take(3).collect::<Vec<_>>().join("/");
            (url, format!("{origin}/download/"))
        }
        None => (mobius_runtime::engine::RELEASES.to_owned(), mobius_runtime::engine::DOWNLOAD_PREFIX.to_owned()),
    };
    let mut models = Models::new(ModelsConfig { hub, roots, llama_server, llama_env, state_dir, download_dir, home, engine_dir, engine_releases, engine_prefix }, sender.clone());
    let windows = agent_rpc::KnownWindows::default();
    models.share_windows(windows.clone());
    agent.share_windows(windows);

    let stdout = io::stdout();
    let mut output = stdout.lock();
    // A closed output means the parent is gone: stop quietly.
    let mut write = |text: &str| writeln!(output, "{text}").and_then(|()| output.flush()).is_ok();
    while let Ok(message) = receiver.recv() {
        let mut work = Vec::new();
        match message {
            Inbox::Line(Line::Eof) => return ExitCode::SUCCESS,
            Inbox::InputFailed(error) => {
                eprintln!("mobius-cored: cannot read input: {error}");
                return ExitCode::from(1);
            }
            Inbox::Line(Line::TooLong) => {
                if !write(&too_long_reply()) {
                    return ExitCode::SUCCESS;
                }
            }
            Inbox::Line(Line::Text(text)) if text.trim().is_empty() => continue,
            Inbox::Line(Line::Text(text)) if let Some(outs) = agent.host_response(&mut core, &text) => work.extend(outs),
            Inbox::Line(Line::Text(text)) => {
                if let Some(reply) = handle_line_with(&mut core, &mut Both(&mut agent, &mut models), &text) {
                    if !write(&reply) {
                        return ExitCode::SUCCESS;
                    }
                }
                work.extend(agent.take_queued());
            }
            Inbox::Text { turn_id, text } => work.extend(agent.on_text(turn_id, &text)),
            Inbox::Switched { turn_id, model, why } => work.extend(agent.on_switched(turn_id, &model, &why)),
            Inbox::ModelDone { turn_id, result } => work.extend(agent.on_model_done(&mut core, turn_id, result)),
            Inbox::Verdict { turn_id, request_id, result } => work.extend(agent.on_review_done(&mut core, turn_id, request_id, result)),
            Inbox::Job { job, result } => work.push(Out::Notify(models.on_job(&job, &result))),
            Inbox::Notify(note) => work.push(Out::Notify(note)),
        }
        // A person may have just answered a question that a turn is waiting on.
        work.extend(agent.poll(&mut core));
        if !agent.run(&mut core, work, &mut write) {
            return ExitCode::SUCCESS;
        }
    }
    ExitCode::SUCCESS
}

/// Both sets of methods behind one extension: the first that knows a method answers it.
struct Both<'a>(&'a mut Agent, &'a mut Models);

impl Extension for Both<'_> {
    fn call(&mut self, core: &mut Core, method: &str, params: Option<&Value>) -> Option<Result<Value, ExtensionError>> {
        self.0.call(core, method, params).or_else(|| self.1.call(core, method, params))
    }
}
