#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use mobius_host::{CallError, CoreProcess, Options, Status};
use serde_json::{Value, json};

#[derive(Default, Clone)]
struct Seen {
    statuses: Arc<Mutex<Vec<Status>>>,
    notes: Arc<Mutex<Vec<(String, Value)>>>,
    asked: Arc<Mutex<Vec<(String, Value)>>>,
    logs: Arc<Mutex<Vec<String>>>,
}

type Answer = Option<Result<Value, String>>;

fn options(binary: PathBuf, args: &[&str], seen: &Seen, answer: Answer) -> Options {
    let (s, n, a, l) = (seen.statuses.clone(), seen.notes.clone(), seen.asked.clone(), seen.logs.clone());
    Options {
        binary,
        args: args.iter().map(|x| (*x).to_owned()).collect(),
        on_status: Arc::new(move |st| s.lock().unwrap().push(st)),
        on_notification: Arc::new(move |m, p| n.lock().unwrap().push((m.to_owned(), p.clone()))),
        on_request: answer.map(|answer| {
            Arc::new(move |m: &str, p: &Value| {
                a.lock().unwrap().push((m.to_owned(), p.clone()));
                answer.clone()
            }) as Arc<dyn Fn(&str, &Value) -> Result<Value, String> + Send + Sync>
        }),
        log: Arc::new(move |m| l.lock().unwrap().push(m.to_owned())),
    }
}

fn fake() -> PathBuf {
    PathBuf::from(env!("CARGO_BIN_EXE_fake-core"))
}

fn wait_for(what: &str, mut done: impl FnMut() -> bool) {
    let start = Instant::now();
    while !done() {
        assert!(start.elapsed() < Duration::from_secs(15), "timed out waiting for {what}");
        std::thread::sleep(Duration::from_millis(20));
    }
}

const T: Duration = Duration::from_secs(5);

fn ready(args: &[&str], seen: &Seen, answer: Answer) -> CoreProcess {
    let core = CoreProcess::start(options(fake(), args, seen, answer));
    wait_for("ready", || core.status() == Status::Ready);
    core
}

#[test]
fn it_becomes_ready_once_the_core_answers_a_ping() {
    let seen = Seen::default();
    let core = ready(&[], &seen, None);
    let statuses = seen.statuses.lock().unwrap().clone();
    assert_eq!(statuses, vec![Status::Ready], "starting is the state it begins in, so only the change is reported");
    core.stop();
}

#[test]
fn calls_get_their_own_answers_even_from_several_threads() {
    let seen = Seen::default();
    let core = Arc::new(ready(&[], &seen, None));
    let handles: Vec<_> = (0..8)
        .map(|i| {
            let core = core.clone();
            std::thread::spawn(move || core.call(&format!("m.{i}"), json!({}), T).unwrap())
        })
        .collect();
    for (i, h) in handles.into_iter().enumerate() {
        assert_eq!(h.join().unwrap(), json!({ "echo": format!("m.{i}") }));
    }
}

#[test]
fn a_failure_from_the_core_comes_back_with_its_code_message_and_data() {
    let seen = Seen::default();
    let core = ready(&[], &seen, None);
    match core.call("test.fail", json!({}), T) {
        Err(CallError::Rpc(e)) => assert_eq!((e.code, e.message.as_str(), e.data), (-32602, "nope", Some(json!({ "why": 1 })))),
        other => panic!("{other:?}"),
    }
}

#[test]
fn notifications_reach_the_listener() {
    let seen = Seen::default();
    let core = ready(&[], &seen, None);
    core.call("test.notify", json!({}), T).unwrap();
    assert_eq!(seen.notes.lock().unwrap().clone(), vec![("test.event".to_owned(), json!({ "n": 1 }))]);
}

#[test]
fn a_question_from_the_core_is_answered_by_the_host_and_a_failure_is_reported_as_one() {
    let seen = Seen::default();
    let core = ready(&[], &seen, Some(Ok(json!({ "done": true }))));
    let reply = core.call("test.ask", json!({}), T).unwrap();
    assert_eq!(seen.asked.lock().unwrap().clone(), vec![("host.tool".to_owned(), json!({ "x": 1 }))]);
    assert_eq!(reply["host_said"]["id"], json!("h1"));
    assert_eq!(reply["host_said"]["result"], json!({ "done": true }));
    core.stop();

    let seen = Seen::default();
    let core = ready(&[], &seen, Some(Err("tool exploded".into())));
    let reply = core.call("test.ask", json!({}), T).unwrap();
    assert_eq!(reply["host_said"]["error"]["message"], json!("tool exploded"));
    assert!(reply["host_said"].get("result").is_none());
    core.stop();

    let seen = Seen::default();
    let core = ready(&[], &seen, None);
    let reply = core.call("test.ask", json!({}), T).unwrap();
    assert_eq!(reply["host_said"]["error"]["message"], json!("method not found"), "without a handler the host refuses");
}

#[test]
fn a_long_failure_message_is_cut_before_it_goes_back_to_the_core() {
    let seen = Seen::default();
    let core = ready(&[], &seen, Some(Err("é".repeat(1000))));
    let reply = core.call("test.ask", json!({}), T).unwrap();
    assert_eq!(reply["host_said"]["error"]["message"].as_str().unwrap().chars().count(), 300);
}

#[test]
fn a_call_that_is_never_answered_times_out_and_does_not_hang_later_calls() {
    let seen = Seen::default();
    let core = ready(&[], &seen, None);
    assert_eq!(core.call("test.silent", json!({}), Duration::from_millis(200)), Err(CallError::Timeout));
    assert_eq!(core.call("x.y", json!({}), T).unwrap(), json!({ "echo": "x.y" }));
}

#[test]
fn a_crash_fails_the_waiting_call_and_the_core_is_restarted() {
    let seen = Seen::default();
    let core = ready(&[], &seen, None);
    assert_eq!(core.call("test.exit", json!({}), T), Err(CallError::NotRunning));
    wait_for("restart and ready again", || {
        let s = seen.statuses.lock().unwrap().clone();
        s.contains(&Status::Restarting) && s.last() == Some(&Status::Ready)
    });
    let statuses = seen.statuses.lock().unwrap().clone();
    let from = statuses.iter().position(|s| *s == Status::Restarting).unwrap();
    assert_eq!(statuses[from..], [Status::Restarting, Status::Starting, Status::Ready], "a restart passes through starting, like the first start");
    assert_eq!(core.call("x.y", json!({}), T).unwrap(), json!({ "echo": "x.y" }));
}

#[test]
fn a_core_slow_to_answer_when_it_starts_is_waited_for_not_ended() {
    let seen = Seen::default();
    // Longer than one ping waits: the host asks again instead of ending it as if it had hung.
    let core = ready(&["--slow-start", "7000"], &seen, None);
    assert!(!seen.logs.lock().unwrap().iter().any(|l| l.contains("exited") || l.contains("ending it")), "{:?}", seen.logs.lock().unwrap());
    assert!(!seen.statuses.lock().unwrap().contains(&Status::Restarting));
    core.stop();
}

#[test]
fn a_core_that_keeps_crashing_ends_up_failed_and_calls_say_so() {
    let seen = Seen::default();
    let core = CoreProcess::start(options(fake(), &["--never-start"], &seen, None));
    wait_for("failed", || core.status() == Status::Failed);
    assert_eq!(core.call("x.y", json!({}), T), Err(CallError::NotRunning));
    assert!(seen.logs.lock().unwrap().iter().any(|l| l.contains("keeps crashing")));
}

#[test]
fn a_program_that_does_not_exist_fails_at_once() {
    let seen = Seen::default();
    let core = CoreProcess::start(options(PathBuf::from("no-such-program-anywhere"), &[], &seen, None));
    wait_for("failed", || core.status() == Status::Failed);
    assert_eq!(seen.statuses.lock().unwrap().last(), Some(&Status::Failed));
}

#[test]
fn stopping_ends_the_core_and_later_calls_are_refused() {
    let seen = Seen::default();
    let core = Arc::new(ready(&[], &seen, None));
    let waiting = {
        let core = core.clone();
        std::thread::spawn(move || core.call("test.silent", json!({}), Duration::from_secs(10)))
    };
    std::thread::sleep(Duration::from_millis(200));
    core.stop_shared();
    assert_eq!(waiting.join().unwrap(), Err(CallError::Stopped));
    assert_eq!(core.call("x.y", json!({}), T), Err(CallError::Stopped));
    assert_eq!(seen.statuses.lock().unwrap().iter().filter(|s| **s == Status::Restarting).count(), 0, "stopping is not a crash");
}

#[test]
fn it_works_with_the_real_daemon() {
    let daemon = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target/debug").join(if cfg!(windows) { "mobius-cored.exe" } else { "mobius-cored" });
    assert!(daemon.exists(), "build it first: npm run build:core ({})", daemon.display());
    let dir = std::env::temp_dir().join(format!("mobius-host-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let seen = Seen::default();
    let core = CoreProcess::start(options(daemon, &["--db", dir.join("core.db").to_str().unwrap()], &seen, None));
    wait_for("ready", || core.status() == Status::Ready);
    let pong = core.call("core.ping", json!({}), T).unwrap();
    assert_eq!(pong["protocol"], json!(1));
    assert!(matches!(core.call("no.such.method", json!({}), T), Err(CallError::Rpc(e)) if e.code == -32601));
    core.stop();
    let _ = std::fs::remove_dir_all(dir);
}
