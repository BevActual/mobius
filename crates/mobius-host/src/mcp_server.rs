//! Settings > Advanced > Other apps: let agents such as Claude Code or Hermes use Mobius's tools over MCP.
//!
//! Off until the person turns it on. Reading the workspace is all another app can do unless the person also lets it
//! change files; every change is checkpointed like the assistant's own, so it can be undone. The token is generated
//! here, kept in the system secret store, and shown only so the person can paste it into the other app.
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use mobius_mcp::server::{Server, Tools};
use serde_json::{Value, json};

use crate::secrets::Secrets;

pub const TOKEN_SECRET: &str = "mcp-server-token";
pub const DEFAULT_PORT: u16 = 47_823;
const READ_TOOLS: [&str; 3] = ["files.list", "files.read", "files.search"];

pub type Changed = Arc<dyn Fn(&str) + Send + Sync>;

/// The workspace tools, as another app sees them.
struct WorkspaceTools {
    workspace: mobius_workspace::files::Workspace,
    allow_changes: bool,
    changed: Changed,
}

impl Tools for WorkspaceTools {
    fn list(&self) -> Vec<Value> {
        mobius_workspace::files::tool_descriptions()
            .into_iter()
            .filter(|t| self.allow_changes || t["name"].as_str().is_some_and(|n| READ_TOOLS.contains(&n)))
            .map(|t| json!({ "name": t["name"], "description": t["description"], "inputSchema": t["input_schema"] }))
            .collect()
    }

    fn call(&self, name: &str, arguments: &Value) -> Result<String, String> {
        if !self.allow_changes && !READ_TOOLS.contains(&name) {
            return Err("Mobius only lets other apps read its files.".into());
        }
        let result = self.workspace.run(name, arguments);
        if result.is_ok() && !READ_TOOLS.contains(&name) {
            (self.changed)(arguments.get("path").and_then(Value::as_str).unwrap_or(""));
        }
        result
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
struct Choice {
    enabled: bool,
    allow_changes: bool,
    port: u16,
}

pub struct McpServer {
    settings_path: PathBuf,
    workspace_dir: PathBuf,
    checkpoints_dir: PathBuf,
    secrets: Arc<dyn Secrets>,
    changed: Changed,
    state: Mutex<(Choice, Option<Server>, Option<String>)>,
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

fn new_token() -> Option<String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).ok()?;
    Some(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

impl McpServer {
    pub fn open(settings_path: PathBuf, workspace_dir: PathBuf, checkpoints_dir: PathBuf, secrets: Arc<dyn Secrets>, changed: Changed) -> McpServer {
        let saved = mobius_store::file::read_json(&settings_path).unwrap_or(Value::Null);
        let choice = Choice {
            enabled: saved.get("enabled") == Some(&Value::Bool(true)),
            allow_changes: saved.get("allowChanges") == Some(&Value::Bool(true)),
            port: saved.get("port").and_then(Value::as_u64).and_then(|p| u16::try_from(p).ok()).filter(|p| *p >= 1024).unwrap_or(DEFAULT_PORT),
        };
        let server = McpServer { settings_path, workspace_dir, checkpoints_dir, secrets, changed, state: Mutex::new((choice, None, None)) };
        server.apply();
        server
    }

    fn token(&self) -> Option<String> {
        if let Some(t) = self.secrets.get(TOKEN_SECRET).filter(|t| t.len() >= 32) {
            return Some(t);
        }
        let token = new_token()?;
        self.secrets.put(TOKEN_SECRET, &token).then_some(token)
    }

    /// Start, restart or stop the listener to match the saved choice.
    fn apply(&self) {
        let mut state = lock(&self.state);
        state.1 = None;
        state.2 = None;
        if !state.0.enabled {
            return;
        }
        let Some(token) = self.token() else {
            state.2 = Some("This computer has no secret store to keep the token in.".into());
            return;
        };
        let tools = WorkspaceTools {
            workspace: mobius_workspace::files::Workspace::new(self.workspace_dir.clone(), self.checkpoints_dir.clone()),
            allow_changes: state.0.allow_changes,
            changed: self.changed.clone(),
        };
        match Server::start(state.0.port, token, Arc::new(tools)) {
            Ok(server) => state.1 = Some(server),
            Err(e) => state.2 = Some(format!("Port {} is in use by another program ({e}). Choose another port.", state.0.port)),
        }
    }

    fn save(&self, choice: Choice) {
        mobius_store::file::write_json_checked(&self.settings_path, &json!({ "enabled": choice.enabled, "allowChanges": choice.allow_changes, "port": choice.port }));
    }

    pub fn status(&self) -> Value {
        let state = lock(&self.state);
        let (choice, server, problem) = (&state.0, &state.1, &state.2);
        let url = server.as_ref().map(|s| format!("http://127.0.0.1:{}/mcp", s.port()));
        json!({ "enabled": choice.enabled, "allowChanges": choice.allow_changes, "port": choice.port, "running": server.is_some(), "url": url, "problem": problem })
    }

    /// The token, for pasting into the other app. Only while sharing is on.
    pub fn reveal_token(&self) -> Option<String> {
        lock(&self.state).0.enabled.then(|| self.token()).flatten()
    }

    pub fn set(&self, enabled: Option<bool>, allow_changes: Option<bool>, port: Option<u16>) -> Value {
        if port.is_some_and(|p| p < 1024) {
            return json!({ "ok": false, "error": "Use a port from 1024 to 65535." });
        }
        let next = {
            let mut state = lock(&self.state);
            state.0 = Choice { enabled: enabled.unwrap_or(state.0.enabled), allow_changes: allow_changes.unwrap_or(state.0.allow_changes), port: port.unwrap_or(state.0.port) };
            state.0
        };
        self.save(next);
        self.apply();
        json!({ "ok": true })
    }

    /// A new token: apps set up with the old one stop working.
    pub fn renew_token(&self) -> Value {
        match new_token() {
            Some(token) if self.secrets.put(TOKEN_SECRET, &token) => {
                self.apply();
                json!({ "ok": true })
            }
            _ => json!({ "ok": false, "error": "A new token could not be made." }),
        }
    }

    /// Forget the token too. Used when the person removes all their data.
    pub fn forget(&self) {
        self.set(Some(false), Some(false), None);
        self.secrets.delete(TOKEN_SECRET);
    }
}
