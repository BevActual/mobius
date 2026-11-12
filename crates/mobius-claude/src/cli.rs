//! Finding the official Claude Code CLI, asking it about its sign-in, and the environment it is started with.
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use serde_json::{Value, json};

pub const INSTALL_HINT: &str = "Claude Code is not installed. Install it with: npm install -g @anthropic-ai/claude-code";
pub const SIGN_IN_HINT: &str = "Claude Code is not signed in. Sign in from Settings, or run: claude auth login";

/// Where Claude Code puts itself, besides PATH. A desktop app often starts with a short PATH.
fn known_dirs() -> Vec<PathBuf> {
    let home = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).map(PathBuf::from);
    let mut dirs = Vec::new();
    if let Some(h) = &home {
        for rel in [".local/bin", ".claude/local", "bin", ".npm-global/bin", ".bun/bin", ".volta/bin"] {
            dirs.push(h.join(rel));
        }
    }
    if let Some(appdata) = std::env::var_os("APPDATA") {
        dirs.push(PathBuf::from(appdata).join("npm"));
    }
    dirs.extend(["/opt/homebrew/bin", "/usr/local/bin"].map(PathBuf::from));
    dirs
}

fn candidates(dir: &Path, name: &str) -> Vec<PathBuf> {
    if cfg!(windows) { ["exe", "cmd", "bat"].iter().map(|e| dir.join(format!("{name}.{e}"))).collect() } else { vec![dir.join(name)] }
}

/// The CLI to run: an explicit path if given and present, else `claude` on PATH, else in the usual install folders.
pub fn find(explicit: Option<&Path>) -> Option<PathBuf> {
    if let Some(p) = explicit {
        return p.is_file().then(|| p.to_path_buf());
    }
    find_named("claude")
}

/// A program by name on PATH or in the usual install folders (`claude`, `copilot`).
pub fn find_named(name: &str) -> Option<PathBuf> {
    find_named_where(name, |_| true)
}

/// Like `find_named`, skipping any match `keep` turns down.
pub fn find_named_where(name: &str, keep: impl Fn(&Path) -> bool) -> Option<PathBuf> {
    let path = std::env::var_os("PATH").unwrap_or_default();
    let mut dirs: Vec<PathBuf> = std::env::split_paths(&path).chain(known_dirs()).collect();
    // WinGet puts its programs here.
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        dirs.push(PathBuf::from(local).join("Microsoft").join("WinGet").join("Links"));
    }
    dirs.iter().flat_map(|d| candidates(d, name)).find(|p| p.is_file() && keep(p))
}

pub fn quiet(command: &mut Command) -> &mut Command {
    #[cfg(windows)]
    std::os::windows::process::CommandExt::creation_flags(command, 0x0800_0000); // no console window
    command
}

fn run(program: &Path, args: &[&str], timeout: Duration) -> Option<String> {
    let mut child = quiet(Command::new(program).args(args).env_clear().envs(child_env(&BTreeMap::new()))).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().ok()?;
    let mut stdout = child.stdout.take()?;
    let reader = std::thread::spawn(move || {
        let mut out = String::new();
        std::io::Read::read_to_string(&mut stdout, &mut out).ok().map(|_| out)
    });
    let started = std::time::Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if started.elapsed() > timeout => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(30)),
            Err(_) => return None,
        }
    }
    reader.join().ok().flatten()
}

/// What Settings shows: installed, its version, signed in, and which account (the CLI's own report).
pub fn status(program: Option<&Path>) -> Value {
    let Some(program) = find(program) else {
        return json!({ "installed": false, "signedIn": false, "hint": INSTALL_HINT });
    };
    let version = run(&program, &["--version"], Duration::from_secs(10)).and_then(|v| v.split_whitespace().next().map(str::to_owned));
    let auth = run(&program, &["auth", "status"], Duration::from_secs(15)).and_then(|t| serde_json::from_str::<Value>(&t).ok()).unwrap_or(Value::Null);
    let signed_in = auth["loggedIn"] == true;
    json!({
        "installed": true,
        "version": version,
        "signedIn": signed_in,
        "account": if signed_in { auth["email"].clone() } else { Value::Null },
        "hint": if signed_in { Value::Null } else { json!(SIGN_IN_HINT) },
    })
}

/// Variables that would send the CLI somewhere other than the person's subscription, or change what it does.
const REMOVED: &[&str] = &[
    "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "ANTHROPIC_FOUNDRY_API_KEY", "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY", "CLAUDE_CODE_EXTRA_BODY", "CLAUDE_CODE_EFFORT_LEVEL",
];

/// The environment the CLI runs with: Mobius's own, minus anything that would bypass the subscription, plus the
/// switches that hand tools, memory, instructions and compaction to Mobius. `extra` comes last (the relay address).
pub fn child_env(extra: &BTreeMap<String, String>) -> BTreeMap<String, String> {
    child_env_from(std::env::vars(), extra)
}

/// `child_env` starting from a given environment, so it can be checked with one that carries keys.
pub fn child_env_from(base: impl Iterator<Item = (String, String)>, extra: &BTreeMap<String, String>) -> BTreeMap<String, String> {
    let mut env: BTreeMap<String, String> = base.filter(|(k, _)| !REMOVED.iter().any(|r| r.eq_ignore_ascii_case(k))).collect();
    for (k, v) in [
        ("ENABLE_TOOL_SEARCH", "false"),
        ("CLAUDE_CODE_MAX_RETRIES", "0"),
        ("DISABLE_AUTO_COMPACT", "1"),
        ("DISABLE_COMPACT", "1"),
        ("CLAUDE_CODE_TOTAL_TOKENS_REMINDER", "off"),
        ("CLAUDE_CODE_DISABLE_AUTO_MEMORY", "1"),
        ("CLAUDE_CODE_DISABLE_CLAUDE_MDS", "1"),
    ] {
        env.insert(k.into(), v.into());
    }
    env.extend(extra.clone());
    env
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_child_never_gets_a_key_or_another_backend() {
        let inherited = REMOVED.iter().map(|k| ((*k).to_owned(), "inherited-secret".to_owned())).chain([("anthropic_api_key".to_owned(), "lower".to_owned()), ("PATH".to_owned(), "C:/bin".to_owned())]);
        let env = child_env_from(inherited, &BTreeMap::from([("ANTHROPIC_BASE_URL".to_owned(), "http://127.0.0.1:1/x".to_owned())]));
        for k in REMOVED.iter().filter(|k| **k != "ANTHROPIC_BASE_URL") {
            assert!(!env.contains_key(*k), "{k}");
        }
        assert!(!env.contains_key("anthropic_api_key"), "names are matched without regard to case, as Windows does");
        assert!(!env.values().any(|v| v == "inherited-secret" || v == "lower"));
        assert_eq!(env["PATH"], "C:/bin", "everything else is kept");
        assert_eq!(env["ANTHROPIC_BASE_URL"], "http://127.0.0.1:1/x", "only the relay address given by Mobius");
        assert_eq!(env["CLAUDE_CODE_DISABLE_AUTO_MEMORY"], "1");
        assert_eq!(env["CLAUDE_CODE_MAX_RETRIES"], "0");
    }

    #[test]
    fn a_missing_cli_is_reported_with_how_to_install_it() {
        let s = status(Some(Path::new("Z:/definitely/not/claude.exe")));
        assert_eq!(s["installed"], false);
        assert!(s["hint"].as_str().unwrap().contains("npm install"));
    }
}
