//! Commands that keep running in a Code project (a development server, a watcher): started by the person from the
//! console or by the agent (asked every time, as `process.exec`), their output kept as it comes, and stopped on
//! request or when Mobius quits. At most a few at once.
use std::io::Read;
use std::path::Path;
use std::process::Child;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{Value, json};

const MAX_RUNNING: usize = 5;
const MAX_OUTPUT: usize = 64 * 1024;
const TAIL: usize = 8 * 1024;

pub fn is_process_tool(name: &str) -> bool {
    matches!(name, "code.start" | "code.output" | "code.stop")
}

pub fn tool_descriptions() -> Vec<Value> {
    vec![
        json!({ "name": "code.start", "capability": "process.exec", "resource_arg": "command",
            "description": "Start a command that keeps running in a Code project's folder, such as a development server or a watcher, and get its id. The person is asked every time. Read what it prints with code.output; stop it with code.stop.",
            "input_schema": { "type": "object", "properties": { "project": { "type": "string" }, "command": { "type": "string" } }, "required": ["project", "command"] } }),
        json!({ "name": "code.output", "capability": "code.output", "resource_arg": "id",
            "description": "What a command started with code.start has printed so far (the last part), and whether it is still running.",
            "input_schema": { "type": "object", "properties": { "id": { "type": "integer" } }, "required": ["id"] } }),
        json!({ "name": "code.stop", "capability": "code.output", "resource_arg": "id",
            "description": "Stop a command started with code.start.",
            "input_schema": { "type": "object", "properties": { "id": { "type": "integer" } }, "required": ["id"] } }),
    ]
}

struct Proc {
    id: u64,
    project: String,
    command: String,
    by: String,
    started: u64,
    child: Child,
    output: Arc<Mutex<Vec<u8>>>,
    exit: Option<Option<i32>>,
}

#[derive(Default)]
pub struct Processes {
    all: Mutex<Vec<Proc>>,
    next: Mutex<u64>,
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
}

fn kill_tree(child: &mut Child) {
    let pid = child.id();
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = std::process::Command::new("taskkill").args(["/T", "/F", "/PID", &pid.to_string()]).creation_flags(0x0800_0000).output();
    }
    #[cfg(unix)]
    {
        // Started in a process group of its own, so what the shell started stops too.
        let _ = std::process::Command::new("kill").args(["-TERM", "--", &format!("-{pid}")]).output();
    }
    let _ = pid;
    let _ = child.kill();
    let _ = child.wait();
}

fn text(out: &Arc<Mutex<Vec<u8>>>, limit: usize) -> String {
    let bytes = out.lock().map(|o| o.clone()).unwrap_or_default();
    let start = bytes.len().saturating_sub(limit);
    String::from_utf8_lossy(&bytes[start..]).into_owned()
}

impl Processes {
    fn refresh(all: &mut [Proc]) {
        for p in all.iter_mut().filter(|p| p.exit.is_none()) {
            if let Ok(Some(status)) = p.child.try_wait() {
                p.exit = Some(status.code());
            }
        }
    }

    fn describe(p: &Proc, limit: usize) -> Value {
        json!({ "id": p.id, "project": p.project, "command": p.command, "by": p.by, "started": p.started, "running": p.exit.is_none(), "code": p.exit.flatten(), "output": text(&p.output, limit) })
    }

    pub fn start(&self, dir: &Path, project: &str, command: &str, by: &str) -> Result<Value, String> {
        let command = command.trim();
        if command.is_empty() || command.len() > 2000 || command.contains(['\n', '\r', '\0']) {
            return Err("a command is one line".into());
        }
        let mut all = self.all.lock().map_err(|_| "busy")?;
        Self::refresh(&mut all);
        if all.iter().filter(|p| p.exit.is_none()).count() >= MAX_RUNNING {
            return Err(format!("{MAX_RUNNING} commands are running already; stop one first"));
        }
        let mut cmd = crate::code_tests::shell_command(dir, command);
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            cmd.process_group(0);
        }
        let mut child = cmd.spawn().map_err(|e| format!("it could not start: {e}"))?;
        let output = Arc::new(Mutex::new(Vec::new()));
        for pipe in [child.stdout.take().map(|s| Box::new(s) as Box<dyn Read + Send>), child.stderr.take().map(|s| Box::new(s) as Box<dyn Read + Send>)].into_iter().flatten() {
            let output = Arc::clone(&output);
            let mut pipe = pipe;
            std::thread::spawn(move || {
                let mut buf = [0u8; 8192];
                while let Ok(n) = pipe.read(&mut buf) {
                    if n == 0 {
                        break;
                    }
                    if let Ok(mut out) = output.lock() {
                        out.extend_from_slice(&buf[..n]);
                        if out.len() > MAX_OUTPUT * 2 {
                            let cut = out.len() - MAX_OUTPUT;
                            out.drain(..cut);
                        }
                    }
                }
            });
        }
        let id = {
            let mut next = self.next.lock().map_err(|_| "busy")?;
            *next += 1;
            *next
        };
        all.push(Proc { id, project: project.to_owned(), command: command.to_owned(), by: by.to_owned(), started: now_ms(), child, output, exit: None });
        // Finished ones are forgotten once there are many.
        if all.len() > 20 {
            let done: Vec<u64> = all.iter().filter(|p| p.exit.is_some()).map(|p| p.id).take(all.len() - 20).collect();
            all.retain(|p| !done.contains(&p.id));
        }
        Ok(json!({ "id": id, "project": project, "command": command }))
    }

    pub fn list(&self, project: &str) -> Value {
        let Ok(mut all) = self.all.lock() else { return json!([]) };
        Self::refresh(&mut all);
        Value::Array(all.iter().filter(|p| p.project == project).map(|p| Self::describe(p, TAIL)).collect())
    }

    pub fn output(&self, id: u64) -> Result<Value, String> {
        let mut all = self.all.lock().map_err(|_| "busy")?;
        Self::refresh(&mut all);
        all.iter().find(|p| p.id == id).map(|p| Self::describe(p, MAX_OUTPUT)).ok_or_else(|| "no command with that id".to_owned())
    }

    pub fn stop(&self, id: u64) -> Result<Value, String> {
        let mut all = self.all.lock().map_err(|_| "busy")?;
        let p = all.iter_mut().find(|p| p.id == id).ok_or("no command with that id")?;
        if p.exit.is_none() {
            kill_tree(&mut p.child);
            p.exit = Some(None);
        }
        Ok(json!({ "id": id, "stopped": true }))
    }

    pub fn stop_all(&self) {
        if let Ok(mut all) = self.all.lock() {
            for p in all.iter_mut().filter(|p| p.exit.is_none()) {
                kill_tree(&mut p.child);
                p.exit = Some(None);
            }
        }
    }
}

impl Drop for Processes {
    fn drop(&mut self) {
        self.stop_all();
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[test]
    fn a_command_keeps_running_until_stopped_and_its_output_is_kept() {
        let dir = tempfile::tempdir().unwrap();
        let p = Processes::default();
        let started = p.start(dir.path(), "demo", "echo ready; sleep 30", "person").unwrap();
        let id = started["id"].as_u64().unwrap();
        let t = std::time::Instant::now();
        while !p.output(id).unwrap()["output"].as_str().unwrap().contains("ready") && t.elapsed().as_secs() < 5 {
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        assert_eq!(p.list("demo")[0]["running"], true);
        assert!(p.list("other").as_array().unwrap().is_empty());
        p.stop(id).unwrap();
        assert_eq!(p.output(id).unwrap()["running"], false);
        let quick = p.start(dir.path(), "demo", "exit 4", "person").unwrap()["id"].as_u64().unwrap();
        let t = std::time::Instant::now();
        while p.output(quick).unwrap()["running"] == true && t.elapsed().as_secs() < 5 {
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        assert_eq!(p.output(quick).unwrap()["code"], 4);
        assert!(p.start(dir.path(), "demo", "a\nb", "person").is_err());
    }
}
