//! Live playback: the song rendered on the audio thread of the computer's sound output.
//!
//! The audio thread only renders. Everything it is given is made beforehand on the caller's side and handed over
//! through a wait-free queue ([`rtrb`]): a [`Renderer`] for the song from a beat, or Stop. What it lets go of comes
//! back through a second queue to be dropped here, so the audio thread neither allocates nor frees. Its position and
//! the levels go the other way as atomics, read whenever the window asks (about 30 times a second).

// The audio side is driven by the output device on Windows and macOS; elsewhere only the tests use it.
#![cfg_attr(not(any(windows, target_os = "macos")), allow(dead_code))]

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
    /// What comes in from the sound input, left and right interleaved, or none. (Rare: letting the old one go may free
    /// its queue here.)
    Input(Option<rtrb::Consumer<f32>>),
    /// The armed audio track's input heard straight out at these gains (its volume and pan), or not.
    Monitor(Option<(f32, f32)>),
    /// A take: what comes in is handed to it while the song plays, or the take ends.
    Record(Option<rtrb::Producer<f32>>),
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
    /// The beat a take's first frame was played at (f64 bits, NaN before it has one), and whether the writer fell
    /// behind and frames were lost.
    take_beat: AtomicU64,
    take_lost: AtomicBool,
    /// From sound reaching the input to the engine having it, in microseconds.
    input_latency_us: AtomicU64,
    /// Frames the sound input has given since it opened: how to tell an input that never starts from a quiet one.
    input_frames: AtomicU64,
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
            take_beat: AtomicU64::new(f64::NAN.to_bits()),
            take_lost: AtomicBool::new(false),
            input_latency_us: AtomicU64::new(0),
            input_frames: AtomicU64::new(0),
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
    /// The sound input, a block of it, whether it is heard and the take it goes to.
    input: Option<rtrb::Consumer<f32>>,
    in_left: Vec<f32>,
    in_right: Vec<f32>,
    monitor: Option<(f32, f32)>,
    take: Option<rtrb::Producer<f32>>,
    take_started: bool,
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
                Command::Input(input) => self.input = input,
                Command::Monitor(gains) => self.monitor = gains,
                Command::Record(take) => {
                    self.take = take;
                    self.take_started = false;
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
        let monitoring = self.monitor.is_some() && self.input.is_some();
        if self.playing.is_none() && !self.oneshots.busy() && !monitoring {
            // Nothing to hear: what came in is let go, so it is not heard late when monitoring starts.
            if let Some(input) = self.input.as_mut() {
                let waiting = input.slots();
                if let Ok(chunk) = input.read_chunk(waiting) {
                    chunk.commit_all();
                }
            }
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
            // The beat this block starts on, while the song plays (a take keeps only what is played over).
            let at = self.playing.as_ref().filter(|r| !r.past_end()).map(|r| r.beat());
            match self.playing.as_mut() {
                Some(renderer) => renderer.render(left, right),
                None => {
                    left.fill(0.0);
                    right.fill(0.0);
                }
            }
            if self.input.is_some() {
                read_input(self.input.as_mut(), &mut self.in_left[..n], &mut self.in_right[..n]);
                if let Some((gl, gr)) = self.monitor {
                    for i in 0..n {
                        left[i] += self.in_left[i] * gl;
                        right[i] += self.in_right[i] * gr;
                    }
                }
                if let (Some(take), Some(beat)) = (self.take.as_mut(), at) {
                    if !self.take_started {
                        self.take_started = true;
                        self.shared.take_beat.store(beat.to_bits(), Ordering::Release);
                    }
                    for i in 0..n {
                        if take.slots() < 2 {
                            self.shared.take_lost.store(true, Ordering::Relaxed);
                            break;
                        }
                        let _ = take.push(self.in_left[i]);
                        let _ = take.push(self.in_right[i]);
                    }
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
        // Monitoring an input sounds too, so its meters move while stopped.
        self.shared.sounding.store(self.oneshots.busy() || monitoring, Ordering::Release);
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

/// The next `left.len()` frames from the input (silence for any it has not given yet). When more has piled up than a
/// block and a bit, the oldest is let go, so what is heard stays as late as a block and no later.
fn read_input(input: Option<&mut rtrb::Consumer<f32>>, left: &mut [f32], right: &mut [f32]) {
    left.fill(0.0);
    right.fill(0.0);
    let Some(input) = input else { return };
    let n = left.len();
    let extra = (input.slots() / 2).saturating_sub(n + MAX_BLOCK);
    if extra > 0 {
        if let Ok(chunk) = input.read_chunk(extra * 2) {
            chunk.commit_all();
        }
    }
    let have = (input.slots() / 2).min(n);
    if let Ok(chunk) = input.read_chunk(have * 2) {
        let (a, b) = chunk.as_slices();
        for (k, s) in a.iter().chain(b.iter()).enumerate() {
            if k % 2 == 0 { left[k / 2] = *s } else { right[k / 2] = *s }
        }
        chunk.commit_all();
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
    /// Told when a key is pressed (off the audio thread), so whoever reports the position starts while stopped.
    pressed: Arc<Mutex<Option<Pressed>>>,
}

/// Called when a keyboard's key is pressed.
pub type Pressed = Arc<dyn Fn() + Send + Sync>;

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
        self.send(Command::Played(shot, at))?;
        let told = lock(&self.pressed).clone();
        if let Some(told) = told {
            told();
        }
        Ok(())
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
    /// The track whose notes sound while stopped (the armed one, or the last previewed): the master's level is its own.
    heard: Mutex<Option<String>>,
    sample_rate: u32,
    device: String,
    /// Dropped to end the stream.
    _stream: Option<std::sync::mpsc::Sender<()>>,
    /// The sound input open: its name and channel, and dropped to close it.
    input: Mutex<Option<OpenInput>>,
    /// The take being recorded.
    take: Mutex<Option<crate::record::Recorder>>,
}

/// The computer's sound inputs: each one's name and how many channels it has (none on Linux for now).
#[must_use]
pub fn inputs() -> Vec<(String, u16)> {
    #[cfg(any(windows, target_os = "macos"))]
    {
        device::inputs()
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        Vec::new()
    }
}

/// The sound input open: its name, the one asked for (none for the default), its channel, and the end that closes it.
type OpenInput = (String, Option<String>, Option<u32>, std::sync::mpsc::Sender<()>);

/// A recorded take: its file, the beat it starts on, and how far into the file that beat is (the time from the
/// sound being made to it coming back in, which Live also takes off a recording: 19.1.1).
#[derive(Debug, Clone, PartialEq)]
pub struct Take {
    pub written: crate::record::Written,
    pub beat: f64,
    pub offset: f64,
    /// Frames were lost because the disk fell behind.
    pub lost: bool,
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
        let audio = AudioSide { commands: consumer, trash: trash_in, shared: Arc::clone(&shared), playing: None, oneshots: Oneshots::default(), rate: f64::from(sample_rate), watch_turn: 0, left: vec![0.0; MAX_BLOCK], right: vec![0.0; MAX_BLOCK], input: None, in_left: vec![0.0; MAX_BLOCK], in_right: vec![0.0; MAX_BLOCK], monitor: None, take: None, take_started: false };
        let keys = Keys { commands: Arc::new(Mutex::new(commands)), armed: Arc::new(Mutex::new(None)), pressed: Arc::new(Mutex::new(None)) };
        let engine = Engine { keys, midi: Mutex::new(None), trash: Mutex::new(trash), shared, tracks: Mutex::new(Vec::new()), session: Mutex::new(Vec::new()), how: Mutex::new(Playing::default()), watching: Mutex::new(None), heard: Mutex::new(None), sample_rate, device, _stream: None, input: Mutex::new(None), take: Mutex::new(None) };
        (engine, audio)
    }

    /// Opens the computer's default sound output and starts its stream (silent until something plays).
    ///
    /// # Errors
    /// When there is no output, or it cannot be opened.
    pub fn open() -> Result<Engine, String> {
        #[cfg(any(windows, target_os = "macos"))]
        {
            device::open()
        }
        #[cfg(not(any(windows, target_os = "macos")))]
        {
            Err("The sound engine plays on Windows and macOS only for now.".to_owned())
        }
    }

    /// The same engine with no sound output: run on a clock of its own, heard by nobody, so playing, the position,
    /// meters and the keyboard work on a computer with no output (or one the engine doesn't open yet), and in tests.
    #[must_use]
    pub fn silent() -> Engine {
        const RATE: u32 = 48_000;
        const BLOCK: usize = 480;
        let (mut engine, mut audio) = Engine::pair(RATE, String::new());
        let (end_tx, end_rx) = std::sync::mpsc::channel::<()>();
        engine.shared.latency_us.store(10_000, Ordering::Relaxed);
        let spawned = std::thread::Builder::new().name("mobius-audio-silent".into()).spawn(move || {
            let mut buffer = vec![0f32; BLOCK * 2];
            let block = std::time::Duration::from_micros(BLOCK as u64 * 1_000_000 / u64::from(RATE));
            let mut next = std::time::Instant::now();
            loop {
                // Blocks as fast as they would be heard; a late wake catches up rather than slowing the song.
                while next <= std::time::Instant::now() {
                    audio.fill(&mut buffer, 2);
                    next += block;
                }
                match end_rx.recv_timeout(next.saturating_duration_since(std::time::Instant::now())) {
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                    _ => break,
                }
            }
        });
        if spawned.is_ok() {
            engine._stream = Some(end_tx);
        }
        engine
    }

    /// Whether it plays to no output (see [`Engine::silent`]).
    #[must_use]
    pub fn is_silent(&self) -> bool {
        self.device.is_empty()
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
        *lock(&self.heard) = Some(track.id.clone()).filter(|id| id != "preview");
        self.send(Command::Oneshot(shot))
    }

    /// `pressed` is called each time a key is pressed, from a MIDI keyboard or [`Engine::press`].
    pub fn on_key(&self, pressed: Pressed) {
        *lock(&self.keys.pressed) = Some(pressed);
    }

    /// Opens the sound input called `device` (as [`inputs`] names them), or the computer's default, keeping its
    /// `channel` (counted from 0) on both sides, or its first two as left and right with none (Live 12 manual, 19.1
    /// "Choosing what to record"). Returns its name. Open already the same way, it is kept.
    ///
    /// # Errors
    /// When there is no input, it cannot be opened at the engine's rate, or the engine has no output.
    pub fn open_input(&self, device: Option<&str>, channel: Option<u32>) -> Result<String, String> {
        let mut input = lock(&self.input);
        if let Some((name, wanted, open, _)) = input.as_ref() {
            if *open == channel && wanted.as_deref() == device {
                return Ok(name.clone());
            }
        }
        *input = None;
        #[cfg(any(windows, target_os = "macos"))]
        {
            if self.is_silent() {
                return Err("There is no sound output to monitor through.".to_owned());
            }
            self.shared.input_frames.store(0, Ordering::Relaxed);
            let (name, queue, end) = device::open_input(self.sample_rate, device.map(str::to_owned), channel, Arc::clone(&self.shared))?;
            self.send(Command::Input(Some(queue)))?;
            *input = Some((name.clone(), device.map(str::to_owned), channel, end));
            Ok(name)
        }
        #[cfg(not(any(windows, target_os = "macos")))]
        {
            let _ = (device, channel);
            Err("Recording audio works on Windows and macOS only for now.".to_owned())
        }
    }

    /// Closes the sound input.
    ///
    /// # Errors
    /// As [`Engine::play`].
    pub fn close_input(&self) -> Result<(), String> {
        if lock(&self.input).take().is_some() {
            self.send(Command::Input(None))?;
        }
        Ok(())
    }

    /// Hears the input straight out at `gains` (the armed track's volume and pan), or not: Live's Auto monitoring,
    /// where an armed audio track is heard (19.2 "Monitoring").
    ///
    /// # Errors
    /// As [`Engine::play`].
    pub fn monitor(&self, track: Option<(&str, crate::render::Gains)>) -> Result<(), String> {
        // Stopped, its meter is the one that moves with Main's.
        *lock(&self.heard) = track.map(|(id, _)| id.to_owned());
        self.send(Command::Monitor(track.map(|(_, gains)| gains)))
    }

    /// Frames the sound input has given since it opened (0 when none is open, or it has not started).
    #[must_use]
    pub fn input_frames(&self) -> u64 {
        if lock(&self.input).is_none() {
            return 0;
        }
        self.shared.input_frames.load(Ordering::Relaxed)
    }

    /// Starts a take in `file`: what comes in from the input is written to it while the song plays.
    ///
    /// # Errors
    /// When the file cannot be made, or one is being recorded already.
    pub fn start_take(&self, file: &std::path::Path) -> Result<(), String> {
        let mut take = lock(&self.take);
        if take.is_some() {
            return Err("A take is being recorded already.".to_owned());
        }
        let (recorder, queue) = crate::record::Recorder::start(file, self.sample_rate)?;
        self.shared.take_beat.store(f64::NAN.to_bits(), Ordering::Release);
        self.shared.take_lost.store(false, Ordering::Relaxed);
        self.send(Command::Record(Some(queue)))?;
        *take = Some(recorder);
        Ok(())
    }

    /// Ends the take, once it is written. `None` when none was being recorded; a take with nothing in it (the song was
    /// not playing) is removed, and is `None` too.
    ///
    /// # Errors
    /// When writing it failed.
    pub fn end_take(&self) -> Result<Option<Take>, String> {
        let Some(recorder) = lock(&self.take).take() else { return Ok(None) };
        self.send(Command::Record(None))?;
        let written = recorder.finish()?;
        let beat = f64::from_bits(self.shared.take_beat.load(Ordering::Acquire));
        if written.frames == 0 || beat.is_nan() {
            let _ = std::fs::remove_file(&written.file);
            return Ok(None);
        }
        let latency = (self.shared.latency_us.load(Ordering::Relaxed) + self.shared.input_latency_us.load(Ordering::Relaxed)) as f64 / 1e6;
        Ok(Some(Take { written, beat, offset: latency, lost: self.shared.take_lost.load(Ordering::Relaxed) }))
    }

    /// Plays a keyboard on `track` (its instrument and sound, at its volume and pan), or on none.
    pub fn arm(&self, track: Option<&crate::song::Track>) {
        *lock(&self.keys.armed) = track.cloned();
        *lock(&self.heard) = track.map(|t| t.id.clone());
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
            // Stopped, what sounds is one track's notes (a key played, a note put in): its meter moves too, as in Live.
            if !playing {
                if let Some(id) = lock(&self.heard).clone() {
                    meters.push((id, level(count)));
                }
            }
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

#[cfg(any(windows, target_os = "macos"))]
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

    /// What [`open_input`] gives: the input's name, the queue its sound comes through, and the end that closes it.
    type Opened = (String, rtrb::Consumer<f32>, std::sync::mpsc::Sender<()>);

    /// The default input at `rate`, its stream kept on a thread of its own as the output's is, its sound (`channel`
    /// on both sides, or the first two) put into a queue for the audio thread.
    pub(super) fn open_input(rate: u32, device: Option<String>, channel: Option<u32>, shared: std::sync::Arc<super::Shared>) -> Result<Opened, String> {
        let (ready_tx, ready_rx) = std::sync::mpsc::channel::<Result<(String, rtrb::Consumer<f32>), String>>();
        let (end_tx, end_rx) = std::sync::mpsc::channel::<()>();
        std::thread::Builder::new()
            .name("mobius-audio-in".into())
            .spawn(move || match start_input(rate, device.as_deref(), channel, shared) {
                Ok((name, queue, stream)) => {
                    let _ = ready_tx.send(Ok((name, queue)));
                    let _ = end_rx.recv();
                    drop(stream);
                }
                Err(e) => {
                    let _ = ready_tx.send(Err(e));
                }
            })
            .map_err(|e| format!("The sound input could not start: {e}"))?;
        let (name, queue) = ready_rx.recv().map_err(|_| "The sound input could not start.".to_owned())??;
        Ok((name, queue, end_tx))
    }

    /// The sound inputs, by name, and how many channels each has by default.
    pub(super) fn inputs() -> Vec<(String, u16)> {
        let Ok(devices) = cpal::default_host().input_devices() else { return Vec::new() };
        devices.filter_map(|d| Some((d.name().ok()?, d.default_input_config().map_or(0, |c| c.channels())))).collect()
    }

    fn start_input(rate: u32, wanted: Option<&str>, channel: Option<u32>, shared: std::sync::Arc<super::Shared>) -> Result<(String, rtrb::Consumer<f32>, cpal::Stream), String> {
        let host = cpal::default_host();
        let device = match wanted {
            Some(want) => host
                .input_devices()
                .map_err(|e| e.to_string())?
                .find(|d| d.name().is_ok_and(|n| n == want))
                .ok_or_else(|| format!("{want} is not connected."))?,
            None => host.default_input_device().ok_or("This computer has no sound input.")?,
        };
        let name = device.name().unwrap_or_else(|_| "Sound input".to_owned());
        // The engine's rate when the input has it; else the input's own (48 kHz on most computers), resampled.
        let ranges: Vec<_> = device.supported_input_configs().map_err(|e| format!("{name} could not be opened: {e}"))?.filter(|c| c.sample_format() == cpal::SampleFormat::F32).collect();
        let config: cpal::StreamConfig = match ranges.iter().find(|c| c.min_sample_rate().0 <= rate && rate <= c.max_sample_rate().0) {
            Some(range) => (*range).with_sample_rate(cpal::SampleRate(rate)).into(),
            None => match device.default_input_config() {
                Ok(c) if c.sample_format() == cpal::SampleFormat::F32 => c.into(),
                _ => ranges.first().copied().map(|r| r.with_max_sample_rate().into()).ok_or_else(|| format!("{name} does not record in a format Mobius takes."))?,
            },
        };
        let mut resample = crate::record::Resample::new(f64::from(config.sample_rate.0), f64::from(rate));
        let failed: std::sync::Arc<std::sync::Mutex<Option<String>>> = std::sync::Arc::default();
        let watch = std::sync::Arc::clone(&shared);
        let channels = usize::from(config.channels).max(1);
        let pick = channel.map(|c| c as usize).filter(|c| *c < channels);
        if channel.is_some() && pick.is_none() {
            return Err(format!("{name} has {channels} inputs; input {} is not one of them.", channel.unwrap_or(0) + 1));
        }
        // A quarter of a second of room: the audio thread takes it every block.
        let (mut producer, consumer) = rtrb::RingBuffer::<f32>::new(rate as usize / 2);
        let stream = device
            .build_input_stream(
                &config,
                move |data: &[f32], info: &cpal::InputCallbackInfo| {
                    let t = info.timestamp();
                    let late = t.callback.duration_since(&t.capture).map_or(0, |d| u64::try_from(d.as_micros()).unwrap_or(u64::MAX));
                    shared.input_latency_us.store(late, Ordering::Relaxed);
                    shared.input_frames.fetch_add((data.len() / channels) as u64, Ordering::Relaxed);
                    for frame in data.chunks_exact(channels) {
                        if producer.slots() < 2 {
                            break;
                        }
                        let (l, r) = match pick {
                            Some(c) => (frame[c], frame[c]),
                            None => (frame[0], *frame.get(1).unwrap_or(&frame[0])),
                        };
                        resample.push((l, r), |(l, r)| {
                            if producer.slots() >= 2 {
                                let _ = producer.push(l);
                                let _ = producer.push(r);
                            }
                        });
                    }
                },
                {
                    let failed = std::sync::Arc::clone(&failed);
                    move |e| {
                        eprintln!("[mobius] sound input: {e}");
                        *failed.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = Some(e.to_string());
                    }
                },
                None,
            )
            .map_err(|e| format!("{name} could not be opened: {e}"))?;
        stream.play().map_err(|e| format!("{name} could not start: {e}"))?;
        // Wait (up to a second) for its first sound, so an input that opens but never starts says so now rather
        // than recording silence.
        let shared = std::sync::Arc::clone(&watch);
        for _ in 0..100 {
            if shared.input_frames.load(Ordering::Relaxed) > 0 {
                return Ok((name, consumer, stream));
            }
            if let Some(e) = failed.lock().unwrap_or_else(std::sync::PoisonError::into_inner).take() {
                return Err(format!("{name} stopped: {e}"));
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        Err(format!("{name} opened but sent no sound. Check that Windows lets desktop apps use the microphone."))
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
    fn with_no_output_the_engine_still_keeps_time() {
        let engine = Engine::silent();
        assert!(engine.is_silent() && engine.latency_ms() > 0.0);
        let song = Song::parse(r#"{"version":2,"tempo":120,"bars":8,"tracks":[{"id":"t","instrument":"bass","notes":[{"pitch":45,"start":0,"length":4,"velocity":1}]}]}"#).unwrap();
        engine.play(&song, Playing::default()).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(300));
        let at = engine.position();
        // 300 ms at 120 bpm is 0.6 of a beat (a slow test machine may lag a little, never run ahead).
        assert!(at.playing && at.beat > 0.3 && at.beat < 0.7, "{at:?}");
        assert!(at.meters.iter().any(|(id, db)| id == "t" && db[0] > -60.0), "{at:?}");
        engine.stop().unwrap();
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
        // While it sounds the position says so: the master's level, which is the previewed track's too.
        let at = engine.position();
        assert!(at.sounding);
        assert_eq!(at.meters.iter().map(|(id, _)| id.as_str()).collect::<Vec<_>>(), ["k", "master"]);
        assert!(at.meters[1].1[0] > -40.0 && at.meters[0].1 == at.meters[1].1, "{:?}", at.meters);
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

    #[test]
    fn an_armed_input_is_heard_and_recorded_while_the_song_plays() {
        let (engine, mut audio) = Engine::pair(48_000, "test".into());
        let (mut feed, queue) = rtrb::RingBuffer::<f32>::new(48_000);
        let mut give = |frames: usize| {
            for _ in 0..frames {
                feed.push(0.5).unwrap();
                feed.push(0.5).unwrap();
            }
        };
        engine.send(Command::Input(Some(queue))).unwrap();
        engine.monitor(Some(("v", (1.0, 0.5)))).unwrap();
        // Stopped, the input is heard at the track's gains.
        let mut buffer = vec![0f32; 480 * 2];
        give(480);
        audio.fill(&mut buffer, 2);
        assert!((buffer[0] - 0.5).abs() < 1e-6 && (buffer[1] - 0.25).abs() < 1e-6, "{:?}", &buffer[..2]);
        // Not playing, a take gets nothing and is removed.
        let dir = std::env::temp_dir().join(format!("mobius-engine-take-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let end = |engine: &Engine, audio: &mut AudioSide| {
            std::thread::scope(|s| {
                let ending = s.spawn(|| engine.end_take());
                let mut buffer = vec![0f32; 480 * 2];
                while !ending.is_finished() {
                    audio.fill(&mut buffer, 2);
                    std::thread::sleep(std::time::Duration::from_millis(1));
                }
                ending.join().unwrap().unwrap()
            })
        };
        engine.start_take(&dir.join("empty.wav")).unwrap();
        assert!(end(&engine, &mut audio).is_none());
        assert!(!dir.join("empty.wav").exists());
        // Played from beat 1, a take gets what comes in from that beat.
        let song = Song::parse(r#"{"version":2,"tempo":120,"bars":2,"tracks":[]}"#).unwrap();
        engine.play(&song, Playing { from: 1.0, ..Playing::default() }).unwrap();
        engine.start_take(&dir.join("take.wav")).unwrap();
        for _ in 0..10 {
            give(480);
            audio.fill(&mut buffer, 2);
        }
        let take = end(&engine, &mut audio).unwrap();
        assert_eq!(take.beat, 1.0);
        assert!(!take.lost);
        assert!(take.written.frames >= 4800, "{take:?}");
        let sound = crate::wav::read(&std::fs::read(dir.join("take.wav")).unwrap()).unwrap();
        assert_eq!(&sound.left[..4800], &[0.5; 4800][..]);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
