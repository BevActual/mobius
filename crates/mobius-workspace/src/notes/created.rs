//! When each page was made, kept beside the notebooks. A file's own creation time cannot be trusted for it: every save
//! writes a new file and renames it over the old one, and copies and syncs make new files too. So the first time the
//! list sees a page, the earlier of its file's creation and change times is noted here, and kept as the page is
//! saved, moved, or goes to the Trash and comes back.

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;
use std::time::UNIX_EPOCH;

use super::Notes;

/// The file in the notes folder that keeps when each page was made, by its path (`notebook/page.md`).
pub(super) const CREATED: &str = ".created.json";

fn ms(t: std::time::SystemTime) -> Option<u64> {
    t.duration_since(UNIX_EPOCH)
        .ok()
        .map(|d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
}

/// The earlier of the file's creation and change times (some systems give no creation time).
pub(super) fn first_seen(file: &Path) -> u64 {
    let Ok(meta) = fs::metadata(file) else {
        return 0;
    };
    let changed = meta.modified().ok().and_then(ms);
    let made = meta.created().ok().and_then(ms);
    match (made, changed) {
        (Some(a), Some(b)) => a.min(b),
        (a, b) => a.or(b).unwrap_or(0),
    }
}

impl Notes {
    pub(super) fn created_times(&self) -> BTreeMap<String, u64> {
        fs::read_to_string(self.root.join(CREATED))
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default()
    }

    pub(super) fn keep_created_times(&self, times: &BTreeMap<String, u64>) {
        if let Ok(text) = serde_json::to_string(times) {
            let _ = fs::write(self.root.join(CREATED), text);
        }
    }

    /// The times of pages that moved, carried to where they are now: `to` gives each old path's new one, or None.
    pub(super) fn carry_created_times(&self, to: &dyn Fn(&str) -> Option<String>) {
        let mut times = self.created_times();
        let moved: Vec<(String, String, u64)> = times
            .iter()
            .filter_map(|(p, t)| to(p).map(|n| (p.clone(), n, *t)))
            .collect();
        if moved.is_empty() {
            return;
        }
        for (old, new, t) in moved {
            times.remove(&old);
            times.insert(new, t);
        }
        self.keep_created_times(&times);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    use tempfile::TempDir;

    fn created_of(list: &Value, path: &str) -> u64 {
        list.as_array()
            .unwrap()
            .iter()
            .flat_map(|nb| nb["pages"].as_array().unwrap().iter())
            .find(|p| p["path"] == path)
            .unwrap()["created"]
            .as_u64()
            .unwrap()
    }

    #[test]
    fn a_page_keeps_when_it_was_made_through_saves_moves_and_renames() {
        let dir = TempDir::new().unwrap();
        let notes = Notes::new(dir.path().join("work"), dir.path().join("store"));
        notes.create_notebook("Work").unwrap();
        notes.create_notebook("Home").unwrap();
        fs::write(notes.root.join("Work/Plan.md"), "# Plan\n").unwrap();
        let made = created_of(&notes.list().unwrap(), "Work/Plan.md");
        assert!(made > 0);
        // A time noted earlier is the one kept, whatever the file now says.
        let mut times = notes.created_times();
        times.insert("Work/Plan.md".into(), 1_000);
        notes.keep_created_times(&times);
        notes
            .save("Work/Plan.md", "# Plan\n\nMore.\n", None)
            .unwrap();
        assert_eq!(created_of(&notes.list().unwrap(), "Work/Plan.md"), 1_000);
        notes.move_page("Work/Plan.md", "Home").unwrap();
        assert_eq!(created_of(&notes.list().unwrap(), "Home/Plan.md"), 1_000);
        notes.rename_notebook("Home", "Kitchen").unwrap();
        assert_eq!(created_of(&notes.list().unwrap(), "Kitchen/Plan.md"), 1_000);
        assert!(!notes.created_times().contains_key("Home/Plan.md"));
    }
}
