//! Mobius in the menu bar (macOS) or the notification area (Windows, Linux): the print shows what the agent is doing,
//! even with the window hidden, and its menu opens Mobius, asks it something, or goes straight to a conversation.
//!
//! The interface says what to show (`tray.set`); this only draws it and answers the menu.

use serde_json::{Value, json};
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Runtime};

const ID: &str = "mobius";
const MAX_ITEMS: usize = 8;
const MAX_TITLE: usize = 80;
const MAX_TOOLTIP: usize = 120;

/// What the print says: nothing going on, working, waiting for you, or finished while you were away.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum State {
    Idle,
    Working,
    Needs,
    Done,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Item {
    pub id: String,
    pub title: String,
    pub status: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Shown {
    pub state: State,
    pub tooltip: String,
    pub items: Vec<Item>,
}

fn short(text: &str, max: usize) -> String {
    let text = text.trim();
    if text.chars().count() <= max { text.to_owned() } else { format!("{}…", text.chars().take(max - 1).collect::<String>()) }
}

/// What the interface asked to show, checked. Titles and the tooltip are shortened, not refused.
pub fn parse(v: &Value) -> Option<Shown> {
    let state = match v.get("state")?.as_str()? {
        "idle" => State::Idle,
        "working" => State::Working,
        "needs" => State::Needs,
        "done" => State::Done,
        _ => return None,
    };
    let tooltip = short(v.get("tooltip").and_then(Value::as_str).unwrap_or("Mobius"), MAX_TOOLTIP);
    let items = match v.get("items") {
        None | Some(Value::Null) => Vec::new(),
        Some(Value::Array(list)) => list
            .iter()
            .take(MAX_ITEMS)
            .map(|i| {
                let id = i.get("id")?.as_str().filter(|id| !id.is_empty() && id.len() <= 128 && id.chars().all(|c| c.is_ascii_alphanumeric() || "-_:.".contains(c)))?;
                Some(Item { id: id.to_owned(), title: short(i.get("title")?.as_str()?, MAX_TITLE), status: short(i.get("status").and_then(Value::as_str).unwrap_or(""), 24) })
            })
            .collect::<Option<Vec<_>>>()?,
        Some(_) => return None,
    };
    Some(Shown { state, tooltip, items })
}

fn icon(state: State) -> Option<Image<'static>> {
    let bytes: &'static [u8] = if cfg!(target_os = "macos") {
        match state {
            State::Idle => include_bytes!("../icons/tray/mac-idle.png"),
            _ => include_bytes!("../icons/tray/mac-busy.png"),
        }
    } else {
        match state {
            State::Idle => include_bytes!("../icons/tray/idle.png"),
            State::Working => include_bytes!("../icons/tray/working.png"),
            State::Needs => include_bytes!("../icons/tray/needs.png"),
            State::Done => include_bytes!("../icons/tray/done.png"),
        }
    };
    Image::from_bytes(bytes).ok()
}

fn menu<R: Runtime>(app: &AppHandle<R>, shown: &Shown) -> tauri::Result<Menu<R>> {
    let menu = Menu::new(app)?;
    menu.append(&MenuItem::with_id(app, "open", "Open Mobius", true, None::<&str>)?)?;
    menu.append(&MenuItem::with_id(app, "ask", "Ask Mobius…", true, None::<&str>)?)?;
    if !shown.items.is_empty() {
        menu.append(&PredefinedMenuItem::separator(app)?)?;
        for item in &shown.items {
            let label = if item.status.is_empty() { item.title.clone() } else { format!("{} — {}", item.title, item.status) };
            menu.append(&MenuItem::with_id(app, format!("c:{}", item.id), label, true, None::<&str>)?)?;
        }
    }
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&MenuItem::with_id(app, "quit", "Quit Mobius", true, None::<&str>)?)?;
    Ok(menu)
}

fn show_main<R: Runtime>(app: &AppHandle<R>) {
    if let Some(main) = app.get_window("main") {
        let _ = main.unminimize();
        let _ = main.show();
        let _ = main.set_focus();
    }
}

/// On Linux the notification area needs the AppIndicator library, which is loaded when first used and panics if it
/// is missing: look for it first, and go without a tray when it is not there.
#[cfg(target_os = "linux")]
fn can_show() -> bool {
    ["libayatana-appindicator3.so.1", "libappindicator3.so.1", "libayatana-appindicator3.so", "libappindicator3.so"]
        .iter()
        .any(|name| unsafe { libloading::Library::new(name) }.is_ok())
}
#[cfg(not(target_os = "linux"))]
fn can_show() -> bool {
    true
}

/// Puts the print in the menu bar or notification area. None when this computer has nowhere to put it.
pub fn create<R: Runtime>(app: &AppHandle<R>) -> Option<TrayIcon<R>> {
    if !can_show() {
        eprintln!("[tray] no AppIndicator library: Mobius runs without a tray icon");
        return None;
    }
    let shown = Shown { state: State::Idle, tooltip: "Mobius".into(), items: Vec::new() };
    let built = TrayIconBuilder::with_id(ID)
        .icon(icon(State::Idle)?)
        .icon_as_template(cfg!(target_os = "macos"))
        .tooltip(&shown.tooltip)
        .menu(&menu(app, &shown).ok()?)
        .show_menu_on_left_click(cfg!(target_os = "macos"))
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            match id {
                "open" => show_main(app),
                "ask" => {
                    show_main(app);
                    let _ = app.emit("mobius:shortcut", json!("quick-entry"));
                }
                "quit" => app.exit(0),
                _ => {
                    if let Some(conversation) = id.strip_prefix("c:") {
                        show_main(app);
                        let _ = app.emit("mobius:tray-conversation", json!(conversation));
                    }
                }
            }
        })
        .on_tray_icon_event(|tray, event| {
            // Windows: a click on the print brings the window back; the menu is on the other button.
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_main(tray.app_handle());
            }
        })
        .build(app);
    match built {
        Ok(tray) => Some(tray),
        Err(error) => {
            eprintln!("[tray] could not be shown: {error}");
            None
        }
    }
}

/// Show what the interface asked for. Unchanged parts are left alone, so the menu does not flicker.
pub fn set<R: Runtime>(app: &AppHandle<R>, before: &mut Option<Shown>, args: &[Value]) -> Result<Value, Value> {
    let Some(shown) = args.first().and_then(parse) else {
        return Err(json!({ "kind": "invalid", "message": "That is not something the tray can show." }));
    };
    let Some(tray) = app.tray_by_id(ID) else { return Ok(json!({ "shown": false })) };
    let old = before.as_ref();
    if old.map(|o| o.state) != Some(shown.state) {
        let _ = tray.set_icon(icon(shown.state));
        let _ = tray.set_icon_as_template(cfg!(target_os = "macos"));
    }
    if old.map(|o| &o.tooltip) != Some(&shown.tooltip) {
        let _ = tray.set_tooltip(Some(&shown.tooltip));
    }
    if old.map(|o| &o.items) != Some(&shown.items)
        && let Ok(m) = menu(app, &shown)
    {
        let _ = tray.set_menu(Some(m));
    }
    *before = Some(shown);
    Ok(json!({ "shown": true }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn what_the_tray_shows_is_checked_and_shortened() {
        let shown = parse(&json!({ "state": "needs", "tooltip": "Mobius needs you", "items": [{ "id": "c-1", "title": "Lisbon offsite", "status": "Needs you" }] })).unwrap();
        assert_eq!(shown.state, State::Needs);
        assert_eq!(shown.items, vec![Item { id: "c-1".into(), title: "Lisbon offsite".into(), status: "Needs you".into() }]);
        let long = parse(&json!({ "state": "idle", "items": [{ "id": "c", "title": "x".repeat(200) }] })).unwrap();
        assert_eq!(long.items[0].title.chars().count(), MAX_TITLE);
        assert_eq!(long.tooltip, "Mobius");
        let many = parse(&json!({ "state": "working", "items": (0..20).map(|i| json!({ "id": format!("c{i}"), "title": "t" })).collect::<Vec<_>>() })).unwrap();
        assert_eq!(many.items.len(), MAX_ITEMS);
        for bad in [json!({}), json!({ "state": "busy" }), json!({ "state": "idle", "items": "x" }), json!({ "state": "idle", "items": [{ "id": "../x", "title": "t" }] }), json!({ "state": "idle", "items": [{ "id": "c" }] })] {
            assert!(parse(&bad).is_none(), "{bad}");
        }
    }
}
