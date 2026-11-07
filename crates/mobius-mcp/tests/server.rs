#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
//! Mobius as an MCP server, spoken to over real HTTP the way Claude Code or Hermes would.
use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::{Arc, Mutex};

use mobius_mcp::server::{Server, Tools};
use serde_json::{Value, json};

const TOKEN: &str = "0123456789abcdef0123456789abcdef-token";

#[derive(Default)]
struct Notes {
    calls: Mutex<Vec<(String, Value)>>,
}

impl Tools for Notes {
    fn list(&self) -> Vec<Value> {
        vec![json!({ "name": "files.read", "description": "Read a file.", "inputSchema": { "type": "object" } })]
    }
    fn call(&self, name: &str, arguments: &Value) -> Result<String, String> {
        self.calls.lock().unwrap().push((name.to_owned(), arguments.clone()));
        if arguments["path"] == "missing.md" { Err("no such file".into()) } else { Ok("# Hello".into()) }
    }
}

/// A raw HTTP request, so the test controls every header. Returns the status and the body.
fn post(port: u16, headers: &[(&str, &str)], body: &str) -> (u16, Value) {
    let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
    let mut head = format!("POST /mcp HTTP/1.1\r\nContent-Type: application/json\r\nContent-Length: {}\r\n", body.len());
    for (k, v) in headers {
        head.push_str(&format!("{k}: {v}\r\n"));
    }
    write!(s, "{head}\r\n{body}").unwrap();
    let mut out = String::new();
    s.read_to_string(&mut out).unwrap();
    let status = out.split_whitespace().nth(1).unwrap().parse().unwrap();
    let body = out.split("\r\n\r\n").nth(1).unwrap_or("");
    (status, serde_json::from_str(body).unwrap_or(Value::Null))
}

fn good(port: u16, body: &Value) -> (u16, Value) {
    let host = format!("127.0.0.1:{port}");
    post(port, &[("Host", &host), ("Authorization", &format!("Bearer {TOKEN}"))], &body.to_string())
}

#[test]
fn an_mcp_client_can_list_and_call_the_tools_mobius_offers() {
    let tools = Arc::new(Notes::default());
    let server = Server::start(0, TOKEN.into(), tools.clone()).unwrap();
    let p = server.port();
    let (status, init) = good(p, &json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": { "protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": { "name": "claude-code", "version": "1" } } }));
    assert_eq!(status, 200);
    assert_eq!(init["result"]["protocolVersion"], "2025-06-18");
    assert_eq!(init["result"]["serverInfo"]["name"], "mobius");
    assert_eq!(good(p, &json!({ "jsonrpc": "2.0", "method": "notifications/initialized" })).0, 202);
    let (_, list) = good(p, &json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list" }));
    assert_eq!(list["result"]["tools"][0]["name"], "files.read");
    let (_, read) = good(p, &json!({ "jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": { "name": "files.read", "arguments": { "path": "a.md" } } }));
    assert_eq!(read["result"], json!({ "content": [{ "type": "text", "text": "# Hello" }], "isError": false }));
    let (_, failed) = good(p, &json!({ "jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": { "name": "files.read", "arguments": { "path": "missing.md" } } }));
    assert_eq!(failed["result"]["isError"], true);
    let (_, unknown) = good(p, &json!({ "jsonrpc": "2.0", "id": 5, "method": "tools/call", "params": { "name": "files.delete", "arguments": {} } }));
    assert_eq!(unknown["error"]["code"], -32602);
    assert_eq!(tools.calls.lock().unwrap().len(), 2, "an unknown tool never reaches the application");
    assert_eq!(good(p, &json!({ "jsonrpc": "2.0", "id": 6, "method": "resources/list" })).1["error"]["code"], -32601);
}

#[test]
fn without_the_token_or_from_a_web_page_nothing_is_answered() {
    let tools = Arc::new(Notes::default());
    let server = Server::start(0, TOKEN.into(), tools.clone()).unwrap();
    let p = server.port();
    let host = format!("127.0.0.1:{p}");
    let call = json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": { "name": "files.read", "arguments": {} } }).to_string();
    assert_eq!(post(p, &[("Host", &host)], &call).0, 401, "no token");
    assert_eq!(post(p, &[("Host", &host), ("Authorization", "Bearer wrong")], &call).0, 401);
    assert_eq!(post(p, &[("Host", &host), ("Authorization", &format!("Bearer {TOKEN}x"))], &call).0, 401);
    // DNS rebinding: a page on another site that resolves to 127.0.0.1.
    assert_eq!(post(p, &[("Host", "evil.example"), ("Authorization", &format!("Bearer {TOKEN}"))], &call).0, 403);
    assert_eq!(post(p, &[("Host", &host), ("Origin", "https://evil.example"), ("Authorization", &format!("Bearer {TOKEN}"))], &call).0, 403);
    assert!(tools.calls.lock().unwrap().is_empty());
    // A page on this computer may (it already has the run of this computer), and a batch is refused.
    assert_eq!(post(p, &[("Host", &host), ("Origin", "http://localhost:3000"), ("Authorization", &format!("Bearer {TOKEN}"))], &call).0, 200);
    assert_eq!(good(p, &json!([{ "jsonrpc": "2.0", "id": 1, "method": "ping" }])).0, 400);
    assert!(Server::start(0, "short".into(), tools).is_err(), "a guessable token is refused");
}

#[test]
fn a_stopped_server_stops_listening() {
    let server = Server::start(0, TOKEN.into(), Arc::new(Notes::default())).unwrap();
    let p = server.port();
    drop(server);
    std::thread::sleep(std::time::Duration::from_millis(200));
    assert!(TcpStream::connect(("127.0.0.1", p)).is_err());
}
