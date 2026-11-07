#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
//! The host: conversations, turns, and what it asks its caller to do next.
use std::sync::atomic::Ordering;

use std::sync::{Arc, Mutex};

use mobius_agent::conversations::{ConversationStore, MemoryStore, SavedConversation, StoreError};
use mobius_agent::engine::TurnSetup;
use mobius_agent::host::{Activity, ConversationInfo, Host, HostError, MAX_HISTORY_MESSAGES, MAX_MESSAGE_CHARS, Out, Waiting};
use mobius_agent::message::{Message, ToolCall};
use mobius_agent::provider::{ChatRequest, Completion, ProviderError, StopReason};
use mobius_core::core::{Core, ToolSpec};
use mobius_core::model::{Duration, Principal, PrincipalKind};
use mobius_core::permissions::ApprovalMode;
use serde_json::{Value, json};

fn agent() -> Principal {
    Principal::new(PrincipalKind::Agent, "mobius-agent").unwrap()
}

fn setup() -> (Core, Host) {
    let mut core = Core::open_in_memory(Box::new(|| 1)).unwrap();
    core.register_tool(ToolSpec::new("demo.echo", "Echo", "demo.echo").unwrap(), Box::new(|a| Ok(json!({ "echo": a.clone() })))).unwrap();
    core.register_external_tool(ToolSpec::new("demo.remote", "Remote", "demo.remote").unwrap()).unwrap();
    core.register_tool(ToolSpec::new("demo.other", "Other", "demo.other").unwrap(), Box::new(|_| Ok(json!("other")))).unwrap();
    let mut host = Host::new(agent());
    host.configure("test-model", "You are a test.");
    (core, host)
}

fn text(t: &str) -> Result<Completion, ProviderError> {
    Ok(Completion { text: t.into(), tool_calls: vec![], stop: StopReason::EndTurn })
}
fn tool(id: &str, args: Value) -> Result<Completion, ProviderError> {
    Ok(Completion { text: String::new(), tool_calls: vec![ToolCall { id: id.into(), name: "demo.echo".into(), arguments: args }], stop: StopReason::ToolUse })
}

fn other_tool(id: &str) -> Result<Completion, ProviderError> {
    Ok(Completion { text: String::new(), tool_calls: vec![ToolCall { id: id.into(), name: "demo.other".into(), arguments: json!({}) }], stop: StopReason::ToolUse })
}

fn model_call(outs: &[Out]) -> Option<(u64, ChatRequest)> {
    outs.iter().find_map(|o| match o {
        Out::CallModel { turn_id, request, .. } => Some((*turn_id, request.clone())),
        _ => None,
    })
}
fn notices(outs: &[Out]) -> Vec<Value> {
    outs.iter().filter_map(|o| match o {
        Out::Notify(v) => Some(v.clone()),
        _ => None,
    }).collect()
}
fn kinds(outs: &[Out]) -> Vec<String> {
    notices(outs).iter().filter(|n| n["method"] == "agent.event").map(|n| n["params"]["event"]["kind"].as_str().unwrap().to_owned()).collect()
}

#[test]
fn nothing_can_be_sent_before_a_model_is_set_up() {
    let (core, _) = setup();
    let mut host = Host::new(agent());
    assert!(!host.is_configured());
    assert_eq!(host.send(&core, "c1", "hi").err(), Some(HostError::NotConfigured));
    host.configure("m", "");
    assert!(host.is_configured());
    assert!(host.send(&core, "c1", "hi").is_ok());
}

#[test]
fn a_message_starts_a_turn_and_the_answer_is_announced_and_remembered() {
    let (mut core, mut host) = setup();
    let (turn_id, outs) = host.send(&core, "c1", "hello").unwrap();
    let (called_turn, request) = model_call(&outs).expect("a model call");
    assert_eq!(called_turn, turn_id);
    assert_eq!(request.messages, [Message::User { text: "hello".into() }]);
    assert!(host.is_busy("c1"));

    let outs = host.model_result(&mut core, turn_id, text("Hi!"));
    let n = notices(&outs);
    assert_eq!(n[0], json!({ "jsonrpc": "2.0", "method": "agent.event", "params": { "conversation": "c1", "turn": turn_id, "event": { "kind": "message", "text": "Hi!" } } }));
    assert_eq!(kinds(&outs), ["message", "done"]);
    assert!(!host.is_busy("c1"));
    assert_eq!(host.history("c1"), [Message::User { text: "hello".into() }, Message::Assistant { text: "Hi!".into(), tool_calls: vec![] }]);

    let (_, outs) = host.send(&core, "c1", "again").unwrap();
    assert_eq!(model_call(&outs).unwrap().1.messages.len(), 3, "the next turn sees the earlier ones");
}

#[test]
fn conversations_are_independent_and_one_turn_runs_per_conversation() {
    let (core, mut host) = setup();
    host.send(&core, "a", "one").unwrap();
    assert_eq!(host.send(&core, "a", "two").err(), Some(HostError::Busy));
    let (_, outs) = host.send(&core, "b", "other").unwrap();
    assert_eq!(model_call(&outs).unwrap().1.messages.len(), 1);
    assert_eq!(host.history("a"), [Message::User { text: "one".into() }], "a turn in progress is already part of the history");
}

#[test]
fn streamed_text_is_announced_with_its_turn_and_unknown_turns_are_ignored() {
    let (core, mut host) = setup();
    let (turn_id, _) = host.send(&core, "c1", "hi").unwrap();
    let n = notices(&host.text(turn_id, "Hel"));
    assert_eq!(n[0], json!({ "jsonrpc": "2.0", "method": "agent.delta", "params": { "conversation": "c1", "turn": turn_id, "text": "Hel" } }));
    assert!(host.text(turn_id + 99, "x").is_empty());
}

#[test]
fn a_turn_that_needs_approval_waits_and_continues_when_answered() {
    let (mut core, mut host) = setup();
    let (turn_id, _) = host.send(&core, "c1", "use the tool").unwrap();
    let outs = host.model_result(&mut core, turn_id, tool("call1", json!({ "text": "hi" })));
    assert!(model_call(&outs).is_none(), "nothing more to do until a person answers");
    let asked = notices(&outs).into_iter().find(|n| n["params"]["event"]["kind"] == "needs_approval").unwrap();
    assert_eq!(asked["params"]["event"]["tool"], "demo.echo");
    assert_eq!(asked["params"]["event"]["arguments"], json!({ "text": "hi" }), "the person sees what will run");
    let request_id = asked["params"]["event"]["request_id"].as_u64().unwrap();
    assert!(host.is_busy("c1"));

    assert!(host.poll(&mut core).is_empty(), "no answer yet");
    core.resolve(request_id, true, Duration::Once).unwrap();
    let outs = host.poll(&mut core);
    let (_, request) = model_call(&outs).expect("the turn went back to the model");
    assert!(matches!(request.messages.last(), Some(Message::Tool { is_error: false, .. })));
    assert!(host.poll(&mut core).is_empty(), "an answer is used once");

    let outs = host.model_result(&mut core, turn_id, text("done"));
    assert_eq!(kinds(&outs), ["message", "done"]);
}

#[test]
fn a_declined_question_is_reported_to_the_model() {
    let (mut core, mut host) = setup();
    let (turn_id, _) = host.send(&core, "c1", "go").unwrap();
    let outs = host.model_result(&mut core, turn_id, tool("call1", json!({})));
    let request_id = notices(&outs).iter().find_map(|n| n["params"]["event"]["request_id"].as_u64()).unwrap();
    core.resolve(request_id, false, Duration::Once).unwrap();
    let (_, request) = model_call(&host.poll(&mut core)).unwrap();
    assert!(matches!(request.messages.last(), Some(Message::Tool { is_error: true, content, .. }) if content.contains("declined")));
}

#[test]
fn an_answer_for_a_different_conversation_does_not_move_this_one() {
    let (mut core, mut host) = setup();
    let (a, _) = host.send(&core, "a", "go").unwrap();
    let (b, _) = host.send(&core, "b", "go").unwrap();
    let outs_a = host.model_result(&mut core, a, tool("x", json!({})));
    host.model_result(&mut core, b, other_tool("y"));
    let id_a = notices(&outs_a).iter().find_map(|n| n["params"]["event"]["request_id"].as_u64()).unwrap();
    core.resolve(id_a, true, Duration::Once).unwrap();
    let outs = host.poll(&mut core);
    assert_eq!(model_call(&outs).unwrap().0, a);
    assert!(host.is_busy("b"));
    assert_eq!(core.pending().len(), 1, "b is still waiting");
}

#[test]
fn cancelling_stops_the_model_call_withdraws_questions_and_frees_the_conversation() {
    let (mut core, mut host) = setup();
    let (turn_id, outs) = host.send(&core, "c1", "go").unwrap();
    let flag = outs.iter().find_map(|o| match o { Out::CallModel { cancel, .. } => Some(cancel.clone()), _ => None }).unwrap();
    assert!(!flag.load(Ordering::SeqCst));
    let outs = host.cancel(&mut core, "c1");
    assert!(flag.load(Ordering::SeqCst), "the worker is told to stop");
    assert_eq!(kinds(&outs), ["cancelled"]);
    assert!(!host.is_busy("c1"));
    assert!(host.model_result(&mut core, turn_id, text("late")).is_empty(), "a late result is dropped");
    assert!(host.text(turn_id, "late").is_empty());
    assert!(host.send(&core, "c1", "next").is_ok());
}

#[test]
fn cancelling_while_waiting_for_a_person_withdraws_the_question() {
    let (mut core, mut host) = setup();
    let (turn_id, _) = host.send(&core, "c1", "go").unwrap();
    host.model_result(&mut core, turn_id, tool("x", json!({})));
    assert_eq!(core.pending().len(), 1);
    host.cancel(&mut core, "c1");
    assert!(core.pending().is_empty());
    assert!(host.history("c1").iter().any(|m| matches!(m, Message::Tool { is_error: true, .. })), "every call has a result, so the next turn is valid");
    assert!(host.cancel(&mut core, "c1").is_empty(), "nothing to cancel");
    assert!(host.cancel(&mut core, "never-existed").is_empty());
}

#[test]
fn a_failed_turn_is_announced_and_leaves_the_conversation_as_it_was() {
    let (mut core, mut host) = setup();
    let (t1, _) = host.send(&core, "c1", "first").unwrap();
    host.model_result(&mut core, t1, text("ok"));
    let before = host.history("c1");
    let (t2, _) = host.send(&core, "c1", "second").unwrap();
    let outs = host.model_result(&mut core, t2, Err(ProviderError::Http { status: 500, message: "boom".into() }));
    assert_eq!(kinds(&outs), ["failed"]);
    let failed = notices(&outs).pop().unwrap();
    assert!(failed["params"]["event"]["message"].as_str().unwrap().contains("500"));
    assert_eq!(host.history("c1"), before);
    assert!(!host.is_busy("c1"));
}

#[test]
fn input_is_checked() {
    let (core, mut host) = setup();
    for bad in ["", " ", "has space", "../x", "a/b", &"x".repeat(65)] {
        assert_eq!(host.send(&core, bad, "hi").err(), Some(HostError::InvalidConversation), "{bad:?}");
    }
    assert_eq!(host.send(&core, "c1", &"é".repeat(MAX_MESSAGE_CHARS + 1)).err(), Some(HostError::TooLong));
    assert!(host.send(&core, "c1", "é".repeat(MAX_MESSAGE_CHARS).as_str()).is_ok(), "the limit counts characters, not bytes");
}

#[test]
fn a_blank_message_is_not_a_message() {
    let (core, mut host) = setup();
    assert_eq!(host.send(&core, "c1", "   \n\t ").err(), Some(HostError::Empty));
    assert_eq!(host.send(&core, "c1", "").err(), Some(HostError::Empty));
}

#[test]
fn only_so_many_conversations_and_so_long_a_history() {
    let (mut core, mut host) = setup();
    for i in 0..64 {
        let (t, _) = host.send(&core, &format!("c{i}"), "hi").unwrap();
        host.model_result(&mut core, t, text("ok"));
    }
    assert_eq!(host.send(&core, "one-too-many", "hi").err(), Some(HostError::TooManyConversations));
    assert!(host.send(&core, "c0", "still fine").is_ok(), "existing conversations keep working");

    let (mut core, mut host) = setup();
    let mut turns = 0;
    while host.history("long").len() + 2 <= MAX_HISTORY_MESSAGES {
        let (t, _) = host.send(&core, "long", "hi").unwrap();
        host.model_result(&mut core, t, text("ok"));
        turns += 1;
        assert!(turns <= MAX_HISTORY_MESSAGES / 2);
    }
    assert_eq!(host.send(&core, "long", "hi").err(), Some(HostError::ConversationFull));
}

fn two_turns_waiting_on_the_same_question() -> (Core, Host, u64, u64, u64) {
    let (mut core, mut host) = setup();
    let (a, _) = host.send(&core, "a", "go").unwrap();
    let (b, _) = host.send(&core, "b", "go").unwrap();
    let outs = host.model_result(&mut core, a, tool("x", json!({})));
    host.model_result(&mut core, b, tool("y", json!({})));
    let request_id = notices(&outs).iter().find_map(|n| n["params"]["event"]["request_id"].as_u64()).unwrap();
    assert_eq!(core.pending().len(), 1, "identical questions are merged by the core");
    (core, host, a, b, request_id)
}

#[test]
fn turns_that_share_a_question_all_hear_its_answer() {
    let (mut core, mut host, a, b, request_id) = two_turns_waiting_on_the_same_question();
    core.resolve(request_id, true, Duration::Always).unwrap();
    let outs = host.poll(&mut core);
    let mut resumed: Vec<u64> = outs.iter().filter_map(|o| match o { Out::CallModel { turn_id, .. } => Some(*turn_id), _ => None }).collect();
    resumed.sort_unstable();
    assert_eq!(resumed, [a, b], "neither turn is left waiting for an answer that was already given");
}

#[test]
fn a_one_time_approval_runs_one_turn_and_the_other_asks_again_instead_of_hanging() {
    let (mut core, mut host, _a, _b, request_id) = two_turns_waiting_on_the_same_question();
    core.resolve(request_id, true, Duration::Once).unwrap();
    let outs = host.poll(&mut core);
    let resumed = outs.iter().filter(|o| matches!(o, Out::CallModel { .. })).count();
    assert_eq!(resumed, 1, "once means once");
    let new_question = core.pending();
    assert_eq!(new_question.len(), 1, "the other turn asks again");
    assert_ne!(new_question[0].id, request_id);
    core.resolve(new_question[0].id, true, Duration::Once).unwrap();
    assert_eq!(host.poll(&mut core).iter().filter(|o| matches!(o, Out::CallModel { .. })).count(), 1);
}

#[test]
fn cancelling_one_of_two_turns_keeps_the_shared_question_for_the_other() {
    let (mut core, mut host, _a, b, request_id) = two_turns_waiting_on_the_same_question();
    host.cancel(&mut core, "a");
    assert_eq!(core.pending().len(), 1, "b still needs the answer");
    core.resolve(request_id, true, Duration::Once).unwrap();
    let outs = host.poll(&mut core);
    assert_eq!(model_call(&outs).unwrap().0, b);
    host.cancel(&mut core, "b");
    assert!(core.pending().is_empty(), "the last one to leave withdraws the question");
}

#[test]
fn the_last_waiter_cancelling_withdraws_the_question() {
    let (mut core, mut host, _a, _b, _request_id) = two_turns_waiting_on_the_same_question();
    host.cancel(&mut core, "a");
    host.cancel(&mut core, "b");
    assert!(core.pending().is_empty());
}

#[test]
fn the_history_includes_the_turn_in_progress_and_the_parked_call_can_be_found() {
    let (mut core, mut host) = setup();
    let (turn_id, _) = host.send(&core, "c1", "use it").unwrap();
    assert_eq!(host.history("c1"), [Message::User { text: "use it".into() }]);
    assert!(host.waiting("c1").is_empty());

    let outs = host.model_result(&mut core, turn_id, tool("call1", json!({ "text": "hi" })));
    let request_id = notices(&outs).iter().find_map(|n| n["params"]["event"]["request_id"].as_u64()).unwrap();
    let history = host.history("c1");
    assert!(matches!(history.last(), Some(Message::Assistant { tool_calls, .. }) if tool_calls[0].id == "call1"));
    assert_eq!(host.waiting("c1"), [Waiting { request_id, call_id: "call1".into(), tool: "demo.echo".into(), arguments: json!({ "text": "hi" }), once_only: false }]);
    assert!(host.waiting("other").is_empty());

    core.resolve(request_id, true, Duration::Once).unwrap();
    host.poll(&mut core);
    assert!(host.waiting("c1").is_empty(), "nothing is waiting once it has been answered");
    assert!(matches!(host.history("c1").last(), Some(Message::Tool { .. })));
    host.model_result(&mut core, turn_id, text("done"));
    assert_eq!(host.history("c1").len(), 4);
}

fn remote_call(id: &str) -> Result<Completion, ProviderError> {
    Ok(Completion { text: String::new(), tool_calls: vec![ToolCall { id: id.into(), name: "demo.remote".into(), arguments: json!({ "n": 1 }) }], stop: StopReason::ToolUse })
}

fn run_tool(outs: &[Out]) -> Option<(u64, String, String, Value)> {
    outs.iter().find_map(|o| match o {
        Out::RunTool { turn_id, call_id, name, arguments } => Some((*turn_id, call_id.clone(), name.clone(), arguments.clone())),
        _ => None,
    })
}

#[test]
fn the_host_asks_its_caller_to_run_application_tools_and_carries_on_with_the_answer() {
    let (mut core, mut host) = setup();
    let (turn_id, _) = host.send(&core, "c1", "go").unwrap();
    let outs = host.model_result(&mut core, turn_id, remote_call("r1"));
    let request_id = notices(&outs).iter().find_map(|n| n["params"]["event"]["request_id"].as_u64()).unwrap();
    assert!(run_tool(&outs).is_none(), "not before a person has allowed it");
    core.resolve(request_id, true, Duration::Once).unwrap();
    let outs = host.poll(&mut core);
    assert_eq!(run_tool(&outs), Some((turn_id, "r1".into(), "demo.remote".into(), json!({ "n": 1 }))));
    assert!(host.is_busy("c1"));
    assert!(host.waiting("c1").is_empty(), "it is running, not waiting for a person");

    let outs = host.tool_result(&mut core, turn_id, "r1", Ok("fine".to_owned()));
    let (_, request) = model_call(&outs).expect("the model sees the result");
    assert!(matches!(request.messages.last(), Some(Message::Tool { content, is_error: false, .. }) if content == "fine"));
    let outs = host.model_result(&mut core, turn_id, text("done"));
    assert_eq!(kinds(&outs), ["message", "done"]);
}

#[test]
fn an_answer_from_the_application_for_a_finished_or_unknown_turn_is_dropped() {
    let (mut core, mut host) = setup();
    assert!(host.tool_result(&mut core, 99, "r1", Ok("x".into())).is_empty());
    let (turn_id, _) = host.send(&core, "c1", "go").unwrap();
    host.cancel(&mut core, "c1");
    assert!(host.tool_result(&mut core, turn_id, "r1", Ok("x".into())).is_empty());
}

#[test]
fn cancelling_while_the_application_works_frees_the_conversation() {
    let (mut core, mut host) = setup();
    let (turn_id, _) = host.send(&core, "c1", "go").unwrap();
    let outs = host.model_result(&mut core, turn_id, remote_call("r1"));
    let request_id = notices(&outs).iter().find_map(|n| n["params"]["event"]["request_id"].as_u64()).unwrap();
    core.resolve(request_id, true, Duration::Once).unwrap();
    assert!(run_tool(&host.poll(&mut core)).is_some());
    let outs = host.cancel(&mut core, "c1");
    assert_eq!(kinds(&outs), ["cancelled"]);
    assert!(!host.is_busy("c1"));
    assert!(host.history("c1").iter().any(|m| matches!(m, Message::Tool { is_error: true, .. })));
}

// ---- saved conversations -------------------------------------------------------------------------------------

#[derive(Clone, Default)]
struct SharedStore(Arc<Mutex<MemoryStore>>);

impl ConversationStore for SharedStore {
    fn load_all(&self, limit: usize) -> Result<Vec<SavedConversation>, StoreError> {
        self.0.lock().unwrap().load_all(limit)
    }
    fn save(&mut self, id: &str, messages: &[Message], updated_ms: u64) -> Result<(), StoreError> {
        self.0.lock().unwrap().save(id, messages, updated_ms)
    }
    fn delete(&mut self, id: &str) -> Result<(), StoreError> {
        self.0.lock().unwrap().delete(id)
    }
    fn save_compaction(&mut self, id: &str, compaction: Option<&mobius_agent::compaction::Compaction>) -> Result<(), StoreError> {
        self.0.lock().unwrap().save_compaction(id, compaction)
    }
}

struct BrokenStore;
impl ConversationStore for BrokenStore {
    fn load_all(&self, _: usize) -> Result<Vec<SavedConversation>, StoreError> {
        Err(StoreError::Encode)
    }
    fn save(&mut self, _: &str, _: &[Message], _: u64) -> Result<(), StoreError> {
        Err(StoreError::Encode)
    }
    fn delete(&mut self, _: &str) -> Result<(), StoreError> {
        Err(StoreError::Encode)
    }
}

fn saved_world(store: SharedStore, clock: Arc<Mutex<u64>>) -> (Core, Host) {
    let mut core = Core::open_in_memory(Box::new(|| 1)).unwrap();
    core.register_tool(ToolSpec::new("demo.echo", "Echo", "demo.echo").unwrap(), Box::new(|a| Ok(json!({ "echo": a.clone() })))).unwrap();
    let mut host = Host::with_store(agent(), Box::new(store), Box::new(move || *clock.lock().unwrap()));
    host.configure("test-model", "You are a test.");
    (core, host)
}

fn say_and_finish(core: &mut Core, host: &mut Host, conversation: &str, words: &str) {
    let (turn_id, _) = host.send(core, conversation, words).unwrap();
    host.model_result(core, turn_id, text("ok"));
}

#[test]
fn a_finished_turn_is_saved_and_a_new_host_picks_it_up() {
    let store = SharedStore::default();
    let clock = Arc::new(Mutex::new(1_000));
    let (mut core, mut host) = saved_world(store.clone(), clock.clone());
    say_and_finish(&mut core, &mut host, "c1", "hello");
    let saved = store.load_all(10).unwrap();
    assert_eq!((saved[0].id.as_str(), saved[0].messages.len(), saved[0].updated_ms), ("c1", 2, 1_000));

    // A later run: same store, fresh host.
    let (core2, mut host2) = saved_world(store.clone(), clock);
    assert_eq!(host2.history("c1").len(), 2);
    let (_, outs) = host2.send(&core2, "c1", "and again").unwrap();
    assert_eq!(model_call(&outs).unwrap().1.messages.len(), 3, "the conversation carries on from where it was");
}

#[test]
fn only_finished_turns_are_saved() {
    let store = SharedStore::default();
    let (mut core, mut host) = saved_world(store.clone(), Arc::new(Mutex::new(5)));
    let (t1, _) = host.send(&core, "c1", "in flight").unwrap();
    assert!(store.load_all(10).unwrap().is_empty(), "a turn in progress is not saved");
    host.model_result(&mut core, t1, Err(ProviderError::Http { status: 500, message: "boom".into() }));
    assert!(store.load_all(10).unwrap().is_empty(), "a failed turn leaves nothing behind");
    let (t2, _) = host.send(&core, "c1", "will be cancelled").unwrap();
    let _ = t2;
    host.cancel(&mut core, "c1");
    assert_eq!(store.load_all(10).unwrap().len(), 1, "a cancelled turn is kept, with its calls closed");
}

#[test]
fn a_store_that_fails_never_fails_the_conversation() {
    let mut core = Core::open_in_memory(Box::new(|| 1)).unwrap();
    let mut host = Host::with_store(agent(), Box::new(BrokenStore), Box::new(|| 1));
    host.configure("m", "");
    let (turn_id, _) = host.send(&core, "c1", "hi").unwrap();
    let outs = host.model_result(&mut core, turn_id, text("fine"));
    assert_eq!(kinds(&outs), ["message", "done"]);
    assert_eq!(host.history("c1").len(), 2);
    assert!(host.delete("c1").is_ok());
}

#[test]
fn conversations_are_listed_newest_first_with_a_title_from_the_first_message() {
    let store = SharedStore::default();
    let clock = Arc::new(Mutex::new(100));
    let (mut core, mut host) = saved_world(store, clock.clone());
    say_and_finish(&mut core, &mut host, "old", "  Plan the trip\nsecond line ignored  ");
    *clock.lock().unwrap() = 300;
    say_and_finish(&mut core, &mut host, "new", &"w".repeat(200));
    *clock.lock().unwrap() = 200;
    say_and_finish(&mut core, &mut host, "mid", "Short");
    let list = host.conversations();
    assert_eq!(list.iter().map(|c| c.id.as_str()).collect::<Vec<_>>(), ["new", "mid", "old"]);
    assert_eq!(list[2], ConversationInfo { id: "old".into(), title: "Plan the trip".into(), updated_ms: 100, messages: 2, activity: Activity::Idle, waiting: 0 });
    assert!(list[0].title.chars().count() <= 61 && list[0].title.ends_with('\u{2026}'), "long titles are shortened: {}", list[0].title);
    assert_eq!(list[1].title, "Short");
}

#[test]
fn a_conversation_with_no_user_message_has_a_plain_title_and_the_running_turn_is_listed() {
    let store = SharedStore::default();
    let (core, mut host) = saved_world(store, Arc::new(Mutex::new(7)));
    host.send(&core, "live", "still going").unwrap();
    let list = host.conversations();
    assert_eq!((list[0].id.as_str(), list[0].title.as_str(), list[0].messages), ("live", "still going", 1), "a turn in progress already shows");
}

#[test]
fn deleting_removes_the_conversation_everywhere_but_not_while_it_is_busy() {
    let store = SharedStore::default();
    let (mut core, mut host) = saved_world(store.clone(), Arc::new(Mutex::new(1)));
    say_and_finish(&mut core, &mut host, "gone", "bye");
    say_and_finish(&mut core, &mut host, "kept", "stay");
    host.delete("gone").unwrap();
    assert_eq!(host.conversations().iter().map(|c| c.id.as_str()).collect::<Vec<_>>(), ["kept"]);
    assert_eq!(store.load_all(10).unwrap().len(), 1);
    assert!(host.history("gone").is_empty());
    host.delete("never-existed").unwrap();
    assert_eq!(host.delete("../x").err(), Some(HostError::InvalidConversation));

    host.send(&core, "kept", "working").unwrap();
    assert_eq!(host.delete("kept").err(), Some(HostError::Busy));
    assert!(host.conversations().iter().any(|c| c.id == "kept"));
}

#[test]
fn a_new_host_loads_only_as_many_conversations_as_may_be_open() {
    let store = SharedStore::default();
    {
        let mut raw = store.clone();
        for i in 0..80u64 {
            raw.save(&format!("c{i}"), &[Message::User { text: format!("m{i}") }], i).unwrap();
        }
    }
    let (_, host) = saved_world(store, Arc::new(Mutex::new(0)));
    let list = host.conversations();
    assert_eq!(list.len(), 64);
    assert_eq!(list[0].id, "c79", "the newest are the ones kept");
}

#[test]
fn the_step_limit_can_be_set_and_stops_a_request_that_uses_too_many() {
    let (mut core, mut host) = setup();
    let first = core.invoke(&agent(), "demo.echo", &json!({})).unwrap();
    let id = match first { mobius_core::core::InvokeOutcome::NeedsApproval { request_id } => request_id, other => panic!("{other:?}") };
    core.resolve(id, true, Duration::Always).unwrap();

    host.configure_with("m", "", 1);
    let (turn_id, _) = host.send(&core, "c1", "go").unwrap();
    let outs = host.model_result(&mut core, turn_id, tool("c1", json!({})));
    assert_eq!(kinds(&outs).last().map(String::as_str), Some("failed"), "one model call was allowed, and the tool result needs another");
    assert!(model_call(&outs).is_none());

    host.configure_with("m", "", 3);
    let (turn_id, _) = host.send(&core, "c2", "go").unwrap();
    let outs = host.model_result(&mut core, turn_id, tool("c1", json!({})));
    assert!(model_call(&outs).is_some(), "with a higher limit the request carries on");
}

#[test]
fn each_conversation_says_whether_it_is_idle_working_or_needs_a_person() {
    let (mut core, mut host) = setup();
    let (first, _) = host.send(&core, "quiet", "hi").unwrap();
    host.model_result(&mut core, first, text("hello"));
    let (busy, _) = host.send(&core, "busy", "think").unwrap();
    let (asking, _) = host.send(&core, "asking", "use a tool").unwrap();
    host.model_result(&mut core, asking, tool("call1", json!({})));
    let by_id = |host: &Host, id: &str| host.conversations().into_iter().find(|c| c.id == id).unwrap();
    assert_eq!(by_id(&host, "quiet").activity, Activity::Idle);
    assert_eq!(by_id(&host, "busy").activity, Activity::Working);
    let asking_info = by_id(&host, "asking");
    assert_eq!(asking_info.activity, Activity::NeedsYou);
    assert_eq!(asking_info.waiting, 1);
    assert_eq!(by_id(&host, "busy").waiting, 0);
    host.cancel(&mut core, "busy");
    host.cancel(&mut core, "asking");
    let _ = busy;
    assert_eq!(by_id(&host, "busy").activity, Activity::Idle);
    assert_eq!(by_id(&host, "asking").activity, Activity::Idle);
    assert_eq!(by_id(&host, "asking").waiting, 0);
}

#[test]
fn the_last_exchange_can_be_taken_back_and_the_earlier_ones_stay() {
    let store = SharedStore::default();
    let clock = Arc::new(Mutex::new(10));
    let (mut core, mut host) = saved_world(store.clone(), clock.clone());
    say_and_finish(&mut core, &mut host, "c1", "first question");
    say_and_finish(&mut core, &mut host, "c1", "second question");
    assert_eq!(host.history("c1").len(), 4);
    assert_eq!(host.rewind("c1").unwrap(), "second question");
    assert_eq!(host.history("c1").len(), 2);
    let (_, fresh) = saved_world(store.clone(), clock.clone());
    assert_eq!(fresh.history("c1").len(), 2, "the shortened conversation was saved");
    assert_eq!(host.rewind("c1").unwrap(), "first question");
    assert!(host.history("c1").is_empty());
    assert!(host.conversations().iter().all(|c| c.id != "c1"), "a conversation with nothing left is gone");
    let (_, again) = saved_world(store, clock);
    assert!(again.history("c1").is_empty());
}

#[test]
fn taking_back_removes_the_tool_steps_of_that_exchange_too() {
    let (mut core, mut host) = setup();
    let (turn, _) = host.send(&core, "c1", "use the tool").unwrap();
    host.model_result(&mut core, turn, tool("call1", json!({})));
    let id = host.waiting("c1")[0].request_id;
    core.resolve(id, true, Duration::Once).unwrap();
    let outs = host.poll(&mut core);
    let (turn2, _) = model_call(&outs).unwrap();
    host.model_result(&mut core, turn2, text("done"));
    assert!(host.history("c1").len() >= 4);
    assert_eq!(host.rewind("c1").unwrap(), "use the tool");
    assert!(host.history("c1").is_empty());
}

#[test]
fn nothing_can_be_taken_back_while_working_or_when_there_is_nothing() {
    let (mut core, mut host) = setup();
    assert!(matches!(host.rewind("nope"), Err(HostError::NothingToRewind)));
    assert!(matches!(host.rewind("../bad"), Err(HostError::InvalidConversation)));
    let (turn, _) = host.send(&core, "c1", "hi").unwrap();
    assert!(matches!(host.rewind("c1"), Err(HostError::Busy)));
    host.model_result(&mut core, turn, text("ok"));
    assert!(host.rewind("c1").is_ok());
}

#[test]
fn a_notice_about_a_turn_reaches_the_conversation_it_belongs_to() {
    let (core, mut host) = setup();
    let (turn, _) = host.send(&core, "c1", "hi").unwrap();
    let outs = host.notice(turn, "fallback", "second-model", "the first model could not be reached");
    assert_eq!(outs.len(), 1);
    let Out::Notify(value) = &outs[0] else { panic!("expected a notification") };
    assert_eq!(value["method"], "agent.notice");
    assert_eq!(value["params"], json!({ "conversation": "c1", "turn": turn, "kind": "fallback", "model": "second-model", "why": "the first model could not be reached" }));
    assert!(host.notice(turn + 100, "fallback", "m", "w").is_empty(), "an unknown turn gets nothing");
}

// ---- smart approvals through the host ------------------------------------------------------------------------

fn review_of(outs: &[Out]) -> Option<(u64, u64, ChatRequest)> {
    outs.iter().find_map(|o| match o {
        Out::Review { turn_id, request_id, request, .. } => Some((*turn_id, *request_id, request.clone())),
        _ => None,
    })
}

#[test]
fn in_smart_mode_a_question_becomes_a_review_that_nobody_is_told_about_until_it_is_answered() {
    let (mut core, mut host) = setup();
    core.set_approval_mode(ApprovalMode::Smart).unwrap();
    let (turn_id, _) = host.send(&core, "c1", "use it").unwrap();
    let outs = host.model_result(&mut core, turn_id, tool("call1", json!({ "text": "hi" })));
    let (review_turn, request_id, request) = review_of(&outs).expect("a review is asked for");
    assert_eq!(review_turn, turn_id);
    assert!(request.tools.is_empty());
    assert!(!kinds(&outs).iter().any(|k| k == "needs_approval"), "{:?}", kinds(&outs));
    assert!(host.waiting("c1").is_empty(), "there is nothing for a person to answer yet");
    assert_eq!(host.conversations()[0].activity, Activity::Working);
    assert!(host.poll(&mut core).is_empty());

    // Approved: the call runs and the model is asked again.
    let outs = host.review_result(&mut core, turn_id, request_id, text("APPROVE"));
    assert!(model_call(&outs).is_some(), "the turn carries on");
    assert!(core.pending().is_empty());
}

#[test]
fn a_review_that_says_deny_leaves_a_once_only_question_for_the_person() {
    let (mut core, mut host) = setup();
    core.set_approval_mode(ApprovalMode::Smart).unwrap();
    let (turn_id, _) = host.send(&core, "c1", "use it").unwrap();
    let outs = host.model_result(&mut core, turn_id, tool("call1", json!({ "text": "hi" })));
    let (_, request_id, _) = review_of(&outs).unwrap();
    let outs = host.review_result(&mut core, turn_id, request_id, text("DENY"));
    assert!(kinds(&outs).iter().any(|k| k == "needs_approval"));
    assert_eq!(host.waiting("c1"), [Waiting { request_id, call_id: "call1".into(), tool: "demo.echo".into(), arguments: json!({ "text": "hi" }), once_only: true }]);
    assert_eq!(host.conversations()[0].activity, Activity::NeedsYou);
}

#[test]
fn a_late_review_for_a_stopped_turn_is_ignored() {
    let (mut core, mut host) = setup();
    core.set_approval_mode(ApprovalMode::Smart).unwrap();
    let (turn_id, _) = host.send(&core, "c1", "use it").unwrap();
    let outs = host.model_result(&mut core, turn_id, tool("call1", json!({})));
    let (_, request_id, _) = review_of(&outs).unwrap();
    host.cancel(&mut core, "c1");
    assert!(host.review_result(&mut core, turn_id, request_id, text("APPROVE")).is_empty());
    assert!(core.pending().is_empty());
}

#[test]
fn the_effort_survives_a_new_setup_and_reaches_every_model_call() {
    let (core, mut host) = setup();
    host.set_effort(Some("low"));
    host.configure("other-model", "You are a test.");
    let (_, outs) = host.send(&core, "c1", "hi").unwrap();
    let (_, request) = model_call(&outs).unwrap();
    assert_eq!(request.effort.as_deref(), Some("low"));
    host.set_effort(None);
    let (_, outs) = host.send(&core, "c2", "hi").unwrap();
    assert_eq!(model_call(&outs).unwrap().1.effort, None);
}

#[test]
fn a_conversation_can_have_its_own_setup_and_another_conversation_keeps_the_usual_one() {
    let (core, mut host) = setup();
    let (_, outs) = host.send_with(&core, "bot-a", "hi", TurnSetup { system: Some("Be the bot.".into()), model: Some("bot-model".into()) }).unwrap();
    let (_, request) = model_call(&outs).unwrap();
    assert_eq!((request.model.as_str(), request.system.as_str()), ("bot-model", "Be the bot."));
    let (_, outs) = host.send(&core, "plain", "hi").unwrap();
    let (_, request) = model_call(&outs).unwrap();
    assert_eq!((request.model.as_str(), request.system.as_str()), ("test-model", "You are a test."));
}

// ---- long conversations --------------------------------------------------------------------------------------

/// Fill a conversation past a 4,096-token window, then send one more message: the model is first asked for a summary.
fn long_conversation(core: &mut Core, host: &mut Host) -> (u64, Vec<Out>) {
    host.set_context_window(Some(4_096));
    for i in 0..3 {
        let (t, outs) = host.send(core, "long", &format!("question {i} {}", "q".repeat(1_000))).unwrap();
        let (_, request) = model_call(&outs).unwrap();
        assert!(!request.tools.is_empty(), "no summary while it still fits ({i})");
        host.model_result(core, t, text(&format!("answer {i} {}", "a".repeat(1_000))));
    }
    host.send(core, "long", &format!("what next? {}", "w".repeat(3_000))).unwrap()
}

#[test]
fn a_summary_is_never_streamed_into_the_conversation_and_is_kept_after_a_restart() {
    let store = SharedStore::default();
    let clock = Arc::new(Mutex::new(10));
    let (mut core, mut host) = saved_world(store.clone(), clock.clone());
    let (t, outs) = long_conversation(&mut core, &mut host);
    let (_, summary_call) = model_call(&outs).unwrap();
    assert!(summary_call.tools.is_empty(), "the first call writes the summary");
    assert!(host.text(t, "## Goal ...").is_empty(), "summary text is not shown as the answer");
    let outs = host.model_result(&mut core, t, text("SUMMARY OF EARLIER"));
    assert!(notices(&outs).iter().any(|n| n["params"]["event"]["kind"] == "compacted"));
    let (_, real) = model_call(&outs).unwrap();
    assert!(!host.text(t, "Here").is_empty(), "the real answer streams as usual");
    host.model_result(&mut core, t, text("Here."));
    assert_eq!(host.history("long").len(), 8, "the transcript is whole");
    assert!(matches!(&real.messages[0], Message::User { text } if text.contains("SUMMARY OF EARLIER")));
    let covers = host.compaction("long").unwrap().covers;

    // After a restart the next message goes out with the same summary, without asking for a new one.
    let (mut core, mut host) = saved_world(store, clock);
    host.set_context_window(Some(4_096));
    assert_eq!(host.compaction("long").map(|c| c.covers), Some(covers));
    let (_, outs) = host.send(&core, "long", "and then?").unwrap();
    let (_, request) = model_call(&outs).unwrap();
    assert!(!request.tools.is_empty(), "no new summary was needed");
    assert!(matches!(&request.messages[0], Message::User { text } if text.contains("SUMMARY OF EARLIER")), "{:?}", request.messages[0]);
    let _ = &mut core;
}

#[test]
fn taking_back_a_message_the_summary_covers_forgets_the_summary() {
    let (mut core, mut host) = setup();
    let (t, _) = long_conversation(&mut core, &mut host);
    host.model_result(&mut core, t, text("SUMMARY"));
    host.model_result(&mut core, t, text("Here."));
    assert!(host.compaction("long").is_some());
    // A message after the summary's end is taken back and the summary stays.
    let (t2, _) = host.send(&core, "long", "more").unwrap();
    host.model_result(&mut core, t2, text("sure"));
    assert_eq!(host.rewind("long").unwrap(), "more");
    assert!(host.compaction("long").is_some(), "the summary does not cover it");
    assert!(host.rewind("long").unwrap().starts_with("what next?"));
    assert!(host.compaction("long").is_none(), "the summary covered up to that message");
    // Deleting forgets everything.
    let (t, _) = host.send(&core, "long", "again").unwrap();
    host.model_result(&mut core, t, text("SUMMARY 2"));
    host.model_result(&mut core, t, text("ok"));
    host.delete("long").unwrap();
    assert!(host.compaction("long").is_none());
}
