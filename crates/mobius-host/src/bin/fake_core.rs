//! A stand-in for the core daemon, used only by this crate's tests. It speaks the same one-line JSON-RPC.
//!
//! `--never-start` exits at once; `--slow-start <ms>` reads nothing for that long (a core on a busy computer). It answers `core.ping`, the `agent.*`, `permissions.*` and `events.*` calls the host
//! makes with fixed rows (some deliberately malformed), records every other call (`test.log` returns them), and
//! answers anything else with `{"echo": <method>}`. Special methods: `test.notify`, `test.ask`, `test.fail`,
//! `test.silent` (never answers) and `test.exit` (dies).
#![allow(clippy::exit)]
use std::io::{BufRead, Write};

use serde_json::{Value, json};

fn send(out: &mut impl Write, value: &Value) {
    let _ = writeln!(out, "{value}");
    let _ = out.flush();
}

fn canned(method: &str) -> Option<Value> {
    Some(match method {
        "core.ping" => json!({ "protocol": 1, "version": "fake" }),
        "agent.send" => json!({ "turn": 7 }),
        "agent.history" => json!([{ "role": "user", "text": "hi" }]),
        "agent.rewind" => json!({ "text": "taken back" }),
        "agent.conversations" => json!([
            { "id": "c-one", "title": "First", "updated_ms": 5, "messages": 2, "activity": "working", "waiting": 1 },
            { "id": "../bad", "title": "x", "updated_ms": 5, "messages": 2 },
            { "id": "c-two", "title": "t".repeat(500), "updated_ms": 6, "messages": 1, "activity": "weird" },
            { "id": "c-three", "title": 5, "updated_ms": 6, "messages": 1 }, 7, null
        ]),
        "agent.waiting" => json!([
            { "request_id": 3, "call_id": "k1", "tool": "browser.read", "arguments": { "url": "x" }, "once_only": true },
            { "request_id": "no", "call_id": "k2", "tool": "t" }, { "call_id": "k3" }
        ]),
        "permissions.grants" => json!([
            { "id": 1, "principal": { "kind": "agent", "id": "mobius-agent" }, "capability": "browser.read", "resource": "https://a.example", "effect": "allow", "duration": "always", "created_ms": 9 },
            { "id": 2, "principal": { "kind": "person", "id": "me" }, "capability": "browser.read", "resource": null, "effect": "allow", "duration": "always" },
            { "id": 3, "principal": { "kind": "agent", "id": "mobius-agent" }, "capability": "x", "resource": null, "effect": "deny", "duration": "once" },
            { "id": 4, "principal": { "kind": "agent", "id": "mobius-agent" }, "capability": "y", "resource": 5, "effect": "allow", "duration": "always" },
            { "id": 5, "principal": { "kind": "agent", "id": "other-agent" }, "capability": "z", "resource": null, "effect": "allow", "duration": "session" },
            { "id": 6, "principal": { "kind": "agent", "id": "mobius-agent" }, "capability": "clock.now", "resource": null, "effect": "allow", "duration": "session" }
        ]),
        "events.list" => json!([
            { "seq": 2, "ts_ms": 10, "kind": "decision", "capability": "browser.read", "resource": "https://a.example", "detail": { "tool": "browser.read", "secret": "typed text" }, "principal": { "kind": "agent" }, "args": "do not leak" },
            { "seq": "x" }
        ]),
        _ => return None,
    })
}

fn main() {
    if std::env::args().any(|a| a == "--never-start") {
        std::process::exit(3);
    }
    let args: Vec<String> = std::env::args().collect();
    if let Some(ms) = args.iter().position(|a| a == "--slow-start").and_then(|i| args.get(i + 1)).and_then(|v| v.parse::<u64>().ok()) {
        std::thread::sleep(std::time::Duration::from_millis(ms));
    }
    let stdin = std::io::stdin();
    let mut out = std::io::stdout();
    let mut lines = stdin.lock().lines();
    let mut log: Vec<Value> = Vec::new();
    while let Some(Ok(line)) = lines.next() {
        let Ok(message) = serde_json::from_str::<Value>(&line) else { continue };
        let id = message.get("id").cloned().unwrap_or(Value::Null);
        let method = message.get("method").and_then(Value::as_str).unwrap_or("").to_owned();
        let params = message.get("params").cloned().unwrap_or(Value::Null);
        let reply = |result: Value| json!({ "jsonrpc": "2.0", "id": id, "result": result });
        if !method.starts_with("test.") && method != "core.ping" {
            log.push(json!({ "method": method, "params": params }));
        }
        match method.as_str() {
            "test.exit" => std::process::exit(1),
            "test.silent" => {}
            "test.log" => send(&mut out, &reply(json!(log))),
            // Models: a job starts, then its result comes as a notification (sometimes before the answer is read).
            "models.discover" | "models.download" => {
                let job = if method == "models.discover" { "job-search" } else { "job-get" };
                send(&mut out, &reply(json!({ "job": job })));
                if method == "models.download" {
                    send(&mut out, &json!({ "jsonrpc": "2.0", "method": "models.progress", "params": { "job": job, "done": 5, "total": 10 } }));
                }
                std::thread::sleep(std::time::Duration::from_millis(300));
                let result = if method == "models.discover" { json!([{ "junk": true }]) } else { json!({}) };
                let fail = params.get("repo").and_then(Value::as_str) == Some("bad/repo");
                let note = if fail { json!({ "job": job, "ok": false, "error": "no such file" }) } else { json!({ "job": job, "ok": true, "result": result }) };
                send(&mut out, &json!({ "jsonrpc": "2.0", "method": "models.job", "params": note }));
            }
            "models.hardware" => send(&mut out, &reply(json!({ "vram_total": 1, "vram_free": 1, "ram_total": 1, "ram_free": 1 }))),
            "models.status" => send(&mut out, &reply(json!({ "binary": "llama", "runtime": { "state": "ready", "model_id": "m", "model": "x", "base_url": "http://127.0.0.1:1/v1", "log": [] } }))),
            "models.start" => send(&mut out, &reply(json!({ "base_url": "http://127.0.0.1:1/v1", "model": "x" }))),
            "models.stop" | "models.cancel" => send(&mut out, &reply(json!({}))),
            "test.notify" => {
                send(&mut out, &json!({ "jsonrpc": "2.0", "method": "test.event", "params": { "n": 1 } }));
                send(&mut out, &reply(json!({ "echo": method })));
            }
            "test.ask" => {
                send(&mut out, &json!({ "jsonrpc": "2.0", "id": "h1", "method": "host.tool", "params": { "x": 1 } }));
                let answer = lines.next().and_then(Result::ok).and_then(|l| serde_json::from_str::<Value>(&l).ok()).unwrap_or(Value::Null);
                send(&mut out, &reply(json!({ "host_said": answer })));
            }
            "test.fail" => send(&mut out, &json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32602, "message": "nope", "data": { "why": 1 } } })),
            "agent.configure" if params.get("model") == Some(&json!("reject")) => {
                send(&mut out, &json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32602, "message": "that model is refused" } }));
            }
            "agent.configure" | "agent.cancel" | "agent.take_over" | "agent.hand_back" | "agent.delete" | "permissions.resolve" | "permissions.revoke" | "agent.set_effort" | "permissions.set_mode" | "tools.register_external" => send(&mut out, &reply(json!({}))),
            m => match canned(m) {
                Some(result) => send(&mut out, &reply(result)),
                None if message.get("id").is_some() => send(&mut out, &reply(json!({ "echo": method }))),
                None => {}
            },
        }
    }
}
