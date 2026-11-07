//! A stand-in for the Claude Code CLI, for tests only. It behaves like `claude -p --input-format stream-json` closely
//! enough to exercise the provider: it acknowledges replayed history, asks the inert MCP server for its tools, makes one
//! Messages request through `ANTHROPIC_BASE_URL`, and prints stream-json events.
//!
//! The model name picks a behaviour: `fake-retry` tries a second request; `fake-signed-out` refuses as signed out;
//! `fake-hang` never answers. It writes what it saw to `fake-claude-record.json` in its working folder.
#![allow(clippy::exit, clippy::unwrap_used, clippy::expect_used)]
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Command, Stdio};

use mobius_claude::relay::Capture;
use serde_json::{Value, json};

fn print(v: &Value) {
    let mut out = std::io::stdout().lock();
    let _ = writeln!(out, "{v}");
    let _ = out.flush();
}

fn arg(args: &[String], flag: &str) -> Option<String> {
    args.iter().position(|a| a == flag).and_then(|i| args.get(i + 1).cloned())
}

/// Ask the MCP server for its tools and try to call one, as the real CLI would.
fn mcp_inventory(config: &str) -> (Vec<String>, bool) {
    let config: Value = serde_json::from_str(&std::fs::read_to_string(config).unwrap_or_default()).unwrap_or(Value::Null);
    let server = &config["mcpServers"]["mobius"];
    let Some(cmd) = server["command"].as_str() else { return (vec![], false) };
    let args: Vec<String> = server["args"].as_array().into_iter().flatten().filter_map(|a| a.as_str().map(str::to_owned)).collect();
    let Ok(mut child) = Command::new(cmd).args(&args).stdin(Stdio::piped()).stdout(Stdio::piped()).spawn() else { return (vec![], false) };
    let mut stdin = child.stdin.take().unwrap();
    let mut lines = BufReader::new(child.stdout.take().unwrap()).lines();
    let mut ask = |id: u64, method: &str, params: Value| -> Value {
        let _ = writeln!(stdin, "{}", json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }));
        lines.next().and_then(Result::ok).and_then(|l| serde_json::from_str(&l).ok()).unwrap_or(Value::Null)
    };
    ask(1, "initialize", json!({}));
    let listed = ask(2, "tools/list", json!({}));
    let names = listed["result"]["tools"].as_array().into_iter().flatten().filter_map(|t| t["name"].as_str().map(str::to_owned)).collect();
    let refused = ask(3, "tools/call", json!({ "name": "anything", "arguments": {} }))["result"]["isError"] == true;
    drop(stdin);
    let _ = child.kill();
    (names, refused)
}

fn post(base: &str, body: &Value) -> Result<(u16, Vec<Value>, String), String> {
    let agent: ureq::Agent = ureq::Agent::config_builder().http_status_as_error(false).build().into();
    let mut response = agent.post(&format!("{base}/v1/messages")).header("authorization", "Bearer fake-oauth-token").header("anthropic-version", "2023-06-01").header("content-type", "application/json").send(body.to_string().as_bytes()).map_err(|e| e.to_string())?;
    let status = response.status().as_u16();
    let mut text = String::new();
    response.body_mut().as_reader().read_to_string(&mut text).map_err(|e| e.to_string())?;
    let events = text.lines().filter_map(|l| l.strip_prefix("data:")).filter_map(|d| serde_json::from_str(d.trim()).ok()).collect();
    Ok((status, events, text))
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().map(String::as_str) == Some("--version") {
        println!("9.9.9 (Claude Code)");
        return;
    }
    if args.first().map(String::as_str) == Some("auth") {
        println!("{}", json!({ "loggedIn": true, "authMethod": "claude.ai", "email": "person@example.com" }));
        return;
    }
    let model = arg(&args, "--model").unwrap_or_default();
    let base = std::env::var("ANTHROPIC_BASE_URL").unwrap_or_default();
    let (tools, refused) = arg(&args, "--mcp-config").map(|c| mcp_inventory(&c)).unwrap_or_default();
    let settings: Value = arg(&args, "--settings").and_then(|p| std::fs::read_to_string(p).ok()).and_then(|t| serde_json::from_str(&t).ok()).unwrap_or(Value::Null);
    let extra: Value = settings["env"]["CLAUDE_CODE_EXTRA_BODY"].as_str().and_then(|t| serde_json::from_str(t).ok()).unwrap_or(Value::Null);
    let system = arg(&args, "--system-prompt-file").and_then(|p| std::fs::read_to_string(p).ok()).unwrap_or_default();

    let mut frames = Vec::new();
    for line in std::io::stdin().lock().lines().map_while(Result::ok) {
        let Ok(frame) = serde_json::from_str::<Value>(&line) else { continue };
        let replay = frame["shouldQuery"] == false;
        frames.push(frame);
        if replay {
            print(&json!({ "type": "result", "subtype": "success", "is_error": false, "num_turns": 0 }));
        }
    }
    let env_seen: Vec<String> = ["ANTHROPIC_API_KEY", "CLAUDE_CODE_DISABLE_AUTO_MEMORY", "CLAUDE_CODE_MAX_RETRIES"].iter().filter(|k| std::env::var(k).is_ok()).map(|k| (*k).to_owned()).collect();
    let record = json!({ "args": args, "frames": frames, "tools": tools, "toolCallRefused": refused, "extra": extra, "system": system, "env": env_seen });
    let _ = std::fs::write("fake-claude-record.json", record.to_string());

    if model == "fake-hang" {
        std::thread::sleep(std::time::Duration::from_secs(600));
    }
    if model == "fake-signed-out" {
        print(&json!({ "type": "assistant", "error": "authentication_failed", "message": { "content": [{ "type": "text", "text": "Not logged in" }] } }));
        print(&json!({ "type": "result", "subtype": "success", "is_error": true, "num_turns": 1 }));
        std::process::exit(1);
    }
    let messages: Vec<Value> = frames.iter().map(|f| f["message"].clone()).collect();
    let mut body = json!({ "model": model, "system": system, "messages": messages, "stream": true, "max_tokens": 1024 });
    if let Some(o) = extra.as_object() {
        for (k, v) in o {
            body[k] = v.clone();
        }
    }
    let (status, events, raw) = match post(&base, &body) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("fake-claude: {e}");
            std::process::exit(2);
        }
    };
    if status != 200 {
        print(&json!({ "type": "assistant", "error": "server_error", "message": { "content": [{ "type": "text", "text": raw }] } }));
        print(&json!({ "type": "result", "subtype": "error", "is_error": true, "num_turns": 1 }));
        std::process::exit(1);
    }
    let mut capture = Capture::default();
    for e in &events {
        capture.event(e);
        print(&json!({ "type": "stream_event", "event": e }));
    }
    let message = capture.message().unwrap_or(Value::Null);
    print(&json!({ "type": "assistant", "message": message }));
    if model == "fake-retry" {
        // The real CLI sometimes carries on by itself; the relay must refuse this.
        let second = post(&base, &body).map(|r| r.0).unwrap_or(0);
        eprintln!("fake-claude: second attempt got {second}");
    }
    let tool_turn = message["stop_reason"] == "tool_use";
    print(&json!({ "type": "result", "subtype": if tool_turn { "error_max_turns" } else { "success" }, "is_error": false, "num_turns": 1, "usage": message["usage"] }));
    std::process::exit(i32::from(tool_turn));
}
