#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
use std::sync::Arc;
use std::sync::atomic::{AtomicI64, Ordering};

use mobius_store::bookmarks::{Bookmarks, MAX_BOOKMARKS};
use mobius_store::bots::{self, Bots, MAIN_ID, MAX_BOTS, bot_of_conversation};
use mobius_store::history::{History, MAX_ENTRIES};
use mobius_store::{appearance, keys, preferences};
use serde_json::{Value, json};

fn clock() -> (Arc<AtomicI64>, Box<dyn Fn() -> i64 + Send>) {
    let t = Arc::new(AtomicI64::new(1000));
    let c = t.clone();
    (t, Box::new(move || c.fetch_add(1, Ordering::SeqCst)))
}

// ---- settings ----

#[test]
fn appearance_starts_with_defaults_and_keeps_valid_changes_across_a_restart() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("a.json");
    let mut a = appearance::open(file.clone());
    assert_eq!(a.get(), appearance::defaults());
    assert!(a.set(&json!({ "theme": "dark", "leftWidth": 300 })));
    assert_eq!(appearance::open(file).get()["theme"], "dark");
}

#[test]
fn appearance_refuses_every_bad_value_whole_and_changes_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let mut a = appearance::open(dir.path().join("a.json"));
    for bad in [
        json!({ "theme": "purple" }), json!({ "zoom": 0.74 }), json!({ "zoom": 1.51 }), json!({ "zoom": "1" }), json!({ "zoom": null }),
        json!({ "chatTextScale": 0.84 }), json!({ "chatTextScale": 1.41 }), json!({ "leftWidth": 199 }), json!({ "leftWidth": 421 }),
        json!({ "rightWidth": 299 }), json!({ "rightWidth": 641 }), json!({ "rightWidth": "400" }), json!({ "leftSidebar": "hidden" }),
        json!({ "sidebarAtStart": "yes" }), json!({ "density": 1 }), json!([1]), json!("x"), json!(null), json!({}), json!({ "unknown": 1 }),
        json!({ "theme": "dark", "zoom": 9 }),
    ] {
        assert!(!a.set(&bad), "{bad}");
    }
    assert_eq!(a.get(), appearance::defaults(), "nothing leaked through a refused change");
    for good in [json!({ "zoom": 0.75 }), json!({ "zoom": 1.5 }), json!({ "leftWidth": 200 }), json!({ "leftWidth": 420 }), json!({ "rightWidth": 300 }), json!({ "rightWidth": 640 })] {
        assert!(a.set(&good), "{good}");
    }
}

#[test]
fn a_damaged_or_hostile_settings_file_falls_back_one_field_at_a_time() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("a.json");
    std::fs::write(&file, "not json").unwrap();
    assert_eq!(appearance::open(file.clone()).get(), appearance::defaults());
    std::fs::write(&file, json!({ "theme": "dark", "zoom": 99, "leftWidth": "x", "density": "compact", "extra": 1 }).to_string()).unwrap();
    let got = appearance::open(file).get();
    assert_eq!((got["theme"].as_str(), got["zoom"].as_f64(), got["density"].as_str(), got["leftWidth"].as_f64()), (Some("dark"), Some(1.0), Some("compact"), Some(248.0)));
    assert!(got.get("extra").is_none());
}

#[test]
fn preferences_check_each_choice() {
    let dir = tempfile::tempdir().unwrap();
    let mut p = preferences::open(dir.path().join("p.json"));
    assert_eq!(p.get()["approvalMode"], "manual");
    assert_eq!(p.get()["dictationModel"], "whisper-1");
    for bad in [
        json!({ "approvalMode": "yolo" }), json!({ "localContext": 1234 }), json!({ "localContext": 16384.5 }), json!({ "reasoningEffort": "extreme" }),
        json!({ "dictationModel": "" }), json!({ "dictationModel": "a\nb" }), json!({ "dictationModel": "x".repeat(201) }), json!({ "keepAwake": 1 }),
        json!({ "keybindings": { "launcher": "mod+k" } }),
    ] {
        assert!(!p.set(&bad), "{bad}");
    }
    for good in [json!({ "approvalMode": "smart" }), json!({ "localContext": 65536 }), json!({ "reasoningEffort": "high" }), json!({ "reasoningEffort": "" }), json!({ "dictationModel": "x".repeat(200) })] {
        assert!(p.set(&good), "{good}");
    }
}

#[test]
fn keybindings_need_every_action_valid_and_no_two_alike() {
    let b = keys::defaults();
    assert!(keys::is_key_bindings(&b));
    let with = |action: &str, value: Value| { let mut c = b.clone(); c[action] = value; c };
    assert!(keys::is_key_bindings(&with("quickEntry", json!("mod+shift+space"))));
    assert!(keys::is_key_bindings(&with("find", json!("f3"))));
    assert!(keys::is_key_bindings(&with("find", json!(""))));
    for bad in [
        with("find", json!("k")), with("find", json!("mod+c")), with("find", json!("mod+k")), with("find", json!("shift+mod+f")), with("find", json!("mod+mod+f")),
        with("find", json!("mod+f13")), with("find", json!("mod+f0")), with("find", json!("mod+F")), with("find", json!(5)), with("find", json!("mod+")),
        with("find", json!("x".repeat(41))), json!(null), json!([]), json!({}),
    ] {
        assert!(!keys::is_key_bindings(&bad), "{bad}");
    }
    assert!(keys::is_key_bindings(&with("find", json!("mod+alt+c"))), "alt makes it not an editing key");
    let mut extra = b.clone();
    extra.as_object_mut().unwrap().insert("extra".into(), json!(""));
    assert!(!keys::is_key_bindings(&extra), "an extra action");
}

// ---- history and bookmarks ----

#[test]
fn history_keeps_only_web_pages_newest_first_and_one_row_per_address() {
    let dir = tempfile::tempdir().unwrap();
    let (_, c) = clock();
    let mut h = History::open(dir.path().join("h.json"), c);
    h.visit("https://a.example/", "A");
    h.visit("https://b.example/", "  ");
    h.visit("https://a.example/", "A again");
    for bad in ["file:///c:/x", "javascript:alert(1)", "data:text/html,x", "chrome://settings", "not a url", ""] {
        h.visit(bad, "x");
    }
    h.visit(&format!("https://long.example/{}", "x".repeat(2100)), "long");
    let urls: Vec<_> = h.list(10).into_iter().map(|e| (e.url, e.title)).collect();
    assert_eq!(urls, vec![("https://a.example/".into(), "A again".into()), ("https://b.example/".into(), "https://b.example/".into())]);
}

#[test]
fn history_search_remove_clear_pause_and_restart() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("h.json");
    let (_, c) = clock();
    let mut h = History::open(file.clone(), c);
    h.visit("https://rust-lang.org/", "Rust language");
    h.visit("https://example.com/cats", "Cats");
    assert_eq!(h.search("RUST lang", 10).len(), 1);
    assert_eq!(h.search("cats example", 10).len(), 1);
    assert_eq!(h.search("rust cats", 10).len(), 0);
    h.set_enabled(false);
    h.visit("https://paused.example/", "p");
    assert_eq!(h.list(10).len(), 2);
    let (_, c) = clock();
    let mut again = History::open(file, c);
    assert!(!again.enabled(), "paused state is remembered");
    assert_eq!(again.list(10).len(), 2);
    again.remove("https://example.com/cats");
    assert_eq!(again.list(10).len(), 1);
    again.clear();
    assert!(again.list(10).is_empty());
}

#[test]
fn history_is_limited_and_reads_a_hostile_file_safely() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("h.json");
    let (_, c) = clock();
    let mut h = History::open(file.clone(), c);
    for i in 0..(MAX_ENTRIES + 5) {
        h.visit(&format!("https://e.example/{i}"), "t");
    }
    assert_eq!(h.list(usize::MAX).len(), MAX_ENTRIES);
    assert_eq!(h.list(1)[0].url, format!("https://e.example/{}", MAX_ENTRIES + 4), "oldest dropped, newest first");
    std::fs::write(&file, json!({ "enabled": "yes", "entries": [
        { "url": "https://ok.example/", "title": "ok", "visited": 5 }, { "url": "file:///x", "title": "bad", "visited": 6 },
        { "url": "https://n.example/", "title": 3, "visited": 6 }, { "url": "https://v.example/", "title": "v" }, 5, null,
        { "url": "https://newer.example/", "title": "t".repeat(500), "visited": 9 } ] }).to_string()).unwrap();
    let (_, c) = clock();
    let h = History::open(file, c);
    assert!(h.enabled());
    let got = h.list(10);
    assert_eq!(got.iter().map(|e| e.url.as_str()).collect::<Vec<_>>(), vec!["https://newer.example/", "https://ok.example/"]);
    assert_eq!(got[0].title.chars().count(), 200);
}

#[test]
fn bookmarks_toggle_search_limit_and_restart() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("b.json");
    let (_, c) = clock();
    let mut b = Bookmarks::open(file.clone(), c);
    assert!(b.toggle("https://a.example/", "A"));
    assert!(b.has("https://a.example/"));
    assert!(!b.toggle("https://a.example/", "A"));
    assert!(!b.has("https://a.example/"));
    assert!(!b.add("file:///x", "x"));
    assert!(b.add("https://a.example/", "First"));
    assert!(b.add("https://a.example/", "Renamed"));
    assert_eq!(b.list(10).len(), 1);
    assert_eq!(b.list(10)[0].title, "Renamed");
    assert_eq!(b.search("renamed", 10).len(), 1);
    let (_, c) = clock();
    assert_eq!(Bookmarks::open(file, c).list(10)[0].title, "Renamed");
    for i in 0..MAX_BOOKMARKS {
        let _ = b.add(&format!("https://x.example/{i}"), "t");
    }
    assert_eq!(b.list(usize::MAX).len(), MAX_BOOKMARKS);
    assert!(!b.add("https://over.example/", "no room"), "nothing is dropped to make room");
    assert!(b.add("https://a.example/", "existing still editable"));
}

// ---- bots ----

fn draft(name: &str) -> Value {
    json!({ "name": name, "instructions": "", "model": "" })
}

#[test]
fn bots_start_with_mobius_and_survive_a_restart() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("bots.json");
    let (_, c) = clock();
    let mut b = Bots::open(file.clone(), c);
    assert_eq!(b.all().len(), 1);
    assert_eq!(b.all()[0].id, MAIN_ID);
    let made = b.create(&json!({ "name": "  Researcher ", "instructions": " Cite. ", "model": " big " })).unwrap();
    assert_eq!((made.name.as_str(), made.instructions.as_str(), made.model.as_str()), ("Researcher", "Cite.", "big"));
    assert!(bots::is_bot_id(&made.id) && made.id != MAIN_ID);
    b.update(&made.id, &json!({ "name": "Reader", "instructions": "Short.", "model": "" })).unwrap();
    let (_, c) = clock();
    let again = Bots::open(file, c);
    assert_eq!(again.get(&made.id).unwrap().name, "Reader");
}

#[test]
fn mobius_cannot_be_changed_removed_moved_or_copied() {
    let dir = tempfile::tempdir().unwrap();
    let (_, c) = clock();
    let mut b = Bots::open(dir.path().join("bots.json"), c);
    assert!(b.update(MAIN_ID, &draft("Other")).is_err());
    assert!(b.remove(MAIN_ID).is_err());
    assert!(b.move_bot(MAIN_ID, "down").is_err());
    assert_eq!(b.create(&draft("mobius")).unwrap_err(), "There is already a bot called \"mobius\".");
}

#[test]
fn bot_names_are_unique_in_any_case_and_the_count_is_limited() {
    let dir = tempfile::tempdir().unwrap();
    let (_, c) = clock();
    let mut b = Bots::open(dir.path().join("bots.json"), c);
    b.create(&draft("Writer")).unwrap();
    assert!(b.create(&draft("writer")).is_err());
    let editor = b.create(&draft("Editor")).unwrap();
    assert!(b.update(&editor.id, &draft("WRITER")).is_err());
    assert!(b.update(&editor.id, &draft("Editor")).is_ok());
    for i in 0..(MAX_BOTS - 3) {
        b.create(&draft(&format!("Bot {i}"))).unwrap();
    }
    assert_eq!(b.all().len(), MAX_BOTS);
    assert!(b.create(&draft("One too many")).is_err());
}

#[test]
fn a_bot_draft_must_be_acceptable() {
    let dir = tempfile::tempdir().unwrap();
    let (_, c) = clock();
    let mut b = Bots::open(dir.path().join("bots.json"), c);
    for bad in [
        draft(""), draft("   "), draft(&"x".repeat(41)), draft("a\nb"), draft("a\u{0}b"), json!({ "name": "n", "instructions": "x".repeat(4001), "model": "" }),
        json!({ "name": "n", "instructions": "a\u{0}b", "model": "" }), json!({ "name": "n", "instructions": "", "model": "x".repeat(201) }),
        json!({ "name": "n", "instructions": "", "model": "a\nb" }), json!({ "name": "n" }), json!(null), json!("x"), json!({ "name": 3, "instructions": "", "model": "" }),
    ] {
        assert!(b.create(&bad).is_err(), "{bad}");
    }
    assert!(b.create(&json!({ "name": "x".repeat(40), "instructions": "line one\nline two", "model": "" })).is_ok());
    assert!(b.create(&json!({ "name": "long", "instructions": "x".repeat(4000), "model": "" })).is_ok());
    assert!(b.update("abc123", &draft("x")).is_err());
    assert!(b.remove("abc123").is_err());
}

#[test]
fn bots_can_be_moved_among_the_others_and_the_order_is_kept() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("bots.json");
    let (_, c) = clock();
    let mut b = Bots::open(file.clone(), c);
    let ids: Vec<String> = ["A", "B", "C"].iter().map(|n| b.create(&draft(n)).unwrap().id).collect();
    let names = |b: &Bots| b.all().iter().map(|x| x.name.clone()).collect::<Vec<_>>().join(",");
    b.move_bot(&ids[2], "up").unwrap();
    assert_eq!(names(&b), "Mobius,A,C,B");
    b.move_bot(&ids[0], "up").unwrap();
    assert_eq!(names(&b), "Mobius,A,C,B", "never above Mobius");
    b.move_bot(&ids[1], "down").unwrap();
    assert_eq!(names(&b), "Mobius,A,C,B", "the last cannot go lower");
    b.move_bot(&ids[0], "down").unwrap();
    assert_eq!(names(&b), "Mobius,C,A,B");
    assert!(b.move_bot(&ids[0], "sideways").is_err());
    assert!(b.move_bot("zzzzzz", "up").is_err());
    let (_, c) = clock();
    assert_eq!(names(&Bots::open(file, c)), "Mobius,C,A,B");
}

#[test]
fn a_hostile_bots_file_is_read_safely() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("bots.json");
    std::fs::write(&file, "not json").unwrap();
    let (_, c) = clock();
    assert_eq!(Bots::open(file.clone(), c).all().len(), 1);
    std::fs::write(&file, json!({ "bots": [
        { "id": "abc123", "name": "Good", "instructions": "", "model": "" }, { "id": "abc123", "name": "Dup id", "instructions": "", "model": "" },
        { "id": "bad", "name": "Bad id", "instructions": "", "model": "" }, { "id": "def456", "name": "good", "instructions": "", "model": "" },
        { "id": "main", "name": "Fake main", "instructions": "", "model": "" }, { "id": "ghi789", "name": "", "instructions": "", "model": "" }, null, 5 ] }).to_string()).unwrap();
    let (_, c) = clock();
    let b = Bots::open(file, c);
    assert_eq!(b.all().iter().map(|x| x.name.as_str()).collect::<Vec<_>>(), vec!["Mobius", "Good"]);
}

#[test]
fn conversations_belong_to_the_bot_in_their_name() {
    let known = ["main", "abc123", "def456"];
    let of = |c: &str| bot_of_conversation(c, known.iter().copied());
    assert_eq!(of("c-abc123-5f2a1c4e-0000-4000-8000-000000000000"), "abc123");
    assert_eq!(of("c-def456-x"), "def456");
    assert_eq!(of("c-5f2a1c4e-0000-4000-8000-000000000000"), "main");
    assert_eq!(of("c-zzz999-x"), "main", "a bot that was deleted");
    assert_eq!(of("c-abc123"), "main", "no trailing hyphen");
    assert_eq!(of("main"), "main");
    assert_eq!(of(""), "main");
    assert_eq!(of("c-é"), "main", "no panic on non-ASCII");
    assert_eq!(of("c-ééé-x"), "main");
}
