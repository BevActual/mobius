//! Recording a meeting in Mobius itself rather than in the window (docs/reference/voice-plan.md, section 2): the
//! microphone is heard here, cut into 16 kHz parts of two minutes, and each part is handed to the window as it is
//! finished. The window asks for each to be written down, in order, with whoever is chosen for listening. A part's
//! file is deleted as soon as it has been read, and every part left is deleted when the meeting is cancelled or a new
//! one starts: as before, only the words are kept.
//!
//! Where it can (Windows, for now), the computer's own sound is heard as a second track on the same clock: the other
//! side of a call. Each part's two tracks are written down apart and merged in time order, the microphone's lines as
//! "You" and the computer's as "Others". With speakers rather than headphones the microphone hears the others too, so
//! a line of the microphone's that the other track was saying at the same moment is left out as their echo.
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

    /// Whether the computer's own sound can be heard here too.
    #[must_use]
    pub fn others_here(&self) -> bool {
        self.source == Source::Test || mobius_audio::meeting::others_here()
    }

    pub fn available(&self) -> Value {
        json!({ "ok": true, "here": self.here(), "others": self.others_here() })
    }

    /// Starts hearing a meeting, with the computer's own sound too when `others` is asked for and it can be heard.
    /// Anything left from an earlier one is deleted first.
    pub fn start(&self, part_seconds: Option<u64>, others: bool) -> Value {
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
        match Capture::start(self.source, others, &self.dir, part_seconds, MAX_SECONDS, on_part, on_end) {
            Ok((started, name)) => {
                let others = started.others().map(str::to_owned);
                *capture = Some(started);
                json!({ "ok": true, "device": name, "others": others })
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

    /// A finished part, as a WAV of the microphone and one of the computer's sound when that was heard, with where it
    /// falls in the meeting; its files are deleted once read.
    pub fn take(&self, index: u64) -> Result<Taken, String> {
        let part = u32::try_from(index).ok().and_then(|i| lock(&self.parts).remove(&i)).ok_or("That part of the meeting isn't here.")?;
        let read = |file: &PathBuf| {
            let bytes = std::fs::read(file);
            let _ = std::fs::remove_file(file);
            bytes.map_err(|e| format!("Part of the meeting could not be read: {e}"))
        };
        let you = read(&part.file);
        let others = part.others.as_ref().map(read).transpose();
        Ok(Taken { you: you?, others: others?, start: part.start, seconds: part.seconds })
    }

    /// Ends a meeting still being heard, as Mobius quits; nothing is kept.
    pub fn shut(&self) {
        let _ = self.cancel();
    }

    fn clear(&self) {
        lock(&self.parts).clear();
        if let Ok(entries) = std::fs::read_dir(&self.dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with("part-") || name.starts_with("others-") {
                    let _ = std::fs::remove_file(entry.path());
                }
            }
        }
    }
}

/// A part as read: its tracks and where it falls in the meeting.
pub struct Taken {
    pub you: Vec<u8>,
    pub others: Option<Vec<u8>>,
    pub start: f64,
    pub seconds: f64,
}

/// A twentieth of a second at 16 kHz: how finely the other track's loudness is judged.
const FRAME: usize = 320;
/// Louder than this (about -40 dB) is someone playing, not the quiet of a pause.
const LOUD: f64 = 330.0;

/// For each frame of a 16 kHz WAV, whether something is playing in it.
#[must_use]
pub fn loud_frames(wav: &[u8]) -> Vec<bool> {
    let samples: Vec<f64> = wav.get(44..).unwrap_or_default().chunks_exact(2).map(|b| f64::from(i16::from_le_bytes([b[0], b[1]]))).collect();
    samples.chunks(FRAME).map(|f| (f.iter().map(|s| s * s).sum::<f64>() / f.len() as f64).sqrt() > LOUD).collect()
}

/// Whether the other track holds anything worth writing down: more than a quarter second of sound.
#[must_use]
pub fn anything_played(loud: &[bool]) -> bool {
    loud.iter().filter(|l| **l).count() * FRAME > 4_000
}

/// One line of the merged part: who, when, and what.
struct Line {
    you: bool,
    start: f64,
    end: f64,
    text: String,
}

fn lines(heard: &Value, you: bool, seconds: f64) -> Vec<Line> {
    if heard["ok"] != true {
        return Vec::new();
    }
    let timed: Vec<Line> = heard["segments"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|s| {
            let text = s["text"].as_str()?.trim();
            (!text.is_empty()).then(|| Line { you, start: s["start"].as_f64().unwrap_or(0.0), end: s["end"].as_f64().unwrap_or(seconds), text: text.to_owned() })
        })
        .collect();
    if !timed.is_empty() {
        return timed;
    }
    // A service that gives no times: the whole part is one line.
    heard["text"].as_str().map(str::trim).filter(|t| !t.is_empty()).map(|t| vec![Line { you, start: 0.0, end: seconds, text: t.to_owned() }]).unwrap_or_default()
}

fn words(text: &str) -> std::collections::HashSet<String> {
    text.split(|c: char| !c.is_alphanumeric() && c != '\'').filter(|w| !w.is_empty()).map(str::to_lowercase).collect()
}

/// How many of the shorter line's words the other has too, from 0 to 1.
fn alike(a: &str, b: &str) -> f64 {
    let (a, b) = (words(a), words(b));
    let fewer = a.len().min(b.len());
    if fewer == 0 { 0.0 } else { a.intersection(&b).count() as f64 / fewer as f64 }
}

/// Whether a line of the microphone's is the others heard through the speakers: the other track was playing for most
/// of it, and said much the same at the same moment.
fn echo(line: &Line, others: &[Line], loud: &[bool]) -> bool {
    let frame = |t: f64| ((t.max(0.0) * 16_000.0) as usize / FRAME).min(loud.len());
    let (from, to) = (frame(line.start), frame(line.end).max(frame(line.start) + 1).min(loud.len()));
    let span = &loud[from.min(to)..to];
    let playing = !span.is_empty() && span.iter().filter(|l| **l).count() * 10 >= span.len() * 6;
    playing && others.iter().any(|o| o.start < line.end + 1.0 && o.end > line.start - 1.0 && alike(&line.text, &o.text) >= 0.5)
}

/// A part's two tracks as written down, merged in time order: "You" for the microphone and "Others" for the computer's
/// sound, with the microphone's echo of the others left out. `loud` is the other track's loudness, from
/// `loud_frames`.
#[must_use]
pub fn two_sides(you: Value, others: Value, loud: &[bool], seconds: f64) -> Value {
    let no_speech = |v: &Value| v["ok"] != true && v["error"].as_str().is_some_and(|e| e.starts_with("No speech"));
    // A track that failed (not one that was only quiet) says so, rather than hand over half a conversation.
    for heard in [&you, &others] {
        if heard["ok"] != true && !no_speech(heard) {
            return heard.clone();
        }
    }
    let theirs = lines(&others, false, seconds);
    let mut all: Vec<Line> = lines(&you, true, seconds).into_iter().filter(|l| !echo(l, &theirs, loud)).collect();
    all.extend(theirs);
    if all.is_empty() {
        return json!({ "ok": false, "error": "No speech was heard." });
    }
    all.sort_by(|a, b| a.start.total_cmp(&b.start));
    let mut turns: Vec<Line> = Vec::new();
    for line in all {
        match turns.last_mut() {
            Some(turn) if turn.you == line.you => {
                turn.text.push(' ');
                turn.text.push_str(&line.text);
                turn.end = turn.end.max(line.end);
            }
            _ => turns.push(line),
        }
    }
    let who = |you: bool| if you { "You" } else { "Others" };
    let text = turns.iter().map(|t| format!("**{}:** {}", who(t.you), t.text)).collect::<Vec<_>>().join("\n\n");
    let segments: Vec<Value> = turns.iter().map(|t| json!({ "start": t.start, "end": t.end, "text": t.text, "speaker": who(t.you) })).collect();
    json!({ "ok": true, "text": text, "segments": segments })
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
        assert_eq!(meetings.start(Some(1), false)["device"], "Test sound");
        assert_eq!(meetings.start(Some(1), false)["ok"], false, "one at a time");
        let deadline = Instant::now() + Duration::from_secs(5);
        while lock(&seen).is_empty() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(20));
        }
        assert_eq!(meetings.stop()["ok"], true);
        let seen = lock(&seen).clone();
        assert_eq!(seen.first().unwrap()["kind"], "part");
        assert_eq!(seen.last().unwrap()["kind"], "ended");
        let part = meetings.take(0).unwrap();
        assert!(crate::voice_local::is_listening_wav(&part.you));
        assert!(part.others.is_none());
        assert_eq!((part.start, part.seconds), (0.0, 1.0));
        assert!(meetings.take(0).is_err(), "read once");
        assert!(!dir.path().join("part-0.wav").exists());
    }

    #[test]
    fn cancelling_deletes_every_part_and_hands_nothing_over() {
        let dir = tempfile::tempdir().unwrap();
        let (emit, seen) = events();
        let meetings = Meetings::new(dir.path().to_path_buf(), emit, true);
        meetings.start(Some(1), true);
        std::thread::sleep(Duration::from_millis(1300));
        let before = lock(&seen).len();
        meetings.cancel();
        assert_eq!(lock(&seen).len(), before, "no last part and no end from a cancelled meeting");
        assert!(std::fs::read_dir(dir.path()).unwrap().flatten().all(|e| { let n = e.file_name().to_string_lossy().into_owned(); !n.starts_with("part-") && !n.starts_with("others-") }));
        assert!(meetings.take(0).is_err());
        assert_eq!(meetings.stop()["ok"], false);
    }

    #[test]
    fn with_the_computers_sound_each_part_has_both_tracks_and_both_are_deleted_once_read() {
        let dir = tempfile::tempdir().unwrap();
        let (emit, seen) = events();
        let meetings = Meetings::new(dir.path().to_path_buf(), emit, true);
        assert_eq!(meetings.available()["others"], true);
        assert_eq!(meetings.start(Some(1), true)["others"], "Test playback");
        let deadline = Instant::now() + Duration::from_secs(5);
        while lock(&seen).is_empty() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(20));
        }
        meetings.stop();
        let part = meetings.take(0).unwrap();
        let others = part.others.unwrap();
        assert!(crate::voice_local::is_listening_wav(&others));
        assert!(anything_played(&loud_frames(&others)), "the test playback is heard");
        assert!(!dir.path().join("others-0.wav").exists());
    }

    fn wav(seconds: f64, playing: impl Fn(f64) -> bool) -> Vec<u8> {
        let n = (seconds * 16_000.0) as usize;
        let samples: Vec<i16> = (0..n).map(|i| if playing(i as f64 / 16_000.0) { if i % 2 == 0 { 3000 } else { -3000 } } else { 0 }).collect();
        mobius_audio::meeting::wav16(&samples)
    }

    #[test]
    fn the_two_sides_are_merged_in_time_order_and_turns_are_kept_together() {
        let you = json!({ "ok": true, "segments": [{ "start": 0.0, "end": 2.0, "text": "Morning, everyone." }, { "start": 2.0, "end": 3.0, "text": "Shall we start?" }, { "start": 9.0, "end": 10.0, "text": "Sounds good." }] });
        let others = json!({ "ok": true, "segments": [{ "start": 4.0, "end": 8.0, "text": "Yes, first the budget." }] });
        let loud = loud_frames(&wav(10.0, |t| (4.0..8.0).contains(&t)));
        let got = two_sides(you, others, &loud, 10.0);
        assert_eq!(got["text"], "**You:** Morning, everyone. Shall we start?\n\n**Others:** Yes, first the budget.\n\n**You:** Sounds good.");
        assert_eq!(got["segments"].as_array().unwrap().iter().map(|s| s["speaker"].as_str().unwrap()).collect::<Vec<_>>(), vec!["You", "Others", "You"]);
        assert_eq!(got["segments"][1]["start"], 4.0);
    }

    #[test]
    fn the_others_heard_through_speakers_are_left_out_of_your_lines_but_talking_over_them_is_kept() {
        let others = json!({ "ok": true, "segments": [{ "start": 1.0, "end": 4.0, "text": "The launch moves to March." }] });
        let loud = loud_frames(&wav(8.0, |t| (1.0..4.0).contains(&t)));
        // The microphone hears the same words at the same time: an echo.
        let echoed = json!({ "ok": true, "segments": [{ "start": 1.2, "end": 4.1, "text": "the launch moves to march" }, { "start": 5.0, "end": 6.0, "text": "Got it." }] });
        assert_eq!(two_sides(echoed, others.clone(), &loud, 8.0)["text"], "**Others:** The launch moves to March.\n\n**You:** Got it.");
        // Saying something else over them is kept.
        let over = json!({ "ok": true, "segments": [{ "start": 2.0, "end": 3.0, "text": "Wait, which March?" }] });
        assert_eq!(two_sides(over, others, &loud, 8.0)["text"], "**Others:** The launch moves to March.\n\n**You:** Wait, which March?");
    }

    #[test]
    fn a_quiet_side_is_left_out_and_a_failed_one_says_so() {
        let quiet = json!({ "ok": false, "error": "No speech was heard." });
        let you = json!({ "ok": true, "text": "Just me today." });
        assert_eq!(two_sides(you.clone(), quiet.clone(), &[], 120.0)["text"], "**You:** Just me today.");
        assert_eq!(two_sides(quiet.clone(), quiet.clone(), &[], 120.0)["ok"], false);
        let down = json!({ "ok": false, "error": "The speech server did not answer." });
        assert_eq!(two_sides(you, down, &[], 120.0)["error"], "The speech server did not answer.");
        assert!(!anything_played(&loud_frames(&wav(2.0, |_| false))));
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
