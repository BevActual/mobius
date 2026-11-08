//! Git for a Code project that is a repository: what changed, a commit, and a push. The project's own history is
//! used (the checkpoints the agent's turns are undone with are kept apart). The agent's `code.commit` and `code.push`
//! always go through the usual approvals; no per-app setting lets them run without asking.
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::Duration;

use serde_json::{Value, json};

pub fn is_git_tool(name: &str) -> bool {
    matches!(name, "code.commit" | "code.push")
}

pub fn tool_descriptions() -> Vec<Value> {
    vec![
        json!({ "name": "code.commit", "capability": "code.commit", "resource_arg": "project",
            "description": "Commit everything changed in a Code project that is a git repository, with a short message saying what and why. The person is asked first.",
            "input_schema": { "type": "object", "properties": { "project": { "type": "string" }, "message": { "type": "string", "description": "One line, under 72 characters, then an optional paragraph." } }, "required": ["project", "message"] } }),
        json!({ "name": "code.push", "capability": "code.push", "resource_arg": "project",
            "description": "Push a Code project's current branch to its remote. The person is asked first.",
            "input_schema": { "type": "object", "properties": { "project": { "type": "string" } }, "required": ["project"] } }),
    ]
}

fn git(dir: &Path, args: &[&str], timeout: Duration) -> Result<String, String> {
    let mut cmd = Command::new("git");
    cmd.args(args).current_dir(dir).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).env("GIT_TERMINAL_PROMPT", "0").env("GIT_OPTIONAL_LOCKS", "0");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let child = cmd.spawn().map_err(|_| "Git is not installed on this computer.".to_owned())?;
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(child.wait_with_output());
    });
    let out = rx.recv_timeout(timeout).map_err(|_| "Git took too long.".to_owned())?.map_err(|e| e.to_string())?;
    let text = |b: &[u8]| String::from_utf8_lossy(b).trim().to_owned();
    if out.status.success() {
        Ok(text(&out.stdout))
    } else {
        let err = text(&out.stderr);
        Err(if err.is_empty() { text(&out.stdout) } else { err }.chars().take(2000).collect())
    }
}

const QUICK: Duration = Duration::from_secs(20);

/// Whether the project is a repository, its branch, and its changed files (`M`, `A`, `D`, `?`...).
pub fn status(dir: &Path) -> Value {
    if !dir.join(".git").exists() {
        return json!({ "repo": false });
    }
    let branch = git(dir, &["symbolic-ref", "--short", "HEAD"], QUICK).unwrap_or_default();
    let changes: Vec<Value> = git(dir, &["status", "--porcelain=v1", "--untracked-files=all"], QUICK)
        .unwrap_or_default()
        .lines()
        .filter(|l| l.len() > 3)
        .take(500)
        .map(|l| json!({ "status": l[..2].trim(), "path": l[3..].trim_matches('"') }))
        .collect();
    let ahead = git(dir, &["rev-list", "--count", "@{u}..HEAD"], QUICK).ok().and_then(|n| n.parse::<u64>().ok());
    json!({ "repo": true, "branch": branch, "changes": changes, "ahead": ahead })
}

/// Commits everything changed. Refused with nothing to commit, or a message that is empty or too long.
pub fn commit(dir: &Path, message: &str) -> Result<Value, String> {
    let message = message.trim();
    if message.is_empty() || message.len() > 5000 {
        return Err("A commit needs a message of a line or a few.".into());
    }
    if !dir.join(".git").exists() {
        return Err("This project is not a git repository.".into());
    }
    git(dir, &["add", "-A"], QUICK)?;
    if git(dir, &["diff", "--cached", "--quiet"], QUICK).is_ok() {
        return Err("There is nothing to commit.".into());
    }
    git(dir, &["commit", "-q", "-m", message], QUICK)?;
    let id = git(dir, &["rev-parse", "--short", "HEAD"], QUICK)?;
    Ok(json!({ "ok": true, "commit": id }))
}

/// Pushes the current branch to its upstream (or to `origin` under the same name, the first time).
pub fn push(dir: &Path) -> Result<Value, String> {
    if !dir.join(".git").exists() {
        return Err("This project is not a git repository.".into());
    }
    let branch = git(dir, &["symbolic-ref", "--short", "HEAD"], QUICK)?;
    let has_upstream = git(dir, &["rev-parse", "--abbrev-ref", "@{u}"], QUICK).is_ok();
    let args: Vec<&str> = if has_upstream { vec!["push", "-q"] } else { vec!["push", "-q", "-u", "origin", branch.as_str()] };
    git(dir, &args, Duration::from_secs(120))?;
    Ok(json!({ "ok": true, "branch": branch }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_repository_is_read_committed_and_pushed() {
        let dir = tempfile::tempdir().unwrap();
        let remote = dir.path().join("remote.git");
        let work = dir.path().join("work");
        std::fs::create_dir(&work).unwrap();
        assert_eq!(status(&work)["repo"], false);
        assert!(commit(&work, "x").is_err());
        git(dir.path(), &["init", "-q", "--bare", remote.to_str().unwrap()], QUICK).unwrap();
        for args in [&["init", "-q", "-b", "main"][..], &["config", "user.email", "t@example.com"], &["config", "user.name", "T"], &["remote", "add", "origin", remote.to_str().unwrap()]] {
            git(&work, args, QUICK).unwrap();
        }
        std::fs::write(work.join("a.txt"), "one").unwrap();
        let s = status(&work);
        assert_eq!(s["branch"], "main");
        assert_eq!(s["changes"], json!([{ "status": "??", "path": "a.txt" }]));
        assert!(commit(&work, "  ").is_err());
        assert!(commit(&work, "Add a").unwrap()["commit"].as_str().is_some());
        assert_eq!(commit(&work, "again").unwrap_err(), "There is nothing to commit.");
        assert_eq!(push(&work).unwrap()["branch"], "main");
        assert_eq!(status(&work)["ahead"], 0);
    }
}
