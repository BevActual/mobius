//! The MCP servers a person configured (`mcp.json` in the data folder): started in the background, their tools handed
//! to the core like any other, and run when the core says a call is allowed.
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use mobius_mcp::hub::Hub;
use serde_json::{Value, json};

use crate::process::CoreProcess;

#[derive(Default)]
pub struct McpState {
    hub: Mutex<Option<Arc<Hub>>>,
    failed: Mutex<Vec<(String, String)>>,
    problem: Mutex<Option<String>>,
    starting: AtomicBool,
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

impl McpState {
    /// Which servers run, which did not start (and why), and whether the file itself could not be used.
    pub fn status(&self) -> Value {
        let running = lock(&self.hub).as_ref().map(|h| h.servers()).unwrap_or_default();
        let failed: Vec<Value> = lock(&self.failed).iter().map(|(server, error)| json!({ "server": server, "error": error })).collect();
        json!({ "running": running, "failed": failed, "problem": lock(&self.problem).clone() })
    }

    pub fn run(&self, tool: &str, args: &Value) -> Result<String, String> {
        // Not held while the call runs: a slow server must not block the others.
        let hub = lock(&self.hub).clone().ok_or("unknown tool")?;
        hub.run(tool, args)
    }

    /// Start the configured servers (once) and register their tools with the core (every time the core becomes ready).
    pub fn begin(self: &Arc<Self>, config: PathBuf, core: Arc<CoreProcess>) {
        let this = self.clone();
        std::thread::spawn(move || {
            if lock(&this.hub).is_none() && !this.starting.swap(true, Ordering::SeqCst) {
                this.start(&config);
            }
            let hub = lock(&this.hub).clone();
            for tool in hub.iter().flat_map(|h| h.descriptions()) {
                let _ = core.call("tools.register_external", tool, Duration::from_secs(5));
            }
        });
    }

    fn start(&self, config: &std::path::Path) {
        let text = match std::fs::read_to_string(config) {
            Ok(t) => t,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return,
            Err(_) => {
                *lock(&self.problem) = Some("mcp.json could not be read".into());
                return;
            }
        };
        match mobius_mcp::config::parse(&text) {
            Ok(servers) => {
                let (hub, failed) = Hub::start(&servers);
                *lock(&self.failed) = failed;
                *lock(&self.hub) = Some(Arc::new(hub));
            }
            Err(problem) => *lock(&self.problem) = Some(problem),
        }
    }
}

/// The servers listed in mcp.json now, by name; none when there is no file or it cannot be used.
pub fn configured(config: &std::path::Path) -> Vec<String> {
    std::fs::read_to_string(config).ok().and_then(|t| mobius_mcp::config::parse(&t).ok()).map(|s| s.into_keys().collect()).unwrap_or_default()
}

/// The file as it is, or a new one with no servers. A file that is not JSON is never overwritten.
fn read_root(config: &std::path::Path) -> Result<Value, String> {
    match std::fs::read_to_string(config) {
        Ok(text) => {
            let root: Value = serde_json::from_str(&text).map_err(|_| "mcp.json is not valid JSON, so it was left as it is. Fix it in the data folder first.".to_owned())?;
            if !root.is_object() {
                return Err("mcp.json is not a JSON object, so it was left as it is.".into());
            }
            Ok(root)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(json!({ "servers": {} })),
        Err(_) => Err("mcp.json could not be read".into()),
    }
}

/// Write the file only if Mobius can start everything in it, keeping whatever else it holds.
fn write_root(config: &std::path::Path, root: &Value) -> Result<(), String> {
    let text = serde_json::to_string_pretty(root).map_err(|e| e.to_string())?;
    mobius_mcp::config::parse(&text)?;
    let tmp = config.with_extension("json.tmp");
    std::fs::write(&tmp, format!("{text}\n")).map_err(|_| "mcp.json could not be written".to_owned())?;
    std::fs::rename(&tmp, config).map_err(|_| "mcp.json could not be written".to_owned())
}

/// Add a server to mcp.json (Abilities › Add a Connector). It starts the next time Mobius opens.
pub fn add_server(config: &std::path::Path, name: &str, command: &str, args: &[String], env: &serde_json::Map<String, Value>) -> Result<(), String> {
    if !mobius_mcp::config::is_server_name(name) {
        return Err("Use a short name in lowercase letters, digits and _, starting with a letter (such as github).".into());
    }
    if command.trim().is_empty() {
        return Err("Give the command that runs the server.".into());
    }
    let mut root = read_root(config)?;
    let Some(object) = root.as_object_mut() else { return Err("mcp.json is not a JSON object, so it was left as it is.".into()) };
    let servers = object.entry("servers").or_insert_with(|| json!({}));
    let Some(servers) = servers.as_object_mut() else { return Err("mcp.json's \"servers\" is not an object, so it was left as it is.".into()) };
    if servers.contains_key(name) {
        return Err(format!("There is already a connector called {name}."));
    }
    let mut entry = serde_json::Map::new();
    entry.insert("command".into(), json!(command.trim()));
    if !args.is_empty() {
        entry.insert("args".into(), json!(args));
    }
    if !env.is_empty() {
        entry.insert("env".into(), Value::Object(env.clone()));
    }
    servers.insert(name.to_owned(), Value::Object(entry));
    write_root(config, &root)
}

/// Take a server out of mcp.json, giving back its entry so it can be put back (Undo). A server that is running stops
/// the next time Mobius opens.
pub fn remove_server(config: &std::path::Path, name: &str) -> Result<Value, String> {
    let mut root = read_root(config)?;
    let removed = root.get_mut("servers").and_then(Value::as_object_mut).and_then(|s| s.remove(name));
    let Some(entry) = removed else { return Err(format!("There is no connector called {name} in mcp.json.")) };
    write_root(config, &root)?;
    Ok(entry)
}
