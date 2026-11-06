//! Saves what pages download into one folder, under names the page cannot use to reach anywhere else.
use std::path::{Path, PathBuf};

use serde_json::{Value, json};

use crate::download_names::{is_risky, safe_file_name, unique_name};

pub const MAX_ACTIVE: usize = 8;
const MAX_KEPT: usize = 50;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum State {
    Downloading,
    Done,
    Failed,
    Cancelled,
}

impl State {
    fn word(self) -> &'static str {
        match self {
            State::Downloading => "downloading",
            State::Done => "done",
            State::Failed => "failed",
            State::Cancelled => "cancelled",
        }
    }
}

struct Record {
    id: String,
    name: String,
    state: State,
    received: u64,
    total: u64,
    risky: bool,
    path: PathBuf,
}

/// Where a download goes, decided before any byte is written. `None` means it is refused.
pub struct Accepted {
    pub id: String,
    pub path: PathBuf,
}

pub struct Downloads {
    dir: PathBuf,
    records: Vec<Record>,
    counter: u64,
}

impl Downloads {
    pub fn new(dir: PathBuf) -> Downloads {
        Downloads { dir, records: Vec::new(), counter: 0 }
    }

    pub fn list(&self) -> Value {
        Value::Array(self.records.iter().map(|r| json!({ "id": r.id, "name": r.name, "state": r.state.word(), "received": r.received, "total": r.total, "risky": r.risky })).collect())
    }

    /// A page started a download called `suggested`. Decides the file's name and place, or refuses.
    pub fn accept(&mut self, suggested: &str, total: u64) -> Option<Accepted> {
        if self.records.iter().filter(|r| r.state == State::Downloading).count() >= MAX_ACTIVE {
            return None;
        }
        std::fs::create_dir_all(&self.dir).ok()?;
        let taken = |candidate: &str| self.dir.join(candidate).exists() || self.records.iter().any(|r| r.state == State::Downloading && r.path.file_name().is_some_and(|n| n == candidate));
        let name = unique_name(&safe_file_name(suggested), taken);
        let path = self.dir.join(&name);
        // A name that still leads outside the folder is never used.
        if path.parent() != Some(self.dir.as_path()) {
            return None;
        }
        self.counter += 1;
        let id = format!("dl-{}", self.counter);
        self.records.push(Record { id: id.clone(), risky: is_risky(&name), name, state: State::Downloading, received: 0, total, path: path.clone() });
        if self.records.len() > MAX_KEPT {
            let extra = self.records.len() - MAX_KEPT;
            self.records.drain(..extra);
        }
        Some(Accepted { id, path })
    }

    pub fn progress(&mut self, id: &str, received: u64, total: u64) {
        if let Some(r) = self.records.iter_mut().find(|r| r.id == id && r.state == State::Downloading) {
            r.received = received;
            r.total = total;
        }
    }

    pub fn finish(&mut self, id: &str, state: State) {
        if let Some(r) = self.records.iter_mut().find(|r| r.id == id && r.state == State::Downloading) {
            r.state = if state == State::Downloading { State::Failed } else { state };
            if r.state == State::Done {
                r.received = r.received.max(r.total);
            }
        }
    }

    /// Bytes arrived for the download saved at `path`. Returns whether the figures are worth showing again: only when they
    /// moved by a visible step, so a fast download does not flood the window.
    pub fn progress_path(&mut self, path: &Path, received: u64, total: u64) -> bool {
        let Some(r) = self.records.iter_mut().find(|r| r.state == State::Downloading && r.path == path) else { return false };
        let step = (total / 100).max(32 * 1024);
        let moved = received.abs_diff(r.received) >= step || (total > 0 && received >= total);
        if moved {
            r.received = received;
            r.total = total;
        }
        moved
    }

    /// The web view reports a download ended at `path`. Returns whether it was one of ours.
    pub fn finish_path(&mut self, path: &Path, success: bool) -> bool {
        let Some(id) = self.records.iter().find(|r| r.state == State::Downloading && r.path == path).map(|r| r.id.clone()) else { return false };
        let size = std::fs::metadata(path).map_or(0, |m| m.len());
        self.progress(&id, size, size);
        self.finish(&id, if success { State::Done } else { State::Failed });
        true
    }

    /// Marks a running download cancelled and says where it was being saved, so it can be stopped.
    pub fn cancel(&mut self, id: &str) -> Option<PathBuf> {
        let record = self.records.iter_mut().find(|r| r.id == id && r.state == State::Downloading)?;
        record.state = State::Cancelled;
        Some(record.path.clone())
    }

    pub fn is_active(&self, id: &str) -> bool {
        self.records.iter().any(|r| r.id == id && r.state == State::Downloading)
    }

    /// The saved file for `id`, if it finished.
    pub fn file(&self, id: &str) -> Option<(&Path, bool)> {
        self.records.iter().find(|r| r.id == id && r.state == State::Done && r.path.exists()).map(|r| (r.path.as_path(), r.risky))
    }

    /// Forget the finished ones (the files stay where they are).
    pub fn clear(&mut self) {
        self.records.retain(|r| r.state == State::Downloading);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn downloads() -> (Downloads, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        (Downloads::new(dir.path().join("Downloads")), dir)
    }

    #[test]
    fn a_download_is_saved_under_a_plain_name_inside_the_folder() {
        let (mut d, dir) = downloads();
        let a = d.accept("..\\..\\evil.txt", 10).unwrap();
        assert_eq!(a.path, dir.path().join("Downloads").join("evil.txt"));
        assert_eq!(a.id, "dl-1");
        assert!(dir.path().join("Downloads").is_dir());
        assert_eq!(d.list()[0]["state"], "downloading");
    }

    #[test]
    fn a_name_that_is_taken_on_disk_or_by_a_download_in_progress_gets_a_number() {
        let (mut d, _dir) = downloads();
        let first = d.accept("a.txt", 1).unwrap();
        let second = d.accept("a.txt", 1).unwrap();
        assert_eq!(second.path.file_name().unwrap(), "a (1).txt", "the first is still downloading");
        std::fs::write(&first.path, "x").unwrap();
        d.finish(&first.id, State::Done);
        assert_eq!(d.accept("a.txt", 1).unwrap().path.file_name().unwrap(), "a (2).txt");
    }

    #[test]
    fn at_most_eight_run_at_once() {
        let (mut d, _dir) = downloads();
        for i in 0..MAX_ACTIVE {
            assert!(d.accept(&format!("f{i}.bin"), 1).is_some());
        }
        assert!(d.accept("one-more.bin", 1).is_none());
        d.finish("dl-1", State::Cancelled);
        assert!(d.accept("one-more.bin", 1).is_some());
    }

    #[test]
    fn progress_and_finishing_update_the_entry_and_only_while_downloading() {
        let (mut d, _dir) = downloads();
        let a = d.accept("a.zip", 0).unwrap();
        d.progress(&a.id, 5, 100);
        assert_eq!((d.list()[0]["received"].clone(), d.list()[0]["total"].clone()), (json!(5), json!(100)));
        d.finish(&a.id, State::Done);
        assert_eq!(d.list()[0]["received"], json!(100), "done means everything arrived");
        d.progress(&a.id, 7, 7);
        d.finish(&a.id, State::Failed);
        assert_eq!((d.list()[0]["state"].clone(), d.list()[0]["received"].clone()), (json!("done"), json!(100)), "a finished download does not change");
        assert!(!d.is_active(&a.id));
    }

    #[test]
    fn programs_are_marked_risky_and_a_file_is_only_offered_once_it_exists_and_is_done() {
        let (mut d, _dir) = downloads();
        let setup = d.accept("setup.exe", 2).unwrap();
        assert_eq!(d.list()[0]["risky"], json!(true));
        assert!(d.file(&setup.id).is_none(), "not finished");
        d.finish(&setup.id, State::Done);
        assert!(d.file(&setup.id).is_none(), "not on disk");
        std::fs::write(&setup.path, "MZ").unwrap();
        assert!(d.file(&setup.id).unwrap().1);
        let note = d.accept("note.txt", 1).unwrap();
        std::fs::write(&note.path, "x").unwrap();
        d.finish(&note.id, State::Done);
        assert!(!d.file(&note.id).unwrap().1);
    }

    #[test]
    fn a_download_that_ends_at_its_path_is_marked_done_or_failed() {
        let (mut d, _dir) = downloads();
        let a = d.accept("a.txt", 0).unwrap();
        std::fs::write(&a.path, "12345").unwrap();
        assert!(d.finish_path(&a.path, true));
        assert_eq!((d.list()[0]["state"].clone(), d.list()[0]["received"].clone(), d.list()[0]["total"].clone()), (json!("done"), json!(5), json!(5)));
        assert!(!d.finish_path(&a.path, true), "already finished");
        let b = d.accept("b.txt", 0).unwrap();
        assert!(d.finish_path(&b.path, false));
        assert_eq!(d.list()[1]["state"], "failed");
        assert!(!d.finish_path(Path::new("elsewhere.txt"), true));
    }

    #[test]
    fn progress_is_shown_in_steps_not_for_every_trickle() {
        let (mut d, _dir) = downloads();
        let a = d.accept("a.bin", 0).unwrap();
        assert!(!d.progress_path(&a.path, 10, 10_000_000), "too small a step");
        assert!(d.progress_path(&a.path, 200_000, 10_000_000));
        assert_eq!(d.list()[0]["received"], 200_000);
        assert!(!d.progress_path(&a.path, 210_000, 10_000_000));
        assert!(d.progress_path(&a.path, 10_000_000, 10_000_000), "the end is always shown");
        assert!(!d.progress_path(Path::new("other"), 1, 1));
    }

    #[test]
    fn cancelling_marks_a_running_download_and_gives_back_its_place_once() {
        let (mut d, _dir) = downloads();
        let a = d.accept("a.bin", 0).unwrap();
        assert_eq!(d.cancel(&a.id), Some(a.path.clone()));
        assert_eq!(d.list()[0]["state"], "cancelled");
        assert_eq!(d.cancel(&a.id), None);
        assert_eq!(d.cancel("dl-9"), None);
        assert!(!d.finish_path(&a.path, false), "the later report of the interruption changes nothing");
        assert_eq!(d.list()[0]["state"], "cancelled");
    }

    #[test]
    fn clearing_forgets_the_finished_ones_and_keeps_the_running() {
        let (mut d, _dir) = downloads();
        let a = d.accept("a.txt", 1).unwrap();
        d.accept("b.txt", 1).unwrap();
        d.finish(&a.id, State::Cancelled);
        d.clear();
        assert_eq!(d.list().as_array().unwrap().len(), 1);
        assert_eq!(d.list()[0]["name"], "b.txt");
    }

    #[test]
    fn only_the_last_fifty_are_kept() {
        let (mut d, _dir) = downloads();
        for i in 0..60 {
            let a = d.accept(&format!("f{i}.txt"), 1).unwrap();
            d.finish(&a.id, State::Done);
        }
        let list = d.list();
        assert_eq!(list.as_array().unwrap().len(), 50);
        assert_eq!(list[0]["name"], "f10.txt");
    }

    #[test]
    fn a_folder_that_cannot_be_made_refuses_the_download() {
        let dir = tempfile::tempdir().unwrap();
        let blocker = dir.path().join("blocker");
        std::fs::write(&blocker, "a file, not a folder").unwrap();
        let mut d = Downloads::new(blocker.join("Downloads"));
        assert!(d.accept("a.txt", 1).is_none());
    }
}
