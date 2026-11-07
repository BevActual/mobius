//! The admission relay: a loopback HTTP server the CLI is pointed at (`ANTHROPIC_BASE_URL`). The first
//! `POST /v1/messages` is forwarded upstream unchanged and its streamed answer captured; any further attempt in the
//! same request (the CLI retrying or carrying on by itself) is refused locally, so one Mobius model call is exactly
//! one upstream request. Headers, including the CLI's own authorization, pass through memory and are never kept.
//!
//! Not ported yet from the Hermes plugin: its prompt-cache hygiene (restoring the queried tool-result frame, moving
//! cache breakpoints, request gzip) and HTTPS proxy support. Without them long conversations reuse less cache.
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::Duration;

use mobius_agent::sse::SseParser;
use serde_json::{Map, Value, json};

const MAX_HEAD: usize = 64 * 1024;
const MAX_BODY: usize = 64 * 1024 * 1024;
pub const CONSUMED: &str = "MOBIUS_MODEL_ADMISSION_CONSUMED";

/// The one answer, rebuilt from its stream events.
#[derive(Default, Debug, Clone)]
pub struct Capture {
    message: Option<Map<String, Value>>,
    partial_json: Vec<String>,
    pub complete: bool,
}

impl Capture {
    pub fn event(&mut self, event: &Value) {
        match event.get("type").and_then(Value::as_str).unwrap_or("") {
            "message_start" => {
                self.message = event.get("message").and_then(Value::as_object).cloned();
                if let Some(m) = self.message.as_mut() {
                    m.insert("content".into(), json!([]));
                }
                self.partial_json.clear();
            }
            "content_block_start" => {
                let (Some(m), Some(block)) = (self.message.as_mut(), event.get("content_block")) else { return };
                if let Some(Value::Array(content)) = m.get_mut("content") {
                    let mut block = block.clone();
                    if block.get("type").and_then(Value::as_str) == Some("tool_use") {
                        block["input"] = json!({});
                    }
                    content.push(block);
                    self.partial_json.push(String::new());
                }
            }
            "content_block_delta" => {
                let index = event.get("index").and_then(Value::as_u64).and_then(|i| usize::try_from(i).ok()).unwrap_or(0);
                let delta = event.get("delta").cloned().unwrap_or(Value::Null);
                if delta.get("type").and_then(Value::as_str) == Some("input_json_delta") {
                    if let (Some(p), Some(s)) = (self.partial_json.get_mut(index), delta["partial_json"].as_str()) {
                        p.push_str(s);
                    }
                    return;
                }
                let Some(block) = self.block(index) else { return };
                match delta.get("type").and_then(Value::as_str) {
                    Some("text_delta") => append(block, "text", &delta["text"]),
                    Some("thinking_delta") => append(block, "thinking", &delta["thinking"]),
                    Some("signature_delta") => append(block, "signature", &delta["signature"]),
                    _ => {}
                }
            }
            "content_block_stop" => {
                let index = event.get("index").and_then(Value::as_u64).and_then(|i| usize::try_from(i).ok()).unwrap_or(0);
                let partial = self.partial_json.get(index).cloned().unwrap_or_default();
                if let Some(block) = self.block(index)
                    && block.get("type").and_then(Value::as_str) == Some("tool_use")
                    && !partial.is_empty()
                {
                    block["input"] = serde_json::from_str(&partial).unwrap_or_else(|_| json!({}));
                }
            }
            "message_delta" => {
                let Some(m) = self.message.as_mut() else { return };
                if let Some(Value::Object(d)) = event.get("delta") {
                    for (k, v) in d {
                        m.insert(k.clone(), v.clone());
                    }
                }
                if let Some(Value::Object(u)) = event.get("usage") {
                    let usage = m.entry("usage").or_insert_with(|| json!({}));
                    for (k, v) in u {
                        usage[k] = v.clone();
                    }
                }
            }
            "message_stop" => self.complete = self.message.is_some(),
            _ => {}
        }
    }

    fn block(&mut self, index: usize) -> Option<&mut Value> {
        self.message.as_mut()?.get_mut("content")?.as_array_mut()?.get_mut(index)
    }

    /// The whole message, once the stream said it was finished.
    pub fn message(&self) -> Option<Value> {
        if self.complete { self.message.clone().map(Value::Object) } else { None }
    }
}

fn append(block: &mut Value, key: &str, piece: &Value) {
    if let Some(piece) = piece.as_str() {
        let now = block.get(key).and_then(Value::as_str).unwrap_or("").to_owned() + piece;
        block[key] = json!(now);
    }
}

#[derive(Default, Debug)]
pub struct Outcome {
    /// The first request was forwarded.
    pub used: bool,
    /// Further attempts refused.
    pub denied: u32,
    pub status: Option<u16>,
    pub capture: Capture,
    /// The upstream's own words for a failure, bounded.
    pub error_body: Vec<u8>,
    pub failure: Option<String>,
}

impl Outcome {
    pub fn error_text(&self) -> String {
        let text = String::from_utf8_lossy(&self.error_body).into_owned();
        serde_json::from_str::<Value>(&text).ok().and_then(|v| v.pointer("/error/message").and_then(Value::as_str).map(str::to_owned)).unwrap_or(text)
    }
}

pub struct Relay {
    pub url: String,
    state: Arc<Mutex<Outcome>>,
    stop: Arc<AtomicBool>,
    port: u16,
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// A hard-to-guess route, so another local program cannot use the relay by finding its port.
fn random_route() -> String {
    let mut seed = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_nanos()) ^ u128::from(std::process::id()).rotate_left(64);
    let mut out = String::from("/admit/");
    for _ in 0..32 {
        seed = seed.wrapping_mul(0x2360_ED05_1FC6_5DA4_4385_DF64_9FCC_F645).wrapping_add(0x5851_F42D_4C95_7F2D_1405_7B7E_F767_814F);
        let i = usize::try_from((seed >> 96) % 36).unwrap_or(0);
        out.push(char::from(b"abcdefghijklmnopqrstuvwxyz0123456789"[i]));
    }
    out
}

/// Only https, or a test server on this computer over http.
pub fn check_upstream(upstream: &str) -> Result<(), String> {
    let ok = upstream.starts_with("https://") || upstream.starts_with("http://127.0.0.1:") || upstream.starts_with("http://localhost:");
    if ok && !upstream.contains('@') { Ok(()) } else { Err("the upstream must be https, or a loopback test server".into()) }
}

impl Relay {
    pub fn start(upstream: &str, timeout: Duration) -> Result<Relay, String> {
        check_upstream(upstream)?;
        let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
        let port = listener.local_addr().map_err(|e| e.to_string())?.port();
        let route = random_route();
        let state: Arc<Mutex<Outcome>> = Arc::default();
        let stop = Arc::new(AtomicBool::new(false));
        let (s, st, up, rt) = (state.clone(), stop.clone(), upstream.trim_end_matches('/').to_owned(), route.clone());
        thread::spawn(move || {
            for stream in listener.incoming() {
                if st.load(Ordering::SeqCst) {
                    break;
                }
                let Ok(stream) = stream else { continue };
                let (s, up, rt) = (s.clone(), up.clone(), rt.clone());
                thread::spawn(move || handle(stream, &s, &up, &rt, timeout));
            }
        });
        Ok(Relay { url: format!("http://127.0.0.1:{port}{route}"), state, stop, port })
    }

    pub fn outcome(&self) -> MutexGuard<'_, Outcome> {
        lock(&self.state)
    }
}

impl Drop for Relay {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        // Wake the accept loop so it sees the flag.
        let _ = TcpStream::connect(("127.0.0.1", self.port)).map(|s| s.shutdown(Shutdown::Both));
    }
}

fn respond(stream: &mut TcpStream, status: u16, body: &str) {
    let _ = write!(stream, "HTTP/1.1 {status} X\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}", body.len());
}

fn handle(mut stream: TcpStream, state: &Mutex<Outcome>, upstream: &str, route: &str, timeout: Duration) {
    let _ = stream.set_read_timeout(Some(timeout));
    let Ok(reader_stream) = stream.try_clone() else { return };
    let mut reader = BufReader::new(reader_stream);
    let mut head: Vec<String> = Vec::new();
    let mut line = String::new();
    loop {
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) | Err(_) => return,
            Ok(_) => {}
        }
        if line == "\r\n" || line == "\n" {
            break;
        }
        head.push(line.trim_end().to_owned());
        if head.iter().map(String::len).sum::<usize>() > MAX_HEAD {
            return respond(&mut stream, 431, "{}");
        }
    }
    let request_line = head.first().cloned().unwrap_or_default();
    let mut parts = request_line.split(' ');
    let (method, target) = (parts.next().unwrap_or(""), parts.next().unwrap_or(""));
    let headers: Vec<(String, String)> = head.iter().skip(1).filter_map(|h| h.split_once(':').map(|(k, v)| (k.trim().to_owned(), v.trim().to_owned()))).collect();
    let header = |name: &str| headers.iter().find(|(k, _)| k.eq_ignore_ascii_case(name)).map(|(_, v)| v.as_str());
    let (path, query) = target.split_once('?').map_or((target, None), |(p, q)| (p, Some(q)));
    // Anything but the one messages endpoint (the CLI's warm-up probes, a web page) is not ours to forward.
    if method != "POST" || path != format!("{route}/v1/messages") || header("origin").is_some() {
        return respond(&mut stream, 404, "{}");
    }
    {
        let mut s = lock(state);
        if s.used {
            s.denied += 1;
            drop(s);
            return respond(&mut stream, 400, &format!(r#"{{"type":"error","error":{{"type":"invalid_request_error","message":"{CONSUMED}"}}}}"#));
        }
        s.used = true;
    }
    let Some(length) = header("content-length").and_then(|v| v.parse::<usize>().ok()).filter(|n| *n <= MAX_BODY) else {
        lock(state).failure = Some("no usable content-length".into());
        return respond(&mut stream, 411, "{}");
    };
    let mut body = vec![0u8; length];
    if reader.read_exact(&mut body).is_err() {
        lock(state).failure = Some("the request body was cut short".into());
        return;
    }
    if let Err(e) = forward(&mut stream, state, upstream, query, &headers, &body, timeout) {
        lock(state).failure = Some(e);
    }
}

fn forward(stream: &mut TcpStream, state: &Mutex<Outcome>, upstream: &str, query: Option<&str>, headers: &[(String, String)], body: &[u8], timeout: Duration) -> Result<(), String> {
    let agent: ureq::Agent = ureq::Agent::config_builder().max_redirects(0).max_redirects_will_error(false).http_status_as_error(false).timeout_connect(Some(Duration::from_secs(15))).timeout_recv_body(Some(timeout)).build().into();
    let url = format!("{upstream}/v1/messages{}", query.map(|q| format!("?{q}")).unwrap_or_default());
    let mut call = agent.post(&url);
    for (k, v) in headers {
        if !matches!(k.to_ascii_lowercase().as_str(), "host" | "connection" | "content-length" | "transfer-encoding" | "accept-encoding" | "proxy-authorization" | "proxy-connection") {
            call = call.header(k.as_str(), v.as_str());
        }
    }
    call = call.header("accept-encoding", "identity");
    let mut response = call.send(body).map_err(|e| e.to_string())?;
    let status = response.status().as_u16();
    lock(state).status = Some(status);
    let mut head = format!("HTTP/1.1 {status} X\r\n");
    for (k, v) in response.headers() {
        let k = k.as_str();
        if !matches!(k, "connection" | "transfer-encoding" | "content-length" | "server" | "date")
            && let Ok(v) = v.to_str()
        {
            head.push_str(&format!("{k}: {v}\r\n"));
        }
    }
    head.push_str("connection: close\r\n\r\n");
    stream.write_all(head.as_bytes()).map_err(|e| e.to_string())?;
    let mut reader = response.body_mut().with_config().limit(MAX_BODY as u64).reader();
    let mut parser = SseParser::new();
    let mut buf = [0u8; 16 * 1024];
    loop {
        let n = reader.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        {
            let mut s = lock(state);
            if status == 200 {
                for data in parser.push(&buf[..n]) {
                    if let Ok(event) = serde_json::from_str::<Value>(&data) {
                        s.capture.event(&event);
                    }
                }
            } else if s.error_body.len() < 65536 {
                s.error_body.extend_from_slice(&buf[..n]);
            }
        }
        stream.write_all(&buf[..n]).map_err(|e| e.to_string())?;
        stream.flush().map_err(|e| e.to_string())?;
    }
    let _ = stream.shutdown(Shutdown::Both);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_stream_is_rebuilt_into_one_message_with_text_thinking_and_tool_input() {
        let mut c = Capture::default();
        for e in [
            json!({ "type": "message_start", "message": { "id": "m1", "role": "assistant", "content": [], "usage": { "input_tokens": 5, "output_tokens": 0 } } }),
            json!({ "type": "content_block_start", "index": 0, "content_block": { "type": "thinking", "thinking": "" } }),
            json!({ "type": "content_block_delta", "index": 0, "delta": { "type": "thinking_delta", "thinking": "hm" } }),
            json!({ "type": "content_block_delta", "index": 0, "delta": { "type": "signature_delta", "signature": "sig" } }),
            json!({ "type": "content_block_start", "index": 1, "content_block": { "type": "text", "text": "" } }),
            json!({ "type": "content_block_delta", "index": 1, "delta": { "type": "text_delta", "text": "Hel" } }),
            json!({ "type": "content_block_delta", "index": 1, "delta": { "type": "text_delta", "text": "lo" } }),
            json!({ "type": "content_block_start", "index": 2, "content_block": { "type": "tool_use", "id": "t1", "name": "mcp__mobius__files-read", "input": {} } }),
            json!({ "type": "content_block_delta", "index": 2, "delta": { "type": "input_json_delta", "partial_json": "{\"path\":" } }),
            json!({ "type": "content_block_delta", "index": 2, "delta": { "type": "input_json_delta", "partial_json": "\"a.md\"}" } }),
            json!({ "type": "content_block_stop", "index": 2 }),
            json!({ "type": "message_delta", "delta": { "stop_reason": "tool_use" }, "usage": { "output_tokens": 9 } }),
        ] {
            c.event(&e);
        }
        assert!(c.message().is_none(), "not complete before message_stop");
        c.event(&json!({ "type": "message_stop" }));
        let m = c.message().unwrap();
        assert_eq!(m["content"][0], json!({ "type": "thinking", "thinking": "hm", "signature": "sig" }));
        assert_eq!(m["content"][1]["text"], "Hello");
        assert_eq!(m["content"][2]["input"], json!({ "path": "a.md" }));
        assert_eq!(m["stop_reason"], "tool_use");
        assert_eq!(m["usage"], json!({ "input_tokens": 5, "output_tokens": 9 }));
    }

    #[test]
    fn only_https_or_a_loopback_test_server_is_an_upstream() {
        assert!(check_upstream("https://api.anthropic.com").is_ok());
        assert!(check_upstream("http://127.0.0.1:5000").is_ok());
        for bad in ["http://api.anthropic.com", "https://user:pw@x.com", "ftp://x", "http://192.168.1.2:80"] {
            assert!(check_upstream(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn routes_differ_and_are_long() {
        let (a, b) = (random_route(), random_route());
        assert_ne!(a, b);
        assert_eq!(a.len(), "/admit/".len() + 32);
    }
}
