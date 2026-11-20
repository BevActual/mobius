//! The computer's own things for the launcher: the apps installed on it, and a few system commands.
//!
//! The bridge's `system` calls:
//! - `apps()` → `[{ name, id }]`, sorted by name: on Windows the Start menu's shortcuts (the person's and everyone's),
//!   on Linux the desktop entries. `id` is the shortcut's path.
//! - `open(id)` → `{ ok }`: starts an app `apps()` listed. Any other path is refused, so a page can never use this to
//!   start a program of its choosing.
//! - `commands()` → `[{ id, name }]`: the system commands this computer has.
//! - `run(id)` → `{ ok }`: runs one of them. Emptying the Recycle Bin asks Windows' own question first.
use std::path::{Path, PathBuf};

use serde_json::{Value, json};

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct App {
    pub name: String,
    pub path: PathBuf,
}

/// The folders whose shortcuts are the installed apps.
fn app_folders() -> Vec<PathBuf> {
    let mut folders = Vec::new();
    if cfg!(windows) {
        if let Ok(appdata) = std::env::var("APPDATA") {
            folders.push(Path::new(&appdata).join(r"Microsoft\Windows\Start Menu\Programs"));
        }
        if let Ok(all) = std::env::var("ProgramData") {
            folders.push(Path::new(&all).join(r"Microsoft\Windows\Start Menu\Programs"));
        }
    } else {
        folders.push(PathBuf::from("/usr/share/applications"));
        folders.push(PathBuf::from("/usr/local/share/applications"));
        if let Ok(home) = std::env::var("HOME") {
            folders.push(Path::new(&home).join(".local/share/applications"));
        }
    }
    folders
}

/// The app a file stands for, if it is a launcher shortcut. Uninstallers and help links are left out.
fn app_of(path: &Path) -> Option<App> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    let name = match ext.as_str() {
        "lnk" | "url" | "appref-ms" => path.file_stem()?.to_str()?.to_owned(),
        "desktop" => desktop_name(&std::fs::read_to_string(path).ok()?)?,
        _ => return None,
    };
    let lower = name.to_ascii_lowercase();
    if lower.starts_with("uninstall") || lower.contains("uninstall ") || lower.ends_with(" help") || lower.ends_with(" readme") {
        return None;
    }
    Some(App { name, path: path.to_owned() })
}

/// The name a desktop entry shows, unless it asks to be hidden.
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

/// Every app the Start menu (or the desktop entries) lists, once each by name, sorted.
pub fn apps() -> Vec<App> {
    let mut found = Vec::new();
    for folder in app_folders() {
        walk(&folder, 0, &mut found);
    }
    found.sort();
    found.dedup_by(|a, b| a.name.eq_ignore_ascii_case(&b.name));
    found
}

fn walk(dir: &Path, depth: usize, found: &mut Vec<App>) {
    // The Start menu nests a folder or two deep; nothing deeper is an app.
    if depth > 3 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            walk(&path, depth + 1, found);
        } else if let Some(app) = app_of(&path) {
            found.push(app);
        }
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

fn start(path: &Path) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // `start` opens a shortcut as Explorer would; the empty title keeps a quoted path from being taken as one.
        const NO_WINDOW: u32 = 0x0800_0000;
        std::process::Command::new("cmd").arg("/c").arg("start").arg("").arg(path).creation_flags(NO_WINDOW).spawn().is_ok()
    }
    #[cfg(not(windows))]
    {
        let id = path.file_name().and_then(|n| n.to_str()).unwrap_or_default();
        std::process::Command::new("gtk-launch").arg(id).spawn().is_ok()
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
            // No flags: Windows asks its own "Are you sure?" before anything is deleted.
            // SAFETY: no root path (every drive's bin), no window handle, and flags of 0.
            "empty-bin" => unsafe { windows::Win32::UI::Shell::SHEmptyRecycleBinW(None, windows::core::PCWSTR::null(), 0) }.is_ok(),
            _ => false,
        }
    }
    #[cfg(not(windows))]
    {
        let _ = id;
        false
    }
}

/// The bridge's `system` calls.
pub fn call(method: &str, args: &[Value]) -> Result<Value, Value> {
    let arg = args.first().and_then(Value::as_str).unwrap_or_default();
    match method {
        "apps" => Ok(Value::Array(apps().into_iter().map(|a| json!({ "name": a.name, "id": a.path.display().to_string() })).collect())),
        "open" => {
            // Only what apps() lists: the id is compared, never trusted.
            let known = apps().into_iter().find(|a| a.path.display().to_string() == arg);
            Ok(json!({ "ok": known.is_some_and(|a| start(&a.path)) }))
        }
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
    fn shortcuts_become_apps_and_uninstallers_do_not() {
        let dir = std::env::temp_dir().join(format!("mobius-system-{}", std::process::id()));
        let nested = dir.join("Tools");
        std::fs::create_dir_all(&nested).unwrap();
        for name in ["Paint.lnk", "Uninstall Paint.lnk", "notes.txt"] {
            std::fs::write(dir.join(name), "").unwrap();
        }
        std::fs::write(nested.join("Terminal.lnk"), "").unwrap();
        let mut found = Vec::new();
        walk(&dir, 0, &mut found);
        found.sort();
        assert_eq!(found.iter().map(|a| a.name.as_str()).collect::<Vec<_>>(), ["Paint", "Terminal"]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn only_known_apps_open_and_only_known_commands_run() {
        assert_eq!(call("open", &[json!("C:\\Windows\\System32\\cmd.exe")]).unwrap(), json!({ "ok": false }));
        assert_eq!(call("run", &[json!("format-c")]).unwrap(), json!({ "ok": false }));
        assert!(call("nope", &[]).is_err());
    }
}
