//! Folders on this computer, opened from Files as places beside the workspace ("This computer": Desktop, Documents,
//! Downloads, and any folder the person adds). Each is a [`Drive`] whose top is that folder: nothing outside it can be
//! reached, by a `..` in a path or by a link inside it that points elsewhere.
//!
//! A file's version is its size and modified time, so a change is refused when the file changed on disk since it was
//! read, as a server refuses one with a stale ETag. Deleting sends the file to the system's Recycle Bin (or Trash),
//! where the person can bring it back. Mobius keeps no checkpoints here: its own changes in these folders always ask
//! first (`drives.write`).
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::UNIX_EPOCH;

use crate::drives::{CHANGED, Drive, EXISTS, Entry, File, MAX_FILE};

type Res<T> = Result<T, String>;

/// The most entries one folder lists.
const MAX_ENTRIES: usize = 10_000;

pub struct LocalFolder {
    root: PathBuf,
}

/// A path within the folder split into its names. Empty, `.` and `..` names, and a drive or root in a name, are
/// refused so a path cannot leave it.
fn names(path: &str) -> Res<Vec<&str>> {
    let path = path.trim().trim_matches('/');
    if path.is_empty() {
        return Ok(Vec::new());
    }
    path.split('/')
        .map(|n| {
            if n.is_empty() || n == "." || n == ".." || n.contains(['\\', ':']) || n.chars().any(char::is_control) {
                Err(format!("\"{path}\" is not a path in this folder."))
            } else {
                Ok(n)
            }
        })
        .collect()
}

/// A file's version: its size and modified time.
fn version_of(meta: &fs::Metadata) -> Option<String> {
    let modified = meta.modified().ok()?.duration_since(UNIX_EPOCH).ok()?;
    Some(format!("{}-{}", meta.len(), modified.as_nanos()))
}

/// As an HTTP date, as the other drives give it.
fn http_date(meta: &fs::Metadata) -> Option<String> {
    let modified: chrono::DateTime<chrono::Utc> = meta.modified().ok()?.into();
    Some(modified.format("%a, %d %b %Y %H:%M:%S GMT").to_string())
}

fn text(e: &std::io::Error) -> String {
    match e.kind() {
        std::io::ErrorKind::NotFound => "That is not there any more.".into(),
        std::io::ErrorKind::PermissionDenied => "This computer does not let Mobius change that.".into(),
        std::io::ErrorKind::AlreadyExists => EXISTS.into(),
        _ => e.to_string(),
    }
}

impl LocalFolder {
    /// The folder at `root`, which must be there.
    pub fn new(root: &Path) -> Res<LocalFolder> {
        let root = root.canonicalize().map_err(|_| "That folder is not on this computer any more.".to_owned())?;
        if !root.is_dir() {
            return Err("That is not a folder.".into());
        }
        Ok(LocalFolder { root })
    }

    /// Where `path` is on disk, checked to be inside the folder. The part of it that is there is resolved (links
    /// followed) and must still be inside; the rest is joined to it.
    fn locate(&self, path: &str) -> Res<PathBuf> {
        let names = names(path)?;
        let mut at = self.root.clone();
        for (i, name) in names.iter().enumerate() {
            let next = at.join(name);
            match fs::symlink_metadata(&next) {
                Ok(_) => {
                    let real = next.canonicalize().map_err(|e| text(&e))?;
                    if !real.starts_with(&self.root) {
                        return Err("That leads outside the folder.".into());
                    }
                    at = real;
                }
                Err(_) => {
                    for rest in &names[i..] {
                        at.push(rest);
                    }
                    return Ok(at);
                }
            }
        }
        Ok(at)
    }

    /// The file's version now, refusing when it is not `version`.
    fn check_version(target: &Path, version: Option<&str>) -> Res<()> {
        if let Some(version) = version {
            let now = fs::metadata(target).ok().and_then(|m| version_of(&m));
            if now.as_deref() != Some(version) {
                return Err(CHANGED.into());
            }
        }
        Ok(())
    }
}

impl Drive for LocalFolder {
    fn check(&self) -> Res<()> {
        fs::read_dir(&self.root).map(|_| ()).map_err(|e| text(&e))
    }

    fn list(&self, folder: &str) -> Res<Vec<Entry>> {
        let dir = self.locate(folder)?;
        let prefix = folder.trim().trim_matches('/');
        let mut out = Vec::new();
        for entry in fs::read_dir(&dir).map_err(|e| text(&e))?.filter_map(Result::ok).take(MAX_ENTRIES) {
            // Links are left out: where they lead may be outside the folder, and Windows' old junctions in Documents
            // ("My Music") cannot be opened anyway.
            let Ok(kind) = entry.file_type() else { continue };
            if kind.is_symlink() {
                continue;
            }
            let Ok(meta) = entry.metadata() else { continue };
            let name = entry.file_name().to_string_lossy().into_owned();
            if hidden(&name, &meta) {
                continue;
            }
            let folder = meta.is_dir();
            out.push(Entry {
                path: if prefix.is_empty() { name.clone() } else { format!("{prefix}/{name}") },
                name,
                folder,
                size: if folder { 0 } else { meta.len() },
                modified: http_date(&meta),
                version: if folder { None } else { version_of(&meta) },
                content_type: None,
                id: None,
                link: None,
            });
        }
        out.sort_by(|a, b| b.folder.cmp(&a.folder).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
        Ok(out)
    }

    fn read(&self, path: &str) -> Res<File> {
        let at = self.locate(path)?;
        let meta = fs::metadata(&at).map_err(|e| text(&e))?;
        if meta.is_dir() {
            return Err("That is a folder.".into());
        }
        if meta.len() > MAX_FILE as u64 {
            return Err("That file is too big to open here.".into());
        }
        let bytes = fs::read(&at).map_err(|e| text(&e))?;
        Ok(File { bytes, version: version_of(&meta), content_type: None })
    }

    fn write(&self, path: &str, bytes: &[u8], version: Option<&str>) -> Res<Option<String>> {
        if names(path)?.is_empty() {
            return Err("A file name is needed.".into());
        }
        let at = self.locate(path)?;
        let parent = at.parent().ok_or("A file name is needed.")?;
        match version {
            // A change: only over the version read, through a file beside it so a failed write leaves the old one.
            Some(_) => {
                Self::check_version(&at, version)?;
                let name = at.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
                let temp = parent.join(format!(".{name}.mobius-saving"));
                let written = fs::write(&temp, bytes).and_then(|()| fs::rename(&temp, &at));
                if let Err(e) = written {
                    let _ = fs::remove_file(&temp);
                    return Err(text(&e));
                }
            }
            // A new file: never over one that is there.
            None => {
                fs::create_dir_all(parent).map_err(|e| text(&e))?;
                let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&at).map_err(|e| text(&e))?;
                file.write_all(bytes).map_err(|e| text(&e))?;
            }
        }
        Ok(fs::metadata(&at).ok().and_then(|m| version_of(&m)))
    }

    fn make_folder(&self, path: &str) -> Res<()> {
        if names(path)?.is_empty() {
            return Err("A folder name is needed.".into());
        }
        let at = self.locate(path)?;
        if at.exists() {
            return Err(EXISTS.into());
        }
        fs::create_dir_all(&at).map_err(|e| text(&e))
    }

    fn rename(&self, from: &str, to: &str) -> Res<()> {
        if names(from)?.is_empty() || names(to)?.is_empty() {
            return Err("The folder itself cannot be moved here.".into());
        }
        let (from, to) = (self.locate(from)?, self.locate(to)?);
        if !from.exists() {
            return Err("That is not there any more.".into());
        }
        if to.exists() {
            return Err(EXISTS.into());
        }
        if to.starts_with(&from) {
            return Err("A folder cannot go inside itself.".into());
        }
        if let Some(parent) = to.parent() {
            fs::create_dir_all(parent).map_err(|e| text(&e))?;
        }
        fs::rename(&from, &to).map_err(|e| text(&e))
    }

    fn delete(&self, path: &str, version: Option<&str>) -> Res<()> {
        if names(path)?.is_empty() {
            return Err("The folder itself cannot be deleted here.".into());
        }
        let at = self.locate(path)?;
        if !at.exists() {
            return Err("That is not there any more.".into());
        }
        Self::check_version(&at, version)?;
        trash::delete(&at).map_err(|e| format!("It could not go to the Recycle Bin: {e}"))
    }

    fn read_into(&self, path: &str, to: &Path) -> Res<Option<String>> {
        let at = self.locate(path)?;
        let meta = fs::metadata(&at).map_err(|e| text(&e))?;
        fs::copy(&at, to).map_err(|e| text(&e))?;
        Ok(version_of(&meta))
    }
}

/// Left out of a listing, as Explorer and Finder leave them out: hidden and system files (`desktop.ini`,
/// `Thumbs.db`), and names starting with a dot (Mobius's own half-saved files among them).
fn hidden(name: &str, meta: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const HIDDEN: u32 = 0x2;
        const SYSTEM: u32 = 0x4;
        if meta.file_attributes() & (HIDDEN | SYSTEM) != 0 {
            return true;
        }
    }
    #[cfg(not(windows))]
    let _ = meta;
    name.starts_with('.') || name.eq_ignore_ascii_case("desktop.ini") || name.eq_ignore_ascii_case("thumbs.db")
}

/// Watches the places for changes made outside Mobius (another app, a download landing) and says, at most every
/// quarter of a second, which place and folder changed: `changed(place id, folder within it)`. Dropped, it stops.
pub fn watch(places: Vec<(String, PathBuf)>, changed: Arc<dyn Fn(&str, &str) + Send + Sync>) -> Option<notify::RecommendedWatcher> {
    use notify::Watcher;
    let roots: Vec<(String, PathBuf)> = places.into_iter().filter_map(|(id, root)| root.canonicalize().ok().map(|r| (id, r))).collect();
    if roots.is_empty() {
        return None;
    }
    let (send, receive) = std::sync::mpsc::channel::<PathBuf>();
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        if let Ok(event) = event {
            for path in event.paths {
                let _ = send.send(path);
            }
        }
    })
    .ok()?;
    // Recursive where the system watches a whole tree with one handle (Windows, macOS); on Linux each folder costs a
    // watch, so only the places' own tops are watched there.
    let mode = if cfg!(target_os = "linux") { notify::RecursiveMode::NonRecursive } else { notify::RecursiveMode::Recursive };
    for (_, root) in &roots {
        let _ = watcher.watch(root, mode);
    }
    let _ = std::thread::Builder::new().name("mobius-places-watch".into()).spawn(move || {
        let wait = std::time::Duration::from_millis(250);
        // Ends when the watcher (holding the sender) is dropped.
        while let Ok(first) = receive.recv() {
            let mut seen = std::collections::BTreeSet::new();
            let mut note = |path: PathBuf| {
                for (id, root) in &roots {
                    if let Ok(rest) = path.strip_prefix(root) {
                        // The folder the change is in, `/`-separated from the place's top.
                        let folder = rest.parent().map(|p| p.components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect::<Vec<_>>().join("/")).unwrap_or_default();
                        if !rest.file_name().is_some_and(|n| n.to_string_lossy().starts_with('.')) {
                            seen.insert((id.clone(), folder));
                        }
                    }
                }
            };
            note(first);
            let until = std::time::Instant::now() + wait;
            while let Some(left) = until.checked_duration_since(std::time::Instant::now()) {
                match receive.recv_timeout(left) {
                    Ok(path) => note(path),
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => break,
                    Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => return,
                }
            }
            for (id, folder) in seen {
                changed(&id, &folder);
            }
        }
    });
    Some(watcher)
}

/// The person's own folders Files starts with, where they are on this computer: Desktop, Documents and Downloads.
#[must_use]
pub fn known_folders() -> Vec<(&'static str, PathBuf)> {
    [("Desktop", dirs::desktop_dir()), ("Documents", dirs::document_dir()), ("Downloads", dirs::download_dir())]
        .into_iter()
        .filter_map(|(name, path)| path.filter(|p| p.is_dir()).map(|p| (name, p)))
        .collect()
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn a_folder_is_listed_read_written_and_moved_within_itself_only() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join("Projects")).unwrap();
        fs::write(dir.path().join("Projects/plan.txt"), "one").unwrap();
        let d = LocalFolder::new(dir.path()).unwrap();
        d.check().unwrap();

        let top = d.list("").unwrap();
        assert_eq!(top.iter().map(|e| (e.name.as_str(), e.folder)).collect::<Vec<_>>(), [("Projects", true)]);
        let inside = d.list("Projects").unwrap();
        assert_eq!(inside[0].path, "Projects/plan.txt");
        assert!(inside[0].modified.as_deref().is_some_and(|m| m.ends_with("GMT")));

        let file = d.read("Projects/plan.txt").unwrap();
        assert_eq!(file.bytes, b"one");
        // A change goes over the version read, and a stale version is refused.
        let v2 = d.write("Projects/plan.txt", b"two", file.version.as_deref()).unwrap();
        assert_eq!(fs::read_to_string(dir.path().join("Projects/plan.txt")).unwrap(), "two");
        assert_eq!(d.write("Projects/plan.txt", b"three", file.version.as_deref()).unwrap_err(), CHANGED);
        assert!(d.write("Projects/plan.txt", b"three", v2.as_deref()).is_ok());
        // A new file never replaces one; missing folders are made.
        assert_eq!(d.write("Projects/plan.txt", b"x", None).unwrap_err(), EXISTS);
        d.write("New/deep/note.md", b"hi", None).unwrap();
        assert_eq!(fs::read_to_string(dir.path().join("New/deep/note.md")).unwrap(), "hi");

        d.make_folder("Empty").unwrap();
        assert_eq!(d.make_folder("Empty").unwrap_err(), EXISTS);
        d.rename("Projects/plan.txt", "Empty/plan.txt").unwrap();
        assert!(dir.path().join("Empty/plan.txt").is_file());
        assert_eq!(d.rename("New/deep/note.md", "Empty/plan.txt").unwrap_err(), EXISTS);
        assert!(d.rename("New", "New/deep/inner").is_err());

        // Nothing outside the folder.
        for bad in ["../x", "a/../../x", "/../x", "C:/Windows", "a\\..\\x"] {
            assert!(d.read(bad).is_err(), "{bad}");
            assert!(d.write(bad, b"x", None).is_err(), "{bad}");
        }
        assert!(d.delete("", None).is_err());
        assert!(d.rename("", "x").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn a_link_inside_that_leads_outside_is_neither_listed_nor_followed() {
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("secret.txt"), "no").unwrap();
        let dir = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(outside.path(), dir.path().join("away")).unwrap();
        std::os::unix::fs::symlink(outside.path().join("secret.txt"), dir.path().join("secret.txt")).unwrap();
        let d = LocalFolder::new(dir.path()).unwrap();
        assert!(d.list("").unwrap().is_empty());
        assert!(d.read("away/secret.txt").is_err());
        assert!(d.read("secret.txt").is_err());
        assert!(d.write("away/new.txt", b"x", None).is_err());
        assert!(!outside.path().join("new.txt").exists());
    }

    #[test]
    fn a_stale_version_keeps_a_file_from_the_recycle_bin() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("a.txt"), "one").unwrap();
        let d = LocalFolder::new(dir.path()).unwrap();
        assert_eq!(d.delete("a.txt", Some("0-0")).unwrap_err(), CHANGED);
        assert!(dir.path().join("a.txt").exists());
        assert!(d.delete("gone.txt", None).is_err());
    }
    #[test]
    fn hidden_and_system_files_stay_out_of_the_list() {
        let dir = tempfile::tempdir().unwrap();
        for name in [".git", "desktop.ini", "Thumbs.db", "note.md"] {
            fs::write(dir.path().join(name), "x").unwrap();
        }
        let d = LocalFolder::new(dir.path()).unwrap();
        assert_eq!(d.list("").unwrap().iter().map(|e| e.name.as_str()).collect::<Vec<_>>(), ["note.md"]);
    }

    #[test]
    fn a_file_made_by_another_app_names_its_place_and_folder() {
        let dir = tempfile::tempdir().unwrap();
        let (tx, rx) = std::sync::mpsc::channel();
        let tx = std::sync::Mutex::new(tx);
        let _w = watch(
            vec![("place-1".into(), dir.path().to_path_buf())],
            Arc::new(move |id: &str, folder: &str| { let _ = tx.lock().unwrap().send((id.to_string(), folder.to_string())); }),
        )
        .expect("watcher");
        std::thread::sleep(std::time::Duration::from_millis(100));
        // At the place's top, which every system watches (Linux watches only the top).
        fs::write(dir.path().join("new.txt"), "x").unwrap();
        let got = rx.recv_timeout(std::time::Duration::from_secs(5)).unwrap();
        assert_eq!(got, ("place-1".to_string(), String::new()));
    }
}
