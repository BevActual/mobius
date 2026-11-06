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
