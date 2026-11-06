//! What the browser needs from a web engine. One implementation per engine; tests use `fake::FakeEngine`.
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Bounds {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

pub trait Engine: Send + Sync {
    /// Create a tab's page and load `url` in it. The page starts hidden.
    fn open(&self, tab: &str, url: &str);
    fn navigate(&self, tab: &str, url: &str);
    fn back(&self, tab: &str);
    fn forward(&self, tab: &str);
    fn reload(&self, tab: &str);
    fn close(&self, tab: &str);
    /// Show only `visible` (if any) at `bounds`; every other page is hidden. `None` hides all of them, which is how
    /// overlays get drawn above the native pages.
    fn layout(&self, visible: Option<&str>, bounds: Option<Bounds>);
    /// Run a script in a world that sees the page's DOM but none of the page's own scripts or globals, and give back
    /// what it returned (waiting for a promise). The script is text built by this crate with JSON-encoded arguments.
    fn eval(&self, tab: &str, script: &str) -> Result<Value, String>;
    /// A picture of the page as JPEG bytes.
    fn picture(&self, tab: &str) -> Option<Vec<u8>>;
    fn find(&self, tab: &str, text: &str, forward: bool, again: bool);
    fn stop_find(&self, tab: &str);
}

#[cfg(any(test, feature = "fake"))]
pub mod fake {
    use std::collections::HashMap;
    use std::sync::Mutex;

    use super::{Bounds, Engine, Value};

    /// An engine that does nothing but remember what it was asked, and answers scripts from a table.
    #[derive(Default)]
    pub struct FakeEngine {
        pub calls: Mutex<Vec<String>>,
        pub layouts: Mutex<Vec<(Option<String>, Option<Bounds>)>>,
        /// Script text containing the key → the value to answer with.
        pub answers: Mutex<HashMap<String, Result<Value, String>>>,
        pub scripts: Mutex<Vec<(String, String)>>,
    }

    impl FakeEngine {
        fn note(&self, what: String) {
            if let Ok(mut c) = self.calls.lock() {
                c.push(what);
            }
        }
        pub fn calls(&self) -> Vec<String> {
            self.calls.lock().map(|c| c.clone()).unwrap_or_default()
        }
        pub fn answer(&self, contains: &str, value: Result<Value, String>) {
            if let Ok(mut a) = self.answers.lock() {
                a.insert(contains.to_owned(), value);
            }
        }
    }

    impl Engine for FakeEngine {
        fn open(&self, tab: &str, url: &str) {
            self.note(format!("open {tab} {url}"));
        }
        fn navigate(&self, tab: &str, url: &str) {
            self.note(format!("navigate {tab} {url}"));
        }
        fn back(&self, tab: &str) {
            self.note(format!("back {tab}"));
        }
        fn forward(&self, tab: &str) {
            self.note(format!("forward {tab}"));
        }
        fn reload(&self, tab: &str) {
            self.note(format!("reload {tab}"));
        }
        fn close(&self, tab: &str) {
            self.note(format!("close {tab}"));
        }
        fn layout(&self, visible: Option<&str>, bounds: Option<Bounds>) {
            if let Ok(mut l) = self.layouts.lock() {
                l.push((visible.map(str::to_owned), bounds));
            }
        }
        fn eval(&self, tab: &str, script: &str) -> Result<Value, String> {
            if let Ok(mut s) = self.scripts.lock() {
                s.push((tab.to_owned(), script.to_owned()));
            }
            let answers = self.answers.lock().map_err(|_| "poisoned".to_owned())?;
            answers.iter().find(|(k, _)| script.contains(k.as_str())).map_or(Err("no answer".to_owned()), |(_, v)| v.clone())
        }
        fn picture(&self, _tab: &str) -> Option<Vec<u8>> {
            Some(vec![0xff, 0xd8, 0xff])
        }
        fn find(&self, tab: &str, text: &str, forward: bool, again: bool) {
            self.note(format!("find {tab} {text} {forward} {again}"));
        }
        fn stop_find(&self, tab: &str) {
            self.note(format!("stop_find {tab}"));
        }
    }
}
