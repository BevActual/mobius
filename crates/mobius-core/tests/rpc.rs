#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
//! The wire protocol: JSON-RPC 2.0, one message per line. Everything here is input from another process.
use mobius_core::core::{Core, ToolSpec};
use mobius_core::rpc::{Extension, ExtensionError, handle_line, handle_line_with, params_as};
use serde_json::{Value, json};

fn core() -> Core {
    let mut core = Core::open_in_memory(Box::new(|| 42)).unwrap();
    let spec = |name: &str, capability: &str| ToolSpec::new(name, "", capability).unwrap();
    core.register_tool(spec("demo.echo", "demo.echo"), Box::new(|args| Ok(json!({ "echo": args.clone() })))).unwrap();
    core.register_tool(spec("demo.exec", "process.exec"), Box::new(|_| Ok(json!("ran")))).unwrap();
    core
}

fn call(core: &mut Core, request: Value) -> Value {
    let line = handle_line(core, &request.to_string()).expect("a response");
    serde_json::from_str(&line).unwrap()
}

fn agent() -> Value {
    json!({ "kind": "agent", "id": "test-agent" })
}

#[test]
fn ping_reports_the_protocol_version() {
    let mut c = core();
    let r = call(&mut c, json!({ "jsonrpc": "2.0", "id": 1, "method": "core.ping" }));
    assert_eq!(r["jsonrpc"], "2.0");
    assert_eq!(r["id"], 1);
    assert_eq!(r["result"]["protocol"], 1);
    assert!(r["result"]["version"].is_string());
}

#[test]
fn string_ids_are_echoed_unchanged() {
    let mut c = core();
    let r = call(&mut c, json!({ "jsonrpc": "2.0", "id": "req-7", "method": "core.ping" }));
    assert_eq!(r["id"], "req-7");
}

#[test]
fn malformed_input_gets_a_parse_error_and_never_crashes() {
    let mut c = core();
    for bad in ["", "not json", "{", "{\"jsonrpc\":", "\u{0000}"] {
        let line = handle_line(&mut c, bad).expect("an error response");
        let r: Value = serde_json::from_str(&line).unwrap();
        assert_eq!(r["error"]["code"], -32700, "{bad:?}");
        assert_eq!(r["id"], Value::Null);
    }
}

#[test]
fn requests_that_are_not_valid_requests_are_refused() {
    let mut c = core();
    for bad in [json!([1, 2]), json!("text"), json!(5), json!({ "id": 1, "method": "core.ping" }), json!({ "jsonrpc": "1.0", "id": 1, "method": "core.ping" }), json!({ "jsonrpc": "2.0", "id": 1 }), json!({ "jsonrpc": "2.0", "id": 1, "method": 5 }), json!({ "jsonrpc": "2.0", "id": {"a": 1}, "method": "core.ping" })] {
        let r = call(&mut c, bad.clone());
        assert_eq!(r["error"]["code"], -32600, "{bad}");
    }
}

#[test]
fn unknown_methods_are_reported_with_the_request_id() {
    let mut c = core();
    let r = call(&mut c, json!({ "jsonrpc": "2.0", "id": 9, "method": "nope.nothing" }));
    assert_eq!(r["error"]["code"], -32601);
    assert_eq!(r["id"], 9);
}

#[test]
fn a_notification_gets_no_response() {
    let mut c = core();
    assert!(handle_line(&mut c, &json!({ "jsonrpc": "2.0", "method": "core.ping" }).to_string()).is_none());
}

#[test]
fn unknown_fields_and_bad_values_are_invalid_params() {
    let mut c = core();
    let cases = [
        json!({ "principal": agent(), "tool": "demo.echo", "extra": true }),
        json!({ "principal": { "kind": "root", "id": "x" }, "tool": "demo.echo" }),
        json!({ "principal": { "kind": "agent", "id": "" }, "tool": "demo.echo" }),
        json!({ "principal": agent() }),
        json!("a string"),
        json!([1]),
    ];
    for params in cases {
        let r = call(&mut c, json!({ "jsonrpc": "2.0", "id": 1, "method": "tools.invoke", "params": params }));
        assert_eq!(r["error"]["code"], -32602, "{params}");
    }
    let r = call(&mut c, json!({ "jsonrpc": "2.0", "id": 1, "method": "permissions.check", "params": { "principal": agent(), "capability": "Not A Capability" } }));
    assert_eq!(r["error"]["code"], -32602);
}

#[test]
fn oversized_arguments_are_refused() {
    let mut c = core();
    let big = "x".repeat(300 * 1024);
    let r = call(&mut c, json!({ "jsonrpc": "2.0", "id": 1, "method": "tools.invoke", "params": { "principal": agent(), "tool": "demo.echo", "args": { "blob": big } } }));
    assert_eq!(r["error"]["code"], -32602);
    assert!(c.events(0, 10).unwrap().is_empty(), "nothing was evaluated or logged");
}

#[test]
fn the_approval_flow_works_end_to_end_over_the_wire() {
    let mut c = core();
    let r = call(&mut c, json!({ "jsonrpc": "2.0", "id": 1, "method": "tools.invoke", "params": { "principal": agent(), "tool": "demo.echo", "args": { "n": 1 } } }));
    assert_eq!(r["result"]["status"], "needs_approval");
    let request_id = r["result"]["request_id"].as_u64().unwrap();

    let r = call(&mut c, json!({ "jsonrpc": "2.0", "id": 2, "method": "permissions.pending" }));
    assert_eq!(r["result"][0]["id"], request_id);
    assert_eq!(r["result"][0]["capability"], "demo.echo");
    assert_eq!(r["result"][0]["principal"], agent());

    let r = call(&mut c, json!({ "jsonrpc": "2.0", "id": 3, "method": "permissions.resolve", "params": { "request_id": request_id, "approve": true, "duration": "once" } }));
    assert!(r.get("error").is_none(), "{r}");

    let r = call(&mut c, json!({ "jsonrpc": "2.0", "id": 4, "method": "tools.invoke", "params": { "principal": agent(), "tool": "demo.echo", "args": { "n": 2 } } }));
    assert_eq!(r["result"]["status"], "completed");
    assert_eq!(r["result"]["result"]["echo"]["n"], 2);

    let r = call(&mut c, json!({ "jsonrpc": "2.0", "id": 5, "method": "events.list", "params": { "limit": 100 } }));
    let kinds: Vec<&str> = r["result"].as_array().unwrap().iter().map(|e| e["kind"].as_str().unwrap()).collect();
    assert_eq!(kinds, ["permission.asked", "permission.approved", "permission.allowed", "tool.started", "tool.completed"]);
    let after = r["result"][2]["seq"].as_u64().unwrap();
    let r = call(&mut c, json!({ "jsonrpc": "2.0", "id": 6, "method": "events.list", "params": { "after_seq": after } }));
    assert_eq!(r["result"].as_array().unwrap().len(), 2);
}

#[test]
fn application_errors_have_a_stable_kind_and_do_not_leak_internals() {
    let mut c = core();
    let r = call(&mut c, json!({ "jsonrpc": "2.0", "id": 1, "method": "tools.invoke", "params": { "principal": agent(), "tool": "no.such_tool" } }));
    assert_eq!(r["error"]["code"], -32000);
    assert_eq!(r["error"]["data"]["kind"], "unknown_tool");

    let r = call(&mut c, json!({ "jsonrpc": "2.0", "id": 2, "method": "permissions.resolve", "params": { "request_id": 77, "approve": true, "duration": "once" } }));
    assert_eq!(r["error"]["data"]["kind"], "unknown_request");

    let first = call(&mut c, json!({ "jsonrpc": "2.0", "id": 3, "method": "tools.invoke", "params": { "principal": agent(), "tool": "demo.exec" } }));
    let id = first["result"]["request_id"].as_u64().unwrap();
    let r = call(&mut c, json!({ "jsonrpc": "2.0", "id": 4, "method": "permissions.resolve", "params": { "request_id": id, "approve": true, "duration": "always" } }));
    assert_eq!(r["error"]["data"]["kind"], "standing_not_allowed");
    assert!(!r.to_string().contains("sqlite"));
}

#[test]
fn grants_can_be_listed_and_revoked() {
    let mut c = core();
    let first = call(&mut c, json!({ "jsonrpc": "2.0", "id": 1, "method": "tools.invoke", "params": { "principal": agent(), "tool": "demo.echo" } }));
    let id = first["result"]["request_id"].as_u64().unwrap();
    call(&mut c, json!({ "jsonrpc": "2.0", "id": 2, "method": "permissions.resolve", "params": { "request_id": id, "approve": true, "duration": "always" } }));
    let r = call(&mut c, json!({ "jsonrpc": "2.0", "id": 3, "method": "permissions.grants" }));
    let grant_id = r["result"][0]["id"].as_u64().unwrap();
    assert_eq!(r["result"][0]["duration"], "always");
    let r = call(&mut c, json!({ "jsonrpc": "2.0", "id": 4, "method": "permissions.revoke", "params": { "grant_id": grant_id } }));
    assert!(r.get("error").is_none());
    let r = call(&mut c, json!({ "jsonrpc": "2.0", "id": 5, "method": "permissions.grants" }));
    assert_eq!(r["result"].as_array().unwrap().len(), 0);
}

#[test]
fn tools_are_listed_with_their_capabilities() {
    let mut c = core();
    let r = call(&mut c, json!({ "jsonrpc": "2.0", "id": 1, "method": "tools.list" }));
    let names: Vec<&str> = r["result"].as_array().unwrap().iter().map(|t| t["name"].as_str().unwrap()).collect();
    assert_eq!(names, ["demo.echo", "demo.exec"]);
    assert_eq!(r["result"][1]["capability"], "process.exec");
}

struct Ext {
    calls: Vec<String>,
}

impl Extension for Ext {
    fn call(&mut self, _core: &mut Core, method: &str, params: Option<&Value>) -> Option<Result<Value, ExtensionError>> {
        if !method.starts_with("ext.") {
            return None;
        }
        self.calls.push(method.to_owned());
        Some(match method {
            "ext.double" => params_as::<Value>(params).and_then(|v| v["n"].as_i64().map(|n| json!({ "n": n * 2 })).ok_or_else(|| ExtensionError::invalid_params("n must be a number"))),
            "ext.refuse" => Err(ExtensionError::application("refused", "not today")),
            _ => Ok(json!({})),
        })
    }
}

fn call_ext(core: &mut Core, ext: &mut Ext, request: Value) -> Value {
    serde_json::from_str(&handle_line_with(core, ext, &request.to_string()).expect("a response")).unwrap()
}

#[test]
fn an_extension_answers_the_methods_it_owns_and_nothing_else() {
    let mut c = core();
    let mut ext = Ext { calls: vec![] };
    let r = call_ext(&mut c, &mut ext, json!({ "jsonrpc": "2.0", "id": 1, "method": "ext.double", "params": { "n": 21 } }));
    assert_eq!(r["result"], json!({ "n": 42 }));
    let r = call_ext(&mut c, &mut ext, json!({ "jsonrpc": "2.0", "id": 2, "method": "nope.nothing" }));
    assert_eq!(r["error"]["code"], -32601, "unknown methods are still not found");
    assert_eq!(ext.calls, ["ext.double"]);
}

#[test]
fn built_in_methods_never_reach_the_extension() {
    let mut c = core();
    let mut ext = Ext { calls: vec![] };
    let r = call_ext(&mut c, &mut ext, json!({ "jsonrpc": "2.0", "id": 1, "method": "core.ping" }));
    assert_eq!(r["result"]["protocol"], 1);
    assert!(ext.calls.is_empty());
}

#[test]
fn extension_errors_use_the_same_error_shapes_as_built_ins() {
    let mut c = core();
    let mut ext = Ext { calls: vec![] };
    let bad = call_ext(&mut c, &mut ext, json!({ "jsonrpc": "2.0", "id": 1, "method": "ext.double", "params": { "n": "x" } }));
    assert_eq!(bad["error"]["code"], -32602);
    let bad = call_ext(&mut c, &mut ext, json!({ "jsonrpc": "2.0", "id": 2, "method": "ext.double", "params": [1] }));
    assert_eq!(bad["error"]["code"], -32602, "params must be an object");
    let refused = call_ext(&mut c, &mut ext, json!({ "jsonrpc": "2.0", "id": 3, "method": "ext.refuse" }));
    assert_eq!(refused["error"]["code"], -32000);
    assert_eq!(refused["error"]["data"]["kind"], "refused");
    assert_eq!(refused["error"]["message"], "not today");
}

#[test]
fn an_extension_notification_gets_no_reply() {
    let mut c = core();
    let mut ext = Ext { calls: vec![] };
    assert!(handle_line_with(&mut c, &mut ext, &json!({ "jsonrpc": "2.0", "method": "ext.double", "params": { "n": 1 } }).to_string()).is_none());
}

#[test]
fn the_application_can_register_tools_it_runs_itself() {
    let mut c = core();
    let reg = call(&mut c, json!({ "jsonrpc": "2.0", "id": 1, "method": "tools.register_external", "params": {
        "name": "browser.open", "description": "Open a page", "capability": "browser.navigate", "resource_arg": "url", "resource_origin": true,
        "input_schema": { "type": "object", "properties": { "url": { "type": "string" } }, "required": ["url"] } } }));
    assert_eq!(reg["result"], json!({}), "{reg}");
    let list = call(&mut c, json!({ "jsonrpc": "2.0", "id": 2, "method": "tools.list" }));
    let tool = list["result"].as_array().unwrap().iter().find(|t| t["name"] == "browser.open").unwrap().clone();
    assert_eq!((tool["external"].clone(), tool["resource_origin"].clone()), (json!(true), json!(true)));

    let asked = call(&mut c, json!({ "jsonrpc": "2.0", "id": 3, "method": "tools.invoke", "params": { "principal": agent(), "tool": "browser.open", "args": { "url": "https://example.com/x" } } }));
    assert_eq!(asked["result"]["status"], "needs_approval");
    let id = asked["result"]["request_id"].clone();
    call(&mut c, json!({ "jsonrpc": "2.0", "id": 4, "method": "permissions.resolve", "params": { "request_id": id, "approve": true, "duration": "once" } }));
    let go = call(&mut c, json!({ "jsonrpc": "2.0", "id": 5, "method": "tools.invoke", "params": { "principal": agent(), "tool": "browser.open", "args": { "url": "https://example.com/y" } } }));
    assert_eq!(go["result"], json!({ "status": "dispatch" }));
}

#[test]
fn registering_an_application_tool_is_checked() {
    let mut c = core();
    let base = |extra: Value| {
        let mut params = json!({ "name": "browser.tabs", "description": "d", "capability": "browser.list" });
        params.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
        json!({ "jsonrpc": "2.0", "id": 1, "method": "tools.register_external", "params": params })
    };
    assert_eq!(call(&mut c, base(json!({ "external": false })))["error"]["code"], -32602, "unknown fields are refused");
    assert_eq!(call(&mut c, base(json!({ "capability": "Not A Capability" })))["error"]["code"], -32602);
    assert_eq!(call(&mut c, base(json!({ "resource_origin": true })))["error"]["code"], -32602, "an origin needs an argument to read it from");
    assert_eq!(call(&mut c, base(json!({ "description": "d".repeat(5000) })))["error"]["code"], -32602);
    assert_eq!(call(&mut c, base(json!({})))["result"], json!({}));
    assert_eq!(call(&mut c, base(json!({})))["error"]["data"]["kind"], "duplicate_tool");
    let shadow = call(&mut c, json!({ "jsonrpc": "2.0", "id": 2, "method": "tools.register_external", "params": { "name": "demo.echo", "description": "d", "capability": "demo.echo" } }));
    assert_eq!(shadow["error"]["data"]["kind"], "duplicate_tool", "a tool the core runs cannot be replaced from outside");
}

#[test]
fn the_newest_events_can_be_asked_for_directly() {
    let mut c = core();
    let asked = call(&mut c, json!({ "jsonrpc": "2.0", "id": 1, "method": "tools.invoke", "params": { "principal": agent(), "tool": "demo.echo", "args": {} } }));
    call(&mut c, json!({ "jsonrpc": "2.0", "id": 2, "method": "permissions.resolve", "params": { "request_id": asked["result"]["request_id"], "approve": true, "duration": "once" } }));
    call(&mut c, json!({ "jsonrpc": "2.0", "id": 3, "method": "tools.invoke", "params": { "principal": agent(), "tool": "demo.echo", "args": {} } }));
    let newest = call(&mut c, json!({ "jsonrpc": "2.0", "id": 4, "method": "events.list", "params": { "newest": true, "limit": 2 } }));
    let kinds: Vec<&str> = newest["result"].as_array().unwrap().iter().map(|e| e["kind"].as_str().unwrap()).collect();
    assert_eq!(kinds, ["tool.completed", "tool.started"], "newest first, and only as many as asked for");
    let all = call(&mut c, json!({ "jsonrpc": "2.0", "id": 5, "method": "events.list", "params": { "newest": true, "limit": 100 } }));
    assert_eq!(all["result"].as_array().unwrap().len(), 5);
    assert!(all["result"][0]["seq"].as_u64() > all["result"][4]["seq"].as_u64());
    let both = call(&mut c, json!({ "jsonrpc": "2.0", "id": 6, "method": "events.list", "params": { "newest": true, "after_seq": 1 } }));
    assert_eq!(both["error"]["code"], -32602, "from the start and newest first cannot both be asked for");
}

#[test]
fn the_approval_mode_can_be_read_and_changed_and_only_to_a_known_one() {
    let mut c = core();
    let r = call(&mut c, json!({ "jsonrpc": "2.0", "id": 1, "method": "permissions.mode" }));
    assert_eq!(r["result"], json!({ "mode": "manual" }));
    let r = call(&mut c, json!({ "jsonrpc": "2.0", "id": 2, "method": "permissions.set_mode", "params": { "mode": "off" } }));
    assert_eq!(r["result"], json!({ "mode": "off" }));
    let r = call(&mut c, json!({ "jsonrpc": "2.0", "id": 3, "method": "permissions.mode" }));
    assert_eq!(r["result"], json!({ "mode": "off" }));
    let r = call(&mut c, json!({ "jsonrpc": "2.0", "id": 3, "method": "permissions.set_mode", "params": { "mode": "smart" } }));
    assert_eq!(r["result"], json!({ "mode": "smart" }));
    call(&mut c, json!({ "jsonrpc": "2.0", "id": 3, "method": "permissions.set_mode", "params": { "mode": "off" } }));
    for bad in [json!({ "mode": "auto" }), json!({ "mode": "yolo" }), json!({ "mode": "" }), json!({ "mode": 3 }), json!({}), json!({ "mode": "off", "extra": 1 })] {
        let r = call(&mut c, json!({ "jsonrpc": "2.0", "id": 4, "method": "permissions.set_mode", "params": bad }));
        assert_eq!(r["error"]["code"], -32602, "{bad}");
    }
    let r = call(&mut c, json!({ "jsonrpc": "2.0", "id": 5, "method": "permissions.mode" }));
    assert_eq!(r["result"], json!({ "mode": "off" }), "a refused change leaves the mode alone");
}

#[test]
fn a_sign_in_is_for_one_task_and_one_site_and_ends_with_the_task_or_on_sign_out() {
    let mut c = core();
    let req = |id: u64, method: &str, params: Value| json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params });
    let has = |c: &mut Core, conversation: &str| call(c, req(1, "signins.has", json!({ "conversation": conversation, "site": "https://axion.example/orders/new" })))["result"]["signedIn"].clone();
    assert_eq!(has(&mut c, "c1"), json!(false));
    let r = call(&mut c, req(2, "signins.add", json!({ "conversation": "c1", "site": "https://Axion.example/login" })));
    assert_eq!(r["result"]["sites"], json!(["https://axion.example"]));
    assert_eq!(has(&mut c, "c1"), json!(true), "later steps of the task do not ask again");
    assert_eq!(has(&mut c, "c2"), json!(false), "another task asks again");
    call(&mut c, req(3, "signins.sign_out", json!({ "conversation": "c1", "site": "https://axion.example" })));
    assert_eq!(has(&mut c, "c1"), json!(false), "Sign out now");
    call(&mut c, req(4, "signins.add", json!({ "conversation": "c1", "site": "https://axion.example" })));
    call(&mut c, req(5, "signins.end", json!({ "conversation": "c1" })));
    assert_eq!(has(&mut c, "c1"), json!(false), "it ends with the task");
    let bad = call(&mut c, req(6, "signins.add", json!({ "conversation": "c1", "site": "file:///etc" })));
    assert_eq!(bad["error"]["code"], -32602);
}

#[test]
fn a_command_is_asked_about_in_manual_mode_and_still_when_approvals_are_off() {
    let mut c = core();
    let run = |c: &mut Core| call(c, json!({ "jsonrpc": "2.0", "id": 2, "method": "tools.invoke", "params": { "principal": agent(), "tool": "demo.exec", "args": {} } }));
    assert_eq!(run(&mut c)["result"]["status"], "needs_approval");
    call(&mut c, json!({ "jsonrpc": "2.0", "id": 1, "method": "permissions.set_mode", "params": { "mode": "off" } }));
    // Running a command is a floor: asked in every mode.
    assert_eq!(run(&mut c)["result"]["status"], "needs_approval");
}

#[test]
fn rules_from_settings_let_the_agent_act_or_stop_it_and_bad_rules_are_refused() {
    let mut c = core();
    let run = |c: &mut Core| call(c, json!({ "jsonrpc": "2.0", "id": 2, "method": "tools.invoke", "params": { "principal": agent(), "tool": "demo.echo", "args": {} } }));
    assert_eq!(run(&mut c)["result"]["status"], "needs_approval");
    let r = call(&mut c, json!({ "jsonrpc": "2.0", "id": 1, "method": "permissions.set_rules", "params": { "rules": [{ "capability": "demo.echo", "effect": "allow" }] } }));
    assert_eq!(r["result"], json!({}));
    assert_eq!(run(&mut c)["result"]["status"], "completed");
    call(&mut c, json!({ "jsonrpc": "2.0", "id": 1, "method": "permissions.set_rules", "params": { "rules": [{ "capability": "demo.echo", "effect": "deny" }] } }));
    assert_eq!(run(&mut c)["result"]["status"], "denied");
    for bad in [json!({ "rules": [{ "capability": "Bad Cap", "effect": "allow" }] }), json!({ "rules": [{ "capability": "a.b", "effect": "maybe" }] }), json!({ "rules": "x" }), json!({ "rules": [{ "capability": "a.b", "effect": "allow", "extra": 1 }] })] {
        let r = call(&mut c, json!({ "jsonrpc": "2.0", "id": 4, "method": "permissions.set_rules", "params": bad }));
        assert_eq!(r["error"]["code"], -32602, "{bad}");
    }
    call(&mut c, json!({ "jsonrpc": "2.0", "id": 1, "method": "permissions.set_rules", "params": { "rules": [] } }));
    assert_eq!(run(&mut c)["result"]["status"], "needs_approval");
}
