#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
use std::collections::BTreeMap;
use std::time::{Duration, Instant};

use mobius_mcp::client::Client;
use mobius_mcp::config::{ServerConfig, parse};
use mobius_mcp::hub::{Hub, is_mcp_tool};
use serde_json::json;

const SECS: Duration = Duration::from_secs(10);

fn config(env: &[(&str, &str)]) -> ServerConfig {
    ServerConfig { command: env!("CARGO_BIN_EXE_fake-mcp-server").to_owned(), args: vec![], env: env.iter().map(|(k, v)| ((*k).to_owned(), (*v).to_owned())).collect() }
}
fn client() -> Client {
    Client::start(&config(&[]), SECS).unwrap()
}

#[test]
fn it_completes_the_handshake_and_reads_every_page_of_tools() {
    let names: Vec<_> = client().list_tools(SECS).unwrap().into_iter().map(|t| t.name).collect();
    assert_eq!(names, ["echo", "slow", "Fail Tool!", "fail_tool_", "crash", "ask_ping", "env"]);
}

#[test]
fn a_call_returns_its_text_and_notes_content_it_cannot_show() {
    let text = client().call_tool("echo", &json!({ "text": "hello" }), SECS).unwrap();
    assert_eq!(text, "hello\n[image content not shown]");
}

#[test]
fn a_tool_that_reports_an_error_is_an_error_and_an_unknown_tool_is_too() {
    let c = client();
    assert_eq!(c.call_tool("Fail Tool!", &json!({}), SECS).unwrap_err(), "it broke");
    assert!(c.call_tool("nope", &json!({}), SECS).unwrap_err().contains("unknown tool"));
}

#[test]
fn a_server_that_does_not_answer_times_out_and_the_client_stays_usable() {
    let c = client();
    let started = Instant::now();
    assert!(c.call_tool("slow", &json!({}), Duration::from_millis(400)).unwrap_err().contains("in time"));
    assert!(started.elapsed() < Duration::from_secs(5));
    assert_eq!(c.call_tool("echo", &json!({ "text": "still here" }), SECS).unwrap().lines().next(), Some("still here"));
}

#[test]
fn a_server_that_dies_fails_the_waiting_call_at_once_and_later_ones() {
    let c = client();
    let started = Instant::now();
    assert!(c.call_tool("crash", &json!({}), SECS).unwrap_err().contains("stopped"));
    assert!(started.elapsed() < Duration::from_secs(5));
    assert!(c.call_tool("echo", &json!({}), Duration::from_millis(500)).is_err());
}

#[test]
fn a_ping_from_the_server_is_answered() {
    assert_eq!(client().call_tool("ask_ping", &json!({}), SECS).unwrap(), "pong-ok");
}

#[test]
fn a_program_that_is_not_there_fails_to_start_with_a_message() {
    let missing = ServerConfig { command: "definitely-not-a-program-xyz".into(), args: vec![], env: BTreeMap::new() };
    assert!(Client::start(&missing, SECS).err().unwrap().contains("could not start"));
}

#[test]
fn the_server_gets_only_what_it_needs_plus_what_the_person_configured() {
    // CARGO_PKG_NAME is set for this test process by cargo; it must not reach the server.
    let c = Client::start(&config(&[("MOBIUS_TEST_KEY", "given")]), SECS).unwrap();
    assert_eq!(c.call_tool("env", &json!({ "text": "CARGO_PKG_NAME" }), SECS).unwrap(), "unset");
    assert_eq!(c.call_tool("env", &json!({ "text": "MOBIUS_TEST_KEY" }), SECS).unwrap(), "given");
}

#[test]
fn tools_get_plain_unique_names_that_fit_and_calls_reach_the_right_tool() {
    let mut configs = BTreeMap::new();
    configs.insert("fake".to_owned(), config(&[]));
    configs.insert("broken".to_owned(), ServerConfig { command: "definitely-not-a-program-xyz".into(), args: vec![], env: BTreeMap::new() });
    let (hub, failures) = Hub::start(&configs);
    assert_eq!(hub.servers(), ["fake"]);
    assert_eq!(failures.len(), 1);
    assert_eq!(failures[0].0, "broken");
    let described = hub.descriptions();
    let names: Vec<&str> = described.iter().map(|d| d["name"].as_str().unwrap()).collect();
    assert_eq!(names, ["mcp.fake.echo", "mcp.fake.slow", "mcp.fake.fail_tool_", "mcp.fake.fail_tool__2", "mcp.fake.crash", "mcp.fake.ask_ping", "mcp.fake.env"]);
    for d in &described {
        let name = d["name"].as_str().unwrap();
        assert!(is_mcp_tool(name) && name.len() <= 64 && !name.contains('-'), "{name}");
        assert_eq!(d["capability"], "mcp.fake");
        assert!(d["description"].as_str().unwrap().contains("untrusted"));
    }
    assert_eq!(hub.run("mcp.fake.echo", &json!({ "text": "x" })).unwrap().lines().next(), Some("x"));
    assert_eq!(hub.run("mcp.fake.fail_tool_", &json!({})).unwrap_err(), "it broke");
    assert_eq!(hub.run("mcp.fake.nothing", &json!({})).unwrap_err(), "unknown tool");
    assert!(!is_mcp_tool("browser.tabs") && !is_mcp_tool("mcp.fake") && !is_mcp_tool("mcp.a.b.c"));
}

#[test]
fn a_server_can_be_started_and_stopped_while_the_others_keep_running() {
    let mut configs = BTreeMap::new();
    configs.insert("fake".to_owned(), config(&[]));
    let (mut hub, _) = Hub::start(&configs);
    // Started later, beside the first: its tools come under its own name, and only its tools are described for it.
    hub.start_server("other", &config(&[])).unwrap();
    assert_eq!(hub.servers(), ["fake", "other"]);
    let others = hub.descriptions_of(Some("other"));
    assert!(!others.is_empty() && others.iter().all(|d| d["capability"] == "mcp.other"));
    assert_eq!(hub.run("mcp.other.echo", &json!({ "text": "y" })).unwrap().lines().next(), Some("y"));
    // One that cannot start leaves the hub as it was.
    let broken = ServerConfig { command: "definitely-not-a-program-xyz".into(), args: vec![], env: BTreeMap::new() };
    assert!(hub.start_server("broken", &broken).is_err());
    assert_eq!(hub.servers(), ["fake", "other"]);
    // Starting a running one again restarts it, with the same names.
    hub.start_server("other", &config(&[])).unwrap();
    assert_eq!(hub.descriptions_of(Some("other")).len(), others.len());
    // Stopping gives back its tools' names, and they no longer run; the first server still works.
    let gone = hub.stop_server("other");
    assert_eq!(gone.len(), others.len());
    assert!(gone.contains(&"mcp.other.echo".to_owned()));
    assert_eq!(hub.run("mcp.other.echo", &json!({})).unwrap_err(), "unknown tool");
    assert_eq!(hub.servers(), ["fake"]);
    assert_eq!(hub.run("mcp.fake.echo", &json!({ "text": "x" })).unwrap().lines().next(), Some("x"));
    assert!(hub.stop_server("never").is_empty());
}

#[test]
fn the_config_file_is_checked() {
    let ok = parse(r#"{ "servers": { "notes": { "command": "npx.cmd", "args": ["-y", "x"], "env": { "K": "v" } } } }"#).unwrap();
    assert_eq!(ok["notes"].args, ["-y", "x"]);
    assert_eq!(ok["notes"].env["K"], "v");
    for bad in [
        "not json", "{}", r#"{ "servers": [] }"#,
        r#"{ "servers": { "Bad-Name": { "command": "x" } } }"#,
        r#"{ "servers": { "a": {} } }"#,
        r#"{ "servers": { "a": { "command": " " } } }"#,
        r#"{ "servers": { "a": { "command": "x", "args": [1] } } }"#,
        r#"{ "servers": { "a": { "command": "x", "args": "no" } } }"#,
        r#"{ "servers": { "a": { "command": "x", "env": { "K": 1 } } } }"#,
    ] {
        assert!(parse(bad).is_err(), "{bad}");
    }
}

/// Talks to a real, independently written MCP server (the reference one). Needs Node and the network, so it only runs
/// when asked: `cargo test -p mobius-mcp -- --ignored`.
#[test]
#[ignore = "needs npx and the network"]
fn a_real_reference_server_works() {
    let config = ServerConfig { command: "npx".into(), args: vec!["-y".into(), "@modelcontextprotocol/server-everything".into()], env: BTreeMap::new() };
    let c = Client::start(&config, Duration::from_secs(120)).unwrap();
    let tools = c.list_tools(Duration::from_secs(30)).unwrap();
    assert!(tools.iter().any(|t| t.name == "echo"), "{:?}", tools.iter().map(|t| &t.name).collect::<Vec<_>>());
    assert!(c.call_tool("echo", &json!({ "message": "hi there" }), Duration::from_secs(30)).unwrap().contains("hi there"));
}
