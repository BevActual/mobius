#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
//! The real daemon finding, ranking and running models, with a fake Hugging Face and a fake llama-server.
use std::collections::VecDeque;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, mpsc};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use serde_json::{Value, json};

const GIB: u64 = 1024 * 1024 * 1024;

fn fake_llama() -> PathBuf {
    let daemon = PathBuf::from(env!("CARGO_BIN_EXE_mobius-cored"));
    let name = if cfg!(windows) { "mobius-fake-llama.exe" } else { "mobius-fake-llama" };
    let path = daemon.parent().unwrap().join(name);
    assert!(path.is_file(), "build the whole workspace first: {path:?}");
    path
}

// ---- a fake Hugging Face ---------------------------------------------------------------------------------------

struct Hub {
    url: String,
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}
impl Drop for Hub {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(t) = self.thread.take() {
            t.join().ok();
        }
    }
}
fn tree(files: &[(&str, u64)]) -> String {
    let items: Vec<String> = files.iter().map(|(p, s)| format!(r#"{{"type":"file","path":"{p}","size":{s},"lfs":{{"oid":"x","size":{s}}}}}"#)).collect();
    format!("[{}]", items.join(","))
}
fn hub(delay_ms: u64, healthy: bool) -> Hub {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let stop = Arc::new(AtomicBool::new(false));
    let stop2 = stop.clone();
    let thread = std::thread::spawn(move || {
        while !stop2.load(Ordering::SeqCst) {
            let Ok((mut stream, _)) = listener.accept() else {
                std::thread::sleep(Duration::from_millis(5));
                continue;
            };
            std::thread::spawn(move || {
                stream.set_nonblocking(false).ok();
                stream.set_read_timeout(Some(Duration::from_secs(5))).ok();
                let mut buf = [0u8; 4096];
                let n = stream.read(&mut buf).unwrap_or(0);
                let head = String::from_utf8_lossy(&buf[..n]).into_owned();
                std::thread::sleep(Duration::from_millis(delay_ms));
                let path = head.split(' ').nth(1).unwrap_or("").to_owned();
                let (status, body) = if !healthy {
                    ("503 Service Unavailable", "down".to_owned())
                } else if path.starts_with("/api/models?") {
                    ("200 OK", r#"[{"id":"a/Mid-9B-GGUF","downloads":1000,"likes":1,"pipeline_tag":"text-generation","gated":false}]"#.to_owned())
                } else if path.starts_with("/api/models/a/Mid-9B-GGUF/tree") {
                    ("200 OK", tree(&[("Mid-9B-Q4_K_M.gguf", 5 * GIB), ("Mid-9B-Q8_0.gguf", 9 * GIB)]))
                } else {
                    ("404 Not Found", "no".to_owned())
                };
                let _ = write!(stream, "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
            });
        }
    });
    Hub { url, stop, thread: Some(thread) }
}

// ---- the daemon ------------------------------------------------------------------------------------------------

struct Daemon {
    child: Child,
    stdin: Option<ChildStdin>,
    lines: mpsc::Receiver<String>,
    notes: VecDeque<Value>,
}
impl Daemon {
    fn start(args: &[String]) -> Daemon {
        let mut child = Command::new(env!("CARGO_BIN_EXE_mobius-cored")).args(args).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().unwrap();
        let stdin = child.stdin.take();
        let stdout = child.stdout.take().unwrap();
        let (sender, lines) = mpsc::channel();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if sender.send(line).is_err() {
                    break;
                }
            }
        });
        Daemon { child, stdin, lines, notes: VecDeque::new() }
    }
    fn call(&mut self, id: u64, method: &str, params: Value) -> Value {
        let stdin = self.stdin.as_mut().unwrap();
        writeln!(stdin, "{}", json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params })).unwrap();
        stdin.flush().unwrap();
        loop {
            let line = self.lines.recv_timeout(Duration::from_secs(30)).expect("a response within 30s");
            let message: Value = serde_json::from_str(&line).unwrap_or_else(|_| panic!("stdout must carry only JSON: {line:?}"));
            if message.get("id") == Some(&json!(id)) {
                return message;
            }
            self.notes.push_back(message);
        }
    }
    fn job_result(&mut self, job: &str) -> Value {
        loop {
            if let Some(i) = self.notes.iter().position(|n| n["method"] == "models.job" && n["params"]["job"] == job) {
                return self.notes.remove(i).unwrap()["params"].clone();
            }
            let line = self.lines.recv_timeout(Duration::from_secs(30)).expect("the job to finish within 30s");
            self.notes.push_back(serde_json::from_str(&line).unwrap());
        }
    }
    fn wait_status(&mut self, id: u64, want: &str) -> Value {
        let deadline = Instant::now() + Duration::from_secs(20);
        loop {
            let status = self.call(id, "models.status", json!({}));
            if status["result"]["runtime"]["state"] == want || Instant::now() > deadline {
                return status;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    }
    fn finish(mut self) {
        drop(self.stdin.take());
        let deadline = Instant::now() + Duration::from_secs(10);
        while self.child.try_wait().unwrap().is_none() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(20));
        }
        self.child.kill().ok();
    }
}

struct Setup {
    dir: PathBuf,
    models: PathBuf,
    state: PathBuf,
}
fn setup(name: &str) -> Setup {
    let dir = std::env::temp_dir().join(format!("mobius-cored-{name}-{}", std::process::id()));
    std::fs::remove_dir_all(&dir).ok();
    let models = dir.join("models");
    let state = dir.join("state");
    std::fs::create_dir_all(&models).unwrap();
    std::fs::create_dir_all(&state).unwrap();
    Setup { dir, models, state }
}
fn args(s: &Setup, hub_url: &str) -> Vec<String> {
    [
        "--hub", hub_url, "--no-default-models", "--models-dir", s.models.to_str().unwrap(), "--state-dir", s.state.to_str().unwrap(), "--llama-server", fake_llama().to_str().unwrap(),
    ]
    .iter()
    .map(|a| (*a).to_owned())
    .collect()
}
fn put_model(s: &Setup, name: &str, bytes: usize) -> String {
    let path = s.models.join(name);
    std::fs::write(&path, vec![0u8; bytes]).unwrap();
    path.to_string_lossy().into_owned()
}
fn reachable(port: u16) -> bool {
    TcpStream::connect_timeout(&format!("127.0.0.1:{port}").parse().unwrap(), Duration::from_millis(300)).is_ok()
}
fn port_of(base_url: &str) -> u16 {
    base_url.rsplit(':').next().unwrap().trim_end_matches("/v1").parse().unwrap()
}

#[test]
fn the_computer_is_described() {
    let s = setup("hw");
    let mut d = Daemon::start(&args(&s, "http://127.0.0.1:1"));
    let hw = d.call(1, "models.hardware", json!({}));
    let r = &hw["result"];
    assert!(r["ram_total"].as_u64().unwrap() > 0);
    assert!(r["vram_total"].is_u64() && r["vram_free"].is_u64());
    d.finish();
}

#[test]
fn models_on_disk_are_listed_with_what_the_computer_can_do_with_them() {
    let s = setup("local");
    put_model(&s, "small-Q4_K_M.gguf", 1000);
    std::fs::write(s.models.join("notes.txt"), "hi").unwrap();
    let mut d = Daemon::start(&args(&s, "http://127.0.0.1:1"));
    let list = d.call(1, "models.local", json!({}));
    let items = list["result"].as_array().unwrap();
    assert_eq!(items.len(), 1, "{list}");
    assert_eq!(items[0]["model"]["file"], "small-Q4_K_M.gguf");
    assert_eq!(items[0]["model"]["quant"], "Q4_K_M");
    assert_eq!(items[0]["model"]["size"], 1000);
    assert!(items[0]["assessment"]["fit"].is_string());
    d.finish();
}

#[test]
fn searching_answers_at_once_and_delivers_the_result_when_it_is_ready() {
    let s = setup("discover");
    let fake = hub(700, true);
    let mut d = Daemon::start(&args(&s, &fake.url));
    let started = Instant::now();
    let job = d.call(1, "models.discover", json!({ "query": "mid" }));
    let id = job["result"]["job"].as_str().unwrap().to_owned();
    assert!(started.elapsed() < Duration::from_millis(600), "the request itself does not wait for Hugging Face");
    assert!(d.call(2, "core.ping", json!({}))["result"]["protocol"].is_number(), "the daemon stays responsive meanwhile");
    let done = d.job_result(&id);
    assert_eq!(done["ok"], true, "{done}");
    let first = &done["result"][0];
    assert_eq!(first["candidate"]["repo"], "a/Mid-9B-GGUF");
    assert!(first["assessment"]["fit"].is_string());
    assert!(first["params_b"].as_f64().unwrap() > 8.0);
    d.finish();
}

#[test]
fn a_failed_search_is_reported_as_a_failed_job() {
    let s = setup("hubdown");
    let fake = hub(0, false);
    let mut d = Daemon::start(&args(&s, &fake.url));
    let job = d.call(1, "models.discover", json!({}));
    let done = d.job_result(job["result"]["job"].as_str().unwrap());
    assert_eq!(done["ok"], false);
    assert!(done["error"].as_str().unwrap().contains("503"), "{done}");
    d.finish();
}

#[test]
fn search_requests_are_checked() {
    let s = setup("checks");
    let mut d = Daemon::start(&args(&s, "http://127.0.0.1:1"));
    for bad in [json!({ "query": 5 }), json!({ "limit": 0 }), json!({ "limit": 500 }), json!({ "evil": 1 }), json!({ "query": "x".repeat(300) })] {
        assert_eq!(d.call(1, "models.discover", bad.clone())["error"]["code"], -32602, "{bad}");
    }
    d.finish();
}

#[test]
fn a_model_is_started_ready_to_talk_to_and_stopped() {
    let s = setup("run");
    let id = put_model(&s, "tiny-Q4_K_M.gguf", 500);
    let mut d = Daemon::start(&args(&s, "http://127.0.0.1:1"));
    let status = d.call(1, "models.status", json!({}));
    assert!(status["result"]["binary"].as_str().unwrap().contains("fake-llama"));
    assert!(status["result"]["runtime"].is_null());

    let started = d.call(2, "models.start", json!({ "id": id }));
    let base = started["result"]["base_url"].as_str().unwrap().to_owned();
    assert!(base.starts_with("http://127.0.0.1:") && base.ends_with("/v1"), "{base}");
    assert_eq!(started["result"]["model"], "tiny-Q4_K_M");
    let ready = d.wait_status(3, "ready");
    assert_eq!(ready["result"]["runtime"]["state"], "ready", "{ready}");
    assert_eq!(ready["result"]["runtime"]["model_id"], json!(id));
    let port = port_of(&base);
    assert!(reachable(port));
    let pid_file = s.state.join("llama.pid");
    assert!(pid_file.is_file(), "the process is written down in case this daemon is killed");

    d.call(4, "models.stop", json!({}));
    assert!(d.call(5, "models.status", json!({}))["result"]["runtime"].is_null());
    std::thread::sleep(Duration::from_millis(300));
    assert!(!reachable(port));
    assert!(!pid_file.exists());
    d.finish();
}

#[test]
fn only_models_from_the_list_can_be_started() {
    let s = setup("refuse");
    put_model(&s, "ok-Q4_K_M.gguf", 100);
    let mut d = Daemon::start(&args(&s, "http://127.0.0.1:1"));
    for bad in ["C:/Windows/System32/notepad.exe", "../../etc/passwd", "", "no-such-model"] {
        let r = d.call(1, "models.start", json!({ "id": bad }));
        assert!(r.get("error").is_some(), "{bad}: {r}");
    }
    let outside = std::env::temp_dir().join(format!("outside-{}-Q4_K_M.gguf", std::process::id()));
    std::fs::write(&outside, b"x").unwrap();
    assert!(d.call(2, "models.start", json!({ "id": outside.to_string_lossy() })).get("error").is_some(), "a real model file elsewhere is still not in the list");
    std::fs::remove_file(outside).ok();
    assert!(d.call(3, "models.status", json!({}))["result"]["runtime"].is_null());
    assert_eq!(d.call(4, "models.start", json!({ "id": "x", "context": 10 }))["error"]["code"], -32602);
    assert_eq!(d.call(5, "models.start", json!({ "id": "x", "gpu": true }))["error"]["code"], -32602, "unknown fields are refused");
    d.finish();
}

#[test]
fn starting_another_model_replaces_the_one_running() {
    let s = setup("replace");
    let a = put_model(&s, "a-Q4_K_M.gguf", 100);
    let b = put_model(&s, "b-Q4_K_M.gguf", 100);
    let mut d = Daemon::start(&args(&s, "http://127.0.0.1:1"));
    let first = port_of(d.call(1, "models.start", json!({ "id": a }))["result"]["base_url"].as_str().unwrap());
    d.wait_status(2, "ready");
    let second = port_of(d.call(3, "models.start", json!({ "id": b }))["result"]["base_url"].as_str().unwrap());
    d.wait_status(4, "ready");
    std::thread::sleep(Duration::from_millis(300));
    assert!(!reachable(first), "the old one was stopped");
    assert!(reachable(second));
    d.finish();
    std::thread::sleep(Duration::from_millis(300));
    assert!(!reachable(second), "and closing the daemon stops the last one");
}

#[test]
fn a_server_that_cannot_load_is_reported_with_the_reason() {
    let s = setup("crash");
    let id = put_model(&s, "bad-Q4_K_M.gguf", 100);
    let mut cmd_args = args(&s, "http://127.0.0.1:1");
    cmd_args.extend(["--llama-env".into(), "FAKE_LLAMA_CRASH=cudaMalloc failed: out of memory".into()]);
    let mut d = Daemon::start(&cmd_args);
    d.call(1, "models.start", json!({ "id": id }));
    let status = d.wait_status(2, "failed");
    assert_eq!(status["result"]["runtime"]["state"], "failed", "{status}");
    assert!(status["result"]["runtime"]["reason"].as_str().unwrap().contains("out of memory"));
    d.finish();
}

#[test]
fn a_server_left_behind_by_a_killed_daemon_is_cleaned_up_by_the_next_one() {
    let s = setup("orphan");
    let id = put_model(&s, "o-Q4_K_M.gguf", 100);
    let mut first = Daemon::start(&args(&s, "http://127.0.0.1:1"));
    let port = port_of(first.call(1, "models.start", json!({ "id": id }))["result"]["base_url"].as_str().unwrap());
    first.wait_status(2, "ready");
    first.child.kill().unwrap();
    first.child.wait().unwrap();
    std::thread::sleep(Duration::from_millis(300));
    assert!(reachable(port), "killing the daemon leaves the server running: that is the problem");
    let mut second = Daemon::start(&args(&s, "http://127.0.0.1:1"));
    second.call(3, "core.ping", json!({}));
    std::thread::sleep(Duration::from_millis(400));
    assert!(!reachable(port), "the new daemon stopped it");
    second.finish();
    let _ = Path::new(&s.dir);
}


// ---- downloads -------------------------------------------------------------------------------------------------

fn sha(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(bytes);
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}
/// A Hugging Face with one small model, served slowly if asked.
fn small_hub(bytes: Vec<u8>, pause_ms: u64) -> Hub {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let stop = Arc::new(AtomicBool::new(false));
    let stop2 = stop.clone();
    let thread = std::thread::spawn(move || {
        while !stop2.load(Ordering::SeqCst) {
            let Ok((mut stream, _)) = listener.accept() else {
                std::thread::sleep(Duration::from_millis(5));
                continue;
            };
            let bytes = bytes.clone();
            std::thread::spawn(move || {
                stream.set_nonblocking(false).ok();
                stream.set_read_timeout(Some(Duration::from_secs(5))).ok();
                let mut buf = [0u8; 4096];
                let n = stream.read(&mut buf).unwrap_or(0);
                let head = String::from_utf8_lossy(&buf[..n]).into_owned();
                let path = head.split(' ').nth(1).unwrap_or("").to_owned();
                if path.starts_with("/api/models/org/Tiny-GGUF/tree") {
                    let body = format!(r#"[{{"type":"file","path":"Tiny-Q4_K_M.gguf","size":{},"lfs":{{"oid":"{}","size":{}}}}}]"#, bytes.len(), sha(&bytes), bytes.len());
                    let _ = write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
                } else if path.starts_with("/org/Tiny-GGUF/resolve/main/Tiny-Q4_K_M.gguf") {
                    let _ = write!(stream, "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", bytes.len());
                    for chunk in bytes.chunks(64 * 1024) {
                        if stream.write_all(chunk).is_err() {
                            return;
                        }
                        std::thread::sleep(Duration::from_millis(pause_ms));
                    }
                } else {
                    let _ = write!(stream, "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                }
            });
        }
    });
    Hub { url, stop, thread: Some(thread) }
}
fn payload() -> Vec<u8> {
    (0..400_000usize).map(|i| (i * 7 % 253) as u8).collect()
}

#[test]
fn a_model_can_be_downloaded_with_progress_and_then_appears_in_the_list() {
    let s = setup("download");
    let bytes = payload();
    let fake = small_hub(bytes.clone(), 150);
    let mut a = args(&s, &fake.url);
    a.extend(["--download-dir".into(), s.models.to_str().unwrap().into()]);
    let mut d = Daemon::start(&a);
    let job = d.call(1, "models.download", json!({ "repo": "org/Tiny-GGUF", "file": "Tiny-Q4_K_M.gguf" }));
    let id = job["result"]["job"].as_str().unwrap().to_owned();
    let done = d.job_result(&id);
    assert_eq!(done["ok"], true, "{done}");
    let progress: Vec<&Value> = d.notes.iter().filter(|n| n["method"] == "models.progress").collect();
    assert!(!progress.is_empty(), "progress was reported while it ran");
    assert!(progress.iter().any(|n| n["params"]["total"] == 400_000 && n["params"]["done"].as_u64().unwrap() > 0), "{progress:?}");
    assert!(progress.iter().all(|n| n["params"]["job"] == json!(id)));
    let list = d.call(2, "models.local", json!({}));
    let first = &list["result"][0]["model"];
    assert_eq!(first["repo"], "org/Tiny-GGUF", "{list}");
    assert_eq!(first["size"], 400_000);
    assert_eq!(std::fs::read(first["path"].as_str().unwrap()).unwrap(), bytes);
    d.finish();
}

#[test]
fn only_one_download_runs_at_a_time_and_it_can_be_cancelled() {
    let s = setup("cancel-dl");
    let fake = small_hub(payload(), 200);
    let mut a = args(&s, &fake.url);
    a.extend(["--download-dir".into(), s.models.to_str().unwrap().into()]);
    let mut d = Daemon::start(&a);
    let job = d.call(1, "models.download", json!({ "repo": "org/Tiny-GGUF", "file": "Tiny-Q4_K_M.gguf" }));
    let id = job["result"]["job"].as_str().unwrap().to_owned();
    let second = d.call(2, "models.download", json!({ "repo": "org/Tiny-GGUF", "file": "Tiny-Q4_K_M.gguf" }));
    assert_eq!(second["error"]["data"]["kind"], "busy", "{second}");
    assert_eq!(d.call(3, "models.cancel", json!({ "job": "no-such-job" }))["error"]["data"]["kind"], "no_job");
    d.call(4, "models.cancel", json!({ "job": id }));
    let done = d.job_result(&id);
    assert_eq!(done["ok"], false);
    assert!(done["error"].as_str().unwrap().contains("cancelled"), "{done}");
    assert!(d.call(5, "models.local", json!({}))["result"].as_array().unwrap().is_empty(), "a cancelled download is not a model");
    let again = d.call(6, "models.download", json!({ "repo": "org/Tiny-GGUF", "file": "Tiny-Q4_K_M.gguf" }));
    assert!(again.get("result").is_some(), "a new download can start after the old one ended: {again}");
    d.finish();
}

#[test]
fn download_requests_are_checked() {
    let s = setup("dl-checks");
    let mut a = args(&s, "http://127.0.0.1:1");
    a.extend(["--download-dir".into(), s.models.to_str().unwrap().into()]);
    let mut d = Daemon::start(&a);
    for bad in [
        json!({ "repo": "../x/y", "file": "a.gguf" }),
        json!({ "repo": "org/m", "file": "../a.gguf" }),
        json!({ "repo": "org/m", "file": "evil.exe" }),
        json!({ "repo": "org/m" }),
        json!({ "repo": "org/m", "file": "a.gguf", "to": "C:/x" }),
    ] {
        assert_eq!(d.call(1, "models.download", bad.clone())["error"]["code"], -32602, "{bad}");
    }
    d.finish();
}

#[test]
fn a_download_of_a_file_the_repository_does_not_have_fails_as_a_job() {
    let s = setup("dl-missing");
    let fake = small_hub(payload(), 0);
    let mut a = args(&s, &fake.url);
    a.extend(["--download-dir".into(), s.models.to_str().unwrap().into()]);
    let mut d = Daemon::start(&a);
    let job = d.call(1, "models.download", json!({ "repo": "org/Tiny-GGUF", "file": "Other-Q4_K_M.gguf" }));
    let done = d.job_result(job["result"]["job"].as_str().unwrap());
    assert_eq!(done["ok"], false);
    assert!(done["error"].as_str().unwrap().contains("not in"), "{done}");
    d.finish();
}
