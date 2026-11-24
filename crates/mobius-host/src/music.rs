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
    /// Audio clips' sounds, read from the song's folder and kept while their files stay the same.
    samples: mobius_audio::sample::Samples,
    /// The loaded song's folder, where recordings are saved (none until the window says which song it is).
    folder: Mutex<Option<std::path::PathBuf>>,
    /// The sound input chosen to record from (none for the computer's default).
    input_device: Mutex<Option<String>>,
    /// The track a take is being recorded on.
    recording: Mutex<Option<String>>,
    song: Mutex<Option<Song>>,
    /// Where `play` starts when the window gives no beat: the last place it moved the playhead to.
    start: Mutex<f64>,
    /// The loop and click of the last `play`, kept when the playhead moves.
    how: Mutex<Playing>,
    /// The track a keyboard plays, by id: armed again from each song the window sends, so it plays the sound as edited.
    armed: Mutex<Option<String>>,
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
        Music { engine: Mutex::new(None), samples: mobius_audio::sample::Samples::new(), folder: Mutex::new(None), input_device: Mutex::new(None), recording: Mutex::new(None), song: Mutex::new(None), start: Mutex::new(0.0), how: Mutex::new(Playing::default()), armed: Mutex::new(None), reporting: Arc::new(AtomicBool::new(false)), emit }
    }

    /// The engine, opening the sound output the first time.
    fn engine(&self) -> Result<Arc<Engine>, String> {
        let mut engine = lock(&self.engine);
        if let Some(e) = engine.as_ref() {
            return Ok(e.clone());
        }
        // No output (or none the engine opens yet): the engine runs silently, so Music works the same, unheard.
        let opened = Arc::new(Engine::open().unwrap_or_else(|why| {
            eprintln!("[music] playing silently: {why}");
            Engine::silent()
        }));
        // A MIDI keyboard played while stopped: the position (and its meters) is sent while it sounds.
        let (reporting, emit, weak) = (self.reporting.clone(), self.emit.clone(), Arc::downgrade(&opened));
        opened.on_key(Arc::new(move || {
            if let Some(engine) = weak.upgrade() {
                report(&reporting, &emit, engine);
            }
        }));
        // A song loaded before the engine opened: its Main level is what notes played while stopped go through.
        if let Some(song) = lock(&self.song).as_ref() {
            opened.update(song)?;
        }
        *engine = Some(opened.clone());
        Ok(opened)
    }

    pub fn call(&self, method: &str, args: &[Value], songs: &mobius_workspace::notes::Notes) -> Value {
        let arg = |i: usize| args.get(i).unwrap_or(&Value::Null);
        let result = match method {
            "engine" => self.engine().map(|e| json!({ "ok": true, "device": e.device(), "silent": e.is_silent(), "sampleRate": e.sample_rate(), "latencyMs": e.latency_ms() })),
            "load" => self.load(arg(0), arg(1).as_str(), songs),
            "play" => self.play(arg(0).as_f64(), cycle_of(arg(1)), arg(2).as_bool().unwrap_or(false)),
            "playSession" => self.play_session(arg(0).as_bool().unwrap_or(false), arg(1)),
            "launch" => match arg(0).as_str() {
                Some(track) => self.launch(track, arg(1)),
                None => Err("a track is needed".to_owned()),
            },
            "preview" => match (arg(0), arg(1).as_u64().and_then(|p| u8::try_from(p).ok()).filter(|p| *p < 128)) {
                (Value::String(track), Some(pitch)) => self.preview(track, pitch, arg(2).as_f64().unwrap_or(0.8), arg(3).as_f64().unwrap_or(0.35)),
                // A sound from the Library, on no track: `{ instrument, sound?, kit? }`.
                (sound @ Value::Object(_), Some(pitch)) => self.audition(sound, pitch, arg(2).as_f64().unwrap_or(0.8), arg(3).as_f64().unwrap_or(0.35)),
                _ => Err("a track and a pitch are needed".to_owned()),
            },
            "watch" => match (arg(0), arg(1)) {
                (Value::Null, _) | (_, Value::Null) => self.watch(None),
                (Value::String(track), Value::String(fx)) => self.watch(Some((track, fx))),
                _ => Err("a track and an effect, or null, are needed".to_owned()),
            },
            "midiInputs" => Ok(json!({ "ok": true, "inputs": mobius_audio::midi::inputs(), "listening": lock(&self.engine).as_ref().and_then(|e| e.listening()) })),
            "listen" => self.listen(arg(0).as_str()),
            "arm" => self.arm(arg(0).as_str()),
            "press" => match arg(0).as_u64().and_then(|p| u8::try_from(p).ok()).filter(|p| *p < 128) {
                Some(pitch) => self.press(pitch, arg(1).as_f64()),
                None => Err("a pitch is needed".to_owned()),
            },
            "countIn" => self.count_in(arg(0).as_u64().and_then(|b| usize::try_from(b).ok()), arg(1).as_f64()),
            "stop" => self.stop(),
            "record" => self.record(arg(0).as_bool().unwrap_or(false)),
            "inputs" => Ok(json!({
                "ok": true,
                "inputs": mobius_audio::engine::inputs().into_iter().map(|(name, channels)| json!({ "name": name, "channels": channels })).collect::<Vec<_>>(),
                "using": *lock(&self.input_device),
            })),
            "useInput" => self.use_input(arg(0).as_str()),
            // A sound brought to the song (dropped from Files or the Library), saved in its Samples folder.
            "importSample" => match (arg(0).as_str(), arg(1).as_str(), arg(2).as_str()) {
                (Some(path), Some(name), Some(data)) => self.import_sample(path, name, data, songs),
                _ => Err("a song, a name and the sound are needed".to_owned()),
            },
            "samples" => match arg(0).as_str() {
                Some(path) => songs.folder_of(path).map(|folder| json!({ "ok": true, "files": mobius_audio::sample::list(&folder) })),
                None => Err("a song is needed".to_owned()),
            },
            "peaks" => match (arg(0).as_str(), arg(1).as_str()) {
                (Some(path), Some(file)) => self.peaks(path, file, arg(2).as_u64().unwrap_or(256), songs),
                _ => Err("a song and a file are needed".to_owned()),
            },
            "seek" => match arg(0).as_f64() {
                Some(beat) if beat.is_finite() => self.seek(beat.max(0.0)),
                _ => Err("a beat is needed".to_owned()),
            },
            "position" => Ok(self.position()),
            // Each track, return and Main as its own WAV (Live's All Individual Tracks), in a folder in Exports.
            "renderStems" => match (arg(0).as_str(), arg(1).as_str()) {
                (Some(path), Some(name)) => self.render_stems(arg(2), path, name, songs),
                _ => Err("a song and a name are needed".to_owned()),
            },
            // Freezes a track (Live 12 manual, 38.1.4): renders it into the song's Samples/Processed/Freeze folder.
            "freeze" => match (arg(0).as_str(), arg(1).as_str()) {
                (Some(path), Some(track)) => self.freeze(arg(2), path, track, songs),
                _ => Err("a song and a track are needed".to_owned()),
            },
            "render" => match (arg(0).as_str(), arg(1).as_str()) {
                (Some(path), Some(name)) => self.render(arg(2), path, name, songs),
                _ => Err("a song, a name and the sound are needed".to_owned()),
            },
            _ => Err(format!("Music's engine has no \"{method}\"")),
        };
        result.unwrap_or_else(failed)
    }

    /// Take the song the window has open, with its audio clips' sounds from its folder when the window says which
    /// song it is (`path`). If it is playing, it goes on from where it is with the change. A sound that cannot be read
    /// is named in `missing`, and its clip is silent.
    fn load(&self, value: &Value, path: Option<&str>, songs: &mobius_workspace::notes::Notes) -> Result<Value, String> {
        let mut song = song_of(value)?;
        if let Some(path) = path {
            *lock(&self.folder) = songs.folder_of(path).ok();
        }
        let missing = self.attach(&mut song, path, songs);
        if let Some(e) = lock(&self.engine).as_ref() {
            e.update(&song)?;
            if let Some(id) = lock(&self.armed).as_deref() {
                e.arm(song.tracks.iter().find(|t| t.id == id), &song.sounds);
            }
        }
        *lock(&self.song) = Some(song);
        Ok(json!({ "ok": true, "missing": missing }))
    }

    /// A sound file's waveform, for an audio clip to draw: `file` in the folder of the song at `path`, as the lowest
    /// and highest sample over each `per` frames (`[[min, max], ...]`), with the file's rate and length.
    fn peaks(&self, path: &str, file: &str, per: u64, songs: &mobius_workspace::notes::Notes) -> Result<Value, String> {
        let sound = self.samples.sound(&songs.folder_of(path)?, file)?;
        let (per, points) = mobius_audio::sample::peaks(&sound, usize::try_from(per).unwrap_or(usize::MAX));
        Ok(json!({ "ok": true, "rate": sound.rate, "frames": sound.left.len(), "per": per, "peaks": points }))
    }

    fn import_sample(&self, path: &str, name: &str, data: &str, songs: &mobius_workspace::notes::Notes) -> Result<Value, String> {
        use base64::Engine as _;
        if data.len() > mobius_audio::wav::MAX_READ / 3 * 4 + 8 {
            return Err("That sound is too big.".into());
        }
        let bytes = base64::engine::general_purpose::STANDARD.decode(data).map_err(|_| "The sound did not arrive whole.".to_owned())?;
        let file = mobius_audio::sample::import(&songs.folder_of(path)?, name, &bytes)?;
        Ok(json!({ "ok": true, "file": file }))
    }

    /// Reads the sounds of the song's audio clips, samplers and drum pads from the folder of the song at `path`.
    fn attach(&self, song: &mut Song, path: Option<&str>, songs: &mobius_workspace::notes::Notes) -> Vec<String> {
        let has_audio = song.tracks.iter().any(|t| Song::is_audio(t) || t.frozen.is_some() || Song::sampler_of(t).is_some() || t.pads.values().any(|p| p.sample.is_some()));
        match path.filter(|_| has_audio).map(|p| songs.folder_of(p)) {
            Some(Ok(folder)) => self.samples.attach(song, &folder),
            Some(Err(why)) => vec![why],
            None => Vec::new(),
        }
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
            let how = Playing { from, cycle, click, session: false };
            engine.play(song, how)?;
            *lock(&self.how) = how;
        }
        *lock(&self.start) = from;
        self.report(engine);
        Ok(json!({ "ok": true, "beat": from }))
    }

    /// Play the Session view, with the clips the window has waiting (`{ trackId: slot or null }`) starting at once.
    fn play_session(&self, click: bool, launches: &Value) -> Result<Value, String> {
        let launches: Vec<(String, Option<usize>)> = launches.as_object().map_or_else(Vec::new, |o| o.iter().filter_map(|(id, slot)| Some((id.clone(), slot_of(slot)?))).collect());
        let engine = self.engine()?;
        {
            let song = lock(&self.song);
            let song = song.as_ref().ok_or("load a song first")?;
            engine.play_session(song, click, &launches)?;
            *lock(&self.how) = Playing { from: 0.0, cycle: None, click, session: true };
        }
        self.report(engine);
        Ok(json!({ "ok": true }))
    }

    /// Start a track's clip in a slot, or stop the track with null, at the next bar line.
    fn launch(&self, track: &str, slot: &Value) -> Result<Value, String> {
        let slot = slot_of(slot).ok_or("a slot or null is needed")?;
        let engine = lock(&self.engine).clone().ok_or("play the Session view first")?;
        engine.launch(track, slot)?;
        Ok(json!({ "ok": true }))
    }

    /// A note of a track of the loaded song, heard at once as a key is pressed or a note put in.
    fn preview(&self, track: &str, pitch: u8, velocity: f64, seconds: f64) -> Result<Value, String> {
        let engine = self.engine()?;
        let song = lock(&self.song);
        let song = song.as_ref().ok_or("load a song first")?;
        let track = song.tracks.iter().find(|t| t.id == track).ok_or_else(|| format!("No track \"{track}\" in the song."))?;
        engine.preview(track, &song.sounds, pitch, velocity.clamp(0.0, 1.0), seconds.clamp(0.01, 8.0))?;
        self.report(engine);
        Ok(json!({ "ok": true }))
    }

    /// A sound heard on its own, as the Library previews it: an instrument with its sound or kit, at full volume.
    fn audition(&self, sound: &Value, pitch: u8, velocity: f64, seconds: f64) -> Result<Value, String> {
        let mut track = json!({ "id": "preview" });
        for key in ["instrument", "sound", "kit"] {
            if let Some(v) = sound.get(key) {
                track[key] = v.clone();
            }
        }
        let song = song_of(&json!({ "version": 2, "tempo": 120, "bars": 1, "tracks": [track] }))?;
        let engine = self.engine()?;
        engine.preview(&song.tracks[0], &song.sounds, pitch, velocity.clamp(0.0, 1.0), seconds.clamp(0.01, 8.0))?;
        self.report(engine);
        Ok(json!({ "ok": true }))
    }

    /// Listen to the MIDI keyboard called `input`, or to none.
    fn listen(&self, input: Option<&str>) -> Result<Value, String> {
        let listening = self.engine()?.listen(input)?;
        Ok(json!({ "ok": true, "listening": listening }))
    }

    /// Play the keyboard (MIDI, or the window's own `press`) on a track of the loaded song, or on none.
    fn arm(&self, track: Option<&str>) -> Result<Value, String> {
        let engine = self.engine()?;
        let song = lock(&self.song);
        // With no song yet it is armed once one comes.
        let found = match (track, song.as_ref()) {
            (Some(id), Some(song)) => Some(song.tracks.iter().find(|t| t.id == id).ok_or_else(|| format!("No track \"{id}\" in the song."))?),
            _ => None,
        };
        engine.arm(found, song.as_ref().map_or(&mobius_audio::song::Sounds::new(), |s| &s.sounds));
        *lock(&self.armed) = track.map(str::to_owned);
        // An armed audio track hears its input (Live's Auto monitoring); anything else closes it.
        let audio = found.filter(|t| Song::is_audio(t));
        let input = match audio {
            Some(t) => match engine.open_input(lock(&self.input_device).as_deref(), t.input) {
                Ok(name) => {
                    engine.monitor(Some((t.id.as_str(), mobius_audio::render::track_gains(t))))?;
                    // Heard while stopped: its meters go to the window as a preview's do.
                    self.report(engine.clone());
                    json!({ "input": name })
                }
                Err(why) => json!({ "input": null, "inputProblem": why }),
            },
            None => {
                engine.monitor(None)?;
                engine.close_input()?;
                json!({ "input": null })
            }
        };
        Ok(json!({ "ok": true, "input": input["input"], "inputProblem": input.get("inputProblem"), "inputFrames": engine.input_frames() }))
    }

    /// Record from the sound input called `name` (as `inputs` lists them), or the computer's default with none. An
    /// armed audio track switches to it at once.
    fn use_input(&self, name: Option<&str>) -> Result<Value, String> {
        *lock(&self.input_device) = name.map(str::to_owned);
        let armed = lock(&self.armed).clone();
        match armed {
            Some(id) => self.arm(Some(&id)),
            None => Ok(json!({ "ok": true, "input": null })),
        }
    }

    /// A key pressed on the armed track, held until `press` again with no velocity (0) lifts it.
    fn press(&self, pitch: u8, velocity: Option<f64>) -> Result<Value, String> {
        let engine = self.engine()?;
        match velocity.filter(|v| *v > 0.0) {
            Some(v) => engine.press(pitch, v.clamp(0.0, 1.0))?,
            None => engine.lift(pitch)?,
        }
        self.report(engine);
        Ok(json!({ "ok": true }))
    }

    /// A count-in of `beats` ticks at the song's tempo (or `tempo`), or none to cut one short.
    fn count_in(&self, beats: Option<usize>, tempo: Option<f64>) -> Result<Value, String> {
        let engine = self.engine()?;
        let tempo = tempo.filter(|t| t.is_finite() && *t > 0.0).or_else(|| lock(&self.song).as_ref().map(|s| s.tempo)).ok_or("a tempo is needed")?;
        engine.count_in(tempo, beats)?;
        self.report(engine);
        Ok(json!({ "ok": true }))
    }

    /// Listen to one effect's parts (for the Workbench's cables) while playing, or to none.
    fn watch(&self, target: Option<(&str, &str)>) -> Result<Value, String> {
        let engine = self.engine()?;
        let song = lock(&self.song);
        match song.as_ref() {
            Some(song) => engine.watch(song, target),
            None if target.is_none() => {}
            None => return Err("load a song first".to_owned()),
        }
        Ok(json!({ "ok": true }))
    }

    fn stop(&self) -> Result<Value, String> {
        let engine = lock(&self.engine).clone();
        if let Some(e) = engine {
            // Stopping ends a take, as Live's Stop does.
            let take = self.end_take(&e);
            e.stop()?;
            take?;
        }
        Ok(json!({ "ok": true }))
    }

    /// Record the armed audio track's input while the song plays (`true`), or end the take (`false`). The take is
    /// saved as `Samples/Recorded/<track> <n>.wav` beside the song, and `mobius:music-take` says where it goes:
    /// `{ track, file, start (beat), offset (seconds into the file at that beat), seconds, lost }`.
    fn record(&self, on: bool) -> Result<Value, String> {
        let engine = self.engine()?;
        if !on {
            let take = self.end_take(&engine)?;
            return Ok(json!({ "ok": true, "take": take }));
        }
        let armed = lock(&self.armed).clone().ok_or("Arm an audio track to record on.")?;
        let name = {
            let song = lock(&self.song);
            let track = song.as_ref().and_then(|s| s.tracks.iter().find(|t| t.id == armed)).filter(|t| Song::is_audio(t)).ok_or("Arm an audio track to record on.")?;
            track.name.clone().unwrap_or_else(|| "Audio".to_owned())
        };
        let folder = lock(&self.folder).clone().ok_or("Open the song before recording, so the take is saved beside it.")?;
        let (file, relative) = mobius_audio::record::next_take(&folder, &name)?;
        engine.start_take(&file)?;
        *lock(&self.recording) = Some(armed);
        Ok(json!({ "ok": true, "file": relative }))
    }

    /// Ends the take being recorded, if any, and tells the window where it goes.
    fn end_take(&self, engine: &Engine) -> Result<Value, String> {
        let Some(track) = lock(&self.recording).take() else { return Ok(Value::Null) };
        let Some(take) = engine.end_take()? else { return Ok(Value::Null) };
        let folder = lock(&self.folder).clone().unwrap_or_default();
        let file = take.written.file.strip_prefix(&folder).map_or_else(|_| take.written.file.to_string_lossy().into_owned(), |p| p.to_string_lossy().replace('\\', "/"));
        let value = json!({
            "track": track,
            "file": file,
            "start": take.beat,
            "offset": take.offset,
            "seconds": take.written.frames as f64 / f64::from(take.written.rate),
            "lost": take.lost,
        });
        (self.emit)("mobius:music-take", value.clone());
        Ok(value)
    }

    /// Move the playhead. Playing goes on from there; stopped, the next `play` starts there.
    fn seek(&self, beat: f64) -> Result<Value, String> {
        *lock(&self.start) = beat;
        let engine = lock(&self.engine).clone();
        if let Some(e) = engine {
            if e.position().playing && !lock(&self.how).session {
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
            Some(e) => {
                let mut p = position_json(e);
                p["inputFrames"] = json!(e.input_frames());
                p
            }
            None => json!({ "playing": false, "beat": *lock(&self.start), "meters": {} }),
        }
    }

    /// Send the position while playing or while a preview or count-in sounds, from one thread at a time; the last one
    /// says it stopped.
    fn report(&self, engine: Arc<Engine>) {
        report(&self.reporting, &self.emit, engine);
    }

    /// Render the song to WAV with this engine and save it in Exports beside the song's other exports.
    /// The song's stems (Live 12 manual, 5.1.3.1 "Selection Options", All Individual Tracks): each heard track's and
    /// each return's post-fader sound, and Main, as 32-bit float WAVs of the same length in a new folder
    /// `Exports/<name> stems`. A track that makes no sound has no file, as in Live.
    fn render_stems(&self, value: &Value, path: &str, name: &str, songs: &mobius_workspace::notes::Notes) -> Result<Value, String> {
        use mobius_audio::render::{song_frames, Renderer, MAX_BLOCK};
        let song = match value {
            Value::Null => lock(&self.song).clone().ok_or("load a song first")?,
            v => {
                let mut song = song_of(v)?;
                self.attach(&mut song, Some(path), songs);
                song
            }
        };
        songs.folder_of(path)?;
        let exports = songs.exports()?;
        let stem = mobius_audio::record::file_stem(name.strip_suffix(".wav").unwrap_or(name), "Untitled");
        // A folder of its own, never over one there.
        let (folder_name, folder) = (1u32..)
            .map(|n| if n == 1 { format!("{stem} stems") } else { format!("{stem} stems {n}") })
            .map(|f| (f.clone(), exports.join(f)))
            .find(|(_, f)| std::fs::create_dir(f).is_ok())
            .ok_or("The stems folder could not be made.")?;
        let mut renderer = Renderer::new(&song, RENDER_RATE, 0.0).with_stems();
        // Each stem's name: a track's own (or its id), a return's letter as Live names them, then Main.
        let mut names: Vec<String> = Vec::new();
        let mut returns = 0u8;
        for id in renderer.track_ids() {
            let label = match song.tracks.iter().find(|t| t.id == id) {
                Some(t) => t.name.clone().unwrap_or_else(|| id.to_owned()),
                None => {
                    returns += 1;
                    format!("Return {}", char::from(b'A' + (returns - 1) % 26))
                }
            };
            let mut file = format!("{}.wav", mobius_audio::record::file_stem(&label, "Track"));
            let mut n = 2;
            while names.contains(&file) || file == "Main.wav" {
                file = format!("{} {n}.wav", mobius_audio::record::file_stem(&label, "Track"));
                n += 1;
            }
            names.push(file);
        }
        names.push("Main.wav".to_owned());
        let mut writers = Vec::with_capacity(names.len());
        for file in &names {
            let out = std::fs::OpenOptions::new().write(true).create_new(true).open(folder.join(file)).map_err(|e| format!("A stem could not be saved: {e}"))?;
            writers.push(mobius_audio::wav::Writer::new(std::io::BufWriter::new(out), RENDER_RATE).map_err(|e| e.to_string())?);
        }
        let mut peaks = vec![0f32; names.len()];
        let (mut left, mut right, mut both) = (vec![0f32; MAX_BLOCK], vec![0f32; MAX_BLOCK], vec![0f32; MAX_BLOCK * 2]);
        let total = song_frames(&song, RENDER_RATE);
        let mut done = 0;
        while done < total {
            let n = (total - done).min(MAX_BLOCK);
            renderer.render(&mut left[..n], &mut right[..n]);
            let main = std::iter::once((&left[..n], &right[..n]));
            for (k, (l, r)) in renderer.stems(n).chain(main).enumerate() {
                for i in 0..n {
                    both[i * 2] = l[i];
                    both[i * 2 + 1] = r[i];
                    peaks[k] = peaks[k].max(l[i].abs()).max(r[i].abs());
                }
                writers[k].write(&both[..n * 2]).map_err(|e| e.to_string())?;
            }
            done += n;
        }
        let mut files = Vec::new();
        for ((writer, file), peak) in writers.into_iter().zip(&names).zip(&peaks) {
            writer.finish().map_err(|e| e.to_string())?;
            if *peak == 0.0 && file != "Main.wav" {
                // Made just now, by this render: a silent track has no stem.
                let _ = std::fs::remove_file(folder.join(file));
            } else {
                files.push(json!({ "file": file, "peakDb": db_of(*peak), "over": *peak > 1.0 }));
            }
        }
        Ok(json!({ "ok": true, "path": path, "saved": format!("{}/{folder_name}", mobius_workspace::notes::EXPORTS), "files": files }))
    }

    /// Renders track `id` of the song (its instrument, clips and effects, at full volume in the middle, from the song's
    /// start to its end and tail) into `Samples/Processed/Freeze/<track> Freeze.wav` in the song's folder, numbered if
    /// taken, as Live keeps freeze files, and each of its Session clips, two times round (38.1.4), into
    /// `<track> Freeze Clip <n>.wav`. The window then marks the track `frozen: { file, slots }`, `slots` by slot (null
    /// for an empty one); unfreezing drops it.
    fn freeze(&self, value: &Value, path: &str, id: &str, songs: &mobius_workspace::notes::Notes) -> Result<Value, String> {
        let song = match value {
            Value::Null => lock(&self.song).clone().ok_or("load a song first")?,
            v => {
                let mut song = song_of(v)?;
                self.attach(&mut song, Some(path), songs);
                song
            }
        };
        let alone = song.for_freezing(id).ok_or_else(|| format!("No track \"{id}\" in the song."))?;
        let track = &alone.tracks[0];
        let name = mobius_audio::record::file_stem(track.name.as_deref().unwrap_or(id), "Track");
        let dir = songs.folder_of(path)?.join("Samples").join("Processed").join("Freeze");
        std::fs::create_dir_all(&dir).map_err(|e| format!("The Freeze folder could not be made: {e}"))?;
        let (left, right) = mobius_audio::render::render_song(&alone, RENDER_RATE);
        let file = write_new(&dir, &format!("{name} Freeze"), &left, &right)?;
        let mut slots = Vec::new();
        for k in 0..track.slots.len() {
            let (left, right) = mobius_audio::render::render_slot(&alone, k, RENDER_RATE);
            slots.push(if left.is_empty() { Value::Null } else { Value::from(format!("Samples/Processed/Freeze/{}", write_new(&dir, &format!("{name} Freeze Clip {}", k + 1), &left, &right)?)) });
        }
        Ok(json!({ "ok": true, "file": format!("Samples/Processed/Freeze/{file}"), "slots": slots }))
    }

    fn render(&self, value: &Value, path: &str, name: &str, songs: &mobius_workspace::notes::Notes) -> Result<Value, String> {
        let song = match value {
            Value::Null => lock(&self.song).clone().ok_or("load a song first")?,
            v => {
                let mut song = song_of(v)?;
                self.attach(&mut song, Some(path), songs);
                song
            }
        };
        let (left, right) = mobius_audio::render::render_song(&song, RENDER_RATE);
        let mut bytes = Vec::with_capacity(left.len() * 8 + 64);
        mobius_audio::wav::write(&mut bytes, &left, &right, RENDER_RATE).map_err(|e| e.to_string())?;
        let mut saved = songs.save_sound_bytes(path, name, &bytes)?;
        // The file is 32-bit float, so nothing over 0 dB is clipped or wrapped; the window is told how loud it got,
        // so it can say when a file will clip once it is made into 16 or 24-bit.
        let (peak, over) = peak_of(&left, &right);
        saved["peakDb"] = json!(peak);
        saved["over"] = json!(over);
        Ok(saved)
    }
}

/// Sends the position about 30 times a second while it plays or sounds, on a thread of its own (one at a time).
fn report(reporting: &Arc<AtomicBool>, emit: &crate::bridge::Emit, engine: Arc<Engine>) {
    if reporting.swap(true, Ordering::AcqRel) {
        return;
    }
    let done = reporting.clone();
    let emit = emit.clone();
    let spawned = std::thread::Builder::new().name("mobius-music-position".into()).spawn(move || {
        // The first report can come before the audio thread has taken the song: give it a moment to start.
        let mut grace = 10;
        loop {
            std::thread::sleep(POSITION_EVERY);
            let position = engine.position();
            let playing = position.playing || position.sounding;
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
        done.store(false, Ordering::Release);
    });
    if spawned.is_err() {
        reporting.store(false, Ordering::Release);
    }
}

/// The loudest sample of a render in dBFS (-120 for silence), and how many samples go over 0 dBFS.
/// A level in dB, at least -120.
fn db_of(peak: f32) -> f64 {
    (20.0 * f64::from(peak).max(1e-6).log10()).max(-120.0)
}

fn peak_of(left: &[f32], right: &[f32]) -> (f64, usize) {
    let peak = left.iter().chain(right).fold(0f32, |p, s| p.max(s.abs()));
    let over = left.iter().chain(right).filter(|s| s.abs() > 1.0).count();
    ((20.0 * f64::from(peak).max(1e-6).log10()).max(-120.0), over)
}

/// A slot the window sent: a number, or null to stop. `None` when it is neither.
fn slot_of(value: &Value) -> Option<Option<usize>> {
    match value {
        Value::Null => Some(None),
        v => v.as_u64().and_then(|n| usize::try_from(n).ok()).map(Some),
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
    // The Workbench's open effect: each part's level, keyed `track/fx/part`.
    let levels: serde_json::Map<String, Value> = p.levels.iter().map(|(key, db)| (key.clone(), json!(db))).collect();
    // The Session view: each track's slot playing and the beat it started on, and the launch waiting (a slot, or
    // "stop"; null when none waits).
    let session: serde_json::Map<String, Value> = p
        .session
        .iter()
        .map(|(id, s)| (id.clone(), json!({ "slot": s.playing.map(|(slot, _)| slot), "start": s.playing.map(|(_, b)| b), "queued": s.queued.map(|q| q.map_or_else(|| json!("stop"), |n| json!(n))) })))
        .collect();
    if session.is_empty() {
        json!({ "playing": p.playing, "sounding": p.sounding, "beat": p.beat, "meters": meters, "levels": levels })
    } else {
        json!({ "playing": p.playing, "sounding": p.sounding, "beat": p.beat, "meters": meters, "levels": levels, "session": session })
    }
}

/// Writes a WAV of `left` and `right` into `dir` as `<stem>.wav`, or `<stem> 2.wav` and so on when that is taken, and
/// gives its name.
fn write_new(dir: &std::path::Path, stem: &str, left: &[f32], right: &[f32]) -> Result<String, String> {
    let mut bytes = Vec::with_capacity(left.len() * 8 + 64);
    mobius_audio::wav::write(&mut bytes, left, right, RENDER_RATE).map_err(|e| e.to_string())?;
    for n in 1u32.. {
        let file = if n == 1 { format!("{stem}.wav") } else { format!("{stem} {n}.wav") };
        match std::fs::OpenOptions::new().write(true).create_new(true).open(dir.join(&file)) {
            Ok(mut out) => {
                std::io::Write::write_all(&mut out, &bytes).map_err(|e| format!("The track could not be frozen: {e}"))?;
                return Ok(file);
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(e) => return Err(format!("The track could not be frozen: {e}")),
        }
    }
    Err("The track could not be frozen.".into())
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
    fn a_render_says_how_loud_it_got() {
        let (peak, over) = peak_of(&[0.5, -1.5], &[1.0, 0.0]);
        assert!((peak - 3.5218).abs() < 1e-3);
        assert_eq!(over, 1);
        assert_eq!(peak_of(&[0.0], &[0.0]), (-120.0, 0));
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
        if cfg!(not(any(windows, target_os = "macos"))) {
            // No output here: the engine plays silently, and says so.
            let engine = m.call("engine", &[], &songs);
            assert!(engine["ok"] == true && engine["silent"] == true, "{engine}");
            // A Library sound is heard on no track; a track's needs a song.
            assert_eq!(m.call("preview", &[json!({ "instrument": "piano" }), json!(60)], &songs)["ok"], true);
            assert_eq!(m.call("preview", &[json!("keys"), json!(60)], &songs)["ok"], false);
            assert_eq!(m.call("play", &[], &songs)["ok"], false);
        }
    }

    #[test]
    fn a_songs_audio_clips_are_read_from_its_folder() {
        let m = music();
        let dir = tempfile::tempdir().unwrap();
        let songs = mobius_workspace::notes::Notes::in_folder(dir.path().join("w"), dir.path().join("c"), "studio");
        let folder = dir.path().join("w/studio/Songs");
        std::fs::create_dir_all(folder.join("Samples/Recorded")).unwrap();
        std::fs::write(folder.join("Song.md"), SONG).unwrap();
        let mut wav = Vec::new();
        mobius_audio::wav::write(&mut wav, &[0.5; 4], &[0.5; 4], 48_000).unwrap();
        std::fs::write(folder.join("Samples/Recorded/Vocal 1.wav"), wav).unwrap();
        let song = json!({ "version": 2, "tempo": 120, "bars": 1, "tracks": [{ "id": "v", "kind": "audio", "clips": [
            { "start": 0, "length": 4, "audio": { "file": "Samples/Recorded/Vocal 1.wav" } },
            { "start": 0, "length": 4, "audio": { "file": "Samples/Recorded/Vocal 2.wav" } }] }] });
        let loaded = m.call("load", &[song.clone(), json!("Songs/Song.md")], &songs);
        assert_eq!(loaded["ok"], true, "{loaded}");
        assert_eq!(loaded["missing"].as_array().unwrap().len(), 1, "{loaded}");
        assert_eq!(lock(&m.song).as_ref().unwrap().sounds.len(), 1);
        // Its waveform, for the clip to draw; a file outside the song's folder is refused.
        let peaks = m.call("peaks", &[json!("Songs/Song.md"), json!("Samples/Recorded/Vocal 1.wav"), json!(2)], &songs);
        assert_eq!(peaks["peaks"], json!([[0.5, 0.5], [0.5, 0.5]]), "{peaks}");
        assert_eq!(m.call("peaks", &[json!("Songs/Song.md"), json!("../../x.wav")], &songs)["ok"], false);
        // Without the song's page, no files are read.
        assert_eq!(m.call("load", &[song], &songs)["missing"], json!([]));
        assert!(lock(&m.song).as_ref().unwrap().sounds.is_empty());
    }

    #[test]
    fn stems_are_each_heard_track_its_returns_and_main_in_a_folder_of_their_own() {
        let m = music();
        let dir = tempfile::tempdir().unwrap();
        let songs = mobius_workspace::notes::Notes::in_folder(dir.path().join("w"), dir.path().join("c"), "studio");
        let folder = dir.path().join("w/studio/Songs");
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::write(folder.join("Song.md"), SONG).unwrap();
        let song = json!({ "version": 2, "tempo": 120, "bars": 1, "returns": [{ "id": "r", "volume": 1 }], "tracks": [
            { "id": "a", "name": "Lead", "instrument": "lead", "sends": { "r": 0.5 }, "clips": [{ "id": "c", "start": 0, "length": 4, "notes": [{ "pitch": 60, "start": 0, "length": 1, "velocity": 1 }] }] },
            { "id": "b", "name": "Lead", "instrument": "bass", "clips": [{ "id": "c", "start": 0, "length": 4, "notes": [{ "pitch": 40, "start": 0, "length": 1, "velocity": 1 }] }] },
            { "id": "q", "name": "Quiet", "instrument": "piano" }] });
        let made = m.call("renderStems", &[json!("Songs/Song.md"), json!("Song.wav"), song.clone()], &songs);
        assert_eq!(made["saved"], "Exports/Song stems", "{made}");
        let files: Vec<&str> = made["files"].as_array().unwrap().iter().map(|f| f["file"].as_str().unwrap()).collect();
        // The silent track has no stem; two tracks of one name are numbered.
        assert_eq!(files, ["Lead.wav", "Lead 2.wav", "Return A.wav", "Main.wav"]);
        let read = |f: &str| mobius_audio::wav::read(&std::fs::read(dir.path().join("w/Exports/Song stems").join(f)).unwrap()).unwrap();
        let (lead, main) = (read("Lead.wav"), read("Main.wav"));
        assert_eq!(lead.left.len(), main.left.len());
        assert!(lead.left.iter().any(|s| s.abs() > 0.01));
        // Again, into a new folder rather than over the first.
        assert_eq!(m.call("renderStems", &[json!("Songs/Song.md"), json!("Song.wav"), song], &songs)["saved"], "Exports/Song stems 2");
    }

    #[test]
    fn a_frozen_track_is_rendered_beside_the_song_and_played_from_its_file() {
        let m = music();
        let dir = tempfile::tempdir().unwrap();
        let songs = mobius_workspace::notes::Notes::in_folder(dir.path().join("w"), dir.path().join("c"), "studio");
        let folder = dir.path().join("w/studio/Songs");
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::write(folder.join("Song.md"), SONG).unwrap();
        let mut song = json!({ "version": 2, "tempo": 120, "bars": 1, "tracks": [
            { "id": "a", "name": "Lead", "instrument": "lead", "clips": [{ "id": "c", "start": 0, "length": 4, "notes": [{ "pitch": 60, "start": 0, "length": 1, "velocity": 1 }] }],
              "slots": [null, { "bars": 1, "notes": [{ "pitch": 64, "start": 0, "length": 1, "velocity": 1 }] }] }] });
        let frozen = m.call("freeze", &[json!("Songs/Song.md"), json!("a"), song.clone()], &songs);
        assert_eq!(frozen["file"], "Samples/Processed/Freeze/Lead Freeze.wav", "{frozen}");
        // Each Session clip, two times round (38.1.4).
        assert_eq!(frozen["slots"], json!([null, "Samples/Processed/Freeze/Lead Freeze Clip 2.wav"]));
        let clip = mobius_audio::wav::read(&std::fs::read(folder.join("Samples/Processed/Freeze/Lead Freeze Clip 2.wav")).unwrap()).unwrap();
        assert_eq!(clip.left.len(), (4.0 * f64::from(RENDER_RATE)) as usize);
        assert_eq!(m.call("freeze", &[json!("Songs/Song.md"), json!("a"), song.clone()], &songs)["file"], "Samples/Processed/Freeze/Lead Freeze 2.wav");
        assert_eq!(m.call("freeze", &[json!("Songs/Song.md"), json!("nope"), song.clone()], &songs)["ok"], false);
        song["tracks"][0]["frozen"] = json!({ "file": "Samples/Processed/Freeze/Lead Freeze.wav", "slots": frozen["slots"] });
        let loaded = m.call("load", &[song, json!("Songs/Song.md")], &songs);
        assert_eq!(loaded["missing"], json!([]), "{loaded}");
        assert_eq!(lock(&m.song).as_ref().unwrap().sounds.len(), 2);
    }

    #[test]
    fn a_sound_brought_to_a_song_is_saved_in_its_samples_and_its_sampler_reads_it() {
        use base64::Engine as _;
        let m = music();
        let dir = tempfile::tempdir().unwrap();
        let songs = mobius_workspace::notes::Notes::in_folder(dir.path().join("w"), dir.path().join("c"), "studio");
        let folder = dir.path().join("w/studio/Songs");
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::write(folder.join("Song.md"), SONG).unwrap();
        let mut wav = Vec::new();
        mobius_audio::wav::write(&mut wav, &[0.5; 4], &[0.5; 4], 48_000).unwrap();
        let data = base64::engine::general_purpose::STANDARD.encode(&wav);
        let saved = m.call("importSample", &[json!("Songs/Song.md"), json!("Kick.wav"), json!(data)], &songs);
        assert_eq!(saved["file"], "Samples/Kick.wav", "{saved}");
        assert_eq!(m.call("importSample", &[json!("Songs/Song.md"), json!("x.wav"), json!("aGVsbG8=")], &songs)["ok"], false);
        assert_eq!(m.call("samples", &[json!("Songs/Song.md")], &songs)["files"], json!(["Samples/Kick.wav"]));
        // A sampler track and a pad that name it have it read.
        let song = json!({ "version": 2, "tempo": 120, "bars": 1, "tracks": [
            { "id": "s", "kind": "sampler", "sampler": { "file": "Samples/Kick.wav" } },
            { "id": "d", "instrument": "drums", "pads": { "36": { "tune": 0, "decay": 1, "level": 1, "pan": 0, "sample": { "file": "Samples/Kick.wav" } } } }] });
        let loaded = m.call("load", &[song, json!("Songs/Song.md")], &songs);
        assert_eq!(loaded["missing"], json!([]), "{loaded}");
        assert_eq!(lock(&m.song).as_ref().unwrap().sounds.len(), 1);
    }

    #[test]
    fn recording_needs_an_armed_audio_track_and_ending_none_is_fine() {
        let m = music();
        let dir = tempfile::tempdir().unwrap();
        let songs = mobius_workspace::notes::Notes::in_folder(dir.path().join("w"), dir.path().join("c"), "studio");
        assert_eq!(m.call("record", &[json!(false)], &songs)["take"], Value::Null);
        assert_eq!(m.call("record", &[json!(true)], &songs)["ok"], false);
        m.call("load", &[json!({ "tempo": 120, "bars": 1, "tracks": [{ "id": "v", "kind": "audio" }, { "id": "k", "instrument": "piano" }] })], &songs);
        m.call("arm", &[json!("k")], &songs);
        assert_eq!(m.call("record", &[json!(true)], &songs)["ok"], false);
        let armed = m.call("arm", &[json!("v")], &songs);
        assert_eq!(armed["ok"], true, "{armed}");
        // Inputs to choose from (none here off Windows and macOS); choosing one re-arms the armed track.
        assert!(m.call("inputs", &[], &songs)["inputs"].is_array());
        assert_eq!(m.call("useInput", &[json!("USB Mic")], &songs)["ok"], true);
        assert_eq!(m.call("inputs", &[], &songs)["using"], "USB Mic");
        m.call("useInput", &[Value::Null], &songs);
        // No song folder yet: nowhere to save the take.
        assert_eq!(m.call("record", &[json!(true)], &songs)["ok"], false);
        if cfg!(not(any(windows, target_os = "macos"))) {
            assert!(armed["inputProblem"].is_string(), "{armed}");
        }
    }
}
