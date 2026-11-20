//! Clipboard history for the launcher: the text the person copied lately, anywhere on the computer.
//!
//! Nothing is watched until the interface turns it on (`clipboard.watch(true)`, from the launcher's setting), and what
//! is kept stays in memory: the last [`KEEP`] pieces of text, gone when Mobius quits. Text a password manager marks as
//! private is never kept: on Windows, a copy carrying `ExcludeClipboardContentFromMonitorProcessing`, or
//! `CanIncludeInClipboardHistory` set to 0, the formats Windows' own clipboard history honours.
//!
//! Each new piece reaches every window as `mobius:clipboard` with `{ text, at }` (`at` in milliseconds since 1970).
//! The bridge's `clipboard` calls: `watch(on)` → `{ on }`, `history()` → `[{ text, at }]` newest first,
//! `copy(text)` → `{ ok }` (puts it on the clipboard and first in the history), `clear()` → `{ ok }`.
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde_json::{Value, json};
use tauri::{AppHandle, Emitter, Manager};

/// How many pieces of text the history keeps.
pub const KEEP: usize = 50;
/// The longest piece kept; a longer copy (a whole file's text) is left out rather than cut.
pub const LONGEST: usize = 20_000;
/// How often the clipboard is looked at. On Windows the look is a counter read, so it costs nothing until it changes.
const EVERY: Duration = Duration::from_millis(500);

#[derive(Clone, Debug, PartialEq)]
pub struct Entry {
    pub text: String,
    pub at: u64,
}

/// The pieces kept, newest first.
#[derive(Default)]
pub struct History {
    entries: VecDeque<Entry>,
}

impl History {
    /// Keeps a newly copied piece first. The same text copied again moves up rather than being kept twice. Returns
    /// whether it was kept: blank text and text over [`LONGEST`] are not.
    pub fn add(&mut self, text: &str, at: u64) -> bool {
        if text.trim().is_empty() || text.chars().count() > LONGEST {
            return false;
        }
        self.entries.retain(|e| e.text != text);
        self.entries.push_front(Entry { text: text.to_owned(), at });
        self.entries.truncate(KEEP);
        true
    }

    pub fn clear(&mut self) {
        self.entries.clear();
    }

    pub fn to_json(&self) -> Value {
        Value::Array(self.entries.iter().map(|e| json!({ "text": e.text, "at": e.at })).collect())
    }
}

/// The watcher's state, shared with the bridge.
#[derive(Default)]
pub struct Clipboard {
    on: Arc<AtomicBool>,
    started: AtomicBool,
    history: Arc<Mutex<History>>,
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// The text on the clipboard now, unless it is marked private. `None` when there is no text.
fn read() -> Option<String> {
    #[cfg(windows)]
    if marked_private() {
        return None;
    }
    arboard::Clipboard::new().and_then(|mut c| c.get_text()).ok()
}

/// Whether the copy on the clipboard asks not to be kept, as password managers mark theirs.
#[cfg(windows)]
fn marked_private() -> bool {
    use windows::Win32::System::DataExchange::{IsClipboardFormatAvailable, RegisterClipboardFormatW};
    use windows::core::w;
    // SAFETY: registering a named format only returns its number (the same one every program gets), and asking
    // whether a format is on the clipboard needs no open clipboard and reads nothing.
    unsafe {
        let exclude = RegisterClipboardFormatW(w!("ExcludeClipboardContentFromMonitorProcessing"));
        let history = RegisterClipboardFormatW(w!("CanIncludeInClipboardHistory"));
        // CanIncludeInClipboardHistory says yes or no in its data; a copy that offers it at all is almost always a
        // password manager saying no, so it is left out without opening the clipboard to read the answer.
        (exclude != 0 && IsClipboardFormatAvailable(exclude).is_ok()) || (history != 0 && IsClipboardFormatAvailable(history).is_ok())
    }
}

/// A number that changes whenever anything is copied (Windows counts copies; elsewhere the text itself is compared).
#[cfg(windows)]
fn changes() -> u64 {
    // SAFETY: reads the clipboard's copy counter; no arguments, no clipboard opened.
    u64::from(unsafe { windows::Win32::System::DataExchange::GetClipboardSequenceNumber() })
}

impl Clipboard {
    /// Turns watching on or off. Turning it off also forgets what was kept.
    pub fn watch(&self, app: &AppHandle, on: bool) {
        self.on.store(on, Ordering::SeqCst);
        if !on {
            self.history.lock().unwrap_or_else(std::sync::PoisonError::into_inner).clear();
            return;
        }
        if self.started.swap(true, Ordering::SeqCst) {
            return;
        }
        let (on, history, app) = (Arc::clone(&self.on), Arc::clone(&self.history), app.clone());
        std::thread::spawn(move || {
            #[cfg(windows)]
            let mut seen = changes();
            // What is on the clipboard when watching starts was copied before it: it is not news.
            #[cfg(not(windows))]
            let mut seen = read();
            loop {
                std::thread::sleep(EVERY);
                if !on.load(Ordering::SeqCst) {
                    continue;
                }
                #[cfg(windows)]
                let text = {
                    let now = changes();
                    if now == seen {
                        continue;
                    }
                    seen = now;
                    read()
                };
                #[cfg(not(windows))]
                let text = {
                    let now = read();
                    if now == seen {
                        continue;
                    }
                    seen = now.clone();
                    now
                };
                let Some(text) = text else { continue };
                let at = now();
                let kept = history.lock().unwrap_or_else(std::sync::PoisonError::into_inner).add(&text, at);
                if kept {
                    let _ = app.emit("mobius:clipboard", json!({ "text": text, "at": at }));
                }
            }
        });
    }
}

/// The bridge's `clipboard` calls.
pub fn call(app: &AppHandle, method: &str, args: &[Value]) -> Result<Value, Value> {
    let Some(clipboard) = app.try_state::<Clipboard>() else {
        return Err(json!({ "kind": "not_available", "message": "The clipboard is not available." }));
    };
    let history = || clipboard.history.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    match method {
        "watch" => {
            let on = args.first().and_then(Value::as_bool).unwrap_or(true);
            clipboard.watch(app, on);
            Ok(json!({ "on": on }))
        }
        "history" => Ok(history().to_json()),
        "copy" => {
            let text = args.first().and_then(Value::as_str).unwrap_or_default();
            let ok = arboard::Clipboard::new().and_then(|mut c| c.set_text(text.to_owned())).is_ok();
            if ok && clipboard.on.load(Ordering::SeqCst) {
                history().add(text, now());
            }
            Ok(json!({ "ok": ok }))
        }
        "clear" => {
            history().clear();
            Ok(json!({ "ok": true }))
        }
        _ => Err(json!({ "kind": "not_available", "message": "Not a clipboard call." })),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_history_keeps_the_newest_first_once_each_and_no_more_than_it_should() {
        let mut h = History::default();
        assert!(h.add("one", 1));
        assert!(h.add("two", 2));
        assert!(h.add("one", 3));
        assert_eq!(h.to_json(), json!([{ "text": "one", "at": 3 }, { "text": "two", "at": 2 }]));
        assert!(!h.add("   \n", 4), "blank text is not kept");
        assert!(!h.add(&"x".repeat(LONGEST + 1), 5), "a very long copy is not kept");
        for i in 0..KEEP + 10 {
            h.add(&format!("n{i}"), i as u64);
        }
        assert_eq!(h.to_json().as_array().map(Vec::len), Some(KEEP));
        assert_eq!(h.to_json()[0]["text"], json!(format!("n{}", KEEP + 9)));
        h.clear();
        assert_eq!(h.to_json(), json!([]));
    }
}
