//! One MCP server over stdio: newline-delimited JSON-RPC 2.0.
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{Sender, channel};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::Duration;

use serde_json::{Value, json};

use crate::config::ServerConfig;

type Res<T> = Result<T, String>;
type Pending = Arc<Mutex<HashMap<u64, Sender<Res<Value>>>>>;

pub const PROTOCOL: &str = "2025-06-18";
const MAX_RESULT: usize = 50_000;
/// What a server needs to run at all. Nothing else of the person's environment (keys, tokens) is passed on.
const KEEP_ENV: [&str; 10] = ["PATH", "PATHEXT", "SystemRoot", "SYSTEMROOT", "TEMP", "TMP", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA"];

#[derive(Debug, Clone, PartialEq)]
pub struct RemoteTool {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
}

pub struct Client {
    stdin: Arc<Mutex<ChildStdin>>,
    pending: Pending,
    next: AtomicU64,
    child: Mutex<Child>,
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// On Windows a command like `npx` is really `npx.cmd`; look for the forms Windows would.
fn resolve_program(command: &str) -> PathBuf {
    let plain = PathBuf::from(command);
    if !cfg!(windows) || plain.extension().is_some() || command.contains(['/', '\\']) {
        return plain;
    }
    let path = std::env::var_os("PATH").unwrap_or_default();
    for dir in std::env::split_paths(&path) {
        for ext in ["exe", "cmd", "bat"] {
            let candidate = dir.join(format!("{command}.{ext}"));
            if candidate.is_file() {
                return candidate;
            }
        }
    }
    plain
}

fn send(stdin: &Mutex<ChildStdin>, value: &Value) -> Res<()> {
    let mut out = lock(stdin);
    writeln!(out, "{value}").and_then(|()| out.flush()).map_err(|_| "the server is not running".to_owned())
}

impl Client {
    /// Start the server and complete the MCP handshake.
    pub fn start(config: &ServerConfig, timeout: Duration) -> Res<Client> {
        let mut command = Command::new(resolve_program(&config.command));
        command.args(&config.args).env_clear();
        for key in KEEP_ENV {
            if let Some(value) = std::env::var_os(key) {
                command.env(key, value);
            }
        }
        command.envs(&config.env).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
        #[cfg(windows)]
        std::os::windows::process::CommandExt::creation_flags(&mut command, 0x0800_0000); // no console window
        let mut child = command.spawn().map_err(|e| format!("could not start {}: {e}", config.command))?;
        let (Some(stdin), Some(stdout)) = (child.stdin.take(), child.stdout.take()) else { return Err("could not talk to the server".into()) };
        let stdin = Arc::new(Mutex::new(stdin));
        let pending: Pending = Arc::default();
        {
            let (stdin, pending) = (stdin.clone(), pending.clone());
            thread::spawn(move || read_loop(BufReader::new(stdout), &stdin, &pending));
        }
        let client = Client { stdin, pending, next: AtomicU64::new(1), child: Mutex::new(child) };
        client.request("initialize", &json!({ "protocolVersion": PROTOCOL, "capabilities": {}, "clientInfo": { "name": "mobius", "version": "0" } }), timeout)?;
        send(&client.stdin, &json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }))?;
        Ok(client)
    }

    pub fn request(&self, method: &str, params: &Value, timeout: Duration) -> Res<Value> {
        let id = self.next.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = channel();
        lock(&self.pending).insert(id, tx);
        if let Err(e) = send(&self.stdin, &json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params })) {
            lock(&self.pending).remove(&id);
            return Err(e);
        }
        match rx.recv_timeout(timeout) {
            Ok(result) => result,
            Err(_) => {
                lock(&self.pending).remove(&id);
                Err(format!("the server did not answer {method} in time"))
            }
        }
    }

    pub fn list_tools(&self, timeout: Duration) -> Res<Vec<RemoteTool>> {
        let mut tools = Vec::new();
        let mut cursor: Option<String> = None;
        for _ in 0..20 {
            let params = cursor.as_ref().map_or_else(|| json!({}), |c| json!({ "cursor": c }));
            let page = self.request("tools/list", &params, timeout)?;
            for t in page.get("tools").and_then(Value::as_array).into_iter().flatten() {
                let Some(name) = t.get("name").and_then(Value::as_str).filter(|n| !n.is_empty()) else { continue };
                tools.push(RemoteTool {
                    name: name.to_owned(),
                    description: t.get("description").and_then(Value::as_str).unwrap_or("").chars().take(1000).collect(),
                    input_schema: t.get("inputSchema").filter(|s| s.is_object()).cloned().unwrap_or_else(|| json!({ "type": "object" })),
                });
            }
            cursor = page.get("nextCursor").and_then(Value::as_str).filter(|c| !c.is_empty()).map(str::to_owned);
            if cursor.is_none() {
                break;
            }
        }
        Ok(tools)
    }

    /// Call a tool. The text parts of the answer are joined; a tool that reports an error becomes an `Err`.
    pub fn call_tool(&self, name: &str, arguments: &Value, timeout: Duration) -> Res<String> {
        let result = self.request("tools/call", &json!({ "name": name, "arguments": if arguments.is_object() { arguments.clone() } else { json!({}) } }), timeout)?;
        let mut text = String::new();
        for item in result.get("content").and_then(Value::as_array).into_iter().flatten() {
            match item.get("type").and_then(Value::as_str) {
                Some("text") => {
                    text.push_str(item.get("text").and_then(Value::as_str).unwrap_or(""));
                    text.push('\n');
                }
                Some(other) => text.push_str(&format!("[{other} content not shown]\n")),
                None => {}
            }
        }
        let mut text = text.trim_end().to_owned();
        if text.len() > MAX_RESULT {
            let mut end = MAX_RESULT;
            while !text.is_char_boundary(end) {
                end -= 1;
            }
            text.truncate(end);
            text.push_str("\n[cut: the answer was too long]");
        }
        if result.get("isError").and_then(Value::as_bool).unwrap_or(false) { Err(if text.is_empty() { "the tool reported an error".into() } else { text }) } else { Ok(text) }
    }
}

impl Drop for Client {
    fn drop(&mut self) {
        let mut child = lock(&self.child);
        let _ = child.kill();
        let _ = child.wait();
    }
}

fn read_loop(reader: impl BufRead, stdin: &Mutex<ChildStdin>, pending: &Pending) {
    for line in reader.lines() {
        let Ok(line) = line else { break };
        let Ok(message) = serde_json::from_str::<Value>(&line) else { continue };
        let method = message.get("method").and_then(Value::as_str);
        match (message.get("id"), method) {
            // The server asked us something. We only answer pings; everything else is a method we do not have.
            (Some(id), Some(method)) => {
                let reply = if method == "ping" { json!({ "jsonrpc": "2.0", "id": id, "result": {} }) } else { json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32601, "message": "method not found" } }) };
                let _ = send(stdin, &reply);
            }
            (Some(id), None) => {
                let Some(id) = id.as_u64() else { continue };
                let Some(tx) = lock(pending).remove(&id) else { continue };
                let outcome = match message.get("error") {
                    Some(e) => Err(e.get("message").and_then(Value::as_str).unwrap_or("the server reported an error").chars().take(500).collect()),
                    None => Ok(message.get("result").cloned().unwrap_or(Value::Null)),
                };
                let _ = tx.send(outcome);
            }
            _ => {}
        }
    }
    // The server is gone: nobody waiting should wait any longer.
    for (_, tx) in lock(pending).drain() {
        let _ = tx.send(Err("the server stopped".into()));
    }
}
