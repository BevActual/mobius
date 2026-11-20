//! The computer's own things for the launcher: the apps installed on it, and a few system commands.
//!
//! The bridge's `system` calls:
//! - `apps()` → `[{ name, id }]`, sorted by name: on Windows every app the Start menu lists, Store apps included
//!   (PowerShell's `Get-StartApps`; `id` is the app's AppsFolder id), on Linux the desktop entries (`id` is the file).
//! - `open(id)` → `{ ok }`: starts an app `apps()` listed. Any other id is refused, so a page can never use this to
//!   start a program of its choosing.
//! - `commands()` → `[{ id, name }]`: the system commands this computer has.
//! - `files(query)` → `[{ name, path }]`: up to 20 files whose names hold every word typed, from the person's Desktop,
//!   Documents, Downloads, Pictures, Music and Videos (a short walk, cut off after [`LOOK_FOR`]). Programs and scripts
//!   are never listed.
//! - `openFile(path)` / `reveal(path)` → `{ ok }`: opens a file, or shows it in its folder, but only one the last
//!   `files()` found, so a page can't open a path of its choosing.
//! - `run(id)` → `{ ok }`: runs one of them. Emptying the Recycle Bin asks Windows' own question first, and is `ok`
//!   only when the bin is empty afterwards (so answering No is not).
use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde_json::{Value, json};

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct App {
    pub name: String,
    pub id: String,
}

/// Whether a listed entry is an app someone would open, not an uninstaller, help link or background helper.
fn worth_listing(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    !(name.trim().is_empty()
        || lower.starts_with("uninstall")
        || lower.contains("uninstall ")
        || lower.ends_with(" help")
        || lower.ends_with(" readme")
        || lower.ends_with(" autostart")
        || lower == "administrative tools")
}

/// The apps in `Get-StartApps | ConvertTo-Json` output: an array, or one object when there is only one.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn parse_start_apps(text: &str) -> Vec<App> {
    let value: Value = serde_json::from_str(text.trim()).unwrap_or(Value::Null);
    let items = match value {
        Value::Array(items) => items,
        Value::Object(_) => vec![value],
        _ => Vec::new(),
    };
    items
        .iter()
        .filter_map(|item| {
            let name = item.get("Name")?.as_str()?.trim().to_owned();
            let id = item.get("AppID")?.as_str()?.trim().to_owned();
            (!id.is_empty() && worth_listing(&name)).then_some(App { name, id })
        })
        .collect()
}

/// Sorted by name, once each.
fn tidy(mut found: Vec<App>) -> Vec<App> {
    found.sort();
    found.dedup_by(|a, b| a.name.eq_ignore_ascii_case(&b.name));
    found
}

#[cfg(windows)]
fn find_apps() -> Vec<App> {
    use std::os::windows::process::CommandExt;
    const NO_WINDOW: u32 = 0x0800_0000;
    let script = "[Console]::OutputEncoding = [Text.Encoding]::UTF8; Get-StartApps | Select-Object Name, AppID | ConvertTo-Json -Compress";
    let Ok(out) = std::process::Command::new("powershell.exe").args(["-NoProfile", "-NonInteractive", "-Command", script]).creation_flags(NO_WINDOW).output() else {
        return Vec::new();
    };
    tidy(parse_start_apps(&String::from_utf8_lossy(&out.stdout)))
}

#[cfg(not(windows))]
fn find_apps() -> Vec<App> {
    let mut found = Vec::new();
    let mut folders = vec![PathBuf::from("/usr/share/applications"), PathBuf::from("/usr/local/share/applications")];
    if let Ok(home) = std::env::var("HOME") {
        folders.push(Path::new(&home).join(".local/share/applications"));
    }
    for folder in folders {
        walk(&folder, 0, &mut found);
    }
    tidy(found)
}

/// The name a desktop entry shows, unless it asks to be hidden.
#[cfg_attr(windows, allow(dead_code))]
pub fn desktop_name(entry: &str) -> Option<String> {
    let mut name = None;
    let mut in_entry = false;
    for line in entry.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            in_entry = line == "[Desktop Entry]";
            continue;
        }
        if !in_entry {
            continue;
        }
        if line == "NoDisplay=true" || line == "Hidden=true" {
            return None;
        }
        if name.is_none() && let Some(value) = line.strip_prefix("Name=") {
            name = Some(value.trim().to_owned());
        }
    }
    name.filter(|n| !n.is_empty())
}

#[cfg(not(windows))]
fn walk(dir: &Path, depth: usize, found: &mut Vec<App>) {
    if depth > 3 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            walk(&path, depth + 1, found);
        } else if path.extension().is_some_and(|e| e == "desktop")
            && let Some(name) = std::fs::read_to_string(&path).ok().and_then(|t| desktop_name(&t))
            && worth_listing(&name)
        {
            found.push(App { name, id: path.display().to_string() });
        }
    }
}

/// How long a list of apps is reused: asking Windows takes most of a second, and the launcher asks on every open.
const FRESH: Duration = Duration::from_secs(60);
static FOUND: Mutex<Option<(Instant, Vec<App>)>> = Mutex::new(None);

/// Every app the Start menu (or the desktop entries) lists, once each by name, sorted.
pub fn apps() -> Vec<App> {
    let mut found = FOUND.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    if let Some((at, apps)) = found.as_ref()
        && at.elapsed() < FRESH
    {
        return apps.clone();
    }
    let apps = find_apps();
    *found = Some((Instant::now(), apps.clone()));
    apps
}

/// How long a file search may walk before it answers with what it has.
pub const LOOK_FOR: Duration = Duration::from_millis(400);
/// The most files a search answers with.
const MOST_FILES: usize = 20;
/// Files that run something when opened: never listed, so opening a found file can't start a program.
const RUNS: [&str; 16] = ["exe", "bat", "cmd", "com", "scr", "msi", "ps1", "vbs", "vbe", "js", "jse", "wsf", "wsh", "lnk", "url", "appref-ms"];
/// What the last search found: the only paths `openFile` and `reveal` accept.
static LAST_FILES: Mutex<Vec<PathBuf>> = Mutex::new(Vec::new());

/// The person's own folders a file search looks in.
fn file_folders() -> Vec<PathBuf> {
    let home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from);
    home.map(|home| ["Desktop", "Documents", "Downloads", "Pictures", "Music", "Videos"].iter().map(|f| home.join(f)).collect()).unwrap_or_default()
}

/// Whether a file's name holds every word of the query (case aside), and the file is not a program or script.
fn file_matches(name: &str, words: &[String]) -> bool {
    let lower = name.to_lowercase();
    let runs = Path::new(&lower).extension().and_then(|e| e.to_str()).is_some_and(|e| RUNS.contains(&e));
    !runs && !words.is_empty() && words.iter().all(|w| lower.contains(w.as_str()))
}

/// Files under `roots` matching `query`, nearest folders first, until [`MOST_FILES`] are found or `budget` runs out.
pub fn find_files(roots: &[PathBuf], query: &str, budget: Duration) -> Vec<PathBuf> {
    let words: Vec<String> = query.split_whitespace().map(str::to_lowercase).collect();
    let started = Instant::now();
    let mut found = Vec::new();
    let mut queue: VecDeque<(PathBuf, usize)> = roots.iter().map(|r| (r.clone(), 0)).collect();
    while let Some((dir, depth)) = queue.pop_front() {
        if started.elapsed() > budget || found.len() >= MOST_FILES {
            break;
        }
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            // Hidden folders, tool caches and app data are not where a person keeps their files.
            if name.starts_with('.') || name.starts_with('$') || name == "node_modules" || name == "AppData" {
                continue;
            }
            let Ok(kind) = entry.file_type() else { continue };
            if kind.is_dir() {
                if depth < 5 {
                    queue.push_back((entry.path(), depth + 1));
                }
            } else if kind.is_file() && file_matches(&name, &words) {
                found.push(entry.path());
                if found.len() >= MOST_FILES {
                    break;
                }
            }
        }
    }
    found
}

fn last_found(path: &str) -> Option<PathBuf> {
    LAST_FILES.lock().unwrap_or_else(std::sync::PoisonError::into_inner).iter().find(|p| p.as_os_str() == path).cloned()
}

fn open_file(path: &Path, reveal: bool) -> bool {
    #[cfg(windows)]
    {
        let mut command = std::process::Command::new("explorer.exe");
        if reveal {
            command.arg(format!("/select,{}", path.display()));
        } else {
            command.arg(path);
        }
        command.spawn().is_ok()
    }
    #[cfg(not(windows))]
    {
        let target = if reveal { path.parent().unwrap_or(path) } else { path };
        std::process::Command::new("xdg-open").arg(target).spawn().is_ok()
    }
}

/// The system commands: (id, name).
pub fn commands() -> Vec<(&'static str, &'static str)> {
    if cfg!(windows) {
        vec![("lock", "Lock the computer"), ("sleep", "Put the computer to sleep"), ("empty-bin", "Empty the Recycle Bin")]
    } else {
        vec![]
    }
}

fn start(app: &App) -> bool {
    #[cfg(windows)]
    {
        // Explorer opens anything the Start menu lists by its AppsFolder id, Store apps included.
        std::process::Command::new("explorer.exe").arg(format!("shell:AppsFolder\\{}", app.id)).spawn().is_ok()
    }
    #[cfg(not(windows))]
    {
        let file = Path::new(&app.id).file_name().and_then(|n| n.to_str()).unwrap_or_default();
        std::process::Command::new("gtk-launch").arg(file).spawn().is_ok()
    }
}

fn run(id: &str) -> bool {
    #[cfg(windows)]
    {
        match id {
            "lock" => std::process::Command::new("rundll32.exe").args(["user32.dll,LockWorkStation"]).spawn().is_ok(),
            // Sleep, not hibernate: PowerShell's SetSuspendState with hibernate off.
            "sleep" => std::process::Command::new("powershell.exe")
                .args(["-NoProfile", "-Command", "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Application]::SetSuspendState('Suspend', $false, $false)"])
                .spawn()
                .is_ok(),
            // No flags: Windows asks its own "Are you sure?" before anything is deleted. It answers success even when
            // the person says No, so what counts is whether the bin is empty afterwards.
            // SAFETY: no root path (every drive's bin), no window handle, and flags of 0.
            "empty-bin" => {
                let _ = unsafe { windows::Win32::UI::Shell::SHEmptyRecycleBinW(None, windows::core::PCWSTR::null(), 0) };
                bin_items() == Some(0)
            }
            _ => false,
        }
    }
    #[cfg(not(windows))]
    {
        let _ = id;
        false
    }
}

/// How many things the Recycle Bin holds, on every drive.
#[cfg(windows)]
fn bin_items() -> Option<i64> {
    use windows::Win32::UI::Shell::{SHQUERYRBINFO, SHQueryRecycleBinW};
    let mut info = SHQUERYRBINFO { cbSize: std::mem::size_of::<SHQUERYRBINFO>() as u32, ..Default::default() };
    // SAFETY: no root path (every drive's bin) and a properly sized struct to fill.
    unsafe { SHQueryRecycleBinW(windows::core::PCWSTR::null(), &mut info) }.ok()?;
    Some(info.i64NumItems)
}

/// The bridge's `system` calls.
pub fn call(method: &str, args: &[Value]) -> Result<Value, Value> {
    let arg = args.first().and_then(Value::as_str).unwrap_or_default();
    match method {
        "apps" => Ok(Value::Array(apps().into_iter().map(|a| json!({ "name": a.name, "id": a.id })).collect())),
        "open" => {
            // Only what apps() lists: the id is compared, never trusted.
            let known = apps().into_iter().find(|a| a.id == arg);
            Ok(json!({ "ok": known.is_some_and(|a| start(&a)) }))
        }
        "files" => {
            let found = find_files(&file_folders(), arg, LOOK_FOR);
            let list = found
                .iter()
                .map(|p| json!({ "name": p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(), "path": p.display().to_string() }))
                .collect();
            *LAST_FILES.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = found;
            Ok(Value::Array(list))
        }
        "openFile" | "reveal" => Ok(json!({ "ok": last_found(arg).is_some_and(|p| open_file(&p, method == "reveal")) })),
        "commands" => Ok(Value::Array(commands().into_iter().map(|(id, name)| json!({ "id": id, "name": name })).collect())),
        "run" => Ok(json!({ "ok": commands().iter().any(|(id, _)| *id == arg) && run(arg) })),
        _ => Err(json!({ "kind": "not_available", "message": "Not a system call." })),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_desktop_entry_is_named_by_its_name_unless_it_hides() {
        assert_eq!(desktop_name("[Desktop Entry]\nType=Application\nName=Firefox\nName[fr]=Firefox FR\n"), Some("Firefox".into()));
        assert_eq!(desktop_name("[Desktop Entry]\nName=Settings Daemon\nNoDisplay=true\n"), None);
        // A Name in another group (an action) is not the app's.
        assert_eq!(desktop_name("[Desktop Action new]\nName=New Window\n[Desktop Entry]\nName=Files\n"), Some("Files".into()));
        assert_eq!(desktop_name("[Desktop Entry]\nType=Application\n"), None);
    }

    #[test]
    fn start_apps_are_read_and_helpers_left_out() {
        let text = r#"[{"Name":"Notepad","AppID":"Microsoft.WindowsNotepad_8wekyb3d8bbwe!App"},{"Name":"Uninstall Paint","AppID":"x"},{"Name":"Ableton USB Audio Control Panel Autostart","AppID":"y"},{"Name":"Administrative Tools","AppID":"z"},{"Name":"Calculator","AppID":"Microsoft.WindowsCalculator_8wekyb3d8bbwe!App"}]"#;
        let found = tidy(parse_start_apps(text));
        assert_eq!(found.iter().map(|a| a.name.as_str()).collect::<Vec<_>>(), ["Calculator", "Notepad"]);
        assert_eq!(found[1].id, "Microsoft.WindowsNotepad_8wekyb3d8bbwe!App");
        // One app comes back as an object, not an array; nothing comes back as nothing.
        assert_eq!(parse_start_apps(r#"{"Name":"Files","AppID":"f"}"#).len(), 1);
        assert!(parse_start_apps("").is_empty());
    }

    #[test]
    fn files_are_found_by_every_word_and_programs_never() {
        let dir = std::env::temp_dir().join(format!("mobius-files-{}", std::process::id()));
        let nested = dir.join("Taxes");
        std::fs::create_dir_all(&nested).unwrap_or_default();
        std::fs::create_dir_all(dir.join(".hidden")).unwrap_or_default();
        for path in [nested.join("Tax Return 2025.pdf"), dir.join("tax-tool.exe"), dir.join(".hidden").join("tax return.txt"), dir.join("notes.txt")] {
            std::fs::write(path, "").unwrap_or_default();
        }
        let names = |q: &str| find_files(std::slice::from_ref(&dir), q, Duration::from_secs(5)).iter().filter_map(|p| p.file_name()?.to_str().map(str::to_owned)).collect::<Vec<_>>();
        assert_eq!(names("tax RETURN"), ["Tax Return 2025.pdf"]);
        assert!(names("tax").iter().all(|n| !n.ends_with(".exe")), "programs are never found");
        assert!(names("").is_empty(), "nothing typed finds nothing");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn only_known_apps_open_and_only_known_commands_run() {
        assert_eq!(call("open", &[json!("C:\\Windows\\System32\\cmd.exe")]).unwrap(), json!({ "ok": false }));
        assert_eq!(call("run", &[json!("format-c")]).unwrap(), json!({ "ok": false }));
        assert_eq!(call("openFile", &[json!("C:\\Windows\\System32\\cmd.exe")]).unwrap(), json!({ "ok": false }));
        assert_eq!(call("reveal", &[json!("/etc/passwd")]).unwrap(), json!({ "ok": false }));
        assert!(call("nope", &[]).is_err());
    }
}
