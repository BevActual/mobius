//! Code: each project is a folder in `<workspace>/code`, real files any editor or terminal can open. The agent changes
//! them with the ordinary file tools (`files.edit` on `code/<project>/…`), so every change is checkpointed and shown in
//! the window as a suggestion to keep or discard; the person saves here with a check that nothing changed meanwhile.
//!
//! Running a project's tests is not here: the command is the person's, kept outside the workspace by the application,
//! so a file the agent writes can never choose what runs.
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde_json::{Value, json};

use crate::notes::file_name_for;

type Res<T> = Result<T, String>;

pub const FOLDER: &str = "code";
const MAX_FILE: usize = 2 * 1024 * 1024;
const MAX_TREE: usize = 3000;
const MAX_DEPTH: usize = 12;
/// Folders that are made by tools rather than written by people: big, and not worth showing or searching.
pub const SKIPPED: [&str; 10] = ["node_modules", ".git", "target", "dist", "build", "__pycache__", ".venv", "venv", ".next", ".cache"];

pub struct Code {
    root: PathBuf,
}

fn modified_ms(path: &Path) -> u64 {
    fs::metadata(path).and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
}

/// A project name: one safe folder name.
pub fn project_ok(name: &str) -> bool {
    !name.is_empty() && name == file_name_for(name) && !name.starts_with('.')
}

/// A path inside a project, `src/budget.ts`: plain parts only, no `..`, nothing absolute.
pub fn path_ok(path: &str) -> bool {
    let part_ok = |s: &str| s == file_name_for(s) || s.strip_prefix('.').is_some_and(|rest| !rest.starts_with('.') && rest == file_name_for(rest));
    !path.is_empty() && path.len() <= 400 && !path.contains('\\') && !path.ends_with('/') && !path.contains("//") && Path::new(path).components().all(|c| matches!(c, Component::Normal(p) if p.to_str().is_some_and(part_ok)))
}

/// Text or not, judged the way editors do: no NUL bytes and valid UTF-8.
fn as_text(bytes: Vec<u8>) -> Option<String> {
    if bytes.contains(&0) {
        return None;
    }
    String::from_utf8(bytes).ok()
}

impl Code {
    pub fn new(workspace: impl Into<PathBuf>) -> Code {
        Code { root: workspace.into().join(FOLDER) }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// The folder of a project, if it is one.
    pub fn project_dir(&self, project: &str) -> Res<PathBuf> {
        if !project_ok(project) {
            return Err("that is not a project name".into());
        }
        let dir = self.root.join(project);
        if !dir.is_dir() {
            return Err("that project is not there".into());
        }
        Ok(dir)
    }

    /// A file in a project, refused if any part of the way is a link (it could lead out of the workspace).
    fn file(&self, project: &str, path: &str) -> Res<PathBuf> {
        let dir = self.project_dir(project)?;
        if !path_ok(path) {
            return Err("that is not a file in the project".into());
        }
        let mut at = dir.clone();
        for part in Path::new(path).components() {
            at.push(part);
            if fs::symlink_metadata(&at).is_ok_and(|m| m.file_type().is_symlink()) {
                return Err("that file is a link, which Code does not follow".into());
            }
        }
        Ok(at)
    }

    pub fn projects(&self) -> Res<Value> {
        let mut out = Vec::new();
        if let Ok(entries) = fs::read_dir(&self.root) {
            for e in entries.flatten() {
                let name = e.file_name().to_string_lossy().into_owned();
                if e.file_type().is_ok_and(|t| t.is_dir()) && project_ok(&name) {
                    out.push(json!({ "name": name, "modified": modified_ms(&e.path()) }));
                }
            }
        }
        out.sort_by_key(|p| p["name"].as_str().unwrap_or("").to_lowercase());
        Ok(Value::Array(out))
    }

    pub fn create_project(&self, name: &str) -> Res<Value> {
        let name = file_name_for(name);
        fs::create_dir_all(&self.root).map_err(|e| e.to_string())?;
        let mut chosen = name.clone();
        let mut n = 2;
        while self.root.join(&chosen).exists() {
            chosen = format!("{name} {n}");
            n += 1;
        }
        let dir = self.root.join(&chosen);
        fs::create_dir(&dir).map_err(|e| e.to_string())?;
        fs::write(dir.join("README.md"), format!("# {chosen}\n")).map_err(|e| e.to_string())?;
        Ok(json!({ "name": chosen }))
    }

    /// Every folder and file, folders first, as paths relative to the project. Generated folders are left out.
    pub fn tree(&self, project: &str) -> Res<Value> {
        let dir = self.project_dir(project)?;
        let mut out = Vec::new();
        let mut truncated = false;
        walk(&dir, "", 0, &mut out, &mut truncated);
        Ok(json!({ "project": project, "entries": out, "truncated": truncated }))
    }

    pub fn read(&self, project: &str, path: &str) -> Res<Value> {
        let file = self.file(project, path)?;
        let meta = fs::metadata(&file).map_err(|_| "that file is not there".to_owned())?;
        if !meta.is_file() {
            return Err("that is a folder".into());
        }
        if meta.len() > MAX_FILE as u64 {
            return Ok(json!({ "project": project, "path": path, "text": null, "why": "too big to open here", "modified": modified_ms(&file) }));
        }
        let bytes = fs::read(&file).map_err(|e| e.to_string())?;
        match as_text(bytes) {
            Some(text) => Ok(json!({ "project": project, "path": path, "text": text, "modified": modified_ms(&file) })),
            None => Ok(json!({ "project": project, "path": path, "text": null, "why": "not a text file", "modified": modified_ms(&file) })),
        }
    }

    /// Writes a file the person changed; `base` is the `modified` it had when read, and the save is refused if the file
    /// changed since (the agent, or another editor).
    pub fn save(&self, project: &str, path: &str, text: &str, base: Option<u64>) -> Res<Value> {
        if text.len() > MAX_FILE {
            return Err("that file is too big".into());
        }
        let file = self.file(project, path)?;
        if let Some(base) = base
            && file.exists()
            && modified_ms(&file) != base
        {
            return Err("changed elsewhere".into());
        }
        if let Some(parent) = file.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let temp = file.with_file_name(format!(".{}.mobius-tmp", file.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()));
        fs::write(&temp, text).map_err(|e| e.to_string())?;
        fs::rename(&temp, &file).map_err(|e| {
            let _ = fs::remove_file(&temp);
            e.to_string()
        })?;
        Ok(json!({ "project": project, "path": path, "modified": modified_ms(&file) }))
    }

    /// A new, empty file; refused if one is there.
    pub fn create_file(&self, project: &str, path: &str) -> Res<Value> {
        let file = self.file(project, path)?;
        if file.exists() {
            return Err("there is a file with that name".into());
        }
        self.save(project, path, "", None)
    }

    pub fn remove_file(&self, project: &str, path: &str) -> Res<Value> {
        let file = self.file(project, path)?;
        if !file.is_file() {
            return Err("that file is not there".into());
        }
        fs::remove_file(&file).map_err(|e| e.to_string())?;
        Ok(json!({ "project": project, "path": path, "removed": true }))
    }
}

fn walk(dir: &Path, prefix: &str, depth: usize, out: &mut Vec<Value>, truncated: &mut bool) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    let mut items: Vec<(String, bool)> = entries
        .flatten()
        .filter_map(|e| {
            let t = e.file_type().ok()?;
            let name = e.file_name().to_str()?.to_owned();
            if t.is_symlink() || name.ends_with(".mobius-tmp") || (t.is_dir() && SKIPPED.contains(&name.as_str())) || name == ".DS_Store" {
                return None;
            }
            Some((name, t.is_dir()))
        })
        .collect();
    items.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.to_lowercase().cmp(&b.0.to_lowercase())));
    for (name, is_dir) in items {
        if out.len() >= MAX_TREE {
            *truncated = true;
            return;
        }
        let path = if prefix.is_empty() { name.clone() } else { format!("{prefix}/{name}") };
        out.push(json!({ "path": path, "folder": is_dir, "depth": depth }));
        if is_dir && depth < MAX_DEPTH {
            walk(&dir.join(&name), &path, depth + 1, out, truncated);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn code() -> (tempfile::TempDir, Code) {
        let dir = tempfile::tempdir().unwrap();
        let code = Code::new(dir.path());
        (dir, code)
    }

    #[test]
    fn paths_stay_inside_the_project() {
        for good in ["src/budget.ts", "README.md", ".gitignore", "tests/a b.test.ts"] {
            assert!(path_ok(good), "{good}");
        }
        for bad in ["", "../x", "src/../../x", "/etc/passwd", "C:/x", "a\\b", "src/..", "a//b", "a/", "x/.."] {
            assert!(!path_ok(bad), "{bad}");
        }
    }

    #[test]
    fn projects_files_and_saves() {
        let (_d, code) = code();
        assert_eq!(code.create_project("offsite planner").unwrap()["name"], "offsite planner");
        assert_eq!(code.create_project("offsite planner").unwrap()["name"], "offsite planner 2");
        assert_eq!(code.projects().unwrap().as_array().unwrap().len(), 2);
        let saved = code.save("offsite planner", "src/budget.ts", "export const a = 1;\n", None).unwrap();
        fs::create_dir_all(code.root().join("offsite planner/node_modules/x")).unwrap();
        let tree = code.tree("offsite planner").unwrap();
        let paths: Vec<&str> = tree["entries"].as_array().unwrap().iter().map(|e| e["path"].as_str().unwrap()).collect();
        assert_eq!(paths, ["src", "src/budget.ts", "README.md"]);
        let read = code.read("offsite planner", "src/budget.ts").unwrap();
        assert_eq!(read["text"], "export const a = 1;\n");
        assert_eq!(read["modified"], saved["modified"]);
        fs::write(code.root().join("offsite planner/blob.bin"), [0u8, 1, 2]).unwrap();
        assert_eq!(code.read("offsite planner", "blob.bin").unwrap()["why"], "not a text file");
        // Someone else changed it after it was read.
        std::thread::sleep(std::time::Duration::from_millis(20));
        fs::write(code.root().join("offsite planner/src/budget.ts"), "x").unwrap();
        assert_eq!(code.save("offsite planner", "src/budget.ts", "y", saved["modified"].as_u64()).unwrap_err(), "changed elsewhere");
        assert!(code.create_file("offsite planner", "src/budget.ts").is_err());
        assert!(code.read("offsite planner", "../x").is_err());
        assert!(code.read("..", "x").is_err());
        code.remove_file("offsite planner", "src/budget.ts").unwrap();
        assert!(code.read("offsite planner", "src/budget.ts").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn links_are_not_followed() {
        let (d, code) = code();
        code.create_project("p").unwrap();
        fs::write(d.path().join("secret"), "s").unwrap();
        std::os::unix::fs::symlink(d.path().join("secret"), code.root().join("p/link")).unwrap();
        assert!(code.read("p", "link").is_err());
        assert!(code.save("p", "link", "x", None).is_err());
        assert_eq!(code.tree("p").unwrap()["entries"].as_array().unwrap().len(), 1);
    }
}
