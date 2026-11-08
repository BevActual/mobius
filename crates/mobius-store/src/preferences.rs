//! Choices about how the app behaves around the person, as opposed to how it looks.
use std::path::PathBuf;

use serde_json::{Value, json};

use crate::keys;
use crate::settings::{Field, Settings, is_flag, one_of};

pub const CONTEXT_SIZES: [u64; 5] = [4096, 8192, 16384, 32768, 65536];
pub const DEFAULT_CONTEXT: u64 = 16384;

/// A model name: 1 to 200 characters, no control characters.
pub fn is_model_name(v: &Value) -> bool {
    v.as_str().is_some_and(|s| !s.is_empty() && s.chars().count() <= 200 && !s.chars().any(|c| c.is_control()))
}

/// The apps whose access the person can set, and the levels: off, ask (the usual), read without asking, act without asking.
pub const APP_ACCESS_APPS: [&str; 15] = ["browser", "notes", "docs", "sheets", "slides", "tasks", "calendar", "mail", "code", "design", "canvas", "photo", "studio", "video", "skills"];
/// Apps added later: a setting saved before them may leave them out, and they count as `ask`.
const LATER_APPS: [&str; 12] = ["docs", "sheets", "slides", "calendar", "mail", "code", "design", "canvas", "photo", "studio", "video", "skills"];
pub const APP_ACCESS_LEVELS: [&str; 4] = ["off", "ask", "read", "act"];

pub fn app_access_default() -> Value {
    json!({ "browser": "ask", "notes": "ask", "docs": "ask", "sheets": "ask", "slides": "ask", "tasks": "ask", "calendar": "ask", "mail": "ask", "code": "ask", "design": "ask", "canvas": "ask", "photo": "ask", "studio": "ask", "video": "ask", "skills": "ask" })
}

/// Exactly those apps, each at one of the levels.
pub fn is_app_access(v: &Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys().all(|k| APP_ACCESS_APPS.contains(&k.as_str()))
            && APP_ACCESS_APPS.iter().all(|app| match o.get(*app) {
                None => LATER_APPS.contains(app),
                Some(level) => level.as_str().is_some_and(|l| APP_ACCESS_LEVELS.contains(&l)),
            })
    })
}

static FIELDS: [Field; 12] = [
    Field { name: "notifyNeedsYou", default: || json!(true), check: is_flag },
    Field { name: "notifyFinished", default: || json!(true), check: is_flag },
    Field { name: "notifyDownloads", default: || json!(true), check: is_flag },
    Field { name: "muteSounds", default: || json!(false), check: is_flag },
    Field { name: "keepAwake", default: || json!(false), check: is_flag },
    Field { name: "localContext", default: || json!(DEFAULT_CONTEXT), check: |v| v.as_u64().is_some_and(|n| CONTEXT_SIZES.contains(&n)) && v.is_u64() },
    Field { name: "agentPrivateUrls", default: || json!(false), check: is_flag },
    Field { name: "approvalMode", default: || json!("manual"), check: |v| one_of(v, &["manual", "smart", "off"]) },
    Field { name: "keybindings", default: keys::defaults, check: keys::is_key_bindings },
    Field { name: "reasoningEffort", default: || json!(""), check: |v| one_of(v, &["", "none", "low", "medium", "high"]) },
    Field { name: "dictationModel", default: || json!("whisper-1"), check: is_model_name },
    Field { name: "appAccess", default: app_access_default, check: is_app_access },
];

pub fn open(file: PathBuf) -> Settings {
    Settings::open(file, &FIELDS)
}

#[cfg(test)]
mod access_tests {
    use super::*;

    #[test]
    fn app_access_is_the_known_apps_at_known_levels() {
        assert!(is_app_access(&app_access_default()));
        assert!(is_app_access(&json!({ "browser": "off", "notes": "read", "tasks": "act" })), "saved before Calendar");
        assert!(is_app_access(&json!({ "browser": "off", "notes": "read", "tasks": "act", "calendar": "read" })));
        for bad in [json!({}), json!({ "browser": "ask", "notes": "ask" }), json!({ "browser": "ask", "notes": "ask", "tasks": "always" }), json!({ "browser": "ask", "notes": "ask", "tasks": "ask", "fax": "ask" }), json!("ask")] {
            assert!(!is_app_access(&bad), "{bad}");
        }
    }
}
