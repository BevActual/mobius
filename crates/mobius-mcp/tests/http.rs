#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
//! MCP servers at an address (Streamable HTTP), against a pretend one.
use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use mobius_mcp::client::{Client, Tokens, sign_in_needed};
use mobius_mcp::config::ServerConfig;
use mobius_mcp::hub::Hub;
use serde_json::{Value, json};

const SECS: Duration = Duration::from_secs(10);

/// What the pretend server saw: each request's method line, its headers (lowercase names) and body.
type Seen = Arc<Mutex<Vec<(String, BTreeMap<String, String>, Value)>>>;

fn respond(s: &mut std::net::TcpStream, status: u16, headers: &str, body: &str) {
    let _ = write!(s, "HTTP/1.1 {status} X\r\n{headers}content-length: {}\r\nconnection: close\r\n\r\n{body}", body.len());
}

/// A pretend MCP server at `/mcp`. With `token`, every request needs `Bearer <token>`, and a 401 points to its sign-in
/// description. `tools/list` answers as server-sent events and pings the client first; the rest answer as JSON.
fn server(token: Option<&'static str>) -> (String, Seen) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/mcp", listener.local_addr().unwrap());
    let seen: Seen = Arc::default();
    let log = seen.clone();
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut s) = stream else { break };
            let log = log.clone();
            std::thread::spawn(move || {
                let mut data = Vec::new();
                let mut buf = [0u8; 65536];
                loop {
                    let n = s.read(&mut buf).unwrap_or(0);
                    data.extend_from_slice(&buf[..n]);
                    if let Some(end) = data.windows(4).position(|w| w == b"\r\n\r\n") {
                        let head = String::from_utf8_lossy(&data[..end]).to_lowercase();
                        let len = head.lines().find_map(|l| l.strip_prefix("content-length:").map(|v| v.trim().parse::<usize>().unwrap_or(0))).unwrap_or(0);
                        if data.len() >= end + 4 + len {
                            break;
                        }
                    }
                    if n == 0 {
                        break;
                    }
                }
                let end = data.windows(4).position(|w| w == b"\r\n\r\n").unwrap_or(data.len());
                let head = String::from_utf8_lossy(&data[..end]).to_string();
                let mut lines = head.lines();
                let request = lines.next().unwrap_or("").to_owned();
                let headers: BTreeMap<String, String> = lines.filter_map(|l| l.split_once(':')).map(|(k, v)| (k.trim().to_lowercase(), v.trim().to_owned())).collect();
                let body: Value = serde_json::from_slice(data.get(end + 4..).unwrap_or_default()).unwrap_or(Value::Null);
                log.lock().unwrap().push((request.clone(), headers.clone(), body.clone()));
                if let Some(t) = token
                    && headers.get("authorization") != Some(&format!("Bearer {t}"))
                {
                    respond(&mut s, 401, "www-authenticate: Bearer resource_metadata=\"https://mcp.example.com/.well-known/oauth-protected-resource\"\r\n", "");
                    return;
                }
                if request.starts_with("DELETE") {
                    respond(&mut s, 200, "", "");
                    return;
                }
                let method = body.get("method").and_then(Value::as_str).unwrap_or("");
                if method != "initialize" && headers.get("mcp-session-id").map(String::as_str) != Some("session-1") {
                    respond(&mut s, 400, "", "no session");
                    return;
                }
                let Some(id) = body.get("id").cloned() else {
                    // A notification, or the answer to the server's ping.
                    respond(&mut s, 202, "", "");
                    return;
                };
                let reply = |result: Value| json!({ "jsonrpc": "2.0", "id": id, "result": result }).to_string();
                match method {
                    "initialize" => respond(&mut s, 200, "content-type: application/json\r\nmcp-session-id: session-1\r\n", &reply(json!({ "protocolVersion": "2025-06-18", "capabilities": { "tools": {} } }))),
                    "tools/list" => {
                        let ping = json!({ "jsonrpc": "2.0", "id": "srv-1", "method": "ping" });
                        let tools = reply(json!({ "tools": [{ "name": "echo", "description": "Return the text.", "inputSchema": { "type": "object" } }, { "name": "slow" }] }));
                        let note = json!({ "jsonrpc": "2.0", "method": "notifications/progress", "params": {} });
                        respond(&mut s, 200, "content-type: text/event-stream\r\n", &format!("event: message\ndata: {ping}\n\n: a comment\ndata: {note}\n\ndata: {tools}\n\n"));
                    }
                    "tools/call" => match body.pointer("/params/name").and_then(Value::as_str) {
                        Some("echo") => {
                            let text = body.pointer("/params/arguments/text").and_then(Value::as_str).unwrap_or("").to_owned();
                            respond(&mut s, 200, "content-type: application/json\r\n", &reply(json!({ "content": [{ "type": "text", "text": text }] })));
                        }
                        Some("slow") => std::thread::sleep(Duration::from_secs(30)),
                        _ => respond(&mut s, 200, "content-type: application/json\r\n", &json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32602, "message": "unknown tool" } }).to_string()),
                    },
                    _ => respond(&mut s, 200, "content-type: application/json\r\n", &json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32601, "message": "method not found" } }).to_string()),
                }
            });
        }
    });
    (url, seen)
}

fn at(url: &str) -> ServerConfig {
    ServerConfig { url: Some(url.to_owned()), headers: BTreeMap::from([("X-Api-Key".to_owned(), "key-1".to_owned())]), ..ServerConfig::default() }
}

#[test]
fn a_server_at_an_address_keeps_its_session_answers_its_pings_and_runs_tools() {
    let (url, seen) = server(None);
    let c = Client::start(&at(&url), SECS).unwrap();
    let names: Vec<String> = c.list_tools(SECS).unwrap().into_iter().map(|t| t.name).collect();
    assert_eq!(names, ["echo", "slow"]);
    assert_eq!(c.call_tool("echo", &json!({ "text": "hello" }), SECS).unwrap(), "hello");
    assert!(c.call_tool("nope", &json!({}), SECS).unwrap_err().contains("unknown tool"));
    let log = seen.lock().unwrap().clone();
    // Every message carries the configured header; after the handshake, the session and the protocol version too.
    assert!(log.iter().all(|(_, h, _)| h.get("x-api-key").map(String::as_str) == Some("key-1")));
    assert!(log.iter().skip(1).all(|(_, h, _)| h.get("mcp-session-id").map(String::as_str) == Some("session-1") && h.get("mcp-protocol-version").map(String::as_str) == Some("2025-06-18")));
    assert!(log.iter().any(|(_, _, b)| b["id"] == "srv-1" && b.get("result").is_some()), "the ping is answered");
    assert!(log.iter().all(|(_, h, _)| h.get("accept").is_some_and(|a| a.contains("text/event-stream"))));
    drop(c);
    let started = Instant::now();
    while !seen.lock().unwrap().iter().any(|(r, h, _)| r.starts_with("DELETE") && h.get("mcp-session-id").map(String::as_str) == Some("session-1")) {
        assert!(started.elapsed() < SECS, "the session is ended when the client goes");
        std::thread::sleep(Duration::from_millis(20));
    }
}

#[test]
fn a_slow_answer_times_out_and_the_client_stays_usable() {
    let (url, _) = server(None);
    let c = Client::start(&at(&url), SECS).unwrap();
    let started = Instant::now();
    assert!(c.call_tool("slow", &json!({}), Duration::from_millis(500)).unwrap_err().contains("in time"));
    assert!(started.elapsed() < Duration::from_secs(5));
    assert_eq!(c.call_tool("echo", &json!({ "text": "still here" }), SECS).unwrap(), "still here");
}

struct Keeper {
    given: Mutex<Vec<bool>>,
}

impl Tokens for Keeper {
    fn bearer(&self, stale: bool) -> Result<Option<String>, String> {
        self.given.lock().unwrap().push(stale);
        Ok(Some(if stale { "good" } else { "old" }.to_owned()))
    }
}

#[test]
fn a_server_that_wants_a_sign_in_says_where_and_a_refused_token_is_refreshed_once() {
    let (url, _) = server(Some("good"));
    let error = Client::start(&at(&url), SECS).err().unwrap();
    assert_eq!(sign_in_needed(&error), Some("https://mcp.example.com/.well-known/oauth-protected-resource"));
    let keeper = Arc::new(Keeper { given: Mutex::new(Vec::new()) });
    let c = Client::start_with(&at(&url), Some(keeper.clone()), SECS).unwrap();
    assert_eq!(c.call_tool("echo", &json!({ "text": "signed in" }), SECS).unwrap(), "signed in");
    assert_eq!(keeper.given.lock().unwrap()[..2], [false, true], "the refused token is refreshed");
}

#[test]
fn the_hub_starts_servers_at_addresses_beside_programs() {
    let (url, _) = server(Some("good"));
    let mut configs = BTreeMap::new();
    configs.insert("remote".to_owned(), at(&url));
    configs.insert("locked".to_owned(), at(&url));
    let (hub, failed) = Hub::start_with(&configs, &|name| (name == "remote").then(|| Arc::new(Keeper { given: Mutex::new(Vec::new()) }) as Arc<dyn Tokens>));
    assert_eq!(hub.servers(), ["remote"]);
    assert_eq!(failed.len(), 1);
    assert!(sign_in_needed(&failed[0].1).is_some(), "{failed:?}");
    assert_eq!(hub.run("mcp.remote.echo", &json!({ "text": "x" })).unwrap(), "x");
}
