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

static FIELDS: [Field; 11] = [
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
];

pub fn open(file: PathBuf) -> Settings {
    Settings::open(file, &FIELDS)
}
