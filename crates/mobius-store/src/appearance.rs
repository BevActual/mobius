//! How the app looks. The ranges here are the same as `AppearanceSettings` in the shared TypeScript package.
use std::path::PathBuf;

use serde_json::{Value, json};

use crate::settings::{Field, Settings, in_range, is_flag, one_of};

pub const LEFT_WIDTH: (f64, f64, f64) = (200.0, 420.0, 248.0);
pub const RIGHT_WIDTH: (f64, f64, f64) = (300.0, 640.0, 380.0);

/// The apps the sidebar may list. Its `sidebarApps` setting says which, in what order; the rest stay in All apps.
pub const SIDEBAR_APPS: [&str; 10] = ["agent", "search", "browser", "mail", "notes", "docs", "sheets", "slides", "tasks", "calendar"];

fn is_app_list(v: &Value) -> bool {
    let Some(items) = v.as_array() else { return false };
    let mut seen = Vec::new();
    !items.is_empty()
        && items.len() <= SIDEBAR_APPS.len()
        && items.iter().all(|item| match item.as_str() {
            Some(id) if SIDEBAR_APPS.contains(&id) && !seen.contains(&id) => {
                seen.push(id);
                true
            }
            _ => false,
        })
}

/// A note, task list or web page kept one click away in the sidebar.
pub const MAX_FAVOURITES: usize = 8;

fn is_favourites(v: &Value) -> bool {
    let Some(items) = v.as_array() else { return false };
    items.len() <= MAX_FAVOURITES
        && items.iter().all(|item| {
            let text = |key: &str, max: usize| item.get(key).and_then(Value::as_str).is_some_and(|s| !s.is_empty() && s.chars().count() <= max && !s.chars().any(char::is_control));
            item.as_object().is_some_and(|o| o.len() == 3) && matches!(item.get("kind").and_then(Value::as_str), Some("note" | "list" | "page")) && text("id", 2000) && text("title", 120)
        })
}

/// The note page web clippings go to: a page path ending in .md, or empty for the Clippings page.
fn is_clippings_page(v: &Value) -> bool {
    v.as_str().is_some_and(|s| s.is_empty() || (s.ends_with(".md") && s.chars().count() <= 500 && !s.chars().any(char::is_control)))
}

static FIELDS: [Field; 17] = [
    Field { name: "theme", default: || json!("system"), check: |v| one_of(v, &["system", "light", "mid", "dark", "cool"]) },
    Field { name: "zoom", default: || json!(1), check: |v| in_range(v, 0.75, 1.5) },
    Field { name: "chatTextScale", default: || json!(1), check: |v| in_range(v, 0.85, 1.4) },
    Field { name: "chatFont", default: || json!("system"), check: |v| one_of(v, &["system", "serif", "mono"]) },
    Field { name: "textDirection", default: || json!("auto"), check: |v| one_of(v, &["auto", "ltr", "rtl"]) },
    Field { name: "density", default: || json!("comfortable"), check: |v| one_of(v, &["comfortable", "compact"]) },
    Field { name: "toolSteps", default: || json!("show"), check: |v| one_of(v, &["show", "hide-finished"]) },
    Field { name: "sidebarAtStart", default: || json!(true), check: is_flag },
    Field { name: "resumeLast", default: || json!(true), check: is_flag },
    Field { name: "leftSidebar", default: || json!("attached"), check: |v| one_of(v, &["attached", "floating"]) },
    Field { name: "rightSidebar", default: || json!("attached"), check: |v| one_of(v, &["attached", "floating"]) },
    // Kept for older saved files; Mobius now always sits in the right panel, beside the work.
    Field { name: "agentPlace", default: || json!("beside"), check: |v| one_of(v, &["sidebar", "beside"]) },
    Field { name: "leftWidth", default: || json!(LEFT_WIDTH.2), check: |v| in_range(v, LEFT_WIDTH.0, LEFT_WIDTH.1) },
    Field { name: "rightWidth", default: || json!(RIGHT_WIDTH.2), check: |v| in_range(v, RIGHT_WIDTH.0, RIGHT_WIDTH.1) },
    // Which apps the sidebar lists, in order. At least one; each once.
    Field { name: "sidebarApps", default: || json!(SIDEBAR_APPS), check: is_app_list },
    // Notes, task lists and web pages pinned under the apps, in order.
    Field { name: "favourites", default: || json!([]), check: is_favourites },
    // Where text saved from a web page goes. Empty: a page called Clippings, made when first needed.
    Field { name: "clippingsPage", default: || json!(""), check: is_clippings_page },
];

pub fn open(file: PathBuf) -> Settings {
    Settings::open(file, &FIELDS)
}

pub fn defaults() -> Value {
    Value::Object(FIELDS.iter().map(|f| (f.name.to_owned(), (f.default)())).collect())
}
