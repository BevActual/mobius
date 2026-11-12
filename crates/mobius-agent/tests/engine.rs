#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
//! The turn engine against a real core and a scripted provider: the behaviour a conversation depends on.
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use mobius_agent::engine::{AgentEvent, Engine, EngineConfig, Step, Turn, TurnSetup};
use mobius_agent::message::{Message, ToolCall};
use mobius_agent::provider::{ChatRequest, Completion, Provider, ProviderError, ScriptedProvider, StopReason};
use mobius_agent::untrusted;
use mobius_core::core::{Core, ToolSpec};
use mobius_core::model::{Duration, Principal, PrincipalKind};
use mobius_core::permissions::ApprovalMode;
use serde_json::{Value, json};

fn agent() -> Principal {
    Principal::new(PrincipalKind::Agent, "mobius-agent").unwrap()
}

struct World {
    core: Core,
    engine: Engine,
    runs: Arc<AtomicUsize>,
}

fn world(max_steps: u32) -> World {
    let mut core = Core::open_in_memory(Box::new(|| 1_000)).unwrap();
    let runs = Arc::new(AtomicUsize::new(0));
    let counter = runs.clone();
    core.register_tool(
        ToolSpec::new("demo.echo", "Returns its arguments.", "demo.echo").unwrap().with_input_schema(json!({ "type": "object", "properties": { "text": { "type": "string" } } })),
        Box::new(move |args| {
            counter.fetch_add(1, Ordering::SeqCst);
            Ok(json!({ "echo": args.clone() }))
        }),
    )
    .unwrap();
    core.register_tool(ToolSpec::new("demo.fail", "Always fails.", "demo.fail").unwrap(), Box::new(|_| Err("it broke".to_owned()))).unwrap();
    core.register_tool(ToolSpec::new("demo.panic", "Always panics.", "demo.panic").unwrap(), Box::new(|_| panic!("handler bug"))).unwrap();
    core.register_external_tool(ToolSpec::new("demo.remote", "Run by the application.", "demo.remote").unwrap()).unwrap();
    core.register_tool(ToolSpec::new("demo.big", "Returns a huge result.", "demo.big").unwrap(), Box::new(|_| Ok(json!({ "blob": "x".repeat(100_000) })))).unwrap();
    let engine = Engine::new(EngineConfig { model: "test-model".into(), system: "You are a test.".into(), max_steps, principal: agent() });
    World { core, engine, runs }
}

fn allow_always(w: &mut World, tool: &str) {
    let outcome = w.core.invoke(&agent(), tool, &json!({})).unwrap();
    let id = match outcome {
        mobius_core::core::InvokeOutcome::NeedsApproval { request_id } => request_id,
        other => panic!("{other:?}"),
    };
    w.core.resolve(id, true, Duration::Always).unwrap();
}

fn call(id: &str, name: &str, arguments: Value) -> ToolCall {
    ToolCall { id: id.into(), name: name.into(), arguments }
}
fn text(t: &str) -> Result<Completion, ProviderError> {
    Ok(Completion { text: t.into(), tool_calls: vec![], stop: StopReason::EndTurn })
}
fn calls(t: &str, calls: Vec<ToolCall>) -> Result<Completion, ProviderError> {
    Ok(Completion { text: t.into(), tool_calls: calls, stop: StopReason::ToolUse })
}

/// Play model calls until the turn needs something other than a model.
fn drive(w: &mut World, turn: &mut Turn, provider: &ScriptedProvider, mut step: Step) -> Step {
    loop {
        match step {
            Step::CallModel(request) => {
                let result = provider.complete(&request, &mut |_| true);
                step = w.engine.on_model(turn, &mut w.core, result);
            }
            other => return other,
        }
    }
}

fn tool_messages(turn: &Turn) -> Vec<(String, String, bool)> {
    turn.messages().iter().filter_map(|m| match m { Message::Tool { call_id, content, is_error, .. } => Some((call_id.clone(), content.clone(), *is_error)), _ => None }).collect()
}

#[test]
fn a_plain_answer_ends_the_turn_and_the_first_request_describes_the_conversation() {
    let mut w = world(10);
    let provider = ScriptedProvider::new(vec![text("Hello there.")]);
    let (mut turn, step) = w.engine.start(&w.core, vec![Message::user("earlier"), Message::Assistant { text: "ok".into(), tool_calls: vec![] }], "hi", 7);
    assert_eq!(turn.id, 7);
    let request: ChatRequest = match &step { Step::CallModel(r) => r.clone(), other => panic!("{other:?}") };
    assert_eq!(request.model, "test-model");
    assert_eq!(request.system, with_rule("You are a test."));
    assert_eq!(request.messages.len(), 3);
    assert!(matches!(&request.messages[2], Message::User { text, at_ms: Some(_), .. } if text == "hi"), "the new message carries the time it was sent");
    let names: Vec<&str> = request.tools.iter().map(|t| t.name.as_str()).collect();
    assert_eq!(names, ["demo.big", "demo.echo", "demo.fail", "demo.panic", "demo.remote", "todo.write", "ask.person"], "every registered tool is offered, in a stable order, then the engine's own");
    assert_eq!(request.tools[1].input_schema["properties"]["text"]["type"], "string");

    assert_eq!(drive(&mut w, &mut turn, &provider, step), Step::Done);
    assert!(turn.is_finished());
    assert_eq!(turn.messages().last(), Some(&Message::Assistant { text: "Hello there.".into(), tool_calls: vec![] }));
    let events = turn.drain_events();
    assert!(matches!(events[0], AgentEvent::Context { used, limit } if used > 0 && limit > used), "each model call says how full the window is: {:?}", events[0]);
    assert_eq!(events[1..], [AgentEvent::Message { text: "Hello there.".into() }, AgentEvent::Done]);
    assert!(turn.drain_events().is_empty(), "events are handed over once");
}

#[test]
fn an_allowed_tool_call_runs_and_its_result_goes_back_to_the_model() {
    let mut w = world(10);
    allow_always(&mut w, "demo.echo");
    let provider = ScriptedProvider::new(vec![calls("Let me check.", vec![call("c1", "demo.echo", json!({ "text": "ping" }))]), text("It said ping.")]);
    let (mut turn, step) = w.engine.start(&w.core, vec![], "echo ping", 1);
    assert_eq!(drive(&mut w, &mut turn, &provider, step), Step::Done);
    assert_eq!(w.runs.load(Ordering::SeqCst), 1);
    let results = tool_messages(&turn);
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].0, "c1");
    assert!(results[0].1.contains("ping") && !results[0].2);
    let second = &provider.requests()[1];
    assert!(matches!(second.messages.last(), Some(Message::Tool { .. })), "the tool result is the newest message the model sees");
    assert!(second.messages.iter().any(|m| matches!(m, Message::Tool { call_id, .. } if call_id == "c1")));
    let kinds: Vec<AgentEvent> = turn.drain_events().into_iter().filter(|e| !matches!(e, AgentEvent::Context { .. })).collect();
    assert_eq!(kinds[0], AgentEvent::Message { text: "Let me check.".into() });
    // With what it was called with, so the conversation can name it.
    assert_eq!(kinds[1], AgentEvent::ToolCall { call_id: "c1".into(), name: "demo.echo".into(), arguments: json!({ "text": "ping" }) });
    assert_eq!(kinds[2], AgentEvent::ToolResult { call_id: "c1".into(), name: "demo.echo".into(), is_error: false });
}

#[test]
fn a_tool_that_needs_approval_parks_the_turn_and_resumes_when_approved() {
    let mut w = world(10);
    let provider = ScriptedProvider::new(vec![calls("", vec![call("c1", "demo.echo", json!({ "text": "hi" }))]), text("Done.")]);
    let (mut turn, step) = w.engine.start(&w.core, vec![], "go", 1);
    let request_id = match drive(&mut w, &mut turn, &provider, step) { Step::AwaitApproval { request_id } => request_id, other => panic!("{other:?}") };
    assert_eq!(turn.parked_request(), Some(request_id));
    assert_eq!(w.core.pending().len(), 1);
    assert_eq!(w.runs.load(Ordering::SeqCst), 0, "nothing ran before approval");
    assert!(turn.drain_events().contains(&AgentEvent::NeedsApproval { request_id, call_id: "c1".into(), tool: "demo.echo".into(), arguments: json!({ "text": "hi" }), once_only: false, origin: None }));

    w.core.resolve(request_id, true, Duration::Once).unwrap();
    let step = w.engine.on_approval(&mut turn, &mut w.core, request_id, true);
    assert_eq!(drive(&mut w, &mut turn, &provider, step), Step::Done);
    assert_eq!(w.runs.load(Ordering::SeqCst), 1);
    assert_eq!(turn.parked_request(), None);
    assert!(!tool_messages(&turn)[0].2);
}

#[test]
fn a_declined_tool_is_reported_to_the_model_and_never_runs() {
    let mut w = world(10);
    let provider = ScriptedProvider::new(vec![calls("", vec![call("c1", "demo.echo", json!({}))]), text("Understood, I will not.")]);
    let (mut turn, step) = w.engine.start(&w.core, vec![], "go", 1);
    let request_id = match drive(&mut w, &mut turn, &provider, step) { Step::AwaitApproval { request_id } => request_id, other => panic!("{other:?}") };
    w.core.resolve(request_id, false, Duration::Once).unwrap();
    let step = w.engine.on_approval(&mut turn, &mut w.core, request_id, false);
    assert_eq!(drive(&mut w, &mut turn, &provider, step), Step::Done);
    assert_eq!(w.runs.load(Ordering::SeqCst), 0);
    let results = tool_messages(&turn);
    assert!(results[0].2 && results[0].1.contains("declined"), "{results:?}");
    assert!(w.core.pending().is_empty(), "declining must not loop back into asking again");
}

#[test]
fn every_call_in_one_reply_gets_exactly_one_result_in_order_even_across_a_pause() {
    let mut w = world(10);
    allow_always(&mut w, "demo.fail");
    let provider = ScriptedProvider::new(vec![
        calls("", vec![call("a", "demo.fail", json!({})), call("b", "demo.echo", json!({ "text": "second" })), call("c", "demo.fail", json!({}))]),
        text("ok"),
    ]);
    let (mut turn, step) = w.engine.start(&w.core, vec![], "go", 1);
    let request_id = match drive(&mut w, &mut turn, &provider, step) { Step::AwaitApproval { request_id } => request_id, other => panic!("{other:?}") };
    assert_eq!(tool_messages(&turn).len(), 1, "the first call already finished");
    w.core.resolve(request_id, true, Duration::Once).unwrap();
    let step = w.engine.on_approval(&mut turn, &mut w.core, request_id, true);
    assert_eq!(drive(&mut w, &mut turn, &provider, step), Step::Done);
    let ids: Vec<String> = tool_messages(&turn).into_iter().map(|r| r.0).collect();
    assert_eq!(ids, ["a", "b", "c"]);
    assert_eq!(provider.requests().len(), 2, "the model is called again only after every call has a result");
}

#[test]
fn bad_tool_calls_become_errors_the_model_can_recover_from() {
    let mut w = world(10);
    allow_always(&mut w, "demo.echo");
    allow_always(&mut w, "demo.fail");
    allow_always(&mut w, "demo.panic");
    let provider = ScriptedProvider::new(vec![
        calls("", vec![
            call("unknown", "no.such_tool", json!({})),
            call("notobject", "demo.echo", json!("a string, not an object")),
            call("fail", "demo.fail", json!({})),
            call("panic", "demo.panic", json!({})),
        ]),
        text("recovered"),
    ]);
    let (mut turn, step) = w.engine.start(&w.core, vec![], "go", 1);
    assert_eq!(drive(&mut w, &mut turn, &provider, step), Step::Done);
    let results = tool_messages(&turn);
    assert_eq!(results.len(), 4);
    assert!(results.iter().all(|r| r.2), "all four are errors: {results:?}");
    assert!(results[0].1.contains("unknown tool"));
    assert!(results[1].1.contains("object"));
    assert!(results[2].1.contains("it broke"));
    assert_eq!(w.runs.load(Ordering::SeqCst), 0);
}

#[test]
fn a_standing_rule_against_a_tool_is_reported_not_retried() {
    let mut w = world(10);
    let first = match w.core.invoke(&agent(), "demo.echo", &json!({})).unwrap() { mobius_core::core::InvokeOutcome::NeedsApproval { request_id } => request_id, other => panic!("{other:?}") };
    w.core.resolve(first, false, Duration::Always).unwrap();
    let provider = ScriptedProvider::new(vec![calls("", vec![call("c1", "demo.echo", json!({}))]), text("ok")]);
    let (mut turn, step) = w.engine.start(&w.core, vec![], "go", 1);
    assert_eq!(drive(&mut w, &mut turn, &provider, step), Step::Done);
    let results = tool_messages(&turn);
    assert!(results[0].2 && results[0].1.contains("denied"), "{results:?}");
}

#[test]
fn a_huge_tool_result_is_cut_down_before_it_reaches_the_model() {
    let mut w = world(10);
    allow_always(&mut w, "demo.big");
    let provider = ScriptedProvider::new(vec![calls("", vec![call("c1", "demo.big", json!({}))]), text("ok")]);
    let (mut turn, step) = w.engine.start(&w.core, vec![], "go", 1);
    drive(&mut w, &mut turn, &provider, step);
    let content = &tool_messages(&turn)[0].1;
    let content = untrusted::unwrap(content).unwrap().1;
    assert!(content.len() < 40_000, "{}", content.len());
    assert!(content.ends_with("[truncated]"));
}

#[test]
fn a_model_that_never_stops_calling_tools_is_stopped() {
    let mut w = world(3);
    allow_always(&mut w, "demo.echo");
    let forever: Vec<_> = (0..10).map(|i| calls("", vec![call(&format!("c{i}"), "demo.echo", json!({}))])).collect();
    let provider = ScriptedProvider::new(forever);
    let (mut turn, step) = w.engine.start(&w.core, vec![], "go", 1);
    match drive(&mut w, &mut turn, &provider, step) {
        Step::Failed { message } => assert!(message.contains("too many steps"), "{message}"),
        other => panic!("{other:?}"),
    }
    assert!(turn.is_finished());
    assert_eq!(provider.requests().len(), 3);
}

#[test]
fn a_provider_error_fails_the_turn_with_a_readable_message() {
    let mut w = world(10);
    let provider = ScriptedProvider::new(vec![Err(ProviderError::Http { status: 401, message: "bad key".into() })]);
    let (mut turn, step) = w.engine.start(&w.core, vec![], "go", 1);
    match drive(&mut w, &mut turn, &provider, step) {
        Step::Failed { message } => assert!(message.contains("401")),
        other => panic!("{other:?}"),
    }
    assert!(turn.drain_events().iter().any(|e| matches!(e, AgentEvent::Failed { .. })));
}

#[test]
fn cancelling_a_parked_turn_withdraws_its_question_and_closes_every_open_call() {
    let mut w = world(10);
    let provider = ScriptedProvider::new(vec![calls("", vec![call("a", "demo.echo", json!({})), call("b", "demo.echo", json!({}))]), text("never used")]);
    let (mut turn, step) = w.engine.start(&w.core, vec![], "go", 1);
    let request_id = match drive(&mut w, &mut turn, &provider, step) { Step::AwaitApproval { request_id } => request_id, other => panic!("{other:?}") };
    w.engine.cancel(&mut turn, &mut w.core);
    assert!(turn.is_finished());
    assert!(w.core.pending().is_empty(), "the question went away with the turn");
    let results = tool_messages(&turn);
    assert_eq!(results.iter().map(|r| r.0.as_str()).collect::<Vec<_>>(), ["a", "b"], "the conversation stays valid for the next turn");
    assert!(turn.drain_events().contains(&AgentEvent::Cancelled));
    // A late model result or a late answer is ignored.
    assert_eq!(w.engine.on_model(&mut turn, &mut w.core, text("late")), Step::Done);
    assert_eq!(w.engine.on_approval(&mut turn, &mut w.core, request_id, true), Step::Done);
    assert_eq!(w.runs.load(Ordering::SeqCst), 0);
}

#[test]
fn an_answer_to_some_other_question_does_not_disturb_a_parked_turn() {
    let mut w = world(10);
    let provider = ScriptedProvider::new(vec![calls("", vec![call("a", "demo.echo", json!({}))])]);
    let (mut turn, step) = w.engine.start(&w.core, vec![], "go", 1);
    let request_id = match drive(&mut w, &mut turn, &provider, step) { Step::AwaitApproval { request_id } => request_id, other => panic!("{other:?}") };
    assert_eq!(w.engine.on_approval(&mut turn, &mut w.core, request_id + 100, true), Step::AwaitApproval { request_id });
    assert_eq!(turn.parked_request(), Some(request_id));
}

fn expect_run(step: Step) -> (String, String, Value) {
    match step {
        Step::RunTool { call_id, name, arguments } => (call_id, name, arguments),
        other => panic!("expected a tool for the application to run, got {other:?}"),
    }
}

#[test]
fn a_tool_run_by_the_application_is_handed_out_and_its_result_continues_the_turn() {
    let mut w = world(10);
    allow_always(&mut w, "demo.remote");
    let provider = ScriptedProvider::new(vec![calls("", vec![call("r1", "demo.remote", json!({ "n": 1 }))]), text("All done.")]);
    let (mut turn, step) = w.engine.start(&w.core, vec![], "go", 1);
    let step = drive(&mut w, &mut turn, &provider, step);
    assert_eq!(expect_run(step), ("r1".to_owned(), "demo.remote".to_owned(), json!({ "n": 1 })));
    assert!(tool_messages(&turn).is_empty(), "nothing is reported until the application answers");
    assert_eq!(turn.dispatched_call().map(|c| c.id.as_str()), Some("r1"));

    let step = w.engine.on_tool_result(&mut turn, &mut w.core, "r1", Ok("{\"title\":\"Home\"}".to_owned()));
    assert_eq!(drive(&mut w, &mut turn, &provider, step), Step::Done);
    assert_eq!(tool_messages(&turn), [("r1".to_owned(), untrusted::wrap("demo.remote", &json!({}), "{\"title\":\"Home\"}"), false)]);
    assert_eq!(turn.dispatched_call(), None);
    assert!(turn.drain_events().contains(&AgentEvent::ToolResult { call_id: "r1".into(), name: "demo.remote".into(), is_error: false }));
    let kinds: Vec<String> = w.core.events(0, 100).unwrap().into_iter().map(|e| e.kind).collect();
    assert!(kinds.contains(&"tool.completed".to_owned()));
}

#[test]
fn an_application_tool_that_failed_is_an_error_the_model_can_see() {
    let mut w = world(10);
    allow_always(&mut w, "demo.remote");
    let provider = ScriptedProvider::new(vec![calls("", vec![call("r1", "demo.remote", json!({}))]), text("Sorry.")]);
    let (mut turn, step) = w.engine.start(&w.core, vec![], "go", 1);
    let step = drive(&mut w, &mut turn, &provider, step);
    expect_run(step);
    let step = w.engine.on_tool_result(&mut turn, &mut w.core, "r1", Err("the page did not load".to_owned()));
    drive(&mut w, &mut turn, &provider, step);
    assert_eq!(untrusted::unwrap(&tool_messages(&turn)[0].1).unwrap().1, "the page did not load");
    assert!(tool_messages(&turn)[0].2);
    let kinds: Vec<String> = w.core.events(0, 100).unwrap().into_iter().map(|e| e.kind).collect();
    assert!(kinds.contains(&"tool.failed".to_owned()));
}

#[test]
fn calls_after_an_application_tool_wait_their_turn_and_keep_their_order() {
    let mut w = world(10);
    allow_always(&mut w, "demo.remote");
    allow_always(&mut w, "demo.echo");
    let provider = ScriptedProvider::new(vec![
        calls("", vec![call("a", "demo.echo", json!({ "text": "first" })), call("b", "demo.remote", json!({})), call("c", "demo.echo", json!({ "text": "third" }))]),
        text("ok"),
    ]);
    let (mut turn, step) = w.engine.start(&w.core, vec![], "go", 1);
    let step = drive(&mut w, &mut turn, &provider, step);
    assert_eq!(expect_run(step).0, "b");
    assert_eq!(w.runs.load(Ordering::SeqCst), 1, "only the first echo has run");
    let step = w.engine.on_tool_result(&mut turn, &mut w.core, "b", Ok("remote".to_owned()));
    assert_eq!(drive(&mut w, &mut turn, &provider, step), Step::Done);
    assert_eq!(tool_messages(&turn).iter().map(|r| r.0.as_str()).collect::<Vec<_>>(), ["a", "b", "c"]);
    assert_eq!(w.runs.load(Ordering::SeqCst), 2);
}

#[test]
fn an_application_tool_asks_first_and_runs_only_after_approval() {
    let mut w = world(10);
    let provider = ScriptedProvider::new(vec![calls("", vec![call("r1", "demo.remote", json!({}))]), text("ok")]);
    let (mut turn, step) = w.engine.start(&w.core, vec![], "go", 1);
    let request_id = match drive(&mut w, &mut turn, &provider, step) { Step::AwaitApproval { request_id } => request_id, other => panic!("{other:?}") };
    assert_eq!(turn.dispatched_call(), None, "nothing is handed out while a person is deciding");
    w.core.resolve(request_id, true, Duration::Once).unwrap();
    let step = w.engine.on_approval(&mut turn, &mut w.core, request_id, true);
    assert_eq!(expect_run(step).0, "r1");
}

#[test]
fn an_answer_for_a_call_that_is_not_running_is_ignored() {
    let mut w = world(10);
    allow_always(&mut w, "demo.remote");
    let provider = ScriptedProvider::new(vec![calls("", vec![call("r1", "demo.remote", json!({}))]), text("ok")]);
    let (mut turn, step) = w.engine.start(&w.core, vec![], "go", 1);
    expect_run(drive(&mut w, &mut turn, &provider, step));
    assert_eq!(w.engine.on_tool_result(&mut turn, &mut w.core, "someone-else", Ok("x".to_owned())), Step::Idle);
    assert!(tool_messages(&turn).is_empty());
    assert_eq!(turn.dispatched_call().map(|c| c.id.as_str()), Some("r1"), "still waiting for the right answer");
    let step = w.engine.on_tool_result(&mut turn, &mut w.core, "r1", Ok("y".to_owned()));
    drive(&mut w, &mut turn, &provider, step);
    assert_eq!(w.engine.on_tool_result(&mut turn, &mut w.core, "r1", Ok("again".to_owned())), Step::Done, "a second answer changes nothing");
    assert_eq!(tool_messages(&turn).len(), 1);
}

#[test]
fn cancelling_while_the_application_is_working_closes_the_call_and_ignores_its_late_answer() {
    let mut w = world(10);
    allow_always(&mut w, "demo.remote");
    allow_always(&mut w, "demo.echo");
    let provider = ScriptedProvider::new(vec![calls("", vec![call("r1", "demo.remote", json!({})), call("e1", "demo.echo", json!({}))])]);
    let (mut turn, step) = w.engine.start(&w.core, vec![], "go", 1);
    expect_run(drive(&mut w, &mut turn, &provider, step));
    w.engine.cancel(&mut turn, &mut w.core);
    assert!(turn.is_finished());
    assert_eq!(tool_messages(&turn).iter().map(|r| (r.0.as_str(), r.2)).collect::<Vec<_>>(), [("r1", true), ("e1", true)], "every call has a result, so the conversation stays valid");
    assert_eq!(w.engine.on_tool_result(&mut turn, &mut w.core, "r1", Ok("late".to_owned())), Step::Done);
    assert_eq!(tool_messages(&turn).len(), 2);
    assert_eq!(w.runs.load(Ordering::SeqCst), 0);
}

#[test]
fn a_huge_answer_from_the_application_is_cut_down() {
    let mut w = world(10);
    allow_always(&mut w, "demo.remote");
    let provider = ScriptedProvider::new(vec![calls("", vec![call("r1", "demo.remote", json!({}))]), text("ok")]);
    let (mut turn, step) = w.engine.start(&w.core, vec![], "go", 1);
    expect_run(drive(&mut w, &mut turn, &provider, step));
    let step = w.engine.on_tool_result(&mut turn, &mut w.core, "r1", Ok("x".repeat(200_000)));
    drive(&mut w, &mut turn, &provider, step);
    let content = &tool_messages(&turn)[0].1;
    let content = untrusted::unwrap(content).unwrap().1;
    assert!(content.len() < 40_000 && content.ends_with("[truncated]"));
}

// ---- smart approvals: a reviewer model looks first -----------------------------------------------------------

fn smart_world() -> World {
    let mut w = world(10);
    w.core.set_approval_mode(ApprovalMode::Smart).unwrap();
    w
}

/// Run until the engine asks for a review of the first tool call.
fn reach_review(w: &mut World, turn: &mut Turn, step: Step) -> (u64, ChatRequest) {
    let provider = ScriptedProvider::new(vec![calls("", vec![call("c1", "demo.echo", json!({ "text": "hi" }))]), text("Done.")]);
    match drive(w, turn, &provider, step) {
        Step::Review { request_id, request } => (request_id, request),
        other => panic!("{other:?}"),
    }
}

/// Paying, sending, deleting and running commands ask in every mode: in Act a floor goes to the person, never to the
/// reviewer, and in Propose and Ask first it is asked as well.
#[test]
fn a_floor_is_asked_of_the_person_in_every_mode_and_never_reviewed() {
    for mode in [ApprovalMode::Manual, ApprovalMode::Propose, ApprovalMode::Smart] {
        let mut w = world(10);
        w.core.register_tool(ToolSpec::new("demo.run", "Runs a command.", "process.exec").unwrap(), Box::new(|_| Ok(json!({ "ran": true })))).unwrap();
        w.core.register_tool(ToolSpec::new("demo.delete", "Deletes a file.", "fs.delete").unwrap(), Box::new(|_| Ok(json!({ "gone": true })))).unwrap();
        w.core.set_approval_mode(mode).unwrap();
        for tool in ["demo.run", "demo.delete"] {
            let provider = ScriptedProvider::new(vec![calls("", vec![call("c1", tool, json!({}))]), text("Done.")]);
            let (mut turn, step) = w.engine.start(&w.core, vec![], "go", 1);
            match drive(&mut w, &mut turn, &provider, step) {
                Step::AwaitApproval { request_id } => assert!(w.core.is_once_only(request_id), "{mode:?} {tool}: allow once only"),
                other => panic!("{mode:?} {tool}: expected the person to be asked, got {other:?}"),
            }
        }
    }
}

fn verdict(word: &str) -> Result<Completion, ProviderError> {
    text(word)
}

#[test]
fn in_smart_mode_a_question_goes_to_the_reviewer_first_and_the_person_is_not_asked_yet() {
    let mut w = smart_world();
    let (mut turn, step) = w.engine.start(&w.core, vec![], "go", 1);
    let (request_id, request) = reach_review(&mut w, &mut turn, step);
    assert!(request.tools.is_empty());
    assert!(matches!(&request.messages[0], Message::User { text, .. } if text.contains("demo.echo") && text.contains("hi")));
    assert!(turn.is_reviewing());
    assert_eq!(turn.parked_request(), Some(request_id));
    assert!(!turn.drain_events().iter().any(|e| matches!(e, AgentEvent::NeedsApproval { .. })), "nobody is asked while the reviewer looks");
    assert_eq!(w.runs.load(Ordering::SeqCst), 0);
}

#[test]
fn an_approval_from_the_reviewer_runs_that_one_call_and_leaves_no_standing_permission() {
    let mut w = smart_world();
    let (mut turn, step) = w.engine.start(&w.core, vec![], "go", 1);
    let (request_id, _) = reach_review(&mut w, &mut turn, step);
    let provider = ScriptedProvider::new(vec![calls("", vec![call("c2", "demo.echo", json!({ "text": "again" }))]), text("Done.")]);
    let step = w.engine.on_review(&mut turn, &mut w.core, request_id, verdict("APPROVE"));
    assert!(matches!(step, Step::CallModel(_)), "the call ran and the model carries on: {step:?}");
    assert_eq!(w.runs.load(Ordering::SeqCst), 1);
    assert!(!turn.drain_events().iter().any(|e| matches!(e, AgentEvent::NeedsApproval { .. })));
    assert!(w.core.grants().iter().all(|g| g.duration != Duration::Always && g.duration != Duration::Session), "nothing standing was created");
    // The same call again is reviewed again.
    let mut step = step;
    if let Step::CallModel(request) = &step {
        let result = provider.complete(request, &mut |_| true);
        step = w.engine.on_model(&mut turn, &mut w.core, result);
    }
    assert!(matches!(step, Step::Review { .. }), "{step:?}");
}

#[test]
fn a_deny_from_the_reviewer_asks_the_person_who_can_allow_it_once_but_never_always() {
    let mut w = smart_world();
    let (mut turn, step) = w.engine.start(&w.core, vec![], "go", 1);
    let (request_id, _) = reach_review(&mut w, &mut turn, step);
    let step = w.engine.on_review(&mut turn, &mut w.core, request_id, verdict("DENY"));
    assert_eq!(step, Step::AwaitApproval { request_id });
    assert!(!turn.is_reviewing());
    assert!(turn.parked_once_only());
    assert!(turn.drain_events().contains(&AgentEvent::NeedsApproval { request_id, call_id: "c1".into(), tool: "demo.echo".into(), arguments: json!({ "text": "hi" }), once_only: true, origin: None }));
    assert_eq!(w.runs.load(Ordering::SeqCst), 0, "a deny does not run anything");
    assert!(w.core.resolve(request_id, true, Duration::Always).is_err());
    w.core.resolve(request_id, true, Duration::Once).unwrap();
}

#[test]
fn unsure_wordy_empty_or_failed_reviews_all_ask_the_person_normally() {
    let answers: Vec<Result<Completion, ProviderError>> = vec![
        verdict("ESCALATE"),
        verdict("APPROVE because it is fine"),
        verdict(""),
        verdict("I think this is safe"),
        Err(ProviderError::Network("down".into())),
        Err(ProviderError::Http { status: 500, message: "SECRET-DETAIL".into() }),
    ];
    for answer in answers {
        let mut w = smart_world();
        let (mut turn, step) = w.engine.start(&w.core, vec![], "go", 1);
        let (request_id, _) = reach_review(&mut w, &mut turn, step);
        let step = w.engine.on_review(&mut turn, &mut w.core, request_id, answer.clone());
        assert_eq!(step, Step::AwaitApproval { request_id }, "{answer:?}");
        assert!(!turn.parked_once_only(), "an unsure review does not narrow the answer");
        let events = turn.drain_events();
        assert!(events.contains(&AgentEvent::NeedsApproval { request_id, call_id: "c1".into(), tool: "demo.echo".into(), arguments: json!({ "text": "hi" }), once_only: false, origin: None }));
        assert_eq!(w.runs.load(Ordering::SeqCst), 0);
        assert!(!format!("{events:?}").contains("SECRET-DETAIL"));
    }
}

#[test]
fn a_review_for_another_question_or_a_finished_turn_changes_nothing() {
    let mut w = smart_world();
    let (mut turn, step) = w.engine.start(&w.core, vec![], "go", 1);
    let (request_id, _) = reach_review(&mut w, &mut turn, step);
    let step = w.engine.on_review(&mut turn, &mut w.core, request_id + 50, verdict("APPROVE"));
    assert_eq!(step, Step::AwaitApproval { request_id });
    assert!(turn.is_reviewing());
    assert_eq!(w.runs.load(Ordering::SeqCst), 0);
    w.engine.cancel(&mut turn, &mut w.core);
    assert!(w.core.pending().is_empty(), "cancelling withdraws the question");
    assert_eq!(w.engine.on_review(&mut turn, &mut w.core, request_id, verdict("APPROVE")), Step::Done);
    assert_eq!(w.runs.load(Ordering::SeqCst), 0);
}

#[test]
fn an_answer_that_arrives_twice_runs_the_call_once() {
    let mut w = smart_world();
    let (mut turn, step) = w.engine.start(&w.core, vec![], "go", 1);
    let (request_id, _) = reach_review(&mut w, &mut turn, step);
    w.engine.on_review(&mut turn, &mut w.core, request_id, verdict("APPROVE"));
    w.engine.on_review(&mut turn, &mut w.core, request_id, verdict("APPROVE"));
    assert_eq!(w.runs.load(Ordering::SeqCst), 1);
}

#[test]
fn outside_smart_mode_no_reviewer_is_ever_asked() {
    for mode in [ApprovalMode::Manual, ApprovalMode::Off] {
        let mut w = world(10);
        w.core.set_approval_mode(mode).unwrap();
        let provider = ScriptedProvider::new(vec![calls("", vec![call("c1", "demo.echo", json!({}))]), text("Done.")]);
        let (mut turn, step) = w.engine.start(&w.core, vec![], "go", 1);
        let end = drive(&mut w, &mut turn, &provider, step);
        assert!(!matches!(end, Step::Review { .. }), "{mode:?}");
    }
}

#[test]
fn the_chosen_effort_goes_to_the_model_but_never_to_the_reviewer() {
    let mut w = smart_world();
    w.engine.set_effort(Some("high".to_owned()));
    let (turn, step) = w.engine.start(&w.core, vec![], "go", 1);
    let Step::CallModel(first) = &step else { panic!("{step:?}") };
    assert_eq!(first.effort.as_deref(), Some("high"));
    let mut turn = turn;
    let (_, review) = reach_review(&mut w, &mut turn, step);
    assert_eq!(review.effort, None, "a one-word verdict needs no extra thinking");
    w.engine.set_effort(None);
    let (_turn, step) = w.engine.start(&w.core, vec![], "again", 2);
    let Step::CallModel(second) = &step else { panic!("{step:?}") };
    assert_eq!(second.effort, None);
}

#[test]
fn a_turn_can_use_its_own_instructions_and_model_and_the_reviewer_asks_the_same_model() {
    let mut w = smart_world();
    let setup = TurnSetup { system: Some("You are the research bot.".to_owned()), model: Some("research-model".to_owned()), plan_only: false, images: vec![], project: None };
    let (mut turn, step) = w.engine.start_with(&w.core, vec![], "go", 1, setup);
    let Step::CallModel(first) = &step else { panic!("{step:?}") };
    assert_eq!((first.model.as_str(), first.system.as_str()), ("research-model", with_rule("You are the research bot.").as_str()));
    let (_, review) = reach_review(&mut w, &mut turn, step);
    assert_eq!(review.model, "research-model", "the reviewer is the bot's model too");
    // The usual setup is untouched for the next turn.
    let (_t, usual) = w.engine.start(&w.core, vec![], "again", 2);
    let Step::CallModel(second) = &usual else { panic!("{usual:?}") };
    assert_eq!((second.model.as_str(), second.system.as_str()), ("test-model", with_rule("You are a test.").as_str()));
}

#[test]
fn a_turn_with_only_one_of_them_changed_keeps_the_other_usual() {
    let w = world(10);
    let (_t, step) = w.engine.start_with(&w.core, vec![], "go", 1, TurnSetup { system: None, model: Some("m2".to_owned()), plan_only: false, images: vec![], project: None });
    let Step::CallModel(r) = &step else { panic!("{step:?}") };
    assert_eq!((r.model.as_str(), r.system.as_str()), ("m2", with_rule("You are a test.").as_str()));
    let (_t, step) = w.engine.start_with(&w.core, vec![], "go", 1, TurnSetup { system: Some("S".to_owned()), model: None, plan_only: false, images: vec![], project: None });
    let Step::CallModel(r) = &step else { panic!("{step:?}") };
    assert_eq!((r.model.as_str(), r.system.as_str()), ("test-model", with_rule("S").as_str()));
}

// ---- the plan and questions for the person --------------------------------------------------------------------

#[test]
fn the_model_can_keep_a_plan_without_asking_permission_and_the_person_sees_it() {
    let mut w = world(10);
    w.core.set_approval_mode(ApprovalMode::Manual).unwrap();
    let items = json!([{ "text": "Read the notes", "status": "done" }, { "text": "Write the summary", "status": "in_progress" }, { "text": "Check it", "status": "pending" }]);
    let provider = ScriptedProvider::new(vec![calls("", vec![call("t1", "todo.write", json!({ "items": items }))]), text("Working on it.")]);
    let (mut turn, step) = w.engine.start(&w.core, vec![], "summarise my notes", 1);
    // The plan tool is offered to the model alongside the core's tools.
    let Step::CallModel(request) = &step else { panic!("{step:?}") };
    assert!(request.tools.iter().any(|t| t.name == "todo.write") && request.tools.iter().any(|t| t.name == "ask.person"));
    assert_eq!(drive(&mut w, &mut turn, &provider, step), Step::Done);
    let events = turn.drain_events();
    assert!(events.contains(&AgentEvent::Todo { items: vec![
        mobius_agent::engine::TodoItem { text: "Read the notes".into(), status: "done".into() },
        mobius_agent::engine::TodoItem { text: "Write the summary".into(), status: "in_progress".into() },
        mobius_agent::engine::TodoItem { text: "Check it".into(), status: "pending".into() },
    ] }), "{events:?}");
    assert!(!events.iter().any(|e| matches!(e, AgentEvent::NeedsApproval { .. })), "keeping a plan needs no permission");
    let (_, content, is_error) = tool_messages(&turn)[0].clone();
    assert!(!is_error && content.contains("1 of 3 done"), "{content}");
}

#[test]
fn a_plan_only_turn_offers_only_the_plan_and_questions_and_runs_nothing_else() {
    let mut w = world(10);
    allow_always(&mut w, "demo.echo");
    let items = json!([{ "text": "Read the notes", "status": "pending" }, { "text": "Write the summary in Notes", "status": "pending" }]);
    let provider = ScriptedProvider::new(vec![
        calls("", vec![call("e1", "demo.echo", json!({ "text": "sneaky" })), call("t1", "todo.write", json!({ "items": items }))]),
        text("Here is the plan. Nothing happens until you start it."),
    ]);
    let setup = TurnSetup { plan_only: true, ..TurnSetup::default() };
    let (mut turn, step) = w.engine.start_with(&w.core, vec![], "summarise my notes", 1, setup);
    let Step::CallModel(request) = &step else { panic!("{step:?}") };
    let names: Vec<&str> = request.tools.iter().map(|t| t.name.as_str()).collect();
    assert_eq!(names, vec!["todo.write", "ask.person"]);
    assert!(request.system.starts_with("You are a test.") && request.system.contains("before you do anything"), "{}", request.system);
    assert_eq!(drive(&mut w, &mut turn, &provider, step), Step::Done);
    assert_eq!(w.runs.load(Ordering::SeqCst), 0, "a tool the model was not offered still does not run");
    let results = tool_messages(&turn);
    assert!(results[0].2 && results[0].1.contains("only plans"), "{results:?}");
    assert!(turn.drain_events().iter().any(|e| matches!(e, AgentEvent::Todo { items } if items.len() == 2)));
    // The next turn is the usual one again.
    let (_t, usual) = w.engine.start(&w.core, vec![], "start", 2);
    let Step::CallModel(r) = &usual else { panic!("{usual:?}") };
    assert!(r.tools.iter().any(|t| t.name == "demo.echo") && r.system == with_rule("You are a test."));
}

#[test]
fn a_bad_plan_is_an_error_for_the_model_not_the_person() {
    let mut w = world(10);
    for bad in [json!({}), json!({ "items": "x" }), json!({ "items": [{ "text": "", "status": "done" }] }), json!({ "items": [{ "text": "a", "status": "maybe" }] }), json!({ "items": (0..60).map(|i| json!({ "text": i.to_string(), "status": "pending" })).collect::<Vec<_>>() })] {
        let provider = ScriptedProvider::new(vec![calls("", vec![call("t1", "todo.write", bad.clone())]), text("ok")]);
        let (mut turn, step) = w.engine.start(&w.core, vec![], "go", 1);
        assert_eq!(drive(&mut w, &mut turn, &provider, step), Step::Done);
        assert!(tool_messages(&turn)[0].2, "{bad} must be refused");
        assert!(!turn.drain_events().iter().any(|e| matches!(e, AgentEvent::Todo { .. })));
    }
}

#[test]
fn the_model_can_ask_the_person_and_the_turn_waits_for_the_answer() {
    let mut w = world(10);
    let provider = ScriptedProvider::new(vec![
        calls("", vec![call("q1", "ask.person", json!({ "question": "Which file?", "choices": ["notes.md", "todo.md"] })), call("e1", "demo.echo", json!({ "text": "after" }))]),
        text("Thanks."),
    ]);
    allow_always(&mut w, "demo.echo");
    let (mut turn, step) = w.engine.start(&w.core, vec![], "tidy a file", 1);
    let step = drive(&mut w, &mut turn, &provider, step);
    assert_eq!(step, Step::AwaitAnswer { call_id: "q1".into() });
    assert_eq!(turn.asking().map(|c| c.id.as_str()), Some("q1"));
    let events = turn.drain_events();
    assert!(events.contains(&AgentEvent::Question { call_id: "q1".into(), question: "Which file?".into(), choices: vec!["notes.md".into(), "todo.md".into()] }), "{events:?}");
    assert_eq!(w.runs.load(Ordering::SeqCst), 0, "the next call waits for the answer");
    // An answer to some other question changes nothing.
    assert_eq!(w.engine.on_answer(&mut turn, &mut w.core, "nope", "x"), Step::AwaitAnswer { call_id: "q1".into() });
    let step = w.engine.on_answer(&mut turn, &mut w.core, "q1", "todo.md");
    assert_eq!(drive(&mut w, &mut turn, &provider, step), Step::Done);
    assert_eq!(w.runs.load(Ordering::SeqCst), 1);
    let results = tool_messages(&turn);
    assert_eq!(results[0], ("q1".into(), "The person answered: todo.md".into(), false));
}

#[test]
fn stopping_while_a_question_is_open_closes_it() {
    let mut w = world(10);
    let provider = ScriptedProvider::new(vec![calls("", vec![call("q1", "ask.person", json!({ "question": "Sure?" }))])]);
    let (mut turn, step) = w.engine.start(&w.core, vec![], "go", 1);
    assert_eq!(drive(&mut w, &mut turn, &provider, step), Step::AwaitAnswer { call_id: "q1".into() });
    w.engine.cancel(&mut turn, &mut w.core);
    assert!(turn.asking().is_none() && turn.is_finished());
    assert_eq!(tool_messages(&turn), vec![("q1".into(), "cancelled".into(), true)]);
    let bad = ScriptedProvider::new(vec![calls("", vec![call("q2", "ask.person", json!({ "question": "" }))]), text("ok")]);
    let (mut turn, step) = w.engine.start(&w.core, vec![], "go", 2);
    assert_eq!(drive(&mut w, &mut turn, &bad, step), Step::Done, "a question with no words is refused, not shown");
}

fn with_rule(system: &str) -> String {
    format!("{system}\n\n{}", untrusted::ENVELOPE_RULE)
}
