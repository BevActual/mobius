//! Snapshots of a folder in one shared shadow git store.
//!
//! The store is a bare git directory; each folder gets its own branch (`refs/mobius/<id>`) and its own index file, so
//! identical files are stored once however many folders there are. The folder is the git work tree but gets no `.git`.
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};

/// Never snapshotted: build output, caches, environments, other version control, big binaries.
pub const DEFAULT_EXCLUDES: &[&str] = &[
    "node_modules/", "dist/", "build/", "target/", "out/", ".next/", ".nuxt/", "__pycache__/", "*.pyc", ".cache/", ".venv/", "venv/", ".git/", ".hg/", ".svn/",
    // An app's own record of the versions it kept (Docs, Research, Reading): theirs, not part of what a turn changed.
    ".versions/",
    "*.so", "*.dylib", "*.dll", "*.o", "*.a", "*.jar", "*.class", "*.exe", "*.obj", "*.mp4", "*.mov", "*.mkv", "*.webm", "*.zip", "*.tar", "*.gz", "*.7z", "*.rar",
];

/// One saved state of a folder.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Checkpoint {
    pub id: String,
    /// Seconds since 1970.
    pub when: u64,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Error {
    /// git is not installed or could not run.
    NoGit,
    /// The folder is missing, is not a folder, or contains the store.
    BadFolder(String),
    /// The checkpoint id or file path is not acceptable.
    BadInput(String),
    /// git refused; the text is what it said.
    Git(String),
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Error::NoGit => write!(f, "git is needed for checkpoints and was not found"),
            Error::BadFolder(m) | Error::BadInput(m) | Error::Git(m) => write!(f, "{m}"),
        }
    }
}
impl std::error::Error for Error {}

pub struct Checkpoints {
    store: PathBuf,
}

/// A checkpoint id is the hex of a git commit.
pub fn is_checkpoint_id(v: &str) -> bool {
    (4..=40).contains(&v.len()) && v.bytes().all(|b| b.is_ascii_hexdigit())
}

/// A path inside the folder: relative, no `..`, no drive or root, no control characters. Paths use `/` on every
/// system, and a backslash or a drive letter is refused everywhere, so a path means the same on Linux as on Windows
/// (where `..\x` and `C:/x` would leave the folder).
pub fn is_inner_path(v: &str) -> bool {
    !v.is_empty()
        && !v.chars().any(char::is_control)
        && !v.contains('\\')
        && !v.split('/').next().is_some_and(|first| first.len() >= 2 && first.as_bytes()[1] == b':')
        && Path::new(v).components().all(|c| matches!(c, Component::Normal(_)))
        && !v.starts_with('-')
}

fn plain(path: &Path) -> PathBuf {
    let text = path.to_string_lossy();
    PathBuf::from(text.strip_prefix(r"\\?\").unwrap_or(&text).to_owned())
}

fn folder_id(folder: &Path) -> String {
    let text = folder.to_string_lossy().replace('\\', "/");
    let text = if cfg!(windows) { text.to_lowercase() } else { text };
    let (mut a, mut b) = (0xcbf2_9ce4_8422_2325_u64, 0x8422_2325_cbf2_9ce4_u64);
    for byte in text.bytes() {
        a = (a ^ u64::from(byte)).wrapping_mul(0x0100_0000_01b3);
        b = (b.rotate_left(5) ^ u64::from(byte)).wrapping_mul(0x0100_0000_01b3);
    }
    format!("{a:016x}{b:016x}")
}

impl Checkpoints {
    pub fn new(store: impl Into<PathBuf>) -> Checkpoints {
        Checkpoints { store: store.into() }
    }

    fn git(&self, folder: &Path, id: &str, args: &[&str]) -> Result<String, Error> {
        let index = self.store.join("indexes").join(id);
        let output = quiet(Command::new("git"))
            .args(["-c", "core.autocrlf=false", "-c", "core.safecrlf=false", "-c", "core.quotepath=false", "-c", "core.hooksPath=NUL", "-c", "gc.auto=0"])
            .args(args)
            .env("GIT_DIR", &self.store)
            .env("GIT_WORK_TREE", folder)
            .env("GIT_INDEX_FILE", index)
            .env("GIT_AUTHOR_NAME", "Mobius")
            .env("GIT_AUTHOR_EMAIL", "mobius@localhost")
            .env("GIT_COMMITTER_NAME", "Mobius")
            .env("GIT_COMMITTER_EMAIL", "mobius@localhost")
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_TERMINAL_PROMPT", "0")
            .stdin(Stdio::null())
            .output()
            .map_err(|e| if e.kind() == std::io::ErrorKind::NotFound { Error::NoGit } else { Error::Git(e.to_string()) })?;
        if output.status.success() {
            Ok(String::from_utf8_lossy(&output.stdout).into_owned())
        } else {
            Err(Error::Git(String::from_utf8_lossy(&output.stderr).trim().to_owned()))
        }
    }

    fn prepare(&self, folder: &Path) -> Result<(PathBuf, String), Error> {
        let folder = std::fs::canonicalize(folder).map_err(|_| Error::BadFolder("That folder is not there.".into()))?;
        let folder = plain(&folder);
        if !folder.is_dir() {
            return Err(Error::BadFolder("That is not a folder.".into()));
        }
        std::fs::create_dir_all(self.store.join("indexes")).map_err(|e| Error::Git(e.to_string()))?;
        let store = plain(&std::fs::canonicalize(&self.store).map_err(|e| Error::Git(e.to_string()))?);
        if store.starts_with(&folder) {
            return Err(Error::BadFolder("The checkpoint store cannot be inside the folder it protects.".into()));
        }
        if !self.store.join("HEAD").exists() {
            let init = quiet(Command::new("git")).args(["init", "--bare", "--quiet"]).arg(&self.store).stdin(Stdio::null()).output().map_err(|e| if e.kind() == std::io::ErrorKind::NotFound { Error::NoGit } else { Error::Git(e.to_string()) })?;
            if !init.status.success() {
                return Err(Error::Git(String::from_utf8_lossy(&init.stderr).trim().to_owned()));
            }
            let info = self.store.join("info");
            std::fs::create_dir_all(&info).map_err(|e| Error::Git(e.to_string()))?;
            std::fs::write(info.join("exclude"), DEFAULT_EXCLUDES.join("\n") + "\n").map_err(|e| Error::Git(e.to_string()))?;
        } else {
            // A store made before an exclude was added gets it too.
            let file = self.store.join("info").join("exclude");
            let now = std::fs::read_to_string(&file).unwrap_or_default();
            let missing: Vec<&str> = DEFAULT_EXCLUDES.iter().copied().filter(|e| !now.lines().any(|l| l.trim() == *e)).collect();
            if !missing.is_empty() {
                let _ = std::fs::create_dir_all(self.store.join("info"));
                let gap = if now.is_empty() || now.ends_with('\n') { "" } else { "\n" };
                let _ = std::fs::write(&file, format!("{now}{gap}{}\n", missing.join("\n")));
            }
        }
        let id = folder_id(&folder);
        Ok((folder, id))
    }

    fn tip(&self, folder: &Path, id: &str) -> Option<String> {
        self.git(folder, id, &["rev-parse", "--verify", "--quiet", &format!("refs/mobius/{id}^{{commit}}")]).ok().map(|s| s.trim().to_owned()).filter(|s| !s.is_empty())
    }

    /// Saves the folder as it is now. `None` when nothing changed since the last checkpoint.
    pub fn snapshot(&self, folder: &Path, reason: &str) -> Result<Option<Checkpoint>, Error> {
        let _one = one_at_a_time();
        let (folder, id) = self.prepare(folder)?;
        self.git(&folder, &id, &["add", "-A", "--", "."])?;
        let tree = self.git(&folder, &id, &["write-tree"])?.trim().to_owned();
        let parent = self.tip(&folder, &id);
        if let Some(parent) = &parent {
            let before = self.git(&folder, &id, &["rev-parse", &format!("{parent}^{{tree}}")])?;
            if before.trim() == tree {
                return Ok(None);
            }
        }
        let message: String = reason.chars().filter(|c| !c.is_control()).take(200).collect();
        let mut args = vec!["commit-tree", tree.as_str(), "-m", message.as_str()];
        if let Some(parent) = parent.as_deref() {
            args.extend(["-p", parent]);
        }
        let commit = self.git(&folder, &id, &args)?.trim().to_owned();
        self.git(&folder, &id, &["update-ref", &format!("refs/mobius/{id}"), &commit])?;
        Ok(Some(Checkpoint { id: commit, when: now(), reason: message }))
    }

    /// Newest first, at most `limit` (never more than 500).
    pub fn list(&self, folder: &Path, limit: usize) -> Result<Vec<Checkpoint>, Error> {
        let _one = one_at_a_time();
        let (folder, id) = self.prepare(folder)?;
        if self.tip(&folder, &id).is_none() {
            return Ok(Vec::new());
        }
        let count = limit.clamp(1, 500).to_string();
        let out = self.git(&folder, &id, &["log", &format!("refs/mobius/{id}"), "-n", &count, "--format=%H%x1f%ct%x1f%s"])?;
        Ok(out
            .lines()
            .filter_map(|line| {
                let mut parts = line.splitn(3, '\u{1f}');
                Some(Checkpoint { id: parts.next()?.to_owned(), when: parts.next()?.parse().ok()?, reason: parts.next().unwrap_or_default().to_owned() })
            })
            .collect())
    }

    fn known(&self, folder: &Path, id: &str, checkpoint: &str) -> Result<String, Error> {
        if !is_checkpoint_id(checkpoint) {
            return Err(Error::BadInput("That is not a checkpoint.".into()));
        }
        // Once found on this folder's branch, a checkpoint stays there: the branch only ever grows.
        let memo = format!("{}|{id}|{checkpoint}", self.store.display());
        if let Some(full) = memo_get(&KNOWN, &memo) {
            return Ok(full);
        }
        let full =self.git(folder, id, &["rev-parse", "--verify", "--quiet", &format!("{checkpoint}^{{commit}}")]).map_err(|_| Error::BadInput("That checkpoint is not there.".into()))?.trim().to_owned();
        // It must belong to this folder: reachable from this folder's branch.
        let tip = self.tip(folder, id).ok_or_else(|| Error::BadInput("This folder has no checkpoints.".into()))?;
        let merge_base = self.git(folder, id, &["merge-base", "--is-ancestor", &full, &tip]);
        if merge_base.is_err() {
            return Err(Error::BadInput("That checkpoint belongs to another folder.".into()));
        }
        memo_put(&KNOWN, memo, full.clone());
        Ok(full)
    }

    /// Puts the whole folder back as it was at `checkpoint`. What is there now is saved first, so this can be undone too.
    pub fn restore(&self, folder: &Path, checkpoint: &str) -> Result<(), Error> {
        let _one = one_at_a_time();
        let (folder, id) = self.prepare(folder)?;
        let target = self.known(&folder, &id, checkpoint)?;
        let before = self.snapshot(&folder, "before restoring an earlier checkpoint")?;
        let head = before.map(|c| c.id).or_else(|| self.tip(&folder, &id)).ok_or_else(|| Error::Git("nothing to compare with".into()))?;
        let now_files = self.git(&folder, &id, &["ls-tree", "-r", "--name-only", "-z", &head])?;
        let then_files: std::collections::HashSet<String> = self.git(&folder, &id, &["ls-tree", "-r", "--name-only", "-z", &target])?.split('\0').map(str::to_owned).collect();
        for path in now_files.split('\0').filter(|p| !p.is_empty() && !then_files.contains(*p)) {
            if is_inner_path(path) {
                let _ = std::fs::remove_file(folder.join(path));
            }
        }
        self.git(&folder, &id, &["read-tree", &target])?;
        self.git(&folder, &id, &["checkout-index", "-a", "-f"])?;
        Ok(())
    }

    /// Puts one file back as it was at `checkpoint`: recreated if it was deleted since, removed if it was made since.
    pub fn restore_file(&self, folder: &Path, checkpoint: &str, path: &str) -> Result<(), Error> {
        let _one = one_at_a_time();
        if !is_inner_path(path) {
            return Err(Error::BadInput("That path is not inside the folder.".into()));
        }
        let (folder, id) = self.prepare(folder)?;
        let target = self.known(&folder, &id, checkpoint)?;
        self.snapshot(&folder, &format!("before restoring {path}"))?;
        if self.git(&folder, &id, &["cat-file", "-e", &format!("{target}:{path}")]).is_err() {
            let file = folder.join(path);
            if file.is_file() {
                std::fs::remove_file(&file).map_err(|e| Error::Git(e.to_string()))?;
            }
            return Ok(());
        }
        self.git(&folder, &id, &["checkout", &target, "--", path])?;
        Ok(())
    }

    /// A file's text as it was at `checkpoint`; `None` when it was not there then (or is not text).
    pub fn read_at(&self, folder: &Path, checkpoint: &str, path: &str) -> Result<Option<String>, Error> {
        let _one = one_at_a_time();
        if !is_inner_path(path) {
            return Err(Error::BadInput("That path is not inside the folder.".into()));
        }
        let (folder, id) = self.prepare(folder)?;
        let target = self.known(&folder, &id, checkpoint)?;
        match self.git(&folder, &id, &["cat-file", "blob", &format!("{target}:{path}")]) {
            Ok(text) => Ok(Some(text)),
            Err(_) => Ok(None),
        }
    }

    /// Files that differ between two checkpoints.
    pub fn changed_between(&self, folder: &Path, from: &str, to: &str) -> Result<Vec<String>, Error> {
        let _one = one_at_a_time();
        let (folder, id) = self.prepare(folder)?;
        let a = self.known(&folder, &id, from)?;
        let b = self.known(&folder, &id, to)?;
        // Two saved states never change, so neither does what differs between them.
        let memo = format!("{}|{a}|{b}", self.store.display());
        if let Some(files) = memo_get(&BETWEEN, &memo) {
            return Ok(files);
        }
        let out = self.git(&folder, &id, &["diff-tree", "-r", "--name-only", "-z", &a, &b])?;
        let files: Vec<String> = out.split('\0').filter(|p| !p.is_empty()).map(str::to_owned).collect();
        memo_put(&BETWEEN, memo, files.clone());
        Ok(files)
    }

    /// Files that differ between `checkpoint` and the folder now: added, changed or removed since.
    pub fn changed_since(&self, folder: &Path, checkpoint: &str) -> Result<Vec<String>, Error> {
        // Several parts of the window ask this at once after a change (the strip, each app's bar, Activity, Review),
        // and each answer takes a few git commands, one at a time. An answer worked out after this call arrived saw
        // the folder as it is for this call too, so it is shared; an older one is not.
        let asked = std::time::Instant::now();
        let _one = one_at_a_time();
        let (folder, id) = self.prepare(folder)?;
        let target = self.known(&folder, &id, checkpoint)?;
        let memo = format!("{}|{id}|{target}", self.store.display());
        if let Some((worked_out, files)) = memo_get(&SINCE, &memo) {
            if worked_out >= asked {
                return Ok(files);
            }
        }
        let started = std::time::Instant::now();
        self.git(&folder, &id, &["add", "-A", "--", "."])?;
        let tree = self.git(&folder, &id, &["write-tree"])?.trim().to_owned();
        let out = self.git(&folder, &id, &["diff-tree", "-r", "--name-only", "-z", &target, &tree])?;
        let files: Vec<String> = out.split('\0').filter(|p| !p.is_empty()).map(str::to_owned).collect();
        memo_put(&SINCE, memo, (started, files.clone()));
        Ok(files)
    }
}

/// Answers kept between calls: checkpoints already found on a folder's branch, what differs between two checkpoints,
/// and the latest answer to what changed since a checkpoint, with when it was worked out.
type Memo<T> = std::sync::Mutex<Option<std::collections::HashMap<String, T>>>;
static KNOWN: Memo<String> = std::sync::Mutex::new(None);
static BETWEEN: Memo<Vec<String>> = std::sync::Mutex::new(None);
static SINCE: Memo<(std::time::Instant, Vec<String>)> = std::sync::Mutex::new(None);

fn memo_get<T: Clone>(memo: &'static Memo<T>, key: &str) -> Option<T> {
    memo.lock().unwrap_or_else(std::sync::PoisonError::into_inner).as_ref().and_then(|m| m.get(key).cloned())
}

/// Keeps an answer. The memo is emptied now and then, so it cannot grow without end.
fn memo_put<T>(memo: &'static Memo<T>, key: String, value: T) {
    let mut guard = memo.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    if guard.as_ref().is_some_and(|m| m.len() > 4096) {
        *guard = None;
    }
    guard.get_or_insert_with(std::collections::HashMap::new).insert(key, value);
}

/// Every checkpoint operation in this process runs one at a time. Notes, Tasks and the agent's file tools each have
/// their own `Checkpoints` over the same store and index, and two git commands at once fail on git's index lock: a turn
/// whose mark failed that way had nothing to review or undo. An operation that calls another keeps the lock it has.
static STORE: std::sync::Mutex<()> = std::sync::Mutex::new(());
thread_local! { static HELD: std::cell::Cell<bool> = const { std::cell::Cell::new(false) }; }

/// Git run with no console window of its own. The app's window has no console, so on Windows each run would otherwise
/// open one: slow on a busy computer, and a window flashing up at the start of every turn. As every other git run here.
fn quiet(mut command: Command) -> Command {
    #[cfg(windows)]
    std::os::windows::process::CommandExt::creation_flags(&mut command, 0x0800_0000);
    command
}

struct OneAtATime(Option<std::sync::MutexGuard<'static, ()>>);

fn one_at_a_time() -> OneAtATime {
    if HELD.with(std::cell::Cell::get) {
        return OneAtATime(None);
    }
    let guard = STORE.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    HELD.with(|h| h.set(true));
    OneAtATime(Some(guard))
}

impl Drop for OneAtATime {
    fn drop(&mut self) {
        if self.0.is_some() {
            HELD.with(|h| h.set(false));
        }
    }
}

fn now() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    struct Setup {
        _root: tempfile::TempDir,
        folder: PathBuf,
        cp: Checkpoints,
    }

    fn setup() -> Setup {
        let root = tempfile::tempdir().unwrap();
        let folder = root.path().join("notes");
        fs::create_dir_all(&folder).unwrap();
        let cp = Checkpoints::new(root.path().join("store"));
        Setup { _root: root, folder, cp }
    }

    fn write(folder: &Path, name: &str, text: &str) {
        let path = folder.join(name);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }
    fn read(folder: &Path, name: &str) -> Option<String> {
        fs::read_to_string(folder.join(name)).ok()
    }

    #[test]
    fn many_asking_at_once_share_an_answer_but_never_one_from_before_they_asked() {
        let s = setup();
        write(&s.folder, "a.md", "a");
        let start = s.cp.snapshot(&s.folder, "start").unwrap().unwrap();
        write(&s.folder, "b.md", "b");
        let answers: Vec<Vec<String>> = std::thread::scope(|scope| {
            let asks: Vec<_> = (0..6).map(|_| scope.spawn(|| s.cp.changed_since(&s.folder, &start.id).unwrap())).collect();
            asks.into_iter().map(|a| a.join().unwrap()).collect()
        });
        assert!(answers.iter().all(|a| a == &vec!["b.md".to_owned()]), "{answers:?}");
        // A change after those answers is seen by the next question, not hidden by the kept answer.
        write(&s.folder, "c.md", "c");
        let mut next = s.cp.changed_since(&s.folder, &start.id).unwrap();
        next.sort();
        assert_eq!(next, ["b.md", "c.md"]);
        // And what differs between two saved states is the same however often it is asked.
        let end = s.cp.snapshot(&s.folder, "end").unwrap().unwrap();
        assert_eq!(s.cp.changed_between(&s.folder, &start.id, &end.id).unwrap().len(), 2);
        assert_eq!(s.cp.changed_between(&s.folder, &start.id, &end.id).unwrap().len(), 2);
    }

    #[test]
    fn a_snapshot_is_listed_newest_first_and_an_unchanged_folder_makes_none() {
        let s = setup();
        write(&s.folder, "a.md", "one");
        let first = s.cp.snapshot(&s.folder, "first").unwrap().unwrap();
        assert_eq!(s.cp.snapshot(&s.folder, "again").unwrap(), None, "nothing changed");
        write(&s.folder, "a.md", "two");
        let second = s.cp.snapshot(&s.folder, "second").unwrap().unwrap();
        let listed = s.cp.list(&s.folder, 10).unwrap();
        assert_eq!(listed.iter().map(|c| c.reason.as_str()).collect::<Vec<_>>(), vec!["second", "first"]);
        assert_eq!((listed[0].id.clone(), listed[1].id.clone()), (second.id, first.id));
        assert!(listed[0].when > 1_700_000_000);
    }

    #[test]
    fn a_folder_with_no_checkpoints_lists_none() {
        let s = setup();
        assert_eq!(s.cp.list(&s.folder, 10).unwrap(), vec![]);
    }

    #[test]
    fn restore_brings_back_changed_and_deleted_files_and_removes_added_ones() {
        let s = setup();
        write(&s.folder, "a.md", "original");
        write(&s.folder, "sub/b.md", "keep me");
        let start = s.cp.snapshot(&s.folder, "start").unwrap().unwrap();
        write(&s.folder, "a.md", "the agent rewrote this");
        fs::remove_file(s.folder.join("sub/b.md")).unwrap();
        write(&s.folder, "new.md", "added by the agent");
        s.cp.restore(&s.folder, &start.id).unwrap();
        assert_eq!(read(&s.folder, "a.md").as_deref(), Some("original"));
        assert_eq!(read(&s.folder, "sub/b.md").as_deref(), Some("keep me"));
        assert_eq!(read(&s.folder, "new.md"), None);
    }

    #[test]
    fn a_restore_can_itself_be_undone() {
        let s = setup();
        write(&s.folder, "a.md", "v1");
        let v1 = s.cp.snapshot(&s.folder, "v1").unwrap().unwrap();
        write(&s.folder, "a.md", "v2 not yet saved");
        s.cp.restore(&s.folder, &v1.id).unwrap();
        assert_eq!(read(&s.folder, "a.md").as_deref(), Some("v1"));
        let listed = s.cp.list(&s.folder, 10).unwrap();
        assert_eq!(listed[0].reason, "before restoring an earlier checkpoint", "the work in progress was saved before it was replaced");
        s.cp.restore(&s.folder, &listed[0].id).unwrap();
        assert_eq!(read(&s.folder, "a.md").as_deref(), Some("v2 not yet saved"));
    }

    #[test]
    fn one_file_can_be_restored_without_touching_the_others() {
        let s = setup();
        write(&s.folder, "a.md", "a1");
        write(&s.folder, "b.md", "b1");
        let cp1 = s.cp.snapshot(&s.folder, "one").unwrap().unwrap();
        write(&s.folder, "a.md", "a2");
        write(&s.folder, "b.md", "b2");
        s.cp.restore_file(&s.folder, &cp1.id, "a.md").unwrap();
        assert_eq!((read(&s.folder, "a.md").as_deref(), read(&s.folder, "b.md").as_deref()), (Some("a1"), Some("b2")));
        fs::remove_file(s.folder.join("b.md")).unwrap();
        s.cp.restore_file(&s.folder, &cp1.id, "b.md").unwrap();
        assert_eq!(read(&s.folder, "b.md").as_deref(), Some("b1"), "a deleted file comes back");
    }

    #[test]
    fn what_changed_since_a_checkpoint_is_listed() {
        let s = setup();
        write(&s.folder, "a.md", "a");
        write(&s.folder, "b.md", "b");
        let start = s.cp.snapshot(&s.folder, "start").unwrap().unwrap();
        assert_eq!(s.cp.changed_since(&s.folder, &start.id).unwrap(), Vec::<String>::new());
        write(&s.folder, "a.md", "changed");
        write(&s.folder, "c.md", "new");
        fs::remove_file(s.folder.join("b.md")).unwrap();
        let mut changed = s.cp.changed_since(&s.folder, &start.id).unwrap();
        changed.sort();
        assert_eq!(changed, vec!["a.md", "b.md", "c.md"]);
    }

    #[test]
    fn the_folders_own_git_and_build_output_are_never_touched_or_saved() {
        let s = setup();
        write(&s.folder, "a.md", "a");
        write(&s.folder, ".git/config", "secret repo state");
        write(&s.folder, "node_modules/x/index.js", "junk");
        write(&s.folder, "tool.exe", "binary");
        let start = s.cp.snapshot(&s.folder, "start").unwrap().unwrap();
        write(&s.folder, ".git/config", "changed repo state");
        write(&s.folder, "node_modules/x/index.js", "changed junk");
        s.cp.restore(&s.folder, &start.id).unwrap();
        assert_eq!(read(&s.folder, ".git/config").as_deref(), Some("changed repo state"), "the folder's own git is left alone");
        assert_eq!(read(&s.folder, "node_modules/x/index.js").as_deref(), Some("changed junk"));
        assert!(!s.folder.join(".git/mobius").exists());
        assert!(s.cp.changed_since(&s.folder, &start.id).unwrap().is_empty());
    }

    #[test]
    fn two_folders_do_not_see_each_others_checkpoints() {
        let s = setup();
        let other = s.folder.parent().unwrap().join("docs");
        fs::create_dir_all(&other).unwrap();
        write(&s.folder, "a.md", "notes");
        write(&other, "d.md", "docs");
        let mine = s.cp.snapshot(&s.folder, "notes").unwrap().unwrap();
        let theirs = s.cp.snapshot(&other, "docs").unwrap().unwrap();
        assert_eq!(s.cp.list(&s.folder, 10).unwrap().len(), 1);
        assert!(matches!(s.cp.restore(&other, &mine.id), Err(Error::BadInput(_))), "a checkpoint of another folder is refused");
        assert!(matches!(s.cp.restore(&s.folder, &theirs.id), Err(Error::BadInput(_))));
        assert_eq!(read(&other, "d.md").as_deref(), Some("docs"));
    }

    #[test]
    fn checkpoints_of_one_store_from_several_places_at_once_all_succeed() {
        let s = setup();
        write(&s.folder, "a.md", "a");
        let store = s._root.path().join("store");
        let workers: Vec<_> = (0..8)
            .map(|n| {
                let (store, folder) = (store.clone(), s.folder.clone());
                std::thread::spawn(move || {
                    // Each its own handle on the same store, as Notes, Tasks and the file tools have.
                    let cp = Checkpoints::new(store);
                    for i in 0..5 {
                        fs::write(folder.join(format!("{n}-{i}.md")), "x").unwrap();
                        cp.snapshot(&folder, "at once").unwrap();
                        cp.list(&folder, 1).unwrap();
                    }
                })
            })
            .collect();
        for w in workers {
            w.join().expect("no snapshot failed");
        }
    }

    #[test]
    fn bad_ids_paths_and_folders_are_refused() {
        let s = setup();
        write(&s.folder, "a.md", "a");
        let cp1 = s.cp.snapshot(&s.folder, "one").unwrap().unwrap();
        for bad in ["", "zzzz", "--all", "HEAD", &"a".repeat(41), "abc"] {
            assert!(matches!(s.cp.restore(&s.folder, bad), Err(Error::BadInput(_))), "{bad:?}");
        }
        for bad in ["", "../x", "/etc/passwd", "C:/x", "a/../../b", "-rf", "a\nb"] {
            assert!(matches!(s.cp.restore_file(&s.folder, &cp1.id, bad), Err(Error::BadInput(_))), "{bad:?}");
        }
        assert!(matches!(s.cp.snapshot(&s.folder.join("missing"), "x"), Err(Error::BadFolder(_))));
        assert!(matches!(s.cp.snapshot(&s.folder.join("a.md"), "x"), Err(Error::BadFolder(_))));
    }

    #[test]
    fn the_store_cannot_live_inside_the_folder_it_protects() {
        let s = setup();
        let inside = Checkpoints::new(s.folder.join(".checkpoints"));
        write(&s.folder, "a.md", "a");
        assert!(matches!(inside.snapshot(&s.folder, "x"), Err(Error::BadFolder(_))));
    }

    #[test]
    fn the_reason_is_kept_short_and_plain_and_listing_is_bounded() {
        let s = setup();
        write(&s.folder, "a.md", "a");
        let c = s.cp.snapshot(&s.folder, &format!("line one\nline two {}", "x".repeat(500))).unwrap().unwrap();
        assert!(c.reason.chars().count() <= 200 && !c.reason.contains('\n'));
        assert_eq!(s.cp.list(&s.folder, 0).unwrap().len(), 1, "a limit of 0 still gives the newest");
    }

    #[test]
    fn helper_rules() {
        assert!(is_checkpoint_id("abcdef12") && !is_checkpoint_id("xyz") && !is_checkpoint_id("../.."));
        assert!(is_inner_path("a/b.md") && is_inner_path("a b.md") && !is_inner_path("a/./../b") && !is_inner_path(""));
        assert_eq!(folder_id(Path::new("C:/A/b")), folder_id(Path::new("C:\\A\\b")), "slash style does not matter");
        assert_ne!(folder_id(Path::new("C:/A/b")), folder_id(Path::new("C:/A/c")));
    }
}
