//! Recording a meeting in Mobius itself rather than in the window (docs/reference/voice-plan.md, section 2): the
//! microphone is heard here, cut into 16 kHz parts of about two minutes (each cut in a pause), and each part is
//! handed to the window as it is finished. The window asks for each to be written down, in order, with whoever is chosen for listening. A part's
//! file is deleted as soon as it has been read, and every part left is deleted when the meeting is cancelled or a new
//! one starts: as before, only the words are kept.
//!
//! The window follows it as `mobius:meeting` events: `{ kind: "part", index, start, seconds }`, and once at the end
//! `{ kind: "ended", seconds, error }`.

use mobius_audio::meeting::{Capture, Part, Source};
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

/// A part is two minutes, as in the window before.
pub const PART_SECONDS: u32 = 120;
/// The longest meeting: three hours. It stops by itself then.
pub const MAX_SECONDS: u32 = 3 * 60 * 60;
const EVENT: &str = "mobius:meeting";

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

pub struct Meetings {
    dir: PathBuf,
    emit: crate::bridge::Emit,
    source: Source,
    capture: Mutex<Option<Capture>>,
    /// The parts finished and not yet read, by number.
    parts: Arc<Mutex<BTreeMap<u32, Part>>>,
    /// Counts meetings, so a part or an end from one that was cancelled is never taken for the next.
    meeting: Arc<std::sync::atomic::AtomicU64>,
}

impl Meetings {
    /// Meetings heard from the microphone, their parts kept in `dir` until read. `testing` hears a test sound instead,
    /// for the end-to-end tests on computers with no microphone.
    pub fn new(dir: PathBuf, emit: crate::bridge::Emit, testing: bool) -> Meetings {
        Meetings { dir, emit, source: if testing { Source::Test } else { Source::Microphone }, capture: Mutex::new(None), parts: Arc::default(), meeting: Arc::default() }
    }

    /// Whether meetings are heard here; elsewhere the window records them itself.
    #[must_use]
    pub fn here(&self) -> bool {
        self.source == Source::Test || mobius_audio::meeting::microphone_here()
    }

    pub fn available(&self) -> Value {
        json!({ "ok": true, "here": self.here() })
    }

    /// Starts hearing a meeting. Anything left from an earlier one is deleted first.
    pub fn start(&self, part_seconds: Option<u64>) -> Value {
        let mut capture = lock(&self.capture);
        if capture.is_some() {
            return json!({ "ok": false, "error": "A meeting is already being recorded." });
        }
        self.clear();
        let id = self.meeting.fetch_add(1, std::sync::atomic::Ordering::AcqRel) + 1;
        let part_seconds = part_seconds.and_then(|s| u32::try_from(s).ok()).filter(|s| (1..=PART_SECONDS).contains(s)).unwrap_or(PART_SECONDS);
        let (parts, emit, current) = (Arc::clone(&self.parts), self.emit.clone(), Arc::clone(&self.meeting));
        let still = move |current: &std::sync::atomic::AtomicU64| current.load(std::sync::atomic::Ordering::Acquire) == id;
        let on_part = {
            let current = Arc::clone(&current);
            let emit = emit.clone();
            Box::new(move |part: Result<Part, String>| {
                if !still(&current) {
                    if let Ok(part) = part {
                        let _ = std::fs::remove_file(part.file);
                    }
                    return;
                }
                match part {
                    Ok(part) => {
                        emit(EVENT, json!({ "kind": "part", "index": part.index, "start": part.start, "seconds": part.seconds }));
                        lock(&parts).insert(part.index, part);
                    }
                    Err(e) => emit(EVENT, json!({ "kind": "problem", "message": e })),
                }
            })
        };
        let on_end = Box::new(move |ended: Result<f64, String>| {
            if still(&current) {
                match ended {
                    Ok(seconds) => emit(EVENT, json!({ "kind": "ended", "seconds": seconds })),
                    Err(e) => emit(EVENT, json!({ "kind": "ended", "error": e })),
                }
            }
        });
        match Capture::start(self.source, &self.dir, part_seconds, MAX_SECONDS, on_part, on_end) {
            Ok((started, name)) => {
                *capture = Some(started);
                json!({ "ok": true, "device": name })
            }
            Err(error) => json!({ "ok": false, "error": error }),
        }
    }

    /// Stops hearing it. The last part is handed over, then the end, before this answers.
    pub fn stop(&self) -> Value {
        let taken = lock(&self.capture).take();
        match taken {
            Some(mut capture) => {
                capture.stop();
                json!({ "ok": true })
            }
            None => json!({ "ok": false, "error": "No meeting is being recorded." }),
        }
    }

    /// Stops hearing it and deletes what was heard.
    pub fn cancel(&self) -> Value {
        self.meeting.fetch_add(1, std::sync::atomic::Ordering::AcqRel);
        if let Some(mut capture) = lock(&self.capture).take() {
            capture.stop();
        }
        self.clear();
        json!({ "ok": true })
    }

    /// A finished part, as a WAV, with where it falls in the meeting; its file is deleted once read.
    pub fn take(&self, index: u64) -> Result<(Vec<u8>, f64, f64), String> {
        let part = u32::try_from(index).ok().and_then(|i| lock(&self.parts).remove(&i)).ok_or("That part of the meeting isn't here.")?;
        let read = std::fs::read(&part.file);
        let _ = std::fs::remove_file(&part.file);
        let bytes = read.map_err(|e| format!("Part of the meeting could not be read: {e}"))?;
        Ok((bytes, part.start, part.seconds))
    }

    /// Which meeting this is, so the voices heard in its parts keep their names from one part to the next.
    #[must_use]
    pub fn number(&self) -> u64 {
        self.meeting.load(std::sync::atomic::Ordering::Acquire)
    }

    /// Ends a meeting still being heard, as Mobius quits; nothing is kept.
    pub fn shut(&self) {
        let _ = self.cancel();
    }

    fn clear(&self) {
        lock(&self.parts).clear();
        if let Ok(entries) = std::fs::read_dir(&self.dir) {
            for entry in entries.flatten() {
                if entry.file_name().to_string_lossy().starts_with("part-") {
                    let _ = std::fs::remove_file(entry.path());
                }
            }
        }
    }
}

/// A part's words with times in the meeting rather than in the part: each piece is moved on by where the part starts.
#[must_use]
pub fn in_meeting(mut heard: Value, start: f64, seconds: f64) -> Value {
    if let Some(segments) = heard.get_mut("segments").and_then(Value::as_array_mut) {
        for s in segments {
            for key in ["start", "end"] {
                if let Some(t) = s.get(key).and_then(Value::as_f64) {
                    s[key] = json!(((t + start) * 100.0).round() / 100.0);
                }
            }
        }
    }
    if heard["ok"] == true {
        heard["start"] = json!(start);
        heard["seconds"] = json!(seconds);
    }
    heard
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    fn events() -> (crate::bridge::Emit, Arc<Mutex<Vec<Value>>>) {
        let seen: Arc<Mutex<Vec<Value>>> = Arc::default();
        let s = Arc::clone(&seen);
        (Arc::new(move |name: &str, v: Value| if name == EVENT { lock(&s).push(v) }), seen)
    }

    #[test]
    fn a_meeting_is_handed_over_in_parts_each_deleted_once_read() {
        let dir = tempfile::tempdir().unwrap();
        let (emit, seen) = events();
        let meetings = Meetings::new(dir.path().to_path_buf(), emit, true);
        assert!(meetings.here());
        assert_eq!(meetings.start(Some(1))["device"], "Test sound");
        assert_eq!(meetings.start(Some(1))["ok"], false, "one at a time");
        let deadline = Instant::now() + Duration::from_secs(5);
        while lock(&seen).is_empty() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(20));
        }
        assert_eq!(meetings.stop()["ok"], true);
        let seen = lock(&seen).clone();
        assert_eq!(seen.first().unwrap()["kind"], "part");
        assert_eq!(seen.last().unwrap()["kind"], "ended");
        let (wav, start, seconds) = meetings.take(0).unwrap();
        assert!(crate::voice_local::is_listening_wav(&wav));
        // A one-second part, cut in the quietest moment of its second half (the test sound rises and falls).
        assert!(start == 0.0 && (0.5..=1.0).contains(&seconds), "{start} {seconds}");
        assert!(meetings.take(0).is_err(), "read once");
        assert!(!dir.path().join("part-0.wav").exists());
    }

    #[test]
    fn cancelling_deletes_every_part_and_hands_nothing_over() {
        let dir = tempfile::tempdir().unwrap();
        let (emit, seen) = events();
        let meetings = Meetings::new(dir.path().to_path_buf(), emit, true);
        meetings.start(Some(1));
        std::thread::sleep(Duration::from_millis(1300));
        let before = lock(&seen).len();
        meetings.cancel();
        assert_eq!(lock(&seen).len(), before, "no last part and no end from a cancelled meeting");
        assert!(std::fs::read_dir(dir.path()).unwrap().flatten().all(|e| !e.file_name().to_string_lossy().starts_with("part-")));
        assert!(meetings.take(0).is_err());
        assert_eq!(meetings.stop()["ok"], false);
    }

    #[test]
    fn the_words_of_a_part_are_timed_in_the_meeting() {
        let heard = json!({ "ok": true, "text": "Hello.", "segments": [{ "start": 0.5, "end": 1.25, "text": "Hello." }] });
        let got = in_meeting(heard, 120.0, 120.0);
        assert_eq!((got["segments"][0]["start"].as_f64(), got["segments"][0]["end"].as_f64()), (Some(120.5), Some(121.25)));
        assert_eq!(got["start"], 120.0);
        assert_eq!(in_meeting(json!({ "ok": false, "error": "x" }), 5.0, 1.0).get("start"), None);
    }
}
