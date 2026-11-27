//! Code projects watched on disk: a file changed by another editor, git or a script is announced, so the Code app
//! shows it (an open file with nothing typed reads again; one with typing says so when saved).
//!
//! Folders a project's tools fill (`.git`, `node_modules`, `target` and the like) are not watched: they change all the
//! time and nobody edits them by hand.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

/// Folders inside a project whose changes are not announced.
const SKIPPED: &[&str] = &[".git", "node_modules", "target", "dist", "build", ".next", ".turbo", "__pycache__", ".venv", "venv", ".cache"];
/// Changes are gathered for this long and told once: a checkout that touches a thousand files is one announcement.
const GATHER: Duration = Duration::from_millis(300);
/// On Linux each folder is a watch of its own; past this many, the rest are left (the system has a limit for everyone).
const MOST_FOLDERS: usize = 4000;

/// What changed in one project: one file (its path inside the project, `/`-separated), or several (`None`).
pub type Changed = Arc<dyn Fn(&str, Option<&str>) + Send + Sync>;

/// The project and the path inside it of a changed path under `root` (the workspace's `code` folder), unless it is in
/// a skipped folder, hidden at the project's top, or the project folder itself.
pub fn change_in(root: &Path, path: &Path) -> Option<(String, String)> {
    let rest = path.strip_prefix(root).ok()?;
    let parts: Vec<String> = rest.components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect();
    let (project, inner) = parts.split_first()?;
    if inner.is_empty() || project.starts_with('.') || inner.iter().any(|p| SKIPPED.contains(&p.as_str())) {
        return None;
    }
    Some((project.clone(), inner.join("/")))
}

/// Gathers what one batch of changes says: each project once, with its file if only one changed.
pub fn gather(changes: impl IntoIterator<Item = (String, String)>) -> BTreeMap<String, Option<String>> {
    let mut by: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    for (project, file) in changes {
        by.entry(project).or_default().insert(file);
    }
    by.into_iter().map(|(p, files)| (p, if files.len() == 1 { files.into_iter().next() } else { None })).collect()
}

/// Folders to watch one by one where the system cannot watch a tree (Linux): the root, and every folder under it but
/// the skipped ones.
fn folders(root: &Path) -> Vec<PathBuf> {
    let mut out = vec![root.to_path_buf()];
    let mut i = 0;
    while i < out.len() && out.len() < MOST_FOLDERS {
        let dir = out[i].clone();
        i += 1;
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if SKIPPED.contains(&name.as_str()) || entry.file_type().map_or(true, |t| !t.is_dir()) {
                continue;
            }
            out.push(entry.path());
            if out.len() >= MOST_FOLDERS {
                break;
            }
        }
    }
    out
}

/// Watching, until dropped.
pub struct CodeWatch(#[allow(dead_code)] Arc<std::sync::Mutex<notify::RecommendedWatcher>>);

/// Watches `root` (the workspace's `code` folder) until what it gives is dropped, telling `changed` what changed.
pub fn watch(root: &Path, changed: Changed) -> Option<CodeWatch> {
    use notify::Watcher;
    let root = root.canonicalize().ok()?;
    let (send, receive) = std::sync::mpsc::channel::<(PathBuf, bool)>();
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        if let Ok(event) = event {
            let made = matches!(event.kind, notify::EventKind::Create(_));
            for path in event.paths {
                let _ = send.send((path, made));
            }
        }
    })
    .ok()?;
    let linux = cfg!(target_os = "linux");
    if linux {
        for dir in folders(&root) {
            let _ = watcher.watch(&dir, notify::RecursiveMode::NonRecursive);
        }
    } else {
        watcher.watch(&root, notify::RecursiveMode::Recursive).ok()?;
    }
    // On Linux a folder made later is watched when it appears. The thread only borrows the watcher for that: dropped,
    // it takes its sender with it and the thread ends.
    let watcher = Arc::new(std::sync::Mutex::new(watcher));
    let inner = Arc::downgrade(&watcher);
    let top = root.clone();
    let _ = std::thread::Builder::new().name("mobius-code-watch".into()).spawn(move || {
        while let Ok(first) = receive.recv() {
            let mut seen = Vec::new();
            let mut note = |(path, made): (PathBuf, bool)| {
                if linux && made && path.is_dir() && change_in(&top, &path.join("x")).is_some() {
                    if let Some(w) = inner.upgrade() {
                        if let Ok(mut w) = w.lock() {
                            for dir in folders(&path) {
                                let _ = notify::Watcher::watch(&mut *w, &dir, notify::RecursiveMode::NonRecursive);
                            }
                        }
                    }
                }
                if let Some(change) = change_in(&top, &path) {
                    seen.push(change);
                }
            };
            note(first);
            let until = Instant::now() + GATHER;
            while let Some(left) = until.checked_duration_since(Instant::now()) {
                match receive.recv_timeout(left) {
                    Ok(next) => note(next),
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => break,
                    Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => return,
                }
            }
            for (project, file) in gather(seen) {
                changed(&project, file.as_deref());
            }
        }
    });
    Some(CodeWatch(watcher))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    #[test]
    fn a_change_names_its_project_and_file_unless_tools_made_it() {
        let root = Path::new("/w/code");
        assert_eq!(change_in(root, Path::new("/w/code/site/src/app.ts")), Some(("site".into(), "src/app.ts".into())));
        assert_eq!(change_in(root, Path::new("/w/code/site/node_modules/x/index.js")), None);
        assert_eq!(change_in(root, Path::new("/w/code/site/.git/HEAD")), None);
        assert_eq!(change_in(root, Path::new("/w/code/site")), None);
        assert_eq!(change_in(root, Path::new("/w/other/a.ts")), None);
    }

    #[test]
    fn many_changes_in_a_project_are_told_once() {
        let told = gather([("a".into(), "x.ts".into()), ("a".into(), "x.ts".into()), ("b".into(), "1.rs".into()), ("b".into(), "2.rs".into())]);
        assert_eq!(told.get("a"), Some(&Some("x.ts".to_string())));
        assert_eq!(told.get("b"), Some(&None));
    }

    #[test]
    fn a_file_written_by_another_app_is_told() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("code");
        std::fs::create_dir_all(root.join("site/src")).unwrap();
        std::fs::write(root.join("site/src/app.ts"), "one").unwrap();
        let heard = Arc::new(Mutex::new(Vec::<(String, Option<String>)>::new()));
        let into = Arc::clone(&heard);
        let watcher = watch(&root, Arc::new(move |p: &str, f: Option<&str>| into.lock().unwrap().push((p.to_owned(), f.map(str::to_owned)))));
        assert!(watcher.is_some());
        std::thread::sleep(Duration::from_millis(100));
        std::fs::write(root.join("site/src/app.ts"), "two").unwrap();
        std::fs::create_dir_all(root.join("site/node_modules/x")).unwrap();
        std::fs::write(root.join("site/node_modules/x/i.js"), "skip").unwrap();
        let until = Instant::now() + Duration::from_secs(5);
        while heard.lock().unwrap().is_empty() && Instant::now() < until {
            std::thread::sleep(Duration::from_millis(50));
        }
        std::thread::sleep(Duration::from_millis(500));
        let heard = heard.lock().unwrap().clone();
        assert!(heard.contains(&("site".to_owned(), Some("src/app.ts".to_owned()))), "{heard:?}");
        assert!(heard.iter().all(|(_, f)| f.as_deref() != Some("node_modules/x/i.js")), "{heard:?}");
    }
}
