//! SQLite persistence: the append-only event log and the standing (always) grants.
use std::path::Path;
use std::time::Duration as StdDuration;

use rusqlite::{Connection, OptionalExtension, params};
use serde_json::Value;

use crate::model::{Capability, Duration, Effect, Event, Grant, Principal, PrincipalKind};

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("database error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("database schema version {0} is not supported by this build")]
    UnsupportedVersion(i64),
    #[error("stored data is invalid: {0}")]
    Corrupt(&'static str),
}

const SCHEMA_VERSION: i64 = 1;

const SCHEMA: &str = "
CREATE TABLE events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  ts_ms INTEGER NOT NULL,
  kind TEXT NOT NULL,
  principal_kind TEXT,
  principal_id TEXT,
  capability TEXT,
  resource TEXT,
  detail TEXT NOT NULL
);
CREATE TRIGGER events_no_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;
CREATE TRIGGER events_no_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;
CREATE TABLE grants (
  id INTEGER PRIMARY KEY,
  principal_kind TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  capability TEXT NOT NULL,
  resource TEXT,
  effect TEXT NOT NULL,
  created_ms INTEGER NOT NULL
);
";

pub struct NewEvent<'a> {
    pub ts_ms: u64,
    pub kind: &'a str,
    pub principal: Option<&'a Principal>,
    pub capability: Option<&'a str>,
    pub resource: Option<&'a str>,
    pub detail: &'a Value,
}

pub struct Store {
    conn: Connection,
}

fn kind_str(kind: PrincipalKind) -> &'static str {
    match kind {
        PrincipalKind::Person => "person",
        PrincipalKind::Agent => "agent",
        PrincipalKind::McpServer => "mcp_server",
        PrincipalKind::Plugin => "plugin",
    }
}

fn parse_kind(text: &str) -> Result<PrincipalKind, StoreError> {
    Ok(match text {
        "person" => PrincipalKind::Person,
        "agent" => PrincipalKind::Agent,
        "mcp_server" => PrincipalKind::McpServer,
        "plugin" => PrincipalKind::Plugin,
        _ => return Err(StoreError::Corrupt("principal kind")),
    })
}

impl Store {
    pub fn open(path: &Path) -> Result<Self, StoreError> {
        let conn = Connection::open(path)?;
        // The journal mode statement returns a row, so it must be read as a query.
        conn.query_row("PRAGMA journal_mode=WAL", [], |row| row.get::<_, String>(0))?;
        Self::init(conn)
    }

    pub fn open_in_memory() -> Result<Self, StoreError> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(conn: Connection) -> Result<Self, StoreError> {
        conn.busy_timeout(StdDuration::from_secs(5))?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        let version: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
        match version {
            0 => {
                conn.execute_batch(SCHEMA)?;
                conn.pragma_update(None, "user_version", SCHEMA_VERSION)?;
            }
            SCHEMA_VERSION => {}
            other => return Err(StoreError::UnsupportedVersion(other)),
        }
        Ok(Store { conn })
    }

    pub fn append_event(&self, event: &NewEvent<'_>) -> Result<u64, StoreError> {
        self.conn.execute(
            "INSERT INTO events (ts_ms, kind, principal_kind, principal_id, capability, resource, detail)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                event.ts_ms as i64,
                event.kind,
                event.principal.map(|p| kind_str(p.kind)),
                event.principal.map(|p| p.id.as_str()),
                event.capability,
                event.resource,
                event.detail.to_string(),
            ],
        )?;
        Ok(self.conn.last_insert_rowid() as u64)
    }

    pub fn events(&self, after_seq: u64, limit: u32) -> Result<Vec<Event>, StoreError> {
        self.read_events(
            "SELECT seq, ts_ms, kind, principal_kind, principal_id, capability, resource, detail
             FROM events WHERE seq > ?1 ORDER BY seq ASC LIMIT ?2",
            after_seq as i64,
            limit,
        )
    }

    /// The most recent events, newest first.
    pub fn events_newest(&self, limit: u32) -> Result<Vec<Event>, StoreError> {
        self.read_events(
            "SELECT seq, ts_ms, kind, principal_kind, principal_id, capability, resource, detail
             FROM events WHERE seq > ?1 ORDER BY seq DESC LIMIT ?2",
            0,
            limit,
        )
    }

    fn read_events(&self, sql: &str, after_seq: i64, limit: u32) -> Result<Vec<Event>, StoreError> {
        let mut statement = self.conn.prepare(sql)?;
        let rows = statement.query_map(params![after_seq, limit], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, String>(7)?,
            ))
        })?;
        let mut events = Vec::new();
        for row in rows {
            let (seq, ts_ms, kind, principal_kind, principal_id, capability, resource, detail) = row?;
            let principal = match (principal_kind, principal_id) {
                (Some(kind), Some(id)) => Some(Principal { kind: parse_kind(&kind)?, id }),
                _ => None,
            };
            events.push(Event {
                seq: seq as u64,
                ts_ms: ts_ms as u64,
                kind,
                principal,
                capability,
                resource,
                detail: serde_json::from_str(&detail).map_err(|_| StoreError::Corrupt("event detail"))?,
            });
        }
        Ok(events)
    }

    pub fn insert_grant(&self, grant: &Grant) -> Result<(), StoreError> {
        self.conn.execute(
            "INSERT INTO grants (id, principal_kind, principal_id, capability, resource, effect, created_ms)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                grant.id as i64,
                kind_str(grant.principal.kind),
                grant.principal.id,
                grant.capability.as_str(),
                grant.resource,
                match grant.effect {
                    Effect::Allow => "allow",
                    Effect::Deny => "deny",
                },
                grant.created_ms as i64,
            ],
        )?;
        Ok(())
    }

    pub fn delete_grant(&self, id: u64) -> Result<bool, StoreError> {
        Ok(self.conn.execute("DELETE FROM grants WHERE id = ?1", params![id as i64])? > 0)
    }

    pub fn load_grants(&self) -> Result<Vec<Grant>, StoreError> {
        let mut statement = self.conn.prepare(
            "SELECT id, principal_kind, principal_id, capability, resource, effect, created_ms FROM grants ORDER BY id",
        )?;
        let rows = statement.query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, i64>(6)?,
            ))
        })?;
        let mut grants = Vec::new();
        for row in rows {
            let (id, kind, principal_id, capability, resource, effect, created_ms) = row?;
            grants.push(Grant {
                id: id as u64,
                principal: Principal { kind: parse_kind(&kind)?, id: principal_id },
                capability: Capability::new(&capability).map_err(|_| StoreError::Corrupt("capability"))?,
                resource,
                effect: match effect.as_str() {
                    "allow" => Effect::Allow,
                    "deny" => Effect::Deny,
                    _ => return Err(StoreError::Corrupt("effect")),
                },
                duration: Duration::Always,
                created_ms: created_ms as u64,
                expires_ms: None,
            });
        }
        Ok(grants)
    }

    pub fn max_grant_id(&self) -> Result<u64, StoreError> {
        let max: Option<i64> = self.conn.query_row("SELECT MAX(id) FROM grants", [], |row| row.get(0)).optional()?.flatten();
        Ok(max.unwrap_or(0) as u64)
    }

    #[cfg(test)]
    pub fn raw(&self) -> &Connection {
        &self.conn
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn the_event_log_cannot_be_edited_or_deleted() {
        let store = Store::open_in_memory().unwrap();
        let detail = json!({});
        store.append_event(&NewEvent { ts_ms: 1, kind: "test", principal: None, capability: None, resource: None, detail: &detail }).unwrap();
        assert!(store.raw().execute("UPDATE events SET kind = 'forged'", []).is_err());
        assert!(store.raw().execute("DELETE FROM events", []).is_err());
        assert_eq!(store.events(0, 10).unwrap()[0].kind, "test");
    }

    #[test]
    fn a_database_from_a_newer_build_is_refused_not_misread() {
        let dir = std::env::temp_dir().join(format!("mobius-store-version-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("core.db");
        {
            let store = Store::open(&path).unwrap();
            store.raw().pragma_update(None, "user_version", 99).unwrap();
        }
        assert!(matches!(Store::open(&path), Err(StoreError::UnsupportedVersion(99))));
        std::fs::remove_dir_all(&dir).ok();
    }
}
