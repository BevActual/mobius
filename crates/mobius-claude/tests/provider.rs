#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
//! The provider against the fake CLI and a fake Anthropic server: nothing here reaches a real account.
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use mobius_agent::message::{Message, ToolCall};
use mobius_agent::provider::{ChatRequest, Provider, ProviderError, StopReason, ToolDef};
use mobius_claude::provider::ClaudeCodeProvider;
use serde_json::{Value, json};

struct Upstream {
    url: String,
    seen: Arc<Mutex<Vec<String>>>,
}

fn sse(events: &[Value]) -> String {
    events.iter().map(|e| format!("event: {}\ndata: {e}\n\n", e["type"].as_str().unwrap())).collect()
}

fn text_reply(text: &str) -> String {
    sse(&[
        json!({ "type": "message_start", "message": { "id": "m1", "role": "assistant", "model": "x", "content": [], "usage": { "input_tokens": 10, "output_tokens": 0 } } }),
        json!({ "type": "content_block_start", "index": 0, "content_block": { "type": "thinking", "thinking": "" } }),
        json!({ "type": "content_block_delta", "index": 0, "delta": { "type": "thinking_delta", "thinking": "consider" } }),
        json!({ "type": "content_block_delta", "index": 0, "delta": { "type": "signature_delta", "signature": "SIGNED" } }),
        json!({ "type": "content_block_stop", "index": 0 }),
        json!({ "type": "content_block_start", "index": 1, "content_block": { "type": "text", "text": "" } }),
        json!({ "type": "content_block_delta", "index": 1, "delta": { "type": "text_delta", "text": &text[..text.len() / 2] } }),
        json!({ "type": "content_block_delta", "index": 1, "delta": { "type": "text_delta", "text": &text[text.len() / 2..] } }),
        json!({ "type": "content_block_stop", "index": 1 }),
        json!({ "type": "message_delta", "delta": { "stop_reason": "end_turn" }, "usage": { "output_tokens": 4 } }),
        json!({ "type": "message_stop" }),
    ])
}

fn tool_reply() -> String {
    sse(&[
        json!({ "type": "message_start", "message": { "id": "m2", "role": "assistant", "content": [], "usage": { "input_tokens": 10, "output_tokens": 0 } } }),
        json!({ "type": "content_block_start", "index": 0, "content_block": { "type": "thinking", "thinking": "" } }),
        json!({ "type": "content_block_delta", "index": 0, "delta": { "type": "signature_delta", "signature": "TOOLSIG" } }),
        json!({ "type": "content_block_stop", "index": 0 }),
        json!({ "type": "content_block_start", "index": 1, "content_block": { "type": "tool_use", "id": "toolu_1", "name": "mcp__mobius__files-read", "input": {} } }),
        json!({ "type": "content_block_delta", "index": 1, "delta": { "type": "input_json_delta", "partial_json": "{\"path\":\"notes/a.md\"}" } }),
        json!({ "type": "content_block_stop", "index": 1 }),
        json!({ "type": "message_delta", "delta": { "stop_reason": "tool_use" }, "usage": { "output_tokens": 7 } }),
        json!({ "type": "message_stop" }),
    ])
}

/// A fake Messages endpoint: answers each request with `reply(index, request)` as (status, body).
fn upstream(reply: impl Fn(usize, &str) -> (u16, String) + Send + 'static) -> Upstream {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
    let seen = Arc::new(Mutex::new(Vec::new()));
    let log = seen.clone();
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut s) = stream else { break };
            let mut buf = Vec::new();
            let mut chunk = [0u8; 65536];
            loop {
                let n = s.read(&mut chunk).unwrap_or(0);
                buf.extend_from_slice(&chunk[..n]);
                let text = String::from_utf8_lossy(&buf).to_string();
                if let Some(end) = text.find("\r\n\r\n") {
                    let len = text.lines().find_map(|l| l.to_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse::<usize>().unwrap_or(0))).unwrap_or(0);
                    if buf.len() >= end + 4 + len {
                        break;
                    }
                }
                if n == 0 {
                    break;
                }
            }
            let request = String::from_utf8_lossy(&buf).to_string();
            let index = { let mut l = log.lock().unwrap(); l.push(request.clone()); l.len() - 1 };
            let (status, body) = reply(index, &request);
            let kind = if status == 200 { "text/event-stream" } else { "application/json" };
            let _ = write!(s, "HTTP/1.1 {status} X\r\ncontent-type: {kind}\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}", body.len());
        }
    });
    Upstream { url, seen }
}

fn exe(name: &str) -> PathBuf {
    PathBuf::from(match name {
        "fake-claude" => env!("CARGO_BIN_EXE_fake-claude"),
        _ => env!("CARGO_BIN_EXE_mobius-inert-mcp"),
    })
}

fn provider(up: &Upstream, workdir: &std::path::Path) -> ClaudeCodeProvider {
    ClaudeCodeProvider::new(Some(&exe("fake-claude")), exe("mobius-inert-mcp"), workdir.to_path_buf()).unwrap().with_upstream(&up.url).unwrap().with_timeout(Duration::from_secs(20))
}

fn request(model: &str, messages: Vec<Message>) -> ChatRequest {
    ChatRequest {
        model: model.into(),
        system: "You are Mobius.".into(),
        messages,
        tools: vec![ToolDef { name: "files.read".into(), description: "Read a file".into(), input_schema: json!({ "type": "object", "properties": { "path": { "type": "string" } } }) }],
        effort: Some("medium".into()),
        max_tokens: None,
    }
}

fn record(dir: &std::path::Path) -> Value {
    serde_json::from_str(&std::fs::read_to_string(dir.join("fake-claude-record.json")).unwrap()).unwrap()
}

fn header(request: &str, name: &str) -> Option<String> {
    request.lines().find_map(|l| l.split_once(':').filter(|(k, _)| k.eq_ignore_ascii_case(name)).map(|(_, v)| v.trim().to_owned()))
}

#[test]
fn a_reply_streams_through_one_upstream_request_with_the_cli_s_own_sign_in() {
    let up = upstream(|_, _| (200, text_reply("Hello there")));
    let dir = tempfile::tempdir().unwrap();
    let mut streamed = String::new();
    let c = provider(&up, dir.path()).complete(&request("sonnet", vec![Message::user("hi")]), &mut |t| { streamed.push_str(t); true }).unwrap();
    assert_eq!((c.text.as_str(), streamed.as_str(), c.stop), ("Hello there", "Hello there", StopReason::EndTurn));
    let seen = up.seen.lock().unwrap();
    assert_eq!(seen.len(), 1);
    // The CLI's own authorization passes through the relay untouched; Mobius has no key of its own here.
    assert_eq!(header(&seen[0], "authorization").as_deref(), Some("Bearer fake-oauth-token"));
    let body: Value = serde_json::from_str(seen[0].split("\r\n\r\n").nth(1).unwrap()).unwrap();
    assert_eq!(body["tools"][0]["name"], "mcp__mobius__files-read");
    assert_eq!(body["output_config"]["effort"], "medium");
    assert_eq!(body["system"], "You are Mobius.");
    // How the CLI was started: its own tools, settings and slash commands off, one turn, the 1M route.
    let r = record(dir.path());
    let args: Vec<String> = serde_json::from_value(r["args"].clone()).unwrap();
    let pair = |flag: &str| args.iter().position(|a| a == flag).map(|i| args[i + 1].clone());
    assert_eq!(pair("--tools").as_deref(), Some(""));
    assert_eq!(pair("--setting-sources").as_deref(), Some(""));
    assert_eq!(pair("--max-turns").as_deref(), Some("1"));
    assert_eq!(pair("--permission-mode").as_deref(), Some("dontAsk"));
    assert_eq!(pair("--model").as_deref(), Some("claude-sonnet-5-5[1m]"));
    assert!(args.iter().any(|a| a == "--no-session-persistence") && args.iter().any(|a| a == "--strict-mcp-config"));
    // The CLI learned the tool from the inert server, which refuses to run anything.
    assert_eq!(r["tools"], json!(["files-read"]));
    assert_eq!(r["toolCallRefused"], true);
    assert!(r["env"].as_array().unwrap().contains(&json!("CLAUDE_CODE_DISABLE_AUTO_MEMORY")));
}

#[test]
fn a_tool_call_comes_back_as_a_mobius_call_and_the_next_request_replays_its_signed_thinking() {
    let up = upstream(|i, _| (200, if i == 0 { tool_reply() } else { text_reply("Done") }));
    let dir = tempfile::tempdir().unwrap();
    let p = provider(&up, dir.path());
    let first = p.complete(&request("opus", vec![Message::user("read it")]), &mut |_| true).unwrap();
    assert_eq!(first.stop, StopReason::ToolUse);
    assert_eq!(first.tool_calls, vec![ToolCall { id: "toolu_1".into(), name: "files.read".into(), arguments: json!({ "path": "notes/a.md" }) }]);
    let history = vec![
        Message::user("read it"),
        Message::Assistant { text: first.text.clone(), tool_calls: first.tool_calls.clone() },
        Message::Tool { call_id: "toolu_1".into(), name: "files.read".into(), content: "# A".into(), is_error: false },
    ];
    let second = p.complete(&request("opus", history), &mut |_| true).unwrap();
    assert_eq!(second.text, "Done");
    let r = record(dir.path());
    // History replay: the first user turn is acknowledged without asking the model, the signed turn goes back as is.
    assert_eq!(r["frames"][0]["shouldQuery"], false);
    assert_eq!(r["frames"][1]["message"]["content"][0]["signature"], "TOOLSIG");
    assert_eq!(r["frames"][2]["message"]["content"][0]["type"], "tool_result");
    assert_eq!(up.seen.lock().unwrap().len(), 2, "one upstream request per Mobius call");
}

#[test]
fn each_tool_call_is_given_as_soon_as_its_block_closes_and_is_also_in_the_completion() {
    let up = upstream(|_, _| (200, tool_reply()));
    let dir = tempfile::tempdir().unwrap();
    let p = provider(&up, dir.path());
    let mut early = Vec::new();
    let done = p.complete_with_calls(&request("opus", vec![Message::user("read it")]), &mut |_| true, &mut |c| early.push(c.clone())).unwrap();
    assert_eq!(early, vec![ToolCall { id: "toolu_1".into(), name: "files.read".into(), arguments: json!({ "path": "notes/a.md" }) }]);
    assert_eq!(done.tool_calls, early);
}

#[test]
fn a_second_attempt_by_the_cli_is_refused_locally() {
    let up = upstream(|_, _| (200, text_reply("Once")));
    let dir = tempfile::tempdir().unwrap();
    let c = provider(&up, dir.path()).complete(&request("fake-retry", vec![Message::user("hi")]), &mut |_| true).unwrap();
    assert_eq!(c.text, "Once");
    assert_eq!(up.seen.lock().unwrap().len(), 1, "the retry never reached the upstream");
}

#[test]
fn an_upstream_refusal_keeps_its_status_and_reason() {
    let up = upstream(|_, _| (429, r#"{"type":"error","error":{"type":"rate_limit_error","message":"You have hit your limit"}}"#.into()));
    let dir = tempfile::tempdir().unwrap();
    let err = provider(&up, dir.path()).complete(&request("sonnet", vec![Message::user("hi")]), &mut |_| true).unwrap_err();
    assert_eq!(err, ProviderError::Http { status: 429, message: "You have hit your limit".into() });
}

#[test]
fn a_signed_out_cli_says_how_to_sign_in_and_sends_nothing() {
    let up = upstream(|_, _| (200, text_reply("no")));
    let dir = tempfile::tempdir().unwrap();
    let err = provider(&up, dir.path()).complete(&request("fake-signed-out", vec![Message::user("hi")]), &mut |_| true).unwrap_err();
    assert!(matches!(&err, ProviderError::Http { status: 401, message } if message.contains("claude auth login")), "{err:?}");
    assert!(up.seen.lock().unwrap().is_empty());
}

#[test]
fn stopping_ends_the_cli_at_once() {
    let up = upstream(|_, _| (200, text_reply("Hello there")));
    let dir = tempfile::tempdir().unwrap();
    let started = Instant::now();
    let err = provider(&up, dir.path()).complete(&request("sonnet", vec![Message::user("hi")]), &mut |_| false).unwrap_err();
    assert_eq!(err, ProviderError::Cancelled);
    assert!(started.elapsed() < Duration::from_secs(10));
}

#[test]
fn a_cli_that_never_answers_times_out() {
    let up = upstream(|_, _| (200, text_reply("x")));
    let dir = tempfile::tempdir().unwrap();
    let p = provider(&up, dir.path()).with_timeout(Duration::from_secs(2));
    let started = Instant::now();
    let err = p.complete(&request("fake-hang", vec![Message::user("hi")]), &mut |_| true).unwrap_err();
    assert!(matches!(err, ProviderError::Network(_)), "{err:?}");
    assert!(started.elapsed() < Duration::from_secs(10));
}

#[test]
fn without_the_cli_the_provider_says_how_to_install_it() {
    let dir = tempfile::tempdir().unwrap();
    let err = ClaudeCodeProvider::new(Some(std::path::Path::new("Z:/no/claude.exe")), exe("mobius-inert-mcp"), dir.path().to_path_buf()).unwrap_err();
    assert!(err.contains("npm install -g @anthropic-ai/claude-code"));
}

/// The real Claude Code CLI on the person's own subscription. Uses a little of their plan's allowance, so it only
/// runs when asked: `cargo test -p mobius-claude --test provider -- --ignored live`.
#[test]
#[ignore = "uses the signed-in Claude subscription"]
fn live_the_real_cli_answers_and_calls_a_mobius_tool() {
    let dir = tempfile::tempdir().unwrap();
    let p = ClaudeCodeProvider::new(None, exe("mobius-inert-mcp"), dir.path().to_path_buf()).unwrap().with_timeout(Duration::from_secs(120));
    let mut plain = request("haiku", vec![Message::user("Reply with exactly the word: pong")]);
    plain.tools.clear();
    plain.effort = Some("low".into());
    let mut streamed = String::new();
    let c = p.complete(&plain, &mut |t| { streamed.push_str(t); true }).unwrap();
    eprintln!("live plain: {:?} streamed {:?}", c.text, streamed);
    assert!(c.text.to_lowercase().contains("pong"), "{c:?}");
    let mut ask = request("haiku", vec![Message::user("Use the files.read tool to read notes/a.md. Do not answer before reading it.")]);
    ask.effort = Some("low".into());
    let first = p.complete(&ask, &mut |_| true).unwrap();
    eprintln!("live tool turn: {first:?}");
    assert_eq!(first.stop, StopReason::ToolUse, "{first:?}");
    assert_eq!(first.tool_calls[0].name, "files.read");
    let mut follow = ask.clone();
    follow.messages.push(Message::Assistant { text: first.text.clone(), tool_calls: first.tool_calls.clone() });
    follow.messages.push(Message::Tool { call_id: first.tool_calls[0].id.clone(), name: "files.read".into(), content: "# A\nThe secret word is marigold.".into(), is_error: false });
    let done = p.complete(&follow, &mut |_| true).unwrap();
    eprintln!("live after tool: {:?}", done.text);
    assert!(done.text.to_lowercase().contains("marigold"), "{done:?}");
}
