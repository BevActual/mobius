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
pub const APP_ACCESS_APPS: [&str; 18] = ["browser", "notes", "docs", "sheets", "slides", "tasks", "calendar", "mail", "research", "reader", "code", "database", "design", "canvas", "photo", "studio", "video", "skills"];
/// Apps added later: a setting saved before them may leave them out, and they follow the mode.
const LATER_APPS: [&str; 15] = ["docs", "sheets", "slides", "calendar", "mail", "research", "reader", "code", "database", "design", "canvas", "photo", "studio", "video", "skills"];
/// Per app: `follow` the approval mode, `always` ask, or `off`. The four levels from before the three modes are still
/// read (`ask`, `read` and `act` as follow, `off` as off) and written back in the new words.
pub const APP_ACCESS_LEVELS: [&str; 3] = ["follow", "always", "off"];
const OLD_ACCESS_LEVELS: [&str; 3] = ["ask", "read", "act"];

pub fn app_access_default() -> Value {
    Value::Object(APP_ACCESS_APPS.iter().map(|app| ((*app).to_owned(), json!("follow"))).collect())
}

/// Exactly those apps, each at one of the levels.
pub fn is_app_access(v: &Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys().all(|k| APP_ACCESS_APPS.contains(&k.as_str()))
            && APP_ACCESS_APPS.iter().all(|app| match o.get(*app) {
                None => LATER_APPS.contains(app),
                Some(level) => level.as_str().is_some_and(|l| APP_ACCESS_LEVELS.contains(&l) || OLD_ACCESS_LEVELS.contains(&l)),
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
    // Ask first (manual), Propose (the default) or Act (smart). Off is still understood, for the core and older files,
    // but a saved off is read as Act: no mode acts without asking about running, deleting or sending.
    Field { name: "approvalMode", default: || json!("propose"), check: |v| one_of(v, &["manual", "propose", "smart", "off"]) },
    Field { name: "keybindings", default: keys::defaults, check: keys::is_key_bindings },
    Field { name: "reasoningEffort", default: || json!(""), check: |v| one_of(v, &["", "none", "low", "medium", "high"]) },
    Field { name: "dictationModel", default: || json!("whisper-1"), check: is_model_name },
    Field { name: "appAccess", default: app_access_default, check: is_app_access },
];

pub fn open(file: PathBuf) -> Settings {
    let mut settings = Settings::open(file, &FIELDS);
    if settings.get()["approvalMode"] == "off" {
        settings.set(&json!({ "approvalMode": "smart" }));
    }
    let access = settings.get()["appAccess"].clone();
    let renewed = renew_app_access(&access);
    if renewed != access {
        settings.set(&json!({ "appAccess": renewed }));
    }
    settings
}

/// Every app at one of the three levels: the old ones put in the new words, and apps a setting left out following the mode.
pub fn renew_app_access(access: &Value) -> Value {
    Value::Object(
        APP_ACCESS_APPS
            .iter()
            .map(|app| {
                let level = access.get(*app).and_then(Value::as_str).filter(|l| matches!(*l, "follow" | "always" | "off")).unwrap_or("follow");
                ((*app).to_owned(), json!(level))
            })
            .collect(),
    )
}

#[cfg(test)]
mod access_tests {
    use super::*;

    #[test]
    fn propose_is_the_default_and_a_saved_off_is_read_as_act() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(open(dir.path().join("fresh.json")).get()["approvalMode"], "propose");
        let old = dir.path().join("old.json");
        std::fs::write(&old, r#"{ "approvalMode": "off" }"#).unwrap();
        assert_eq!(open(old.clone()).get()["approvalMode"], "smart");
        // And it stays so: the file was rewritten.
        assert_eq!(open(old).get()["approvalMode"], "smart");
        let kept = dir.path().join("kept.json");
        std::fs::write(&kept, r#"{ "approvalMode": "manual" }"#).unwrap();
        assert_eq!(open(kept).get()["approvalMode"], "manual");
    }

    #[test]
    fn old_app_levels_are_read_in_the_new_words() {
        let dir = tempfile::tempdir().unwrap();
        let old = dir.path().join("old.json");
        std::fs::write(&old, r#"{ "appAccess": { "browser": "ask", "notes": "act", "tasks": "off", "calendar": "read" } }"#).unwrap();
        let access = open(old.clone()).get()["appAccess"].clone();
        assert_eq!((access["browser"].as_str(), access["notes"].as_str(), access["tasks"].as_str(), access["calendar"].as_str(), access["mail"].as_str()), (Some("follow"), Some("follow"), Some("off"), Some("follow"), Some("follow")));
        assert_eq!(open(old).get()["appAccess"]["tasks"], "off");
        assert_eq!(open(dir.path().join("new.json")).get()["appAccess"]["notes"], "follow");
    }

    #[test]
    fn app_access_is_the_known_apps_at_known_levels() {
        assert!(is_app_access(&app_access_default()));
        assert!(is_app_access(&json!({ "browser": "off", "notes": "read", "tasks": "act" })), "saved before Calendar");
        assert!(is_app_access(&json!({ "browser": "off", "notes": "read", "tasks": "act", "calendar": "read" })));
        assert!(is_app_access(&json!({ "browser": "always", "notes": "follow", "tasks": "off" })));
        for bad in [json!({}), json!({ "browser": "ask", "notes": "ask" }), json!({ "browser": "ask", "notes": "ask", "tasks": "sometimes" }), json!({ "browser": "ask", "notes": "ask", "tasks": "ask", "fax": "ask" }), json!("ask")] {
            assert!(!is_app_access(&bad), "{bad}");
        }
    }
}
