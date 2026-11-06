#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
//! The real binary, spoken to the way Electron will speak to it: one JSON message per line on stdin and stdout.
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;

use serde_json::{Value, json};

struct Daemon {
    child: Child,
    stdin: Option<ChildStdin>,
    lines: mpsc::Receiver<String>,
}

impl Daemon {
    fn start(args: &[&str]) -> Daemon {
        let mut child = Command::new(env!("CARGO_BIN_EXE_mobius-cored"))
            .args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let stdin = child.stdin.take();
        let stdout: ChildStdout = child.stdout.take().unwrap();
        let (sender, lines) = mpsc::channel();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if sender.send(line).is_err() {
                    break;
                }
            }
        });
        Daemon { child, stdin, lines }
    }

    fn send_raw(&mut self, text: &str) {
        let stdin = self.stdin.as_mut().unwrap();
        stdin.write_all(text.as_bytes()).unwrap();
        stdin.write_all(b"\n").unwrap();
        stdin.flush().unwrap();
    }

    fn read(&mut self) -> Value {
        let line = self.lines.recv_timeout(Duration::from_secs(20)).expect("a response line within 20s");
        serde_json::from_str(&line).unwrap_or_else(|_| panic!("stdout must carry only JSON, got: {line:?}"))
    }

    fn call(&mut self, id: u64, method: &str, params: Value) -> Value {
        self.send_raw(&json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }).to_string());
        self.read()
    }

    fn close_stdin_and_wait(&mut self) -> std::process::ExitStatus {
        self.stdin = None;
        for _ in 0..200 {
            if let Some(status) = self.child.try_wait().unwrap() {
                return status;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        self.child.kill().ok();
        panic!("the daemon did not exit after its input closed");
    }
}

impl Drop for Daemon {
    fn drop(&mut self) {
        self.child.kill().ok();
    }
}

fn temp_db(name: &str) -> (PathBuf, PathBuf) {
    let dir = std::env::temp_dir().join(format!("mobius-cored-test-{name}-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    (dir.clone(), dir.join("core.db"))
}

fn agent() -> Value {
    json!({ "kind": "agent", "id": "stdio-agent" })
}

#[test]
fn it_answers_a_ping_over_stdio() {
    let mut d = Daemon::start(&[]);
    let r = d.call(1, "core.ping", json!({}));
    assert_eq!(r["result"]["protocol"], 1);
}

#[test]
fn it_exits_cleanly_when_its_parent_goes_away() {
    let mut d = Daemon::start(&[]);
    d.call(1, "core.ping", json!({}));
    assert!(d.close_stdin_and_wait().success());
}

#[test]
fn demo_tools_exist_only_when_asked_for() {
    let names = |d: &mut Daemon| -> Vec<String> { d.call(1, "tools.list", json!({}))["result"].as_array().unwrap().iter().map(|t| t["name"].as_str().unwrap().to_owned()).collect() };
    let mut plain = Daemon::start(&[]);
    assert_eq!(names(&mut plain), ["clock.now"], "only the built-in tools");
    let mut demo = Daemon::start(&["--demo-tools"]);
    assert_eq!(names(&mut demo), ["clock.now", "demo.echo", "demo.exec_probe"]);
}

#[test]
fn a_huge_line_is_refused_and_the_next_request_still_works() {
    let mut d = Daemon::start(&[]);
    d.send_raw(&"x".repeat(3 * 1024 * 1024));
    let refused = d.read();
    assert_eq!(refused["error"]["code"], -32600);
    assert_eq!(d.call(2, "core.ping", json!({}))["result"]["protocol"], 1);
}

#[test]
fn garbage_does_not_end_the_session() {
    let mut d = Daemon::start(&[]);
    d.send_raw("not json at all");
    assert_eq!(d.read()["error"]["code"], -32700);
    d.send_raw("");
    assert_eq!(d.call(3, "core.ping", json!({}))["result"]["protocol"], 1);
}

#[test]
fn decisions_and_events_survive_a_real_process_restart() {
    let (dir, db) = temp_db("restart");
    let db_arg = db.to_str().unwrap().to_owned();
    {
        let mut d = Daemon::start(&["--db", &db_arg, "--demo-tools"]);
        let r = d.call(1, "tools.invoke", json!({ "principal": agent(), "tool": "demo.echo", "args": { "hello": "world" } }));
        let request_id = r["result"]["request_id"].as_u64().unwrap();
        d.call(2, "permissions.resolve", json!({ "request_id": request_id, "approve": true, "duration": "always" }));
        let r = d.call(3, "tools.invoke", json!({ "principal": agent(), "tool": "demo.echo", "args": { "hello": "world" } }));
        assert_eq!(r["result"]["status"], "completed");
        assert!(d.close_stdin_and_wait().success());
    }
    // A hard kill, as when the app crashes, must not lose anything that was acknowledged.
    {
        let mut d = Daemon::start(&["--db", &db_arg, "--demo-tools"]);
        let grants = d.call(1, "permissions.grants", json!({}));
        assert_eq!(grants["result"].as_array().unwrap().len(), 1);
        let r = d.call(2, "tools.invoke", json!({ "principal": agent(), "tool": "demo.echo", "args": {} }));
        assert_eq!(r["result"]["status"], "completed", "the standing grant outlived the process");
        let events = d.call(3, "events.list", json!({ "limit": 100 }));
        assert_eq!(events["result"].as_array().unwrap().len(), 8, "the log kept what happened before and added the new run");
        d.child.kill().unwrap();
        d.child.wait().ok();
    }
    let mut d = Daemon::start(&["--db", &db_arg, "--demo-tools"]);
    let events = d.call(1, "events.list", json!({ "limit": 100 }));
    assert_eq!(events["result"].as_array().unwrap().len(), 8, "a killed process lost nothing it had acknowledged");
    drop(d);
    std::fs::remove_dir_all(dir).ok();
}

#[test]
fn it_reports_its_version_and_rejects_unknown_flags() {
    let output = Command::new(env!("CARGO_BIN_EXE_mobius-cored")).arg("--version").output().unwrap();
    assert!(output.status.success());
    assert!(String::from_utf8_lossy(&output.stdout).contains("mobius-cored"));
    let output = Command::new(env!("CARGO_BIN_EXE_mobius-cored")).arg("--bogus").output().unwrap();
    assert_eq!(output.status.code(), Some(2));
}
