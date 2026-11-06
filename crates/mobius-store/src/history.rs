//! Pages visited, newest first. Only plain web pages are kept.
use std::path::PathBuf;

use serde_json::{Value, json};

use crate::file::{read_json, write_json};
use crate::web::{clean_title, is_web_url, matches};

pub const MAX_ENTRIES: usize = 2000;
const MAX_URL: usize = 2048;
const MAX_TITLE: usize = 200;

#[derive(Debug, Clone, PartialEq)]
pub struct Entry {
    pub url: String,
    pub title: String,
    pub visited: i64,
}

impl Entry {
    pub fn to_json(&self) -> Value {
        json!({ "url": self.url, "title": self.title, "visited": self.visited })
    }
}

pub struct History {
    file: PathBuf,
    entries: Vec<Entry>,
    on: bool,
    clock: Box<dyn Fn() -> i64 + Send>,
}

impl History {
    pub fn open(file: PathBuf, clock: Box<dyn Fn() -> i64 + Send>) -> History {
        let mut h = History { file, entries: Vec::new(), on: true, clock };
        h.load();
        h
    }

    pub fn enabled(&self) -> bool {
        self.on
    }

    pub fn set_enabled(&mut self, on: bool) {
        self.on = on;
        self.save();
    }

    pub fn visit(&mut self, url: &str, title: &str) {
        if !self.on || url.len() > MAX_URL || !is_web_url(url) {
            return;
        }
        let entry = Entry { url: url.to_owned(), title: clean_title(title, url, MAX_TITLE), visited: (self.clock)() };
        self.entries.retain(|e| e.url != url);
        self.entries.insert(0, entry);
        self.entries.truncate(MAX_ENTRIES);
        self.save();
    }

    pub fn list(&self, limit: usize) -> Vec<Entry> {
        self.entries.iter().take(limit).cloned().collect()
    }

    pub fn search(&self, query: &str, limit: usize) -> Vec<Entry> {
        self.entries.iter().filter(|e| matches(query, &e.title, &e.url)).take(limit).cloned().collect()
    }

    pub fn remove(&mut self, url: &str) {
        let before = self.entries.len();
        self.entries.retain(|e| e.url != url);
        if self.entries.len() != before {
            self.save();
        }
    }

    pub fn clear(&mut self) {
        self.entries.clear();
        self.save();
    }

    fn load(&mut self) {
        let Some(Value::Object(data)) = read_json(&self.file) else { return };
        if let Some(on) = data.get("enabled").and_then(Value::as_bool) {
            self.on = on;
        }
        let Some(Value::Array(rows)) = data.get("entries") else { return };
        for row in rows {
            let (Some(url), Some(title), Some(visited)) = (row.get("url").and_then(Value::as_str), row.get("title").and_then(Value::as_str), row.get("visited").and_then(Value::as_f64)) else { continue };
            if url.len() > MAX_URL || !is_web_url(url) || !visited.is_finite() {
                continue;
            }
            self.entries.push(Entry { url: url.to_owned(), title: title.chars().take(MAX_TITLE).collect(), visited: visited as i64 });
        }
        self.entries.sort_by_key(|e| std::cmp::Reverse(e.visited));
        self.entries.truncate(MAX_ENTRIES);
    }

    fn save(&self) {
        let entries: Vec<Value> = self.entries.iter().map(Entry::to_json).collect();
        write_json(&self.file, &json!({ "enabled": self.on, "entries": entries }));
    }
}
