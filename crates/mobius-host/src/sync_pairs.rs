//! The workspace folders paired with a folder on a drive, each pair's status, and the worker that runs their rounds
//! (docs/developers/drives.md, "Two-way sync"). The round itself is in `drive_sync`.
//!
//! Pairs are kept in `drive-sync.json` in the data folder, each pair's base in `drive-sync/<id>.json`. The worker
//! looks every minute for local changes (by size and time only), asks the drive every 5 minutes, and runs at once on
//! Sync now. When the drive can't be reached it tries again after 1, 2, 5 and then every 10 minutes. A sign-in that
//! stopped working stops the pair until Sync now.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::drive_sync::{self, Base, DeletePlan, Report, RoundOptions};
use crate::drives::Drive;

type Res<T> = Result<T, String>;

/// At most this many pairs.
pub const MAX_PAIRS: usize = 20;
/// How often the worker looks for local changes, and how often it asks the drive.
const LOOK_HERE: Duration = Duration::from_secs(60);
const ASK_DRIVE_MS: u64 = 5 * 60 * 1000;
/// Waits after a round that could not reach the drive: 1, 2, 5, then every 10 minutes.
const RETRY_MINUTES: [u64; 4] = [1, 2, 5, 10];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SyncPair {
    pub id: String,
    /// The workspace folder, such as `notes`.
    pub folder: String,
    /// The drive's id (see `drives.json`).
    pub drive: String,
    /// The folder on the drive, such as `Notes`.
    pub remote: String,
    #[serde(default)]
    pub paused: bool,
    /// When the pair was made (ms): the agent's turns from before it never hold it.
    pub created: u64,
}

#[derive(Debug, Clone, Copy, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum State {
    #[default]
    Idle,
    Syncing,
    Offline,
    Paused,
    /// The drive no longer accepts the account's password.
    SignIn,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Conflict {
    pub path: String,
    pub copy: String,
}

/// What Files shows for a pair.
#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub state: State,
    pub done: usize,
    pub total: usize,
    pub last_sync: Option<u64>,
    pub retry_at: Option<u64>,
    /// Files the agent changed that wait for Keep.
    pub held: Vec<String>,
    pub conflicts: Vec<Conflict>,
    /// Deletes waiting for a yes.
    pub ask: Option<DeletePlan>,
    pub too_big: Vec<String>,
    pub error: Option<String>,
}

/// What the worker needs from the rest of Mobius.
pub trait SyncHost: Send + Sync {
    fn drive(&self, id: &str) -> Res<Box<dyn Drive>>;
    /// The drive's name, for the checkpoint: "Before sync from Cloud".
    fn drive_name(&self, id: &str) -> Option<String>;
    /// The workspace folder on this computer.
    fn root(&self) -> Res<PathBuf>;
    /// Paths within `folder` the agent changed and the person hasn't kept, from turns since `since` (ms).
    fn held(&self, folder: &str, since: u64) -> Res<HashSet<String>>;
    fn checkpoint(&self, reason: &str) -> Res<()>;
    fn changed(&self, pair: &SyncPair, status: &Status);
    /// Workspace files a round changed here, so the apps showing them read them again.
    fn brought_in(&self, _paths: &[String]) {}
}

#[derive(Default)]
struct Inner {
    pairs: Vec<SyncPair>,
    status: HashMap<String, Status>,
    /// When each pair next asks the drive (ms).
    next: HashMap<String, u64>,
    /// Rounds in a row that could not reach the drive.
    failures: HashMap<String, usize>,
    /// Pairs to run at once.
    now: HashSet<String>,
    /// Pairs whose asked deletes got a yes.
    allow: HashSet<String>,
    /// Whether the worker runs.
    started: bool,
}

pub struct Syncs {
    file: PathBuf,
    bases: PathBuf,
    host: Arc<dyn SyncHost>,
    inner: Mutex<Inner>,
    wake: Condvar,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
}

fn new_id() -> String {
    let mut bytes = [0u8; 8];
    let _ = getrandom::fill(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// A workspace folder a pair may use: a path inside it, without `..`, hidden or private parts.
fn clean_folder(folder: &str) -> Option<String> {
    let folder = folder.replace('\\', "/");
    let folder = folder.trim_matches('/');
    let parts: Vec<&str> = folder.split('/').collect();
    let ok = !folder.is_empty()
        && folder.len() <= 512
        && parts.iter().all(|p| !p.is_empty() && *p != "." && *p != ".." && !p.starts_with('.') && !p.contains(':'));
    ok.then(|| folder.to_owned())
}

/// Whether one folder is the other or inside it.
fn overlaps(a: &str, b: &str) -> bool {
    a == b || a.starts_with(&format!("{b}/")) || b.starts_with(&format!("{a}/"))
}

impl Syncs {
    pub fn open(data_dir: &Path, host: Arc<dyn SyncHost>) -> Arc<Syncs> {
        let file = data_dir.join("drive-sync.json");
        let pairs: Vec<SyncPair> = std::fs::read_to_string(&file).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
        let mut inner = Inner::default();
        for pair in &pairs {
            let state = if pair.paused { State::Paused } else { State::Idle };
            inner.status.insert(pair.id.clone(), Status { state, ..Status::default() });
        }
        let any = !pairs.is_empty();
        inner.pairs = pairs;
        let syncs = Arc::new(Syncs { file, bases: data_dir.join("drive-sync"), host, inner: Mutex::new(inner), wake: Condvar::new() });
        if any {
            syncs.start();
        }
        syncs
    }

    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn save_pairs(&self, pairs: &[SyncPair]) {
        if let Ok(text) = serde_json::to_string_pretty(pairs) {
            let temp = self.file.with_extension("json.tmp");
            if std::fs::write(&temp, text).is_ok() {
                let _ = std::fs::rename(&temp, &self.file);
            }
        }
    }

    fn base_file(&self, id: &str) -> PathBuf {
        self.bases.join(format!("{id}.json"))
    }

    fn load_base(&self, id: &str) -> Base {
        std::fs::read_to_string(self.base_file(id)).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
    }

    fn save_base(&self, id: &str, base: &Base) {
        let _ = std::fs::create_dir_all(&self.bases);
        if let Ok(text) = serde_json::to_string(base) {
            let file = self.base_file(id);
            let temp = file.with_extension("json.tmp");
            if std::fs::write(&temp, text).is_ok() {
                let _ = std::fs::rename(&temp, &file);
            }
        }
    }

    fn pair_json(pair: &SyncPair, status: Option<&Status>) -> Value {
        let mut v = json!(pair);
        v["status"] = json!(status.cloned().unwrap_or_default());
        v
    }

    /// Every pair, with its status.
    pub fn pairs(&self) -> Value {
        let inner = self.lock();
        Value::Array(inner.pairs.iter().map(|p| Syncs::pair_json(p, inner.status.get(&p.id))).collect())
    }

    fn pair(&self, id: &str) -> Res<SyncPair> {
        self.lock().pairs.iter().find(|p| p.id == id).cloned().ok_or_else(|| "That folder is not synced any more.".to_owned())
    }

    /// Changes a pair's status and tells the window.
    fn set_status(&self, id: &str, change: impl FnOnce(&mut Status)) {
        let mut inner = self.lock();
        let Some(pair) = inner.pairs.iter().find(|p| p.id == id).cloned() else { return };
        let status = inner.status.entry(id.to_owned()).or_default();
        change(status);
        let status = status.clone();
        drop(inner);
        self.host.changed(&pair, &status);
    }

    /// Pairs a workspace folder with a folder on a drive. The first round runs at once.
    pub fn add(self: &Arc<Self>, folder: &str, drive: &str, remote: &str) -> Res<Value> {
        let folder = clean_folder(folder).ok_or("Choose a folder in the workspace.")?;
        let remote = remote.replace('\\', "/").trim_matches('/').to_owned();
        if remote.split('/').any(|p| p == "..") {
            return Err("Choose a folder on the drive.".into());
        }
        if self.host.drive_name(drive).is_none() {
            return Err("That drive is gone.".into());
        }
        {
            let inner = self.lock();
            if inner.pairs.len() >= MAX_PAIRS {
                return Err(format!("At most {MAX_PAIRS} folders can sync."));
            }
            if let Some(other) = inner.pairs.iter().find(|p| overlaps(&p.folder, &folder)) {
                return Err(format!("{} already syncs, and a folder syncs with one drive folder only.", other.folder));
            }
        }
        // The drive folder is made when it isn't there; one that is there is used as it is.
        let d = self.host.drive(drive)?;
        if !remote.is_empty() {
            let mut made = String::new();
            for part in remote.split('/') {
                made = if made.is_empty() { part.to_owned() } else { format!("{made}/{part}") };
                match d.make_folder(&made) {
                    Ok(()) => {}
                    // Already there (405), or another problem the first round will name.
                    Err(_) => continue,
                }
            }
        }
        let root = self.host.root()?.join(&folder);
        std::fs::create_dir_all(&root).map_err(|e| format!("The folder cannot be used: {e}"))?;
        let pair = SyncPair { id: new_id(), folder, drive: drive.to_owned(), remote, paused: false, created: now_ms() };
        let mut inner = self.lock();
        inner.pairs.push(pair.clone());
        inner.status.insert(pair.id.clone(), Status::default());
        inner.now.insert(pair.id.clone());
        self.save_pairs(&inner.pairs);
        drop(inner);
        self.start();
        self.wake.notify_all();
        Ok(Syncs::pair_json(&pair, Some(&Status::default())))
    }

    /// Stops syncing a folder. No file changes on either side.
    pub fn remove(&self, id: &str) -> Res<Value> {
        let mut inner = self.lock();
        let before = inner.pairs.len();
        inner.pairs.retain(|p| p.id != id);
        if inner.pairs.len() == before {
            return Err("That folder is not synced any more.".into());
        }
        inner.status.remove(id);
        inner.next.remove(id);
        self.save_pairs(&inner.pairs);
        drop(inner);
        let _ = std::fs::remove_file(self.base_file(id));
        Ok(json!({ "ok": true }))
    }

    /// Stops all of the drive's pairs, when the drive is removed.
    pub fn remove_drive(&self, drive: &str) {
        let ids: Vec<String> = self.lock().pairs.iter().filter(|p| p.drive == drive).map(|p| p.id.clone()).collect();
        for id in ids {
            let _ = self.remove(&id);
        }
    }

    pub fn pause(&self, id: &str, paused: bool) -> Res<Value> {
        let mut inner = self.lock();
        let pair = inner.pairs.iter_mut().find(|p| p.id == id).ok_or("That folder is not synced any more.")?;
        pair.paused = paused;
        let pairs = inner.pairs.clone();
        self.save_pairs(&pairs);
        if !paused {
            inner.now.insert(id.to_owned());
        }
        drop(inner);
        self.set_status(id, |s| {
            s.state = if paused { State::Paused } else { State::Idle };
            s.retry_at = None;
        });
        self.wake.notify_all();
        Ok(json!({ "ok": true }))
    }

    /// Runs a round at once, also after a sign-in problem or while offline.
    pub fn sync_now(&self, id: &str) -> Res<Value> {
        self.pair(id)?;
        let mut inner = self.lock();
        inner.now.insert(id.to_owned());
        inner.failures.remove(id);
        drop(inner);
        self.wake.notify_all();
        Ok(json!({ "ok": true }))
    }

    /// The yes to the deletes a round asked about.
    pub fn allow_deletes(&self, id: &str) -> Res<Value> {
        self.pair(id)?;
        let mut inner = self.lock();
        inner.allow.insert(id.to_owned());
        inner.now.insert(id.to_owned());
        drop(inner);
        self.wake.notify_all();
        Ok(json!({ "ok": true }))
    }

    /// The no: the files deleted on one side come back from the other. Forgetting them in the base makes the next round
    /// see each as new on the side that still has it.
    pub fn keep_them(&self, id: &str) -> Res<Value> {
        self.pair(id)?;
        let ask = self.lock().status.get(id).and_then(|s| s.ask.clone()).ok_or("There is nothing to keep.")?;
        let mut base = self.load_base(id);
        for path in ask.on_drive.iter().chain(&ask.here) {
            base.files.remove(path);
        }
        self.save_base(id, &base);
        self.set_status(id, |s| s.ask = None);
        self.lock().now.insert(id.to_owned());
        self.wake.notify_all();
        Ok(json!({ "ok": true }))
    }

    /// Settles a conflict. Mine: the copy takes the name, and is sent as the next version. Theirs: the copy goes.
    pub fn resolve(&self, id: &str, path: &str, keep: &str) -> Res<Value> {
        let pair = self.pair(id)?;
        let root = self.host.root()?.join(&pair.folder);
        let conflicts = drive_sync::conflicts_in(&root);
        let (_, copy) = conflicts.iter().find(|(p, _)| p == path).ok_or("That conflict is settled already.")?;
        match keep {
            "mine" => std::fs::rename(root.join(copy), root.join(path)).map_err(|e| e.to_string())?,
            "theirs" => std::fs::remove_file(root.join(copy)).map_err(|e| e.to_string())?,
            _ => return Err("Keep mine or theirs?".into()),
        }
        let left: Vec<Conflict> = drive_sync::conflicts_in(&root).into_iter().map(|(path, copy)| Conflict { path, copy }).collect();
        self.set_status(id, |s| s.conflicts = left);
        self.lock().now.insert(id.to_owned());
        self.wake.notify_all();
        Ok(json!({ "ok": true }))
    }

    /// The person kept some of the agent's changes: every pair looks again, so what was held is sent.
    pub fn kept(&self) {
        let mut inner = self.lock();
        let ids: Vec<String> = inner.pairs.iter().filter(|p| !p.paused).map(|p| p.id.clone()).collect();
        inner.now.extend(ids);
        drop(inner);
        self.wake.notify_all();
    }

    /// Whether `path` (a workspace path) is in a synced folder: Rewind says what it would change on drives.
    pub fn synced_folder(&self, path: &str) -> Option<String> {
        let path = path.replace('\\', "/");
        self.lock().pairs.iter().find(|p| path.starts_with(&format!("{}/", p.folder))).map(|p| p.drive.clone())
    }

    fn start(self: &Arc<Self>) {
        let mut inner = self.lock();
        if inner.started {
            return;
        }
        inner.started = true;
        drop(inner);
        let me = Arc::clone(self);
        let _ = std::thread::Builder::new().name("drive-sync".into()).spawn(move || me.work());
    }

    /// The worker: one round at a time, whichever pair is due.
    fn work(&self) {
        loop {
            let due = self.next_due();
            match due {
                Some(pair) => self.run(&pair),
                None => {
                    let inner = self.lock();
                    if inner.now.is_empty() {
                        let wait = inner
                            .pairs
                            .iter()
                            .filter_map(|p| inner.next.get(&p.id))
                            .map(|at| Duration::from_millis(at.saturating_sub(now_ms())))
                            .min()
                            .unwrap_or(LOOK_HERE)
                            .clamp(Duration::from_millis(50), LOOK_HERE);
                        drop(self.wake.wait_timeout(inner, wait).unwrap_or_else(PoisonError::into_inner));
                    }
                    // Each minute, or when woken: a pair whose folder changed here is due.
                    let candidates: Vec<SyncPair> = self.lock().pairs.iter().filter(|p| !p.paused).cloned().collect();
                    if let Ok(root) = self.host.root() {
                        for pair in candidates {
                            let state = self.lock().status.get(&pair.id).map(|s| s.state);
                            if matches!(state, Some(State::Offline | State::SignIn)) {
                                continue;
                            }
                            if drive_sync::changed_here(&root.join(&pair.folder), &self.load_base(&pair.id)) {
                                self.lock().now.insert(pair.id);
                            }
                        }
                    }
                }
            }
        }
    }

    /// The pair to run now, if any: asked for, or due to ask the drive.
    fn next_due(&self) -> Option<SyncPair> {
        let mut inner = self.lock();
        let now = now_ms();
        let pair = inner
            .pairs
            .iter()
            .find(|p| inner.now.contains(&p.id) || (!p.paused && inner.next.get(&p.id).is_none_or(|at| *at <= now)))
            .cloned()?;
        inner.now.remove(&pair.id);
        Some(pair)
    }

    fn run(&self, pair: &SyncPair) {
        if pair.paused {
            return;
        }
        self.set_status(&pair.id, |s| {
            s.state = State::Syncing;
            s.done = 0;
            s.total = 0;
        });
        let outcome = self.round(pair);
        let now = now_ms();
        let mut inner = self.lock();
        match outcome {
            Ok(report) => {
                let here: Vec<String> = report
                    .downloaded
                    .iter()
                    .chain(&report.deleted_here)
                    .chain(report.conflicts.iter().flat_map(|(path, copy)| [path, copy]))
                    .map(|p| format!("{}/{p}", pair.folder))
                    .collect();
                if !here.is_empty() {
                    self.host.brought_in(&here);
                }
                inner.failures.remove(&pair.id);
                inner.next.insert(pair.id.clone(), now + ASK_DRIVE_MS);
                drop(inner);
                let root = self.host.root().map(|r| r.join(&pair.folder));
                let conflicts = root.map(|r| drive_sync::conflicts_in(&r)).unwrap_or_default().into_iter().map(|(path, copy)| Conflict { path, copy }).collect();
                self.set_status(&pair.id, |s| {
                    s.state = State::Idle;
                    s.retry_at = None;
                    s.last_sync = Some(now);
                    s.held = report.held;
                    s.conflicts = conflicts;
                    s.ask = report.ask;
                    s.too_big = report.too_big;
                    s.error = match report.failed.as_slice() {
                        [] => None,
                        [(path, e)] => Some(format!("{path}: {e}")),
                        [(path, e), rest @ ..] => Some(format!("{path}: {e} (and {} more)", rest.len())),
                    };
                });
            }
            Err(e) if e.starts_with("The server did not accept") => {
                // The password stopped working: no more rounds until Sync now.
                inner.next.insert(pair.id.clone(), u64::MAX);
                drop(inner);
                self.set_status(&pair.id, |s| {
                    s.state = State::SignIn;
                    s.retry_at = None;
                    s.error = Some(e);
                });
            }
            Err(e) => {
                let n = inner.failures.entry(pair.id.clone()).or_default();
                let wait = RETRY_MINUTES[(*n).min(RETRY_MINUTES.len() - 1)] * 60 * 1000;
                *n += 1;
                inner.next.insert(pair.id.clone(), now + wait);
                drop(inner);
                self.set_status(&pair.id, |s| {
                    s.state = State::Offline;
                    s.retry_at = Some(now + wait);
                    s.error = Some(e);
                });
            }
        }
    }

    fn round(&self, pair: &SyncPair) -> Res<Report> {
        let drive = self.host.drive(&pair.drive)?;
        let root = self.host.root()?.join(&pair.folder);
        let held = self.host.held(&pair.folder, pair.created)?;
        let allow_deletes = self.lock().allow.remove(&pair.id);
        let stamp = chrono::Local::now().format("%Y-%m-%d %H.%M").to_string();
        let name = self.host.drive_name(&pair.drive).unwrap_or_else(|| "a drive".into());
        let checkpoint = || self.host.checkpoint(&format!("Before sync from {name}"));
        let progress = |done: usize, total: usize| {
            self.set_status(&pair.id, |s| {
                s.done = done;
                s.total = total;
            });
        };
        let options = RoundOptions { held, allow_deletes, stamp: &stamp, before_here: Some(&checkpoint), progress: Some(&progress) };
        let mut base = self.load_base(&pair.id);
        let result = drive_sync::round(drive.as_ref(), &root, &pair.remote, &mut base, &options, &mut |b| self.save_base(&pair.id, b));
        self.save_base(&pair.id, &base);
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::drives::WebDav;
    use crate::drives::tests::{Store, server};

    struct Host {
        drive_url: String,
        root: PathBuf,
        held: Mutex<HashSet<String>>,
        checkpoints: Mutex<Vec<String>>,
        statuses: Mutex<Vec<(String, Status)>>,
        offline: std::sync::atomic::AtomicBool,
    }

    impl SyncHost for Host {
        fn drive(&self, id: &str) -> Res<Box<dyn Drive>> {
            if self.offline.load(std::sync::atomic::Ordering::SeqCst) {
                return Err("Could not reach the server.".into());
            }
            if id != "d1" {
                return Err("That drive is gone.".into());
            }
            Ok(Box::new(WebDav::new(url::Url::parse(&self.drive_url).unwrap(), "ana", "app-pass")))
        }
        fn drive_name(&self, id: &str) -> Option<String> {
            (id == "d1").then(|| "Cloud".to_owned())
        }
        fn root(&self) -> Res<PathBuf> {
            Ok(self.root.clone())
        }
        fn held(&self, _folder: &str, _since: u64) -> Res<HashSet<String>> {
            Ok(self.held.lock().unwrap().clone())
        }
        fn checkpoint(&self, reason: &str) -> Res<()> {
            self.checkpoints.lock().unwrap().push(reason.to_owned());
            Ok(())
        }
        fn changed(&self, pair: &SyncPair, status: &Status) {
            self.statuses.lock().unwrap().push((pair.id.clone(), status.clone()));
        }
    }

    fn setup() -> (Arc<Syncs>, Arc<Host>, Store, tempfile::TempDir) {
        let (address, store) = server("/dav/");
        let dir = tempfile::tempdir().unwrap();
        let host = Arc::new(Host {
            drive_url: format!("{address}/dav/"),
            root: dir.path().join("workspace"),
            held: Mutex::default(),
            checkpoints: Mutex::default(),
            statuses: Mutex::default(),
            offline: std::sync::atomic::AtomicBool::new(false),
        });
        let syncs = Syncs::open(dir.path(), host.clone());
        (syncs, host, store, dir)
    }

    /// Waits until the pair's status says `ok`.
    fn until(syncs: &Syncs, id: &str, what: &str, ok: impl Fn(&Status) -> bool) -> Status {
        for _ in 0..400 {
            if let Some(s) = syncs.lock().status.get(id).filter(|s| ok(s)) {
                return s.clone();
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        panic!("waited for {what}: {:?}", syncs.lock().status.get(id));
    }

    fn there(store: &Store, rel: &str) -> Option<String> {
        store.lock().unwrap().get(&format!("/dav/{rel}")).map(|(b, _)| String::from_utf8_lossy(b).into_owned())
    }

    #[test]
    fn a_paired_folder_syncs_at_once_and_keeps_its_pairing() {
        let (syncs, host, store, dir) = setup();
        std::fs::create_dir_all(host.root.join("notes")).unwrap();
        std::fs::write(host.root.join("notes/plan.md"), "# Plan").unwrap();
        let pair = syncs.add("notes", "d1", "Cloud/Notes").unwrap();
        let id = pair["id"].as_str().unwrap().to_owned();
        assert_eq!((pair["folder"].as_str(), pair["status"]["state"].as_str()), (Some("notes"), Some("idle")));
        let s = until(&syncs, &id, "the first round", |s| s.last_sync.is_some());
        assert_eq!(s.state, State::Idle);
        assert_eq!(there(&store, "Cloud/Notes/plan.md").as_deref(), Some("# Plan"));
        assert!(host.statuses.lock().unwrap().iter().any(|(_, s)| s.state == State::Syncing));
        // Nothing came in, so no checkpoint.
        assert!(host.checkpoints.lock().unwrap().is_empty());
        // Folders that overlap, a missing drive, and a folder outside the workspace are refused.
        assert!(syncs.add("notes/trips", "d1", "x").is_err());
        assert!(syncs.add("other", "d9", "x").is_err());
        assert!(syncs.add("../out", "d1", "x").is_err());
        // Still paired after Mobius opens again.
        let again = Syncs::open(dir.path(), host.clone());
        assert_eq!(again.pairs()[0]["remote"], "Cloud/Notes");
        syncs.remove(&id).unwrap();
        assert_eq!(syncs.pairs(), json!([]));
        assert!(host.root.join("notes/plan.md").exists() && there(&store, "Cloud/Notes/plan.md").is_some(), "removing changes no files");
    }

    #[test]
    fn what_comes_in_is_checkpointed_held_files_wait_and_conflicts_settle() {
        let (syncs, host, store, _dir) = setup();
        std::fs::create_dir_all(host.root.join("notes")).unwrap();
        std::fs::write(host.root.join("notes/plan.md"), "one").unwrap();
        let id = syncs.add("notes", "d1", "Notes").unwrap()["id"].as_str().unwrap().to_owned();
        until(&syncs, &id, "the first round", |s| s.last_sync.is_some());

        // Someone else adds a file: it comes in after a checkpoint named for the drive.
        store.lock().unwrap().insert("/dav/Notes/theirs.md".into(), (b"hi".to_vec(), 900));
        let before = syncs.lock().status[&id].last_sync;
        syncs.sync_now(&id).unwrap();
        until(&syncs, &id, "the second round", |s| s.last_sync != before && s.state == State::Idle);
        assert_eq!(std::fs::read_to_string(host.root.join("notes/theirs.md")).unwrap(), "hi");
        assert_eq!(host.checkpoints.lock().unwrap().as_slice(), ["Before sync from Cloud"]);

        // The agent's change waits for Keep.
        std::thread::sleep(Duration::from_millis(20));
        std::fs::write(host.root.join("notes/plan.md"), "agent").unwrap();
        host.held.lock().unwrap().insert("plan.md".into());
        let before = syncs.lock().status[&id].last_sync;
        syncs.sync_now(&id).unwrap();
        let s = until(&syncs, &id, "the held round", |s| s.last_sync != before && s.state == State::Idle);
        assert_eq!(s.held, ["plan.md"]);
        assert_eq!(there(&store, "Notes/plan.md").as_deref(), Some("one"));

        // Kept, and changed on the drive meanwhile: a conflict, settled as mine.
        host.held.lock().unwrap().clear();
        store.lock().unwrap().insert("/dav/Notes/plan.md".into(), (b"theirs".to_vec(), 901));
        let before = syncs.lock().status[&id].last_sync;
        syncs.sync_now(&id).unwrap();
        let s = until(&syncs, &id, "the conflict", |s| s.last_sync != before && s.state == State::Idle);
        assert_eq!(s.conflicts.len(), 1);
        assert_eq!(s.conflicts[0].path, "plan.md");
        syncs.resolve(&id, "plan.md", "mine").unwrap();
        until(&syncs, &id, "mine sent", |s| s.conflicts.is_empty() && s.state == State::Idle);
        for _ in 0..200 {
            if there(&store, "Notes/plan.md").as_deref() == Some("agent") {
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(there(&store, "Notes/plan.md").as_deref(), Some("agent"));
        assert!(syncs.resolve(&id, "plan.md", "mine").is_err());
    }

    #[test]
    fn offline_waits_longer_each_time_and_a_pause_stops_rounds() {
        let (syncs, host, _store, _dir) = setup();
        let id = syncs.add("notes", "d1", "Notes").unwrap()["id"].as_str().unwrap().to_owned();
        until(&syncs, &id, "the first round", |s| s.last_sync.is_some());
        host.offline.store(true, std::sync::atomic::Ordering::SeqCst);
        syncs.lock().failures.insert(id.clone(), 1);
        let started = now_ms();
        // Sync now clears the count: the first wait is a minute.
        syncs.sync_now(&id).unwrap();
        let s = until(&syncs, &id, "offline", |s| s.state == State::Offline);
        let wait = s.retry_at.unwrap() - started;
        assert!((60_000..70_000).contains(&wait), "{wait}");
        syncs.lock().now.insert(id.clone());
        syncs.wake.notify_all();
        let s = until(&syncs, &id, "offline again", |s| s.retry_at.is_some_and(|r| r - started >= 120_000));
        assert!(s.retry_at.unwrap() - started < 130_000);
        host.offline.store(false, std::sync::atomic::Ordering::SeqCst);
        syncs.pause(&id, true).unwrap();
        assert_eq!(syncs.lock().status[&id].state, State::Paused);
        syncs.lock().now.insert(id.clone());
        syncs.wake.notify_all();
        std::thread::sleep(Duration::from_millis(100));
        assert_eq!(syncs.lock().status[&id].state, State::Paused, "a paused pair does not run");
        syncs.pause(&id, false).unwrap();
        until(&syncs, &id, "resumed", |s| s.state == State::Idle && s.retry_at.is_none());
    }
}
