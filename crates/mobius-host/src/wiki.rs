//! The Wiki app's queue, "Shared with this wiki": changes offered to the wiki that wait until the person keeps them.
//! A change is a line for a page, from the person's own wiki (a line of How I work they shared), from Mobius, or from
//! someone else. Keep adds the line to the page; Decline drops the change; Undo takes either back. Pages themselves are
//! Markdown in `workspace/wiki/`, kept by the notes store, so their earlier versions are in the workspace checkpoints.
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

/// The page a change goes to when it names none.
pub const SHARED_PAGE: &str = "Shared/Shared notes.md";
const MAX_WAITING: usize = 200;
const MAX_TEXT: usize = 600;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    pub id: String,
    /// Who offered it: `your wiki`, `Mobius`, or a person's name.
    pub from: String,
    pub page: String,
    pub text: String,
    pub when_ms: u64,
    /// Its place in the queue: changes wait in the order they were offered, and Undo puts one back in its place.
    #[serde(default)]
    pub seq: u64,
}

#[derive(Default, Serialize, Deserialize)]
struct Saved {
    waiting: Vec<Change>,
    /// The last place given, so a change taken out and put back keeps its place among newer ones.
    #[serde(default)]
    last_seq: u64,
}

pub struct Incoming {
    file: PathBuf,
    lock: Mutex<()>,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
}

/// One line of text: no control characters, not too long.
fn clean(text: &str) -> Option<String> {
    let t = text.split_whitespace().collect::<Vec<_>>().join(" ");
    (!t.is_empty() && t.chars().count() <= MAX_TEXT).then_some(t)
}

/// A wiki page path: `notebook/page.md`, nothing that climbs out.
fn page_ok(page: &str) -> bool {
    let parts: Vec<&str> = page.split('/').collect();
    parts.len() == 2 && parts.iter().all(|p| !p.is_empty() && *p != "." && *p != ".." && !p.contains('\\')) && page.ends_with(".md")
}

impl Incoming {
    #[must_use]
    pub fn new(file: PathBuf) -> Incoming {
        Incoming { file, lock: Mutex::new(()) }
    }

    fn load(&self) -> Saved {
        std::fs::read_to_string(&self.file).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
    }

    fn store(&self, saved: &Saved) -> Result<(), String> {
        // Written whole and then put in place, so a read at the same moment never finds half a file (and no changes).
        let value = serde_json::to_value(saved).map_err(|e| e.to_string())?;
        if mobius_store::file::write_json_checked(&self.file, &value) { Ok(()) } else { Err("The changes could not be saved.".into()) }
    }

    /// What waits, oldest first.
    pub fn list(&self) -> Value {
        let _one = self.lock.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        json!(self.load().waiting)
    }

    /// A change offered to the wiki. It waits until the person keeps or declines it.
    pub fn offer(&self, from: &str, page: Option<&str>, text: &str) -> Result<Value, String> {
        let text = clean(text).ok_or("A change is one line of up to 600 characters.")?;
        let from = clean(from).unwrap_or_else(|| "your wiki".to_owned());
        let page = page.filter(|p| !p.is_empty()).unwrap_or(SHARED_PAGE);
        if !page_ok(page) {
            return Err("That is not a wiki page.".into());
        }
        let _one = self.lock.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        let mut saved = self.load();
        if saved.waiting.len() >= MAX_WAITING {
            return Err("Too many changes are waiting: keep or decline some first.".into());
        }
        let mut bytes = [0u8; 4];
        let _ = getrandom::fill(&mut bytes);
        let seq = saved.waiting.iter().map(|c| c.seq).max().unwrap_or(0).max(saved.last_seq) + 1;
        saved.last_seq = seq;
        let change = Change { id: bytes.iter().map(|b| format!("{b:02x}")).collect(), from, page: page.to_owned(), text, when_ms: now_ms(), seq };
        saved.waiting.push(change.clone());
        self.store(&saved)?;
        Ok(json!(change))
    }

    /// Take a change out of the queue (to keep or decline it), returning it.
    pub fn take(&self, id: &str) -> Result<Change, String> {
        let _one = self.lock.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        let mut saved = self.load();
        let at = saved.waiting.iter().position(|c| c.id == id).ok_or("That change is not waiting any more.")?;
        let change = saved.waiting.remove(at);
        self.store(&saved)?;
        Ok(change)
    }

    /// A page was renamed: what waits for it waits for its new name.
    pub fn repage(&self, from: &str, to: &str) -> Result<(), String> {
        let _one = self.lock.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        let mut saved = self.load();
        for c in saved.waiting.iter_mut().filter(|c| c.page == from) {
            c.page = to.to_owned();
        }
        self.store(&saved)
    }

    /// Undo: a change kept or declined waits again, where it was.
    pub fn put_back(&self, change: Change) -> Result<(), String> {
        let _one = self.lock.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        let mut saved = self.load();
        if !saved.waiting.iter().any(|c| c.id == change.id) {
            let at = saved.waiting.iter().position(|c| c.seq > change.seq).unwrap_or(saved.waiting.len());
            saved.waiting.insert(at, change);
        }
        self.store(&saved)
    }
}

/// A page with a line added at its end (a list item), and the same page with that line taken out again.
#[must_use]
pub fn with_line(content: &str, text: &str) -> String {
    let mut out = content.trim_end().to_owned();
    if !out.is_empty() {
        out.push('\n');
    }
    out.push_str(&format!("- {text}\n"));
    out
}

#[must_use]
pub fn without_line(content: &str, text: &str) -> String {
    let line = format!("- {text}");
    let mut lines: Vec<&str> = content.lines().collect();
    if let Some(at) = lines.iter().rposition(|l| l.trim_end() == line) {
        lines.remove(at);
    }
    let mut out = lines.join("\n");
    out.push('\n');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn changes_wait_until_kept_or_declined_and_undo_puts_them_back() {
        let dir = tempfile::tempdir().unwrap();
        let q = Incoming::new(dir.path().join("wiki-incoming.json"));
        let a = q.offer("your wiki", None, "I answer mail in the morning").unwrap();
        let b = q.offer("Mobius", Some("Team/Rules.md"), "Builds start on Mondays").unwrap();
        assert!(q.offer("Mobius", Some("../x.md"), "no").is_err());
        assert_eq!(q.list().as_array().unwrap().len(), 2);
        assert_eq!(a["page"], SHARED_PAGE);
        let taken = q.take(a["id"].as_str().unwrap()).unwrap();
        assert_eq!(q.list().as_array().unwrap().len(), 1);
        q.put_back(taken).unwrap();
        let ids: Vec<String> = q.list().as_array().unwrap().iter().map(|c| c["id"].as_str().unwrap().to_owned()).collect();
        assert_eq!(ids, [a["id"].as_str().unwrap(), b["id"].as_str().unwrap()], "back where it was");
        assert!(q.take("nope").is_err());
        q.repage("Team/Rules.md", "Team/Ground rules.md").unwrap();
        assert_eq!(q.list()[1]["page"], "Team/Ground rules.md", "what waits for a renamed page follows it");
    }

    #[test]
    fn changes_offered_in_the_same_millisecond_keep_their_order_through_undo() {
        let dir = tempfile::tempdir().unwrap();
        let q = Incoming::new(dir.path().join("wiki-incoming.json"));
        let ids: Vec<String> = (0..4).map(|i| q.offer("Mobius", None, &format!("line {i}")).unwrap()["id"].as_str().unwrap().to_owned()).collect();
        // Their times may all be the same: the order is their place in the queue, not the clock.
        let order = |q: &Incoming| -> Vec<String> { q.list().as_array().unwrap().iter().map(|c| c["id"].as_str().unwrap().to_owned()).collect() };
        for i in [0, 2, 3, 1] {
            let taken = q.take(&ids[i]).unwrap();
            q.put_back(taken).unwrap();
            assert_eq!(order(&q), ids, "put back where it was");
        }
        let first = q.take(&ids[0]).unwrap();
        let last = q.take(&ids[3]).unwrap();
        q.put_back(last).unwrap();
        q.put_back(first).unwrap();
        assert_eq!(order(&q), ids);
    }

    #[test]
    fn a_kept_line_is_added_to_the_page_and_undo_takes_it_out() {
        let page = "# Rules\n\n- Ask before booking\n";
        let kept = with_line(page, "Builds start on Mondays");
        assert_eq!(kept, "# Rules\n\n- Ask before booking\n- Builds start on Mondays\n");
        assert_eq!(without_line(&kept, "Builds start on Mondays"), page);
        assert_eq!(with_line("", "First"), "- First\n");
    }
}
