#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
//! Long conversations: the engine shortens what the model sees, never what the person sees.
use mobius_agent::compaction::{Compaction, SUMMARY_PREFIX};
use mobius_agent::engine::{AgentEvent, Engine, EngineConfig, Step, Turn};
use mobius_agent::message::{Message, ToolCall};
use mobius_agent::provider::{ChatRequest, Completion, ProviderError, StopReason};
use mobius_core::core::{Core, ToolSpec};
use mobius_core::model::{Principal, PrincipalKind};
use serde_json::json;

fn agent() -> Principal {
    Principal::new(PrincipalKind::Agent, "mobius-agent").unwrap()
}

/// A 4,096-token window: requests over ~2,048 tokens (~8,000 characters) make room.
fn setup(max_steps: u32) -> (Core, Engine) {
    let mut core = Core::open_in_memory(Box::new(|| 1)).unwrap();
    core.register_tool(ToolSpec::new("demo.echo", "Echo", "demo.echo").unwrap(), Box::new(|a| Ok(json!({ "echo": a.clone() })))).unwrap();
    let mut engine = Engine::new(EngineConfig { model: "m".into(), system: "sys".into(), max_steps, principal: agent() });
    engine.set_context_window(Some(4_096));
    (core, engine)
}

fn answer(t: &str) -> Result<Completion, ProviderError> {
    Ok(Completion { text: t.into(), tool_calls: vec![], stop: StopReason::EndTurn, usage: None })
}

fn chat(pairs: usize, size: usize) -> Vec<Message> {
    (0..pairs).flat_map(|i| [Message::user(format!("question {i} {}", "q".repeat(size))), Message::Assistant { text: format!("answer {i} {}", "a".repeat(size)), tool_calls: vec![] }]).collect()
}

fn with_tool_output(turns: usize, size: usize) -> Vec<Message> {
    (0..turns)
        .flat_map(|i| {
            [
                Message::user(format!("read file {i}")),
                Message::Assistant { text: String::new(), tool_calls: vec![ToolCall { id: format!("c{i}"), name: "files.read".into(), arguments: json!({ "path": format!("{i}.md") }) }] },
                Message::Tool { call_id: format!("c{i}"), name: "files.read".into(), content: "x".repeat(size), is_error: false },
                Message::Assistant { text: format!("file {i} read"), tool_calls: vec![] },
            ]
        })
        .collect()
}

fn request(step: &Step) -> &ChatRequest {
    match step {
        Step::CallModel(r) => r,
        other => panic!("expected a model call, got {other:?}"),
    }
}

fn is_summary_request(r: &ChatRequest) -> bool {
    r.tools.is_empty() && r.messages.len() == 1 && matches!(&r.messages[0], Message::User { text, .. } if text.contains("checkpoint summary"))
}

fn first_text(r: &ChatRequest) -> &str {
    match &r.messages[0] {
        Message::User { text, .. } => text,
        other => panic!("{other:?}"),
    }
}

fn compacted(turn: &mut Turn) -> Vec<usize> {
    turn.drain_events().into_iter().filter_map(|e| if let AgentEvent::Compacted { messages } = e { Some(messages) } else { None }).collect()
}

#[test]
fn a_short_conversation_is_sent_as_it_is() {
    let (core, engine) = setup(5);
    let history = chat(2, 50);
    let (turn, step) = engine.start(&core, history.clone(), "next", 1);
    assert_eq!(request(&step).messages.len(), history.len() + 1);
    assert!(turn.compaction().is_none());
}

#[test]
fn old_tool_output_is_dropped_first_without_asking_the_model_for_a_summary() {
    let (core, engine) = setup(5);
    let (mut turn, step) = engine.start(&core, with_tool_output(3, 4_000), "and now?", 1);
    let r = request(&step);
    assert!(!is_summary_request(r), "no summary was needed");
    let notes = r.messages.iter().filter(|m| matches!(m, Message::Tool { content, .. } if content.contains("removed to save room"))).count();
    assert_eq!(notes, 3);
    assert_eq!(r.messages.len(), 13, "nothing else changed");
    assert!(compacted(&mut turn).is_empty());
    assert_eq!(turn.messages().len(), 13, "the transcript keeps every tool output");
    assert!(matches!(&turn.messages()[2], Message::Tool { content, .. } if content.len() == 4_000));
}

#[test]
fn a_long_chat_is_summarised_and_the_model_then_answers_with_the_summary_and_recent_turns() {
    let (mut core, engine) = setup(1);
    let history = chat(6, 1_000);
    let (mut turn, step) = engine.start(&core, history.clone(), "what next?", 1);
    let summary_call = request(&step).clone();
    assert!(is_summary_request(&summary_call), "{summary_call:?}");
    assert!(first_text(&summary_call).contains("question 0"));
    assert!(turn.is_summarizing());
    // The summary call does not count as one of the turn's steps (max_steps is 1 here).
    let step = engine.on_model(&mut turn, &mut core, answer("## Goal\nThe person asks questions."));
    let r = request(&step);
    assert!(!turn.is_summarizing());
    assert!(first_text(r).starts_with(SUMMARY_PREFIX) && first_text(r).contains("The person asks questions."));
    // The newest message is the person's, after the summary (joined to it when it is the whole tail).
    assert!(matches!(r.messages.last(), Some(Message::User { text, .. }) if text.ends_with("[END OF SUMMARY — the person's latest message follows]\n\nwhat next?")));
    let covers = turn.compaction().unwrap().covers;
    assert_eq!(covers, history.len(), "everything before the new message was summarised");
    assert_eq!(compacted(&mut turn), vec![covers]);
    assert!(r.messages.len() < history.len());
    // The answer arrives as usual and the transcript is whole.
    assert_eq!(engine.on_model(&mut turn, &mut core, answer("Here.")), Step::Done);
    assert_eq!(turn.messages().len(), history.len() + 2);
}

#[test]
fn a_summary_that_cannot_be_written_is_replaced_by_a_plain_list_and_the_turn_goes_on() {
    let (mut core, engine) = setup(5);
    let (mut turn, step) = engine.start(&core, chat(6, 1_000), "what next?", 1);
    assert!(is_summary_request(request(&step)));
    let step = engine.on_model(&mut turn, &mut core, Err(ProviderError::Network("down".into())));
    let r = request(&step);
    assert!(first_text(r).contains("could not be written") && first_text(r).contains("- question 0"));
    assert_eq!(compacted(&mut turn).len(), 1);
}

#[test]
fn a_request_refused_as_too_long_makes_room_and_is_tried_once_more() {
    let (mut core, mut engine) = setup(5);
    // The engine believes the window is large, so it sends everything.
    engine.set_context_window(Some(1_000_000));
    let (mut turn, step) = engine.start(&core, chat(6, 1_000), "what next?", 1);
    assert!(!is_summary_request(request(&step)));
    let too_long = || Err(ProviderError::Http { status: 400, message: "This model's maximum context length is 2048 tokens".into() });
    let step = engine.on_model(&mut turn, &mut core, too_long());
    assert!(is_summary_request(request(&step)), "{step:?}");
    let step = engine.on_model(&mut turn, &mut core, answer("summary"));
    let r = request(&step);
    assert!(first_text(r).contains("summary"));
    assert!(r.messages.len() < 13);
    // Refused again: the turn fails instead of looping.
    assert!(matches!(engine.on_model(&mut turn, &mut core, too_long()), Step::Failed { .. }));
}

#[test]
fn a_rate_limit_is_not_mistaken_for_a_long_request() {
    let (mut core, engine) = setup(5);
    let (mut turn, _) = engine.start(&core, chat(1, 10), "hi", 1);
    let step = engine.on_model(&mut turn, &mut core, Err(ProviderError::Http { status: 429, message: "too many tokens per minute".into() }));
    assert!(matches!(step, Step::Failed { .. }));
}

#[test]
fn a_later_compaction_updates_the_earlier_summary_and_only_moves_forward() {
    let (mut core, engine) = setup(5);
    let history = chat(12, 1_000);
    let earlier = Compaction { covers: 6, summary: "EARLIER SUMMARY".into(), pruned_before: 6 };
    let (mut turn, step) = engine.start_from(&core, history.clone(), Some(earlier), "and now?", 1, Default::default());
    let r = request(&step);
    assert!(is_summary_request(r));
    assert!(first_text(r).contains("PREVIOUS SUMMARY:\nEARLIER SUMMARY"));
    assert!(!first_text(r).contains("question 0 "), "already summarised turns are not sent again");
    assert!(first_text(r).contains("question 3 "));
    engine.on_model(&mut turn, &mut core, answer("NEW SUMMARY"));
    let c = turn.compaction().unwrap();
    assert!(c.covers > 6 && c.pruned_before >= c.covers && c.summary == "NEW SUMMARY");
}

#[test]
fn a_saved_compaction_that_does_not_fit_the_transcript_is_ignored() {
    let (core, engine) = setup(5);
    let history = with_tool_output(1, 10);
    for covers in [2, 99] {
        let (turn, step) = engine.start_from(&core, history.clone(), Some(Compaction { covers, summary: "S".into(), pruned_before: 0 }), "hi", 1, Default::default());
        assert!(turn.compaction().is_none(), "covers {covers}");
        assert_eq!(request(&step).messages.len(), history.len() + 1);
    }
}

#[test]
fn a_cancelled_turn_ignores_a_late_summary() {
    let (mut core, engine) = setup(5);
    let (mut turn, _) = engine.start(&core, chat(6, 1_000), "what next?", 1);
    engine.cancel(&mut turn, &mut core);
    assert_eq!(engine.on_model(&mut turn, &mut core, answer("late summary")), Step::Done);
    assert!(turn.compaction().is_none());
}
