//! Which conversations have been put away. They are kept, and hidden from the main list until brought back.
use std::path::PathBuf;

use serde_json::{Value, json};

use crate::file::{read_json, write_json};

/// More than anyone puts away; a bound so the file cannot grow without end.
pub const MAX_ARCHIVED: usize = 2000;

pub struct Archive {
    file: PathBuf,
    ids: Vec<String>,
}

impl Archive {
    pub fn open(file: PathBuf) -> Archive {
        let ids = read_json(&file)
            .and_then(|v| v.get("archived").and_then(Value::as_array).map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_owned)).collect::<Vec<_>>()))
            .unwrap_or_default();
        let mut archive = Archive { file, ids: Vec::new() };
        for id in ids {
            archive.insert(id);
        }
        archive
    }

    fn insert(&mut self, id: String) {
        if self.ids.len() < MAX_ARCHIVED && !self.ids.contains(&id) {
            self.ids.push(id);
        }
    }

    fn save(&self) {
        write_json(&self.file, &json!({ "archived": self.ids }));
    }

    /// Puts a conversation away or brings it back. Returns whether anything changed.
    pub fn set(&mut self, id: &str, archived: bool) -> bool {
        let changed = if archived {
            let before = self.ids.len();
            self.insert(id.to_owned());
            self.ids.len() != before
        } else {
            let before = self.ids.len();
            self.ids.retain(|x| x != id);
            self.ids.len() != before
        };
        if changed {
            self.save();
        }
        changed
    }

    pub fn list(&self) -> Vec<String> {
        self.ids.clone()
    }

    /// A conversation that no longer exists needs no place here.
    pub fn forget(&mut self, id: &str) {
        self.set(id, false);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn putting_away_and_bringing_back_is_remembered_across_restarts() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("archive.json");
        let mut a = Archive::open(file.clone());
        assert!(a.set("c-main-a", true));
        assert!(!a.set("c-main-a", true), "already put away");
        assert!(a.set("c-main-b", true));
        assert_eq!(Archive::open(file.clone()).list(), vec!["c-main-a", "c-main-b"]);
        assert!(a.set("c-main-a", false));
        assert!(!a.set("c-main-a", false));
        assert_eq!(Archive::open(file).list(), vec!["c-main-b"]);
    }

    #[test]
    fn a_deleted_conversation_is_forgotten() {
        let dir = tempfile::tempdir().unwrap();
        let mut a = Archive::open(dir.path().join("a.json"));
        a.set("c-main-a", true);
        a.forget("c-main-a");
        a.forget("c-main-zzz");
        assert!(a.list().is_empty());
    }

    #[test]
    fn a_damaged_file_and_duplicate_entries_are_tolerated_and_the_list_is_bounded() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("a.json");
        std::fs::write(&file, "{nope").unwrap();
        assert!(Archive::open(file.clone()).list().is_empty());
        let many: Vec<String> = (0..MAX_ARCHIVED + 50).map(|i| format!("c-main-{i}")).chain(["c-main-1".to_owned()]).collect();
        std::fs::write(&file, json!({ "archived": many }).to_string()).unwrap();
        let mut a = Archive::open(file);
        assert_eq!(a.list().len(), MAX_ARCHIVED);
        assert!(!a.set("c-main-overflow", true), "full");
    }
}
