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
    /// Where the checkpoints are kept.
    pub(crate) fn store(&self) -> &std::path::Path {
        &self.store
    }

    pub fn new(store: impl Into<PathBuf>) -> Checkpoints {
        Checkpoints { store: store.into() }
    }

    fn git(&self, folder: &Path, id: &str, args: &[&str]) -> Result<String, Error> {
        let index = self.store.join("indexes").join(id);
        let started = std::time::Instant::now();
        let output = quiet(Command::new("git"))
            .args(["-c", "core.autocrlf=false", "-c", "core.safecrlf=false", "-c", "core.quotepath=false", "-c", "core.hooksPath=NUL", "-c", "gc.auto=0"])
            // Every checkpoint looks at the files themselves. Git's shortcuts trust what Windows says about folders:
            // the untracked cache skips a folder whose time hasn't moved, and fscache takes file details from the
            // folder's listing, which NTFS updates late. Either can miss a file, and then the turn shows nothing to
            // keep or discard (a new database was never seen: database.spec:27).
            .args(["-c", "core.untrackedCache=false", "-c", "core.fscache=false", "-c", "core.preloadIndex=true"])
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
        slow(&format!("git {}", args.first().copied().unwrap_or("")), started);
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
        // The branch's ref is a small file of its own until git packs it (it never does here: gc is off). Read as a
        // file it costs nothing; a git run costs a process start, which is slow on Windows.
        if let Ok(text) = std::fs::read_to_string(self.store.join("refs").join("mobius").join(id))
            && is_checkpoint_id(text.trim())
            && text.trim().len() == 40
        {
            return Some(text.trim().to_owned());
        }
        self.git(folder, id, &["rev-parse", "--verify", "--quiet", &format!("refs/mobius/{id}^{{commit}}")]).ok().map(|s| s.trim().to_owned()).filter(|s| !s.is_empty())
    }

    /// Saves the folder as it is now. `None` when nothing changed since the last checkpoint.
    pub fn snapshot(&self, folder: &Path, reason: &str) -> Result<Option<Checkpoint>, Error> {
        let _one = one_at_a_time();
        let (folder, id) = self.prepare(folder)?;
        self.snapshot_locked(&folder, &id, reason)
    }

    /// Saves the folder as it is now even when nothing changed since the last checkpoint, so that what happens next
    /// has a checkpoint of its own to be counted from (moves of files checkpoints leave out change nothing they keep).
    pub fn snapshot_always(&self, folder: &Path, reason: &str) -> Result<Checkpoint, Error> {
        let _one = one_at_a_time();
        let (folder, id) = self.prepare(folder)?;
        self.commit_locked(&folder, &id, reason, true)?.ok_or_else(|| Error::Git("no checkpoint was made".into()))
    }

    /// Brings the folder's index up to date without saving a checkpoint, so the next one (the first turn's, at the
    /// start of a session) only has to save. The first look at a folder hashes every file and writes its objects,
    /// which took over 4 s on a Windows runner, while the person waited on the turn.
    pub fn warm(&self, folder: &Path) -> Result<(), Error> {
        let _one = one_at_a_time();
        let (folder, id) = self.prepare(folder)?;
        self.git(&folder, &id, &["add", "-A", "--", "."])?;
        self.git(&folder, &id, &["write-tree"])?;
        Ok(())
    }

    /// [`Checkpoints::snapshot`], with the lock already held and the folder prepared.
    fn snapshot_locked(&self, folder: &Path, id: &str, reason: &str) -> Result<Option<Checkpoint>, Error> {
        self.commit_locked(folder, id, reason, false)
    }

    fn commit_locked(&self, folder: &Path, id: &str, reason: &str, always: bool) -> Result<Option<Checkpoint>, Error> {
        let (folder, id) = (folder.to_path_buf(), id.to_owned());
        self.git(&folder, &id, &["add", "-A", "--", "."])?;
        let tree = self.git(&folder, &id, &["write-tree"])?.trim().to_owned();
        let parent = self.tip(&folder, &id);
        if let Some(parent) = parent.as_ref().filter(|_| !always) {
            let memo = format!("{}|{parent}", self.store.display());
            let before = match memo_get(&TREE_OF, &memo) {
                Some(tree) => tree,
                None => self.git(&folder, &id, &["rev-parse", &format!("{parent}^{{tree}}")])?.trim().to_owned(),
            };
            if before == tree {
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
        memo_put(&TREE_OF, format!("{}|{commit}", self.store.display()), tree);
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
    /// Only the files that differ are written. Moves noted with [`Checkpoints::note_moves`] since then are turned back
    /// too, for the files checkpoints leave out (archives, videos), and folders left empty are taken away.
    pub fn restore(&self, folder: &Path, checkpoint: &str) -> Result<(), Error> {
        let _one = one_at_a_time();
        let (folder, id) = self.prepare(folder)?;
        let target = self.known(&folder, &id, checkpoint)?;
        let before = self.snapshot_locked(&folder, &id, "before restoring an earlier checkpoint")?;
        let head = before.map(|c| c.id).or_else(|| self.tip(&folder, &id)).ok_or_else(|| Error::Git("nothing to compare with".into()))?;
        let list = |tree: &str| self.git(&folder, &id, &["ls-tree", "-r", "--name-only", "-z", tree]);
        let now_files: Vec<String> = list(&head)?.split('\0').filter(|p| !p.is_empty()).map(str::to_owned).collect();
        let then_files: std::collections::HashSet<String> = list(&target)?.split('\0').map(str::to_owned).collect();
        let mut emptied: Vec<PathBuf> = Vec::new();
        for path in now_files.iter().filter(|p| !then_files.contains(*p)) {
            if is_inner_path(path) && std::fs::remove_file(folder.join(path)).is_ok() {
                emptied.extend(folder.join(path).parent().map(Path::to_path_buf));
            }
        }
        self.git(&folder, &id, &["read-tree", &target])?;
        // Only what differs is written again: on a big folder, writing every file took most of a minute.
        let differ = self.git(&folder, &id, &["diff-tree", "-r", "--name-only", "--no-renames", "-z", &head, &target])?;
        let changed: Vec<&str> = differ.split('\0').filter(|p| !p.is_empty() && then_files.contains(*p)).collect();
        self.write_from_index(&folder, &id, &changed)?;
        emptied.extend(self.undo_moves(&folder, &id, &target, None));
        prune_empty(&folder, emptied);
        Ok(())
    }

    /// Writes `paths` as the index has them, each through a temporary file renamed over the one there. Git itself
    /// empties a file and then writes it, so an app reading it in that moment (Views after Discard, a file watcher)
    /// found it empty or cut short; now a reader sees the old version or the new one.
    fn write_from_index(&self, folder: &Path, id: &str, paths: &[&str]) -> Result<(), Error> {
        for chunk in paths.chunks(200) {
            let mut args = vec!["checkout-index", "--temp", "-z", "--"];
            args.extend(chunk.iter().copied());
            let out = self.git(folder, id, &args)?;
            for entry in out.split('\0').filter(|e| !e.is_empty()) {
                let Some((temp, path)) = entry.split_once('\t') else { continue };
                let (from, to) = (folder.join(temp), folder.join(path));
                if !is_inner_path(temp) || !is_inner_path(path) {
                    let _ = std::fs::remove_file(&from);
                    continue;
                }
                if let Some(parent) = to.parent() {
                    std::fs::create_dir_all(parent).map_err(|e| Error::Git(e.to_string()))?;
                }
                if to.is_dir() {
                    let _ = std::fs::remove_dir_all(&to);
                }
                if std::fs::rename(&from, &to).is_err() {
                    // Windows will not replace a file another program holds open without sharing: write it in place.
                    let copied = std::fs::copy(&from, &to);
                    let _ = std::fs::remove_file(&from);
                    copied.map_err(|e| Error::Git(format!("{path}: {e}")))?;
                }
            }
        }
        Ok(())
    }

    /// Notes moves made in `folder` after `checkpoint`, so restoring to it or before also moves back the files that
    /// checkpoints leave out. Paths are relative to `folder`.
    pub fn note_moves(&self, folder: &Path, checkpoint: &str, moves: &[(String, String)]) -> Result<(), Error> {
        let _one = one_at_a_time();
        let (_, id) = self.prepare(folder)?;
        let dir = self.store.join("moves");
        std::fs::create_dir_all(&dir).map_err(|e| Error::Git(e.to_string()))?;
        let line = serde_json::json!({ "after": checkpoint, "moves": moves }).to_string();
        let mut file = std::fs::OpenOptions::new().create(true).append(true).open(dir.join(format!("{id}.jsonl"))).map_err(|e| Error::Git(e.to_string()))?;
        std::io::Write::write_all(&mut file, format!("{line}\n").as_bytes()).map_err(|e| Error::Git(e.to_string()))
    }

    /// The moves noted since `target` (and up to `until`, when given), and the log's other lines.
    fn noted_since(&self, folder: &Path, id: &str, target: &str, until: Option<&str>) -> (Vec<serde_json::Value>, Vec<String>) {
        let file = self.store.join("moves").join(format!("{id}.jsonl"));
        let Ok(text) = std::fs::read_to_string(&file) else { return (Vec::new(), Vec::new()) };
        let mut keep = Vec::new();
        let mut since = Vec::new();
        for line in text.lines().filter(|l| !l.trim().is_empty()) {
            let Ok(entry) = serde_json::from_str::<serde_json::Value>(line) else { continue };
            let after = entry["after"].as_str().unwrap_or_default();
            // Made at or after the checkpoint being restored: `target` is that move's checkpoint or older.
            let made = self.git(folder, id, &["merge-base", "--is-ancestor", target, after]).is_ok()
                && until.is_none_or(|until| self.git(folder, id, &["merge-base", "--is-ancestor", after, until]).is_ok());
            if made { since.push(entry) } else { keep.push(line.to_owned()) }
        }
        (since, keep)
    }

    /// The files that moves noted since `checkpoint` (and up to `until`, when given) moved and that are not among
    /// `counted` (what the checkpoints saw change): the archives and videos checkpoints leave out. Each is its old path
    /// and new one, relative to `folder`, file by file (a folder moved is each such file now inside it), for files
    /// still where the move put them. A turn's review lists these beside its diff, so a tidy's count is every file.
    pub fn left_out_moves(&self, folder: &Path, checkpoint: &str, until: Option<&str>, counted: &[String]) -> Result<Vec<(String, String)>, Error> {
        let _one = one_at_a_time();
        let (folder, id) = self.prepare(folder)?;
        let target = self.known(&folder, &id, checkpoint)?;
        let until = until.map(|u| self.known(&folder, &id, u)).transpose()?;
        let counted: std::collections::HashSet<&str> = counted.iter().map(String::as_str).collect();
        let mut out = Vec::new();
        let mut seen = std::collections::HashSet::new();
        for entry in self.noted_since(&folder, &id, &target, until.as_deref()).0 {
            for pair in entry["moves"].as_array().into_iter().flatten() {
                let (Some(from), Some(to)) = (pair[0].as_str(), pair[1].as_str()) else { continue };
                if !is_inner_path(from) || !is_inner_path(to) {
                    continue;
                }
                for (rest, _) in files_under(&folder.join(to)) {
                    let rest: Vec<String> = rest.components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect();
                    let join = |base: &str| if rest.is_empty() { base.to_owned() } else { format!("{base}/{}", rest.join("/")) };
                    let (old, new) = (join(from), join(to));
                    if !counted.contains(new.as_str()) && !counted.contains(old.as_str()) && seen.insert(new.clone()) {
                        out.push((old, new));
                    }
                }
            }
        }
        Ok(out)
    }

    /// Puts files that moves left out of the checkpoints back where they were, each `(old, new)` pair as
    /// `left_out_moves` gives it, unless something is at the old path now. Folders left empty are taken away.
    pub fn move_back(&self, folder: &Path, pairs: &[(String, String)]) -> Result<(), Error> {
        let _one = one_at_a_time();
        let (folder, _) = self.prepare(folder)?;
        let mut emptied = Vec::new();
        for (old, new) in pairs {
            if !is_inner_path(old) || !is_inner_path(new) {
                continue;
            }
            let (back, at) = (folder.join(old), folder.join(new));
            if back.exists() || !at.is_file() {
                continue;
            }
            back.parent().map_or(Ok(()), std::fs::create_dir_all).and_then(|()| std::fs::rename(&at, &back)).map_err(|e| Error::Git(format!("{new}: {e}")))?;
            emptied.extend(at.parent().map(Path::to_path_buf));
        }
        prune_empty(&folder, emptied);
        Ok(())
    }

    /// Moves back, newest first, what moves noted since `target` (and up to `until`, when given) left where they went:
    /// the files the checkpoint did not keep. Those moves are then forgotten. Returns the folders they were moved out of.
    fn undo_moves(&self, folder: &Path, id: &str, target: &str, until: Option<&str>) -> Vec<PathBuf> {
        let file = self.store.join("moves").join(format!("{id}.jsonl"));
        let (undo, keep) = self.noted_since(folder, id, target, until);
        if undo.is_empty() && keep.is_empty() {
            return Vec::new();
        }
        let mut left = Vec::new();
        for entry in undo.iter().rev() {
            let moves = entry["moves"].as_array().cloned().unwrap_or_default();
            for pair in moves.iter().rev() {
                let (Some(from), Some(to)) = (pair[0].as_str(), pair[1].as_str()) else { continue };
                if !is_inner_path(from) || !is_inner_path(to) {
                    continue;
                }
                let (from, to) = (folder.join(from), folder.join(to));
                for (rest, at) in files_under(&to) {
                    let back = if rest.as_os_str().is_empty() { from.clone() } else { from.join(&rest) };
                    if back.exists() {
                        continue;
                    }
                    let moved = back.parent().map_or(Ok(()), std::fs::create_dir_all).and_then(|()| std::fs::rename(&at, &back));
                    if moved.is_ok() {
                        left.extend(at.parent().map(Path::to_path_buf));
                    }
                }
                left.push(to);
            }
        }
        let rest = if keep.is_empty() { String::new() } else { keep.join("\n") + "\n" };
        let _ = if rest.is_empty() { std::fs::remove_file(&file) } else { std::fs::write(&file, rest) };
        left
    }

    /// Puts one file back as it was at `checkpoint`: recreated if it was deleted since, removed if it was made since.
    pub fn restore_file(&self, folder: &Path, checkpoint: &str, path: &str) -> Result<(), Error> {
        self.restore_files(folder, checkpoint, &[path.to_owned()], None)
    }

    /// Puts each of `paths` back as it was at `checkpoint`, with one checkpoint of what is there now first. With
    /// `moves_until`, what moves noted from then until that checkpoint (a turn's end) left behind, the files
    /// checkpoints do not keep, is moved back too. Folders left empty are taken away.
    pub fn restore_files(&self, folder: &Path, checkpoint: &str, paths: &[String], moves_until: Option<&str>) -> Result<(), Error> {
        let _one = one_at_a_time();
        if let Some(bad) = paths.iter().find(|p| !is_inner_path(p)) {
            return Err(Error::BadInput(format!("{bad} is not inside the folder.")));
        }
        let (folder, id) = self.prepare(folder)?;
        let target = self.known(&folder, &id, checkpoint)?;
        let reason = match paths {
            [one] => format!("before restoring {one}"),
            _ => format!("before restoring {} files", paths.len()),
        };
        self.snapshot_locked(&folder, &id, &reason)?;
        let then: std::collections::HashSet<String> = if paths.is_empty() {
            std::collections::HashSet::new()
        } else {
            self.git(&folder, &id, &["ls-tree", "-r", "--name-only", "-z", &target])?.split('\0').map(str::to_owned).collect()
        };
        let mut emptied = Vec::new();
        let mut back = Vec::new();
        for path in paths {
            if then.contains(path) {
                back.push(path.as_str());
            } else {
                let file = folder.join(path);
                if file.is_file() {
                    std::fs::remove_file(&file).map_err(|e| Error::Git(e.to_string()))?;
                    emptied.extend(file.parent().map(Path::to_path_buf));
                }
            }
        }
        for chunk in back.chunks(200) {
            let mut args = vec!["reset", "-q", target.as_str(), "--"];
            args.extend(chunk.iter().copied());
            self.git(&folder, &id, &args)?;
        }
        self.write_from_index(&folder, &id, &back)?;
        if let Some(until) = moves_until {
            let until = self.known(&folder, &id, until)?;
            emptied.extend(self.undo_moves(&folder, &id, &target, Some(&until)));
        }
        prune_empty(&folder, emptied);
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
        self.diff_between(folder, from, to).map(|d| d.files)
    }

    /// What differs between two checkpoints, with the files that were moved paired up.
    pub fn diff_between(&self, folder: &Path, from: &str, to: &str) -> Result<Diff, Error> {
        let _one = one_at_a_time();
        let (folder, id) = self.prepare(folder)?;
        let a = self.known(&folder, &id, from)?;
        let b = self.known(&folder, &id, to)?;
        // Two saved states never change, so neither does what differs between them.
        let memo = format!("{}|{a}|{b}", self.store.display());
        if let Some(diff) = memo_get(&BETWEEN, &memo) {
            return Ok(diff);
        }
        let diff = Diff::parse(&self.git(&folder, &id, &DIFF_ARGS.iter().copied().chain([a.as_str(), b.as_str()]).collect::<Vec<_>>())?);
        memo_put(&BETWEEN, memo, diff.clone());
        Ok(diff)
    }

    /// Files that differ between `checkpoint` and the folder now: added, changed or removed since.
    pub fn changed_since(&self, folder: &Path, checkpoint: &str) -> Result<Vec<String>, Error> {
        self.diff_since(folder, checkpoint).map(|d| d.files)
    }

    /// What differs between `checkpoint` and the folder now, with the files that were moved paired up.
    pub fn diff_since(&self, folder: &Path, checkpoint: &str) -> Result<Diff, Error> {
        // Several parts of the window ask this at once after a change (the strip, each app's bar, Activity, Review),
        // and each answer takes a few git commands, one at a time. An answer worked out after this call arrived saw
        // the folder as it is for this call too, so it is shared; an older one is not.
        let asked = std::time::Instant::now();
        let _one = one_at_a_time();
        let (folder, id) = self.prepare(folder)?;
        let target = self.known(&folder, &id, checkpoint)?;
        let memo = format!("{}|{id}|{target}", self.store.display());
        if let Some((worked_out, diff)) = memo_get(&SINCE, &memo) {
            if worked_out >= asked {
                return Ok(diff);
            }
        }
        let started = std::time::Instant::now();
        self.git(&folder, &id, &["add", "-A", "--", "."])?;
        let tree = self.git(&folder, &id, &["write-tree"])?.trim().to_owned();
        let diff = Diff::parse(&self.git(&folder, &id, &DIFF_ARGS.iter().copied().chain([target.as_str(), tree.as_str()]).collect::<Vec<_>>())?);
        memo_put(&SINCE, memo, (started, diff.clone()));
        Ok(diff)
    }
}

/// What differs between two states: every path added, changed or removed, and of those, the files moved (or renamed),
/// each as its old path and its new one. A moved file's two paths are both in `files`, so putting the turn back still
/// puts both back; `moves` lets the window show and undo each move as one change.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Diff {
    pub files: Vec<String>,
    pub moves: Vec<(String, String)>,
}

/// Git's own rename finding pairs a removed file with an added one that has the same (or nearly the same) contents.
const DIFF_ARGS: [&str; 5] = ["diff-tree", "-r", "-M", "--name-status", "-z"];

impl Diff {
    /// Reads `diff-tree --name-status -z`: a status, then one path, or two for a move (`R<score>`, old then new).
    fn parse(out: &str) -> Diff {
        let mut diff = Diff::default();
        let mut parts = out.split('\0').filter(|p| !p.is_empty());
        while let Some(status) = parts.next() {
            let Some(path) = parts.next() else { break };
            if status.starts_with('R') || status.starts_with('C') {
                let Some(to) = parts.next() else { break };
                if status.starts_with('R') {
                    diff.files.push(path.to_owned());
                    diff.moves.push((path.to_owned(), to.to_owned()));
                }
                diff.files.push(to.to_owned());
            } else {
                diff.files.push(path.to_owned());
            }
        }
        diff
    }
}

/// Answers kept between calls: checkpoints already found on a folder's branch, what differs between two checkpoints,
/// and the latest answer to what changed since a checkpoint, with when it was worked out.
type Memo<T> = std::sync::Mutex<Option<std::collections::HashMap<String, T>>>;
static KNOWN: Memo<String> = std::sync::Mutex::new(None);
static BETWEEN: Memo<Diff> = std::sync::Mutex::new(None);
static SINCE: Memo<(std::time::Instant, Diff)> = std::sync::Mutex::new(None);
/// The tree of each checkpoint made here, so the next one can tell whether anything changed without asking git.
static TREE_OF: Memo<String> = std::sync::Mutex::new(None);

/// Said on stderr when a step took long (the e2e logs keep it), as the host says its own slow steps.
fn slow(what: &str, started: std::time::Instant) {
    let ms = started.elapsed().as_millis();
    if ms >= 300 {
        eprintln!("[slow] checkpoints {what}: {ms} ms");
    }
}

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

/// Every file at `path` (itself, when it is a file), with its path relative to `path`.
fn files_under(path: &Path) -> Vec<(PathBuf, PathBuf)> {
    let mut out = Vec::new();
    if path.is_file() {
        out.push((PathBuf::new(), path.to_path_buf()));
        return out;
    }
    let mut stack = vec![path.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let at = entry.path();
            if at.is_dir() {
                stack.push(at);
            } else if let Ok(rest) = at.strip_prefix(path) {
                out.push((rest.to_path_buf(), at.clone()));
            }
        }
        if out.len() > 10_000 {
            break;
        }
    }
    out
}

/// Takes away each of `dirs`, and the folders above it inside `folder`, while they are empty.
fn prune_empty(folder: &Path, dirs: Vec<PathBuf>) {
    let mut dirs = dirs;
    // Deepest first, so a folder emptied by taking away the one inside it goes too.
    dirs.sort_by_key(|d| std::cmp::Reverse(d.components().count()));
    dirs.dedup();
    for dir in dirs {
        let mut at = Some(dir.as_path());
        while let Some(d) = at {
            if d == folder || !d.starts_with(folder) || std::fs::remove_dir(d).is_err() {
                break;
            }
            at = d.parent();
        }
    }
}

fn one_at_a_time() -> OneAtATime {
    if HELD.with(std::cell::Cell::get) {
        return OneAtATime(None);
    }
    let waited = std::time::Instant::now();
    let guard = STORE.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    slow("waiting for another checkpoint step", waited);
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
    fn a_file_put_back_is_never_seen_empty_or_half_written() {
        let s = setup();
        let long = "line of the view\n".repeat(20_000);
        write(&s.folder, "views/Today.json", &long);
        write(&s.folder, "b.md", "b1");
        let before = s.cp.snapshot(&s.folder, "before").unwrap().unwrap();
        write(&s.folder, "views/Today.json", "the agent's version");
        write(&s.folder, "b.md", "b2");
        s.cp.snapshot(&s.folder, "the agent's turn").unwrap();
        let stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let reader = {
            let (file, stop) = (s.folder.join("views/Today.json"), stop.clone());
            std::thread::spawn(move || {
                let mut torn = 0;
                while !stop.load(std::sync::atomic::Ordering::Relaxed) {
                    if let Ok(text) = fs::read_to_string(&file) {
                        torn += usize::from(text != "the agent's version" && text.len() != 340_000);
                    }
                }
                torn
            })
        };
        // The agent's writes are atomic too (as the file tools' are), so only a restore could tear a read.
        let agent_writes = |text: &str| {
            write(&s.folder, "views/.Today.tmp", text);
            fs::rename(s.folder.join("views/.Today.tmp"), s.folder.join("views/Today.json")).unwrap();
        };
        for _ in 0..10 {
            s.cp.restore_files(&s.folder, &before.id, &["views/Today.json".to_owned()], None).unwrap();
            agent_writes("the agent's version");
        }
        s.cp.restore(&s.folder, &before.id).unwrap();
        stop.store(true, std::sync::atomic::Ordering::Relaxed);
        assert_eq!(reader.join().unwrap(), 0, "every read saw a whole version");
        assert_eq!((read(&s.folder, "views/Today.json").map(|t| t.len()), read(&s.folder, "b.md").as_deref()), (Some(340_000), Some("b1")));
        let left: Vec<_> = fs::read_dir(&s.folder).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).filter(|n| n.starts_with(".merge_file")).collect();
        assert!(left.is_empty(), "no temporary files are left: {left:?}");
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
