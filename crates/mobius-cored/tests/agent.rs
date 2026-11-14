#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
//! The real daemon with a conversation: a fake model server on one side, JSON-RPC on stdin/stdout on the other.
use std::collections::VecDeque;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, mpsc};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use serde_json::{Value, json};

// ---- a fake model server ---------------------------------------------------------------------------------------

struct Fake {
    addr: SocketAddr,
    bodies: Arc<Mutex<Vec<Value>>>,
    heads: Arc<Mutex<Vec<String>>>,
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}
impl Drop for Fake {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(t) = self.thread.take() {
            t.join().ok();
        }
    }
}
impl Fake {
    fn url(&self) -> String {
        format!("http://{}/v1", self.addr)
    }
}

/// Each reply is a list of (SSE data JSON, pause in ms after sending it).
fn fake(replies: Vec<Vec<(Value, u64)>>) -> Fake {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let addr = listener.local_addr().unwrap();
    let bodies = Arc::new(Mutex::new(Vec::new()));
    let heads = Arc::new(Mutex::new(Vec::new()));
    let stop = Arc::new(AtomicBool::new(false));
    let (bodies2, heads2, stop2) = (bodies.clone(), heads.clone(), stop.clone());
    let thread = std::thread::spawn(move || {
        let mut replies = replies.into_iter();
        while !stop2.load(Ordering::SeqCst) {
            let Ok((mut stream, _)) = listener.accept() else {
                std::thread::sleep(Duration::from_millis(5));
                continue;
            };
            stream.set_nonblocking(false).unwrap();
            stream.set_read_timeout(Some(Duration::from_secs(5))).ok();
            let Some((head, body)) = read_request(&mut stream) else { continue };
            heads2.lock().unwrap().push(head);
            bodies2.lock().unwrap().push(serde_json::from_str(&body).unwrap_or(Value::Null));
            let Some(events) = replies.next() else { continue };
            stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n").ok();
            for (event, pause) in events {
                if stream.write_all(format!("data: {event}\n\n").as_bytes()).and_then(|()| stream.flush()).is_err() {
                    break;
                }
                std::thread::sleep(Duration::from_millis(pause));
            }
            stream.write_all(b"data: [DONE]\n\n").ok();
        }
    });
    Fake { addr, bodies, heads, stop, thread: Some(thread) }
}

/// The request's head (lower-cased) and body.
fn read_request(stream: &mut TcpStream) -> Option<(String, String)> {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 4096];
    let end = loop {
        let n = stream.read(&mut chunk).ok()?;
        if n == 0 {
            return None;
        }
        buf.extend_from_slice(&chunk[..n]);
        if let Some(p) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break p + 4;
        }
    };
    let head = String::from_utf8_lossy(&buf[..end]).to_lowercase();
    let length: usize = head.lines().find_map(|l| l.strip_prefix("content-length:")).and_then(|v| v.trim().parse().ok()).unwrap_or(0);
    while buf.len() < end + length {
        let n = stream.read(&mut chunk).ok()?;
        if n == 0 {
            break;
        }
        buf.extend_from_slice(&chunk[..n]);
    }
    Some((head, String::from_utf8_lossy(&buf[end..]).into_owned()))
}

fn delta(d: Value) -> Value {
    json!({ "choices": [{ "index": 0, "delta": d }] })
}
fn stop() -> Value {
    json!({ "choices": [{ "index": 0, "delta": {}, "finish_reason": "stop" }] })
}
fn says(parts: &[&str], pause: u64) -> Vec<(Value, u64)> {
    let mut events: Vec<(Value, u64)> = parts.iter().map(|p| (delta(json!({ "content": p })), pause)).collect();
    events.push((stop(), 0));
    events
}
fn calls(name_on_wire: &str, args: &str) -> Vec<(Value, u64)> {
    vec![
        (delta(json!({ "tool_calls": [{ "index": 0, "id": "call_1", "function": { "name": name_on_wire, "arguments": args } }] })), 0),
        (json!({ "choices": [{ "index": 0, "delta": {}, "finish_reason": "tool_calls" }] }), 0),
    ]
}

// ---- the daemon ------------------------------------------------------------------------------------------------

struct Daemon {
    child: Child,
    stdin: Option<ChildStdin>,
    lines: mpsc::Receiver<String>,
    notes: VecDeque<Value>,
}

impl Daemon {
    fn start(args: &[&str]) -> Daemon {
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

    fn send(&mut self, id: u64, method: &str, params: Value) {
        let stdin = self.stdin.as_mut().unwrap();
        writeln!(stdin, "{}", json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params })).unwrap();
        stdin.flush().unwrap();
    }

    fn next_line(&mut self, timeout: Duration) -> Option<Value> {
        let line = self.lines.recv_timeout(timeout).ok()?;
        Some(serde_json::from_str(&line).unwrap_or_else(|_| panic!("stdout must carry only JSON: {line:?}")))
    }

    /// Wait for the response to `id`; notifications that arrive first are kept.
    fn call(&mut self, id: u64, method: &str, params: Value) -> Value {
        self.send(id, method, params);
        loop {
            let message = self.next_line(Duration::from_secs(20)).expect("a response within 20s");
            if message.get("id") == Some(&json!(id)) {
                return message;
            }
            assert!(message.get("method").is_some(), "unexpected: {message}");
            self.notes.push_back(message);
        }
    }

    /// The next notification, in order.
    fn note(&mut self) -> Value {
        if let Some(n) = self.notes.pop_front() {
            return n;
        }
        let n = self.next_line(Duration::from_secs(20)).expect("a notification within 20s");
        assert!(n.get("id").is_none(), "expected a notification, got {n}");
        n
    }

    /// Skip ahead to the next `agent.event` of this kind; everything skipped is returned too.
    fn until_event(&mut self, kind: &str) -> (Vec<Value>, Value) {
        let mut skipped = Vec::new();
        loop {
            let n = self.note();
            if n["method"] == "agent.event" && n["params"]["event"]["kind"] == kind {
                return (skipped, n);
            }
            skipped.push(n);
        }
    }

    /// Play the application: wait for the daemon to ask it to run a tool. Other messages that arrive first are kept.
    fn take_host_request(&mut self) -> Value {
        if let Some(i) = self.notes.iter().position(|n| n["method"] == "host.tool") {
            return self.notes.remove(i).unwrap();
        }
        loop {
            let message = self.next_line(Duration::from_secs(20)).expect("a request for the application within 20s");
            if message["method"] == "host.tool" {
                return message;
            }
            self.notes.push_back(message);
        }
    }

    fn reply_raw(&mut self, message: Value) {
        let stdin = self.stdin.as_mut().unwrap();
        writeln!(stdin, "{message}").unwrap();
        stdin.flush().unwrap();
    }

    fn close_and_wait(&mut self) -> std::process::ExitStatus {
        self.stdin = None;
        for _ in 0..300 {
            if let Some(s) = self.child.try_wait().unwrap() {
                return s;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        self.child.kill().ok();
        panic!("the daemon did not exit after its input closed");
    }
}
impl Drop for Daemon {
    fn drop(&mut self) {
        self.child.kill().ok();
        self.child.wait().ok();
    }
}

fn configure(d: &mut Daemon, fake: &Fake) {
    let r = d.call(1, "agent.configure", json!({ "base_url": fake.url(), "model": "fake-model" }));
    assert_eq!(r["result"], json!({}), "{r}");
}

// ---- tests -----------------------------------------------------------------------------------------------------

#[test]
fn the_clock_tool_is_always_there_and_needs_approval_like_any_other_tool() {
    let mut d = Daemon::start(&[]);
    let tools = d.call(1, "tools.list", json!({}));
    assert!(tools["result"].as_array().unwrap().iter().any(|t| t["name"] == "clock.now"));
    let agent = json!({ "kind": "agent", "id": "x" });
    let first = d.call(2, "tools.invoke", json!({ "principal": agent, "tool": "clock.now" }));
    assert_eq!(first["result"]["status"], "needs_approval");
    let person = json!({ "kind": "person", "id": "me" });
    let r = d.call(3, "tools.invoke", json!({ "principal": person, "tool": "clock.now" }));
    let now = r["result"]["result"]["utc"].as_str().unwrap();
    assert!(now.starts_with("20") && now.ends_with('Z') && now.len() == 20, "{now}");
}

#[test]
fn sending_before_setup_is_a_clear_error() {
    let mut d = Daemon::start(&[]);
    let r = d.call(1, "agent.send", json!({ "conversation": "c1", "text": "hi" }));
    assert_eq!(r["error"]["data"]["kind"], "not_configured", "{r}");
    assert_eq!(d.call(2, "agent.status", json!({}))["result"]["configured"], false);
}

#[test]
fn a_bad_setup_is_refused_and_a_key_never_comes_back() {
    let mut d = Daemon::start(&[]);
    let r = d.call(1, "agent.configure", json!({ "base_url": "http://example.com/v1", "api_key": "sk-secret-123", "model": "m" }));
    assert_eq!(r["error"]["code"], -32602);
    assert!(!r.to_string().contains("sk-secret-123"));
    for bad in [json!({ "base_url": "https://x.example/v1" }), json!({ "base_url": "https://x.example/v1", "model": "" }), json!({ "model": "m" }), json!({ "base_url": "https://x.example/v1", "model": "m", "extra": 1 })] {
        assert_eq!(d.call(2, "agent.configure", bad)["error"]["code"], -32602);
    }
    let ok = d.call(3, "agent.configure", json!({ "base_url": "https://api.example.com/v1", "api_key": "sk-secret-123", "model": "m" }));
    assert!(!ok.to_string().contains("sk-secret-123"));
    let status = d.call(4, "agent.status", json!({}));
    assert_eq!(status["result"], json!({ "configured": true, "model": "m", "max_steps": 25, "fallback_model": null, "quick_model": null, "context_tokens": null }));
}

#[test]
fn a_reply_streams_and_arrives_after_the_response_that_started_it() {
    let server = fake(vec![says(&["Hel", "lo ", "there"], 40)]);
    let mut d = Daemon::start(&[]);
    configure(&mut d, &server);
    let sent = d.call(2, "agent.send", json!({ "conversation": "c1", "text": "hi" }));
    let turn = sent["result"]["turn"].as_u64().unwrap();
    assert!(d.notes.is_empty(), "the response comes before any notification about the turn");
    let (before_message, message) = d.until_event("message");
    let deltas: Vec<&str> = before_message.iter().filter(|n| n["method"] == "agent.delta").map(|n| n["params"]["text"].as_str().unwrap()).collect();
    assert_eq!(deltas, ["Hel", "lo ", "there"]);
    assert!(before_message.iter().all(|n| n["params"]["conversation"] == "c1" && n["params"]["turn"] == turn));
    assert_eq!(message["params"]["event"]["text"], "Hello there");
    d.until_event("done");
    let history = d.call(3, "agent.history", json!({ "conversation": "c1" }));
    assert!(history["result"][0]["at_ms"].as_u64().is_some_and(|t| t > 1_700_000_000_000), "{history}");
    assert_eq!(history["result"][0]["text"], "hi");
    assert_eq!(history["result"][1]["text"], "Hello there");
    let body = &server.bodies.lock().unwrap()[0];
    assert_eq!(body["model"], "fake-model");
    assert_eq!(body["messages"][0]["role"], "system", "a default system prompt is used when none is given");
    assert!(body["messages"][0]["content"].as_str().unwrap().contains("untrusted"), "the default prompt warns that text from the web is not to be obeyed");
}

#[test]
fn the_daemon_keeps_answering_while_the_model_is_slow() {
    let server = fake(vec![says(&["a", "b", "c", "d", "e"], 300)]);
    let mut d = Daemon::start(&[]);
    configure(&mut d, &server);
    d.call(2, "agent.send", json!({ "conversation": "c1", "text": "slow" }));
    let started = Instant::now();
    let ping = d.call(3, "core.ping", json!({}));
    assert_eq!(ping["result"]["protocol"], 1);
    assert!(started.elapsed() < Duration::from_millis(900), "ping took {:?} while a reply was streaming", started.elapsed());
    d.until_event("done");
}

#[test]
fn a_tool_call_waits_for_a_person_and_the_whole_flow_works_through_the_real_pipe() {
    let server = fake(vec![calls("demo-echo", "{\"text\":\"hi\"}"), says(&["It echoed."], 0)]);
    let mut d = Daemon::start(&["--demo-tools"]);
    configure(&mut d, &server);
    d.call(2, "agent.send", json!({ "conversation": "c1", "text": "echo hi" }));
    let (_, asked) = d.until_event("needs_approval");
    let event = &asked["params"]["event"];
    assert_eq!((event["tool"].as_str(), &event["arguments"]), (Some("demo.echo"), &json!({ "text": "hi" })));
    let request_id = event["request_id"].as_u64().unwrap();
    assert_eq!(server.bodies.lock().unwrap().len(), 1, "the model is not called again until a person answers");
    let waiting = d.call(9, "agent.waiting", json!({ "conversation": "c1" }));
    assert_eq!(waiting["result"], json!([{ "request_id": request_id, "call_id": "call_1", "tool": "demo.echo", "arguments": { "text": "hi" }, "once_only": false }]));
    let history = d.call(10, "agent.history", json!({ "conversation": "c1" }));
    assert!(history["result"][0]["at_ms"].as_u64().is_some_and(|t| t > 1_700_000_000_000), "{history}");
    assert_eq!(history["result"][0]["text"], "echo hi");
    assert_eq!(history["result"][1]["tool_calls"][0]["name"], "demo.echo", "a turn in progress can be reloaded");
    assert_eq!(d.call(3, "permissions.pending", json!({}))["result"].as_array().unwrap().len(), 1);

    let resolved = d.call(4, "permissions.resolve", json!({ "request_id": request_id, "approve": true, "duration": "once" }));
    assert_eq!(resolved["result"], json!({}));
    let (skipped, _) = d.until_event("done");
    assert!(skipped.iter().any(|n| n["params"]["event"]["kind"] == "tool_result" && n["params"]["event"]["is_error"] == false));
    let second = server.bodies.lock().unwrap()[1].clone();
    let tool_message = second["messages"].as_array().unwrap().iter().find(|m| m["role"] == "tool").expect("the result went back to the model");
    assert!(tool_message["content"].as_str().unwrap().contains("hi"));
}

#[test]
fn cancelling_stops_a_reply_in_progress() {
    let server = fake(vec![says(&["one ", "two ", "three ", "four ", "five"], 400)]);
    let mut d = Daemon::start(&[]);
    configure(&mut d, &server);
    d.call(2, "agent.send", json!({ "conversation": "c1", "text": "long" }));
    loop {
        let n = d.note();
        if n["method"] == "agent.delta" {
            break;
        }
    }
    let started = Instant::now();
    d.call(3, "agent.cancel", json!({ "conversation": "c1" }));
    assert!(!d.notes.iter().any(|n| n["params"]["event"]["kind"] == "cancelled"), "the response to a cancel comes before the news that it happened");
    d.until_event("cancelled");
    assert!(started.elapsed() < Duration::from_secs(1));
    let again = d.call(4, "agent.send", json!({ "conversation": "c1", "text": "again" }));
    assert!(again.get("result").is_some(), "the conversation is free again: {again}");
}

#[test]
fn a_server_error_becomes_a_failed_turn_not_a_hang() {
    let mut d = Daemon::start(&[]);
    let dead = TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap();
    d.call(1, "agent.configure", json!({ "base_url": format!("http://{dead}/v1"), "model": "m" }));
    d.call(2, "agent.send", json!({ "conversation": "c1", "text": "hi" }));
    let (_, failed) = d.until_event("failed");
    assert!(failed["params"]["event"]["message"].as_str().unwrap().contains("cannot reach"));
}

#[test]
fn a_second_message_while_busy_is_refused() {
    let server = fake(vec![says(&["a", "b", "c"], 300)]);
    let mut d = Daemon::start(&[]);
    configure(&mut d, &server);
    d.call(2, "agent.send", json!({ "conversation": "c1", "text": "first" }));
    let r = d.call(3, "agent.send", json!({ "conversation": "c1", "text": "second" }));
    assert_eq!(r["error"]["data"]["kind"], "busy");
    assert_eq!(d.call(4, "agent.send", json!({ "conversation": "../x", "text": "hi" }))["error"]["data"]["kind"], "invalid_conversation");
    assert_eq!(d.call(5, "agent.send", json!({ "conversation": "c2", "text": "  " }))["error"]["data"]["kind"], "empty");
}

#[test]
fn the_daemon_leaves_when_its_input_closes_even_mid_reply() {
    let server = fake(vec![says(&["a", "b", "c", "d", "e", "f"], 500)]);
    let mut d = Daemon::start(&[]);
    configure(&mut d, &server);
    d.call(2, "agent.send", json!({ "conversation": "c1", "text": "slow" }));
    let started = Instant::now();
    assert!(d.close_and_wait().success());
    assert!(started.elapsed() < Duration::from_secs(3), "{:?}", started.elapsed());
}

fn register_browser_open(d: &mut Daemon) {
    let r = d.call(
        50,
        "tools.register_external",
        json!({ "name": "browser.open", "description": "Open a page", "capability": "browser.navigate", "resource_arg": "url", "resource_origin": true,
                "input_schema": { "type": "object", "properties": { "url": { "type": "string" } }, "required": ["url"] } }),
    );
    assert_eq!(r["result"], json!({}), "{r}");
}

fn approve_next(d: &mut Daemon, duration: &str) {
    let (_, asked) = d.until_event("needs_approval");
    let request_id = asked["params"]["event"]["request_id"].as_u64().unwrap();
    d.call(51, "permissions.resolve", json!({ "request_id": request_id, "approve": true, "duration": duration }));
}

#[test]
fn a_tool_the_application_runs_is_sent_out_after_approval_and_its_answer_goes_back_to_the_model() {
    let server = fake(vec![calls("browser-open", "{\"url\":\"https://example.com/page\"}"), says(&["Opened it."], 0)]);
    let mut d = Daemon::start(&[]);
    configure(&mut d, &server);
    register_browser_open(&mut d);
    d.call(2, "agent.send", json!({ "conversation": "c1", "text": "open example" }));
    let (_, asked) = d.until_event("needs_approval");
    assert_eq!(d.call(60, "permissions.pending", json!({}))["result"][0]["resource"], "https://example.com", "the question is about the site, not the page");
    d.call(3, "permissions.resolve", json!({ "request_id": asked["params"]["event"]["request_id"], "approve": true, "duration": "once" }));

    let request = d.take_host_request();
    assert_eq!(request["jsonrpc"], "2.0");
    assert!(request["id"].is_string());
    assert_eq!(request["params"], json!({ "call_id": "call_1", "tool": "browser.open", "arguments": { "url": "https://example.com/page" }, "conversation": "c1" }), "the conversation goes too, for sign-ins per task");
    assert_eq!(server.bodies.lock().unwrap().len(), 1, "the model waits for the application");

    d.reply_raw(json!({ "jsonrpc": "2.0", "id": request["id"], "result": "{\"tabId\":\"tab-2\"}" }));
    d.until_event("done");
    let second = server.bodies.lock().unwrap()[1].clone();
    let tool = second["messages"].as_array().unwrap().iter().find(|m| m["role"] == "tool").unwrap().clone();
    let content = tool["content"].as_str().unwrap();
    assert!(content.starts_with("<<untrusted-data source=\"") && content.contains("\n{\"tabId\":\"tab-2\"}\n"), "read content goes to the model as data: {content}");
    let kinds: Vec<String> = d.call(4, "events.list", json!({ "limit": 100 }))["result"].as_array().unwrap().iter().map(|e| e["kind"].as_str().unwrap().to_owned()).collect();
    assert!(kinds.contains(&"tool.completed".to_owned()));
}

#[test]
fn an_error_from_the_application_reaches_the_model_as_an_error() {
    let server = fake(vec![calls("browser-open", "{\"url\":\"https://example.com/\"}"), says(&["It failed."], 0)]);
    let mut d = Daemon::start(&[]);
    configure(&mut d, &server);
    register_browser_open(&mut d);
    d.call(2, "agent.send", json!({ "conversation": "c1", "text": "open" }));
    approve_next(&mut d, "once");
    let request = d.take_host_request();
    d.reply_raw(json!({ "jsonrpc": "2.0", "id": request["id"], "error": { "code": -32000, "message": "the page did not load" } }));
    let (skipped, _) = d.until_event("done");
    assert!(skipped.iter().any(|n| n["params"]["event"]["kind"] == "tool_result" && n["params"]["event"]["is_error"] == true));
    let second = server.bodies.lock().unwrap()[1].clone();
    let tool = second["messages"].as_array().unwrap().iter().find(|m| m["role"] == "tool").unwrap().clone();
    let content = tool["content"].as_str().unwrap();
    assert!(content.starts_with("error: <<untrusted-data") && content.contains("the page did not load"), "{content}");
}

#[test]
fn a_site_that_was_allowed_always_is_opened_without_asking_again() {
    let server = fake(vec![calls("browser-open", "{\"url\":\"https://example.com/a\"}"), says(&["one"], 0), calls("browser-open", "{\"url\":\"https://example.com/b\"}"), says(&["two"], 0)]);
    let mut d = Daemon::start(&[]);
    configure(&mut d, &server);
    register_browser_open(&mut d);
    d.call(2, "agent.send", json!({ "conversation": "c1", "text": "first" }));
    approve_next(&mut d, "always");
    let r = d.take_host_request();
    d.reply_raw(json!({ "jsonrpc": "2.0", "id": r["id"], "result": "ok" }));
    d.until_event("done");
    d.call(3, "agent.send", json!({ "conversation": "c1", "text": "second" }));
    let r = d.take_host_request();
    assert_eq!(r["params"]["arguments"]["url"], "https://example.com/b");
    d.reply_raw(json!({ "jsonrpc": "2.0", "id": r["id"], "result": "ok" }));
    let (skipped, _) = d.until_event("done");
    assert!(!skipped.iter().any(|n| n["params"]["event"]["kind"] == "needs_approval"));
}

#[test]
fn answers_that_nobody_asked_for_are_ignored_quietly() {
    let mut d = Daemon::start(&[]);
    d.reply_raw(json!({ "jsonrpc": "2.0", "id": "t999", "result": "stray" }));
    d.reply_raw(json!({ "jsonrpc": "2.0", "id": 5, "result": "stray" }));
    d.reply_raw(json!({ "jsonrpc": "2.0", "id": "t1", "error": { "code": 1, "message": "stray" } }));
    let ping = d.call(1, "core.ping", json!({}));
    assert_eq!(ping["result"]["protocol"], 1, "and nothing else was written in reply to them");
    assert!(d.notes.is_empty());
}

#[test]
fn stopping_while_the_application_is_busy_ends_the_turn_and_its_late_answer_changes_nothing() {
    let server = fake(vec![calls("browser-open", "{\"url\":\"https://example.com/\"}")]);
    let mut d = Daemon::start(&[]);
    configure(&mut d, &server);
    register_browser_open(&mut d);
    d.call(2, "agent.send", json!({ "conversation": "c1", "text": "open" }));
    approve_next(&mut d, "once");
    let request = d.take_host_request();
    d.call(3, "agent.cancel", json!({ "conversation": "c1" }));
    d.until_event("cancelled");
    d.reply_raw(json!({ "jsonrpc": "2.0", "id": request["id"], "result": "late" }));
    let history = d.call(4, "agent.history", json!({ "conversation": "c1" }));
    let tool = history["result"].as_array().unwrap().iter().find(|m| m["role"] == "tool").unwrap().clone();
    assert_eq!((tool["content"].as_str(), tool["is_error"].as_bool()), (Some("cancelled"), Some(true)));
    assert_eq!(server.bodies.lock().unwrap().len(), 1);
}

#[test]
fn the_daemon_leaves_when_its_input_closes_while_the_application_is_busy() {
    let server = fake(vec![calls("browser-open", "{\"url\":\"https://example.com/\"}")]);
    let mut d = Daemon::start(&[]);
    configure(&mut d, &server);
    register_browser_open(&mut d);
    d.call(2, "agent.send", json!({ "conversation": "c1", "text": "open" }));
    approve_next(&mut d, "once");
    d.take_host_request();
    assert!(d.close_and_wait().success());
}

fn temp_dir(label: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("mobius-cored-{label}-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn conversations_are_kept_across_restarts_listed_and_deletable() {
    let dir = temp_dir("keep");
    let path = dir.join("conversations.db");
    let path = path.to_str().unwrap();
    {
        let server = fake(vec![says(&["Sure."], 0)]);
        let mut d = Daemon::start(&["--conversations", path]);
        configure(&mut d, &server);
        d.call(2, "agent.send", json!({ "conversation": "trip", "text": "Plan a trip to Lisbon" }));
        d.until_event("done");
        let list = d.call(3, "agent.conversations", json!({}));
        assert_eq!(list["result"][0]["id"], "trip");
        assert_eq!(list["result"][0]["title"], "Plan a trip to Lisbon");
        assert_eq!(list["result"][0]["messages"], 2);
        assert!(d.close_and_wait().success());
    }
    {
        let server = fake(vec![says(&["Again."], 0)]);
        let mut d = Daemon::start(&["--conversations", path]);
        let history = d.call(1, "agent.history", json!({ "conversation": "trip" }));
        assert!(history["result"][0]["at_ms"].as_u64().is_some_and(|t| t > 1_700_000_000_000), "{history}");
    assert_eq!(history["result"][0]["text"], "Plan a trip to Lisbon", "the conversation is there before any model is set up");
        assert_eq!(d.call(2, "agent.conversations", json!({}))["result"][0]["id"], "trip");
        configure(&mut d, &server);
        d.call(3, "agent.send", json!({ "conversation": "trip", "text": "and hotels?" }));
        d.until_event("done");
        let sent = server.bodies.lock().unwrap()[0].clone();
        assert_eq!(sent["messages"].as_array().unwrap().len(), 4, "system, the old exchange, and the new question");
        assert_eq!(d.call(4, "agent.delete", json!({ "conversation": "trip" }))["result"], json!({}));
        assert_eq!(d.call(5, "agent.conversations", json!({}))["result"], json!([]));
        assert!(d.close_and_wait().success());
    }
    let mut d = Daemon::start(&["--conversations", path]);
    assert_eq!(d.call(1, "agent.conversations", json!({}))["result"], json!([]), "deleting is permanent");
    drop(d);
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn deleting_a_busy_or_invalid_conversation_is_refused() {
    let server = fake(vec![says(&["a", "b", "c"], 300)]);
    let mut d = Daemon::start(&[]);
    configure(&mut d, &server);
    d.call(2, "agent.send", json!({ "conversation": "c1", "text": "working" }));
    assert_eq!(d.call(3, "agent.delete", json!({ "conversation": "c1" }))["error"]["data"]["kind"], "busy");
    assert_eq!(d.call(4, "agent.delete", json!({ "conversation": "../x" }))["error"]["data"]["kind"], "invalid_conversation");
    assert_eq!(d.call(5, "agent.delete", json!({}))["error"]["code"], -32602);
    d.until_event("done");
}

#[test]
fn a_storage_file_this_build_cannot_use_does_not_stop_the_daemon_or_get_overwritten() {
    let dir = temp_dir("newer");
    let path = dir.join("conversations.db");
    {
        let conn = rusqlite_free_create(&path);
        drop(conn);
    }
    let mut d = Daemon::start(&["--conversations", path.to_str().unwrap()]);
    assert_eq!(d.call(1, "core.ping", json!({}))["result"]["protocol"], 1);
    assert_eq!(d.call(2, "agent.conversations", json!({}))["result"], json!([]), "it carries on without saving");
    drop(d);
    let bytes = std::fs::read(&path).unwrap();
    assert!(bytes.starts_with(b"SQLite format 3"), "the file was left alone");
    std::fs::remove_dir_all(&dir).ok();
}

/// A database file marked as a newer version than this build understands, made without a SQLite library.
fn rusqlite_free_create(path: &std::path::Path) -> Vec<u8> {
    // The header's user_version lives at byte offset 60 of a SQLite file. Take a minimal valid empty database and set it.
    let mut page = vec![0u8; 4096];
    page[..16].copy_from_slice(b"SQLite format 3\0");
    page[16..18].copy_from_slice(&4096u16.to_be_bytes());
    page[18] = 1;
    page[19] = 1;
    page[21] = 64;
    page[22] = 32;
    page[23] = 32;
    page[24..28].copy_from_slice(&1u32.to_be_bytes());
    page[28..32].copy_from_slice(&1u32.to_be_bytes());
    page[44..48].copy_from_slice(&4u32.to_be_bytes());
    page[56..60].copy_from_slice(&1u32.to_be_bytes());
    page[60..64].copy_from_slice(&99u32.to_be_bytes());
    page[100] = 0x0d;
    page[105..107].copy_from_slice(&4096u16.to_be_bytes());
    std::fs::write(path, &page).unwrap();
    page
}

#[test]
fn the_step_limit_is_checked_reported_and_obeyed() {
    let server = fake(vec![calls("demo-echo", "{}")]);
    let mut d = Daemon::start(&["--demo-tools"]);
    for bad in [json!(0), json!(101), json!(-1), json!(1.5), json!("5"), json!(null)] {
        let r = d.call(1, "agent.configure", json!({ "base_url": server.url(), "model": "m", "max_steps": bad }));
        if bad.is_null() { assert!(r.get("result").is_some(), "null means the default"); } else { assert_eq!(r["error"]["code"], -32602, "{bad}"); }
    }
    let ok = d.call(2, "agent.configure", json!({ "base_url": server.url(), "model": "m", "max_steps": 1 }));
    assert_eq!(ok["result"], json!({}));
    assert_eq!(d.call(3, "agent.status", json!({}))["result"]["max_steps"], 1);
    let person = json!({ "kind": "agent", "id": "mobius-agent" });
    let asked = d.call(4, "tools.invoke", json!({ "principal": person, "tool": "demo.echo" }));
    d.call(5, "permissions.resolve", json!({ "request_id": asked["result"]["request_id"], "approve": true, "duration": "always" }));
    d.call(6, "agent.send", json!({ "conversation": "c1", "text": "go" }));
    let (_, failed) = d.until_event("failed");
    assert!(failed["params"]["event"]["message"].as_str().unwrap().contains("too many steps"), "{failed}");
}

#[test]
fn the_last_exchange_can_be_taken_back_through_the_pipe() {
    let server = fake(vec![says(&["first"], 0), says(&["second"], 0)]);
    let mut d = Daemon::start(&[]);
    d.call(1, "agent.configure", json!({ "base_url": server.url(), "model": "m" }));
    d.call(2, "agent.send", json!({ "conversation": "c1", "text": "one" }));
    d.until_event("done");
    d.call(3, "agent.send", json!({ "conversation": "c1", "text": "two" }));
    d.until_event("done");
    let back = d.call(4, "agent.rewind", json!({ "conversation": "c1" }));
    assert_eq!(back["result"], json!({ "text": "two" }));
    assert_eq!(d.call(5, "agent.history", json!({ "conversation": "c1" }))["result"].as_array().unwrap().len(), 2);
    assert_eq!(d.call(6, "agent.rewind", json!({ "conversation": "nope" }))["error"]["data"]["kind"], "nothing_to_rewind");
}

#[test]
fn a_second_model_takes_over_when_the_first_cannot_answer_and_the_person_is_told() {
    // A server with no replies closes every connection without answering.
    let broken = fake(vec![]);
    let backup = fake(vec![says(&["from the ", "backup"], 0)]);
    let mut d = Daemon::start(&[]);
    let configured = d.call(1, "agent.configure", json!({ "base_url": broken.url(), "model": "first", "fallback": { "base_url": backup.url(), "model": "second" } }));
    assert!(configured.get("error").is_none(), "{configured}");
    assert_eq!(d.call(2, "agent.status", json!({}))["result"]["fallback_model"], "second");
    d.call(3, "agent.send", json!({ "conversation": "c1", "text": "hello" }));
    let (skipped, _) = d.until_event("done");
    let notice = skipped.iter().find(|n| n["method"] == "agent.notice").expect("a notice that the second model took over");
    assert_eq!(notice["params"]["kind"], "fallback");
    assert_eq!(notice["params"]["model"], "second");
    assert_eq!(notice["params"]["conversation"], "c1");
    let text: String = skipped.iter().filter(|n| n["method"] == "agent.delta").map(|n| n["params"]["text"].as_str().unwrap().to_owned()).collect();
    assert_eq!(text, "from the backup");
    assert_eq!(backup.bodies.lock().unwrap()[0]["model"], "second");
    assert_eq!(broken.bodies.lock().unwrap()[0]["model"], "first");
    let history = d.call(4, "agent.history", json!({ "conversation": "c1" }));
    assert_eq!(history["result"][1]["text"], "from the backup");
}

#[test]
fn a_working_first_model_never_troubles_the_second() {
    let main = fake(vec![says(&["fine"], 0)]);
    let backup = fake(vec![says(&["should not be used"], 0)]);
    let mut d = Daemon::start(&[]);
    d.call(1, "agent.configure", json!({ "base_url": main.url(), "model": "first", "fallback": { "base_url": backup.url(), "model": "second" } }));
    d.call(2, "agent.send", json!({ "conversation": "c1", "text": "hello" }));
    let (skipped, _) = d.until_event("done");
    assert!(skipped.iter().all(|n| n["method"] != "agent.notice"));
    assert!(backup.bodies.lock().unwrap().is_empty());
}

#[test]
fn a_bad_fallback_is_refused_and_leaving_it_out_clears_it() {
    let main = fake(vec![]);
    let mut d = Daemon::start(&[]);
    for bad in [
        json!({ "base_url": "ftp://x.example/v1", "model": "second" }),
        json!({ "base_url": "http://plain.example.com/v1", "api_key": "k", "model": "second" }),
        json!({ "base_url": "https://x.example/v1", "model": "" }),
        json!({ "base_url": "https://x.example/v1" }),
        json!({ "base_url": "https://x.example/v1", "model": "m", "extra": 1 }),
    ] {
        let r = d.call(1, "agent.configure", json!({ "base_url": main.url(), "model": "first", "fallback": bad }));
        assert_eq!(r["error"]["code"], -32602, "{r}");
    }
    d.call(2, "agent.configure", json!({ "base_url": main.url(), "model": "first", "fallback": { "base_url": "https://x.example/v1", "model": "second" } }));
    assert_eq!(d.call(3, "agent.status", json!({}))["result"]["fallback_model"], "second");
    d.call(4, "agent.configure", json!({ "base_url": main.url(), "model": "first" }));
    assert_eq!(d.call(5, "agent.status", json!({}))["result"]["fallback_model"], Value::Null);
}

#[test]
fn smart_approvals_let_a_reviewer_approve_one_call_through_the_real_pipe_and_leave_nothing_standing() {
    let server = fake(vec![calls("demo-echo", "{\"text\":\"hi\"}"), says(&["APPROVE"], 0), says(&["It echoed."], 0)]);
    let mut d = Daemon::start(&["--demo-tools"]);
    configure(&mut d, &server);
    assert_eq!(d.call(5, "permissions.set_mode", json!({ "mode": "smart" }))["result"], json!({ "mode": "smart" }));
    d.call(2, "agent.send", json!({ "conversation": "c1", "text": "echo hi" }));
    let (skipped, _) = d.until_event("done");
    assert!(!skipped.iter().any(|n| n["params"]["event"]["kind"] == "needs_approval"), "nobody was asked");
    assert!(skipped.iter().any(|n| n["params"]["event"]["kind"] == "tool_result" && n["params"]["event"]["is_error"] == false));
    let bodies = server.bodies.lock().unwrap().clone();
    assert_eq!(bodies.len(), 3, "the model, the reviewer, the model again");
    assert!(bodies[1].get("tools").is_none_or(|t| t.as_array().is_some_and(Vec::is_empty)), "the reviewer is offered no tools");
    let review = bodies[1]["messages"].to_string();
    assert!(review.contains("demo.echo") && review.contains("hi"));
    assert!(!review.contains("echo hi"), "the person's message is not shown to the reviewer");
    let grants = d.call(6, "permissions.grants", json!({}));
    assert!(grants["result"].as_array().unwrap().iter().all(|g| g["duration"] != "always" && g["duration"] != "session"));
}

#[test]
fn the_quick_model_reviews_when_one_is_chosen_and_the_chat_model_does_the_rest() {
    let chat = fake(vec![calls("demo-echo", "{\"text\":\"hi\"}"), says(&["It echoed."], 0)]);
    let quick = fake(vec![says(&["APPROVE"], 0)]);
    let mut d = Daemon::start(&["--demo-tools"]);
    let r = d.call(1, "agent.configure", json!({ "base_url": chat.url(), "model": "chat-model", "quick": { "base_url": quick.url(), "model": "quick-model" } }));
    assert_eq!(r["result"], json!({}), "{r}");
    assert_eq!(d.call(9, "agent.configure", json!({ "base_url": chat.url(), "model": "chat-model", "quick": { "base_url": quick.url(), "model": "" } }))["error"]["code"], -32602);
    d.call(1, "agent.configure", json!({ "base_url": chat.url(), "model": "chat-model", "quick": { "base_url": quick.url(), "model": "quick-model" } }));
    d.call(5, "permissions.set_mode", json!({ "mode": "smart" }));
    d.call(2, "agent.send", json!({ "conversation": "c1", "text": "echo hi" }));
    let (skipped, _) = d.until_event("done");
    assert!(!skipped.iter().any(|n| n["params"]["event"]["kind"] == "needs_approval"), "the quick model approved it");
    let reviewed = quick.bodies.lock().unwrap().clone();
    assert_eq!(reviewed.len(), 1);
    assert_eq!(reviewed[0]["model"], "quick-model");
    let chatted = chat.bodies.lock().unwrap().clone();
    assert_eq!(chatted.len(), 2, "the chat model is not asked to review");
    assert!(chatted.iter().all(|b| b["model"] == "chat-model"));
}

#[test]
fn best_fit_sends_a_short_question_to_the_quick_model_and_the_rest_to_the_chat_model() {
    let chat = fake(vec![says(&["A long answer."], 0)]);
    let quick = fake(vec![says(&["Noon."], 0)]);
    let mut d = Daemon::start(&[]);
    d.call(1, "agent.configure", json!({ "base_url": chat.url(), "model": "chat-model", "quick": { "base_url": quick.url(), "model": "quick-model" } }));
    d.call(2, "agent.send", json!({ "conversation": "c1", "text": "what time is it", "quick": true }));
    d.until_event("done");
    d.call(3, "agent.send", json!({ "conversation": "c1", "text": "plan the whole build week" }));
    d.until_event("done");
    let quicked = quick.bodies.lock().unwrap().clone();
    assert_eq!(quicked.len(), 1, "only the short question went to the quick model");
    assert_eq!(quicked[0]["model"], "quick-model");
    let chatted = chat.bodies.lock().unwrap().clone();
    assert_eq!(chatted.len(), 1);
    assert_eq!(chatted[0]["model"], "chat-model");
}

#[test]
fn a_deny_from_the_reviewer_reaches_the_person_as_a_once_only_question() {
    let server = fake(vec![calls("demo-echo", "{}"), says(&["DENY"], 0), says(&["Done."], 0)]);
    let mut d = Daemon::start(&["--demo-tools"]);
    configure(&mut d, &server);
    d.call(5, "permissions.set_mode", json!({ "mode": "smart" }));
    d.call(2, "agent.send", json!({ "conversation": "c1", "text": "go" }));
    let (_, asked) = d.until_event("needs_approval");
    assert_eq!(asked["params"]["event"]["once_only"], true);
    let request_id = asked["params"]["event"]["request_id"].as_u64().unwrap();
    let always = d.call(3, "permissions.resolve", json!({ "request_id": request_id, "approve": true, "duration": "always" }));
    assert!(always.get("error").is_some(), "{always}");
    let once = d.call(4, "permissions.resolve", json!({ "request_id": request_id, "approve": true, "duration": "once" }));
    assert_eq!(once["result"], json!({}));
    d.until_event("done");
}

#[test]
fn a_reviewer_that_cannot_answer_sends_the_question_to_the_person_unchanged() {
    let server = fake(vec![calls("demo-echo", "{}"), Vec::new(), says(&["Done."], 0)]);
    let mut d = Daemon::start(&["--demo-tools"]);
    configure(&mut d, &server);
    d.call(5, "permissions.set_mode", json!({ "mode": "smart" }));
    d.call(2, "agent.send", json!({ "conversation": "c1", "text": "go" }));
    let (_, asked) = d.until_event("needs_approval");
    assert_eq!(asked["params"]["event"]["once_only"], false);
}

#[test]
fn the_effort_can_be_set_and_goes_to_the_model_and_only_known_values_are_accepted() {
    let server = fake(vec![says(&["a"], 0), says(&["b"], 0), says(&["c"], 0)]);
    let mut d = Daemon::start(&[]);
    configure(&mut d, &server);
    assert!(d.call(5, "agent.set_effort", json!({ "effort": "medium" })).get("error").is_none());
    d.call(2, "agent.send", json!({ "conversation": "c1", "text": "think" }));
    d.until_event("done");
    assert_eq!(server.bodies.lock().unwrap()[0]["reasoning_effort"], "medium");
    for bad in ["extreme", "HIGH", "None", " low", "minimal"] {
        assert!(d.call(6, "agent.set_effort", json!({ "effort": bad })).get("error").is_some(), "{bad}");
    }
    assert!(d.call(7, "agent.set_effort", json!({ "effort": "" })).get("error").is_none());
    d.call(8, "agent.send", json!({ "conversation": "c1", "text": "again" }));
    d.until_event("done");
    assert!(server.bodies.lock().unwrap()[1].get("reasoning_effort").is_none());
    // Off: a model on this computer is told not to think, and no effort name is sent.
    assert!(d.call(9, "agent.set_effort", json!({ "effort": "none" })).get("error").is_none());
    d.call(10, "agent.send", json!({ "conversation": "c1", "text": "quick" }));
    d.until_event("done");
    let off = &server.bodies.lock().unwrap()[2];
    assert_eq!(off["chat_template_kwargs"]["enable_thinking"], false);
    assert!(off.get("reasoning_effort").is_none());
}

#[test]
fn a_conversation_can_be_sent_with_its_own_instructions_and_model_and_bad_ones_are_refused() {
    let server = fake(vec![says(&["a"], 0), says(&["b"], 0)]);
    let mut d = Daemon::start(&[]);
    configure(&mut d, &server);
    let sent = d.call(2, "agent.send", json!({ "conversation": "bot", "text": "hi", "system": "You are the research bot.", "model": "research-model" }));
    assert!(sent.get("error").is_none(), "{sent}");
    d.until_event("done");
    let first = server.bodies.lock().unwrap()[0].clone();
    assert_eq!(first["model"], "research-model");
    let system = first["messages"][0]["content"].as_str().unwrap();
    assert!(system.starts_with("You are Mobius") && system.contains("trust:unsure") && system.contains("never report a change") && system.contains("\n\nYou are the research bot."), "added to the usual instructions, not in place of them: {system}");
    d.call(3, "agent.send", json!({ "conversation": "plain", "text": "hi" }));
    d.until_event("done");
    assert_eq!(server.bodies.lock().unwrap()[1]["model"], "fake-model");
    for bad in [json!({ "model": "" }), json!({ "model": "x".repeat(201) }), json!({ "system": "s".repeat(16_001) })] {
        let mut params = json!({ "conversation": "z", "text": "hi" });
        params.as_object_mut().unwrap().extend(bad.as_object().unwrap().clone());
        assert!(d.call(4, "agent.send", params).get("error").is_some(), "{bad}");
    }
}

#[test]
fn a_long_conversation_is_summarised_through_the_real_pipe_and_the_summary_is_never_shown_as_the_answer() {
    let server = fake(vec![says(&["ok"], 0), says(&["S-U-M"], 0), says(&["final"], 0)]);
    let mut d = Daemon::start(&[]);
    for bad in [100, 20_000_000] {
        let r = d.call(1, "agent.configure", json!({ "base_url": server.url(), "model": "fake-model", "context_tokens": bad }));
        assert_eq!(r["error"]["code"], -32602, "{bad}: {r}");
    }
    let r = d.call(2, "agent.configure", json!({ "base_url": server.url(), "model": "fake-model", "context_tokens": 4096 }));
    assert_eq!(r["result"], json!({}), "{r}");
    d.call(3, "agent.send", json!({ "conversation": "c1", "text": "hi" }));
    d.until_event("done");
    // About 2,250 tokens on its own: over half of the 4,096-token window.
    d.call(4, "agent.send", json!({ "conversation": "c1", "text": format!("long {}", "x".repeat(9_000)) }));
    let (skipped, compacted) = d.until_event("compacted");
    assert_eq!(compacted["params"]["event"]["messages"], 2);
    let (more, _) = d.until_event("done");
    let shown: String = skipped.iter().chain(more.iter()).filter(|n| n["method"] == "agent.delta").map(|n| n["params"]["text"].as_str().unwrap().to_owned()).collect();
    assert_eq!(shown, "final", "only the answer is streamed");
    let bodies = server.bodies.lock().unwrap().clone();
    assert_eq!(bodies.len(), 3);
    assert!(bodies[1].get("tools").is_none_or(|t| t.as_array().is_some_and(Vec::is_empty)), "the summary call offers no tools");
    assert!(bodies[1]["messages"].to_string().contains("checkpoint summary"));
    assert_eq!(bodies[1]["chat_template_kwargs"], json!({ "enable_thinking": false }), "a local server is asked not to reason");
    assert!(bodies[1]["max_tokens"].as_u64().is_some_and(|m| m <= 8_000));
    assert!(bodies[2].get("max_tokens").is_none() && bodies[2].get("chat_template_kwargs").is_none(), "the real answer is not limited");
    assert!(bodies[2]["messages"][1]["content"].as_str().unwrap().contains("S-U-M"));
    let history = d.call(5, "agent.history", json!({ "conversation": "c1" }));
    assert_eq!(history["result"].as_array().unwrap().len(), 4, "the transcript keeps every message");
}

// ---- the ChatGPT plan --------------------------------------------------------------------------------------------

/// A token shaped like OpenAI's (only the middle part is read).
fn chatgpt_token() -> String {
    use std::fmt::Write as _;
    let claims = json!({ "exp": 4_000_000_000u64, "https://api.openai.com/auth": { "chatgpt_account_id": "acct-42" } }).to_string();
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::new();
    for chunk in claims.as_bytes().chunks(3) {
        let n = chunk.iter().enumerate().fold(0u32, |a, (i, b)| a | (u32::from(*b) << (16 - 8 * i)));
        for i in 0..=chunk.len() {
            write!(out, "{}", T[((n >> (18 - 6 * i)) & 63) as usize] as char).unwrap();
        }
    }
    format!("h.{out}.s")
}

#[test]
fn the_chatgpt_plan_is_spoken_to_in_responses_with_the_sign_in() {
    let server = fake(vec![
        vec![
            (json!({ "type": "response.output_item.done", "item": { "type": "function_call", "call_id": "call_1", "name": "clock-now", "arguments": "{}" } }), 0),
            (json!({ "type": "response.completed", "response": { "status": "completed" } }), 0),
        ],
        vec![
            (json!({ "type": "response.output_text.delta", "delta": "It is " }), 0),
            (json!({ "type": "response.output_text.delta", "delta": "now." }), 0),
            (json!({ "type": "response.completed", "response": { "status": "completed" } }), 0),
        ],
    ]);
    let upstream = format!("http://{}/v1", server.addr);
    let mut d = Daemon::start(&["--chatgpt-upstream", &upstream]);
    let without = d.call(1, "agent.configure", json!({ "base_url": "chatgpt://subscription", "model": "gpt-5.5" }));
    assert_eq!(without["error"]["code"], -32602, "no sign-in, no ChatGPT: {without}");
    let token = chatgpt_token();
    let r = d.call(2, "agent.configure", json!({ "base_url": "chatgpt://subscription", "api_key": token, "model": "gpt-5.5" }));
    assert_eq!(r["result"], json!({}), "{r}");
    assert_eq!(d.call(3, "agent.status", json!({}))["result"]["context_tokens"], 272_000);
    d.call(4, "agent.send", json!({ "conversation": "c1", "text": "what time is it" }));
    d.until_event("tool_call");
    approve_next(&mut d, "once");
    let (_, message) = d.until_event("message");
    assert_eq!(message["params"]["event"]["text"], "It is now.");
    let bodies = server.bodies.lock().unwrap().clone();
    assert_eq!(bodies[0]["store"], false);
    assert_eq!(bodies[0]["input"][0]["content"][0]["text"], "what time is it");
    assert_eq!(bodies[1]["input"][1]["type"], "function_call");
    assert_eq!(bodies[1]["input"][2]["type"], "function_call_output");
    let head = &server.heads.lock().unwrap()[0];
    assert!(head.starts_with("post /v1/responses "), "{head}");
    assert!(head.contains(&format!("authorization: bearer {}", token.to_lowercase())));
    assert!(!head.contains("chatgpt-account-id"), "the public API takes the account from the token");
}

#[test]
fn the_model_can_ask_the_person_through_the_pipe_and_the_answer_continues_the_turn() {
    let server = fake(vec![calls("ask-person", r#"{"question":"Which one?","choices":["A","B"]}"#), says(&["Going with B."], 0)]);
    let mut d = Daemon::start(&[]);
    configure(&mut d, &server);
    d.call(2, "agent.send", json!({ "conversation": "c1", "text": "pick" }));
    let (_, asked) = d.until_event("question");
    assert_eq!(asked["params"]["event"], json!({ "kind": "question", "call_id": "call_1", "question": "Which one?", "choices": ["A", "B"] }));
    // A window that opens now can still see it.
    assert_eq!(d.call(3, "agent.question", json!({ "conversation": "c1" }))["result"], json!({ "call_id": "call_1", "question": "Which one?", "choices": ["A", "B"] }));
    assert_eq!(d.call(4, "agent.answer", json!({ "conversation": "c1", "call_id": "other", "text": "B" }))["error"]["data"]["kind"], "not_waiting");
    assert_eq!(d.call(5, "agent.answer", json!({ "conversation": "c1", "call_id": "call_1", "text": "  " }))["error"]["code"], -32602);
    assert_eq!(d.call(6, "agent.answer", json!({ "conversation": "c1", "call_id": "call_1", "text": "B" }))["result"], json!({}));
    let (_, message) = d.until_event("message");
    assert_eq!(message["params"]["event"]["text"], "Going with B.");
    assert!(d.call(7, "agent.question", json!({ "conversation": "c1" }))["result"].is_null());
    let second = &server.bodies.lock().unwrap()[1];
    let tool = second["messages"].as_array().unwrap().iter().find(|m| m["role"] == "tool").unwrap();
    assert_eq!(tool["content"], "The person answered: B");
}

#[test]
fn each_model_call_reports_its_tokens_and_who_answered_for_settings_usage() {
    let mut reply = says(&["ok"], 0);
    reply.push((json!({ "choices": [], "usage": { "prompt_tokens": 120, "completion_tokens": 7, "prompt_tokens_details": { "cached_tokens": 100 } } }), 0));
    let server = fake(vec![reply]);
    let mut d = Daemon::start(&[]);
    d.call(1, "agent.configure", json!({ "base_url": server.url(), "model": "m" }));
    d.call(2, "agent.send", json!({ "conversation": "c1", "text": "hello" }));
    let (skipped, _) = d.until_event("done");
    let usage = skipped.iter().find(|n| n["method"] == "agent.usage").expect("the call's usage");
    assert_eq!(usage["params"]["conversation"], "c1");
    assert_eq!(usage["params"]["kind"], "chat");
    assert_eq!(usage["params"]["model"], "m");
    assert_eq!(usage["params"]["endpoint"], server.url());
    assert_eq!((usage["params"]["input"].clone(), usage["params"]["output"].clone(), usage["params"]["cached"].clone()), (json!(120), json!(7), json!(100)));
    // The request asked for the count.
    assert_eq!(server.bodies.lock().unwrap()[0]["stream_options"], json!({ "include_usage": true }));
}

#[test]
fn a_server_that_reports_no_tokens_still_counts_as_a_request_by_the_model_that_answered() {
    let broken = fake(vec![]);
    let backup = fake(vec![says(&["from the backup"], 0)]);
    let mut d = Daemon::start(&[]);
    d.call(1, "agent.configure", json!({ "base_url": broken.url(), "model": "first", "fallback": { "base_url": backup.url(), "model": "second" } }));
    d.call(2, "agent.send", json!({ "conversation": "c1", "text": "hello" }));
    let (skipped, _) = d.until_event("done");
    let used: Vec<&Value> = skipped.iter().filter(|n| n["method"] == "agent.usage").collect();
    assert_eq!(used.len(), 1, "{used:?}");
    assert_eq!(used[0]["params"]["model"], "second");
    assert_eq!(used[0]["params"]["endpoint"], backup.url());
    assert_eq!(used[0]["params"]["input"], 0);
}
