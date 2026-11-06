//! Atomic JSON files: write a temporary file, then rename it over the real one.
use std::fs;
use std::path::Path;

use serde_json::Value;

pub fn read_json(path: &Path) -> Option<Value> {
    serde_json::from_slice(&fs::read(path).ok()?).ok()
}

/// Best effort: a store keeps working in memory when the disk refuses.
pub fn write_json(path: &Path, value: &Value) {
    let Some(dir) = path.parent() else { return };
    if fs::create_dir_all(dir).is_err() {
        return;
    }
    let mut temp = path.as_os_str().to_owned();
    temp.push(".tmp");
    let temp = std::path::PathBuf::from(temp);
    if fs::write(&temp, value.to_string()).is_ok() && fs::rename(&temp, path).is_err() {
        let _ = fs::remove_file(&temp);
    }
}

/// Like `write_json`, but says whether the file was written.
pub fn write_json_checked(path: &Path, value: &Value) -> bool {
    let Some(dir) = path.parent() else { return false };
    if fs::create_dir_all(dir).is_err() {
        return false;
    }
    let mut temp = path.as_os_str().to_owned();
    temp.push(".tmp");
    let temp = std::path::PathBuf::from(temp);
    if fs::write(&temp, value.to_string()).is_err() {
        return false;
    }
    if fs::rename(&temp, path).is_err() {
        let _ = fs::remove_file(&temp);
        return false;
    }
    true
}
