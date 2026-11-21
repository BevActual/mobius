//! Live playback: the song rendered on the audio thread of the computer's sound output.
//!
//! The audio thread only renders. Everything it is given is made beforehand on the caller's side and handed over
//! through a wait-free queue ([`rtrb`]): a [`Renderer`] for the song from a beat, or Stop. What it lets go of comes
//! back through a second queue to be dropped here, so the audio thread neither allocates nor frees. Its position and
//! the levels go the other way as atomics, read whenever the window asks (about 30 times a second).

// The audio side is driven by the Windows output device; elsewhere only the tests use it.
#![cfg_attr(not(windows), allow(dead_code))]

use crate::render::{Playing, Renderer, SessionState, MAX_BLOCK};
use crate::song::Song;
use std::sync::atomic::{AtomicBool, AtomicI32, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, PoisonError};

/// The most tracks whose levels are reported; the master's comes after them.
pub const MAX_METERS: usize = 128;

pub(crate) enum Command {
    /// Play this from where it starts, taking over what the one before it still has sounding.
    Play(Box<Renderer>),
    Stop,
    /// In the Session view: start a track's clip in a slot (or stop it) at the next bar line.
    Launch(usize, Option<usize>),
}

/// What the audio thread reports.
pub(crate) struct Shared {
    playing: AtomicBool,
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
}

const NO_LAUNCH: i32 = i32::MIN;

impl Shared {
    fn new() -> Shared {
        Shared {
            playing: AtomicBool::new(false),
            beat: AtomicU64::new(0),
            peaks: (0..=MAX_METERS).map(|_| (AtomicU32::new(0), AtomicU32::new(0))).collect(),
            tracks: AtomicU32::new(0),
            latency_us: AtomicU64::new(0),
            session: (0..MAX_METERS).map(|_| (AtomicI32::new(-1), AtomicU64::new(0), AtomicI32::new(NO_LAUNCH))).collect(),
        }
    }
}

/// The audio thread's side: what it plays, and where it hands things back.
pub(crate) struct AudioSide {
    commands: rtrb::Consumer<Command>,
    trash: rtrb::Producer<Box<Renderer>>,
    shared: Arc<Shared>,
    playing: Option<Box<Renderer>>,
    left: Vec<f32>,
    right: Vec<f32>,
}

impl AudioSide {
    /// Fills an interleaved buffer of `channels` channels: the left and right, and silence on any others.
    pub(crate) fn fill(&mut self, data: &mut [f32], channels: usize) {
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
        let Some(renderer) = self.playing.as_mut() else {
            data.fill(0.0);
            self.shared.playing.store(false, Ordering::Release);
            return;
        };
        for frames in data.chunks_mut(MAX_BLOCK * channels) {
            let n = frames.len() / channels;
            let (left, right) = (&mut self.left[..n], &mut self.right[..n]);
            renderer.render(left, right);
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
        let shared = &self.shared;
        let mut count = 0u32;
        for (slot, (l, r)) in shared.peaks.iter().zip(renderer.peaks()) {
            slot.0.store(l.to_bits(), Ordering::Relaxed);
            slot.1.store(r.to_bits(), Ordering::Relaxed);
            count += 1;
        }
        shared.tracks.store(count.saturating_sub(1), Ordering::Relaxed);
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

    fn let_go(&mut self, old: Box<Renderer>) {
        // If the queue back is full (nobody has emptied it for a long while) it is dropped here instead.
        let _ = self.trash.push(old);
    }
}

/// The caller's side of a live engine. Made by [`Engine::open`]; the stream plays until this is dropped.
pub struct Engine {
    commands: Mutex<rtrb::Producer<Command>>,
    trash: Mutex<rtrb::Consumer<Box<Renderer>>>,
    shared: Arc<Shared>,
    /// The tracks whose levels `position` reports, in the order the audio thread has them.
    tracks: Mutex<Vec<String>>,
    /// In the Session view, every track's id, in the order launches name them.
    session: Mutex<Vec<String>>,
    /// How it was last asked to play: its loop and click carry on through a change to the song.
    how: Mutex<Playing>,
    sample_rate: u32,
    device: String,
    /// Dropped to end the stream.
    _stream: Option<std::sync::mpsc::Sender<()>>,
}

/// Where playback is.
#[derive(Debug, Clone, PartialEq)]
pub struct Position {
    pub playing: bool,
    pub beat: f64,
    /// Each track's level, left and right in dB, then `"master"`'s.
    pub meters: Vec<(String, [f64; 2])>,
    /// In the Session view, each track's id and what it is doing.
    pub session: Vec<(String, SessionState)>,
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
        let audio = AudioSide { commands: consumer, trash: trash_in, shared: Arc::clone(&shared), playing: None, left: vec![0.0; MAX_BLOCK], right: vec![0.0; MAX_BLOCK] };
        let engine = Engine { commands: Mutex::new(commands), trash: Mutex::new(trash), shared, tracks: Mutex::new(Vec::new()), session: Mutex::new(Vec::new()), how: Mutex::new(Playing::default()), sample_rate, device, _stream: None };
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

    /// Changes the song being played, from the beat it has reached. Stopped, it does nothing.
    ///
    /// # Errors
    /// As [`Engine::play`].
    pub fn update(&self, song: &Song) -> Result<(), String> {
        let at = self.position();
        let how = Playing { from: at.beat, ..*lock(&self.how) };
        if at.playing { self.play(song, how) } else { Ok(()) }
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
        let beat = f64::from_bits(shared.beat.load(Ordering::Acquire));
        let tracks = lock(&self.tracks);
        let count = (shared.tracks.load(Ordering::Relaxed) as usize).min(tracks.len()).min(MAX_METERS);
        let level = |i: usize| shared.peaks.get(i).map_or([-120.0; 2], |(l, r)| [db(f32::from_bits(l.load(Ordering::Relaxed))), db(f32::from_bits(r.load(Ordering::Relaxed)))]);
        let mut meters: Vec<(String, [f64; 2])> = tracks.iter().take(count).enumerate().map(|(i, id)| (id.clone(), level(i))).collect();
        if playing {
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
        Position { playing, beat, meters, session }
    }

    fn send(&self, command: Command) -> Result<(), String> {
        lock(&self.commands).push(command).map_err(|_| "The sound engine is not answering.".to_owned())
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
}
