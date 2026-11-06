//! Where conversations are kept between runs.
use std::collections::HashMap;
use std::path::Path;
use std::time::Duration;

use rusqlite::{Connection, params};

use crate::message::Message;

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("conversation storage failed: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("conversation storage could not encode the messages")]
    Encode,
    #[error("conversation storage version {0} is not supported by this build")]
    UnsupportedVersion(i64),
    #[error("that is not a valid conversation id")]
    InvalidId,
}

/// A conversation id is short and plain, so it can safely appear in a file, a log line or a message.
pub fn valid_conversation_id(id: &str) -> bool {
    (1..=64).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

#[derive(Debug, Clone, PartialEq)]
pub struct SavedConversation {
    pub id: String,
    pub messages: Vec<Message>,
    pub updated_ms: u64,
}

/// Conversations are saved whole, each time a turn finishes.
pub trait ConversationStore: Send {
    /// The most recently updated conversations first, at most `limit` of them. Rows that cannot be read are skipped.
    fn load_all(&self, limit: usize) -> Result<Vec<SavedConversation>, StoreError>;
    fn save(&mut self, id: &str, messages: &[Message], updated_ms: u64) -> Result<(), StoreError>;
    fn delete(&mut self, id: &str) -> Result<(), StoreError>;
}

#[derive(Default)]
pub struct MemoryStore {
    rows: HashMap<String, (Vec<Message>, u64)>,
}

impl ConversationStore for MemoryStore {
    fn load_all(&self, limit: usize) -> Result<Vec<SavedConversation>, StoreError> {
        let mut all: Vec<SavedConversation> = self.rows.iter().map(|(id, (messages, updated_ms))| SavedConversation { id: id.clone(), messages: messages.clone(), updated_ms: *updated_ms }).collect();
        all.sort_by(|a, b| b.updated_ms.cmp(&a.updated_ms).then_with(|| a.id.cmp(&b.id)));
        all.truncate(limit);
        Ok(all)
    }

    fn save(&mut self, id: &str, messages: &[Message], updated_ms: u64) -> Result<(), StoreError> {
        if !valid_conversation_id(id) {
            return Err(StoreError::InvalidId);
        }
        self.rows.insert(id.to_owned(), (messages.to_vec(), updated_ms));
        Ok(())
    }

    fn delete(&mut self, id: &str) -> Result<(), StoreError> {
        self.rows.remove(id);
        Ok(())
    }
}

const SCHEMA_VERSION: i64 = 1;

pub struct SqliteStore {
    conn: Connection,
}

impl SqliteStore {
    pub fn open(path: &Path) -> Result<Self, StoreError> {
        Self::init(Connection::open(path)?)
    }

    pub fn open_in_memory() -> Result<Self, StoreError> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(conn: Connection) -> Result<Self, StoreError> {
        conn.busy_timeout(Duration::from_secs(5))?;
        let version: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
        if version > SCHEMA_VERSION {
            return Err(StoreError::UnsupportedVersion(version));
        }
        if version == 0 {
            conn.execute_batch(
                "CREATE TABLE IF NOT EXISTS conversations (
                   id TEXT PRIMARY KEY,
                   messages TEXT NOT NULL,
                   updated_ms INTEGER NOT NULL
                 );
                 CREATE INDEX IF NOT EXISTS conversations_updated ON conversations (updated_ms DESC);",
            )?;
            conn.pragma_update(None, "user_version", SCHEMA_VERSION)?;
        }
        Ok(SqliteStore { conn })
    }
}

impl ConversationStore for SqliteStore {
    fn load_all(&self, limit: usize) -> Result<Vec<SavedConversation>, StoreError> {
        let mut statement = self.conn.prepare("SELECT id, messages, updated_ms FROM conversations ORDER BY updated_ms DESC, id")?;
        let mut rows = statement.query([])?;
        let mut found = Vec::new();
        while let Some(row) = rows.next()? {
            if found.len() >= limit {
                break;
            }
            let id: String = row.get(0)?;
            let json: String = row.get(1)?;
            let updated: i64 = row.get(2)?;
            let Ok(messages) = serde_json::from_str::<Vec<Message>>(&json) else {
                eprintln!("mobius: skipping a saved conversation that cannot be read");
                continue;
            };
            if !valid_conversation_id(&id) {
                eprintln!("mobius: skipping a saved conversation with an invalid id");
                continue;
            }
            found.push(SavedConversation { id, messages, updated_ms: u64::try_from(updated).unwrap_or(0) });
        }
        Ok(found)
    }

    fn save(&mut self, id: &str, messages: &[Message], updated_ms: u64) -> Result<(), StoreError> {
        if !valid_conversation_id(id) {
            return Err(StoreError::InvalidId);
        }
        let json = serde_json::to_string(messages).map_err(|_| StoreError::Encode)?;
        self.conn.execute(
            "INSERT INTO conversations (id, messages, updated_ms) VALUES (?1, ?2, ?3)
             ON CONFLICT(id) DO UPDATE SET messages = excluded.messages, updated_ms = excluded.updated_ms",
            params![id, json, i64::try_from(updated_ms).unwrap_or(i64::MAX)],
        )?;
        Ok(())
    }

    fn delete(&mut self, id: &str) -> Result<(), StoreError> {
        self.conn.execute("DELETE FROM conversations WHERE id = ?1", params![id])?;
        Ok(())
    }
}
