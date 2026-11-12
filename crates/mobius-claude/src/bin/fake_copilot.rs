//! A stand-in for `copilot --acp`, for tests only. It speaks enough of the Agent Client Protocol to exercise the
//! provider: a prompt containing "use a tool" asks for Mobius's `files-read`, and also tries the CLI's own shell, which
//! must be refused; any other prompt is answered in two pieces. Without the right sign-in it refuses as signed out. It
//! writes what it saw to `fake-copilot-record.json` in its working folder.
#![allow(clippy::exit, clippy::unwrap_used, clippy::expect_used)]
use std::io::{BufRead, Write};

use serde_json::{Value, json};

fn print(v: &Value) {
    let mut out = std::io::stdout().lock();
    let _ = writeln!(out, "{v}");
    let _ = out.flush();
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let token = std::env::var("COPILOT_GITHUB_TOKEN").unwrap_or_default();
    let mut record = json!({ "args": args, "token": token, "otherTokens": std::env::var("GH_TOKEN").is_ok() || std::env::var("GITHUB_TOKEN").is_ok() });
    let save = |record: &Value| std::fs::write("fake-copilot-record.json", record.to_string()).unwrap();
    let stdin = std::io::stdin();
    let mut lines = stdin.lock().lines();
    while let Some(Ok(line)) = lines.next() {
        let Ok(msg) = serde_json::from_str::<Value>(&line) else { continue };
        let id = msg["id"].clone();
        match msg["method"].as_str() {
            Some("initialize") => print(&json!({ "jsonrpc": "2.0", "id": id, "result": { "protocolVersion": 1, "agentCapabilities": {} } })),
            Some("session/new") => {
                record["mcpServers"] = msg["params"]["mcpServers"].clone();
                let tools = msg["params"]["mcpServers"][0]["args"][0].as_str().and_then(|p| std::fs::read_to_string(p).ok()).unwrap_or_default();
                record["tools"] = serde_json::from_str(&tools).unwrap_or(Value::Null);
                save(&record);
                print(&json!({ "jsonrpc": "2.0", "id": id, "result": { "sessionId": "s1" } }));
            }
            Some("session/prompt") => {
                let text = msg["params"]["prompt"][0]["text"].as_str().unwrap_or("").to_owned();
                record["prompt"] = json!(text);
                save(&record);
                if token != "gho_test_token" {
                    print(&json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32000, "message": "Not authenticated. Please login." } }));
                    continue;
                }
                if text.contains("use a tool") {
                    let update = |u: Value| print(&json!({ "jsonrpc": "2.0", "method": "session/update", "params": { "sessionId": "s1", "update": u } }));
                    update(json!({ "sessionUpdate": "agent_message_chunk", "content": { "type": "text", "text": "Reading it." } }));
                    // The CLI's own shell first: Mobius must turn it down.
                    print(&json!({ "jsonrpc": "2.0", "id": 900, "method": "session/request_permission", "params": { "sessionId": "s1", "toolCall": { "toolCallId": "sh", "title": "shell", "rawInput": { "command": "rm -rf /" } }, "options": [{ "optionId": "allow", "kind": "allow_once" }] } }));
                    let answer: Value = serde_json::from_str(&lines.next().unwrap().unwrap()).unwrap();
                    record["shellAnswer"] = answer["result"].clone();
                    save(&record);
                    update(json!({ "sessionUpdate": "tool_call", "toolCallId": "t1", "title": "mobius-files-read", "kind": "read", "status": "pending" }));
                    print(&json!({ "jsonrpc": "2.0", "id": 901, "method": "session/request_permission", "params": { "sessionId": "s1", "toolCall": { "toolCallId": "t1", "title": "mobius-files-read", "rawInput": { "path": "notes/a.md" } }, "options": [{ "optionId": "allow", "kind": "allow_once" }] } }));
                    // Mobius ends the session here; anything after this is a mistake it must not wait for.
                    for line in lines.by_ref() {
                        let Ok(line) = line else { break };
                        let v: Value = serde_json::from_str(&line).unwrap_or(Value::Null);
                        if v["method"] == "session/cancel" {
                            record["cancelled"] = json!(true);
                            save(&record);
                        }
                    }
                    std::process::exit(0);
                }
                for piece in ["Hello ", "from Copilot"] {
                    print(&json!({ "jsonrpc": "2.0", "method": "session/update", "params": { "sessionId": "s1", "update": { "sessionUpdate": "agent_message_chunk", "content": { "type": "text", "text": piece } } } }));
                }
                print(&json!({ "jsonrpc": "2.0", "id": id, "result": { "stopReason": "end_turn" } }));
            }
            _ => {}
        }
    }
}
