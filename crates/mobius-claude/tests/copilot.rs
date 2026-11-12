//! The Copilot provider against a stand-in `copilot --acp`.
#![allow(clippy::unwrap_used, clippy::expect_used)]
use std::path::PathBuf;
use std::time::Duration;

use mobius_agent::message::Message;
use mobius_agent::provider::{ChatRequest, Provider, ProviderError, StopReason, ToolDef};
use mobius_claude::copilot::CopilotProvider;
use serde_json::{Value, json};

fn provider(workdir: &std::path::Path, token: &str) -> CopilotProvider {
    CopilotProvider::new(Some(&PathBuf::from(env!("CARGO_BIN_EXE_fake-copilot"))), PathBuf::from(env!("CARGO_BIN_EXE_mobius-inert-mcp")), workdir.to_path_buf(), token).unwrap().with_timeout(Duration::from_secs(20))
}

fn request(text: &str) -> ChatRequest {
    ChatRequest {
        model: "gpt-5".into(),
        system: "You are Mobius.".into(),
        messages: vec![Message::user(text)],
        tools: vec![ToolDef { name: "files.read".into(), description: "Read a file".into(), input_schema: json!({ "type": "object" }) }],
        effort: None,
        max_tokens: None,
    }
}

fn record(dir: &std::path::Path) -> Value {
    serde_json::from_str(&std::fs::read_to_string(dir.join("fake-copilot-record.json")).unwrap()).unwrap()
}

#[test]
fn an_answer_streams_back_with_the_persons_sign_in_and_mobius_tools_offered() {
    let dir = tempfile::tempdir().unwrap();
    let mut streamed = String::new();
    let done = provider(dir.path(), "gho_test_token").complete(&request("hello"), &mut |t| {
        streamed.push_str(t);
        true
    }).unwrap();
    assert_eq!((done.text.as_str(), streamed.as_str(), done.stop), ("Hello from Copilot", "Hello from Copilot", StopReason::EndTurn));
    let seen = record(dir.path());
    assert_eq!(seen["args"], json!(["--acp", "--model", "gpt-5"]));
    assert_eq!(seen["token"], "gho_test_token");
    assert_eq!(seen["otherTokens"], false);
    assert_eq!(seen["mcpServers"][0]["name"], "mobius");
    assert_eq!(seen["mcpServers"][0]["command"].as_str().map(|c| c.contains("mobius-inert-mcp")), Some(true));
    assert_eq!(seen["tools"][0]["name"], "files-read");
    assert!(seen["prompt"].as_str().unwrap().contains("<user>\nhello\n</user>"));
}

#[test]
fn a_mobius_tool_ends_the_turn_and_the_clis_own_tools_are_refused() {
    let dir = tempfile::tempdir().unwrap();
    let done = provider(dir.path(), "gho_test_token").complete(&request("please use a tool"), &mut |_| true).unwrap();
    assert_eq!(done.stop, StopReason::ToolUse);
    assert_eq!(done.text, "Reading it.");
    assert_eq!(done.tool_calls.len(), 1, "{:?}", done.tool_calls);
    assert_eq!((done.tool_calls[0].name.as_str(), &done.tool_calls[0].arguments), ("files.read", &json!({ "path": "notes/a.md" })));
    std::thread::sleep(Duration::from_millis(300));
    let seen = record(dir.path());
    assert_eq!(seen["shellAnswer"], json!({ "outcome": { "outcome": "cancelled" } }), "the shell is never allowed");
}

#[test]
fn signed_out_reads_as_a_sign_in_problem() {
    let dir = tempfile::tempdir().unwrap();
    let err = provider(dir.path(), "gho_someone_else").complete(&request("hello"), &mut |_| true).unwrap_err();
    assert!(matches!(&err, ProviderError::Http { status: 401, message } if message.contains("Sign in")), "{err:?}");
    assert!(CopilotProvider::new(Some(&PathBuf::from(env!("CARGO_BIN_EXE_fake-copilot"))), PathBuf::from(env!("CARGO_BIN_EXE_mobius-inert-mcp")), dir.path().to_path_buf(), " ").is_err());
}
