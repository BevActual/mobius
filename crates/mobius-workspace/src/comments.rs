//! Comments on anything in the workspace, kept per document in a dot folder so the documents themselves stay only
//! what was written: `<workspace>/.comments/<app>/<document>.json`.
//!
//! A comment is a thread pinned to an object in a document: a sheet's cell, a mail message, a note's block, a part
//! of a page. Its anchor names the object by a stable id where the app gives one (`data-comment-id`), and by its
//! place as a fallback. Its state says who it is for: `open` (just written), `sent` (asked of Mobius), `note` (kept
//! for people; Mobius does not read it) and `resolved`.
//!
//! This generalises what Notes keeps beside its pages (`notes/.comments/...`, see `notes::Notes::set_comments`), with
//! the same checks and the same atomic write, so Notes can move onto it later.

use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};

type Res<T> = Result<T, String>;

/// The most threads one document keeps.
pub const MAX_THREADS: usize = 200;
const DIR: &str = ".comments";
const STATES: [&str; 4] = ["open", "sent", "note", "resolved"];

/// The apps that can be commented on: each has a folder of its own.
fn app_ok(app: &str) -> bool {
    !app.is_empty() && app.len() <= 20 && app.chars().all(|c| c.is_ascii_lowercase())
}

/// A document's name, as the window gives it ("Budget/Costs", a message id): kept as a file name, so anything that
/// could leave the folder is refused and the rest is made safe.
fn file_name(doc: &str) -> Option<String> {
    if doc.is_empty() || doc.len() > 300 || doc.contains("..") || doc.contains('\0') {
        return None;
    }
    let safe: String = doc.chars().map(|c| if c.is_alphanumeric() || matches!(c, '-' | '_' | '.' | ' ' | '@') { c } else { '~' }).collect();
    let safe = safe.trim_matches(|c: char| c == '.' || c == ' ').to_owned();
    (!safe.is_empty()).then(|| format!("{safe}.json"))
}

pub struct Comments {
    root: PathBuf,
}

impl Comments {
    /// Comments for the workspace at `workspace`.
    pub fn new(workspace: impl Into<PathBuf>) -> Self {
        Comments { root: workspace.into().join(DIR) }
    }

    fn file(&self, app: &str, doc: &str) -> Res<PathBuf> {
        if !app_ok(app) {
            return Err("that is not an app".into());
        }
        let name = file_name(doc).ok_or("that is not a document")?;
        Ok(self.root.join(app).join(name))
    }

    /// A document's threads, as kept. None yet is an empty list.
    pub fn list(&self, app: &str, doc: &str) -> Res<Value> {
        let file = self.file(app, doc)?;
        Ok(read(&file))
    }

    /// Every document of an app that has threads: `[{ doc, threads }]`, for the sidebar and the count on the button.
    pub fn all(&self, app: &str) -> Res<Value> {
        if !app_ok(app) {
            return Err("that is not an app".into());
        }
        let mut found = Vec::new();
        if let Ok(entries) = fs::read_dir(self.root.join(app)) {
            for entry in entries.flatten() {
                let threads = read(&entry.path());
                let doc = threads.as_array().and_then(|t| t.first()).and_then(|t| t.get("doc")).and_then(Value::as_str).map(str::to_owned);
                if let (Some(doc), Some(list)) = (doc, threads.as_array()) {
                    if !list.is_empty() {
                        found.push(json!({ "doc": doc, "threads": threads }));
                    }
                }
            }
        }
        found.sort_by(|a, b| a["doc"].as_str().cmp(&b["doc"].as_str()));
        Ok(Value::Array(found))
    }

    /// Keep a document's threads. Each is checked; an empty list removes the file.
    pub fn set(&self, app: &str, doc: &str, threads: &Value) -> Res<Value> {
        let file = self.file(app, doc)?;
        let list = threads.as_array().ok_or("comments are a list")?;
        if list.len() > MAX_THREADS {
            return Err("that document has too many comments".into());
        }
        let kept = list.iter().map(|t| thread(t, doc)).collect::<Res<Vec<_>>>()?;
        if kept.is_empty() {
            let _ = fs::remove_file(&file);
        } else {
            fs::create_dir_all(file.parent().ok_or("that is not a document")?).map_err(|e| e.to_string())?;
            let temp = file.with_extension("json.mobius-tmp");
            fs::write(&temp, serde_json::to_string_pretty(&kept).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
            fs::rename(&temp, &file).map_err(|e| e.to_string())?;
        }
        Ok(json!({ "app": app, "doc": doc, "threads": kept }))
    }
}

fn read(file: &Path) -> Value {
    fs::read_to_string(file).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok()).filter(Value::is_array).unwrap_or_else(|| json!([]))
}

/// One thread, checked: what it is pinned to, what was said, its state, and Mobius's reply when it was sent.
fn thread(t: &Value, doc: &str) -> Res<Value> {
    let text = |key: &str, max: usize| t.get(key).and_then(Value::as_str).filter(|s| s.chars().count() <= max).map(str::to_owned);
    let id = text("id", 40).filter(|i| !i.is_empty() && i.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')).ok_or("a comment needs an id")?;
    let said = text("text", 4000).filter(|s| !s.trim().is_empty()).ok_or("a comment needs its words")?;
    let state = text("state", 10).unwrap_or_else(|| "open".into());
    if !STATES.contains(&state.as_str()) {
        return Err("that is not a comment's state".into());
    }
    let anchor = t.get("anchor").filter(|a| a.is_object()).ok_or("a comment needs what it is about")?;
    let label = anchor.get("label").and_then(Value::as_str).filter(|s| s.chars().count() <= 200).unwrap_or("").to_owned();
    let mut a = json!({ "label": label });
    if let Some(object) = anchor.get("id").and_then(Value::as_str).filter(|s| !s.is_empty() && s.chars().count() <= 200) {
        a["id"] = json!(object);
    }
    for key in ["x", "y"] {
        if let Some(v) = anchor.get(key).and_then(Value::as_f64).filter(|v| v.is_finite() && (0.0..=1.0).contains(v)) {
            a[key] = json!(v);
        }
    }
    if a.get("id").is_none() && (a.get("x").is_none() || a.get("y").is_none()) {
        return Err("a comment needs what it is about".into());
    }
    let mut kept = json!({
        "id": id,
        "doc": doc,
        "anchor": a,
        "text": said,
        "context": text("context", 4000).unwrap_or_default(),
        "by": text("by", 40).unwrap_or_else(|| "you".into()),
        "whenMs": t.get("whenMs").and_then(Value::as_u64).unwrap_or(0),
        "state": state,
    });
    if let Some(reply) = text("reply", 8000) {
        kept["reply"] = json!(reply);
    }
    if let Some(conversation) = text("conversation", 120) {
        kept["conversation"] = json!(conversation);
    }
    Ok(kept)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn one(state: &str) -> Value {
        json!([{ "id": "c1", "anchor": { "id": "B3", "label": "B3" }, "text": "Is this right?", "context": "1200", "whenMs": 5, "state": state }])
    }

    #[test]
    fn threads_are_kept_per_document_in_a_dot_folder_and_checked() {
        let dir = tempfile::tempdir().unwrap();
        let c = Comments::new(dir.path());
        assert_eq!(c.list("sheets", "Budget/Costs").unwrap(), json!([]));
        let kept = c.set("sheets", "Budget/Costs", &one("note")).unwrap();
        assert_eq!(kept["threads"][0]["state"], "note");
        assert_eq!(kept["threads"][0]["by"], "you");
        assert!(dir.path().join(".comments").join("sheets").join("Budget~Costs.json").is_file());
        assert_eq!(c.list("sheets", "Budget/Costs").unwrap()[0]["anchor"]["id"], "B3");
        // Listed for the app, with the document each is in.
        let all = c.all("sheets").unwrap();
        assert_eq!(all[0]["doc"], "Budget/Costs");
        assert_eq!(all[0]["threads"].as_array().unwrap().len(), 1);
        // An empty list takes the file away.
        c.set("sheets", "Budget/Costs", &json!([])).unwrap();
        assert!(!dir.path().join(".comments").join("sheets").join("Budget~Costs.json").exists());
        assert_eq!(c.all("sheets").unwrap(), json!([]));
    }

    #[test]
    fn what_is_wrong_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let c = Comments::new(dir.path());
        assert!(c.set("Sheets", "x", &one("open")).is_err(), "an app is a plain name");
        assert!(c.set("sheets", "../x", &one("open")).is_err(), "a document cannot leave the folder");
        assert!(c.set("sheets", "x", &one("maybe")).is_err(), "a state is one of four");
        assert!(c.set("sheets", "x", &json!([{ "id": "../c", "anchor": { "id": "A1" }, "text": "no" }])).is_err());
        assert!(c.set("sheets", "x", &json!([{ "id": "c2", "anchor": { "label": "nowhere" }, "text": "no" }])).is_err(), "an anchor needs an id or a place");
        assert!(c.set("sheets", "x", &json!([{ "id": "c3", "anchor": { "x": 0.5, "y": 0.2 }, "text": "here" }])).is_ok(), "a place is enough");
        assert!(c.set("sheets", "x", &json!([{ "id": "c4", "anchor": { "x": 2.0, "y": 0.2 }, "text": "off the page" }])).is_err());
    }
}
