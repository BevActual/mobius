#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
//! Behaviour of the core as a whole: permissions, tools and the event log working together.
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use mobius_core::core::{Core, CoreError, InvokeOutcome, ToolSpec};
use mobius_core::model::{Capability, Decision, Duration, Principal, PrincipalKind, origin_of};
use serde_json::{Value, json};

fn agent() -> Principal {
    Principal::new(PrincipalKind::Agent, "mobius-agent").unwrap()
}
fn person() -> Principal {
    Principal::new(PrincipalKind::Person, "me").unwrap()
}
fn cap(name: &str) -> Capability {
    Capability::new(name).unwrap()
}

struct Fixture {
    core: Core,
    time: Arc<AtomicU64>,
}

fn register_tools(core: &mut Core) {
    let spec = |name: &str, capability: &str, resource_arg: Option<&str>| {
        let spec = ToolSpec::new(name, &format!("test tool {name}"), capability).unwrap();
        match resource_arg {
            Some(key) => spec.with_resource_arg(key),
            None => spec,
        }
    };
    core.register_tool(spec("demo.echo", "demo.echo", None), Box::new(|args| Ok(json!({ "echo": args.clone() })))).unwrap();
    core.register_tool(spec("demo.exec", "process.exec", None), Box::new(|_| Ok(json!("ran")))).unwrap();
    core.register_tool(spec("demo.open", "browser.read", Some("url")), Box::new(|args| Ok(args.clone()))).unwrap();
    core.register_tool(spec("demo.fail", "demo.fail", None), Box::new(|_| Err("it broke".to_owned()))).unwrap();
    core.register_tool(spec("demo.panic", "demo.panic", None), Box::new(|_| panic!("handler bug"))).unwrap();
}

fn fixture() -> Fixture {
    let time = Arc::new(AtomicU64::new(1_000_000));
    let clock_time = time.clone();
    let mut core = Core::open_in_memory(Box::new(move || clock_time.load(Ordering::SeqCst))).unwrap();
    register_tools(&mut core);
    Fixture { core, time }
}

fn temp_db(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("mobius-core-test-{name}-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    dir.join("core.db")
}

fn open_file(path: &Path, time: &Arc<AtomicU64>) -> Core {
    let t = time.clone();
    let mut core = Core::open(path, Box::new(move || t.load(Ordering::SeqCst))).unwrap();
    register_tools(&mut core);
    core
}

fn pending_id(outcome: InvokeOutcome) -> u64 {
    match outcome {
        InvokeOutcome::NeedsApproval { request_id } => request_id,
        other => panic!("expected NeedsApproval, got {other:?}"),
    }
}

#[test]
fn an_unapproved_agent_is_asked_and_a_one_time_approval_is_used_up() {
    let mut f = fixture();
    let id = pending_id(f.core.invoke(&agent(), "demo.echo", &json!({ "n": 1 })).unwrap());
    assert_eq!(f.core.pending().len(), 1);
    f.core.resolve(id, true, Duration::Once).unwrap();
    assert!(f.core.pending().is_empty());
    assert!(matches!(f.core.invoke(&agent(), "demo.echo", &json!({ "n": 2 })).unwrap(), InvokeOutcome::Completed { .. }));
    pending_id(f.core.invoke(&agent(), "demo.echo", &json!({ "n": 3 })).unwrap());
}

#[test]
fn a_person_is_never_asked() {
    let mut f = fixture();
    match f.core.invoke(&person(), "demo.exec", &json!({})).unwrap() {
        InvokeOutcome::Completed { result } => assert_eq!(result, json!("ran")),
        other => panic!("{other:?}"),
    }
}

#[test]
fn rejecting_once_leaves_no_memory_and_the_next_call_asks_again() {
    let mut f = fixture();
    let first = pending_id(f.core.invoke(&agent(), "demo.echo", &json!({})).unwrap());
    f.core.resolve(first, false, Duration::Once).unwrap();
    let second = pending_id(f.core.invoke(&agent(), "demo.echo", &json!({})).unwrap());
    assert_ne!(first, second);
}

#[test]
fn rejecting_always_blocks_later_calls_until_revoked() {
    let mut f = fixture();
    let id = pending_id(f.core.invoke(&agent(), "demo.echo", &json!({})).unwrap());
    f.core.resolve(id, false, Duration::Always).unwrap();
    assert!(matches!(f.core.invoke(&agent(), "demo.echo", &json!({})).unwrap(), InvokeOutcome::Denied { .. }));
    let grant = f.core.grants().into_iter().next().unwrap();
    f.core.revoke(grant.id).unwrap();
    pending_id(f.core.invoke(&agent(), "demo.echo", &json!({})).unwrap());
}

#[test]
fn a_standing_approval_covers_later_calls() {
    let mut f = fixture();
    let id = pending_id(f.core.invoke(&agent(), "demo.echo", &json!({})).unwrap());
    f.core.resolve(id, true, Duration::Session).unwrap();
    for _ in 0..3 {
        assert!(matches!(f.core.invoke(&agent(), "demo.echo", &json!({})).unwrap(), InvokeOutcome::Completed { .. }));
    }
}

#[test]
fn floor_capabilities_refuse_standing_approval_but_accept_one_use() {
    let mut f = fixture();
    let id = pending_id(f.core.invoke(&agent(), "demo.exec", &json!({})).unwrap());
    assert!(matches!(f.core.resolve(id, true, Duration::Always), Err(CoreError::StandingNotAllowed(_))));
    assert!(matches!(f.core.resolve(id, true, Duration::Session), Err(CoreError::StandingNotAllowed(_))));
    f.core.resolve(id, true, Duration::Once).unwrap();
    assert!(matches!(f.core.invoke(&agent(), "demo.exec", &json!({})).unwrap(), InvokeOutcome::Completed { .. }));
    pending_id(f.core.invoke(&agent(), "demo.exec", &json!({})).unwrap());
}

#[test]
fn a_floor_capability_can_still_be_blocked_for_good() {
    let mut f = fixture();
    let id = pending_id(f.core.invoke(&agent(), "demo.exec", &json!({})).unwrap());
    f.core.resolve(id, false, Duration::Always).unwrap();
    assert!(matches!(f.core.invoke(&agent(), "demo.exec", &json!({})).unwrap(), InvokeOutcome::Denied { .. }));
}

#[test]
fn a_one_time_approval_expires() {
    let mut f = fixture();
    let id = pending_id(f.core.invoke(&agent(), "demo.echo", &json!({})).unwrap());
    f.core.resolve(id, true, Duration::Once).unwrap();
    f.time.fetch_add(5 * 60 * 1000, Ordering::SeqCst);
    pending_id(f.core.invoke(&agent(), "demo.echo", &json!({})).unwrap());
}

#[test]
fn the_resource_comes_from_the_arguments_so_it_cannot_be_misdeclared() {
    let mut f = fixture();
    let id = pending_id(f.core.invoke(&agent(), "demo.open", &json!({ "url": "https://a.example/page" })).unwrap());
    f.core.resolve(id, true, Duration::Always).unwrap();
    assert!(matches!(f.core.invoke(&agent(), "demo.open", &json!({ "url": "https://a.example/page" })).unwrap(), InvokeOutcome::Completed { .. }));
    pending_id(f.core.invoke(&agent(), "demo.open", &json!({ "url": "https://evil.example/" })).unwrap());
}

#[test]
fn a_call_that_cannot_name_its_resource_is_refused_not_guessed() {
    let mut f = fixture();
    assert!(matches!(f.core.invoke(&agent(), "demo.open", &json!({})), Err(CoreError::InvalidArgs(_))));
    assert!(matches!(f.core.invoke(&agent(), "demo.open", &json!({ "url": 5 })), Err(CoreError::InvalidArgs(_))));
    assert!(matches!(f.core.invoke(&agent(), "demo.open", &json!({ "url": "https://a.example/*" })), Err(CoreError::InvalidArgs(_))), "a resource cannot be a pattern");
    assert!(matches!(f.core.invoke(&agent(), "demo.open", &json!({ "url": "a\nb" })), Err(CoreError::InvalidArgs(_))));
}

#[test]
fn unknown_tools_requests_and_grants_are_errors() {
    let mut f = fixture();
    assert!(matches!(f.core.invoke(&agent(), "nope.nothing", &json!({})), Err(CoreError::UnknownTool(_))));
    assert!(matches!(f.core.resolve(99, true, Duration::Once), Err(CoreError::UnknownRequest(99))));
    assert!(matches!(f.core.revoke(99), Err(CoreError::UnknownGrant(99))));
    let id = pending_id(f.core.invoke(&agent(), "demo.echo", &json!({})).unwrap());
    f.core.resolve(id, true, Duration::Once).unwrap();
    assert!(matches!(f.core.resolve(id, true, Duration::Once), Err(CoreError::UnknownRequest(_))), "a request resolves once");
}

#[test]
fn identical_pending_requests_are_merged_and_flooding_is_capped() {
    let mut f = fixture();
    let a = pending_id(f.core.invoke(&agent(), "demo.echo", &json!({})).unwrap());
    let b = pending_id(f.core.invoke(&agent(), "demo.echo", &json!({ "different": "args" })).unwrap());
    assert_eq!(a, b, "same principal, capability and resource is one question");
    for i in 0..99 {
        let p = Principal::new(PrincipalKind::Agent, &format!("agent-{i}")).unwrap();
        pending_id(f.core.invoke(&p, "demo.echo", &json!({})).unwrap());
    }
    assert_eq!(f.core.pending().len(), 100);
    let overflow = Principal::new(PrincipalKind::Agent, "one-too-many").unwrap();
    assert!(matches!(f.core.invoke(&overflow, "demo.echo", &json!({})).unwrap(), InvokeOutcome::Denied { .. }));
    assert_eq!(f.core.pending().len(), 100);
}

#[test]
fn tool_failures_and_panics_are_contained() {
    let mut f = fixture();
    for name in ["demo.fail", "demo.panic"] {
        let id = pending_id(f.core.invoke(&agent(), name, &json!({})).unwrap());
        f.core.resolve(id, true, Duration::Session).unwrap();
        match f.core.invoke(&agent(), name, &json!({})).unwrap() {
            InvokeOutcome::Failed { error } => assert!(!error.is_empty(), "{name}"),
            other => panic!("{name}: {other:?}"),
        }
    }
    assert!(matches!(f.core.invoke(&person(), "demo.echo", &json!({})).unwrap(), InvokeOutcome::Completed { .. }), "the core keeps working");
}

#[test]
fn always_grants_survive_a_restart_but_session_and_once_grants_do_not() {
    let path = temp_db("persist");
    let time = Arc::new(AtomicU64::new(5_000));
    {
        let mut core = open_file(&path, &time);
        let always = pending_id(core.invoke(&agent(), "demo.echo", &json!({})).unwrap());
        core.resolve(always, true, Duration::Always).unwrap();
        let session = pending_id(core.invoke(&agent(), "demo.fail", &json!({})).unwrap());
        core.resolve(session, true, Duration::Session).unwrap();
        let once = pending_id(core.invoke(&agent(), "demo.panic", &json!({})).unwrap());
        core.resolve(once, true, Duration::Once).unwrap();
        assert_eq!(core.grants().len(), 3);
    }
    let mut core = open_file(&path, &time);
    assert_eq!(core.grants().len(), 1);
    assert!(matches!(core.invoke(&agent(), "demo.echo", &json!({})).unwrap(), InvokeOutcome::Completed { .. }));
    pending_id(core.invoke(&agent(), "demo.fail", &json!({})).unwrap());
    // New grants after a restart must not reuse an id still in the database.
    let id = pending_id(core.invoke(&agent(), "demo.panic", &json!({})).unwrap());
    core.resolve(id, true, Duration::Always).unwrap();
    let ids: Vec<u64> = core.grants().iter().map(|g| g.id).collect();
    assert_eq!(ids.len(), 2);
    assert_ne!(ids[0], ids[1]);
    std::fs::remove_dir_all(path.parent().unwrap()).ok();
}

#[test]
fn the_event_log_records_decisions_in_order_survives_restart_and_leaves_out_arguments() {
    let path = temp_db("events");
    let time = Arc::new(AtomicU64::new(9_000));
    let first_seq;
    {
        let mut core = open_file(&path, &time);
        let id = pending_id(core.invoke(&agent(), "demo.echo", &json!({ "secret": "hunter2" })).unwrap());
        core.resolve(id, true, Duration::Once).unwrap();
        core.invoke(&agent(), "demo.echo", &json!({ "secret": "hunter2" })).unwrap();
        let events = core.events(0, 100).unwrap();
        let kinds: Vec<&str> = events.iter().map(|e| e.kind.as_str()).collect();
        assert_eq!(kinds, ["permission.asked", "permission.approved", "permission.allowed", "tool.started", "tool.completed"]);
        assert!(events.windows(2).all(|w| w[0].seq < w[1].seq));
        assert!(events.iter().all(|e| e.ts_ms == 9_000));
        let whole = serde_json::to_string(&events).unwrap();
        assert!(!whole.contains("hunter2"), "arguments must not be written to the log");
        first_seq = events[0].seq;
        // Paging picks up where the caller left off.
        let rest = core.events(events[2].seq, 100).unwrap();
        assert_eq!(rest.len(), 2);
        assert_eq!(core.events(0, 2).unwrap().len(), 2);
    }
    let core = open_file(&path, &time);
    let events = core.events(0, 100).unwrap();
    assert_eq!(events.len(), 5);
    assert_eq!(events[0].seq, first_seq);
    std::fs::remove_dir_all(path.parent().unwrap()).ok();
}

#[test]
fn check_reports_decisions_without_consuming_a_one_time_approval() {
    let mut f = fixture();
    let c = cap("demo.echo");
    let id = match f.core.check(&agent(), &c, None).unwrap() {
        Decision::Ask { request_id } => request_id,
        other => panic!("{other:?}"),
    };
    f.core.resolve(id, true, Duration::Once).unwrap();
    assert_eq!(f.core.check(&agent(), &c, None).unwrap(), Decision::Allow);
    assert_eq!(f.core.check(&agent(), &c, None).unwrap(), Decision::Allow, "check does not consume");
    assert!(matches!(f.core.invoke(&agent(), "demo.echo", &json!({})).unwrap(), InvokeOutcome::Completed { .. }));
    assert!(matches!(f.core.check(&agent(), &c, None).unwrap(), Decision::Ask { .. }));
}

#[test]
fn invalid_principals_and_duplicate_tools_are_rejected() {
    let mut f = fixture();
    let bad = Principal { kind: PrincipalKind::Agent, id: String::new() };
    assert!(matches!(f.core.invoke(&bad, "demo.echo", &json!({})), Err(CoreError::Model(_))));
    let spec = ToolSpec::new("demo.echo", "", "demo.echo").unwrap();
    assert!(matches!(f.core.register_tool(spec, Box::new(|_| Ok(Value::Null))), Err(CoreError::DuplicateTool(_))));
}

#[test]
fn a_tool_spec_carries_a_json_schema_for_its_input() {
    let spec = ToolSpec::new("demo.schema", "has a schema", "demo.echo").unwrap();
    assert_eq!(spec.input_schema, json!({ "type": "object" }), "defaults to any object");
    let strict = spec.with_input_schema(json!({ "type": "object", "properties": { "q": { "type": "string" } }, "required": ["q"] }));
    assert_eq!(strict.input_schema["required"][0], "q");
}

#[test]
fn the_answer_to_a_question_can_be_collected_once_by_whoever_asked() {
    let mut f = fixture();
    let approved = pending_id(f.core.invoke(&agent(), "demo.echo", &json!({})).unwrap());
    let rejected = pending_id(f.core.invoke(&Principal::new(PrincipalKind::Agent, "other").unwrap(), "demo.echo", &json!({})).unwrap());
    assert_eq!(f.core.take_resolution(approved), None, "not answered yet");
    f.core.resolve(approved, true, Duration::Once).unwrap();
    f.core.resolve(rejected, false, Duration::Once).unwrap();
    assert_eq!(f.core.take_resolution(approved), Some(true));
    assert_eq!(f.core.take_resolution(rejected), Some(false));
    assert_eq!(f.core.take_resolution(approved), None, "collected once");
}

#[test]
fn a_question_can_be_withdrawn_when_its_asker_gives_up() {
    let mut f = fixture();
    let id = pending_id(f.core.invoke(&agent(), "demo.echo", &json!({})).unwrap());
    f.core.withdraw(id).unwrap();
    assert!(f.core.pending().is_empty());
    assert!(matches!(f.core.resolve(id, true, Duration::Once), Err(CoreError::UnknownRequest(_))));
    assert!(matches!(f.core.withdraw(id), Err(CoreError::UnknownRequest(_))));
    let kinds: Vec<String> = f.core.events(0, 50).unwrap().into_iter().map(|e| e.kind).collect();
    assert_eq!(kinds.last().map(String::as_str), Some("permission.withdrawn"));
    assert_eq!(f.core.take_resolution(id), None, "a withdrawn question has no answer");
}

#[test]
fn remembered_answers_are_bounded() {
    let mut f = fixture();
    let mut first = None;
    for i in 0..300 {
        let p = Principal::new(PrincipalKind::Agent, &format!("many-{i}")).unwrap();
        let id = pending_id(f.core.invoke(&p, "demo.echo", &json!({})).unwrap());
        first.get_or_insert(id);
        f.core.resolve(id, true, Duration::Once).unwrap();
    }
    assert_eq!(f.core.take_resolution(first.unwrap()), None, "the oldest answers are forgotten");
}

fn pending_id_of(outcome: InvokeOutcome) -> u64 {
    match outcome {
        InvokeOutcome::NeedsApproval { request_id } => request_id,
        other => panic!("expected a question, got {other:?}"),
    }
}

#[test]
fn origins_are_scheme_host_and_port_only() {
    for (url, origin) in [
        ("https://Example.com/path?q=1#frag", "https://example.com"),
        ("http://127.0.0.1:8080/x", "http://127.0.0.1:8080"),
        ("https://example.com:443/", "https://example.com:443"),
        ("HTTP://LOCALHOST", "http://localhost"),
        ("https://[::1]:3000/a", "https://[::1]:3000"),
        ("https://sub.example.co.uk?x=1", "https://sub.example.co.uk"),
    ] {
        assert_eq!(origin_of(url).unwrap(), origin, "{url}");
    }
    for bad in ["", "example.com", "file:///etc/passwd", "javascript:alert(1)", "data:text/html,x", "ftp://example.com", "https://", "https:///path", "https://user:pw@example.com/", "https://exa mple.com/", "https://example.com\\evil.com/", "http://a\nb.com/", "https://@example.com", "//example.com"] {
        assert!(origin_of(bad).is_err(), "{bad:?}");
    }
}

#[test]
fn a_tool_run_by_the_application_is_gated_and_then_handed_back_not_run_by_the_core() {
    let mut f = fixture();
    f.core.register_external_tool(ToolSpec::new("browser.tabs", "List tabs", "browser.list").unwrap()).unwrap();
    assert!(f.core.tools().iter().find(|t| t.name == "browser.tabs").unwrap().external);

    let id = pending_id_of(f.core.invoke(&agent(), "browser.tabs", &json!({})).unwrap());
    f.core.resolve(id, true, Duration::Once).unwrap();
    assert_eq!(f.core.invoke(&agent(), "browser.tabs", &json!({ "n": 1 })).unwrap(), InvokeOutcome::Dispatch);
    assert!(matches!(f.core.invoke(&agent(), "browser.tabs", &json!({})).unwrap(), InvokeOutcome::NeedsApproval { .. }), "the approval was used up");

    f.core.record_external_result(&agent(), "browser.tabs", true).unwrap();
    f.core.record_external_result(&agent(), "browser.tabs", false).unwrap();
    let kinds: Vec<String> = f.core.events(0, 100).unwrap().into_iter().map(|e| e.kind).collect();
    let started = kinds.iter().position(|k| k == "tool.started").unwrap();
    assert_eq!(&kinds[started..][..1], ["tool.started"]);
    assert!(kinds.ends_with(&["tool.completed".to_owned(), "tool.failed".to_owned()]), "{kinds:?}");
}

#[test]
fn a_person_can_use_an_application_tool_without_being_asked() {
    let mut f = fixture();
    f.core.register_external_tool(ToolSpec::new("browser.tabs", "List tabs", "browser.list").unwrap()).unwrap();
    assert_eq!(f.core.invoke(&person(), "browser.tabs", &json!({})).unwrap(), InvokeOutcome::Dispatch);
}

#[test]
fn recording_a_result_for_something_that_is_not_an_application_tool_is_refused() {
    let mut f = fixture();
    assert!(matches!(f.core.record_external_result(&agent(), "no.such", true), Err(CoreError::UnknownTool(_))));
    assert!(matches!(f.core.record_external_result(&agent(), "demo.echo", true), Err(CoreError::UnknownTool(_))), "tools the core runs itself are not reported on from outside");
}

#[test]
fn an_application_tool_cannot_take_the_name_of_another() {
    let mut f = fixture();
    assert!(matches!(f.core.register_external_tool(ToolSpec::new("demo.echo", "x", "demo.echo").unwrap()), Err(CoreError::DuplicateTool(_))));
}

#[test]
fn a_tool_scoped_to_an_origin_asks_about_the_origin_not_the_exact_address() {
    let mut f = fixture();
    let spec = ToolSpec::new("browser.open", "Open a page", "browser.navigate").unwrap().with_resource_arg("url").with_origin_resource();
    f.core.register_external_tool(spec).unwrap();

    let id = pending_id_of(f.core.invoke(&agent(), "browser.open", &json!({ "url": "https://Example.com/a/page?x=1" })).unwrap());
    assert_eq!(f.core.pending()[0].resource.as_deref(), Some("https://example.com"));
    f.core.resolve(id, true, Duration::Always).unwrap();

    assert_eq!(f.core.invoke(&agent(), "browser.open", &json!({ "url": "https://example.com/other?y=2#z" })).unwrap(), InvokeOutcome::Dispatch, "same origin, different page");
    assert!(matches!(f.core.invoke(&agent(), "browser.open", &json!({ "url": "https://example.org/" })).unwrap(), InvokeOutcome::NeedsApproval { .. }), "a different origin asks again");
    assert!(matches!(f.core.invoke(&agent(), "browser.open", &json!({ "url": "http://example.com/" })).unwrap(), InvokeOutcome::NeedsApproval { .. }), "so does a different scheme");
    assert!(matches!(f.core.invoke(&agent(), "browser.open", &json!({ "url": "https://example.com:8443/" })).unwrap(), InvokeOutcome::NeedsApproval { .. }), "and a different port");
}

#[test]
fn an_origin_scoped_tool_rejects_addresses_that_are_not_plain_web_origins() {
    let mut f = fixture();
    let spec = ToolSpec::new("browser.open", "Open a page", "browser.navigate").unwrap().with_resource_arg("url").with_origin_resource();
    f.core.register_external_tool(spec).unwrap();
    for bad in ["file:///C:/Windows/win.ini", "javascript:alert(1)", "https://user:pw@example.com/", "not a url", ""] {
        assert!(matches!(f.core.invoke(&agent(), "browser.open", &json!({ "url": bad })), Err(CoreError::InvalidArgs(_))), "{bad:?}");
    }
    assert!(matches!(f.core.invoke(&agent(), "browser.open", &json!({})), Err(CoreError::InvalidArgs(_))));
    assert!(f.core.pending().is_empty(), "a bad address never reaches a person as a question");
}

#[test]
fn an_origin_scoped_tool_must_say_which_argument_holds_the_address() {
    let mut f = fixture();
    let spec = ToolSpec::new("browser.open", "Open a page", "browser.navigate").unwrap().with_origin_resource();
    assert!(matches!(f.core.register_external_tool(spec), Err(CoreError::InvalidArgs(_))));
}

#[test]
fn the_newest_events_come_back_newest_first_and_bounded() {
    let mut f = fixture();
    for i in 0..5 {
        let id = pending_id_of(f.core.invoke(&Principal::new(PrincipalKind::Agent, &format!("agent-{i}")).unwrap(), "demo.echo", &json!({})).unwrap());
        f.core.resolve(id, false, Duration::Once).unwrap();
    }
    let newest = f.core.events_newest(3).unwrap();
    assert_eq!(newest.len(), 3);
    assert!(newest[0].seq > newest[1].seq && newest[1].seq > newest[2].seq);
    let all = f.core.events(0, 100).unwrap();
    assert_eq!(newest[0].seq, all.last().unwrap().seq);
    assert_eq!(f.core.events_newest(0).unwrap().len(), 1, "at least one is returned");
    assert_eq!(f.core.events_newest(100_000).unwrap().len(), all.len().min(500), "never more than a page");
}

#[test]
fn a_question_says_whether_it_can_only_ever_be_allowed_once() {
    let mut f = fixture();
    let exec = pending_id_of(f.core.invoke(&Principal::new(PrincipalKind::Agent, "a").unwrap(), "demo.exec", &json!({})).unwrap());
    let open = pending_id_of(f.core.invoke(&Principal::new(PrincipalKind::Agent, "a").unwrap(), "demo.open", &json!({ "url": "https://x.example/" })).unwrap());
    assert!(f.core.is_once_only(exec), "process.exec is a floor");
    assert!(!f.core.is_once_only(open));
    assert!(!f.core.is_once_only(9999), "an unknown question is not once-only");
}

// ---- approval mode through the whole core -------------------------------------------------------------------

use mobius_core::permissions::ApprovalMode;

#[test]
fn with_approvals_off_the_assistant_runs_tools_unasked_except_the_floors_and_manual_asks_again_afterwards() {
    let mut f = fixture();
    let a = Principal::new(PrincipalKind::Agent, "a").unwrap();
    pending_id_of(f.core.invoke(&a, "demo.echo", &json!({})).unwrap());
    f.core.set_approval_mode(ApprovalMode::Off).unwrap();
    assert!(matches!(f.core.invoke(&a, "demo.echo", &json!({})).unwrap(), InvokeOutcome::Completed { .. }));
    // Running a command is a floor: asked in every mode, Off too.
    pending_id_of(f.core.invoke(&a, "demo.exec", &json!({})).unwrap());
    f.core.set_approval_mode(ApprovalMode::Manual).unwrap();
    pending_id_of(f.core.invoke(&a, "demo.echo", &json!({})).unwrap());
}

#[test]
fn a_block_survives_the_off_mode() {
    let mut f = fixture();
    let a = Principal::new(PrincipalKind::Agent, "a").unwrap();
    let id = pending_id_of(f.core.invoke(&a, "demo.exec", &json!({})).unwrap());
    f.core.resolve(id, false, Duration::Always).unwrap();
    f.core.set_approval_mode(ApprovalMode::Off).unwrap();
    assert!(matches!(f.core.invoke(&a, "demo.exec", &json!({})).unwrap(), InvokeOutcome::Denied { .. }));
}

#[test]
fn a_change_of_mode_is_in_the_log_and_leaves_no_arguments() {
    let mut f = fixture();
    assert_eq!(f.core.approval_mode(), ApprovalMode::Manual);
    f.core.set_approval_mode(ApprovalMode::Off).unwrap();
    assert_eq!(f.core.approval_mode(), ApprovalMode::Off);
    let events = f.core.events(0, 100).unwrap();
    let change = events.iter().find(|e| e.kind == "permission.mode").expect("a log entry for the change");
    assert_eq!(change.detail, json!({ "mode": "off" }));
}

#[test]
fn a_question_can_be_narrowed_to_allow_once_and_then_the_core_enforces_it() {
    let mut f = fixture();
    let a = Principal::new(PrincipalKind::Agent, "a").unwrap();
    let id = pending_id_of(f.core.invoke(&a, "demo.open", &json!({ "url": "https://x.example/" })).unwrap());
    assert!(!f.core.is_once_only(id));
    f.core.require_once(id);
    assert!(f.core.is_once_only(id));
    assert!(matches!(f.core.resolve(id, true, Duration::Always), Err(CoreError::StandingNotAllowed(_))));
    f.core.resolve(id, true, Duration::Once).unwrap();
    assert!(!f.core.is_once_only(id), "answered, so nothing is left");
    f.core.require_once(9999);
    assert!(!f.core.is_once_only(9999), "an unknown question stays unknown");
}

#[test]
fn smart_mode_asks_in_the_core_like_manual() {
    let mut f = fixture();
    let a = Principal::new(PrincipalKind::Agent, "a").unwrap();
    f.core.set_approval_mode(ApprovalMode::Smart).unwrap();
    let id = pending_id_of(f.core.invoke(&a, "demo.open", &json!({ "url": "https://x.example/" })).unwrap());
    assert!(!f.core.is_once_only(id));
    f.core.resolve(id, true, Duration::Always).unwrap();
    assert!(matches!(f.core.invoke(&a, "demo.open", &json!({ "url": "https://x.example/" })).unwrap(), InvokeOutcome::Completed { .. }));
}
