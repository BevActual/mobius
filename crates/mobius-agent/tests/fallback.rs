#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
//! A second model to try when the first one cannot answer.
use std::sync::{Arc, Mutex};

use mobius_agent::fallback::{FallbackProvider, should_fall_back};
use mobius_agent::provider::{ChatRequest, Completion, Provider, ProviderError, ScriptedProvider, StopReason};

fn request() -> ChatRequest {
    ChatRequest { model: "first-model".into(), system: "sys".into(), messages: Vec::new(), tools: Vec::new(), effort: None, max_tokens: None }
}

fn ok(text: &str) -> Result<Completion, ProviderError> {
    Ok(Completion { text: text.into(), tool_calls: Vec::new(), stop: StopReason::EndTurn, usage: None })
}

fn http(status: u16) -> Result<Completion, ProviderError> {
    Err(ProviderError::Http { status, message: "nope".into() })
}

struct World {
    provider: FallbackProvider,
    primary: Arc<ScriptedProvider>,
    second: Arc<ScriptedProvider>,
    notes: Arc<Mutex<Vec<String>>>,
}

fn world(primary: Vec<Result<Completion, ProviderError>>, second: Vec<Result<Completion, ProviderError>>) -> World {
    let primary = Arc::new(ScriptedProvider::new(primary));
    let second = Arc::new(ScriptedProvider::new(second));
    let notes = Arc::new(Mutex::new(Vec::new()));
    let sink = notes.clone();
    let provider = FallbackProvider::new(primary.clone(), second.clone(), "second-model", Box::new(move |model, why| sink.lock().unwrap().push(format!("{model}: {why}"))));
    World { provider, primary, second, notes }
}

fn ask(w: &World) -> (Result<Completion, ProviderError>, String) {
    let mut streamed = String::new();
    let result = w.provider.complete(&request(), &mut |t| {
        streamed.push_str(t);
        true
    });
    (result, streamed)
}

#[test]
fn a_working_first_model_is_the_only_one_asked() {
    let w = world(vec![ok("from the first")], vec![ok("from the second")]);
    let (result, streamed) = ask(&w);
    assert_eq!(result.unwrap().text, "from the first");
    assert_eq!(streamed, "from the first");
    assert!(w.second.requests().is_empty());
    assert!(w.notes.lock().unwrap().is_empty());
}

#[test]
fn a_busy_or_broken_first_model_hands_over_to_the_second_with_the_same_request_but_its_own_name() {
    for failure in [http(503), http(500), http(429), http(408), Err(ProviderError::Network("connection refused".into())), Err(ProviderError::Protocol("not json".into()))] {
        let label = format!("{failure:?}");
        let w = world(vec![failure], vec![ok("from the second")]);
        let (result, streamed) = ask(&w);
        assert_eq!(result.unwrap().text, "from the second", "{label}");
        assert_eq!(streamed, "from the second", "{label}");
        let sent = w.second.requests();
        assert_eq!(sent.len(), 1, "{label}");
        assert_eq!(sent[0].model, "second-model", "{label}");
        assert_eq!(sent[0].system, "sys", "{label}");
        assert_eq!(w.primary.requests()[0].model, "first-model", "{label}");
        assert_eq!(w.notes.lock().unwrap().len(), 1, "{label}");
        assert!(w.notes.lock().unwrap()[0].starts_with("second-model: "), "{label}");
    }
}

#[test]
fn a_mistake_on_our_side_is_shown_and_not_hidden_by_a_second_model() {
    for status in [400, 401, 403, 404, 413, 422] {
        let w = world(vec![http(status)], vec![ok("from the second")]);
        let (result, _) = ask(&w);
        assert!(matches!(result, Err(ProviderError::Http { status: s, .. }) if s == status), "{status}");
        assert!(w.second.requests().is_empty(), "{status}");
        assert!(w.notes.lock().unwrap().is_empty(), "{status}");
    }
}

#[test]
fn being_stopped_is_not_a_failure_to_work_around() {
    let w = world(vec![Err(ProviderError::Cancelled)], vec![ok("from the second")]);
    let (result, _) = ask(&w);
    assert_eq!(result, Err(ProviderError::Cancelled));
    assert!(w.second.requests().is_empty());
}

#[test]
fn once_words_have_reached_the_person_the_second_model_is_not_asked_to_start_over() {
    // A scripted provider streams its text only on success, so use one that streams and then fails.
    struct Breaks;
    impl Provider for Breaks {
        fn complete(&self, _: &ChatRequest, on_text: &mut dyn FnMut(&str) -> bool) -> Result<Completion, ProviderError> {
            on_text("half an answ");
            Err(ProviderError::Network("connection reset".into()))
        }
    }
    let second = Arc::new(ScriptedProvider::new(vec![ok("from the second")]));
    let notes = Arc::new(Mutex::new(Vec::new()));
    let sink = notes.clone();
    let provider = FallbackProvider::new(Arc::new(Breaks), second.clone(), "second-model", Box::new(move |m, w| sink.lock().unwrap().push(format!("{m}: {w}"))));
    let mut streamed = String::new();
    let result = provider.complete(&request(), &mut |t| {
        streamed.push_str(t);
        true
    });
    assert!(matches!(result, Err(ProviderError::Network(_))));
    assert_eq!(streamed, "half an answ");
    assert!(second.requests().is_empty());
    assert!(notes.lock().unwrap().is_empty());
}

#[test]
fn when_both_fail_the_person_sees_the_second_failure_and_was_told_about_the_switch() {
    let w = world(vec![http(503)], vec![http(500)]);
    let (result, _) = ask(&w);
    assert!(matches!(result, Err(ProviderError::Http { status: 500, .. })));
    assert_eq!(w.notes.lock().unwrap().len(), 1);
}

#[test]
fn the_rule_for_when_to_switch() {
    assert!(should_fall_back(&ProviderError::Http { status: 502, message: String::new() }));
    assert!(should_fall_back(&ProviderError::Http { status: 599, message: String::new() }));
    assert!(should_fall_back(&ProviderError::Http { status: 429, message: String::new() }));
    assert!(!should_fall_back(&ProviderError::Http { status: 499, message: String::new() }));
    assert!(!should_fall_back(&ProviderError::Http { status: 200, message: String::new() }));
    assert!(!should_fall_back(&ProviderError::Cancelled));
}

#[test]
fn the_notice_says_what_kind_of_failure_it_was_but_never_repeats_what_the_service_said() {
    for failure in [Err(ProviderError::Http { status: 503, message: "SECRET-BODY key=sk-123".into() }), Err(ProviderError::Network("SECRET-BODY".into())), Err(ProviderError::Protocol("SECRET-BODY".into()))] {
        let w = world(vec![failure], vec![ok("fine")]);
        let _ = ask(&w);
        let notes = w.notes.lock().unwrap();
        assert_eq!(notes.len(), 1);
        assert!(!notes[0].contains("SECRET"), "{}", notes[0]);
        assert!(!notes[0].contains("sk-123"), "{}", notes[0]);
    }
    let w = world(vec![http(429)], vec![ok("fine")]);
    let _ = ask(&w);
    assert!(w.notes.lock().unwrap()[0].contains("too busy"));
}

/// Gives one call early, then fails.
struct CallsThenFails;

impl Provider for CallsThenFails {
    fn complete(&self, _: &ChatRequest, _: &mut dyn FnMut(&str) -> bool) -> Result<Completion, ProviderError> {
        Err(ProviderError::Network("down".into()))
    }

    fn complete_with_calls(&self, _: &ChatRequest, _: &mut dyn FnMut(&str) -> bool, on_call: &mut dyn FnMut(&mobius_agent::message::ToolCall)) -> Result<Completion, ProviderError> {
        on_call(&mobius_agent::message::ToolCall { id: "c1".into(), name: "demo.echo".into(), arguments: serde_json::json!({}) });
        Err(ProviderError::Network("cut short".into()))
    }
}

#[test]
fn no_second_model_once_a_call_was_given_early_since_it_may_have_run() {
    let second = Arc::new(ScriptedProvider::new(vec![ok("again")]));
    let provider = FallbackProvider::new(Arc::new(CallsThenFails), second.clone(), "second-model", Box::new(|_, _| {}));
    let mut given = Vec::new();
    let result = provider.complete_with_calls(&request(), &mut |_| true, &mut |c| given.push(c.id.clone()));
    assert!(matches!(result, Err(ProviderError::Network(_))));
    assert_eq!(given, ["c1"]);
    assert!(second.requests().is_empty());
}
