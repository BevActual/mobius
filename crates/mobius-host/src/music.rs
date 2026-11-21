//! Music's own sound engine for the window: the `music` bridge namespace.
//!
//! The window hands over the song it has open (`load`), then plays, stops and moves the playhead. While it plays, the
//! position and every track's level go back about 30 times a second as `mobius:music-position`. `render` makes the
//! song into a WAV file in the workspace's Exports folder, with the same engine, so a bounce sounds as playback does.
//! The engine opens the computer's sound output the first time it is needed and keeps it open.

use mobius_audio::engine::Engine;
use mobius_audio::render::Playing;
use mobius_audio::song::Song;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// How often the window hears where playback is: about 30 times a second.
const POSITION_EVERY: Duration = Duration::from_millis(33);
/// The rate a song is rendered to a file at: 44.1 kHz, as the window's export is.
const RENDER_RATE: u32 = 44_100;

pub struct Music {
    engine: Mutex<Option<Arc<Engine>>>,
    song: Mutex<Option<Song>>,
    /// Where `play` starts when the window gives no beat: the last place it moved the playhead to.
    start: Mutex<f64>,
    /// The loop and click of the last `play`, kept when the playhead moves.
    how: Mutex<Playing>,
    /// Set while a thread is sending the position, so only one does.
    reporting: Arc<AtomicBool>,
    emit: crate::bridge::Emit,
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

fn failed(message: impl Into<String>) -> Value {
    json!({ "ok": false, "message": message.into() })
}

/// The song the window sent: the song file's JSON, as an object or as its text.
pub fn song_of(value: &Value) -> Result<Song, String> {
    match value {
        Value::String(text) => Song::parse(text),
        Value::Object(_) => Song::parse(&value.to_string()),
        _ => Err("a song is needed".to_owned()),
    }
}

impl Music {
    pub fn new(emit: crate::bridge::Emit) -> Music {
        Music { engine: Mutex::new(None), song: Mutex::new(None), start: Mutex::new(0.0), how: Mutex::new(Playing::default()), reporting: Arc::new(AtomicBool::new(false)), emit }
    }

    /// The engine, opening the sound output the first time.
    fn engine(&self) -> Result<Arc<Engine>, String> {
        let mut engine = lock(&self.engine);
        if let Some(e) = engine.as_ref() {
            return Ok(e.clone());
        }
        let opened = Arc::new(Engine::open()?);
        *engine = Some(opened.clone());
        Ok(opened)
    }

    pub fn call(&self, method: &str, args: &[Value], songs: &mobius_workspace::notes::Notes) -> Value {
        let arg = |i: usize| args.get(i).unwrap_or(&Value::Null);
        let result = match method {
            "engine" => self.engine().map(|e| json!({ "ok": true, "device": e.device(), "sampleRate": e.sample_rate(), "latencyMs": e.latency_ms() })),
            "load" => self.load(arg(0)),
            "play" => self.play(arg(0).as_f64(), cycle_of(arg(1)), arg(2).as_bool().unwrap_or(false)),
            "stop" => self.stop(),
            "seek" => match arg(0).as_f64() {
                Some(beat) if beat.is_finite() => self.seek(beat.max(0.0)),
                _ => Err("a beat is needed".to_owned()),
            },
            "position" => Ok(self.position()),
            "render" => match (arg(0).as_str(), arg(1).as_str()) {
                (Some(path), Some(name)) => self.render(arg(2), path, name, songs),
                _ => Err("a song, a name and the sound are needed".to_owned()),
            },
            _ => Err(format!("Music's engine has no \"{method}\"")),
        };
        result.unwrap_or_else(failed)
    }

    /// Take the song the window has open. If it is playing, it goes on from where it is with the change.
    fn load(&self, value: &Value) -> Result<Value, String> {
        let song = song_of(value)?;
        if let Some(e) = lock(&self.engine).as_ref() {
            e.update(&song)?;
        }
        *lock(&self.song) = Some(song);
        Ok(json!({ "ok": true }))
    }

    fn play(&self, from: Option<f64>, cycle: Option<(f64, f64)>, click: bool) -> Result<Value, String> {
        let from = match from {
            Some(beat) if beat.is_finite() => beat.max(0.0),
            _ => *lock(&self.start),
        };
        let engine = self.engine()?;
        {
            let song = lock(&self.song);
            let song = song.as_ref().ok_or("load a song first")?;
            let how = Playing { from, cycle, click };
            engine.play(song, how)?;
            *lock(&self.how) = how;
        }
        *lock(&self.start) = from;
        self.report(engine);
        Ok(json!({ "ok": true, "beat": from }))
    }

    fn stop(&self) -> Result<Value, String> {
        if let Some(e) = lock(&self.engine).as_ref() {
            e.stop()?;
        }
        Ok(json!({ "ok": true }))
    }

    /// Move the playhead. Playing goes on from there; stopped, the next `play` starts there.
    fn seek(&self, beat: f64) -> Result<Value, String> {
        *lock(&self.start) = beat;
        let engine = lock(&self.engine).clone();
        if let Some(e) = engine {
            if e.position().playing {
                let song = lock(&self.song);
                if let Some(song) = song.as_ref() {
                    e.play(song, Playing { from: beat, ..*lock(&self.how) })?;
                }
            }
        }
        Ok(json!({ "ok": true, "beat": beat }))
    }

    fn position(&self) -> Value {
        match lock(&self.engine).as_ref() {
            Some(e) => position_json(e),
            None => json!({ "playing": false, "beat": *lock(&self.start), "meters": {} }),
        }
    }

    /// Send the position while playing, from one thread at a time; the last one says it stopped.
    fn report(&self, engine: Arc<Engine>) {
        if self.reporting.swap(true, Ordering::AcqRel) {
            return;
        }
        let reporting = self.reporting.clone();
        let emit = self.emit.clone();
        let spawned = std::thread::Builder::new().name("mobius-music-position".into()).spawn(move || {
            // The first report can come before the audio thread has taken the song: give it a moment to start.
            let mut grace = 10;
            loop {
                std::thread::sleep(POSITION_EVERY);
                let position = engine.position();
                let playing = position.playing;
                emit("mobius:music-position", position_json_of(&position));
                if !playing {
                    if grace == 0 {
                        break;
                    }
                    grace -= 1;
                } else {
                    grace = 0;
                }
            }
            reporting.store(false, Ordering::Release);
        });
        if spawned.is_err() {
            self.reporting.store(false, Ordering::Release);
        }
    }

    /// Render the song to WAV with this engine and save it in Exports beside the song's other exports.
    fn render(&self, value: &Value, path: &str, name: &str, songs: &mobius_workspace::notes::Notes) -> Result<Value, String> {
        let song = match value {
            Value::Null => lock(&self.song).clone().ok_or("load a song first")?,
            v => song_of(v)?,
        };
        let (left, right) = mobius_audio::render::render_song(&song, RENDER_RATE);
        let mut bytes = Vec::with_capacity(left.len() * 8 + 64);
        mobius_audio::wav::write(&mut bytes, &left, &right, RENDER_RATE).map_err(|e| e.to_string())?;
        songs.save_sound_bytes(path, name, &bytes)
    }
}

/// The loop the window sent: `{ start, end }` in beats, or nothing.
fn cycle_of(value: &Value) -> Option<(f64, f64)> {
    let (start, end) = (value.get("start")?.as_f64()?, value.get("end")?.as_f64()?);
    (start.is_finite() && end.is_finite() && end > start).then_some((start, end))
}

fn position_json(engine: &Engine) -> Value {
    position_json_of(&engine.position())
}

fn position_json_of(p: &mobius_audio::engine::Position) -> Value {
    let meters: serde_json::Map<String, Value> = p.meters.iter().map(|(id, [l, r])| (id.clone(), json!([l, r]))).collect();
    json!({ "playing": p.playing, "beat": p.beat, "meters": meters })
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    const SONG: &str = r#"{"version":2,"tempo":120,"bars":1,"tracks":[{"id":"t1","instrument":"bass","clips":[{"start":0,"length":4,"notes":[{"pitch":36,"start":0,"length":1,"velocity":0.8}]}]}]}"#;

    fn music() -> Music {
        Music::new(Arc::new(|_: &str, _: Value| {}))
    }

    #[test]
    fn a_song_comes_as_its_object_or_its_text() {
        let object: Value = serde_json::from_str(SONG).unwrap();
        assert_eq!(song_of(&object).unwrap().tempo, 120.0);
        assert_eq!(song_of(&Value::String(SONG.to_owned())).unwrap().tempo, 120.0);
        assert!(song_of(&Value::Null).is_err());
    }

    #[test]
    fn the_playhead_moves_while_stopped_and_play_needs_a_song() {
        let m = music();
        let dir = tempfile::tempdir().unwrap();
        let songs = mobius_workspace::notes::Notes::in_folder(dir.path().join("w"), dir.path().join("c"), "studio");
        assert_eq!(m.call("seek", &[json!(8)], &songs)["beat"], 8.0);
        assert_eq!(m.call("position", &[], &songs)["beat"], 8.0);
        assert_eq!(m.call("seek", &[json!("x")], &songs)["ok"], false);
        assert_eq!(m.call("nope", &[], &songs)["ok"], false);
        if cfg!(not(windows)) {
            assert_eq!(m.call("engine", &[], &songs)["ok"], false);
        }
    }
}
