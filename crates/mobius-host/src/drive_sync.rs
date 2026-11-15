//! Two-way sync between a workspace folder and a folder on a drive (docs/developers/drives.md, "Two-way sync").
//!
//! A round compares each file with the **base**: its hash and the drive's version when the two last matched. What
//! changed on one side goes to the other; what changed on both is a conflict that keeps both copies. It uses only the
//! `Drive` trait, so every kind of drive can sync. The base is saved after every file, so a round that is cut off
//! resumes where it stopped.

use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::drives::{CHANGED, Drive, EXISTS, Entry, MAX_FILE};

type Res<T> = Result<T, String>;

/// A round deletes at most this many files on one side without asking, and at most `1 / DELETE_SHARE` of the pair.
pub const DELETE_LIMIT: usize = 10;
pub const DELETE_SHARE: usize = 4;
/// What a conflict copy's name carries, so it is never synced and can be found again.
pub const CONFLICT_MARK: &str = " (conflict, Mobius, ";

/// One file as it was when both sides last matched.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BaseFile {
    /// SHA-256 of the content, in hex.
    pub hash: String,
    /// The drive's version of it then.
    pub version: Option<String>,
    /// The local file's size and time then: when both are the same now, it is not hashed again.
    pub size: u64,
    pub modified_ms: u128,
}

/// What a pair knows from its last round: path within the pair → the file then.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct Base {
    pub files: BTreeMap<String, BaseFile>,
}

/// What a round should do beyond the usual.
#[derive(Default)]
pub struct RoundOptions<'a> {
    /// Paths (within the pair) not to send yet: the agent's changes waiting for Keep.
    pub held: HashSet<String>,
    /// The person said yes to the deletes a round asked about.
    pub allow_deletes: bool,
    /// Today's date and time for a conflict copy's name, such as `2026-11-15 14.32`.
    pub stamp: &'a str,
}

/// Deletes a round held back to ask about.
#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeletePlan {
    /// On the drive, because they were deleted here.
    pub on_drive: Vec<String>,
    /// Here, because they were deleted on the drive.
    pub here: Vec<String>,
}

/// What a round did, for the status in Files.
#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub uploaded: Vec<String>,
    pub downloaded: Vec<String>,
    pub deleted_on_drive: Vec<String>,
    pub deleted_here: Vec<String>,
    /// Each conflict: the file's path and its local copy's path.
    pub conflicts: Vec<(String, String)>,
    /// Changed here but waiting for Keep.
    pub held: Vec<String>,
    /// Over `MAX_FILE`: left alone on both sides.
    pub too_big: Vec<String>,
    /// Changed again while the round ran: looked at next round.
    pub later: Vec<String>,
    /// Files that failed, with what went wrong.
    pub failed: Vec<(String, String)>,
    /// Deletes waiting for the person's yes.
    pub ask: Option<DeletePlan>,
}

impl Report {
    /// Whether the round changed anything on this computer.
    pub fn changed_here(&self) -> bool {
        !self.downloaded.is_empty() || !self.deleted_here.is_empty() || !self.conflicts.is_empty()
    }
}

/// Names the systems and Mobius make that are never synced, and conflict copies.
pub fn left_out(name: &str) -> bool {
    matches!(name, ".DS_Store" | "Thumbs.db" | "desktop.ini" | ".git")
        || name.starts_with("~$")
        || name.ends_with(".mobius-tmp")
        || name.ends_with(".part")
        || name.contains(CONFLICT_MARK)
}

/// The name of a conflict copy of `path`: `notes/plan (conflict, Mobius, 2026-11-15 14.32).md`.
pub fn conflict_name(path: &str, stamp: &str) -> String {
    let (folder, name) = path.rsplit_once('/').map_or(("", path), |(f, n)| (f, n));
    let (stem, ext) = match name.rfind('.') {
        Some(dot) if dot > 0 => (&name[..dot], &name[dot..]),
        _ => (name, ""),
    };
    let copy = format!("{stem}{CONFLICT_MARK}{stamp}){ext}");
    if folder.is_empty() { copy } else { format!("{folder}/{copy}") }
}

fn hash(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

/// A local file as found now.
struct Here {
    hash: String,
    size: u64,
    modified_ms: u128,
}

fn stat(path: &Path) -> Option<(u64, u128)> {
    let meta = fs::metadata(path).ok()?;
    let ms = meta.modified().ok()?.duration_since(UNIX_EPOCH).ok()?.as_millis();
    Some((meta.len(), ms))
}

/// Every file under `root`, by path within it. A file whose size and time match the base keeps the base's hash.
fn local_files(root: &Path, base: &Base) -> Res<BTreeMap<String, Here>> {
    let mut out = BTreeMap::new();
    let mut folders = vec![(root.to_path_buf(), String::new())];
    while let Some((dir, prefix)) = folders.pop() {
        let entries = match fs::read_dir(&dir) {
            Ok(e) => e,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound && prefix.is_empty() => return Ok(out),
            Err(e) => return Err(e.to_string()),
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if left_out(&name) {
                continue;
            }
            let rel = if prefix.is_empty() { name.clone() } else { format!("{prefix}/{name}") };
            let Ok(kind) = entry.file_type() else { continue };
            if kind.is_dir() {
                folders.push((entry.path(), rel));
            } else if kind.is_file() {
                let Some((size, modified_ms)) = stat(&entry.path()) else { continue };
                let known = base.files.get(&rel).filter(|b| b.size == size && b.modified_ms == modified_ms);
                let hash = match known {
                    Some(b) => b.hash.clone(),
                    None if size > MAX_FILE as u64 => format!("big:{size}:{modified_ms}"),
                    None => match fs::read(entry.path()) {
                        Ok(bytes) => self::hash(&bytes),
                        Err(_) => continue,
                    },
                };
                out.insert(rel, Here { hash, size, modified_ms });
            }
        }
    }
    Ok(out)
}

/// Every file under `remote` on the drive, by path within it.
fn drive_files(drive: &dyn Drive, remote: &str) -> Res<BTreeMap<String, Entry>> {
    let remote = remote.trim_matches('/');
    let mut out = BTreeMap::new();
    let mut folders = vec![remote.to_owned()];
    while let Some(folder) = folders.pop() {
        for entry in drive.list(&folder)? {
            if left_out(&entry.name) || entry.link.is_some() {
                continue;
            }
            let rel = if remote.is_empty() { entry.path.clone() } else { entry.path.strip_prefix(&format!("{remote}/")).unwrap_or(&entry.path).to_owned() };
            if entry.folder {
                folders.push(entry.path.clone());
            } else {
                out.insert(rel, entry);
            }
        }
    }
    Ok(out)
}

fn on_drive(remote: &str, rel: &str) -> String {
    let remote = remote.trim_matches('/');
    if remote.is_empty() { rel.to_owned() } else { format!("{remote}/{rel}") }
}

/// Writes a file whole: to a temp file beside it, then renamed over, so no app ever reads half of it.
fn write_here(root: &Path, rel: &str, bytes: &[u8]) -> Res<(u64, u128)> {
    let target = root.join(rel);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let temp = PathBuf::from(format!("{}.mobius-tmp", target.display()));
    fs::write(&temp, bytes).map_err(|e| e.to_string())?;
    fs::rename(&temp, &target).map_err(|e| {
        let _ = fs::remove_file(&temp);
        e.to_string()
    })?;
    stat(&target).ok_or_else(|| "the file was not there after writing it".to_owned())
}

/// Writes to the drive, making the folders it goes in when the drive says they are missing.
fn write_there(drive: &dyn Drive, path: &str, bytes: &[u8], version: Option<&str>) -> Res<Option<String>> {
    match drive.write(path, bytes, version) {
        Err(e) if e == crate::drives::WebDav::failed(409, None) => {
            let names: Vec<&str> = path.split('/').collect();
            for depth in 1..names.len() {
                match drive.make_folder(&names[..depth].join("/")) {
                    Ok(()) => {}
                    Err(e) if e == EXISTS || e.contains("405") => {}
                    Err(e) => return Err(e),
                }
            }
            drive.write(path, bytes, version)
        }
        other => other,
    }
}

/// What to do with one path.
#[derive(Debug, PartialEq, Eq)]
enum Step {
    Upload,
    Download,
    DeleteThere,
    DeleteHere,
    /// Both sides changed (or are new): the same bytes only need the base; different ones are a conflict.
    Both,
    Forget,
}

/// One round between `root` (the workspace folder) and `remote` (its folder on the drive). `save` is called with the
/// base after every file that went through.
pub fn round(drive: &dyn Drive, root: &Path, remote: &str, base: &mut Base, options: &RoundOptions, save: &mut dyn FnMut(&Base)) -> Res<Report> {
    let there = drive_files(drive, remote)?;
    let here = local_files(root, base)?;
    let mut report = Report::default();
    let paths: BTreeSet<String> = base.files.keys().chain(here.keys()).chain(there.keys()).cloned().collect();

    let mut plan: Vec<(String, Step)> = Vec::new();
    for path in paths {
        let (b, h, t) = (base.files.get(&path), here.get(&path), there.get(&path));
        if h.is_some_and(|h| h.size > MAX_FILE as u64) || t.is_some_and(|t| t.size > MAX_FILE as u64) {
            report.too_big.push(path);
            continue;
        }
        let here_changed = match (b, h) {
            (Some(b), Some(h)) => b.hash != h.hash,
            (None, None) => false,
            _ => true,
        };
        let there_changed = match (b, t) {
            (Some(b), Some(t)) => b.version != t.version,
            (None, None) => false,
            _ => true,
        };
        let step = match (here_changed, there_changed, h.is_some(), t.is_some()) {
            (false, false, _, _) => continue,
            // Gone on both sides.
            (_, _, false, false) => Step::Forget,
            (true, false, true, _) => Step::Upload,
            (true, false, false, _) => Step::DeleteThere,
            (false, true, _, true) => Step::Download,
            (false, true, _, false) => Step::DeleteHere,
            // Deleted here, changed there: the edit is kept.
            (true, true, false, true) => Step::Download,
            // Changed here, deleted there: the edit is kept.
            (true, true, true, false) => Step::Upload,
            (true, true, true, true) => Step::Both,
        };
        if options.held.contains(&path) && matches!(step, Step::Upload | Step::DeleteThere | Step::Both) {
            report.held.push(path);
            continue;
        }
        plan.push((path, step));
    }

    // Many deletes on one side ask first.
    let size = base.files.len().max(1);
    let too_many = |n: usize| n > DELETE_LIMIT || (n > 1 && n * DELETE_SHARE > size);
    let deletes_there: Vec<String> = plan.iter().filter(|(_, s)| *s == Step::DeleteThere).map(|(p, _)| p.clone()).collect();
    let deletes_here: Vec<String> = plan.iter().filter(|(_, s)| *s == Step::DeleteHere).map(|(p, _)| p.clone()).collect();
    if !options.allow_deletes && (too_many(deletes_there.len()) || too_many(deletes_here.len())) {
        plan.retain(|(_, s)| !matches!(s, Step::DeleteThere | Step::DeleteHere));
        report.ask = Some(DeletePlan { on_drive: deletes_there, here: deletes_here });
    }

    for (path, step) in plan {
        let result = apply(drive, root, remote, base, &path, &step, here.get(&path), there.get(&path), options, &mut report);
        match result {
            Ok(()) => save(base),
            Err(e) if e == CHANGED || e == EXISTS => report.later.push(path),
            Err(e) => report.failed.push((path, e)),
        }
    }
    Ok(report)
}

#[allow(clippy::too_many_arguments)]
fn apply(drive: &dyn Drive, root: &Path, remote: &str, base: &mut Base, path: &str, step: &Step, here: Option<&Here>, there: Option<&Entry>, options: &RoundOptions, report: &mut Report) -> Res<()> {
    let target = on_drive(remote, path);
    match step {
        Step::Forget => {
            base.files.remove(path);
        }
        Step::Upload => {
            let bytes = fs::read(root.join(path)).map_err(|e| e.to_string())?;
            // Replaces only the version it was based on; a file the drive doesn't have (any more) is made new.
            let based_on = there.and(base.files.get(path)).and_then(|b| b.version.clone());
            let version = write_there(drive, &target, &bytes, based_on.as_deref())?;
            let version = match version {
                Some(v) => Some(v),
                None => drive.list(target.rsplit_once('/').map_or("", |(f, _)| f))?.into_iter().find(|e| e.path == target).and_then(|e| e.version),
            };
            let (size, modified_ms) = stat(&root.join(path)).unwrap_or((bytes.len() as u64, 0));
            base.files.insert(path.to_owned(), BaseFile { hash: hash(&bytes), version, size, modified_ms });
            report.uploaded.push(path.to_owned());
        }
        Step::Download => {
            let file = drive.read(&target)?;
            // Changed here since this round looked: left for the next.
            if let Some(h) = here {
                let now = stat(&root.join(path));
                if now != Some((h.size, h.modified_ms)) {
                    return Err(CHANGED.to_owned());
                }
            } else if root.join(path).exists() {
                return Err(CHANGED.to_owned());
            }
            let (size, modified_ms) = write_here(root, path, &file.bytes)?;
            let version = file.version.or_else(|| there.and_then(|t| t.version.clone()));
            base.files.insert(path.to_owned(), BaseFile { hash: hash(&file.bytes), version, size, modified_ms });
            report.downloaded.push(path.to_owned());
        }
        Step::DeleteThere => {
            let version = base.files.get(path).and_then(|b| b.version.clone());
            drive.delete(&target, version.as_deref())?;
            base.files.remove(path);
            report.deleted_on_drive.push(path.to_owned());
        }
        Step::DeleteHere => {
            let file = root.join(path);
            if let Some(b) = base.files.get(path)
                && stat(&file) != Some((b.size, b.modified_ms))
            {
                return Err(CHANGED.to_owned());
            }
            match fs::remove_file(&file) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(e.to_string()),
            }
            base.files.remove(path);
            report.deleted_here.push(path.to_owned());
        }
        Step::Both => {
            let file = drive.read(&target)?;
            let theirs = hash(&file.bytes);
            let version = file.version.or_else(|| there.and_then(|t| t.version.clone()));
            let mine = here.map(|h| h.hash.clone()).unwrap_or_default();
            if theirs == mine {
                // The same change on both sides.
                let (size, modified_ms) = stat(&root.join(path)).unwrap_or((file.bytes.len() as u64, 0));
                base.files.insert(path.to_owned(), BaseFile { hash: theirs, version, size, modified_ms });
                return Ok(());
            }
            // Keep both: ours moves aside as a conflict copy, the drive's takes the name.
            let copy = conflict_name(path, options.stamp);
            fs::rename(root.join(path), root.join(&copy)).map_err(|e| e.to_string())?;
            let (size, modified_ms) = write_here(root, path, &file.bytes)?;
            base.files.insert(path.to_owned(), BaseFile { hash: theirs, version, size, modified_ms });
            report.conflicts.push((path.to_owned(), copy));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::drives::WebDav;
    use crate::drives::tests::{Store, server};

    struct Pair {
        drive: WebDav,
        store: Store,
        root: tempfile::TempDir,
        base: Base,
    }

    fn pair() -> Pair {
        let (address, store) = server("/dav/");
        let drive = WebDav::new(url::Url::parse(&format!("{address}/dav/")).unwrap(), "ana", "app-pass");
        drive.make_folder("Notes").unwrap();
        Pair { drive, store, root: tempfile::tempdir().unwrap(), base: Base::default() }
    }

    impl Pair {
        fn round_with(&mut self, options: &RoundOptions) -> Report {
            round(&self.drive, self.root.path(), "Notes", &mut self.base, options, &mut |_| {}).unwrap()
        }
        fn round(&mut self) -> Report {
            self.round_with(&RoundOptions { stamp: "2026-11-15 14.32", ..RoundOptions::default() })
        }
        fn here(&self, rel: &str) -> Option<String> {
            fs::read_to_string(self.root.path().join(rel)).ok()
        }
        fn put_here(&self, rel: &str, text: &str) {
            let path = self.root.path().join(rel);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, text).unwrap();
        }
        fn there(&self, rel: &str) -> Option<String> {
            self.store.lock().unwrap().get(&format!("/dav/Notes/{rel}")).map(|(b, _)| String::from_utf8_lossy(b).into_owned())
        }
        /// Someone else changes the drive: a new version, as a server gives.
        fn put_there(&self, rel: &str, text: &str) {
            let mut st = self.store.lock().unwrap();
            let key = format!("/dav/Notes/{rel}");
            let v = st.get(&key).map_or(500, |(_, v)| v + 500);
            let mut folder = String::from("/dav/Notes/");
            for part in rel.split('/').rev().skip(1).collect::<Vec<_>>().into_iter().rev() {
                folder.push_str(part);
                folder.push('/');
                st.entry(folder.clone()).or_insert((Vec::new(), 1));
            }
            st.insert(key, (text.as_bytes().to_vec(), v));
        }
        fn delete_there(&self, rel: &str) {
            self.store.lock().unwrap().remove(&format!("/dav/Notes/{rel}"));
        }
    }

    /// Lets the file system's clock move on, so an edit right after a round has a new time.
    fn tick() {
        std::thread::sleep(std::time::Duration::from_millis(20));
    }

    #[test]
    fn new_files_go_both_ways_and_a_second_round_does_nothing() {
        let mut p = pair();
        p.put_here("plan.md", "# Plan");
        p.put_here("trips/lisbon.md", "# Lisbon");
        p.put_there("budget.md", "# Budget");
        p.put_there("trips/porto.md", "# Porto");
        let r = p.round();
        assert_eq!((r.uploaded.len(), r.downloaded.len()), (2, 2), "{r:?}");
        assert_eq!(p.there("trips/lisbon.md").as_deref(), Some("# Lisbon"), "a folder the drive lacked is made");
        assert_eq!(p.here("trips/porto.md").as_deref(), Some("# Porto"));
        assert_eq!(p.base.files.len(), 4);
        assert_eq!(p.round(), Report::default(), "nothing changed, nothing done");
    }

    #[test]
    fn a_change_on_one_side_reaches_the_other() {
        let mut p = pair();
        p.put_here("plan.md", "one");
        p.round();
        tick();
        p.put_here("plan.md", "two");
        assert_eq!(p.round().uploaded, ["plan.md"]);
        assert_eq!(p.there("plan.md").as_deref(), Some("two"));
        p.put_there("plan.md", "three");
        assert_eq!(p.round().downloaded, ["plan.md"]);
        assert_eq!(p.here("plan.md").as_deref(), Some("three"));
        assert_eq!(p.round(), Report::default());
    }

    #[test]
    fn a_change_on_both_sides_keeps_both_and_the_copy_is_never_sent() {
        let mut p = pair();
        p.put_here("plan.md", "one");
        p.round();
        tick();
        p.put_here("plan.md", "mine");
        p.put_there("plan.md", "theirs");
        let r = p.round();
        let copy = "plan (conflict, Mobius, 2026-11-15 14.32).md";
        assert_eq!(r.conflicts, [("plan.md".to_owned(), copy.to_owned())]);
        assert_eq!(p.here("plan.md").as_deref(), Some("theirs"), "the drive's version keeps the name");
        assert_eq!(p.here(copy).as_deref(), Some("mine"), "ours is kept beside it");
        assert_eq!(p.there("plan.md").as_deref(), Some("theirs"));
        assert_eq!(p.round(), Report::default(), "the conflict copy stays here");
        assert!(p.there(copy).is_none());
    }

    #[test]
    fn the_same_change_on_both_sides_is_no_conflict() {
        let mut p = pair();
        p.put_here("plan.md", "one");
        p.round();
        tick();
        p.put_here("plan.md", "same");
        p.put_there("plan.md", "same");
        let r = p.round();
        assert!(r.conflicts.is_empty() && r.uploaded.is_empty() && r.downloaded.is_empty(), "{r:?}");
        assert_eq!(p.round(), Report::default());
    }

    #[test]
    fn deletes_go_both_ways_but_an_edit_beats_a_delete() {
        let mut p = pair();
        for name in ["a.md", "b.md", "c.md", "d.md", "e.md", "f.md", "g.md", "h.md"] {
            p.put_here(name, name);
        }
        p.round();
        fs::remove_file(p.root.path().join("a.md")).unwrap();
        p.delete_there("b.md");
        let r = p.round();
        assert_eq!((r.deleted_on_drive.as_slice(), r.deleted_here.as_slice()), (["a.md".to_owned()].as_slice(), ["b.md".to_owned()].as_slice()));
        assert!(p.there("a.md").is_none() && p.here("b.md").is_none());

        // Deleted here, changed there: the change comes back.
        tick();
        fs::remove_file(p.root.path().join("c.md")).unwrap();
        p.put_there("c.md", "edited there");
        // Changed here, deleted there: it goes up again.
        p.put_here("d.md", "edited here");
        p.delete_there("d.md");
        let r = p.round();
        assert_eq!((r.downloaded.as_slice(), r.uploaded.as_slice()), (["c.md".to_owned()].as_slice(), ["d.md".to_owned()].as_slice()), "{r:?}");
        assert_eq!(p.here("c.md").as_deref(), Some("edited there"));
        assert_eq!(p.there("d.md").as_deref(), Some("edited here"));
    }

    #[test]
    fn many_deletes_wait_for_a_yes() {
        let mut p = pair();
        for i in 0..12 {
            p.put_here(&format!("n{i}.md"), "x");
        }
        p.round();
        for i in 0..12 {
            p.delete_there(&format!("n{i}.md"));
        }
        let r = p.round();
        assert_eq!(r.ask.as_ref().map(|a| a.here.len()), Some(12), "{r:?}");
        assert!(r.deleted_here.is_empty() && p.here("n0.md").is_some(), "nothing deleted before the yes");
        let r = p.round_with(&RoundOptions { allow_deletes: true, stamp: "x", ..RoundOptions::default() });
        assert_eq!(r.deleted_here.len(), 12);
        assert!(p.here("n0.md").is_none());
    }

    #[test]
    fn a_held_change_waits_and_the_drives_changes_still_come() {
        let mut p = pair();
        p.put_here("plan.md", "one");
        p.put_here("other.md", "one");
        p.round();
        tick();
        p.put_here("plan.md", "agent's change");
        p.put_there("other.md", "theirs");
        let held = RoundOptions { held: ["plan.md".to_owned()].into(), stamp: "x", ..RoundOptions::default() };
        let r = p.round_with(&held);
        assert_eq!((r.held.as_slice(), r.downloaded.as_slice()), (["plan.md".to_owned()].as_slice(), ["other.md".to_owned()].as_slice()));
        assert_eq!(p.there("plan.md").as_deref(), Some("one"), "nothing unreviewed reaches the drive");
        assert_eq!(p.round().uploaded, ["plan.md"], "once kept, it goes");
    }

    #[test]
    fn left_out_names_and_service_documents_are_not_synced() {
        let mut p = pair();
        p.put_here(".DS_Store", "x");
        p.put_here("draft.md.mobius-tmp", "x");
        p.put_here("~$report.docx", "x");
        p.put_here("plan.md", "x");
        let r = p.round();
        assert_eq!(r.uploaded, ["plan.md"]);
        assert!(left_out("plan (conflict, Mobius, 2026-11-15 14.32).md"));
        assert_eq!(conflict_name("trips/plan.md", "d"), "trips/plan (conflict, Mobius, d).md");
        assert_eq!(conflict_name("README", "d"), "README (conflict, Mobius, d)");
    }

    #[test]
    fn a_round_cut_off_resumes_from_the_saved_base() {
        let mut p = pair();
        for i in 0..5 {
            p.put_here(&format!("n{i}.md"), "x");
        }
        // The base as saved after the second file: as if the app quit there.
        let mut saved: Vec<Base> = Vec::new();
        round(&p.drive, p.root.path(), "Notes", &mut p.base, &RoundOptions::default(), &mut |b| saved.push(b.clone())).unwrap();
        p.base = saved[1].clone();
        let r = p.round();
        assert!(r.uploaded.is_empty() && r.conflicts.is_empty(), "the other three are found already there with the same bytes: {r:?}");
        assert_eq!(p.base.files.len(), 5);
        assert_eq!(p.round(), Report::default());
    }
}
