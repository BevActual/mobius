//! How the app looks. The ranges here are the same as `AppearanceSettings` in the shared TypeScript package.
use std::path::PathBuf;

use serde_json::{Value, json};

use crate::settings::{Field, Settings, in_range, is_flag, one_of};

pub const LEFT_WIDTH: (f64, f64, f64) = (200.0, 420.0, 248.0);
pub const RIGHT_WIDTH: (f64, f64, f64) = (300.0, 640.0, 380.0);

static FIELDS: [Field; 14] = [
    Field { name: "theme", default: || json!("system"), check: |v| one_of(v, &["system", "light", "dark"]) },
    Field { name: "zoom", default: || json!(1), check: |v| in_range(v, 0.75, 1.5) },
    Field { name: "chatTextScale", default: || json!(1), check: |v| in_range(v, 0.85, 1.4) },
    Field { name: "chatFont", default: || json!("system"), check: |v| one_of(v, &["system", "serif", "mono"]) },
    Field { name: "textDirection", default: || json!("auto"), check: |v| one_of(v, &["auto", "ltr", "rtl"]) },
    Field { name: "density", default: || json!("comfortable"), check: |v| one_of(v, &["comfortable", "compact"]) },
    Field { name: "toolSteps", default: || json!("show"), check: |v| one_of(v, &["show", "hide-finished"]) },
    Field { name: "sidebarAtStart", default: || json!(true), check: is_flag },
    Field { name: "resumeLast", default: || json!(true), check: is_flag },
    Field { name: "leftSidebar", default: || json!("attached"), check: |v| one_of(v, &["attached", "floating"]) },
    // The app list on the left: the full sidebar (the default, so it is easy to find) or a narrow rail of icons.
    Field { name: "navigation", default: || json!("sidebar"), check: |v| one_of(v, &["sidebar", "rail"]) },
    Field { name: "rightSidebar", default: || json!("attached"), check: |v| one_of(v, &["attached", "floating"]) },
    Field { name: "leftWidth", default: || json!(LEFT_WIDTH.2), check: |v| in_range(v, LEFT_WIDTH.0, LEFT_WIDTH.1) },
    Field { name: "rightWidth", default: || json!(RIGHT_WIDTH.2), check: |v| in_range(v, RIGHT_WIDTH.0, RIGHT_WIDTH.1) },
];

pub fn open(file: PathBuf) -> Settings {
    Settings::open(file, &FIELDS)
}

pub fn defaults() -> Value {
    Value::Object(FIELDS.iter().map(|f| (f.name.to_owned(), (f.default)())).collect())
}
