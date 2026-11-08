#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
//! The OpenAI-compatible provider against a fake local server that speaks real HTTP.
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use mobius_agent::message::Message;
use mobius_agent::openai::OpenAiProvider;
use mobius_agent::provider::{ChatRequest, Provider, ProviderError, StopReason, ToolDef};
use serde_json::{Value, json};

#[derive(Debug, Clone)]
struct Recorded {
    method: String,
    path: String,
    headers: HashMap<String, String>,
    body: String,
}

enum Reply {
    /// Status, extra headers, then body pieces with a pause after each.
    Respond { status: u16, content_type: &'static str, location: Option<String>, pieces: Vec<(String, u64)> },
}

struct FakeServer {
    addr: SocketAddr,
    seen: Arc<Mutex<Vec<Recorded>>>,
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl Drop for FakeServer {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(t) = self.thread.take() {
            t.join().ok();
        }
    }
}

fn read_request(stream: &mut TcpStream) -> Option<Recorded> {
    stream.set_read_timeout(Some(Duration::from_secs(5))).ok()?;
    let mut buf = Vec::new();
    let mut chunk = [0u8; 4096];
    let header_end = loop {
        let n = stream.read(&mut chunk).ok()?;
        if n == 0 {
            return None;
        }
        buf.extend_from_slice(&chunk[..n]);
        if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break pos + 4;
        }
    };
    let head = String::from_utf8_lossy(&buf[..header_end]).into_owned();
    let mut lines = head.split("\r\n");
    let mut first = lines.next()?.split(' ');
    let (method, path) = (first.next()?.to_owned(), first.next()?.to_owned());
    let headers: HashMap<String, String> = lines.filter_map(|l| l.split_once(':')).map(|(k, v)| (k.trim().to_lowercase(), v.trim().to_owned())).collect();
    let length: usize = headers.get("content-length").and_then(|v| v.parse().ok()).unwrap_or(0);
    while buf.len() < header_end + length {
        let n = stream.read(&mut chunk).ok()?;
        if n == 0 {
            break;
        }
        buf.extend_from_slice(&chunk[..n]);
    }
    Some(Recorded { method, path, headers, body: String::from_utf8_lossy(&buf[header_end..]).into_owned() })
}

fn serve(replies: Vec<Reply>) -> FakeServer {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let addr = listener.local_addr().unwrap();
    let seen = Arc::new(Mutex::new(Vec::new()));
    let stop = Arc::new(AtomicBool::new(false));
    let (seen2, stop2) = (seen.clone(), stop.clone());
    let thread = std::thread::spawn(move || {
        let mut replies = replies.into_iter();
        while !stop2.load(Ordering::SeqCst) {
            match listener.accept() {
                Ok((mut stream, _)) => {
                    stream.set_nonblocking(false).ok();
                    let Some(request) = read_request(&mut stream) else { continue };
                    seen2.lock().unwrap().push(request);
                    let Some(Reply::Respond { status, content_type, location, pieces }) = replies.next() else { continue };
                    let mut head = format!("HTTP/1.1 {status} X\r\nContent-Type: {content_type}\r\nConnection: close\r\n");
                    if let Some(location) = location {
                        head.push_str(&format!("Location: {location}\r\n"));
                    }
                    head.push_str("\r\n");
                    if stream.write_all(head.as_bytes()).is_err() {
                        continue;
                    }
                    stream.flush().ok();
                    for (piece, pause_ms) in pieces {
                        if stream.write_all(piece.as_bytes()).is_err() {
                            break;
                        }
                        stream.flush().ok();
                        std::thread::sleep(Duration::from_millis(pause_ms));
                    }
                }
                Err(_) => std::thread::sleep(Duration::from_millis(10)),
            }
        }
    });
    FakeServer { addr, seen, stop, thread: Some(thread) }
}

fn sse(status: u16, events: Vec<(Value, u64)>, done: bool) -> Reply {
    let mut pieces: Vec<(String, u64)> = events.into_iter().map(|(v, pause)| (format!("data: {v}\n\n"), pause)).collect();
    if done {
        pieces.push(("data: [DONE]\n\n".to_owned(), 0));
    }
    Reply::Respond { status, content_type: "text/event-stream", location: None, pieces }
}

fn delta(d: Value) -> Value {
    json!({ "choices": [{ "index": 0, "delta": d }] })
}
fn finish(reason: &str) -> Value {
    json!({ "choices": [{ "index": 0, "delta": {}, "finish_reason": reason }] })
}

fn base(server: &FakeServer) -> String {
    format!("http://{}/v1", server.addr)
}

fn request() -> ChatRequest {
    ChatRequest {
        model: "test-model".into(),
        system: "be brief".into(),
        messages: vec![Message::user("hello")],
        tools: vec![ToolDef { name: "demo.echo".into(), description: "Echo".into(), input_schema: json!({ "type": "object" }) }],
        effort: None,
        max_tokens: None,
    }
}

fn run(provider: &OpenAiProvider) -> (Result<mobius_agent::provider::Completion, ProviderError>, Vec<(Instant, String)>) {
    let mut deltas = Vec::new();
    let result = provider.complete(&request(), &mut |t| {
        deltas.push((Instant::now(), t.to_owned()));
        true
    });
    (result, deltas)
}

#[test]
fn text_streams_as_it_arrives_and_the_request_is_well_formed() {
    let server = serve(vec![sse(200, vec![(delta(json!({ "content": "Hel" })), 80), (delta(json!({ "content": "lo" })), 80), (finish("stop"), 0)], true)]);
    let provider = OpenAiProvider::new(&base(&server), Some("secret".into())).unwrap();
    let (result, deltas) = run(&provider);
    let completion = result.unwrap();
    assert_eq!(completion.text, "Hello");
    assert_eq!(completion.stop, StopReason::EndTurn);
    assert_eq!(deltas.iter().map(|d| d.1.as_str()).collect::<Vec<_>>(), ["Hel", "lo"]);
    assert!(deltas[1].0.duration_since(deltas[0].0) >= Duration::from_millis(50), "text was delivered as it arrived, not after the whole reply");

    let seen = server.seen.lock().unwrap();
    let r = &seen[0];
    assert_eq!((r.method.as_str(), r.path.as_str()), ("POST", "/v1/chat/completions"));
    assert_eq!(r.headers["authorization"], "Bearer secret");
    assert!(r.headers["content-type"].starts_with("application/json"));
    let body: Value = serde_json::from_str(&r.body).unwrap();
    assert_eq!(body["model"], "test-model");
    assert_eq!(body["stream"], true);
    assert_eq!(body["messages"][0]["role"], "system");
    assert_eq!(body["messages"][1]["content"], "hello");
    assert_eq!(body["tools"][0]["function"]["name"], "demo-echo");
}

#[test]
fn tool_calls_come_back_assembled() {
    let server = serve(vec![sse(
        200,
        vec![
            (delta(json!({ "tool_calls": [{ "index": 0, "id": "call_1", "function": { "name": "demo-echo", "arguments": "{\"te" } }] })), 0),
            (delta(json!({ "tool_calls": [{ "index": 0, "function": { "arguments": "xt\":\"hi\"}" } }] })), 0),
            (finish("tool_calls"), 0),
        ],
        true,
    )]);
    let completion = run(&OpenAiProvider::new(&base(&server), None).unwrap()).0.unwrap();
    assert_eq!(completion.stop, StopReason::ToolUse);
    assert_eq!(completion.tool_calls[0].name, "demo.echo");
    assert_eq!(completion.tool_calls[0].arguments, json!({ "text": "hi" }));
}

#[test]
fn no_key_means_no_authorization_header() {
    let server = serve(vec![sse(200, vec![(delta(json!({ "content": "x" })), 0), (finish("stop"), 0)], true)]);
    run(&OpenAiProvider::new(&base(&server), None).unwrap()).0.unwrap();
    assert!(!server.seen.lock().unwrap()[0].headers.contains_key("authorization"));
}

#[test]
fn an_http_error_carries_the_servers_message_and_never_the_key() {
    let body = json!({ "error": { "message": "Invalid API key", "type": "auth" } }).to_string();
    let server = serve(vec![Reply::Respond { status: 401, content_type: "application/json", location: None, pieces: vec![(body, 0)] }]);
    let provider = OpenAiProvider::new(&base(&server), Some("sk-very-secret".into())).unwrap();
    let error = run(&provider).0.unwrap_err();
    match &error {
        ProviderError::Http { status, message } => {
            assert_eq!(*status, 401);
            assert!(message.contains("Invalid API key"), "{message}");
        }
        other => panic!("{other:?}"),
    }
    assert!(!format!("{error:?} {error}").contains("sk-very-secret"));
    assert!(!format!("{provider:?}").contains("sk-very-secret"), "debug output must hide the key");
}

#[test]
fn an_error_page_is_trimmed() {
    let page = format!("<html>{}</html>", "oops ".repeat(2000));
    let server = serve(vec![Reply::Respond { status: 500, content_type: "text/html", location: None, pieces: vec![(page, 0)] }]);
    match run(&OpenAiProvider::new(&base(&server), None).unwrap()).0.unwrap_err() {
        ProviderError::Http { status: 500, message } => assert!(message.len() <= 400, "{}", message.len()),
        other => panic!("{other:?}"),
    }
}

#[test]
fn a_server_that_is_not_there_is_a_network_error() {
    let addr = { TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap() };
    let provider = OpenAiProvider::new(&format!("http://{addr}/v1"), None).unwrap();
    assert!(matches!(run(&provider).0, Err(ProviderError::Network(_))));
}

#[test]
fn redirects_are_not_followed() {
    let server = serve(vec![Reply::Respond { status: 302, content_type: "text/plain", location: Some("http://127.0.0.1:1/elsewhere".into()), pieces: vec![] }]);
    let provider = OpenAiProvider::new(&base(&server), Some("secret".into())).unwrap();
    assert!(matches!(run(&provider).0, Err(ProviderError::Http { status: 302, .. })));
    assert_eq!(server.seen.lock().unwrap().len(), 1);
}

#[test]
fn a_stream_that_ends_with_nothing_is_an_error() {
    let server = serve(vec![Reply::Respond { status: 200, content_type: "text/event-stream", location: None, pieces: vec![] }]);
    assert!(matches!(run(&OpenAiProvider::new(&base(&server), None).unwrap()).0, Err(ProviderError::Protocol(_))));
}

#[test]
fn a_stream_without_done_is_accepted_if_it_finished() {
    let server = serve(vec![sse(200, vec![(delta(json!({ "content": "ok" })), 0), (finish("stop"), 0)], false)]);
    assert_eq!(run(&OpenAiProvider::new(&base(&server), None).unwrap()).0.unwrap().text, "ok");
}

#[test]
fn nothing_after_done_is_read() {
    let mut pieces = vec![("data: ".to_owned() + &delta(json!({ "content": "a" })).to_string() + "\n\n", 0), ("data: [DONE]\n\n".to_owned(), 0)];
    pieces.push(("data: ".to_owned() + &delta(json!({ "content": "IGNORED" })).to_string() + "\n\n", 0));
    let server = serve(vec![Reply::Respond { status: 200, content_type: "text/event-stream", location: None, pieces }]);
    assert_eq!(run(&OpenAiProvider::new(&base(&server), None).unwrap()).0.unwrap().text, "a");
}

#[test]
fn an_oversized_response_is_cut_off() {
    let big = delta(json!({ "content": "x".repeat(400) }));
    let server = serve(vec![sse(200, (0..20).map(|_| (big.clone(), 0)).collect(), true)]);
    let provider = OpenAiProvider::new(&base(&server), None).unwrap().with_max_response_bytes(2000);
    match run(&provider).0.unwrap_err() {
        ProviderError::Protocol(m) => assert!(m.contains("too large"), "{m}"),
        other => panic!("{other:?}"),
    }
}

#[test]
fn asking_to_stop_cancels_the_stream() {
    let server = serve(vec![sse(200, vec![(delta(json!({ "content": "one" })), 50), (delta(json!({ "content": "two" })), 50), (delta(json!({ "content": "three" })), 50), (finish("stop"), 0)], true)]);
    let provider = OpenAiProvider::new(&base(&server), None).unwrap();
    let mut count = 0;
    let result = provider.complete(&request(), &mut |_| {
        count += 1;
        count < 2
    });
    assert!(matches!(result, Err(ProviderError::Cancelled)));
    assert_eq!(count, 2);
}

#[test]
fn a_server_that_ignores_streaming_and_sends_plain_json_still_works() {
    let body = json!({ "choices": [{ "message": { "role": "assistant", "content": "Plain.", "tool_calls": [{ "id": "c9", "type": "function", "function": { "name": "demo-echo", "arguments": "{\"text\":\"x\"}" } }] }, "finish_reason": "tool_calls" }] }).to_string();
    let server = serve(vec![Reply::Respond { status: 200, content_type: "application/json", location: None, pieces: vec![(body, 0)] }]);
    let (result, deltas) = run(&OpenAiProvider::new(&base(&server), None).unwrap());
    let completion = result.unwrap();
    assert_eq!(completion.text, "Plain.");
    assert_eq!(deltas.len(), 1);
    assert_eq!(completion.tool_calls[0].id, "c9");
    assert_eq!(completion.tool_calls[0].arguments, json!({ "text": "x" }));
    assert_eq!(completion.stop, StopReason::ToolUse);
}

#[test]
fn urls_are_checked_before_a_key_can_travel() {
    assert!(OpenAiProvider::new("http://example.com/v1", Some("k".into())).is_err(), "a key must not cross plain http to another host");
    assert!(OpenAiProvider::new("http://example.com/v1", None).is_ok(), "no key, nothing to leak");
    assert!(OpenAiProvider::new("https://api.example.com/v1", Some("k".into())).is_ok());
    for local in ["http://localhost:8888/v1", "http://127.0.0.1:8888/v1", "http://127.9.9.9/v1", "http://[::1]:8080/v1"] {
        assert!(OpenAiProvider::new(local, Some("k".into())).is_ok(), "{local}");
    }
    for bad in ["", "not a url", "file:///etc/passwd", "ftp://example.com", "javascript:alert(1)", "http://", "http://user:pass@example.com/v1", "https:///v1"] {
        assert!(OpenAiProvider::new(bad, None).is_err(), "{bad:?}");
    }
    let server = serve(vec![sse(200, vec![(delta(json!({ "content": "x" })), 0), (finish("stop"), 0)], true)]);
    run(&OpenAiProvider::new(&format!("{}/", base(&server)), None).unwrap()).0.unwrap();
    assert_eq!(server.seen.lock().unwrap()[0].path, "/v1/chat/completions", "a trailing slash does not double up");
}
