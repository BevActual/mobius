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
    git_bytes(dir, args, timeout).map(|out| String::from_utf8_lossy(&out).trim().to_owned())
}

/// What git printed, as it printed it (a file's text keeps its last newline).
fn git_bytes(dir: &Path, args: &[&str], timeout: Duration) -> Result<Vec<u8>, String> {
    let mut cmd = Command::new("git");
    cmd.args(args).current_dir(dir).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).env("GIT_TERMINAL_PROMPT", "0").env("GIT_OPTIONAL_LOCKS", "0");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let started = std::time::Instant::now();
    let child = cmd.spawn().map_err(|_| "Git is not installed on this computer.".to_owned())?;
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(child.wait_with_output());
    });
    let out = rx.recv_timeout(timeout).map_err(|_| "Git took too long.".to_owned())?.map_err(|e| e.to_string())?;
    let took = started.elapsed();
    if took > Duration::from_secs(1) {
        eprintln!("[mobius] git {} took {} ms", args.first().unwrap_or(&""), took.as_millis());
    }
    let text = |b: &[u8]| String::from_utf8_lossy(b).trim().to_owned();
    if out.status.success() {
        Ok(out.stdout)
    } else {
        let err = text(&out.stderr);
        Err(if err.is_empty() { text(&out.stdout) } else { err }.chars().take(2000).collect())
    }
}

const QUICK: Duration = Duration::from_secs(20);

/// Whether the project is a repository, its branch, and its changed files (`M`, `A`, `D`, `?`...). One git call:
/// on Windows each one costs a process start, and Code reads this after every save and commit.
pub fn status(dir: &Path) -> Value {
    if !dir.join(".git").exists() {
        return json!({ "repo": false });
    }
    let out = git(dir, &["status", "--porcelain=v1", "--branch", "--untracked-files=all"], QUICK).unwrap_or_default();
    let mut lines = out.lines();
    let (branch, ahead) = lines.next().and_then(|l| l.strip_prefix("## ")).map(branch_line).unwrap_or_default();
    let changes: Vec<Value> = lines
        .filter(|l| l.len() > 3)
        .take(500)
        .map(|l| json!({ "status": l[..2].trim(), "path": l[3..].trim_matches('"') }))
        .collect();
    json!({ "repo": true, "branch": branch, "changes": changes, "ahead": ahead })
}

/// `## main...origin/main [ahead 2, behind 1]`, `## main`, `## No commits yet on main` or `## HEAD (no branch)`:
/// the branch (empty when detached) and how many commits are not pushed (none without an upstream).
fn branch_line(line: &str) -> (String, Option<u64>) {
    if line.starts_with("HEAD (no branch)") {
        return (String::new(), None);
    }
    let line = line.strip_prefix("No commits yet on ").or_else(|| line.strip_prefix("Initial commit on ")).unwrap_or(line);
    let (name, rest) = line.split_once(' ').unwrap_or((line, ""));
    match name.split_once("...") {
        Some((branch, _)) => {
            let ahead = rest.split_once("ahead ").and_then(|(_, n)| n.split(|c: char| !c.is_ascii_digit()).next()).and_then(|n| n.parse().ok()).unwrap_or(0);
            (branch.to_owned(), Some(ahead))
        }
        None => (name.to_owned(), None),
    }
}

/// A file as the last commit has it, for the editor's change marks: `text` is null for a file the commit does not
/// have (new, or no commit yet) or one that is not text.
pub fn head_text(dir: &Path, path: &str) -> Value {
    if !dir.join(".git").exists() {
        return json!({ "repo": false });
    }
    if path.is_empty() || path.starts_with(['/', '\\']) || path.split(['/', '\\']).any(|p| p == "..") {
        return json!({ "repo": true, "text": null });
    }
    let text = git_bytes(dir, &["show", &format!("HEAD:./{}", path.replace('\\', "/"))], QUICK).ok().and_then(|b| String::from_utf8(b).ok());
    json!({ "repo": true, "text": text })
}

/// What changed since the last commit, as one unified diff for a review: tracked files' changes, then each new file
/// whole. Cut at `limit` bytes (on a line), with `truncated` saying so.
pub fn diff(dir: &Path, limit: usize) -> Value {
    if !dir.join(".git").exists() {
        return json!({ "repo": false });
    }
    let tracked = git_bytes(dir, &["diff", "HEAD", "--no-color", "--no-ext-diff", "-U3"], QUICK)
        .or_else(|_| git_bytes(dir, &["diff", "--no-color", "--no-ext-diff", "-U3"], QUICK))
        .map(|b| String::from_utf8_lossy(&b).into_owned())
        .unwrap_or_default();
    let mut out = tracked;
    let new = git(dir, &["ls-files", "--others", "--exclude-standard"], QUICK).unwrap_or_default();
    for path in new.lines().filter(|p| !p.is_empty()).take(50) {
        if out.len() >= limit {
            break;
        }
        let Some(text) = std::fs::read(dir.join(path)).ok().and_then(|b| String::from_utf8(b).ok()) else { continue };
        let lines: Vec<&str> = text.lines().collect();
        out.push_str(&format!("diff --git a/{path} b/{path}\nnew file\n--- /dev/null\n+++ b/{path}\n@@ -0,0 +1,{} @@\n", lines.len()));
        for l in lines {
            out.push('+');
            out.push_str(l);
            out.push('\n');
        }
    }
    let truncated = out.len() > limit;
    if truncated {
        let mut cut = limit;
        while !out.is_char_boundary(cut) {
            cut -= 1;
        }
        cut = out[..cut].rfind('\n').map_or(cut, |n| n + 1);
        out.truncate(cut);
    }
    json!({ "repo": true, "diff": out, "truncated": truncated })
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
    // Commit straight away and ask why only if it is refused: two git calls instead of four.
    let said = match git(dir, &["commit", "-m", message], QUICK) {
        Ok(said) => said,
        Err(_) if git(dir, &["diff", "--cached", "--quiet"], QUICK).is_ok() => return Err("There is nothing to commit.".into()),
        Err(e) => return Err(e),
    };
    // Its first line is `[main (root-commit) 1a2b3c4] Subject`.
    let id = said.lines().next().and_then(|l| l.strip_prefix('[')).and_then(|l| l.split(']').next()).and_then(|l| l.split_whitespace().last()).map(str::to_owned);
    let id = match id {
        Some(id) if id.chars().all(|c| c.is_ascii_hexdigit()) => id,
        _ => git(dir, &["rev-parse", "--short", "HEAD"], QUICK)?,
    };
    Ok(json!({ "ok": true, "commit": id }))
}

/// The repository's local branches, the current one first, then the newest.
pub fn branches(dir: &Path) -> Result<Value, String> {
    if !dir.join(".git").exists() {
        return Err("This project is not a git repository.".into());
    }
    // The name first: git's output is trimmed, which would eat a leading blank (%(HEAD) is a space but on the current).
    let out = git(dir, &["branch", "--format=%(refname:short)%09%(committerdate:unix)%09%(HEAD)"], QUICK)?;
    let mut list: Vec<Value> = out
        .lines()
        .filter_map(|l| {
            let mut parts = l.split('\t');
            let (name, when, head) = (parts.next()?, parts.next().and_then(|w| w.parse::<i64>().ok()).unwrap_or(0), parts.next().unwrap_or(""));
            (!name.starts_with('(') && !name.is_empty()).then(|| json!({ "name": name, "current": head.trim() == "*", "when": when }))
        })
        .collect();
    list.sort_by_key(|b| (!b["current"].as_bool().unwrap_or(false), -b["when"].as_i64().unwrap_or(0)));
    list.truncate(200);
    Ok(json!({ "branches": list }))
}

/// A branch name git takes: checked by git itself, and never one that reads as an option.
fn branch_ok(dir: &Path, name: &str) -> Result<(), String> {
    if name.is_empty() || name.len() > 200 || name.starts_with('-') || git(dir, &["check-ref-format", "--branch", name], QUICK).is_err() {
        return Err(format!("\"{name}\" cannot be a branch name."));
    }
    Ok(())
}

/// Switches to a branch, or starts a new one from here (`create`). What is not committed comes along, as with
/// `git switch`; when it would be overwritten, git refuses and says why.
pub fn switch(dir: &Path, name: &str, create: bool) -> Result<Value, String> {
    if !dir.join(".git").exists() {
        return Err("This project is not a git repository.".into());
    }
    let name = name.trim();
    branch_ok(dir, name)?;
    let args: Vec<&str> = if create { vec!["switch", "-q", "-c", name] } else { vec!["switch", "-q", name] };
    git(dir, &args, QUICK).map_err(|e| {
        let line = e.lines().find(|l| !l.trim().is_empty() && !l.starts_with("hint:")).unwrap_or("Git would not switch branches.");
        line.trim_start_matches("error: ").trim_start_matches("fatal: ").to_owned()
    })?;
    Ok(json!({ "ok": true, "branch": name }))
}

/// The branch's latest commits, newest first: id, subject, author, when (seconds), and whether it is pushed.
pub fn history(dir: &Path, limit: usize) -> Value {
    if !dir.join(".git").exists() {
        return json!({ "repo": false });
    }
    let n = format!("-n{}", limit.clamp(1, 500));
    let out = git(dir, &["log", &n, "--format=%h%x09%ct%x09%an%x09%s"], QUICK).unwrap_or_default();
    let upstream = git(dir, &["rev-parse", "--abbrev-ref", "@{u}"], QUICK).is_ok();
    let pushed: std::collections::HashSet<String> = if upstream {
        git(dir, &["rev-list", "--abbrev-commit", &n, "@{u}"], QUICK).map(|o| o.lines().map(str::to_owned).collect()).unwrap_or_default()
    } else {
        Default::default()
    };
    let commits: Vec<Value> = out
        .lines()
        .filter_map(|l| {
            let mut p = l.splitn(4, '\t');
            let (id, when, author, subject) = (p.next()?, p.next()?.parse::<i64>().ok()?, p.next()?, p.next().unwrap_or(""));
            Some(json!({ "id": id, "when": when, "author": author, "subject": subject, "pushed": pushed.contains(id) }))
        })
        .collect();
    json!({ "repo": true, "commits": commits })
}

/// One commit: its whole message and the files it changed, with lines added and removed.
pub fn show(dir: &Path, id: &str) -> Result<Value, String> {
    if id.is_empty() || id.len() > 64 || !id.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("That is not a commit.".into());
    }
    let message = git(dir, &["log", "-n1", "--format=%B", id], QUICK)?;
    let numstat = git(dir, &["show", "--numstat", "--format=", id], QUICK)?;
    let files: Vec<Value> = numstat
        .lines()
        .filter_map(|l| {
            let mut p = l.splitn(3, '\t');
            let (added, removed, path) = (p.next()?, p.next()?, p.next()?);
            Some(json!({ "path": path, "added": added.parse::<u64>().ok(), "removed": removed.parse::<u64>().ok() }))
        })
        .collect();
    Ok(json!({ "id": id, "message": message, "files": files }))
}

/// Puts a file back as the last commit has it, throwing away what changed since; a file the commit does not have is
/// removed. The person asked, on that file; nothing else changes.
pub fn discard(dir: &Path, path: &str) -> Result<Value, String> {
    if !dir.join(".git").exists() {
        return Err("This project is not a git repository.".into());
    }
    if path.is_empty() || path.starts_with(['/', '\\', '-']) || path.contains(':') || path.split(['/', '\\']).any(|p| p == ".." || p == ".git") {
        return Err("That file cannot be put back.".into());
    }
    let tracked = git(dir, &["ls-files", "--error-unmatch", "--", path], QUICK).is_ok();
    let in_head = git(dir, &["cat-file", "-e", &format!("HEAD:./{path}")], QUICK).is_ok();
    if in_head {
        git(dir, &["restore", "--source=HEAD", "--staged", "--worktree", "--", path], QUICK)?;
    } else {
        if tracked {
            git(dir, &["rm", "-q", "--cached", "--", path], QUICK)?;
        }
        let file = dir.join(path);
        if file.is_file() {
            std::fs::remove_file(&file).map_err(|e| e.to_string())?;
        }
    }
    Ok(json!({ "ok": true, "path": path }))
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
        std::fs::write(work.join("a.txt"), "two").unwrap();
        commit(&work, "Change a").unwrap();
        let s = status(&work);
        assert_eq!((s["branch"].as_str(), s["ahead"].as_u64(), s["changes"].as_array().map(Vec::len)), (Some("main"), Some(1), Some(0)));
    }

    #[test]
    fn branches_are_listed_switched_and_started_history_read_and_a_file_put_back() {
        let dir = tempfile::tempdir().unwrap();
        let d = dir.path();
        if git(d, &["init", "-q", "-b", "main"], QUICK).is_err() {
            return;
        }
        let _ = git(d, &["config", "user.email", "test@example.com"], QUICK);
        let _ = git(d, &["config", "user.name", "Test"], QUICK);
        std::fs::write(d.join("a.txt"), "one\n").unwrap();
        commit(d, "First\n\nWhy it was done.").unwrap();
        let list = branches(d).unwrap();
        assert_eq!((list["branches"][0]["name"].as_str(), list["branches"][0]["current"].as_bool()), (Some("main"), Some(true)));
        // A new branch from here, then back; a name git would refuse, or one like an option, is refused first.
        switch(d, "fix/split-cents", true).unwrap();
        assert_eq!(status(d)["branch"], "fix/split-cents");
        assert!(switch(d, "-x", true).is_err());
        assert!(switch(d, "a..b", true).unwrap_err().contains("cannot be a branch name"));
        assert!(switch(d, "nope", false).is_err());
        std::fs::write(d.join("a.txt"), "two\n").unwrap();
        commit(d, "Second").unwrap();
        let names: Vec<(String, bool)> = branches(d).unwrap()["branches"].as_array().unwrap().iter().map(|b| (b["name"].as_str().unwrap().to_owned(), b["current"].as_bool().unwrap())).collect();
        assert_eq!(names, [("fix/split-cents".to_owned(), true), ("main".to_owned(), false)]);
        switch(d, "main", false).unwrap();
        let names: Vec<(String, bool)> = branches(d).unwrap()["branches"].as_array().unwrap().iter().map(|b| (b["name"].as_str().unwrap().to_owned(), b["current"].as_bool().unwrap())).collect();
        assert_eq!(names, [("main".to_owned(), true), ("fix/split-cents".to_owned(), false)]);
        switch(d, "fix/split-cents", false).unwrap();
        let h = history(d, 10);
        let commits = h["commits"].as_array().unwrap();
        assert_eq!(commits.len(), 2);
        assert_eq!((commits[0]["subject"].as_str(), commits[0]["author"].as_str(), commits[0]["pushed"].as_bool()), (Some("Second"), Some("Test"), Some(false)));
        let first = show(d, commits[1]["id"].as_str().unwrap()).unwrap();
        assert_eq!(first["message"], "First\n\nWhy it was done.");
        assert_eq!(first["files"], json!([{ "path": "a.txt", "added": 1, "removed": 0 }]));
        assert!(show(d, "HEAD; rm").is_err());
        switch(d, "main", false).unwrap();
        assert_eq!(std::fs::read_to_string(d.join("a.txt")).unwrap(), "one\n");
        // Discard: a changed file goes back to the commit, a new one goes, and nothing outside is touched.
        std::fs::write(d.join("a.txt"), "changed\n").unwrap();
        std::fs::write(d.join("new.txt"), "new\n").unwrap();
        discard(d, "a.txt").unwrap();
        discard(d, "new.txt").unwrap();
        assert_eq!(std::fs::read_to_string(d.join("a.txt")).unwrap(), "one\n");
        assert!(!d.join("new.txt").exists());
        assert_eq!(status(d)["changes"], json!([]));
        for bad in ["../x", "/etc/passwd", ".git/config", "-f", "C:x"] {
            assert!(discard(d, bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn the_branch_line_gives_the_branch_and_what_is_not_pushed() {
        assert_eq!(branch_line("main"), ("main".into(), None));
        assert_eq!(branch_line("No commits yet on main"), ("main".into(), None));
        assert_eq!(branch_line("feature/x...origin/feature/x"), ("feature/x".into(), Some(0)));
        assert_eq!(branch_line("main...origin/main [ahead 12, behind 1]"), ("main".into(), Some(12)));
        assert_eq!(branch_line("main...origin/main [behind 3]"), ("main".into(), Some(0)));
        assert_eq!(branch_line("HEAD (no branch)"), (String::new(), None));
    }

    #[test]
    fn a_review_gets_changes_and_new_files_as_one_diff_cut_to_size() {
        let dir = tempfile::tempdir().unwrap();
        let d = dir.path();
        assert_eq!(diff(d, 1000), json!({ "repo": false }));
        if git(d, &["init", "-q"], QUICK).is_err() {
            return;
        }
        let _ = git(d, &["config", "user.email", "test@example.com"], QUICK);
        let _ = git(d, &["config", "user.name", "Test"], QUICK);
        std::fs::write(d.join("a.js"), "one\ntwo\n").unwrap();
        commit(d, "first").unwrap();
        std::fs::write(d.join("a.js"), "one\n2\n").unwrap();
        std::fs::write(d.join("b.js"), "new\n").unwrap();
        let all = diff(d, 10_000);
        let text = all["diff"].as_str().unwrap();
        assert!(text.contains("-two\n+2\n"), "{text}");
        assert!(text.contains("+++ b/b.js\n@@ -0,0 +1,1 @@\n+new\n"), "{text}");
        assert_eq!(all["truncated"], false);
        let cut = diff(d, 40);
        assert_eq!(cut["truncated"], true);
        assert!(cut["diff"].as_str().unwrap().len() <= 40 && cut["diff"].as_str().unwrap().ends_with('\n'));
    }

    #[test]
    fn the_last_commits_text_keeps_its_last_newline() {
        let dir = tempfile::tempdir().unwrap();
        let d = dir.path();
        if git(d, &["init", "-q"], QUICK).is_err() {
            return;
        }
        let _ = git(d, &["config", "user.email", "test@example.com"], QUICK);
        let _ = git(d, &["config", "user.name", "Test"], QUICK);
        std::fs::create_dir_all(d.join("src")).unwrap();
        std::fs::write(d.join("src/a.js"), "one\ntwo\n").unwrap();
        assert_eq!(head_text(d, "src/a.js")["text"], Value::Null);
        commit(d, "first").unwrap();
        std::fs::write(d.join("src/a.js"), "changed").unwrap();
        assert_eq!(head_text(d, "src/a.js")["text"], "one\ntwo\n");
        assert_eq!(head_text(d, "../x")["text"], Value::Null);
        assert_eq!(head_text(&d.join("src"), "a.js"), json!({ "repo": false }));
    }
}
