#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
//! Another app using Mobius's workspace over MCP, as the person allowed in Settings.
use std::sync::{Arc, Mutex};

use mobius_host::mcp_server::McpServer;
use mobius_host::secrets::MemorySecrets;
use serde_json::{Value, json};

fn call(url: &str, token: &str, body: &Value) -> Value {
    let agent: ureq::Agent = ureq::Agent::config_builder().http_status_as_error(false).build().into();
    let mut r = agent.post(url).header("Authorization", &format!("Bearer {token}")).header("Content-Type", "application/json").send(body.to_string().as_bytes()).unwrap();
    serde_json::from_str(&r.body_mut().read_to_string().unwrap()).unwrap_or(Value::Null)
}

fn tool(url: &str, token: &str, name: &str, args: Value) -> Value {
    call(url, token, &json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": { "name": name, "arguments": args } }))
}

#[test]
fn sharing_is_off_until_turned_on_reads_by_default_and_changes_only_when_allowed() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(dir.path().join("workspace/notes")).unwrap();
    std::fs::write(dir.path().join("workspace/notes/plan.md"), "# Plan\n").unwrap();
    let changed = Arc::new(Mutex::new(Vec::<String>::new()));
    let seen = changed.clone();
    let open = || McpServer::open(dir.path().join("mcp-server.json"), dir.path().join("workspace"), dir.path().join("checkpoints"), Arc::new(MemorySecrets::new(true)), Arc::new({ let seen = seen.clone(); move |p: &str| seen.lock().unwrap().push(p.to_owned()) }));
    let server = open();
    assert_eq!(server.status()["running"], false);
    assert!(server.reveal_token().is_none(), "no token is shown while sharing is off");

    assert_eq!(server.set(Some(true), None, Some(0)), json!({ "ok": false, "error": "Use a port from 1024 to 65535." }));
    let port = { let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap(); l.local_addr().unwrap().port() };
    assert_eq!(server.set(Some(true), None, Some(port))["ok"], true);
    let status = server.status();
    assert_eq!(status["running"], true, "{status}");
    let url = status["url"].as_str().unwrap().to_owned();
    let token = server.reveal_token().unwrap();
    assert_eq!(token.len(), 64);

    let list = call(&url, &token, &json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list" }));
    let names: Vec<&str> = list["result"]["tools"].as_array().unwrap().iter().map(|t| t["name"].as_str().unwrap()).collect();
    assert_eq!(names, ["files.list", "files.read", "files.search"], "reading only, by default");
    let read = tool(&url, &token, "files.read", json!({ "path": "notes/plan.md" }));
    assert!(read["result"]["content"][0]["text"].as_str().unwrap().contains("# Plan"), "{read}");
    assert!(tool(&url, &token, "files.write", json!({ "path": "notes/x.md", "content": "x" }))["error"].is_object());
    assert!(!dir.path().join("workspace/notes/x.md").exists());

    server.set(None, Some(true), None);
    let wrote = tool(&url, &token, "files.write", json!({ "path": "notes/x.md", "content": "from another app" }));
    assert_eq!(wrote["result"]["isError"], false, "{wrote}");
    assert_eq!(std::fs::read_to_string(dir.path().join("workspace/notes/x.md")).unwrap(), "from another app");
    assert_eq!(changed.lock().unwrap().as_slice(), ["notes/x.md"]);

    // A new token locks out apps set up with the old one.
    server.renew_token();
    let fresh = server.reveal_token().unwrap();
    assert_ne!(fresh, token);
    assert!(call(&url, &token, &json!({ "jsonrpc": "2.0", "id": 1, "method": "ping" }))["result"].is_null(), "the old token is refused");
    assert_eq!(call(&url, &fresh, &json!({ "jsonrpc": "2.0", "id": 1, "method": "ping" }))["result"], json!({}));

    // The choice is remembered; turning it off stops the listener.
    drop(server);
    std::thread::sleep(std::time::Duration::from_millis(100));
    let again = open();
    assert_eq!((again.status()["running"].clone(), again.status()["allowChanges"].clone()), (json!(true), json!(true)));
    again.set(Some(false), None, None);
    assert_eq!(again.status()["running"], false);
    std::thread::sleep(std::time::Duration::from_millis(100));
    assert!(std::net::TcpStream::connect(("127.0.0.1", port)).is_err());
}
