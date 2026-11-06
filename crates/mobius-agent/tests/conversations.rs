#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
//! Saving and loading conversations, in memory and in SQLite.
use mobius_agent::conversations::{ConversationStore, MemoryStore, SqliteStore};
use mobius_agent::message::{Message, ToolCall};
use serde_json::json;

fn sample() -> Vec<Message> {
    vec![
        Message::User { text: "open the page \u{1F600}".into() },
        Message::Assistant { text: "On it.".into(), tool_calls: vec![ToolCall { id: "c1".into(), name: "browser.open".into(), arguments: json!({ "url": "https://example.com" }) }] },
        Message::Tool { call_id: "c1".into(), name: "browser.open".into(), content: "{\"ok\":true}".into(), is_error: false },
        Message::Assistant { text: "Done.".into(), tool_calls: vec![] },
    ]
}

fn behaves_like_a_store(store: &mut dyn ConversationStore) {
    assert!(store.load_all(10).unwrap().is_empty());
    store.save("a", &sample(), 100).unwrap();
    store.save("b", &sample()[..1], 300).unwrap();
    store.save("c", &sample()[..2], 200).unwrap();

    let all = store.load_all(10).unwrap();
    assert_eq!(all.iter().map(|c| (c.id.as_str(), c.updated_ms)).collect::<Vec<_>>(), [("b", 300), ("c", 200), ("a", 100)], "newest first");
    assert_eq!(all[2].messages, sample(), "everything survives, including tool calls and unicode");
    assert_eq!(store.load_all(2).unwrap().len(), 2, "the limit keeps the newest");
    assert_eq!(store.load_all(2).unwrap()[1].id, "c");

    store.save("a", &sample()[..3], 400).unwrap();
    let all = store.load_all(10).unwrap();
    assert_eq!((all[0].id.as_str(), all[0].messages.len(), all.len()), ("a", 3, 3), "saving again replaces");

    store.delete("a").unwrap();
    store.delete("never-existed").unwrap();
    assert_eq!(store.load_all(10).unwrap().iter().map(|c| c.id.as_str()).collect::<Vec<_>>(), ["b", "c"]);
}

#[test]
fn the_memory_store_behaves_like_a_store() {
    behaves_like_a_store(&mut MemoryStore::default());
}

#[test]
fn the_sqlite_store_behaves_like_a_store() {
    behaves_like_a_store(&mut SqliteStore::open_in_memory().unwrap());
}

#[test]
fn conversations_survive_closing_and_reopening_the_file() {
    let dir = std::env::temp_dir().join(format!("mobius-conv-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("conversations.db");
    {
        let mut store = SqliteStore::open(&path).unwrap();
        store.save("kept", &sample(), 42).unwrap();
    }
    let store = SqliteStore::open(&path).unwrap();
    let all = store.load_all(10).unwrap();
    assert_eq!((all[0].id.as_str(), all[0].messages.clone(), all[0].updated_ms), ("kept", sample(), 42));
    drop(store);
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn unreadable_rows_are_skipped_not_fatal() {
    let dir = std::env::temp_dir().join(format!("mobius-conv-bad-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("conversations.db");
    {
        let mut store = SqliteStore::open(&path).unwrap();
        store.save("good", &sample(), 10).unwrap();
    }
    {
        let conn = rusqlite::Connection::open(&path).unwrap();
        conn.execute("INSERT INTO conversations (id, messages, updated_ms) VALUES ('broken', 'not json', 20)", []).unwrap();
        conn.execute("INSERT INTO conversations (id, messages, updated_ms) VALUES ('../bad id', '[]', 30)", []).unwrap();
        conn.execute("INSERT INTO conversations (id, messages, updated_ms) VALUES ('wrong-shape', '{\"x\":1}', 40)", []).unwrap();
    }
    let store = SqliteStore::open(&path).unwrap();
    assert_eq!(store.load_all(10).unwrap().iter().map(|c| c.id.as_str()).collect::<Vec<_>>(), ["good"]);
    drop(store);
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn a_database_from_a_newer_version_is_refused() {
    let dir = std::env::temp_dir().join(format!("mobius-conv-new-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("conversations.db");
    drop(SqliteStore::open(&path).unwrap());
    rusqlite::Connection::open(&path).unwrap().pragma_update(None, "user_version", 99).unwrap();
    assert!(SqliteStore::open(&path).is_err(), "never write into a format this build does not know");
    std::fs::remove_dir_all(&dir).ok();
}
