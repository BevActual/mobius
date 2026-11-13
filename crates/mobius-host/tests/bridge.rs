#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use mobius_host::{Bridge, BridgeError, CoreProcess, Options, Status};
use serde_json::json;

type Events = Arc<std::sync::Mutex<Vec<(String, serde_json::Value)>>>;

fn bridge() -> (Bridge, Arc<CoreProcess>) {
    let (b, c, _, _) = bridge_in(tempfile::tempdir().unwrap());
    (b, c)
}

fn bridge_in(dir: tempfile::TempDir) -> (Bridge, Arc<CoreProcess>, Events, tempfile::TempDir) {
    let events: Events = Arc::default();
    let sink = events.clone();
    let core = Arc::new(CoreProcess::start(Options {
        binary: PathBuf::from(env!("CARGO_BIN_EXE_fake-core")),
        args: vec![],
        on_status: Arc::new(|_| {}),
        on_notification: Arc::new(|_, _| {}),
        on_request: None,
        log: Arc::new(|_| {}),
    }));
    let start = Instant::now();
    while core.status() != Status::Ready {
        assert!(start.elapsed() < Duration::from_secs(10));
        std::thread::sleep(Duration::from_millis(20));
    }
    let emit: mobius_host::bridge::Emit = Arc::new(move |name, v| sink.lock().unwrap().push((name.to_owned(), v)));
    (Bridge::new(core.clone(), dir.path().to_path_buf(), emit, Arc::new(mobius_host::secrets::MemorySecrets::new(true))), core, events, dir)
}

#[test]
fn the_core_status_is_a_word_the_interface_knows() {
    let (bridge, _core) = bridge();
    assert_eq!(bridge.call("core", "getStatus", &[]).unwrap(), json!("ready"));
}

#[test]
fn about_says_what_runs_and_where_the_data_is() {
    let (bridge, _core) = bridge();
    let about = bridge.call("app", "about", &[]).unwrap();
    assert_eq!(about["core"], json!({ "version": "fake", "protocol": 1 }));
    assert!(about["dataFolder"].as_str().unwrap().len() > 3);
    assert_eq!(about["engine"], json!("unknown"));
    bridge.set_engine("Chromium 156");
    assert_eq!(bridge.call("app", "about", &[]).unwrap()["engine"], json!("Chromium 156"));
    assert!(about.get("electron").is_none() && about.get("node").is_none());
    assert!(!about["platform"].as_str().unwrap().is_empty());
}

#[test]
fn anything_not_listed_is_refused_with_a_reason_and_never_reaches_the_core() {
    let (bridge, _core) = bridge();
    for (ns, m) in [("agent", "eval"), ("core", "call"), ("core", "stop"), ("nope", "x"), ("", ""), ("tools", "invoke"), ("Core", "getStatus")] {
        let error = bridge.call(ns, m, &[json!("x")]).unwrap_err();
        assert!(matches!(error, BridgeError::NotAvailable(_)), "{ns}.{m}");
        assert!(error.message().contains("not available"), "{ns}.{m}: {}", error.message());
        assert_eq!(error.kind(), "not_available");
    }
}

fn call(b: &Bridge, ns: &str, m: &str, args: serde_json::Value) -> serde_json::Value {
    b.call(ns, m, args.as_array().unwrap()).unwrap()
}

#[test]
fn appearance_and_preferences_are_checked_saved_and_announced() {
    let (b, _c, events, dir) = bridge_in(tempfile::tempdir().unwrap());
    assert_eq!(call(&b, "appearance", "get", json!([]))["theme"], "system");
    let after = call(&b, "appearance", "set", json!([{ "theme": "dark" }]));
    assert_eq!(after["theme"], "dark");
    let refused = call(&b, "appearance", "set", json!([{ "theme": "neon" }]));
    assert_eq!(refused["theme"], "dark", "a bad value changes nothing");
    assert_eq!(call(&b, "appearance", "set", json!([]))["theme"], "dark", "no argument at all");
    assert_eq!(events.lock().unwrap().iter().filter(|(n, _)| n == "mobius:appearance-changed").count(), 1, "only the real change is announced");
    assert_eq!(call(&b, "preferences", "set", json!([{ "approvalMode": "smart" }]))["approvalMode"], "smart");
    assert_eq!(b.preference("approvalMode"), "smart");
    assert_eq!(call(&b, "preferences", "set", json!([{ "approvalMode": "yolo" }]))["approvalMode"], "smart");
    assert!(dir.path().join("appearance.json").exists());
}

#[test]
fn history_and_bookmarks_answer_the_interface() {
    let (b, _c, events, _dir) = bridge_in(tempfile::tempdir().unwrap());
    b.visit("https://example.com/a", "Example A");
    b.visit("file:///secret", "no");
    let h = call(&b, "history", "get", json!([""]));
    assert_eq!(h["enabled"], true);
    assert_eq!(h["entries"].as_array().unwrap().len(), 1);
    assert_eq!(call(&b, "history", "get", json!(["nothing like it"]))["entries"].as_array().unwrap().len(), 0);
    call(&b, "history", "get", json!([{ "not": "a string" }]));
    call(&b, "history", "setEnabled", json!(["yes"]));
    assert_eq!(call(&b, "history", "get", json!([""]))["enabled"], true, "a non-boolean changes nothing");
    call(&b, "history", "setEnabled", json!([false]));
    b.visit("https://example.com/b", "B");
    assert_eq!(call(&b, "history", "get", json!([""]))["entries"].as_array().unwrap().len(), 1, "paused");
    call(&b, "history", "remove", json!([5]));
    call(&b, "history", "remove", json!(["x".repeat(3000)]));
    assert_eq!(call(&b, "history", "get", json!([""]))["entries"].as_array().unwrap().len(), 1);
    call(&b, "history", "remove", json!(["https://example.com/a"]));
    assert_eq!(call(&b, "history", "get", json!([""]))["entries"].as_array().unwrap().len(), 0);
    call(&b, "history", "clear", json!([]));
    assert!(events.lock().unwrap().iter().any(|(n, _)| n == "mobius:history-changed"));
    assert_eq!(call(&b, "bookmarks", "get", json!([""])), json!([]));
}

#[test]
fn bots_go_through_the_bridge_with_events_and_plain_failures() {
    let (b, _c, events, _dir) = bridge_in(tempfile::tempdir().unwrap());
    assert_eq!(call(&b, "bots", "get", json!([]))["bots"].as_array().unwrap().len(), 1);
    let made = call(&b, "bots", "create", json!([{ "name": "Writer", "instructions": "Be brief.", "model": "m1" }]));
    assert_eq!(made["ok"], true);
    let id = made["bot"]["id"].as_str().unwrap().to_owned();
    assert_eq!(call(&b, "bots", "create", json!([{ "name": "writer", "instructions": "", "model": "" }]))["ok"], false);
    assert_eq!(call(&b, "bots", "update", json!([{ "id": id, "draft": { "name": "Author", "instructions": "", "model": "" } }]))["bot"]["name"], "Author");
    assert_eq!(call(&b, "bots", "update", json!(["bogus"]))["ok"], false);
    assert_eq!(call(&b, "bots", "move", json!([{ "id": id, "direction": "up" }]))["ok"], true);
    assert_eq!(call(&b, "bots", "move", json!([{ "id": id, "direction": "sideways" }]))["ok"], false);
    assert_eq!(b.bot_for(&format!("c-{id}-abc")).unwrap().name, "Author");
    assert!(b.bot_for("c-plain-id").is_none());
    assert_eq!(call(&b, "bots", "remove", json!(["main"]))["ok"], false);
    assert_eq!(call(&b, "bots", "remove", json!(["../etc"]))["ok"], false);
    assert_eq!(call(&b, "bots", "remove", json!([id]))["removedSessions"], 0);
    assert!(b.bot_for(&format!("c-{id}-abc")).is_none(), "a removed bot no longer applies");
    assert!(events.lock().unwrap().iter().filter(|(n, _)| n == "mobius:bots-changed").count() >= 3);
}

#[test]
fn the_agent_calls_are_checked_before_they_reach_the_core() {
    let (b, core, _events, _dir) = bridge_in(tempfile::tempdir().unwrap());
    let sent = |b: &Bridge, args: serde_json::Value| call(b, "agent", "send", args);
    assert_eq!(sent(&b, json!(["../x", "hi"]))["ok"], false);
    assert_eq!(sent(&b, json!(["c-1", "  "]))["ok"], false);
    assert_eq!(sent(&b, json!(["c-1", "hi", "not a list"]))["ok"], false);
    assert_eq!(sent(&b, json!(["c-1", "hi"]))["ok"], true);
    assert_eq!(call(&b, "agent", "setModel", json!(["bad\nname"]))["ok"], false);
    assert_eq!(call(&b, "agent", "configure", json!([{ "baseUrl": "" }]))["error"], "Those settings are not valid.");
    assert_eq!(call(&b, "agent", "deleteConversation", json!(["../x"]))["ok"], false);
    assert_eq!(call(&b, "agent", "rewind", json!([5]))["ok"], false);
    assert_eq!(call(&b, "agent", "revokeGrant", json!([0]))["ok"], false);
    assert_eq!(call(&b, "agent", "revokeGrant", json!(["1"]))["ok"], false);
    assert_eq!(call(&b, "agent", "resolve", json!([0, true, "once"]))["ok"], false);
    assert_eq!(call(&b, "agent", "resolve", json!([3, "yes", "once"]))["ok"], false);
    assert_eq!(call(&b, "agent", "resolve", json!([3, true, "forever"]))["ok"], false);
    assert_eq!(call(&b, "agent", "resolve", json!([3, true, "once"]))["ok"], true);
    assert_eq!(call(&b, "agent", "history", json!(["../x"])), json!([]));
    assert_eq!(call(&b, "agent", "transcribe", json!(["AAAA", "text/plain"]))["ok"], false);
    assert!(matches!(b.call("agent", "tools", &[]), Err(BridgeError::NotAvailable(_))));
    let methods: Vec<String> = core.call("test.log", json!({}), Duration::from_secs(5)).unwrap().as_array().unwrap().iter().map(|c| c["method"].as_str().unwrap().to_owned()).collect();
    assert_eq!(methods, vec!["agent.send", "permissions.resolve"], "only the acceptable calls got through");
}

#[test]
fn choosing_an_approval_mode_or_effort_tells_the_core_and_becoming_ready_tells_it_again() {
    let (b, core, events, _dir) = bridge_in(tempfile::tempdir().unwrap());
    call(&b, "preferences", "set", json!([{ "approvalMode": "smart", "reasoningEffort": "high" }]));
    call(&b, "preferences", "set", json!([{ "approvalMode": "smart" }]));
    let log = |core: &CoreProcess| core.call("test.log", json!({}), Duration::from_secs(5)).unwrap().as_array().unwrap().clone();
    let l = log(&core);
    assert_eq!(l.iter().filter(|c| c["method"] == "permissions.set_mode").count(), 1, "an unchanged choice is not sent again");
    assert!(l.iter().any(|c| c["method"] == "agent.set_effort" && c["params"]["effort"] == "high"));
    b.on_core_status(Status::Ready);
    let l = log(&core);
    assert_eq!(l.iter().rfind(|c| c["method"] == "permissions.set_mode").unwrap()["params"]["mode"], "smart");
    assert!(events.lock().unwrap().iter().any(|(n, v)| n == "mobius:core-status" && v == "ready"));
    assert!(events.lock().unwrap().iter().any(|(n, _)| n == "mobius:agent-settings"));
}

#[test]
fn only_checked_notifications_reach_the_window() {
    let (b, _core, events, _dir) = bridge_in(tempfile::tempdir().unwrap());
    b.on_core_notification("agent.delta", &json!({ "conversation": "c-1", "turn": 1, "text": "hi" }));
    b.on_core_notification("agent.delta", &json!({ "conversation": "../x", "turn": 1, "text": "hi" }));
    b.on_core_notification("models.job", &json!({}));
    assert_eq!(events.lock().unwrap().iter().filter(|(n, _)| n == "mobius:agent-notification").count(), 1);
}

#[test]
fn every_event_name_is_one_the_window_toolkit_accepts() {
    let (b, _core, events, _dir) = bridge_in(tempfile::tempdir().unwrap());
    call(&b, "appearance", "set", json!([{ "theme": "dark" }]));
    call(&b, "preferences", "set", json!([{ "keepAwake": true }]));
    call(&b, "history", "clear", json!([]));
    call(&b, "history", "remove", json!(["https://a.example/"]));
    call(&b, "bookmarks", "remove", json!(["https://a.example/"]));
    call(&b, "bots", "create", json!([{ "name": "N", "instructions": "", "model": "" }]));
    b.on_core_status(Status::Ready);
    b.on_core_notification("agent.delta", &json!({ "conversation": "c-1", "turn": 1, "text": "x" }));
    let names: Vec<String> = events.lock().unwrap().iter().map(|(n, _)| n.clone()).collect();
    assert!(names.len() >= 8, "{names:?}");
    for name in names {
        assert!(name.starts_with("mobius:") && name.bytes().all(|c| c.is_ascii_alphanumeric() || b"-/:_".contains(&c)), "{name}");
    }
}

mod browser {
    use super::*;
    use mobius_browser::engine::fake::FakeEngine;
    use mobius_browser::tabs::Browser;
    use mobius_host::bridge::Dialogs;

    struct NoKeys;
    impl mobius_host::quick_entry::Registrar for NoKeys {
        fn register(&mut self, _: &str, _: Arc<dyn Fn() + Send + Sync>) -> bool {
            true
        }
        fn unregister(&mut self, _: &str) {}
    }

    struct NoBlock;
    impl mobius_host::awake::Blocker for NoBlock {
        fn start(&mut self) {}
        fn stop(&mut self) {}
    }

    struct Picker(Option<PathBuf>);
    impl Dialogs for Picker {
        fn pick_text_file(&self) -> Option<PathBuf> {
            self.0.clone()
        }
        fn open_path(&self, _: &std::path::Path) {}
        fn show_path(&self, _: &std::path::Path) {}
        fn cancel_download(&self, _: &std::path::Path) {}
        fn window_focused(&self) -> bool {
            false
        }
        fn show_notice(&self, _: &mobius_host::notify::Notice) {}
        fn awake_blocker(&self) -> Box<dyn mobius_host::awake::Blocker> {
            Box::new(NoBlock)
        }
        fn shortcut_registrar(&self) -> Box<dyn mobius_host::quick_entry::Registrar> {
            Box::new(NoKeys)
        }
        fn bring_forward(&self) {}
    }

    fn with_browser(picker: Option<PathBuf>) -> (Bridge, Arc<FakeEngine>, Arc<Browser>, Events, tempfile::TempDir) {
        let (b, _core, events, dir) = bridge_in(tempfile::tempdir().unwrap());
        let engine = Arc::new(FakeEngine::default());
        let sink = events.clone();
        let browser = Arc::new(Browser::new(engine.clone(), Arc::new(move |n, p| sink.lock().unwrap().push((n.to_owned(), p))), Box::new(|_, _| {})));
        b.attach(browser.clone(), Arc::new(Picker(picker)));
        std::mem::forget(_core);
        (b, engine, browser, events, dir)
    }

    #[test]
    fn without_a_browser_the_calls_say_it_is_not_ready() {
        let (b, _c, _e, _d) = bridge_in(tempfile::tempdir().unwrap());
        assert!(matches!(b.call("browser", "getState", &[]), Err(BridgeError::NotAvailable(_))));
    }

    #[test]
    fn tabs_open_navigate_and_close_through_the_bridge_and_bad_ids_are_ignored() {
        let (b, engine, _br, _e, _d) = with_browser(None);
        assert_eq!(call(&b, "browser", "open", json!(["example.com"])), json!("tab-1"));
        assert_eq!(call(&b, "browser", "open", json!(["what is rust"])), json!(null));
        assert_eq!(call(&b, "browser", "open", json!([null])), json!("tab-2"));
        assert_eq!(call(&b, "browser", "navigate", json!(["tab-1", "other.example"])), json!("navigated"));
        assert_eq!(call(&b, "browser", "navigate", json!(["tab-1", "what is it"])), json!("ask"));
        assert_eq!(call(&b, "browser", "navigate", json!(["../x", "other.example"])), json!("blocked"));
        assert_eq!(call(&b, "browser", "navigate", json!(["tab-1"])), json!("blocked"));
        for bad in [json!(["TAB-1"]), json!(["tab-"]), json!(["tab-1; drop"]), json!([5]), json!([])] {
            call(&b, "browser", "close", bad.clone());
            call(&b, "browser", "activate", bad);
        }
        assert_eq!(call(&b, "browser", "getState", json!([]))["tabs"].as_array().unwrap().len(), 2);
        call(&b, "browser", "activate", json!(["tab-1"]));
        call(&b, "browser", "close", json!(["tab-2"]));
        assert!(engine.calls().contains(&"close tab-2".to_owned()));
        assert!(matches!(b.call("browser", "teleport", &[]), Err(BridgeError::NotAvailable(_))));
    }

    #[test]
    fn pinning_duplicating_moving_and_reopening_go_through_the_bridge_with_checked_arguments() {
        let (b, _engine, br, _e, _d) = with_browser(None);
        br.open(Some("https://a.example/"));
        br.navigated("tab-1", "https://a.example/", false, false);
        br.open(None);
        call(&b, "browser", "pin", json!(["tab-2", true]));
        call(&b, "browser", "pin", json!(["tab-1", "yes"]));
        call(&b, "browser", "pin", json!(["../x", true]));
        let state = call(&b, "browser", "getState", json!([]));
        assert_eq!((state["tabs"][0]["id"].clone(), state["tabs"][0]["pinned"].clone(), state["tabs"][1]["pinned"].clone()), (json!("tab-2"), json!(true), json!(false)));
        let copy = call(&b, "browser", "duplicate", json!(["tab-1"]));
        assert!(copy.is_string());
        assert_eq!(call(&b, "browser", "duplicate", json!(["nope"])), json!(null));
        call(&b, "browser", "moveTab", json!(["tab-1", 0]));
        call(&b, "browser", "moveTab", json!(["tab-1", -3]));
        call(&b, "browser", "moveTab", json!(["tab-1", 99999999]));
        call(&b, "browser", "close", json!(["tab-1"]));
        assert!(call(&b, "browser", "reopenClosed", json!([])).is_string());
        assert_eq!(call(&b, "browser", "reopenClosed", json!([])), json!(null), "nothing more to reopen");
    }

    #[test]
    fn the_page_area_is_checked_before_it_is_used() {
        let (b, engine, br, _e, _d) = with_browser(None);
        br.open(None);
        call(&b, "surface", "setBounds", json!([{ "x": 10.4, "y": 20.6, "width": 300, "height": 200 }]));
        call(&b, "surface", "setBounds", json!([null]));
        call(&b, "surface", "setBounds", json!([{ "x": 0, "y": 0, "width": -1, "height": 5 }]));
        call(&b, "surface", "setBounds", json!([{ "x": 0, "y": 0, "width": 30000, "height": 5 }]));
        call(&b, "surface", "setBounds", json!([{ "x": "0", "y": 0, "width": 5, "height": 5 }]));
        let layouts = engine.layouts.lock().unwrap().clone();
        let shown: Vec<_> = layouts.iter().filter_map(|(_, b)| *b).collect();
        assert_eq!(shown, vec![mobius_browser::engine::Bounds { x: 10, y: 21, width: 300, height: 200 }], "only the first, tidied; the rest hide the page");
    }

    #[test]
    fn the_find_request_is_checked() {
        let (b, engine, br, _e, _d) = with_browser(None);
        br.open(None);
        call(&b, "browser", "find", json!([{ "tabId": "tab-1", "text": "apple", "forward": false, "again": true }]));
        for bad in [json!([{ "tabId": "tab-1", "text": "" }]), json!([{ "tabId": "x", "text": "a" }]), json!([{ "tabId": "tab-1", "text": "a".repeat(201) }]), json!(["tab-1"])] {
            call(&b, "browser", "find", bad);
        }
        assert_eq!(engine.calls().iter().filter(|c| c.starts_with("find")).collect::<Vec<_>>(), vec!["find tab-1 apple false true"]);
    }

    #[test]
    fn the_bookmark_button_saves_the_open_page_as_the_browser_knows_it() {
        let (b, _engine, br, events, _d) = with_browser(None);
        assert_eq!(call(&b, "bookmarks", "toggle", json!([])), json!(false), "no tab");
        br.open(None);
        assert_eq!(call(&b, "bookmarks", "toggle", json!([])), json!(false), "the start page is not a web page");
        br.navigated("tab-1", "https://a.example/x", false, false);
        br.titled("tab-1", "A page");
        assert_eq!(call(&b, "bookmarks", "toggle", json!([])), json!(true));
        assert_eq!(call(&b, "bookmarks", "get", json!([""]))[0]["title"], "A page");
        assert_eq!(call(&b, "bookmarks", "toggle", json!([])), json!(false));
        assert!(events.lock().unwrap().iter().any(|(n, _)| n == "mobius:bookmarks-changed"));
    }

    #[test]
    fn the_open_page_can_be_attached_as_text_and_only_when_there_is_one() {
        let (b, engine, br, _e, _d) = with_browser(None);
        assert_eq!(call(&b, "context", "page", json!([]))["error"], "There is no web page open to attach.");
        br.open(None);
        assert_eq!(call(&b, "context", "page", json!([]))["ok"], false, "the start page");
        br.navigated("tab-1", "https://a.example/x", false, false);
        engine.answer("innerText", Ok(json!({ "text": "  ", "title": "T", "url": "https://a.example/x" })));
        assert_eq!(call(&b, "context", "page", json!([]))["error"], "That page has no text Mobius could read.");
        engine.answer("innerText", Ok(json!({ "text": "The article", "title": "", "url": "https://a.example/x" })));
        br.titled("tab-1", "Tab title");
        let r = call(&b, "context", "page", json!([]));
        assert_eq!(r["item"], json!({ "kind": "page", "title": "Tab title", "source": "https://a.example/x", "text": "The article" }));
        engine.answer("innerText", Ok(json!({ "text": "x".repeat(30_000), "title": "T", "url": "https://a.example/x" })));
        assert!(call(&b, "context", "page", json!([]))["item"]["text"].as_str().unwrap().ends_with("… [cut]"));
        engine.answer("innerText", Err("gone".into()));
        assert_eq!(call(&b, "context", "page", json!([]))["ok"], false);
    }

    #[test]
    fn a_file_comes_from_the_picker_and_cancelling_attaches_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("notes.txt");
        std::fs::write(&file, "hello").unwrap();
        let (b, ..) = with_browser(Some(file));
        assert_eq!(call(&b, "context", "file", json!([]))["item"]["title"], "notes.txt");
        let (b, ..) = with_browser(None);
        assert_eq!(call(&b, "context", "file", json!([])), json!({ "ok": true, "item": null }));
    }

    #[test]
    fn the_core_can_run_only_the_browser_tools_and_only_with_a_window() {
        let (plain, _c, _e, _d) = bridge_in(tempfile::tempdir().unwrap());
        assert_eq!(plain.host_request("host.tool", &json!({ "tool": "browser.tabs", "arguments": {} })).unwrap_err(), "no window is open");
        let (b, engine, br, _e, _d) = with_browser(None);
        br.open(None);
        br.navigated("tab-1", "https://a.example/", false, false);
        let tabs = b.host_request("host.tool", &json!({ "call_id": "k", "tool": "browser.tabs", "arguments": {} })).unwrap();
        assert!(tabs.as_str().unwrap().contains("https://a.example/"));
        for bad in [json!({ "tool": "process.exec", "arguments": {} }), json!({ "tool": 5 }), json!({}), json!(null)] {
            assert_eq!(b.host_request("host.tool", &bad).unwrap_err(), "unknown tool", "{bad}");
        }
        assert_eq!(b.host_request("tools.list", &json!({})).unwrap_err(), "method not found");
        // Private addresses are refused until the person allows them.
        assert!(b.host_request("host.tool", &json!({ "tool": "browser.open", "arguments": { "url": "http://localhost:3000/" } })).unwrap_err().contains("local network"));
        assert!(!engine.calls().iter().any(|c| c.contains("localhost")));
        call(&b, "preferences", "set", json!([{ "agentPrivateUrls": true }]));
        b.host_request("host.tool", &json!({ "tool": "browser.read", "arguments": {} })).ok();
    }

    #[test]
    fn a_tab_says_who_is_using_it_and_changes_hands_on_take_over_and_hand_back() {
        let (b, engine, br, _e, _d) = with_browser(None);
        engine.answer("innerText", Ok(json!({ "text": "A page", "title": "A", "url": "https://a.example/" })));
        let driver = |tab: &str| br.state()["tabs"].as_array().unwrap().iter().find(|t| t["id"] == tab).map(|t| t["driver"].clone()).unwrap();
        let first = call(&b, "browser", "open", json!(["example.com"]));
        let first = first.as_str().unwrap();
        br.navigated(first, "https://a.example/", false, false);
        br.finished(first);
        assert_eq!(driver(first), json!(null), "a tab is the person's until a task uses it");
        b.host_request("host.tool", &json!({ "tool": "browser.read", "arguments": {}, "conversation": "c1" })).unwrap();
        assert_eq!(driver(first), json!("reading"));
        // The page Mobius opens loads a moment later.
        let loader = br.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(300));
            loader.navigated("tab-2", "https://b.example/", false, false);
            loader.finished("tab-2");
        });
        let opened = b.host_request("host.tool", &json!({ "tool": "browser.open", "arguments": { "url": "https://b.example/" }, "conversation": "c1" })).unwrap();
        let second: serde_json::Value = serde_json::from_str(opened.as_str().unwrap()).unwrap();
        let second = second["tabId"].as_str().unwrap().to_owned();
        assert_eq!(driver(&second), json!("mobius"));
        // Reading a tab Mobius drives leaves it driven.
        b.host_request("host.tool", &json!({ "tool": "browser.read", "arguments": { "tabId": second }, "conversation": "c1" })).unwrap();
        assert_eq!(driver(&second), json!("mobius"));
        assert_eq!(call(&b, "agent", "takeOver", json!(["c1"]))["ok"], json!(true));
        assert_eq!(driver(&second), json!("yours"), "the tab Mobius drove is yours now");
        assert_eq!(driver(first), json!("reading"), "a tab it only read stays as it was");
        assert_eq!(call(&b, "agent", "handBack", json!(["c1"]))["ok"], json!(true));
        assert_eq!(driver(&second), json!("mobius"));
        // Another task's end changes nothing here; this task's end makes both plain tabs again.
        b.on_core_notification("agent.event", &json!({ "conversation": "c2", "turn": 2, "event": { "kind": "done" } }));
        assert_eq!(driver(&second), json!("mobius"));
        b.on_core_notification("agent.event", &json!({ "conversation": "c1", "turn": 1, "event": { "kind": "done" } }));
        assert_eq!((driver(first), driver(&second)), (json!(null), json!(null)));
    }

    #[test]
    fn file_tools_work_in_the_workspace_folder_without_a_window() {
        let (b, _c, _e, dir) = bridge_in(tempfile::tempdir().unwrap());
        let run = |tool: &str, arguments: serde_json::Value| b.host_request("host.tool", &json!({ "tool": tool, "arguments": arguments }));
        run("files.write", json!({ "path": "notes/a.md", "content": "hi" })).unwrap();
        assert!(run("files.read", json!({ "path": "notes/a.md" })).unwrap().as_str().unwrap().contains("\"hi\""));
        // It really is a file in the workspace folder, and nothing can reach outside it.
        assert_eq!(std::fs::read_to_string(dir.path().join("workspace/notes/a.md")).unwrap(), "hi");
        assert!(run("files.read", json!({ "path": "../agent-settings.json" })).is_err());
        assert!(run("files.read", json!({ "path": "..\\bookmarks.json" })).is_err());
    }

    fn registered_names(core: &Arc<CoreProcess>) -> Vec<String> {
        let log = core.call("test.log", json!({}), Duration::from_secs(5)).unwrap();
        log.as_array().unwrap().iter().filter(|c| c["method"] == "tools.register_external").map(|c| c["params"]["name"].as_str().unwrap().to_owned()).collect()
    }

    fn dir_with_mcp(servers: serde_json::Value) -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("mcp.json"), json!({ "servers": servers }).to_string()).unwrap();
        dir
    }

    #[test]
    fn tools_of_configured_mcp_servers_are_registered_with_the_core_and_can_be_run() {
        let dir = dir_with_mcp(json!({ "fake": { "command": fake_bin("mobius-mcp", "fake-mcp-server") }, "broken": { "command": "definitely-not-a-program-xyz" } }));
        let (b, core, _e, _d) = bridge_in(dir);
        b.on_core_status(Status::Ready);
        let start = Instant::now();
        while !registered_names(&core).contains(&"mcp.fake.echo".to_owned()) {
            assert!(start.elapsed() < Duration::from_secs(20), "the server's tools were never registered");
            std::thread::sleep(Duration::from_millis(50));
        }
        let names = registered_names(&core);
        assert!(names.contains(&"browser.tabs".to_owned()) && names.contains(&"files.write".to_owned()));
        let said = b.host_request("host.tool", &json!({ "tool": "mcp.fake.echo", "arguments": { "text": "hello" } })).unwrap();
        assert!(said.as_str().unwrap().starts_with("hello"));
        assert_eq!(b.host_request("host.tool", &json!({ "tool": "mcp.fake.fail_tool_", "arguments": {} })).unwrap_err(), "it broke");
        assert_eq!(b.host_request("host.tool", &json!({ "tool": "mcp.fake.nothing", "arguments": {} })).unwrap_err(), "unknown tool");
        assert_eq!(b.host_request("host.tool", &json!({ "tool": "mcp.broken.x", "arguments": {} })).unwrap_err(), "unknown tool");
        // The person can see which server did not start, and why.
        let status = b.mcp_status();
        assert_eq!(status["running"], json!(["fake"]));
        assert_eq!(status["failed"][0]["server"], "broken");
        assert!(status["failed"][0]["error"].as_str().unwrap().contains("could not start"));
    }

    #[test]
    fn a_connector_is_added_to_mcp_json_and_removed_from_it_keeping_the_rest_of_the_file() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("mcp.json"), json!({ "note": "mine", "servers": { "notes": { "command": "notes-server" } } }).to_string()).unwrap();
        let file = dir.path().join("mcp.json");
        let (b, _core, _e, _d) = bridge_in(dir);
        let added = b.call("extensions", "addConnector", &[json!({ "name": "github", "command": "npx", "args": ["-y", "server-github"], "env": { "GITHUB_TOKEN": "t" } })]).unwrap();
        assert_eq!(added["ok"], json!(true), "{added}");
        let saved: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap();
        assert_eq!(saved["note"], "mine");
        assert_eq!(saved["servers"]["github"], json!({ "command": "npx", "args": ["-y", "server-github"], "env": { "GITHUB_TOKEN": "t" } }));
        assert_eq!(saved["servers"]["notes"]["command"], "notes-server");
        // Nothing has started yet: both wait for Mobius to open again.
        let waiting = b.mcp_status()["waiting"].clone();
        assert!(waiting.as_array().unwrap().contains(&json!("github")), "{waiting}");
        // A bad name, a missing command or a name already taken changes nothing.
        for bad in [json!({ "name": "Git Hub", "command": "x" }), json!({ "name": "gh", "command": " " }), json!({ "name": "github", "command": "y" })] {
            assert_eq!(b.call("extensions", "addConnector", &[bad]).unwrap()["ok"], json!(false));
        }
        assert_eq!(b.call("extensions", "removeConnector", &[json!("github")]).unwrap()["ok"], json!(true));
        let saved: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap();
        assert!(saved["servers"].get("github").is_none());
        assert_eq!(saved["note"], "mine");
        assert_eq!(b.call("extensions", "removeConnector", &[json!("github")]).unwrap()["ok"], json!(false));
    }

    #[test]
    fn a_connector_is_not_written_into_an_mcp_file_that_is_not_json() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("mcp.json"), "{ nope").unwrap();
        let file = dir.path().join("mcp.json");
        let (b, _core, _e, _d) = bridge_in(dir);
        let added = b.call("extensions", "addConnector", &[json!({ "name": "github", "command": "npx" })]).unwrap();
        assert_eq!(added["ok"], json!(false));
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "{ nope");
    }

    #[test]
    fn a_bad_mcp_file_changes_nothing_and_is_reported() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("mcp.json"), "{ nope").unwrap();
        let (b, core, _e, _d) = bridge_in(dir);
        b.on_core_status(Status::Ready);
        assert_eq!(registered_names(&core).len(), 45, "the built-in tools are still registered");
        let start = Instant::now();
        while b.mcp_status()["problem"].is_null() {
            assert!(start.elapsed() < Duration::from_secs(10));
            std::thread::sleep(Duration::from_millis(50));
        }
        assert!(b.mcp_status()["problem"].as_str().unwrap().contains("not valid JSON"));
        assert!(b.host_request("host.tool", &json!({ "tool": "mcp.fake.echo", "arguments": {} })).is_err());
    }

    #[test]
    fn schedules_are_added_checked_changed_and_removed_through_the_bridge() {
        let (b, _core, _e, _d) = bridge_in(tempfile::tempdir().unwrap());
        let made = b.call("schedules", "add", &[json!({ "title": "Brief", "prompt": "Brief me on my tasks", "time": "08:00", "days": [1, 2, 3, 4, 5] })]).unwrap();
        assert_eq!(made["ok"], json!(true));
        let id = made["schedule"]["id"].as_str().unwrap().to_owned();
        assert_eq!(b.call("schedules", "list", &[]).unwrap()[0]["title"], "Brief");
        assert_eq!(b.call("schedules", "add", &[json!({ "title": "x", "prompt": "y", "time": "8", "days": [1] })]).unwrap()["ok"], json!(false));
        let changed = b.call("schedules", "update", &[json!(id), json!({ "title": "Brief", "prompt": "Brief me", "time": "09:30", "days": [6, 7], "enabled": false })]).unwrap();
        assert_eq!((changed["schedule"]["time"].clone(), changed["schedule"]["enabled"].clone()), (json!("09:30"), json!(false)));
        b.call("schedules", "remove", &[json!(id)]).unwrap();
        assert_eq!(b.call("schedules", "list", &[]).unwrap(), json!([]));
        // The agent can make one too, through its tool.
        let said = b.host_request("host.tool", &json!({ "tool": "schedules.add", "arguments": { "title": "Brief", "prompt": "Brief me", "time": "07:30", "days": [1, 3] } })).unwrap();
        assert!(said.as_str().unwrap().starts_with("Scheduled \"Brief\""));
        assert!(b.host_request("host.tool", &json!({ "tool": "schedules.list", "arguments": {} })).unwrap().as_str().unwrap().contains("07:30"));
    }

    #[test]
    fn what_mobius_remembers_is_added_to_every_turn_and_can_be_forgotten() {
        let dir = tempfile::tempdir().unwrap();
        let (b, _core, _e, _d) = bridge_in(dir);
        assert_eq!(b.host_request("host.tool", &json!({ "tool": "memory.remember", "arguments": { "text": "Prefers boutique hotels" } })).unwrap(), json!("Remembered."));
        assert_eq!(b.call("memory", "list", &[]).unwrap(), json!(["Prefers boutique hotels"]));
        assert_eq!(b.call("memory", "forget", &[json!("Prefers boutique hotels")]).unwrap(), json!({ "ok": true }));
        assert_eq!(b.call("memory", "list", &[]).unwrap(), json!([]));
        assert_eq!(b.call("memory", "forget", &[json!("Prefers boutique hotels")]).unwrap()["ok"], json!(false));
    }

    #[test]
    fn becoming_ready_registers_the_browser_tools_with_the_core() {
        let (b, core, _e, _d) = bridge_in(tempfile::tempdir().unwrap());
        b.on_core_status(Status::Ready);
        let log = core.call("test.log", json!({}), Duration::from_secs(5)).unwrap();
        let names: Vec<_> = log.as_array().unwrap().iter().filter(|c| c["method"] == "tools.register_external").map(|c| c["params"]["name"].as_str().unwrap().to_owned()).collect();
        assert_eq!(names, vec!["browser.tabs", "browser.open", "browser.read", "browser.click", "browser.type", "files.list", "files.read", "files.search", "files.write", "files.edit", "tasks.list", "tasks.add", "tasks.update", "calendar.list", "calendar.add", "calendar.suggest", "calendar.update", "sheets.list", "sheets.read", "sheets.write", "mail.search", "mail.read", "mail.draft", "memory.remember", "memory.forget", "schedules.list", "schedules.add", "code.test", "code.run", "code.commit", "code.push", "skills.list", "skills.read", "web.search", "web.read", "code.start", "code.output", "code.stop", "db.list", "db.query", "db.execute", "comments.list", "comments.reply", "comments.resolve", "images.generate"]);
    }

    #[derive(Default)]
    struct Recorder(std::sync::Mutex<Vec<String>>);
    struct Shared(Arc<Recorder>);
    impl Dialogs for Shared {
        fn pick_text_file(&self) -> Option<PathBuf> {
            None
        }
        fn open_path(&self, p: &std::path::Path) {
            self.0.0.lock().unwrap().push(format!("open {}", p.file_name().unwrap().to_string_lossy()));
        }
        fn show_path(&self, p: &std::path::Path) {
            self.0.0.lock().unwrap().push(format!("show {}", p.file_name().unwrap().to_string_lossy()));
        }
        fn cancel_download(&self, p: &std::path::Path) {
            self.0.0.lock().unwrap().push(format!("cancel {}", p.file_name().unwrap().to_string_lossy()));
        }
        fn window_focused(&self) -> bool {
            false
        }
        fn show_notice(&self, _: &mobius_host::notify::Notice) {}
        fn awake_blocker(&self) -> Box<dyn mobius_host::awake::Blocker> {
            Box::new(NoBlock)
        }
        fn shortcut_registrar(&self) -> Box<dyn mobius_host::quick_entry::Registrar> {
            Box::new(NoKeys)
        }
        fn bring_forward(&self) {}
    }

    #[test]
    fn downloads_are_saved_listed_shown_and_programs_are_never_opened() {
        let folder = tempfile::tempdir().unwrap();
        let (b, _core, _events, _dir) = bridge_in(tempfile::tempdir().unwrap());
        let rec = Arc::new(Recorder::default());
        b.attach(Arc::new(Browser::new(Arc::new(FakeEngine::default()), Arc::new(|_, _| {}), Box::new(|_, _| {}))), Arc::new(Shared(rec.clone())));
        b.set_downloads_dir(folder.path().to_path_buf());
        let path = b.download_requested("../../evil.txt").unwrap();
        assert_eq!(path, folder.path().join("evil.txt"));
        assert_eq!(call(&b, "downloads", "get", json!([]))[0]["state"], "downloading");
        std::fs::write(&path, "hello").unwrap();
        b.download_finished(&path, true);
        assert_eq!(call(&b, "downloads", "get", json!([]))[0]["state"], "done");
        call(&b, "downloads", "open", json!(["dl-1"]));
        call(&b, "downloads", "show", json!(["dl-1"]));
        call(&b, "downloads", "open", json!(["../x"]));
        let setup = b.download_requested("setup.exe").unwrap();
        std::fs::write(&setup, "MZ").unwrap();
        b.download_finished(&setup, true);
        call(&b, "downloads", "open", json!(["dl-2"]));
        assert_eq!(rec.0.lock().unwrap().clone(), vec!["open evil.txt", "show evil.txt"], "a program is not opened");
        call(&b, "downloads", "clear", json!([]));
        assert_eq!(call(&b, "downloads", "get", json!([])), json!([]));
        let slow = b.download_requested("slow.bin").unwrap();
        b.download_progress(&slow, 500_000, 1_000_000);
        assert_eq!(call(&b, "downloads", "get", json!([]))[0]["received"], 500_000);
        call(&b, "downloads", "cancel", json!(["dl-3"]));
        call(&b, "downloads", "cancel", json!(["dl-3"]));
        call(&b, "downloads", "cancel", json!(["../x"]));
        b.download_finished(&slow, false);
        assert_eq!(call(&b, "downloads", "get", json!([]))[0]["state"], "cancelled");
        assert_eq!(rec.0.lock().unwrap().iter().filter(|l| l.starts_with("cancel")).collect::<Vec<_>>(), vec!["cancel slow.bin"], "only once, only for a real running download");
    }

    #[test]
    fn a_shortcut_pressed_inside_a_page_goes_to_the_window_and_not_the_page() {
        let (b, _core, events, _dir) = bridge_in(tempfile::tempdir().unwrap());
        assert!(b.page_key(0x4B, true, false, false), "ctrl+k");
        assert!(!b.page_key(0x4B, false, false, false), "k alone is typing");
        assert!(!b.page_key(0x4A, true, false, false), "ctrl+j is not bound");
        assert!(!b.page_key(0x11, true, false, false), "a modifier alone");
        assert_eq!(events.lock().unwrap().clone(), vec![("mobius:shortcut".to_owned(), json!("launcher"))]);
        call(&b, "preferences", "set", json!([{ "keybindings": { "launcher": "alt+j", "address": "mod+l", "newTab": "mod+t", "closeTab": "mod+w", "settings": "mod+,", "find": "mod+f", "quickEntry": "", "splitView": "mod+\\", "littleMobius": "mod+shift+m" } }]));
        assert!(b.page_key(0x4A, false, true, false), "the new binding works");
        assert!(!b.page_key(0x4B, true, false, false), "the old one no longer does");
    }

    #[test]
    fn the_test_hooks_are_refused_until_turned_on_and_then_reach_the_core() {
        let (b, _core, _e, _d) = bridge_in(tempfile::tempdir().unwrap());
        for m in ["coreCall", "corePid", "coreHistory", "crashCore"] {
            assert!(matches!(b.call("test", m, &[json!("core.ping")]), Err(BridgeError::NotAvailable(_))), "{m}");
        }
        b.enable_test_hooks();
        assert!(call(&b, "test", "coreCall", json!(["core.ping"]))["protocol"].is_number());
        assert!(call(&b, "test", "corePid", json!([])).is_number());
        b.on_core_status(Status::Ready);
        assert_eq!(call(&b, "test", "coreHistory", json!([])), json!(["ready"]));
        let quits = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let counter = quits.clone();
        b.set_quit(Arc::new(move || {
            counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        }));
        call(&b, "test", "quit", json!([]));
        assert_eq!(quits.load(std::sync::atomic::Ordering::SeqCst), 1);
        assert!(b.call("test", "coreCall", &[json!(5)]).is_err());
        assert!(matches!(b.call("test", "nothing", &[]), Err(BridgeError::NotAvailable(_))));
    }

    /// A platform that records what it was asked to do.
    #[derive(Default)]
    struct Spy {
        focused: std::sync::atomic::AtomicBool,
        shown: std::sync::Mutex<Vec<String>>,
        opened: std::sync::Mutex<Vec<PathBuf>>,
        held: Arc<std::sync::atomic::AtomicBool>,
        keys: Arc<std::sync::Mutex<Vec<String>>>,
        forwarded: std::sync::atomic::AtomicUsize,
    }
    struct SpyKeys(Arc<std::sync::Mutex<Vec<String>>>);
    impl mobius_host::quick_entry::Registrar for SpyKeys {
        fn register(&mut self, accelerator: &str, _: Arc<dyn Fn() + Send + Sync>) -> bool {
            let mut taken = self.0.lock().unwrap();
            if taken.iter().any(|a| a == accelerator) {
                return false;
            }
            taken.push(accelerator.to_owned());
            true
        }
        fn unregister(&mut self, accelerator: &str) {
            self.0.lock().unwrap().retain(|a| a != accelerator);
        }
    }
    struct Held(Arc<std::sync::atomic::AtomicBool>);
    impl mobius_host::awake::Blocker for Held {
        fn start(&mut self) {
            self.0.store(true, std::sync::atomic::Ordering::SeqCst);
        }
        fn stop(&mut self) {
            self.0.store(false, std::sync::atomic::Ordering::SeqCst);
        }
    }
    struct SpyHandle(Arc<Spy>);
    impl Dialogs for SpyHandle {
        fn pick_text_file(&self) -> Option<PathBuf> {
            None
        }
        fn open_path(&self, p: &std::path::Path) {
            self.0.opened.lock().unwrap().push(p.to_path_buf());
        }
        fn show_path(&self, _: &std::path::Path) {}
        fn cancel_download(&self, _: &std::path::Path) {}
        fn window_focused(&self) -> bool {
            self.0.focused.load(std::sync::atomic::Ordering::SeqCst)
        }
        fn show_notice(&self, notice: &mobius_host::notify::Notice) {
            self.0.shown.lock().unwrap().push(notice.title.clone());
        }
        fn awake_blocker(&self) -> Box<dyn mobius_host::awake::Blocker> {
            Box::new(Held(self.0.held.clone()))
        }
        fn shortcut_registrar(&self) -> Box<dyn mobius_host::quick_entry::Registrar> {
            Box::new(SpyKeys(self.0.keys.clone()))
        }
        fn bring_forward(&self) {
            self.0.forwarded.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        }
    }

    fn with_spy() -> (Bridge, Arc<Spy>, tempfile::TempDir) {
        let (b, core, _events, dir) = bridge_in(tempfile::tempdir().unwrap());
        std::mem::forget(core);
        let spy = Arc::new(Spy::default());
        b.attach(Arc::new(Browser::new(Arc::new(FakeEngine::default()), Arc::new(|_, _| {}), Box::new(|_, _| {}))), Arc::new(SpyHandle(spy.clone())));
        (b, spy, dir)
    }

    fn agent_event(kind: &str, extra: serde_json::Value) -> serde_json::Value {
        let mut e = json!({ "kind": kind });
        e.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
        json!({ "conversation": "c-main-abc", "turn": 1, "event": e })
    }

    #[test]
    fn a_notice_is_shown_only_when_no_window_has_the_focus_and_says_nothing_of_the_request() {
        let (b, spy, _d) = with_spy();
        b.on_core_notification("agent.event", &agent_event("needs_approval", json!({ "request_id": 1, "call_id": "k", "tool": "browser.tabs", "arguments": {"q": "private words"} })));
        b.on_core_notification("agent.event", &agent_event("done", json!({})));
        assert_eq!(spy.shown.lock().unwrap().clone(), vec!["Mobius needs you", "Mobius finished"]);
        spy.focused.store(true, std::sync::atomic::Ordering::SeqCst);
        b.on_core_notification("agent.event", &agent_event("done", json!({})));
        assert_eq!(spy.shown.lock().unwrap().len(), 2, "focused");
        spy.focused.store(false, std::sync::atomic::Ordering::SeqCst);
        b.on_core_notification("agent.event", &json!({ "conversation": "not valid", "turn": 1, "event": {"kind": "done"} }));
        assert_eq!(spy.shown.lock().unwrap().len(), 2, "a malformed notification is ignored");
    }

    #[test]
    fn while_testing_notices_are_recorded_and_not_shown() {
        let (b, spy, _d) = with_spy();
        b.enable_test_hooks();
        b.on_core_notification("agent.event", &agent_event("done", json!({})));
        assert!(spy.shown.lock().unwrap().is_empty());
        assert_eq!(call(&b, "test", "notices", json!([]))[0]["title"], "Mobius finished");
    }

    #[test]
    fn a_finished_download_is_announced_once() {
        let (b, spy, dir) = with_spy();
        b.set_downloads_dir(dir.path().join("dl"));
        let path = b.download_requested("file.txt").unwrap();
        std::fs::write(&path, "x").unwrap();
        assert!(spy.shown.lock().unwrap().is_empty());
        b.download_finished(&path, true);
        b.download_progress(&path, 1, 1);
        call(&b, "downloads", "clear", json!([]));
        assert_eq!(spy.shown.lock().unwrap().clone(), vec!["Download finished"]);
    }

    #[test]
    fn the_computer_is_kept_awake_by_the_setting_and_the_work() {
        let (b, spy, _d) = with_spy();
        b.enable_test_hooks();
        let held = || spy.held.load(std::sync::atomic::Ordering::SeqCst);
        b.on_core_notification("agent.delta", &json!({ "conversation": "c-main-abc", "turn": 1, "text": "x" }));
        assert!(!held(), "off by default");
        call(&b, "preferences", "set", json!([{ "keepAwake": true }]));
        assert!(held());
        assert_eq!(call(&b, "test", "awake", json!([])), json!(true));
        b.on_core_notification("agent.event", &agent_event("needs_approval", json!({ "request_id": 1, "call_id": "k", "tool": "t", "arguments": {} })));
        assert!(!held(), "waiting for a person is not work");
        b.on_core_notification("agent.delta", &json!({ "conversation": "c-main-abc", "turn": 1, "text": "y" }));
        call(&b, "preferences", "set", json!([{ "keepAwake": false }]));
        assert!(!held());
    }

    #[test]
    fn a_test_can_ask_the_shell_about_the_window_and_the_zoom_and_views_report_where_pages_really_are() {
        let (b, _core, _e, _d) = bridge_in(tempfile::tempdir().unwrap());
        b.enable_test_hooks();
        assert_eq!(call(&b, "test", "probe", json!(["theme"])), json!(null), "no shell, no answer");
        b.set_probe(Arc::new(|name, arg| json!({ "name": name, "arg": arg })));
        assert_eq!(call(&b, "test", "probe", json!(["size", { "w": 1 }])), json!({ "name": "size", "arg": { "w": 1 } }));
        assert_eq!(call(&b, "test", "probe", json!(["zoom"])), json!(1.0));
        call(&b, "appearance", "set", json!([{ "zoom": 1.25 }]));
        assert_eq!(call(&b, "test", "probe", json!(["zoom"])), json!(1.25));
        let engine = Arc::new(FakeEngine::default());
        let browser = Arc::new(Browser::new(engine, Arc::new(|_, _| {}), Box::new(|_, _| {})));
        b.attach(browser.clone(), Arc::new(Picker(None)));
        browser.open(None);
        call(&b, "surface", "setBounds", json!([{ "x": 8, "y": 40, "width": 800, "height": 400 }]));
        assert_eq!(call(&b, "test", "views", json!([]))[0]["bounds"], json!({ "x": 10.0, "y": 50.0, "width": 1000.0, "height": 500.0 }));
    }

    #[test]
    fn quick_entry_is_off_until_chosen_then_registered_and_pressing_it_brings_the_window_and_tells_it() {
        let (b, spy, _d) = with_spy();
        b.enable_test_hooks();
        assert_eq!(call(&b, "window", "quickEntryActive", json!([])), json!(false));
        let mut keys = defaults_keys();
        keys["quickEntry"] = json!("mod+alt+space");
        call(&b, "preferences", "set", json!([{ "keybindings": keys }]));
        assert_eq!(call(&b, "window", "quickEntryActive", json!([])), json!(true));
        assert_eq!(spy.keys.lock().unwrap().clone(), vec!["CommandOrControl+Alt+Space"]);
        call(&b, "test", "quickPress", json!([]));
        assert_eq!(spy.forwarded.load(std::sync::atomic::Ordering::SeqCst), 1);
        call(&b, "preferences", "set", json!([{ "keybindings": defaults_keys() }]));
        assert_eq!(call(&b, "window", "quickEntryActive", json!([])), json!(false));
        assert!(spy.keys.lock().unwrap().is_empty());
    }

    #[test]
    fn a_combination_another_program_has_leaves_quick_entry_inactive() {
        let (b, _spy, _d) = with_spy();
        b.enable_test_hooks();
        assert_eq!(call(&b, "test", "takeShortcut", json!(["CommandOrControl+Alt+J"])), json!(true));
        let mut keys = defaults_keys();
        keys["quickEntry"] = json!("mod+alt+j");
        call(&b, "preferences", "set", json!([{ "keybindings": keys }]));
        assert_eq!(call(&b, "window", "quickEntryActive", json!([])), json!(false));
        assert_eq!(call(&b, "preferences", "get", json!([]))["keybindings"]["quickEntry"], "mod+alt+j", "still wanted");
    }

    fn defaults_keys() -> serde_json::Value {
        json!({ "launcher": "mod+k", "address": "mod+l", "newTab": "mod+t", "closeTab": "mod+w", "settings": "mod+,", "find": "mod+f", "quickEntry": "", "splitView": "mod+\\", "littleMobius": "mod+shift+m" })
    }

    #[test]
    fn coming_to_the_window_soon_after_a_notice_opens_that_conversation_once() {
        let (b, core, events, _d) = bridge_in(tempfile::tempdir().unwrap());
        std::mem::forget(core);
        b.attach(Arc::new(Browser::new(Arc::new(FakeEngine::default()), Arc::new(|_, _| {}), Box::new(|_, _| {}))), Arc::new(SpyHandle(Arc::new(Spy::default()))));
        let opened = || events.lock().unwrap().iter().filter(|(n, _)| n == "mobius:open-conversation").map(|(_, v)| v.clone()).collect::<Vec<_>>();
        b.window_activated(Duration::from_secs(60));
        assert!(opened().is_empty(), "no notice, nothing to open");
        b.on_core_notification("agent.event", &agent_event("done", json!({})));
        b.window_activated(Duration::from_secs(60));
        b.window_activated(Duration::from_secs(60));
        assert_eq!(opened(), vec![json!("c-main-abc")], "once");
        b.on_core_notification("agent.event", &agent_event("done", json!({})));
        std::thread::sleep(Duration::from_millis(30));
        b.window_activated(Duration::from_millis(5));
        assert_eq!(opened().len(), 1, "too long ago");
    }

    #[test]
    fn open_data_folder_opens_the_folder_the_data_lives_in() {
        let (b, spy, dir) = with_spy();
        call(&b, "app", "openDataFolder", json!([]));
        assert_eq!(spy.opened.lock().unwrap().clone(), vec![dir.path().to_path_buf()]);
    }

    #[test]
    fn conversations_can_be_put_away_and_brought_back_with_checked_ids() {
        let (b, _core, _e, _d) = bridge_in(tempfile::tempdir().unwrap());
        assert_eq!(call(&b, "agent", "archived", json!([])), json!([]));
        assert_eq!(call(&b, "agent", "archive", json!(["c-main-abc", true])), json!(["c-main-abc"]));
        assert_eq!(call(&b, "agent", "archive", json!(["c-main-abc", true])), json!(["c-main-abc"]));
        for bad in [json!(["../x", true]), json!(["c-main-abc", "yes"]), json!([5, true]), json!([])] {
            assert_eq!(call(&b, "agent", "archive", bad)["ok"], false);
        }
        assert_eq!(call(&b, "agent", "archived", json!([])), json!(["c-main-abc"]));
        assert_eq!(call(&b, "agent", "archive", json!(["c-main-abc", false])), json!([]));
    }

    #[test]
    fn deleting_a_conversation_also_forgets_that_it_was_put_away() {
        let (b, _core, _e, _d) = bridge_in(tempfile::tempdir().unwrap());
        call(&b, "agent", "archive", json!(["c-main-abc", true]));
        call(&b, "agent", "deleteConversation", json!(["c-main-abc"]));
        assert_eq!(call(&b, "agent", "archived", json!([])), json!([]));
    }

    #[test]
    fn removing_all_data_empties_the_data_folder_forgets_the_keys_stops_the_core_and_quits() {
        let outer = tempfile::tempdir().unwrap();
        let data = outer.path().join("mobius-data");
        std::fs::create_dir_all(data.join("models")).unwrap();
        std::fs::write(data.join("preferences.json"), "{}").unwrap();
        std::fs::write(data.join("models").join("m.gguf"), "x").unwrap();
        let outside = outer.path().join("keep.txt");
        std::fs::write(&outside, "mine").unwrap();
        let (_other, core, _events, _dir) = bridge_in(tempfile::tempdir().unwrap());
        let secrets = Arc::new(mobius_host::secrets::MemorySecrets::new(true));
        let bridge = Bridge::new(core.clone(), data.clone(), Arc::new(|_, _| {}), secrets.clone());
        let quits = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let counter = quits.clone();
        bridge.set_quit(Arc::new(move || {
            counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        }));
        use mobius_host::secrets::Secrets;
        secrets.put("model-key", "sk-secret");
        call(&bridge, "agent", "configure", json!([{ "baseUrl": "http://a.example/v1", "model": "m", "apiKey": "sk-secret" }]));
        call(&bridge, "agent", "saveServer", json!(["Kept"]));
        assert!(secrets.get("endpoint-e-1").is_some());
        let r = call(&bridge, "app", "removeData", json!([]));
        assert_eq!(r["ok"], true, "{r}");
        assert_eq!(std::fs::read_dir(&data).unwrap().count(), 0, "the folder is empty");
        assert!(outside.exists(), "nothing outside it is touched");
        assert_eq!(secrets.get("model-key"), None, "the saved key is gone");
        assert_eq!(secrets.get("endpoint-e-1"), None, "so are the keys of saved servers");
        assert_eq!(quits.load(std::sync::atomic::Ordering::SeqCst), 1);
        assert!(core.call("core.ping", json!({}), Duration::from_millis(500)).is_err(), "the core was stopped");
    }

    #[test]
    fn only_a_folder_well_below_the_top_of_a_drive_may_be_emptied() {
        use mobius_host::bridge::is_safe_to_empty;
        for unsafe_dir in ["C:/", "C:/Users", "C:/Users/me", "/", "/home", "/home/me", "relative/path", "C:/a/b/../..", "/home/me/a/../.."] {
            assert!(!is_safe_to_empty(std::path::Path::new(unsafe_dir)), "{unsafe_dir}");
        }
        #[cfg(windows)]
        assert!(is_safe_to_empty(std::path::Path::new("C:/Users/me/AppData/Roaming/mobius")));
        #[cfg(not(windows))]
        assert!(is_safe_to_empty(std::path::Path::new("/home/me/.local/share/mobius")));
    }

    #[test]
    fn saved_servers_can_be_saved_switched_to_and_removed_without_the_key_reaching_the_window() {
        let (b, _core, events, _d) = bridge_in(tempfile::tempdir().unwrap());
        let configure = |url: &str, model: &str, key: &str| call(&b, "agent", "configure", json!([{ "baseUrl": url, "model": model, "apiKey": key }]));
        assert_eq!(configure("https://one.example/v1", "m1", "sk-one")["ok"], true);
        assert_eq!(call(&b, "agent", "saveServer", json!(["One"]))["ok"], true);
        assert_eq!(configure("https://two.example/v1", "m2", "sk-two")["ok"], true);
        assert_eq!(call(&b, "agent", "saveServer", json!(["Two"]))["ok"], true);
        let list = call(&b, "agent", "savedServers", json!([]));
        assert_eq!(list.as_array().unwrap().len(), 2);
        assert!(!list.to_string().contains("sk-"), "keys never reach the window");
        events.lock().unwrap().clear();
        assert_eq!(call(&b, "agent", "useServer", json!(["e-1"]))["ok"], true);
        let settings = call(&b, "agent", "getSettings", json!([]));
        assert_eq!((settings["baseUrl"].clone(), settings["model"].clone(), settings["hasKey"].clone()), (json!("https://one.example/v1"), json!("m1"), json!(true)));
        assert!(events.lock().unwrap().iter().any(|(n, _)| n == "mobius:agent-settings"), "the window is told");
        assert_eq!(call(&b, "agent", "useServer", json!(["e-9"]))["ok"], false);
        assert_eq!(call(&b, "agent", "useServer", json!(["../x"]))["ok"], false);
        assert_eq!(call(&b, "agent", "saveServer", json!([""]))["ok"], false);
        assert_eq!(call(&b, "agent", "saveServer", json!([5]))["ok"], false);
        assert_eq!(call(&b, "agent", "removeServer", json!(["e-2"]))["ok"], true);
        assert_eq!(call(&b, "agent", "savedServers", json!([])).as_array().unwrap().len(), 1);
        assert_eq!(call(&b, "agent", "removeServer", json!(["x"]))["ok"], false);
    }
}

#[test]
fn a_note_keeps_its_versions_and_files_and_never_hands_out_a_file_outside_its_own_folder() {
    let (b, _c, events, dir) = bridge_in(tempfile::tempdir().unwrap());
    call(&b, "notes", "createNotebook", json!(["Work"]));
    let page = call(&b, "notes", "createPage", json!(["Work", "Battery"]));
    call(&b, "notes", "save", json!(["Work/Battery.md", "# Battery\n\nfirst\n", page["modified"]]));
    let versions = call(&b, "notes", "versions", json!(["Work/Battery.md"]));
    assert_eq!(versions[0]["content"], "# Battery\n\n", "{versions}");
    // A picture goes beside the page; a name that tries to leave the folder is cut to its last part.
    let before = events.lock().unwrap().len();
    let added = call(&b, "notes", "attach", json!(["Work/Battery.md", "..\\..\\cell.png", "iVBORw0K"]));
    assert_eq!(added["ref"], "Battery%20files/cell.png", "{added}");
    assert!(dir.path().join("workspace/notes/Work/Battery files/cell.png").is_file());
    assert!(events.lock().unwrap()[before..].iter().any(|(name, _)| name == "mobius:notes-changed"));
    assert_eq!(call(&b, "notes", "asset", json!(["Work/Battery.md", "Battery%20files/cell.png"]))["dataUrl"], "data:image/png;base64,iVBORw0K");
    std::fs::write(dir.path().join("workspace/secret.txt"), "no").unwrap();
    for bad in ["Battery files/../../../secret.txt", "../secret.txt", "/etc/hosts", "C:\\Windows\\win.ini", "Battery files/C:x"] {
        assert_eq!(call(&b, "notes", "asset", json!(["Work/Battery.md", bad]))["ok"], false, "{bad}");
    }
    assert_eq!(call(&b, "notes", "attach", json!(["../Battery.md", "a.png", "iVBORw0K"]))["ok"], false);
    assert_eq!(call(&b, "notes", "attach", json!(["Work/Battery.md", "a.png"]))["ok"], false);
}

#[test]
fn a_notes_comments_are_kept_beside_it_and_an_export_lands_in_exports() {
    let (b, _c, _events, dir) = bridge_in(tempfile::tempdir().unwrap());
    call(&b, "notes", "createNotebook", json!(["Work"]));
    call(&b, "notes", "createPage", json!(["Work", "Plan"]));
    let kept = call(&b, "notes", "setComments", json!(["Work/Plan.md", [{ "id": "c1", "quote": "Plan", "text": "Good", "whenMs": 1 }]]));
    assert_eq!(kept["comments"][0]["by"], "you", "{kept}");
    assert_eq!(call(&b, "notes", "comments", json!(["Work/Plan.md"]))[0]["text"], "Good");
    assert_eq!(call(&b, "notes", "setComments", json!(["../Plan.md", []]))["ok"], false);
    assert_eq!(call(&b, "notes", "setComments", json!(["Work/Plan.md", "nope"]))["ok"], false);
    let saved = call(&b, "notes", "export", json!(["Work/Plan.md", "md"]));
    assert_eq!(saved["saved"], "Exports/Plan.md", "{saved}");
    assert!(dir.path().join("workspace/Exports/Plan.md").is_file());
    assert_eq!(call(&b, "notes", "export", json!(["Work/Plan.md", "exe"]))["ok"], false);
}

#[test]
fn notes_are_real_files_the_window_can_list_edit_and_search() {
    let (b, _c, events, dir) = bridge_in(tempfile::tempdir().unwrap());
    assert_eq!(call(&b, "notes", "list", json!([])), json!([]));
    assert_eq!(call(&b, "notes", "createNotebook", json!(["Work"]))["name"], "Work");
    let page = call(&b, "notes", "createPage", json!(["Work", "Plans"]));
    assert_eq!(page["path"], "Work/Plans.md");
    let base = page["modified"].clone();
    let saved = call(&b, "notes", "save", json!(["Work/Plans.md", "# Plans\nship notes", base]));
    assert!(saved["modified"].is_u64(), "{saved}");
    assert_eq!(std::fs::read_to_string(dir.path().join("workspace/notes/Work/Plans.md")).unwrap(), "# Plans\nship notes");
    assert_eq!(call(&b, "notes", "read", json!(["Work/Plans.md"]))["content"], "# Plans\nship notes");
    assert_eq!(call(&b, "notes", "search", json!(["ship"]))[0]["path"], "Work/Plans.md");
    assert_eq!(call(&b, "notes", "list", json!([]))[0]["pages"][0]["title"], "Plans");
    // A stale save is refused, with the reason, and the window is told what to do.
    let stale = call(&b, "notes", "save", json!(["Work/Plans.md", "old", 1]));
    assert_eq!(stale["ok"], false);
    assert_eq!(stale["conflict"], true);
    // Bad arguments are refused without touching anything.
    for bad in [json!(["../x.md", "x", null]), json!([5, "x", null]), json!(["Work/Plans.md", 5, null]), json!(["Work/Plans.md", "x", "soon"])] {
        assert_eq!(call(&b, "notes", "save", bad.clone())["ok"], false, "{bad}");
    }
    assert_eq!(call(&b, "notes", "read", json!(["Work/Plans.md"]))["content"], "# Plans\nship notes");
    assert_eq!(call(&b, "notes", "remove", json!(["Work/Plans.md"]))["ok"], true);
    assert!(!dir.path().join("workspace/notes/Work/Plans.md").exists());
    let changed = events.lock().unwrap().iter().filter(|(name, _)| name == "mobius:notes-changed").count();
    assert!(changed >= 4, "create notebook, create page, save and remove each announce a change ({changed})");
}

#[test]
fn the_assistant_changing_a_note_tells_the_window() {
    let (b, _c, events, _dir) = bridge_in(tempfile::tempdir().unwrap());
    call(&b, "notes", "createNotebook", json!(["A"]));
    events.lock().unwrap().clear();
    b.host_request("host.tool", &json!({ "tool": "files.write", "arguments": { "path": "notes/A/x.md", "content": "# x" } })).unwrap();
    assert!(events.lock().unwrap().iter().any(|(name, v)| name == "mobius:notes-changed" && v["path"] == "A/x.md"));
    events.lock().unwrap().clear();
    b.host_request("host.tool", &json!({ "tool": "files.write", "arguments": { "path": "other.md", "content": "x" } })).unwrap();
    assert!(!events.lock().unwrap().iter().any(|(name, _)| name == "mobius:notes-changed"));
}

#[test]
fn tasks_are_real_files_the_window_and_the_agent_both_change() {
    let (b, _c, events, dir) = bridge_in(tempfile::tempdir().unwrap());
    assert_eq!(call(&b, "tasks", "lists", json!([])), json!([{ "name": "Inbox", "open": 0, "done": 0 }]));
    let added = call(&b, "tasks", "add", json!(["Inbox", "Call the plumber", "2026-11-12"]));
    assert_eq!(added["tasks"][0]["due"], "2026-11-12");
    let line = added["tasks"][0]["line"].clone();
    let ticked = call(&b, "tasks", "update", json!(["Inbox", line, "Call the plumber", { "done": true, "due": null }]));
    assert_eq!(ticked["tasks"][0]["done"], true);
    assert_eq!(std::fs::read_to_string(dir.path().join("workspace/tasks/Inbox.md")).unwrap(), "# Inbox\n\n- [x] Call the plumber\n");
    // A change to a task that is no longer what the window saw is refused, and says so.
    let stale = call(&b, "tasks", "update", json!(["Inbox", line, "Something else", { "done": false }]));
    assert_eq!((stale["ok"].clone(), stale["conflict"].clone()), (json!(false), json!(true)));
    for bad in [json!(["../x", "y"]), json!([5, "y"]), json!(["Inbox", 5])] {
        assert_eq!(call(&b, "tasks", "add", bad.clone())["ok"], false, "{bad}");
    }
    assert_eq!(call(&b, "tasks", "update", json!(["Inbox", line, "Call the plumber", { "due": 5 }]))["ok"], false);
    assert!(events.lock().unwrap().iter().filter(|(name, v)| name == "mobius:tasks-changed" && v["by"] == "person").count() >= 2);
    // The agent's tools go through the same lists, and the window hears about it.
    events.lock().unwrap().clear();
    b.host_request("host.tool", &json!({ "tool": "tasks.add", "arguments": { "list": "Work", "text": "Send report" } })).unwrap();
    assert!(events.lock().unwrap().iter().any(|(name, v)| name == "mobius:tasks-changed" && v["list"] == "Work" && v["by"] == "assistant"));
    assert_eq!(call(&b, "tasks", "read", json!(["Work"]))["tasks"][0]["text"], "Send report");
    events.lock().unwrap().clear();
    b.host_request("host.tool", &json!({ "tool": "tasks.list", "arguments": {} })).unwrap();
    assert!(!events.lock().unwrap().iter().any(|(name, _)| name == "mobius:tasks-changed"), "reading changes nothing");
}

#[test]
fn a_task_carries_a_flag_notes_and_subtasks_and_moves_between_lists_through_the_bridge() {
    let (b, _c, events, dir) = bridge_in(tempfile::tempdir().unwrap());
    call(&b, "tasks", "lists", json!([]));
    let added = call(&b, "tasks", "add", json!(["Inbox", "Book the sled", "", { "flagged": true }]));
    let line = added["tasks"][0]["line"].clone();
    let sub = call(&b, "tasks", "add", json!(["Inbox", "Check the trailer", "", { "under": { "line": line, "expect": "Book the sled" } }]));
    assert_eq!(sub["tasks"][1]["parent"], line);
    call(&b, "tasks", "update", json!(["Inbox", line, "Book the sled", { "notes": "Ask Dana." }]));
    let file = dir.path().join("workspace/tasks/Inbox.md");
    assert_eq!(std::fs::read_to_string(&file).unwrap(), "# Inbox\n\n- [ ] Book the sled (flagged)\n  Ask Dana.\n  - [ ] Check the trailer\n");
    // Deleting hands back what went, and restore puts it back.
    let gone = call(&b, "tasks", "remove", json!(["Inbox", line, "Book the sled"]));
    assert_eq!(gone["tasks"], json!([]));
    call(&b, "tasks", "restore", json!(["Inbox", gone["removed"]["line"], gone["removed"]["text"]]));
    assert!(std::fs::read_to_string(&file).unwrap().contains("  Ask Dana.\n  - [ ] Check the trailer"));
    call(&b, "tasks", "createList", json!(["Build"]));
    events.lock().unwrap().clear();
    let moved = call(&b, "tasks", "move", json!(["Inbox", line, "Book the sled", "Build"]));
    assert_eq!(moved["list"], "Build");
    assert!(events.lock().unwrap().iter().any(|(name, v)| name == "mobius:tasks-changed" && v["list"].is_null()));
    assert_eq!(call(&b, "tasks", "renameList", json!(["Build", "P2 build"]))["name"], "P2 build");
    assert_eq!(call(&b, "tasks", "read", json!(["P2 build"]))["tasks"].as_array().unwrap().len(), 2);
    assert_eq!(call(&b, "tasks", "deleteList", json!(["Inbox"]))["ok"], false);
    let gone = call(&b, "tasks", "deleteList", json!(["P2 build"]));
    assert!(!dir.path().join("workspace/tasks/P2 build.md").exists());
    call(&b, "tasks", "restoreList", json!(["P2 build", gone["text"]]));
    assert!(std::fs::read_to_string(dir.path().join("workspace/tasks/P2 build.md")).unwrap().contains("Book the sled"));
    assert_eq!(call(&b, "tasks", "restore", json!(["Inbox", 0, "# not a task"]))["ok"], false);
}

/// A provider's models endpoint that answers only to one key, and remembers what it was sent.
fn provider_server(key: &'static str) -> (String, Arc<std::sync::Mutex<Vec<String>>>) {
    use std::io::{Read, Write};
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://127.0.0.1:{}/v1", listener.local_addr().unwrap().port());
    let seen = Arc::new(std::sync::Mutex::new(Vec::new()));
    let log = seen.clone();
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut s) = stream else { break };
            let mut buf = [0u8; 8192];
            let n = s.read(&mut buf).unwrap_or(0);
            let request = String::from_utf8_lossy(&buf[..n]).to_string();
            log.lock().unwrap().push(request.clone());
            let allowed = request.lines().any(|l| l.eq_ignore_ascii_case(&format!("authorization: Bearer {key}")));
            let (status, body) = if allowed { (200, r#"{"data":[{"id":"model-b"},{"id":"model-a"}]}"#) } else { (401, "{}") };
            let _ = write!(s, "HTTP/1.1 {status} X\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}", body.len());
        }
    });
    (url, seen)
}

fn every_file_text(dir: &std::path::Path) -> String {
    let mut all = String::new();
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        for e in std::fs::read_dir(&d).into_iter().flatten().flatten() {
            if e.path().is_dir() { stack.push(e.path()); } else { all.push_str(&String::from_utf8_lossy(&std::fs::read(e.path()).unwrap_or_default())); }
        }
    }
    all
}

#[test]
fn a_provider_key_is_used_only_for_that_provider_and_switching_keeps_the_rest() {
    let (url, seen) = provider_server("sk-openai-12345678");
    let (b, _c, events, dir) = bridge_in(tempfile::tempdir().unwrap());
    b.enable_test_hooks();
    b.redirect_provider_for_tests("openai", &url);
    // Without a key nothing is sent at all.
    assert_eq!(call(&b, "providers", "models", json!(["openai"]))["ok"], false);
    assert!(seen.lock().unwrap().is_empty());
    assert_eq!(call(&b, "providers", "setKey", json!(["openai", "sk-openai-12345678"]))["ok"], true);
    assert!(events.lock().unwrap().iter().any(|(n, _)| n == "mobius:providers-changed"));
    assert_eq!(call(&b, "providers", "models", json!(["openai"]))["models"], json!(["model-a", "model-b"]));
    // Instructions set earlier survive a switch of provider.
    call(&b, "agent", "configure", json!([{ "baseUrl": "http://127.0.0.1:9/v1", "model": "old", "system": "Be brief." }]));
    assert_eq!(call(&b, "providers", "use", json!(["openai", "model-b"]))["ok"], true);
    let settings = call(&b, "agent", "getSettings", json!([]));
    assert_eq!((settings["baseUrl"].as_str(), settings["model"].as_str(), settings["hasKey"].as_bool(), settings["system"].as_str()), (Some(url.as_str()), Some("model-b"), Some(true), Some("Be brief.")));
    let listed = call(&b, "providers", "list", json!([]));
    assert_eq!(listed.as_array().unwrap().iter().filter(|p| p["active"] == true).map(|p| p["id"].clone()).collect::<Vec<_>>(), [json!("openai")]);
    // The key is never shown and never written to a plain file.
    assert!(!listed.to_string().contains("sk-openai"));
    assert!(!every_file_text(dir.path()).contains("sk-openai-12345678"));
    // Another provider has no key: using it is refused and nothing is sent anywhere.
    assert_eq!(call(&b, "providers", "use", json!(["groq", "llama"]))["ok"], false);
    for bad in [json!(["nope", "m"]), json!(["openai", ""]), json!(["openai", "bad\nmodel"]), json!([5, "m"])] {
        assert_eq!(call(&b, "providers", "use", bad.clone())["ok"], false, "{bad}");
    }
    assert_eq!(call(&b, "providers", "setKey", json!(["openai", 5]))["ok"], false);
    // Removing the key stops it being sent, also by the agent that was using it.
    call(&b, "providers", "removeKey", json!(["openai"]));
    assert_eq!(call(&b, "agent", "getSettings", json!([]))["hasKey"], false);
    assert_eq!(call(&b, "providers", "list", json!([]))[0]["hasKey"], false);
}

#[test]
fn redirecting_a_provider_needs_the_test_hooks() {
    let (b, _c, _e, _d) = bridge_in(tempfile::tempdir().unwrap());
    b.redirect_provider_for_tests("openai", "http://127.0.0.1:9/v1");
    assert_eq!(call(&b, "providers", "list", json!([]))[0]["baseUrl"], "https://api.openai.com/v1");
    assert_eq!(b.provider_address("openai").as_deref(), Some("https://api.openai.com/v1"));
}

#[test]
fn the_claude_subscription_signs_in_through_its_own_app_and_is_used_without_a_key() {
    let (b, core, _e, _d) = bridge_in(tempfile::tempdir().unwrap());
    b.enable_test_hooks();
    b.use_claude_for_tests(&fake_claude());
    let accounts = call(&b, "providers", "accounts", json!([]));
    assert_eq!(accounts[0]["id"], "claude-code");
    assert!(accounts[0]["note"].as_str().unwrap().contains("allowance"));
    assert!(accounts[0]["models"].as_array().unwrap().iter().any(|m| m["id"] == "sonnet"));
    let status = call(&b, "providers", "accountStatus", json!(["claude-code"]));
    assert_eq!((status["installed"].as_bool(), status["signedIn"].as_bool(), status["account"].as_str(), status["version"].as_str()), (Some(true), Some(true), Some("person@example.com"), Some("9.9.9")));
    assert_eq!(call(&b, "providers", "signIn", json!(["claude-code"]))["ok"], true);
    assert!(b.sign_ins_for_tests()[0].ends_with("auth login"), "{:?}", b.sign_ins_for_tests());
    assert_eq!(call(&b, "providers", "signIn", json!(["nope"]))["ok"], false);
    for bad in [json!(["claude-code", "gpt-4o"]), json!(["claude-code", ""]), json!(["claude-code"])] {
        assert_eq!(call(&b, "providers", "use", bad.clone())["ok"], false, "{bad}");
    }
    assert_eq!(call(&b, "providers", "use", json!(["claude-code", "sonnet"]))["ok"], true);
    let settings = call(&b, "agent", "getSettings", json!([]));
    assert_eq!((settings["baseUrl"].as_str(), settings["model"].as_str(), settings["hasKey"].as_bool()), (Some("claude-code://subscription"), Some("sonnet"), Some(false)));
    assert_eq!(call(&b, "providers", "accountStatus", json!(["claude-code"]))["active"], true);
    assert!(call(&b, "agent", "models", json!([]))["models"].as_array().unwrap().contains(&json!("opus")));
    let log = core.call("test.log", json!({}), Duration::from_secs(5)).unwrap();
    let configure = log.as_array().unwrap().iter().rev().find(|c| c["method"] == "agent.configure").unwrap().clone();
    assert_eq!(configure["params"]["base_url"], "claude-code://subscription");
    assert!(configure["params"].get("api_key").is_none_or(serde_json::Value::is_null), "no key goes with it");
}

#[test]
fn without_the_test_hooks_a_fake_claude_cannot_be_set() {
    let (b, _c, _e, _d) = bridge_in(tempfile::tempdir().unwrap());
    b.use_claude_for_tests(&fake_claude());
    let status = call(&b, "providers", "accountStatus", json!(["claude-code"]));
    assert_ne!(status["version"], "9.9.9", "the fake was ignored");
}

/// The stand-in Claude Code CLI from mobius-claude.
fn fake_claude() -> std::path::PathBuf {
    std::path::PathBuf::from(fake_bin("mobius-claude", "fake-claude"))
}

/// A test program that belongs to another crate, built on first use. (Declaring it here as well would make two
/// crates write the same file, which breaks parallel builds on Windows.)
fn fake_bin(package: &str, bin: &str) -> String {
    static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _held = LOCK.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let cargo = std::env::var("CARGO").unwrap_or_else(|_| "cargo".into());
    let ok = std::process::Command::new(cargo).current_dir(&root).args(["build", "-q", "-p", package, "--bin", bin]).status().is_ok_and(|s| s.success());
    assert!(ok, "could not build {bin}");
    root.join("target/debug").join(if cfg!(windows) { format!("{bin}.exe") } else { bin.to_owned() }).display().to_string()
}

#[test]
fn the_model_picker_lists_every_provider_with_a_key_and_its_models_and_marks_the_one_in_use() {
    let (url, _seen) = provider_server("sk-picker-test-1234");
    let (b, _c, _events, _dir) = bridge_in(tempfile::tempdir().unwrap());
    b.enable_test_hooks();
    b.redirect_provider_for_tests("openai", &url);
    b.redirect_provider_for_tests("groq", "http://127.0.0.1:9/v1");
    b.use_claude_for_tests(std::path::Path::new("C:/no/such/claude.exe"));
    // Nothing set up: nothing to offer.
    assert_eq!(call(&b, "providers", "catalog", json!([]))["groups"], json!([]));
    call(&b, "providers", "setKey", json!(["openai", "sk-picker-test-1234"]));
    call(&b, "providers", "setKey", json!(["groq", "gsk-test-key-1234"]));
    assert_eq!(call(&b, "providers", "use", json!(["openai", "model-b"])), json!({ "ok": true }));
    let catalog = call(&b, "providers", "catalog", json!([]));
    assert_eq!(catalog["current"], "model-b");
    let groups = catalog["groups"].as_array().unwrap();
    let openai = groups.iter().find(|g| g["id"] == "openai").unwrap();
    assert_eq!((openai["kind"].clone(), openai["active"].clone()), (json!("provider"), json!(true)));
    assert_eq!(openai["models"], json!([{ "id": "model-a", "label": "model-a" }, { "id": "model-b", "label": "model-b" }]));
    // A provider that does not answer is still listed, with its problem, and is not in use.
    let groq = groups.iter().find(|g| g["id"] == "groq").unwrap();
    assert_eq!((groq["active"].clone(), groq["models"].clone()), (json!(false), json!([])));
    assert!(groq["error"].is_string());
    // Providers without a key, and plans nobody signed in to, are not offered.
    assert!(!groups.iter().any(|g| g["id"] == "anthropic" || g["kind"] == "subscription"));
    assert!(!catalog.to_string().contains("sk-picker") && !catalog.to_string().contains("gsk-test"));
}

#[test]
fn a_server_that_is_no_provider_is_offered_as_this_server() {
    let (url, _seen) = provider_server("sk-picker-test-1234");
    let (b, _c, _events, _dir) = bridge_in(tempfile::tempdir().unwrap());
    b.enable_test_hooks();
    b.use_claude_for_tests(std::path::Path::new("C:/no/such/claude.exe"));
    call(&b, "agent", "configure", json!([{ "baseUrl": url, "model": "model-a", "apiKey": "sk-picker-test-1234" }]));
    let groups = call(&b, "providers", "catalog", json!([]))["groups"].clone();
    assert_eq!(groups[0]["kind"], "server");
    assert_eq!(groups[0]["active"], true);
}

#[test]
fn code_projects_run_only_the_test_command_the_person_chose() {
    let (b, _core, events, _d) = bridge_in(tempfile::tempdir().unwrap());
    assert_eq!(call(&b, "code", "createProject", json!(["planner"]))["name"], "planner");
    let saved = call(&b, "code", "save", json!(["planner", "src/budget.ts", "export const a = 1;\n", null]));
    assert!(saved["modified"].is_number());
    let tree = call(&b, "code", "tree", json!(["planner"]));
    assert_eq!(tree["entries"].as_array().unwrap().len(), 3);
    assert_eq!(call(&b, "code", "save", json!(["planner", "../x", "y", null]))["ok"], false);
    // No command yet: the agent cannot run anything, and cannot choose one.
    assert!(b.host_request("host.tool", &json!({ "tool": "code.test", "arguments": { "project": "planner" } })).unwrap_err().contains("No test command"));
    assert_eq!(call(&b, "code", "testCommand", json!(["planner"]))["command"], serde_json::Value::Null);
    let check = if cfg!(windows) { "findstr a src\\budget.ts" } else { "grep a src/budget.ts" };
    assert_eq!(call(&b, "code", "setTestCommand", json!(["planner", check]))["ok"], true);
    let text = b.host_request("host.tool", &json!({ "tool": "code.test", "arguments": { "project": "planner" } })).unwrap();
    assert!(text.as_str().unwrap().starts_with("Tests for planner passed"), "{text}");
    let run = call(&b, "code", "runTests", json!(["planner"]));
    assert_eq!(run["passed"], true);
    assert!(events.lock().unwrap().iter().any(|(name, _)| name == "mobius:code-tests"));
}

#[cfg(unix)]
#[test]
fn a_command_mobius_started_is_listed_read_and_stopped() {
    let (b, _core, _events, _d) = bridge_in(tempfile::tempdir().unwrap());
    call(&b, "code", "createProject", json!(["p"]));
    let person = call(&b, "code", "start", json!(["p", "sleep 30"]));
    assert_eq!(person["id"], 1);
    let started = b.host_request("host.tool", &json!({ "tool": "code.start", "arguments": { "project": "p", "command": "echo serving; sleep 30" } })).unwrap();
    assert!(started.as_str().unwrap().starts_with("Started as command 2."), "{started}");
    b.host_request("host.tool", &json!({ "tool": "code.stop", "arguments": { "id": "2" } })).unwrap();
    let list = call(&b, "code", "processes", json!(["p"]));
    assert_eq!(list[1]["running"], false, "{list}");
    assert_eq!(list[0]["running"], true);
    call(&b, "code", "stopProcess", json!([1]));
}

#[test]
fn voice_settings_are_kept_and_the_test_says_what_is_missing_without_any_key_in_the_answer() {
    let (b, _c, _events, dir) = bridge_in(tempfile::tempdir().unwrap());
    // Off: nothing to try.
    call(&b, "preferences", "set", json!([{ "speakWith": "off" }]));
    assert_eq!(call(&b, "voice", "test", json!(["speak"]))["ok"], false);
    // ElevenLabs without a key says where to add one.
    call(&b, "preferences", "set", json!([{ "speakWith": "elevenlabs", "speakVoice": "Rachel" }]));
    let missing = call(&b, "voice", "test", json!(["speak"]));
    assert!(missing["error"].as_str().unwrap_or("").contains("Gateways"), "{missing}");
    // A speech server on this computer that is not running says so, with its address.
    call(&b, "preferences", "set", json!([{ "listenWith": "local", "listenUrl": "http://127.0.0.1:9/v1" }]));
    let down = call(&b, "voice", "test", json!(["listen"]));
    assert_eq!(down["ok"], false);
    assert!(down["error"].as_str().unwrap_or("").contains("127.0.0.1:9"), "{down}");
    // A bad address is refused, and the choices are kept in preferences.json.
    call(&b, "preferences", "set", json!([{ "listenUrl": "ftp://nope" }]));
    let kept: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(dir.path().join("preferences.json")).unwrap()).unwrap();
    assert_eq!(kept["listenWith"], "local");
    assert_eq!(kept["listenUrl"], "http://127.0.0.1:9/v1");
    assert_eq!(kept["speakVoice"], "Rachel");
    // ElevenLabs is a gateway for voice only: never a chat model.
    let list = call(&b, "providers", "list", json!([]));
    assert!(list.as_array().unwrap().iter().any(|p| p["id"] == "elevenlabs" && p["voiceOnly"] == true));
    assert_eq!(call(&b, "providers", "use", json!(["elevenlabs", "x"]))["ok"], false);
}

#[test]
fn the_second_model_comes_from_a_gateway_with_its_own_key_and_the_first_stays() {
    let (url, _seen) = provider_server("sk-openai-12345678");
    let (b, _c, _events, dir) = bridge_in(tempfile::tempdir().unwrap());
    b.enable_test_hooks();
    b.redirect_provider_for_tests("openai", &url);
    // No first model yet: there is nothing to back up.
    assert_eq!(call(&b, "providers", "useFallback", json!(["openai", "model-b"]))["ok"], false);
    call(&b, "agent", "configure", json!([{ "baseUrl": "http://127.0.0.1:9/v1", "model": "first", "system": "Be brief." }]));
    // A gateway without its key is refused.
    assert_eq!(call(&b, "providers", "useFallback", json!(["openai", "model-b"]))["ok"], false);
    assert_eq!(call(&b, "providers", "setKey", json!(["openai", "sk-openai-12345678"]))["ok"], true);
    assert_eq!(call(&b, "providers", "useFallback", json!(["openai", "model-b"]))["ok"], true);
    let s = call(&b, "agent", "getSettings", json!([]));
    assert_eq!((s["model"].as_str(), s["fallbackBaseUrl"].as_str(), s["fallbackModel"].as_str(), s["hasFallbackKey"].as_bool(), s["system"].as_str()), (Some("first"), Some(url.as_str()), Some("model-b"), Some(true), Some("Be brief.")));
    // The catalog says where each gateway is, so the window can show which one the second model uses; never its key.
    let catalog = call(&b, "providers", "catalog", json!([]));
    assert!(catalog["groups"].as_array().unwrap().iter().any(|g| g["id"] == "openai" && g["address"] == url.as_str()), "{catalog}");
    assert!(!catalog.to_string().contains("sk-openai") && !every_file_text(dir.path()).contains("sk-openai-12345678"));
    // Voice-only gateways and unknown ones are refused; none takes the second model away.
    assert_eq!(call(&b, "providers", "useFallback", json!(["elevenlabs", "x"]))["ok"], false);
    assert_eq!(call(&b, "providers", "useFallback", json!(["nope", "x"]))["ok"], false);
    assert_eq!(call(&b, "providers", "useFallback", json!(["none"]))["ok"], true);
    assert_eq!(call(&b, "agent", "getSettings", json!([]))["fallbackModel"], "");
}

/// Signing in to OpenRouter on its own page: the key it hands back is kept like a pasted one, and never listed.
#[test]
fn an_openrouter_sign_in_keeps_the_key_it_is_given() {
    use std::io::{BufRead, BufReader, Read, Write};
    let site = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let site_url = format!("http://{}", site.local_addr().unwrap());
    std::thread::spawn(move || {
        for stream in site.incoming() {
            let Ok(mut stream) = stream else { continue };
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut length = 0usize;
            loop {
                let mut header = String::new();
                reader.read_line(&mut header).unwrap();
                if header.trim().is_empty() {
                    break;
                }
                if let Some(v) = header.to_ascii_lowercase().strip_prefix("content-length:") {
                    length = v.trim().parse().unwrap();
                }
            }
            let mut body = vec![0; length];
            reader.read_exact(&mut body).unwrap();
            let reply = r#"{"key":"sk-or-v1-signed-in-1234"}"#;
            let _ = write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{reply}", reply.len());
        }
    });
    let (b, _c, events, dir) = bridge_in(tempfile::tempdir().unwrap());
    b.enable_test_hooks();
    b.use_openrouter_for_tests(&site_url);
    let listed = call(&b, "providers", "list", json!([]));
    let openrouter = |listed: &serde_json::Value| listed.as_array().unwrap().iter().find(|p| p["id"] == "openrouter").unwrap().clone();
    assert_eq!(openrouter(&listed)["canSignIn"], true);
    assert_eq!(openrouter(&listed)["hasKey"], false);
    assert_eq!(call(&b, "providers", "keySignIn", json!(["groq"]))["ok"], false, "only OpenRouter has a sign-in");
    let started = call(&b, "providers", "keySignIn", json!(["openrouter"]));
    let url = url::Url::parse(started["url"].as_str().unwrap()).unwrap();
    let param = |name: &str| url.query_pairs().find(|(k, _)| k == name).unwrap().1.into_owned();
    assert!(call(&b, "providers", "keySignInStatus", json!(["openrouter"]))["pending"].is_string());
    let callback = format!("{}?code=abc&state={}", param("callback_url").replace("localhost", "127.0.0.1"), param("state"));
    let agent: ureq::Agent = ureq::Agent::config_builder().http_status_as_error(false).build().into();
    assert_eq!(agent.get(&callback).call().unwrap().status().as_u16(), 200);
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    while openrouter(&call(&b, "providers", "list", json!([])))["hasKey"] != true {
        assert!(std::time::Instant::now() < deadline, "the key was not kept");
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    assert!(events.lock().unwrap().iter().any(|(n, _)| n == "mobius:providers-changed"));
    assert!(!call(&b, "providers", "list", json!([])).to_string().contains("sk-or-v1"));
    assert!(!every_file_text(dir.path()).contains("sk-or-v1-signed-in-1234"));
}

/// Signing in to Hugging Face with a code: the token it hands back is kept like a pasted key, and never listed.
#[test]
fn a_hugging_face_sign_in_shows_a_code_and_keeps_the_token() {
    use std::io::{BufRead, BufReader, Read, Write};
    let site = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let site_url = format!("http://{}", site.local_addr().unwrap());
    let page = site_url.clone();
    std::thread::spawn(move || {
        for stream in site.incoming() {
            let Ok(mut stream) = stream else { continue };
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut first = String::new();
            reader.read_line(&mut first).unwrap();
            let mut length = 0usize;
            loop {
                let mut header = String::new();
                reader.read_line(&mut header).unwrap();
                if header.trim().is_empty() {
                    break;
                }
                if let Some(v) = header.to_ascii_lowercase().strip_prefix("content-length:") {
                    length = v.trim().parse().unwrap();
                }
            }
            let mut body = vec![0; length];
            reader.read_exact(&mut body).unwrap();
            let reply = if first.starts_with("POST /oauth/device ") {
                format!(r#"{{"device_code":"d1","user_code":"WXYZ-0001","verification_uri":"{page}/device","interval":0}}"#)
            } else {
                r#"{"access_token":"hf_oauth_signed_in_1234"}"#.to_owned()
            };
            let _ = write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{reply}", reply.len());
        }
    });
    let (b, _c, _events, dir) = bridge_in(tempfile::tempdir().unwrap());
    let hf = |listed: &serde_json::Value| listed.as_array().unwrap().iter().find(|p| p["id"] == "huggingface").unwrap().clone();
    b.enable_test_hooks();
    b.use_hugging_face_for_tests(&site_url, "mobius-test-client");
    assert_eq!(hf(&call(&b, "providers", "list", json!([])))["canSignIn"], true);
    let started = call(&b, "providers", "keySignIn", json!(["huggingface"]));
    assert_eq!((started["url"].as_str(), started["code"].as_str()), (Some(format!("{site_url}/device").as_str()), Some("WXYZ-0001")), "{started}");
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    while hf(&call(&b, "providers", "list", json!([])))["hasKey"] != true {
        assert!(std::time::Instant::now() < deadline, "the token was not kept");
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    assert_eq!(call(&b, "providers", "keySignInStatus", json!(["huggingface"]))["pending"], serde_json::Value::Null);
    assert!(!call(&b, "providers", "list", json!([])).to_string().contains("hf_oauth"));
    assert!(!every_file_text(dir.path()).contains("hf_oauth_signed_in_1234"));
}

/// The GitHub Copilot plan: sign in with GitHub using a code, then the plan can be chosen; signing out forgets it.
#[test]
fn a_copilot_sign_in_shows_a_code_and_lets_the_plan_be_used() {
    use std::io::{BufRead, BufReader, Read, Write};
    let site = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let site_url = format!("http://{}", site.local_addr().unwrap());
    let page = site_url.clone();
    std::thread::spawn(move || {
        for stream in site.incoming() {
            let Ok(mut stream) = stream else { continue };
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut first = String::new();
            reader.read_line(&mut first).unwrap();
            let mut length = 0usize;
            loop {
                let mut header = String::new();
                reader.read_line(&mut header).unwrap();
                if header.trim().is_empty() {
                    break;
                }
                if let Some(v) = header.to_ascii_lowercase().strip_prefix("content-length:") {
                    length = v.trim().parse().unwrap();
                }
            }
            let mut body = vec![0; length];
            reader.read_exact(&mut body).unwrap();
            let reply = if first.starts_with("POST /login/device/code ") {
                format!(r#"{{"device_code":"g1","user_code":"COPI-LOT1","verification_uri":"{page}/login/device","interval":0}}"#)
            } else {
                r#"{"access_token":"gho_copilot_signed_in_1234","token_type":"bearer"}"#.to_owned()
            };
            let _ = write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{reply}", reply.len());
        }
    });
    let (b, _c, _events, dir) = bridge_in(tempfile::tempdir().unwrap());
    b.enable_test_hooks();
    let fake_cli = dir.path().join(if cfg!(windows) { "copilot.exe" } else { "copilot" });
    std::fs::write(&fake_cli, b"").unwrap();
    b.use_copilot_for_tests(&site_url, "gh-test-client", &fake_cli);
    let accounts = call(&b, "providers", "accounts", json!([]));
    assert!(accounts.as_array().unwrap().iter().any(|a| a["id"] == "copilot"), "{accounts}");
    assert_eq!(call(&b, "providers", "use", json!(["copilot", "gpt-5"]))["ok"], false, "not signed in yet");
    let started = call(&b, "providers", "signIn", json!(["copilot"]));
    assert_eq!(started["code"], "COPI-LOT1", "{started}");
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    while call(&b, "providers", "accountStatus", json!(["copilot"]))["signedIn"] != true {
        assert!(std::time::Instant::now() < deadline, "the sign-in was not kept");
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    assert_eq!(call(&b, "providers", "accountStatus", json!(["copilot"]))["installed"], true);
    assert_eq!(call(&b, "providers", "use", json!(["copilot", "gpt-5; rm"]))["ok"], false);
    assert_eq!(call(&b, "providers", "use", json!(["copilot", "gpt-5"]))["ok"], true);
    assert_eq!(call(&b, "agent", "getSettings", json!([]))["baseUrl"], "copilot://subscription");
    assert!(!every_file_text(dir.path()).contains("gho_copilot_signed_in_1234"));
    call(&b, "providers", "signOut", json!(["copilot"]));
    assert_eq!(call(&b, "providers", "accountStatus", json!(["copilot"]))["signedIn"], false);
}

/// The quick model (the Act mode's reviewer) comes from a gateway with its key, is kept in the preferences, and goes
/// when its key does.
#[test]
fn the_quick_model_comes_from_a_gateway_and_goes_with_its_key() {
    let (url, _seen) = provider_server("sk-openai-12345678");
    let (b, c, _events, dir) = bridge_in(tempfile::tempdir().unwrap());
    b.enable_test_hooks();
    b.redirect_provider_for_tests("openai", &url);
    call(&b, "agent", "configure", json!([{ "baseUrl": "http://127.0.0.1:9/v1", "model": "first" }]));
    let last = || c.call("test.last_configure", json!({}), Duration::from_secs(5)).unwrap();
    assert_eq!(call(&b, "providers", "useQuick", json!(["openai", "mini"]))["ok"], false, "no key yet");
    assert_eq!(call(&b, "providers", "setKey", json!(["openai", "sk-openai-12345678"]))["ok"], true);
    assert_eq!(call(&b, "providers", "useQuick", json!(["openai", "mini"]))["ok"], true);
    assert_eq!(call(&b, "preferences", "get", json!([]))["quickModel"], "openai|mini");
    assert_eq!(last()["quick"], json!({ "base_url": url, "model": "mini", "api_key": "sk-openai-12345678" }));
    assert_eq!(last()["model"], "first", "the chat model stays");
    assert!(!every_file_text(dir.path()).contains("sk-openai-12345678"));
    for bad in [json!(["elevenlabs", "x"]), json!(["nope", "x"]), json!(["openai", ""]), json!(["openai"])] {
        assert_eq!(call(&b, "providers", "useQuick", bad.clone())["ok"], false, "{bad}");
    }
    // Removing the key leaves the quick jobs to the chat model; the choice is kept for when a key comes back.
    call(&b, "providers", "removeKey", json!(["openai"]));
    assert!(last().get("quick").is_none(), "{}", last());
    assert_eq!(call(&b, "providers", "setKey", json!(["openai", "sk-openai-12345678"]))["ok"], true);
    assert_eq!(last()["quick"]["model"], "mini");
    assert_eq!(call(&b, "providers", "useQuick", json!(["none"]))["ok"], true);
    assert!(last().get("quick").is_none());
    assert_eq!(call(&b, "preferences", "get", json!([]))["quickModel"], "");
}

/// A thread started in a project tells the model which project it is in; other conversations say nothing of it.
#[test]
fn a_project_thread_tells_the_model_its_project() {
    let (b, core, _events, _dir) = bridge_in(tempfile::tempdir().unwrap());
    let project = call(&b, "projects", "create", json!(["Kestrel P2"]));
    let id = project["id"].as_str().unwrap_or_else(|| panic!("{project}")).to_owned();
    assert!(call(&b, "projects", "addThread", json!([id, "c-1"]))["threads"].as_array().is_some());
    let last = || core.call("test.last_send", json!({}), Duration::from_secs(5)).unwrap();
    assert_eq!(call(&b, "agent", "send", json!(["c-1", "plan the build"]))["ok"], true);
    let system = last()["system"].as_str().unwrap_or("").to_owned();
    assert!(system.contains("project \"Kestrel P2\"") && system.contains("Projects/Kestrel P2.md"), "{system}");
    assert_eq!(call(&b, "agent", "send", json!(["c-2", "hello"]))["ok"], true);
    assert!(!last()["system"].as_str().unwrap_or("").contains("Kestrel"));
    // Nothing made yet: the project's page lists nothing.
    assert_eq!(call(&b, "projects", "made", json!([id])), json!([]));
    assert_eq!(call(&b, "projects", "made", json!(["nope"]))["ok"], false);
}

/// What the person changes after a turn ends is theirs: never listed with the turn, never put back by its Undo.
#[test]
fn changes_after_a_turn_ends_do_not_join_it() {
    let (b, _core, _events, dir) = bridge_in(tempfile::tempdir().unwrap());
    let ws = dir.path().join("workspace");
    std::fs::create_dir_all(ws.join("notes")).unwrap();
    std::fs::create_dir_all(ws.join("docs")).unwrap();
    std::fs::write(ws.join("notes/Old.md"), "# Old\n").unwrap();
    assert_eq!(call(&b, "agent", "send", json!(["c-1", "write a note"]))["ok"], true);
    let wait = |what: &dyn Fn() -> bool| {
        let start = Instant::now();
        while !what() {
            assert!(start.elapsed() < Duration::from_secs(20), "timed out");
            std::thread::sleep(Duration::from_millis(50));
        }
    };
    // The turn's start is marked, then the turn writes its note and ends.
    wait(&|| call(&b, "changes", "turns", json!(["c-1"]))["turns"].as_array().is_some_and(|t| !t.is_empty()));
    std::fs::write(ws.join("notes/Turn.md"), "# Turn\n").unwrap();
    b.on_core_notification("agent.event", &json!({ "conversation": "c-1", "turn": 1, "event": { "kind": "done" } }));
    wait(&|| call(&b, "changes", "turns", json!(["c-1"]))["turns"][0]["ended"] == true);
    // The person writes their own doc afterwards.
    std::fs::write(ws.join("docs/Mine.md"), "# Mine\n").unwrap();
    assert_eq!(call(&b, "changes", "lastTurn", json!(["c-1"]))["files"], json!(["notes/Turn.md"]));
    assert_eq!(call(&b, "changes", "undoFile", json!(["c-1", "docs/Mine.md"]))["ok"], false, "not the turn's to put back");
    let undone = call(&b, "changes", "undo", json!(["c-1"]));
    assert_eq!(undone["ok"], true, "{undone}");
    assert!(!ws.join("notes/Turn.md").exists(), "the turn's note is put back");
    assert_eq!(std::fs::read_to_string(ws.join("docs/Mine.md")).unwrap(), "# Mine\n", "the person's doc stays");
}

/// Mobius reads the comments on a document, answers one under it and resolves it; Docs is told so it shows them.
#[test]
fn mobius_reads_answers_and_resolves_comments() {
    let (b, _core, events, _dir) = bridge_in(tempfile::tempdir().unwrap());
    call(&b, "docs", "createNotebook", json!(["Documents"]));
    let page = call(&b, "docs", "createPage", json!(["Documents", "Release notes"]))["path"].as_str().unwrap().to_owned();
    call(&b, "docs", "setComments", json!([page, [{ "id": "c1", "quote": "ships in May", "text": "Is May still right?", "by": "you", "whenMs": 1 }]]));
    let tool = |name: &str, args: serde_json::Value| b.host_request("host.tool", &json!({ "tool": name, "arguments": args }));
    let all = tool("comments.list", json!({})).unwrap();
    assert!(all.as_str().unwrap().contains("Is May still right?") && all.as_str().unwrap().contains(&format!("docs/{page}")), "{all}");
    let full = format!("docs/{page}");
    assert_eq!(tool("comments.reply", json!({ "page": full, "id": "c1", "text": "Yes, May 14." })).unwrap(), json!(format!("Replied under the comment on {full}.")));
    assert_eq!(tool("comments.resolve", json!({ "page": full, "id": "c1" })).unwrap(), json!(format!("Resolved the comment on {full}.")));
    let kept = call(&b, "docs", "comments", json!([page]));
    assert_eq!(kept[1]["by"], "Mobius");
    assert_eq!(kept[1]["replyTo"], "c1");
    assert!(kept.as_array().unwrap().iter().all(|c| c["resolved"] == true));
    assert!(events.lock().unwrap().iter().any(|(n, v)| n == "mobius:docs-changed" && v["by"] == "assistant" && v["path"] == page.as_str()));
    assert!(tool("comments.reply", json!({ "page": "sheets/Budget.csv", "id": "c1", "text": "no" })).unwrap_err().contains("Notes"));
    assert!(tool("comments.reply", json!({ "page": full, "id": "c9", "text": "no" })).is_err());
}

/// Mobius makes a picture with the image model chosen in Models and keeps it in Photo; with none chosen it says where to
/// choose one, and only gateways with a key are offered.
#[test]
fn a_picture_is_made_with_the_chosen_image_model_and_kept_in_photo() {
    use std::io::{BufRead, BufReader, Read, Write};
    // A 1×1 PNG.
    const PNG: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    let seen: Arc<std::sync::Mutex<Vec<(String, String)>>> = Arc::default();
    let site = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/v1", site.local_addr().unwrap());
    let heard = seen.clone();
    std::thread::spawn(move || {
        for stream in site.incoming() {
            let Ok(mut stream) = stream else { continue };
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let (mut length, mut line) = (0usize, String::new());
            reader.read_line(&mut line).unwrap();
            loop {
                let mut header = String::new();
                reader.read_line(&mut header).unwrap();
                if header.trim().is_empty() {
                    break;
                }
                if let Some(v) = header.to_ascii_lowercase().strip_prefix("content-length:") {
                    length = v.trim().parse().unwrap();
                }
            }
            let mut body = vec![0; length];
            reader.read_exact(&mut body).unwrap();
            heard.lock().unwrap().push((line.clone(), String::from_utf8_lossy(&body).into_owned()));
            let reply = if line.contains("/images/generations") { format!(r#"{{"data":[{{"b64_json":"{PNG}"}}]}}"#) } else { r#"{"data":[]}"#.to_owned() };
            let _ = write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{reply}", reply.len());
        }
    });
    let (b, _c, events, dir) = bridge_in(tempfile::tempdir().unwrap());
    b.enable_test_hooks();
    b.redirect_provider_for_tests("openai", &url);
    let tool = |args: serde_json::Value| b.host_request("host.tool", &json!({ "tool": "images.generate", "arguments": args }));
    assert!(tool(json!({ "prompt": "a kite" })).unwrap_err().contains("Settings, Models, Images"));
    assert_eq!(call(&b, "providers", "imageModels", json!([]))["choices"], json!([]));
    assert_eq!(call(&b, "providers", "useImages", json!(["openai", "gpt-image-1"]))["ok"], false, "no key yet");
    assert_eq!(call(&b, "providers", "setKey", json!(["openai", "sk-openai-12345678"]))["ok"], true);
    let offered = call(&b, "providers", "imageModels", json!([]));
    assert!(offered["choices"].as_array().unwrap().iter().any(|c| c["model"] == "gpt-image-1"), "{offered}");
    assert_eq!(call(&b, "providers", "useImages", json!(["openai", "gpt-image-1"]))["ok"], true);
    assert_eq!(call(&b, "preferences", "get", json!([]))["imageModel"], "openai|gpt-image-1");
    let made = tool(json!({ "prompt": "A red kite over the hills", "name": "Kite", "shape": "wide" })).unwrap();
    assert_eq!(made, json!("Made the picture and kept it in Photo as photos/Made by Mobius/Kite.png."));
    assert!(dir.path().join("workspace/photos/Made by Mobius/Kite.png").is_file());
    let (line, body) = seen.lock().unwrap().iter().find(|(l, _)| l.contains("/images/generations")).cloned().unwrap();
    assert!(line.starts_with("POST /v1/images/generations"), "{line}");
    let sent: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(sent["model"], "gpt-image-1");
    assert_eq!(sent["size"], "1536x1024");
    assert!(sent.get("response_format").is_none());
    assert!(events.lock().unwrap().iter().any(|(n, v)| n == "mobius:photos-changed" && v["by"] == "assistant"));
    // A second picture of the same name is kept beside the first.
    tool(json!({ "prompt": "Another kite", "name": "Kite" })).unwrap();
    assert!(dir.path().join("workspace/photos/Made by Mobius/Kite 2.png").is_file());
}

/// A new install starts with the everyday apps; one that was in use before Abilities keeps every app.
#[test]
fn a_new_install_starts_with_the_everyday_apps_and_an_old_one_keeps_them_all() {
    let (b, _core, _events, _dir) = bridge_in(tempfile::tempdir().unwrap());
    assert_eq!(call(&b, "preferences", "get", json!([]))["installedApps"], json!(["notes", "tasks", "calendar", "mail", "docs", "browser"]));
    let old = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(old.path().join("workspace/notes")).unwrap();
    let (b, _core, _events, _old) = bridge_in(old);
    assert_eq!(call(&b, "preferences", "get", json!([]))["installedApps"], serde_json::Value::Null);
    assert_eq!(call(&b, "preferences", "set", json!([{ "installedApps": ["notes", "photo"] }]))["installedApps"], json!(["notes", "photo"]));
    assert_eq!(call(&b, "preferences", "set", json!([{ "installedApps": ["Bad App"] }]))["installedApps"], json!(["notes", "photo"]));
}

#[test]
fn a_model_calls_tokens_are_counted_for_settings_usage_and_the_window_is_told() {
    let (b, _core, events, dir) = bridge_in(tempfile::tempdir().unwrap());
    let used = json!({ "conversation": "c-1", "turn": 1, "kind": "chat", "model": "qwen3:8b", "endpoint": "http://127.0.0.1:11434/v1", "input": 300, "output": 20, "cached": 0 });
    b.on_core_notification("agent.usage", &used);
    b.on_core_notification("agent.usage", &used);
    b.on_core_notification("agent.usage", &json!({ "conversation": "c-1", "turn": 1, "kind": "nonsense", "model": "m", "endpoint": "", "input": 1, "output": 1, "cached": 0 }));
    // Not passed on as conversation progress.
    assert_eq!(events.lock().unwrap().iter().filter(|(n, _)| n == "mobius:agent-notification").count(), 0);
    assert!(events.lock().unwrap().iter().any(|(n, _)| n == "mobius:usage-changed"));
    let rows = call(&b, "usage", "query", json!([{ "from": "2000-01-01", "to": "2999-12-31" }]));
    assert_eq!(rows, json!([{ "day": rows[0]["day"], "gateway": "ollama", "model": "qwen3:8b", "app": "agent", "kind": "chat", "requests": 2, "inputTokens": 600, "outputTokens": 40, "costUsd": 0.0 }]));
    assert!(dir.path().join("usage.json").exists());
    assert_eq!(call(&b, "usage", "query", json!([{ "from": "yesterday", "to": "today" }]))["ok"], false);
    call(&b, "usage", "clear", json!([]));
    assert_eq!(call(&b, "usage", "query", json!([{ "from": "2000-01-01", "to": "2999-12-31" }])), json!([]));
}
