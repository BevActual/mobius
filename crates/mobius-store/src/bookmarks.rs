//! Pages saved on purpose. Unlike history, nothing here is dropped to make room.
use std::path::PathBuf;

use serde_json::{Value, json};

use crate::file::{read_json, write_json};
use crate::web::{clean_title, is_web_url, matches};

pub const MAX_BOOKMARKS: usize = 1000;
const MAX_URL: usize = 2048;
const MAX_TITLE: usize = 200;

#[derive(Debug, Clone, PartialEq)]
pub struct Bookmark {
    pub url: String,
    pub title: String,
    pub added: i64,
}

impl Bookmark {
    pub fn to_json(&self) -> Value {
        json!({ "url": self.url, "title": self.title, "added": self.added })
    }
}

pub struct Bookmarks {
    file: PathBuf,
    entries: Vec<Bookmark>,
    clock: Box<dyn Fn() -> i64 + Send>,
}

impl Bookmarks {
    pub fn open(file: PathBuf, clock: Box<dyn Fn() -> i64 + Send>) -> Bookmarks {
        let mut b = Bookmarks { file, entries: Vec::new(), clock };
        b.load();
        b
    }

    pub fn has(&self, url: &str) -> bool {
        self.entries.iter().any(|e| e.url == url)
    }

    /// False when it cannot be saved: not a web page, or the limit is reached.
    pub fn add(&mut self, url: &str, title: &str) -> bool {
        if url.len() > MAX_URL || !is_web_url(url) {
            return false;
        }
        let title = clean_title(title, url, MAX_TITLE);
        if let Some(existing) = self.entries.iter_mut().find(|e| e.url == url) {
            existing.title = title;
        } else {
            if self.entries.len() >= MAX_BOOKMARKS {
                return false;
            }
            self.entries.insert(0, Bookmark { url: url.to_owned(), title, added: (self.clock)() });
        }
        self.save();
        true
    }

    pub fn remove(&mut self, url: &str) {
        let before = self.entries.len();
        self.entries.retain(|e| e.url != url);
        if self.entries.len() != before {
            self.save();
        }
    }

    /// Saves the page if it is not saved, removes it if it is. Returns whether it is saved afterwards.
    pub fn toggle(&mut self, url: &str, title: &str) -> bool {
        if self.has(url) {
            self.remove(url);
            return false;
        }
        self.add(url, title)
    }

    pub fn list(&self, limit: usize) -> Vec<Bookmark> {
        self.entries.iter().take(limit).cloned().collect()
    }

    pub fn search(&self, query: &str, limit: usize) -> Vec<Bookmark> {
        self.entries.iter().filter(|e| matches(query, &e.title, &e.url)).take(limit).cloned().collect()
    }

    fn load(&mut self) {
        let Some(Value::Array(rows)) = read_json(&self.file) else { return };
        for row in rows {
            let (Some(url), Some(title), Some(added)) = (row.get("url").and_then(Value::as_str), row.get("title").and_then(Value::as_str), row.get("added").and_then(Value::as_f64)) else { continue };
            if url.len() > MAX_URL || !is_web_url(url) || !added.is_finite() || self.has(url) {
                continue;
            }
            self.entries.push(Bookmark { url: url.to_owned(), title: title.chars().take(MAX_TITLE).collect(), added: added as i64 });
        }
        self.entries.sort_by_key(|e| std::cmp::Reverse(e.added));
        self.entries.truncate(MAX_BOOKMARKS);
    }

    fn save(&self) {
        let rows: Vec<Value> = self.entries.iter().map(Bookmark::to_json).collect();
        write_json(&self.file, &Value::Array(rows));
    }
}
