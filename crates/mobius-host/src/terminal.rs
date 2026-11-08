//! Where the Terminal app runs commands: a folder of the workspace, named by its path from the workspace with `/`
//! (`""` is the workspace itself). `cd` is worked out here, never past the workspace and never through a link that
//! leads out of it.
use std::path::{Path, PathBuf};

use serde_json::{Value, json};

/// The folder for a place already checked by `resolve`.
pub fn dir(root: &Path, cwd: &str) -> PathBuf {
    cwd.split('/').filter(|p| !p.is_empty()).fold(root.to_path_buf(), |d, p| d.join(p))
}

/// Where `cd target` from `cwd` leads: `/` or `~` start from the workspace, `..` goes up. The folder must be there.
pub fn resolve(root: &Path, cwd: &str, target: &str) -> Result<String, String> {
    let target = target.trim().trim_matches('"');
    let mut parts: Vec<String> = Vec::new();
    let from_root = target.is_empty() && cwd.is_empty() || target.starts_with('/') || target.starts_with('\\') || target == "~" || target.starts_with("~/");
    let mut all: Vec<&str> = Vec::new();
    if !from_root {
        all.extend(cwd.split(['/', '\\']));
    }
    all.extend(target.trim_start_matches('~').split(['/', '\\']));
    for part in all {
        match part {
            "" | "." => {}
            ".." => {
                if parts.pop().is_none() {
                    return Err("that is outside the workspace".into());
                }
            }
            p if p.contains(':') || p.contains('\0') => return Err("that is not a folder in the workspace".into()),
            p => parts.push(p.to_owned()),
        }
    }
    let rel = parts.join("/");
    let path = dir(root, &rel);
    let real_root = std::fs::canonicalize(root).map_err(|_| "the workspace is not there".to_owned())?;
    let real = std::fs::canonicalize(&path).map_err(|_| format!("there is no folder {}", if rel.is_empty() { "~" } else { &rel }))?;
    if !real.starts_with(&real_root) {
        return Err("that leads outside the workspace".into());
    }
    if !real.is_dir() {
        return Err(format!("{rel} is not a folder"));
    }
    Ok(rel)
}

/// The folders worth jumping to: the workspace's own and, in `code/`, each project.
pub fn places(root: &Path) -> Vec<Value> {
    let mut out = vec![json!({ "cwd": "", "name": "Workspace" })];
    let mut folders = |within: &str| -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(dir(root, within))
            .map(|r| r.flatten().filter(|e| e.file_type().is_ok_and(|t| t.is_dir())).filter_map(|e| e.file_name().to_str().map(str::to_owned)).filter(|n| !n.starts_with('.')).collect())
            .unwrap_or_default();
        names.sort_by_key(|n| n.to_lowercase());
        names
    };
    for name in folders("") {
        out.push(json!({ "cwd": name, "name": name }));
        if name == "code" {
            for project in folders("code") {
                out.push(json!({ "cwd": format!("code/{project}"), "name": project, "within": "code" }));
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cd_stays_in_the_workspace() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join("code/site/src")).unwrap();
        std::fs::create_dir_all(root.join("notes")).unwrap();
        assert_eq!(resolve(root, "", "code/site").unwrap(), "code/site");
        assert_eq!(resolve(root, "code/site", "src").unwrap(), "code/site/src");
        assert_eq!(resolve(root, "code/site/src", "../..").unwrap(), "code");
        assert_eq!(resolve(root, "code/site", "~").unwrap(), "");
        assert_eq!(resolve(root, "code/site", "/notes").unwrap(), "notes");
        assert_eq!(resolve(root, "code", "").unwrap(), "code");
        assert!(resolve(root, "", "..").is_err());
        assert!(resolve(root, "", "missing").is_err());
        assert!(resolve(root, "", "C:/Windows").is_err());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink("/", root.join("out")).unwrap();
            assert!(resolve(root, "", "out").is_err());
        }
        let names: Vec<String> = places(root).iter().map(|p| p["cwd"].as_str().unwrap().to_owned()).collect();
        assert_eq!(names, vec!["", "code", "code/site", "notes"]);
    }
}
