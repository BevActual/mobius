//! Live playback: the song rendered on the audio thread of the computer's sound output.
//!
//! The audio thread only renders. Everything it is given is made beforehand on the caller's side and handed over
//! through a wait-free queue ([`rtrb`]): a [`Renderer`] for the song from a beat, or Stop. What it lets go of comes
//! back through a second queue to be dropped here, so the audio thread neither allocates nor frees. Its position and
//! the levels go the other way as atomics, read whenever the window asks (about 30 times a second).

// The audio side is driven by the Windows output device; elsewhere only the tests use it.
#![cfg_attr(not(windows), allow(dead_code))]

use crate::render::{Oneshot, Oneshots, Playing, Renderer, SessionState, MAX_BLOCK};
use crate::song::Song;
use std::sync::atomic::{AtomicBool, AtomicI32, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, PoisonError};

/// The most tracks whose levels are reported; the master's comes after them.
pub const MAX_METERS: usize = 128;

// Carried by value through a fixed ring: boxing the big variant would free memory on the audio thread.
#[allow(clippy::large_enum_variant)]
pub(crate) enum Command {
    /// Play this from where it starts, taking over what the one before it still has sounding.
    Play(Box<Renderer>),
    Stop,
    /// In the Session view: start a track's clip in a slot (or stop it) at the next bar line.
    Launch(usize, Option<usize>),
    /// A sound apart from the song: a note heard as it is played or put in, or a count-in.
    Oneshot(Oneshot),
    /// A key pressed or lifted on a keyboard at this moment: placed a block after it, so every note is late by the
    /// same amount and none jitters with where in a block it came.
    Played(Oneshot, std::time::Instant),
}

/// What the audio thread reports.
pub(crate) struct Shared {
    playing: AtomicBool,
    /// A note preview or count-in is sounding (with the transport stopped or not).
    sounding: AtomicBool,
    /// The beat it has reached, as f64 bits.
    beat: AtomicU64,
    /// Each track's level and then the master's, left and right, as f32 bits.
    peaks: Vec<(AtomicU32, AtomicU32)>,
    /// How many of `peaks` are tracks.
    tracks: AtomicU32,
    /// From the audio being made to it being heard, in microseconds.
    latency_us: AtomicU64,
    /// In the Session view, each track's slot playing (-1 for none), the beat it started on (f64 bits), and the
    /// launch waiting (`NO_LAUNCH` for none, -1 to stop).
    session: Vec<(AtomicI32, AtomicU64, AtomicI32)>,
    /// The effect the Workbench has open: its lane (-1 for none), its [`crate::fx::fx_key`], and a count that moves on
    /// each time it changes. Then each of its parts' level in dB, as f64 bits (NaN for none yet).
    watch_lane: AtomicI32,
    watch_key: AtomicU64,
    watch_turn: AtomicU32,
    parts: Vec<AtomicU64>,
}

/// The most parts of a device (as `Device::new` takes).
const MAX_PARTS: usize = 24;

const NO_LAUNCH: i32 = i32::MIN;

impl Shared {
    fn new() -> Shared {
        Shared {
            playing: AtomicBool::new(false),
            sounding: AtomicBool::new(false),
            beat: AtomicU64::new(0),
            peaks: (0..=MAX_METERS).map(|_| (AtomicU32::new(0), AtomicU32::new(0))).collect(),
            tracks: AtomicU32::new(0),
            latency_us: AtomicU64::new(0),
            session: (0..MAX_METERS).map(|_| (AtomicI32::new(-1), AtomicU64::new(0), AtomicI32::new(NO_LAUNCH))).collect(),
            watch_lane: AtomicI32::new(-1),
            watch_key: AtomicU64::new(0),
            watch_turn: AtomicU32::new(0),
            parts: (0..MAX_PARTS).map(|_| AtomicU64::new(f64::NAN.to_bits())).collect(),
        }
    }
}

/// The audio thread's side: what it plays, and where it hands things back.
pub(crate) struct AudioSide {
    commands: rtrb::Consumer<Command>,
    trash: rtrb::Producer<Box<Renderer>>,
    shared: Arc<Shared>,
    playing: Option<Box<Renderer>>,
    oneshots: Oneshots,
    rate: f64,
    /// The `watch_turn` last seen.
    watch_turn: u32,
    left: Vec<f32>,
    right: Vec<f32>,
}

impl AudioSide {
    /// Fills an interleaved buffer of `channels` channels: the left and right, and silence on any others.
    pub(crate) fn fill(&mut self, data: &mut [f32], channels: usize) {
        self.fill_at(data, channels, std::time::Instant::now());
    }

    /// As [`AudioSide::fill`], with the block made at `now`.
    pub(crate) fn fill_at(&mut self, data: &mut [f32], channels: usize, now: std::time::Instant) {
        let frames = data.len() / channels.max(1);
        while let Ok(command) = self.commands.pop() {
            match command {
                Command::Play(mut next) => {
                    if let Some(mut old) = self.playing.take() {
                        next.adopt(&mut old);
                        self.let_go(old);
                    }
                    self.playing = Some(next);
                }
                Command::Launch(track, slot) => {
                    if let Some(renderer) = self.playing.as_mut() {
                        renderer.launch(track, slot);
                    }
                }
                Command::Oneshot(shot) => self.oneshots.start(shot, self.rate),
                Command::Played(shot, at) => {
                    let wait = place(at, now, frames, self.rate);
                    let shot = match shot {
                        Oneshot::Press { key, voice, gains, .. } => Oneshot::Press { key, voice, gains, wait },
                        Oneshot::Lift { key, .. } => Oneshot::Lift { key, wait },
                        Oneshot::Hit(hit, gains) => Oneshot::Hit(hit.waiting(wait), gains),
                        other => other,
                    };
                    self.oneshots.start(shot, self.rate);
                }
                Command::Stop => {
                    if let Some(old) = self.playing.take() {
                        self.let_go(old);
                    }
                }
            }
        }
        let channels = channels.max(1);
        // Played to the end and rung out: let it go.
        if self.playing.as_ref().is_some_and(|r| r.finished()) {
            if let Some(old) = self.playing.take() {
                self.let_go(old);
            }
        }
        if self.playing.is_none() && !self.oneshots.busy() {
            data.fill(0.0);
            self.shared.playing.store(false, Ordering::Release);
            if self.shared.sounding.swap(false, Ordering::AcqRel) {
                // What was sounding has ended: the master falls silent.
                self.shared.tracks.store(0, Ordering::Relaxed);
                self.shared.peaks[0].0.store(0, Ordering::Relaxed);
                self.shared.peaks[0].1.store(0, Ordering::Relaxed);
            }
            return;
        }
        let (mut peak_l, mut peak_r) = (0.0f32, 0.0f32);
        let watch = self.watching();
        if let Some(renderer) = self.playing.as_mut() {
            renderer.watch(watch);
        }
        for frames in data.chunks_mut(MAX_BLOCK * channels) {
            let n = frames.len() / channels;
            let (left, right) = (&mut self.left[..n], &mut self.right[..n]);
            match self.playing.as_mut() {
                Some(renderer) => renderer.render(left, right),
                None => {
                    left.fill(0.0);
                    right.fill(0.0);
                }
            }
            self.oneshots.add_to(left, right, self.rate);
            peak_l = left.iter().fold(peak_l, |p, x| p.max(x.abs()));
            peak_r = right.iter().fold(peak_r, |p, x| p.max(x.abs()));
            for (i, frame) in frames.chunks_mut(channels).enumerate() {
                for (c, out) in frame.iter_mut().enumerate() {
                    *out = match c {
                        0 => left[i],
                        1 => right[i],
                        _ => 0.0,
                    };
                }
            }
        }
        self.shared.sounding.store(self.oneshots.busy(), Ordering::Release);
        let Some(renderer) = self.playing.as_mut() else {
            // Stopped, with a preview or count-in sounding: no tracks, and the master is what is heard.
            self.shared.tracks.store(0, Ordering::Relaxed);
            self.shared.peaks[0].0.store(peak_l.to_bits(), Ordering::Relaxed);
            self.shared.peaks[0].1.store(peak_r.to_bits(), Ordering::Relaxed);
            self.shared.playing.store(false, Ordering::Release);
            return;
        };
        let shared = &self.shared;
        let mut count = 0u32;
        for (slot, (l, r)) in shared.peaks.iter().zip(renderer.peaks()) {
            slot.0.store(l.to_bits(), Ordering::Relaxed);
            slot.1.store(r.to_bits(), Ordering::Relaxed);
            count += 1;
        }
        shared.tracks.store(count.saturating_sub(1), Ordering::Relaxed);
        if let Some((lane, _)) = watch {
            renderer.part_levels(lane, |i, db| {
                if let Some(slot) = shared.parts.get(i) {
                    slot.store(db.to_bits(), Ordering::Relaxed);
                }
            });
        }
        for (slot, (_, state)) in shared.session.iter().zip(renderer.session()) {
            let as_i32 = |n: usize| i32::try_from(n).unwrap_or(i32::MAX);
            slot.0.store(state.playing.map_or(-1, |(s, _)| as_i32(s)), Ordering::Relaxed);
            slot.1.store(state.playing.map_or(0.0, |(_, b)| b).to_bits(), Ordering::Relaxed);
            slot.2.store(state.queued.map_or(NO_LAUNCH, |q| q.map_or(-1, as_i32)), Ordering::Relaxed);
        }
        shared.beat.store(renderer.beat().to_bits(), Ordering::Release);
        // At the song's end it says it has stopped, while what is ringing rings out.
        shared.playing.store(!renderer.past_end(), Ordering::Release);
    }

    /// The effect to listen to: its lane and key. When it has changed, the levels of the last one are cleared.
    fn watching(&mut self) -> Option<(usize, u64)> {
        let shared = &self.shared;
        let turn = shared.watch_turn.load(Ordering::Acquire);
        if turn != self.watch_turn {
            self.watch_turn = turn;
            for slot in &shared.parts {
                slot.store(f64::NAN.to_bits(), Ordering::Relaxed);
            }
        }
        let lane = usize::try_from(shared.watch_lane.load(Ordering::Acquire)).ok()?;
        Some((lane, shared.watch_key.load(Ordering::Acquire)))
    }

    fn let_go(&mut self, old: Box<Renderer>) {
        // If the queue back is full (nobody has emptied it for a long while) it is dropped here instead.
        let _ = self.trash.push(old);
    }
}

/// A note of a track, made on the caller's side: a drum through its kit and pad, anything else through its sound.
// Made and taken apart at once on the caller's side, never stored.
#[allow(clippy::large_enum_variant)]
enum Note {
    Hit(crate::drum::Hit, crate::render::Gains),
    Voice(crate::voice::Voice, crate::render::Gains),
}

fn note_of(track: &crate::song::Track, pitch: u8, velocity: f64, seconds: f64) -> Note {
    // Heard at the track's volume and pan, as its notes are when it plays.
    let gains = crate::render::track_gains(track);
    if track.instrument == crate::song::Instrument::Drums {
        let pad = track.pads.get(&pitch.to_string()).copied().unwrap_or_default();
        Note::Hit(crate::drum::Hit::new(pitch, velocity, track.kit.unwrap_or_default(), pad, u32::from(pitch).wrapping_mul(2_654_435_761)), gains)
    } else {
        Note::Voice(match &track.sound {
            Some(sound) => crate::voice::Voice::new(track.instrument, sound, pitch, seconds, velocity),
            None => crate::voice::Voice::legacy(track.instrument, pitch, seconds, velocity),
        }, gains)
    }
}

// The host shares one engine between its threads, keyboard and all.
const _: fn() = || {
    fn shared<T: Send + Sync>() {}
    shared::<Engine>();
};

/// The way into the engine that a keyboard plays through, from whichever thread its notes arrive on.
#[derive(Clone)]
pub(crate) struct Keys {
    commands: Arc<Mutex<rtrb::Producer<Command>>>,
    /// The track a keyboard plays.
    armed: Arc<Mutex<Option<crate::song::Track>>>,
}

impl Keys {
    fn send(&self, command: Command) -> Result<(), String> {
        lock(&self.commands).push(command).map_err(|_| "The sound engine is not answering.".to_owned())
    }

    /// `pitch` pressed `at` on the armed track (nothing when none is armed).
    pub(crate) fn press(&self, pitch: u8, velocity: f64, at: std::time::Instant) -> Result<(), String> {
        let note = match lock(&self.armed).as_ref() {
            Some(track) => note_of(track, pitch, velocity.clamp(0.0, 1.0), crate::voice::HELD_SECONDS),
            None => return Ok(()),
        };
        let shot = match note {
            Note::Hit(hit, gains) => Oneshot::Hit(hit, gains),
            Note::Voice(voice, gains) => Oneshot::Press { key: pitch, voice, gains, wait: 0 },
        };
        self.send(Command::Played(shot, at))
    }

    /// `pitch` lifted `at`.
    pub(crate) fn lift(&self, pitch: u8, at: std::time::Instant) -> Result<(), String> {
        self.send(Command::Played(Oneshot::Lift { key: pitch, wait: 0 }, at))
    }
}

/// Where in a block of `frames` made at `now` something that happened `at` goes: one block after it happened, as a
/// count of samples into the block (the block's start if that has already gone by).
fn place(at: std::time::Instant, now: std::time::Instant, frames: usize, rate: f64) -> usize {
    let block = frames as f64 / rate;
    let ago = now.saturating_duration_since(at).as_secs_f64();
    (((block - ago) * rate).round().max(0.0) as usize).min(frames.saturating_sub(1))
}

/// The caller's side of a live engine. Made by [`Engine::open`]; the stream plays until this is dropped.
pub struct Engine {
    keys: Keys,
    /// The keyboard listened to, if any.
    midi: Mutex<Option<crate::midi::Input>>,
    trash: Mutex<rtrb::Consumer<Box<Renderer>>>,
    shared: Arc<Shared>,
    /// The tracks whose levels `position` reports, in the order the audio thread has them.
    tracks: Mutex<Vec<String>>,
    /// In the Session view, every track's id, in the order launches name them.
    session: Mutex<Vec<String>>,
    /// How it was last asked to play: its loop and click carry on through a change to the song.
    how: Mutex<Playing>,
    /// The effect the Workbench has open: its track's id, its own id, and its parts' ids.
    watching: Mutex<Option<(String, String, Vec<String>)>>,
    sample_rate: u32,
    device: String,
    /// Dropped to end the stream.
    _stream: Option<std::sync::mpsc::Sender<()>>,
}

/// Where playback is.
#[derive(Debug, Clone, PartialEq)]
pub struct Position {
    pub playing: bool,
    /// A note preview or count-in is sounding. Stopped, `meters` then holds only `"master"`.
    pub sounding: bool,
    pub beat: f64,
    /// Each track's level, left and right in dB, then `"master"`'s.
    pub meters: Vec<(String, [f64; 2])>,
    /// In the Session view, each track's id and what it is doing.
    pub session: Vec<(String, SessionState)>,
    /// While an effect is listened to ([`Engine::watch`]) and playing: each of its parts' level in dB, named
    /// `track/fx/part` as the Workbench asks for them.
    pub levels: Vec<(String, f64)>,
}

fn db(level: f32) -> f64 {
    (20.0 * f64::from(level).max(1e-6).log10()).max(-120.0)
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

impl Engine {
    /// The two sides of an engine at `sample_rate`, without a device: the audio side is driven by whoever has it
    /// (the device's callback, or a test).
    pub(crate) fn pair(sample_rate: u32, device: String) -> (Engine, AudioSide) {
        let (commands, consumer) = rtrb::RingBuffer::new(64);
        let (trash_in, trash) = rtrb::RingBuffer::new(64);
        let shared = Arc::new(Shared::new());
        let audio = AudioSide { commands: consumer, trash: trash_in, shared: Arc::clone(&shared), playing: None, oneshots: Oneshots::default(), rate: f64::from(sample_rate), watch_turn: 0, left: vec![0.0; MAX_BLOCK], right: vec![0.0; MAX_BLOCK] };
        let keys = Keys { commands: Arc::new(Mutex::new(commands)), armed: Arc::new(Mutex::new(None)) };
        let engine = Engine { keys, midi: Mutex::new(None), trash: Mutex::new(trash), shared, tracks: Mutex::new(Vec::new()), session: Mutex::new(Vec::new()), how: Mutex::new(Playing::default()), watching: Mutex::new(None), sample_rate, device, _stream: None };
        (engine, audio)
    }

    /// Opens the computer's default sound output and starts its stream (silent until something plays).
    ///
    /// # Errors
    /// When there is no output, or it cannot be opened.
    pub fn open() -> Result<Engine, String> {
        #[cfg(windows)]
        {
            device::open()
        }
        #[cfg(not(windows))]
        {
            Err("The sound engine plays on Windows only for now.".to_owned())
        }
    }

    /// The output's name.
    #[must_use]
    pub fn device(&self) -> &str {
        &self.device
    }

    #[must_use]
    pub fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    /// From the audio being made to it being heard, in milliseconds (0 until the stream has run).
    #[must_use]
    pub fn latency_ms(&self) -> f64 {
        self.shared.latency_us.load(Ordering::Relaxed) as f64 / 1000.0
    }

    /// Plays `song` as `how` says: from a beat, round a loop or to the end, with the metronome or not. Playing
    /// already, it changes to this at once, and notes still ringing carry on.
    ///
    /// # Errors
    /// When the audio thread has not taken the last commands (it has stopped running).
    pub fn play(&self, song: &Song, how: Playing) -> Result<(), String> {
        self.empty_trash();
        *lock(&self.how) = how;
        let renderer = Box::new(Renderer::playing(song, self.sample_rate, how));
        *lock(&self.tracks) = renderer.track_ids().map(str::to_owned).collect();
        *lock(&self.session) = renderer.session().map(|(id, _)| id.to_owned()).collect();
        self.aim(Some(song));
        self.send(Command::Play(renderer))
    }

    /// Plays the Session view from the first beat, with the clips in `launches` (track id, slot) starting at once.
    ///
    /// # Errors
    /// As [`Engine::play`].
    pub fn play_session(&self, song: &Song, click: bool, launches: &[(String, Option<usize>)]) -> Result<(), String> {
        self.empty_trash();
        let how = Playing { from: 0.0, cycle: None, click, session: true };
        *lock(&self.how) = how;
        let mut renderer = Box::new(Renderer::playing(song, self.sample_rate, how));
        let ids: Vec<String> = renderer.session().map(|(id, _)| id.to_owned()).collect();
        for (id, slot) in launches {
            if let Some(index) = ids.iter().position(|t| t == id) {
                renderer.launch(index, *slot);
            }
        }
        *lock(&self.tracks) = renderer.track_ids().map(str::to_owned).collect();
        *lock(&self.session) = ids;
        self.aim(Some(song));
        self.send(Command::Play(renderer))
    }

    /// In the Session view, starts a track's clip in `slot` (or stops the track, with `None`) at the next bar line.
    ///
    /// # Errors
    /// When the track is not in the song playing, or as [`Engine::play`].
    pub fn launch(&self, track: &str, slot: Option<usize>) -> Result<(), String> {
        let index = lock(&self.session).iter().position(|t| t == track).ok_or_else(|| format!("No track \"{track}\" is playing in Session."))?;
        self.send(Command::Launch(index, slot))
    }

    /// Sounds a note of `track` at once, playing or not, as the window does when a key is pressed or a note is put on
    /// the roll: its instrument and sound (a drum through its kit and pad), straight out, `seconds` long.
    ///
    /// # Errors
    /// As [`Engine::play`].
    pub fn preview(&self, track: &crate::song::Track, pitch: u8, velocity: f64, seconds: f64) -> Result<(), String> {
        let shot = match note_of(track, pitch, velocity, seconds) {
            Note::Hit(hit, gains) => Oneshot::Hit(hit, gains),
            Note::Voice(voice, gains) => Oneshot::Voice(voice, gains),
        };
        self.send(Command::Oneshot(shot))
    }

    /// Plays a keyboard on `track` (its instrument and sound, at its volume and pan), or on none.
    pub fn arm(&self, track: Option<&crate::song::Track>) {
        *lock(&self.keys.armed) = track.cloned();
    }

    /// A key pressed on the armed track: its note sounds until [`Engine::lift`] (a drum's hit rings out alone).
    ///
    /// # Errors
    /// As [`Engine::play`].
    pub fn press(&self, pitch: u8, velocity: f64) -> Result<(), String> {
        self.keys.press(pitch, velocity, std::time::Instant::now())
    }

    /// A key lifted: its note dies away over its release.
    ///
    /// # Errors
    /// As [`Engine::play`].
    pub fn lift(&self, pitch: u8) -> Result<(), String> {
        self.keys.lift(pitch, std::time::Instant::now())
    }

    /// Listens to the MIDI keyboard named `input` (as [`crate::midi::inputs`] names them), playing the armed track
    /// from it; or to none. Returns the name of the one now listened to.
    ///
    /// # Errors
    /// When there is no such keyboard, or it cannot be opened.
    pub fn listen(&self, input: Option<&str>) -> Result<Option<String>, String> {
        let mut midi = lock(&self.midi);
        // The last one is closed first: a keyboard opens for one listener at a time.
        *midi = None;
        let Some(name) = input else { return Ok(None) };
        let opened = crate::midi::Input::open(name, self.keys.clone())?;
        let name = opened.name().to_owned();
        *midi = Some(opened);
        Ok(Some(name))
    }

    /// The way a keyboard plays in, for tests below the MIDI driver.
    #[cfg(test)]
    pub(crate) fn keys(&self) -> Keys {
        self.keys.clone()
    }

    /// The keyboard listened to.
    #[must_use]
    pub fn listening(&self) -> Option<String> {
        lock(&self.midi).as_ref().map(|i| i.name().to_owned())
    }

    /// A count-in of `beats` ticks at `tempo`, a high one first, starting 50 ms from now (studio-audio.ts `countIn`).
    /// `None` for `beats` cuts one short.
    ///
    /// # Errors
    /// As [`Engine::play`].
    pub fn count_in(&self, tempo: f64, beats: Option<usize>) -> Result<(), String> {
        let shot = match beats {
            Some(beats) if tempo > 0.0 => Oneshot::CountIn { beats, seconds_per_beat: 60.0 / tempo },
            _ => Oneshot::Hush,
        };
        self.send(Command::Oneshot(shot))
    }

    /// Changes the song being played, from the beat it has reached. Stopped, it does nothing.
    ///
    /// # Errors
    /// As [`Engine::play`].
    pub fn update(&self, song: &Song) -> Result<(), String> {
        let at = self.position();
        let how = Playing { from: at.beat, ..*lock(&self.how) };
        if at.playing { self.play(song, how) } else { Ok(()) }
    }

    /// Listens to the parts of one effect, `(track, fx)` by their ids in `song`, for the Workbench's cables: while it
    /// plays, [`Position::levels`] gives each part's level. `None` stops listening. It carries on through `play` and
    /// changes to the song.
    pub fn watch(&self, song: &Song, target: Option<(&str, &str)>) {
        *lock(&self.watching) = target.map(|(track, fx)| (track.to_owned(), fx.to_owned(), Vec::new()));
        self.aim(Some(song));
    }

    /// Points the audio thread at the effect being listened to, in the lanes it has now; with `song`, its parts'
    /// ids are read again (they may have changed).
    fn aim(&self, song: Option<&Song>) {
        let mut watching = lock(&self.watching);
        let lane = watching.as_mut().and_then(|(track, fx, parts)| {
            if let Some(song) = song {
                let e = song.tracks.iter().find(|t| t.id == *track).and_then(|t| t.fx.iter().find(|e| e.get("id").and_then(serde_json::Value::as_str) == Some(fx.as_str())));
                *parts = e.map(crate::fx::part_ids).unwrap_or_default();
            }
            let lane = lock(&self.tracks).iter().position(|t| t == track)?;
            Some((lane, crate::fx::fx_key(fx)))
        });
        let shared = &self.shared;
        let (lane, key) = lane.map_or((-1, 0), |(l, k)| (i32::try_from(l).unwrap_or(-1), k));
        shared.watch_key.store(key, Ordering::Release);
        shared.watch_lane.store(lane, Ordering::Release);
        shared.watch_turn.fetch_add(1, Ordering::AcqRel);
    }

    /// Stops; what was sounding stops with it.
    ///
    /// # Errors
    /// As [`Engine::play`].
    pub fn stop(&self) -> Result<(), String> {
        self.empty_trash();
        self.shared.playing.store(false, Ordering::Release);
        self.send(Command::Stop)
    }

    /// Where it has got to, and the levels of the last block.
    #[must_use]
    pub fn position(&self) -> Position {
        let shared = &self.shared;
        let playing = shared.playing.load(Ordering::Acquire);
        let sounding = shared.sounding.load(Ordering::Acquire);
        let beat = f64::from_bits(shared.beat.load(Ordering::Acquire));
        let tracks = lock(&self.tracks);
        let count = (shared.tracks.load(Ordering::Relaxed) as usize).min(tracks.len()).min(MAX_METERS);
        let level = |i: usize| shared.peaks.get(i).map_or([-120.0; 2], |(l, r)| [db(f32::from_bits(l.load(Ordering::Relaxed))), db(f32::from_bits(r.load(Ordering::Relaxed)))]);
        let mut meters: Vec<(String, [f64; 2])> = tracks.iter().take(count).enumerate().map(|(i, id)| (id.clone(), level(i))).collect();
        if playing || sounding {
            meters.push(("master".to_owned(), level(count)));
        }
        let session = lock(&self.session)
            .iter()
            .zip(&shared.session)
            .map(|(id, (slot, start, queued))| {
                let slot = slot.load(Ordering::Relaxed);
                let queued = queued.load(Ordering::Relaxed);
                let state = SessionState {
                    playing: usize::try_from(slot).ok().map(|s| (s, f64::from_bits(start.load(Ordering::Relaxed)))),
                    queued: (queued != NO_LAUNCH).then(|| usize::try_from(queued).ok()),
                };
                (id.clone(), state)
            })
            .collect();
        let levels = lock(&self.watching)
            .as_ref()
            .filter(|_| playing)
            .map(|(track, fx, parts)| {
                parts
                    .iter()
                    .zip(&shared.parts)
                    .filter_map(|(part, slot)| {
                        let db = f64::from_bits(slot.load(Ordering::Relaxed));
                        (!db.is_nan()).then(|| (format!("{track}/{fx}/{part}"), db))
                    })
                    .collect()
            })
            .unwrap_or_default();
        Position { playing, sounding, beat, meters, session, levels }
    }

    fn send(&self, command: Command) -> Result<(), String> {
        self.keys.send(command)
    }

    fn empty_trash(&self) {
        let mut trash = lock(&self.trash);
        while trash.pop().is_ok() {}
    }
}

#[cfg(windows)]
mod device {
    use super::{AudioSide, Engine, Ordering};
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

    /// The default output, its stream kept on a thread of its own (a stream cannot move between threads) until the
    /// engine is dropped.
    pub(super) fn open() -> Result<Engine, String> {
        let (ready_tx, ready_rx) = std::sync::mpsc::channel::<Result<Engine, String>>();
        let (end_tx, end_rx) = std::sync::mpsc::channel::<()>();
        std::thread::Builder::new()
            .name("mobius-audio-out".into())
            .spawn(move || {
                let opened = start(end_tx);
                let stream = match opened {
                    Ok((engine, stream)) => {
                        let _ = ready_tx.send(Ok(engine));
                        stream
                    }
                    Err(e) => {
                        let _ = ready_tx.send(Err(e));
                        return;
                    }
                };
                // Kept alive until the engine (holding the other end) is dropped.
                let _ = end_rx.recv();
                drop(stream);
            })
            .map_err(|e| format!("The sound engine could not start: {e}"))?;
        ready_rx.recv().map_err(|_| "The sound engine could not start.".to_owned())?
    }

    fn start(end: std::sync::mpsc::Sender<()>) -> Result<(Engine, cpal::Stream), String> {
        let host = cpal::default_host();
        let device = host.default_output_device().ok_or("This computer has no sound output.")?;
        let name = device.name().unwrap_or_else(|_| "Sound output".to_owned());
        let supported = device.default_output_config().map_err(|e| format!("{name} could not be opened: {e}"))?;
        if supported.sample_format() != cpal::SampleFormat::F32 {
            return Err(format!("{name} does not take the sound format Mobius makes ({:?}).", supported.sample_format()));
        }
        let config: cpal::StreamConfig = supported.into();
        let channels = usize::from(config.channels);
        let rate = config.sample_rate.0;
        let (mut engine, mut audio): (Engine, AudioSide) = Engine::pair(config.sample_rate.0, name.clone());
        let shared = std::sync::Arc::clone(&engine.shared);
        let stream = device
            .build_output_stream(
                &config,
                move |data: &mut [f32], info: &cpal::OutputCallbackInfo| {
                    // How far ahead of the speakers this block is: what the device says, and at least the block itself
                    // (some devices give the same time for both).
                    let t = info.timestamp();
                    let said = t.playback.duration_since(&t.callback).map_or(0, |d| u64::try_from(d.as_micros()).unwrap_or(u64::MAX));
                    let block = (data.len() / channels.max(1)) as u64 * 1_000_000 / u64::from(rate.max(1));
                    shared.latency_us.store(said.max(block), Ordering::Relaxed);
                    audio.fill(data, channels);
                },
                |e| eprintln!("[mobius] sound output: {e}"),
                None,
            )
            .map_err(|e| format!("{name} could not be opened: {e}"))?;
        stream.play().map_err(|e| format!("{name} could not start: {e}"))?;
        // Wait (briefly) for the first block, so the latency asked for straight after opening is the real one.
        for _ in 0..50 {
            if engine.shared.latency_us.load(Ordering::Relaxed) > 0 {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(4));
        }
        engine._stream = Some(end);
        Ok((engine, stream))
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn the_audio_side_plays_what_it_is_given_and_reports_where_it_is() {
        let (engine, mut audio) = Engine::pair(48_000, "test".into());
        let song = Song::parse(r#"{"version":2,"tempo":120,"bars":2,"tracks":[{"id":"keys","instrument":"lead","notes":[{"pitch":72,"start":0,"length":2,"velocity":1}]}]}"#).unwrap();
        let mut buffer = vec![0f32; 960 * 2];
        audio.fill(&mut buffer, 2);
        assert!(buffer.iter().all(|s| *s == 0.0) && !engine.position().playing);

        engine.play(&song, Playing::default()).unwrap();
        audio.fill(&mut buffer, 2);
        let at = engine.position();
        assert!(at.playing && (at.beat - 0.04).abs() < 1e-9, "{at:?}");
        assert!(buffer.iter().any(|s| s.abs() > 0.01));
        assert_eq!(at.meters.iter().map(|(id, _)| id.as_str()).collect::<Vec<_>>(), ["keys", "master"]);
        assert!(at.meters[0].1[0] > -40.0);

        // A change to the song carries on from where it is; Stop goes quiet and gives the renderers back.
        engine.update(&song).unwrap();
        audio.fill(&mut buffer, 2);
        assert!((engine.position().beat - 0.08).abs() < 1e-9);
        engine.stop().unwrap();
        audio.fill(&mut buffer, 2);
        assert!(buffer.iter().all(|s| *s == 0.0) && !engine.position().playing);
        engine.empty_trash();
        assert!(lock(&engine.trash).pop().is_err());
    }

    #[test]
    fn more_channels_than_two_get_silence_past_the_second() {
        let (engine, mut audio) = Engine::pair(48_000, "test".into());
        let song = Song::parse(r#"{"version":2,"tempo":120,"bars":1,"tracks":[{"id":"t","instrument":"bass","notes":[{"pitch":45,"start":0,"length":1,"velocity":1}]}]}"#).unwrap();
        engine.play(&song, Playing::default()).unwrap();
        let mut buffer = vec![0f32; 480 * 4];
        audio.fill(&mut buffer, 4);
        assert!(buffer.chunks(4).all(|f| f[2] == 0.0 && f[3] == 0.0));
        assert!(buffer.chunks(4).any(|f| f[0] != 0.0));
    }

    #[test]
    fn the_session_view_launches_through_the_audio_side_and_reports_each_track() {
        let (engine, mut audio) = Engine::pair(48_000, "test".into());
        let song = Song::parse(r#"{"version":2,"tempo":120,"bars":2,"tracks":[{"id":"a","instrument":"bass","slots":[{"bars":1,"notes":[{"pitch":45,"start":0,"length":1,"velocity":1}]},{"bars":1,"notes":[]}]},{"id":"b","instrument":"lead","slots":[]}]}"#).unwrap();
        engine.play_session(&song, false, &[("a".to_owned(), Some(0))]).unwrap();
        let mut buffer = vec![0f32; 960 * 2];
        audio.fill(&mut buffer, 2);
        let at = engine.position();
        assert_eq!(at.session[0], ("a".to_owned(), SessionState { playing: Some((0, 0.0)), queued: None }));
        assert_eq!(at.session[1].1, SessionState::default());
        assert!(buffer.iter().any(|s| s.abs() > 0.01));
        engine.launch("a", Some(1)).unwrap();
        audio.fill(&mut buffer, 2);
        assert_eq!(engine.position().session[0].1.queued, Some(Some(1)));
        assert!(engine.launch("nope", None).is_err());
    }

    #[test]
    fn a_previewed_note_and_a_count_in_sound_while_stopped_and_a_count_in_can_be_cut_short() {
        let (engine, mut audio) = Engine::pair(48_000, "test".into());
        let song = Song::parse(r#"{"version":2,"tempo":120,"bars":1,"tracks":[{"id":"k","instrument":"piano"},{"id":"d","instrument":"drums"}]}"#).unwrap();
        let mut buffer = vec![0f32; 4_800 * 2];
        engine.preview(&song.tracks[0], 60, 0.8, 0.35).unwrap();
        audio.fill(&mut buffer, 2);
        assert!(buffer.iter().any(|s| s.abs() > 0.01) && !engine.position().playing);
        // While it sounds the position says so, with the master's level and no tracks.
        let at = engine.position();
        assert!(at.sounding);
        assert_eq!(at.meters.len(), 1);
        assert!(at.meters[0].0 == "master" && at.meters[0].1[0] > -40.0, "{:?}", at.meters);
        // It rings out and goes quiet.
        for _ in 0..30 {
            audio.fill(&mut buffer, 2);
        }
        assert!(buffer.iter().all(|s| *s == 0.0));
        let at = engine.position();
        assert!(!at.sounding && at.meters.is_empty(), "{:?}", at.meters);
        engine.preview(&song.tracks[1], 36, 1.0, 0.35).unwrap();
        audio.fill(&mut buffer, 2);
        assert!(buffer.iter().any(|s| s.abs() > 0.01));
        for _ in 0..30 {
            audio.fill(&mut buffer, 2);
        }
        // A count-in at 120: ticks at 50 ms and every half second after, the first louder.
        engine.count_in(120.0, Some(4)).unwrap();
        let mut out = vec![0f32; 48_000 * 2 * 2];
        for chunk in out.chunks_mut(960 * 2) {
            audio.fill(chunk, 2);
        }
        let left: Vec<f32> = out.iter().step_by(2).copied().collect();
        let onsets: Vec<usize> = (0..4).map(|i| 2_400 + i * 24_000).collect();
        for at in &onsets {
            assert!(left[at - 10..*at].iter().all(|s| *s == 0.0) && left[*at..at + 200].iter().any(|s| s.abs() > 0.05), "{at}");
        }
        let peak = |at: usize| left[at..at + 200].iter().fold(0f32, |m, s| m.max(s.abs()));
        assert!(peak(onsets[0]) > peak(onsets[1]) * 1.5);
        engine.count_in(120.0, Some(4)).unwrap();
        engine.count_in(120.0, None).unwrap();
        audio.fill(&mut out, 2);
        assert!(out.iter().all(|s| *s == 0.0));
    }

    #[test]
    fn a_key_played_lands_a_block_after_it_came_and_sounds_until_it_is_lifted() {
        use std::time::{Duration, Instant};
        let (engine, mut audio) = Engine::pair(48_000, "test".into());
        let song = Song::parse(r#"{"version":2,"tempo":120,"bars":1,"tracks":[{"id":"k","instrument":"bass","sound":{"shape":0,"detune":0,"sub":0,"drive":0,"cutoff":12000,"resonance":0,"envAmount":0,"attack":0.001,"decay":0.3,"sustain":1,"release":0.1,"vibrato":0,"rate":5}},{"id":"d","instrument":"drums"}]}"#).unwrap();
        // Nothing armed: a key is not heard.
        engine.press(60, 1.0).unwrap();
        let mut block = vec![0f32; 480 * 2];
        audio.fill(&mut block, 2);
        assert!(block.iter().all(|s| *s == 0.0));
        engine.arm(Some(&song.tracks[0]));
        // Pressed 4 ms before a 10 ms block is made: it starts 6 ms into it, whatever block it came in.
        let made = Instant::now() + Duration::from_secs(1);
        engine.keys.press(69, 1.0, made - Duration::from_millis(4)).unwrap();
        let mut out = vec![0f32; 48_000 * 2];
        audio.fill_at(&mut out[..960], 2, made);
        let left: Vec<f32> = out[..960].iter().step_by(2).copied().collect();
        let onset = left.iter().position(|s| s.abs() > 1e-6).unwrap();
        assert!((287..=290).contains(&onset), "{onset}");
        // Held: still sounding half a second on.
        for (i, chunk) in out[960..].chunks_mut(960).enumerate() {
            audio.fill_at(chunk, 2, made + Duration::from_millis(10 * (i as u64 + 1)));
        }
        let top = out[47_000..].iter().fold(0f32, |m, s| m.max(s.abs()));
        assert!(top > 0.3, "{top}");
        // Lifted: gone after its release, and the engine says it has stopped sounding.
        engine.lift(69).unwrap();
        for _ in 0..40 {
            audio.fill(&mut block, 2);
        }
        assert!(block.iter().all(|s| *s == 0.0) && !engine.position().sounding);
        // A drum pad rings out on its own.
        engine.arm(Some(&song.tracks[1]));
        engine.press(36, 1.0).unwrap();
        for chunk in out.chunks_mut(960) {
            audio.fill(chunk, 2);
        }
        assert!(out.iter().any(|s| s.abs() > 0.05));
    }

    #[test]
    fn a_key_lands_a_block_late_or_at_once_if_that_has_gone_by() {
        use std::time::{Duration, Instant};
        let now = Instant::now() + Duration::from_secs(1);
        assert_eq!(place(now, now, 480, 48_000.0), 479);
        assert_eq!(place(now - Duration::from_millis(5), now, 480, 48_000.0), 240);
        assert_eq!(place(now - Duration::from_millis(50), now, 480, 48_000.0), 0);
        assert_eq!(place(now + Duration::from_millis(5), now, 480, 48_000.0), 479);
    }

    #[test]
    fn a_previewed_note_is_heard_at_its_tracks_volume_and_pan() {
        let song = Song::parse(r#"{"version":2,"tempo":120,"bars":1,"tracks":[{"id":"a","instrument":"piano","volume":1},{"id":"b","instrument":"piano","volume":0.1},{"id":"c","instrument":"piano","volume":1,"pan":-1},{"id":"d","instrument":"drums","volume":0.1}]}"#).unwrap();
        let peaks = |track: usize, pitch: u8| {
            let (engine, mut audio) = Engine::pair(48_000, "test".into());
            engine.preview(&song.tracks[track], pitch, 0.8, 0.35).unwrap();
            let mut buffer = vec![0f32; 4_800 * 2];
            audio.fill(&mut buffer, 2);
            let peak = |c: usize| buffer.iter().skip(c).step_by(2).fold(0f32, |m, s| m.max(s.abs()));
            (peak(0), peak(1))
        };
        let (full, _) = peaks(0, 60);
        let (quiet, _) = peaks(1, 60);
        assert!((quiet / full - 0.1).abs() < 0.01, "{quiet} {full}");
        let (left, right) = peaks(2, 60);
        assert!(left > 0.01 && right < 1e-6, "{left} {right}");
        let (drum, _) = peaks(3, 36);
        let loud = { let mut s = song.clone(); s.tracks[3].volume = 1.0; let (engine, mut audio) = Engine::pair(48_000, "test".into()); engine.preview(&s.tracks[3], 36, 0.8, 0.35).unwrap(); let mut b = vec![0f32; 4_800 * 2]; audio.fill(&mut b, 2); b.iter().step_by(2).fold(0f32, |m, x| m.max(x.abs())) };
        assert!((drum / loud - 0.1).abs() < 0.01, "{drum} {loud}");
    }

    #[test]
    fn the_effect_the_workbench_has_open_reports_each_parts_level_while_playing() {
        let (engine, mut audio) = Engine::pair(48_000, "test".into());
        let song = Song::parse(r#"{"version":2,"tempo":120,"bars":2,"tracks":[{"id":"keys","instrument":"lead","notes":[{"pitch":72,"start":0,"length":2,"velocity":1}],
            "fx":[{"id":"eq1","kind":"eq","low":0,"mid":0,"high":-12},{"id":"verb","kind":"reverb","size":1,"damp":0.4,"mix":0}]}]}"#).unwrap();
        let mut buffer = vec![0f32; 960 * 2];
        engine.watch(&song, Some(("keys", "verb")));
        // Stopped, nothing is reported.
        audio.fill(&mut buffer, 2);
        assert!(engine.position().levels.is_empty());
        engine.play(&song, Playing::default()).unwrap();
        audio.fill(&mut buffer, 2);
        let levels = engine.position().levels;
        let names: Vec<&str> = levels.iter().map(|(n, _)| n.as_str()).collect();
        // The output's level is the effect's own; the rest are each part's.
        assert_eq!(names, ["keys/verb/in", "keys/verb/room", "keys/verb/mix"]);
        let level = |name: &str| levels.iter().find(|(n, _)| n == name).unwrap().1;
        assert!(level("keys/verb/in") > -30.0, "{levels:?}");
        // The mix is all dry, so it is the input's level.
        assert!((level("keys/verb/mix") - level("keys/verb/in")).abs() < 0.5, "{levels:?}");
        // Another effect, then none.
        engine.watch(&song, Some(("keys", "eq1")));
        audio.fill(&mut buffer, 2);
        let names: Vec<String> = engine.position().levels.into_iter().map(|(n, _)| n).collect();
        assert_eq!(names, ["keys/eq1/in", "keys/eq1/low", "keys/eq1/mid", "keys/eq1/high"]);
        engine.watch(&song, None);
        audio.fill(&mut buffer, 2);
        assert!(engine.position().levels.is_empty());
        // It carries on through a new play, and an effect not in the song reports nothing.
        engine.watch(&song, Some(("keys", "verb")));
        engine.play(&song, Playing { from: 1.0, ..Playing::default() }).unwrap();
        audio.fill(&mut buffer, 2);
        assert_eq!(engine.position().levels.len(), 3);
        engine.watch(&song, Some(("keys", "nope")));
        audio.fill(&mut buffer, 2);
        assert!(engine.position().levels.is_empty());
    }
}
