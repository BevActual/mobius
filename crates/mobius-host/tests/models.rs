//! The models service against the scripted stand-in for the core.
#![allow(clippy::unwrap_used, clippy::type_complexity)]
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use mobius_host::models::Models;
use mobius_host::{CoreProcess, Options, Status};
use serde_json::{Value, json};

type Events = Arc<Mutex<Vec<Value>>>;

fn models(assistant: Arc<dyn Fn(&str, &str) -> Result<(), String> + Send + Sync>) -> (Arc<Models>, Arc<CoreProcess>, Events) {
    let holder: Arc<Mutex<Option<Arc<Models>>>> = Arc::default();
    let note_holder = holder.clone();
    let core = Arc::new(CoreProcess::start(Options {
        binary: PathBuf::from(env!("CARGO_BIN_EXE_fake-core")),
        args: vec![],
        on_status: Arc::new(|_| {}),
        on_notification: Arc::new(move |method, params| {
            if let Some(m) = note_holder.lock().unwrap().as_ref() {
                m.handle_notification(method, params);
            }
        }),
        on_request: None,
        log: Arc::new(|_| {}),
    }));
    let start = Instant::now();
    while core.status() != Status::Ready {
        assert!(start.elapsed() < Duration::from_secs(10));
        std::thread::sleep(Duration::from_millis(20));
    }
    let events: Events = Arc::default();
    let sink = events.clone();
    let m = Models::with_timing(core.clone(), Arc::new(move |e| sink.lock().unwrap().push(e)), assistant, Duration::from_millis(30), Duration::from_secs(5));
    *holder.lock().unwrap() = Some(m.clone());
    (m, core, events)
}

fn wait_for(what: &str, mut done: impl FnMut() -> bool) {
    let start = Instant::now();
    while !done() {
        assert!(start.elapsed() < Duration::from_secs(10), "timed out waiting for {what}");
        std::thread::sleep(Duration::from_millis(20));
    }
}

fn ok_assistant() -> Arc<dyn Fn(&str, &str) -> Result<(), String> + Send + Sync> {
    Arc::new(|_, _| Ok(()))
}

#[test]
fn a_search_waits_for_its_job_and_keeps_only_well_formed_results() {
    let (m, _core, _e) = models(ok_assistant());
    assert_eq!(m.discover(&json!("coder")), json!({ "ok": true, "results": [] }), "the stand-in's junk row is dropped");
    assert_eq!(m.discover(&json!("x".repeat(101))), json!({ "ok": false, "error": "That search is too long." }));
}

#[test]
fn a_download_reports_progress_and_finishing_and_refuses_what_is_not_a_model_file() {
    let (m, _core, events) = models(ok_assistant());
    assert_eq!(m.download(&json!("acme/Tiny"), &json!("../x.gguf")), json!({ "ok": false, "error": "That is not a model file Mobius can download." }));
    assert!(events.lock().unwrap().is_empty());
    assert_eq!(m.download(&json!("acme/Tiny"), &json!("Tiny.gguf")), json!({ "ok": true }));
    let seen = events.lock().unwrap().clone();
    assert_eq!(seen[0], json!({ "kind": "download", "state": "started", "repo": "acme/Tiny", "file": "Tiny.gguf" }));
    assert!(seen.contains(&json!({ "kind": "progress", "job": "job-get", "done": 5.0, "total": 10.0 })));
    assert_eq!(seen.last().unwrap(), &json!({ "kind": "download", "state": "finished", "repo": "acme/Tiny", "file": "Tiny.gguf" }));
}

#[test]
fn a_failed_download_says_why() {
    let (m, _core, events) = models(ok_assistant());
    assert_eq!(m.download(&json!("bad/repo"), &json!("a.gguf")), json!({ "ok": false, "error": "no such file" }));
    assert_eq!(events.lock().unwrap().last().unwrap()["error"], "no such file");
}

#[test]
fn a_result_that_arrives_before_it_is_waited_for_is_not_lost() {
    let (m, _core, _e) = models(ok_assistant());
    assert!(m.handle_notification("models.job", &json!({ "job": "job-get", "ok": true, "result": {} })));
    let begun = Instant::now();
    assert_eq!(m.download(&json!("acme/Tiny"), &json!("Tiny.gguf")), json!({ "ok": true }));
    assert!(begun.elapsed() < Duration::from_millis(250), "it did not wait for the stand-in's own (later) notice");
}

#[test]
fn notifications_that_are_not_about_a_job_are_not_taken() {
    let (m, _core, _e) = models(ok_assistant());
    assert!(!m.handle_notification("agent.delta", &json!({ "conversation": "c" })));
    assert!(!m.handle_notification("models.job", &json!({ "ok": true })));
    assert!(!m.handle_notification("other.thing", &json!({ "job": "x" })));
}

#[test]
fn hardware_and_status_come_through_checked() {
    let (m, _core, _e) = models(ok_assistant());
    assert_eq!(m.hardware()["vram_total"], 1);
    assert_eq!(m.status()["binary"], "llama");
    assert_eq!(m.status()["runtime"]["state"], "ready");
    assert_eq!(m.local(), json!([]));
}

#[test]
fn starting_a_model_points_the_agent_at_it_once_it_is_ready_and_says_so() {
    let pointed: Arc<Mutex<Vec<(String, String)>>> = Arc::default();
    let record = pointed.clone();
    let (m, _core, events) = models(Arc::new(move |url, model| {
        record.lock().unwrap().push((url.to_owned(), model.to_owned()));
        Ok(())
    }));
    assert_eq!(m.start(&json!(5), &json!(null)), json!({ "ok": false, "error": "That is not a model on this computer." }));
    assert_eq!(m.start(&json!("m"), &json!(999)), json!({ "ok": false, "error": "That context size is not one Mobius offers." }));
    assert_eq!(m.start(&json!("m"), &json!(8192)), json!({ "ok": true }));
    wait_for("the agent to be pointed at the model", || events.lock().unwrap().iter().any(|e| e["snapshot"]["runtime"]["usingForAssistant"] == true));
    assert_eq!(pointed.lock().unwrap().clone(), vec![("http://127.0.0.1:1/v1".to_owned(), "x".to_owned())], "once");
    assert_eq!(m.stop(), json!({ "ok": true }));
}

#[test]
fn if_the_agent_cannot_be_set_up_the_page_is_told_why_and_nothing_is_retried() {
    let calls = Arc::new(Mutex::new(0));
    let counter = calls.clone();
    let (m, _core, events) = models(Arc::new(move |_, _| {
        *counter.lock().unwrap() += 1;
        Err("the agent refused".to_owned())
    }));
    m.start(&json!("m"), &json!(null));
    wait_for("a runtime report", || events.lock().unwrap().iter().any(|e| e["snapshot"]["runtime"]["reason"] == "the agent refused"));
    std::thread::sleep(Duration::from_millis(400));
    assert_eq!(*calls.lock().unwrap(), 1);
    m.stop();
}

#[test]
fn losing_the_core_clears_the_runtime_for_the_window() {
    let (m, _core, events) = models(ok_assistant());
    m.start(&json!("m"), &json!(null));
    wait_for("a runtime report", || !events.lock().unwrap().is_empty());
    m.mark_stopped();
    wait_for("the clearing", || events.lock().unwrap().last().is_some_and(|e| e["snapshot"] == json!({ "binary": null, "runtime": null })));
}
