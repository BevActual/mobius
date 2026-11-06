//! A stand-in MCP server, used only by this crate's tests.
//!
//! Tools: `echo` (returns `text`), `Fail Tool!` (reports an error), `slow` (never answers), `crash` (exits),
//! `ask_ping` (pings the client and says whether it answered), `env` (reports an environment variable).
//! The tool list comes in two pages. Everything is one line of JSON.
#![allow(clippy::exit)]
use std::io::{BufRead, Write};

use serde_json::{Value, json};

fn send(value: &Value) {
    let mut out = std::io::stdout().lock();
    let _ = writeln!(out, "{value}");
    let _ = out.flush();
}

fn tool(name: &str, description: &str) -> Value {
    json!({ "name": name, "description": description, "inputSchema": { "type": "object", "properties": { "text": { "type": "string" } } } })
}

fn main() {
    let stdin = std::io::stdin();
    let mut lines = stdin.lock().lines();
    while let Some(Ok(line)) = lines.next() {
        let Ok(message) = serde_json::from_str::<Value>(&line) else { continue };
        let (id, method) = (message.get("id").cloned(), message.get("method").and_then(Value::as_str).unwrap_or(""));
        let Some(id) = id else { continue };
        let params = message.get("params").cloned().unwrap_or(Value::Null);
        let reply = |result: Value| send(&json!({ "jsonrpc": "2.0", "id": id, "result": result }));
        match method {
            "initialize" => reply(json!({ "protocolVersion": "2025-06-18", "capabilities": { "tools": {} }, "serverInfo": { "name": "fake", "version": "0" } })),
            "tools/list" => {
                if params.get("cursor").is_none() {
                    reply(json!({ "tools": [tool("echo", "Return the text."), tool("slow", "Never answers.")], "nextCursor": "page2" }));
                } else {
                    reply(json!({ "tools": [tool("Fail Tool!", ""), tool("fail_tool_", "Another that sanitizes to the same name."), tool("crash", ""), tool("ask_ping", ""), tool("env", "")] }));
                }
            }
            "tools/call" => {
                let name = params.get("name").and_then(Value::as_str).unwrap_or("");
                let args = params.get("arguments").cloned().unwrap_or(Value::Null);
                let text = args.get("text").and_then(Value::as_str).unwrap_or("").to_owned();
                match name {
                    "echo" => reply(json!({ "content": [{ "type": "text", "text": text }, { "type": "image", "data": "x", "mimeType": "image/png" }] })),
                    "Fail Tool!" => reply(json!({ "isError": true, "content": [{ "type": "text", "text": "it broke" }] })),
                    "slow" => {}
                    "crash" => std::process::exit(3),
                    "ask_ping" => {
                        send(&json!({ "jsonrpc": "2.0", "id": "srv-1", "method": "ping" }));
                        let answered = lines.next().and_then(Result::ok).and_then(|l| serde_json::from_str::<Value>(&l).ok()).is_some_and(|v| v["id"] == "srv-1" && v.get("result").is_some());
                        reply(json!({ "content": [{ "type": "text", "text": if answered { "pong-ok" } else { "no-reply" } }] }));
                    }
                    "env" => reply(json!({ "content": [{ "type": "text", "text": std::env::var(&text).unwrap_or_else(|_| "unset".into()) }] })),
                    _ => send(&json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32602, "message": "unknown tool" } })),
                }
            }
            _ => send(&json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32601, "message": "method not found" } })),
        }
    }
}
