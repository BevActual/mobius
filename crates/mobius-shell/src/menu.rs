//! The macOS menu bar, from the same menus the window draws in its toolbar on Windows and Linux (`menus.ts`).
//!
//! The interface sends the menus as data whenever they change (`menu.set`); choosing an item comes back as the
//! `mobius:menu` event with its id, and the interface runs it. Edit's commands are the system's own, so undo, copy and
//! paste work in whatever has the keyboard, web pages included. The first menu is the app's: About, Settings, Hide, Quit.

use serde_json::{Value, json};
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Runtime};

const MAX_MENUS: usize = 12;
const MAX_ITEMS: usize = 40;
const MAX_LABEL: usize = 80;
/// Item ids from the interface come back with this in front, so they never meet the tray's ids.
const PREFIX: &str = "m:";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Entry {
    Item { id: String, label: String, keys: Option<String>, disabled: bool, checked: Option<bool> },
    Separator,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Spec {
    pub id: String,
    pub label: String,
    pub items: Vec<Entry>,
}

fn id_ok(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || "-_".contains(c))
}
fn label_ok(label: &str) -> bool {
    !label.trim().is_empty() && label.chars().count() <= MAX_LABEL
}

/// `mod+shift+z` as the menu writes it: `CmdOrCtrl+Shift+Z`. None for anything it does not know.
pub fn accelerator(keys: &str) -> Option<String> {
    let parts: Vec<&str> = keys.split('+').collect();
    let (key, modifiers) = parts.split_last()?;
    let mut out = Vec::new();
    for m in modifiers {
        out.push(match *m {
            "mod" => "CmdOrCtrl",
            "alt" => "Alt",
            "shift" => "Shift",
            _ => return None,
        });
    }
    let key = match *key {
        "," => "Comma".to_owned(),
        "." => "Period".to_owned(),
        "/" => "Slash".to_owned(),
        "\\" => "Backslash".to_owned(),
        ";" => "Semicolon".to_owned(),
        "'" => "Quote".to_owned(),
        "[" => "BracketLeft".to_owned(),
        "]" => "BracketRight".to_owned(),
        "-" => "Minus".to_owned(),
        "=" => "Equal".to_owned(),
        "`" => "Backquote".to_owned(),
        "space" => "Space".to_owned(),
        "up" => "Up".to_owned(),
        "down" => "Down".to_owned(),
        "left" => "Left".to_owned(),
        "right" => "Right".to_owned(),
        k if k.len() == 1 && k.chars().all(|c| c.is_ascii_alphanumeric()) => k.to_ascii_uppercase(),
        k if k.starts_with('f') && k[1..].parse::<u8>().is_ok_and(|n| (1..=12).contains(&n)) => k.to_ascii_uppercase(),
        _ => return None,
    };
    out.push(&key);
    Some(out.join("+"))
}

/// The menus the interface sent, checked. Anything malformed refuses the whole set, so a half menu never shows.
pub fn parse(v: &Value) -> Option<Vec<Spec>> {
    let menus = v.as_array().filter(|m| !m.is_empty() && m.len() <= MAX_MENUS)?;
    menus
        .iter()
        .map(|m| {
            let id = m.get("id")?.as_str().filter(|id| id_ok(id))?;
            let label = m.get("label")?.as_str().filter(|l| label_ok(l))?;
            let items = m.get("items")?.as_array().filter(|i| i.len() <= MAX_ITEMS)?;
            let items = items
                .iter()
                .map(|i| match i.get("kind")?.as_str()? {
                    "separator" => Some(Entry::Separator),
                    "item" => Some(Entry::Item {
                        id: i.get("id")?.as_str().filter(|id| id_ok(id))?.to_owned(),
                        label: i.get("label")?.as_str().filter(|l| label_ok(l))?.to_owned(),
                        keys: i.get("keys").and_then(Value::as_str).filter(|k| !k.is_empty()).map(str::to_owned),
                        disabled: i.get("disabled").and_then(Value::as_bool).unwrap_or(false),
                        checked: i.get("checked").and_then(Value::as_bool),
                    }),
                    _ => None,
                })
                .collect::<Option<Vec<_>>>()?;
            Some(Spec { id: id.to_owned(), label: label.to_owned(), items })
        })
        .collect()
}

/// The Edit commands the system answers itself.
fn system_edit<R: Runtime>(app: &AppHandle<R>, id: &str) -> Option<tauri::Result<PredefinedMenuItem<R>>> {
    Some(match id {
        "undo" => PredefinedMenuItem::undo(app, None),
        "redo" => PredefinedMenuItem::redo(app, None),
        "cut" => PredefinedMenuItem::cut(app, None),
        "copy" => PredefinedMenuItem::copy(app, None),
        "paste" => PredefinedMenuItem::paste(app, None),
        "select-all" => PredefinedMenuItem::select_all(app, None),
        _ => return None,
    })
}

fn submenu<R: Runtime>(app: &AppHandle<R>, spec: &Spec) -> tauri::Result<Submenu<R>> {
    let sub = Submenu::with_id(app, format!("{PREFIX}menu-{}", spec.id), &spec.label, true)?;
    for entry in &spec.items {
        match entry {
            Entry::Separator => sub.append(&PredefinedMenuItem::separator(app)?)?,
            Entry::Item { id, label, keys, disabled, checked } => {
                if spec.id == "edit" && let Some(item) = system_edit(app, id) {
                    sub.append(&item?)?;
                    continue;
                }
                let accel = keys.as_deref().and_then(accelerator);
                let full_id = format!("{PREFIX}{id}");
                // An accelerator the system will not take is left off rather than losing the item.
                match checked {
                    Some(on) => {
                        let item = CheckMenuItem::with_id(app, &full_id, label, !disabled, *on, accel.as_deref())
                            .or_else(|_| CheckMenuItem::with_id(app, &full_id, label, !disabled, *on, None::<&str>))?;
                        sub.append(&item)?;
                    }
                    None => {
                        let item = MenuItem::with_id(app, &full_id, label, !disabled, accel.as_deref()).or_else(|_| MenuItem::with_id(app, &full_id, label, !disabled, None::<&str>))?;
                        sub.append(&item)?;
                    }
                }
            }
        }
    }
    Ok(sub)
}

fn build<R: Runtime>(app: &AppHandle<R>, specs: &[Spec]) -> tauri::Result<Menu<R>> {
    let menu = Menu::new(app)?;
    let own = Submenu::with_id(app, format!("{PREFIX}menu-mobius"), "Mobius", true)?;
    own.append(&MenuItem::with_id(app, format!("{PREFIX}about"), "About Mobius", true, None::<&str>)?)?;
    own.append(&PredefinedMenuItem::separator(app)?)?;
    own.append(&MenuItem::with_id(app, format!("{PREFIX}settings"), "Settings…", true, Some("CmdOrCtrl+Comma"))?)?;
    own.append(&PredefinedMenuItem::separator(app)?)?;
    own.append(&PredefinedMenuItem::hide(app, None)?)?;
    own.append(&PredefinedMenuItem::hide_others(app, None)?)?;
    own.append(&PredefinedMenuItem::show_all(app, None)?)?;
    own.append(&PredefinedMenuItem::separator(app)?)?;
    own.append(&PredefinedMenuItem::quit(app, None)?)?;
    menu.append(&own)?;
    for spec in specs {
        // Settings and About live in the app's menu on macOS.
        let trimmed = Spec { items: tidy(spec.items.iter().filter(|e| !matches!(e, Entry::Item { id, .. } if id == "settings" || id == "about")).cloned().collect()), ..spec.clone() };
        if trimmed.items.is_empty() {
            continue;
        }
        let sub = submenu(app, &trimmed)?;
        if spec.id == "window" {
            sub.append(&PredefinedMenuItem::separator(app)?)?;
            sub.append(&PredefinedMenuItem::minimize(app, None)?)?;
            sub.append(&PredefinedMenuItem::maximize(app, Some("Zoom"))?)?;
            #[cfg(target_os = "macos")]
            let _ = sub.set_as_windows_menu_for_nsapp();
        }
        #[cfg(target_os = "macos")]
        if spec.id == "help" {
            let _ = sub.set_as_help_menu_for_nsapp();
        }
        menu.append(&sub)?;
    }
    Ok(menu)
}

/// No separator first, last, or next to another.
fn tidy(items: Vec<Entry>) -> Vec<Entry> {
    let mut out: Vec<Entry> = Vec::new();
    for e in items {
        if e == Entry::Separator && out.last().is_none_or(|l| *l == Entry::Separator) {
            continue;
        }
        out.push(e);
    }
    if out.last() == Some(&Entry::Separator) {
        out.pop();
    }
    out
}

/// Show the menus the interface sent. Only macOS has a menu bar for them; elsewhere they stay in the toolbar.
pub fn set<R: Runtime>(app: &AppHandle<R>, before: &mut Option<Vec<Spec>>, args: &[Value]) -> Result<Value, Value> {
    let Some(specs) = args.first().and_then(parse) else {
        return Err(json!({ "kind": "invalid", "message": "Those are not menus Mobius can show." }));
    };
    if !cfg!(target_os = "macos") {
        return Ok(json!({ "shown": false }));
    }
    if before.as_ref() == Some(&specs) {
        return Ok(json!({ "shown": true }));
    }
    match build(app, &specs).and_then(|menu| app.set_menu(menu)) {
        Ok(_) => {
            *before = Some(specs);
            Ok(json!({ "shown": true }))
        }
        Err(error) => Err(json!({ "kind": "failed", "message": format!("The menu bar could not be set: {error}") })),
    }
}

/// Passes a chosen menu item on to the interface.
pub fn on_event<R: Runtime>(app: &AppHandle<R>, id: &str) {
    if let Some(item) = id.strip_prefix(PREFIX) {
        let _ = app.emit("mobius:menu", json!(item));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_are_written_the_way_the_menu_bar_takes_them() {
        assert_eq!(accelerator("mod+shift+z").as_deref(), Some("CmdOrCtrl+Shift+Z"));
        assert_eq!(accelerator("mod+\\").as_deref(), Some("CmdOrCtrl+Backslash"));
        assert_eq!(accelerator("mod+,").as_deref(), Some("CmdOrCtrl+Comma"));
        assert_eq!(accelerator("mod+.").as_deref(), Some("CmdOrCtrl+Period"));
        assert_eq!(accelerator("alt+space").as_deref(), Some("Alt+Space"));
        assert_eq!(accelerator("f5").as_deref(), Some("F5"));
        assert_eq!(accelerator("ctrl+k"), None);
        assert_eq!(accelerator("mod+tab"), None);
    }

    #[test]
    fn menus_are_checked_whole() {
        let good = json!([{ "id": "file", "label": "File", "items": [
            { "kind": "item", "id": "new-tab", "label": "New tab", "keys": "mod+t" },
            { "kind": "separator" },
            { "kind": "item", "id": "split", "label": "Split view", "checked": true, "disabled": false },
        ] }]);
        let specs = parse(&good).unwrap();
        assert_eq!(specs[0].items[0], Entry::Item { id: "new-tab".into(), label: "New tab".into(), keys: Some("mod+t".into()), disabled: false, checked: None });
        assert_eq!(specs[0].items[2], Entry::Item { id: "split".into(), label: "Split view".into(), keys: None, disabled: false, checked: Some(true) });
        for bad in [
            json!([]),
            json!({}),
            json!([{ "id": "../x", "label": "File", "items": [] }]),
            json!([{ "id": "file", "label": "", "items": [] }]),
            json!([{ "id": "file", "label": "File", "items": [{ "kind": "item", "id": "a b", "label": "x" }] }]),
            json!([{ "id": "file", "label": "File", "items": [{ "kind": "submenu" }] }]),
        ] {
            assert!(parse(&bad).is_none(), "{bad}");
        }
    }

    #[test]
    fn separators_never_lead_trail_or_double() {
        let item = |id: &str| Entry::Item { id: id.into(), label: id.into(), keys: None, disabled: false, checked: None };
        assert_eq!(tidy(vec![Entry::Separator, item("a"), Entry::Separator, Entry::Separator, item("b"), Entry::Separator]), vec![item("a"), Entry::Separator, item("b")]);
    }
}
