//! Hearing a meeting (docs/reference/voice-plan.md, section 2): the microphone, turned into 16 kHz mono and cut into
//! WAV parts of a couple of minutes, each written to a folder as it is finished so it can be written down while the
//! next is heard. Speech models (Whisper on this computer, and the services) all take this format.
//!
//! The parts are cut here, not in the window, so a second track of what the computer plays (the other side of a call)
//! is heard on the same clock: each part of the microphone, `part-<n>.wav`, comes with the same stretch of the
//! computer's sound, `others-<n>.wav`, where that can be heard (Windows, for now).

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};

/// The rate every part is written at.
pub const RATE: u32 = 16_000;
/// A last part shorter than this holds no words worth asking about, so it isn't kept.
const SHORTEST_PART: usize = RATE as usize / 4;

/// A finished part: its number from 0, where it starts in the meeting and how long it is, in seconds, its file of
/// the microphone and, when the computer's sound is heard too, its file of that.
#[derive(Debug, Clone, PartialEq)]
pub struct Part {
    pub index: u32,
    pub start: f64,
    pub seconds: f64,
    pub file: PathBuf,
    pub others: Option<PathBuf>,
}

/// A 16 kHz, one-channel, 16-bit PCM WAV of `samples`.
#[must_use]
pub fn wav16(samples: &[i16]) -> Vec<u8> {
    let data = (samples.len() * 2) as u32;
    let mut out = Vec::with_capacity(44 + samples.len() * 2);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&RATE.to_le_bytes());
    out.extend_from_slice(&(RATE * 2).to_le_bytes());
    out.extend_from_slice(&2u16.to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data.to_le_bytes());
    for s in samples {
        out.extend_from_slice(&s.to_le_bytes());
    }
    out
}

/// Cuts 16 kHz mono sound into parts of `part_seconds`, each written to `dir` as `part-<n>.wav`, up to `max_seconds`
/// in all.
pub struct Parts {
    dir: PathBuf,
    name: &'static str,
    part: usize,
    max: u64,
    buffer: Vec<i16>,
    index: u32,
    total: u64,
}

impl Parts {
    #[must_use]
    pub fn new(dir: &Path, part_seconds: u32, max_seconds: u32) -> Parts {
        Parts::named(dir, "part", part_seconds, max_seconds)
    }

    /// The same, writing `<name>-<n>.wav`.
    #[must_use]
    pub fn named(dir: &Path, name: &'static str, part_seconds: u32, max_seconds: u32) -> Parts {
        let part = (part_seconds.max(1) * RATE) as usize;
        Parts { dir: dir.to_path_buf(), name, part, max: u64::from(max_seconds) * u64::from(RATE), buffer: Vec::with_capacity(part), index: 0, total: 0 }
    }

    /// The samples heard so far.
    #[must_use]
    pub fn total(&self) -> u64 {
        self.total
    }

    /// The seconds heard so far.
    #[must_use]
    pub fn seconds(&self) -> f64 {
        self.total as f64 / f64::from(RATE)
    }

    /// Whether the longest meeting has been heard.
    #[must_use]
    pub fn full(&self) -> bool {
        self.total >= self.max
    }

    /// Adds sound, between -1 and 1, giving `out` each part it finishes. Sound past the longest meeting is left out.
    pub fn push(&mut self, samples: &[f32], out: &mut impl FnMut(Result<Part, String>)) {
        for &s in samples {
            if self.full() {
                return;
            }
            let s = s.clamp(-1.0, 1.0);
            self.buffer.push(if s < 0.0 { (s * 32768.0) as i16 } else { (s * 32767.0) as i16 });
            self.total += 1;
            if self.buffer.len() >= self.part {
                out(self.write());
            }
        }
    }

    /// Writes the last part, if it holds enough sound.
    pub fn finish(mut self, out: &mut impl FnMut(Result<Part, String>)) {
        if self.buffer.len() >= SHORTEST_PART {
            out(self.write());
        }
    }

    fn write(&mut self) -> Result<Part, String> {
        let samples = std::mem::take(&mut self.buffer);
        let index = self.index;
        self.index += 1;
        let file = self.dir.join(format!("{}-{index}.wav", self.name));
        let start = (self.total - samples.len() as u64) as f64 / f64::from(RATE);
        std::fs::write(&file, wav16(&samples)).map_err(|e| format!("Part of the meeting could not be kept to write it down: {e}"))?;
        Ok(Part { index, start, seconds: samples.len() as f64 / f64::from(RATE), file, others: None })
    }
}

/// One channel at a device's rate down to 16 kHz: a low-pass filter below 8 kHz first, so nothing above it folds
/// back into the speech, then the resampler the recorder uses.
pub struct Downsample {
    taps: Vec<f32>,
    history: Vec<f32>,
    at: usize,
    resample: crate::record::Resample,
    filter: bool,
}

impl Downsample {
    #[must_use]
    pub fn new(from: u32) -> Downsample {
        let filter = from > RATE;
        // A windowed sinc (Blackman), cut off at 7 kHz.
        const N: usize = 63;
        let cut = 7_000.0 / f64::from(from.max(1));
        let mut taps: Vec<f32> = (0..N)
            .map(|i| {
                let m = i as f64 - (N - 1) as f64 / 2.0;
                let sinc = if m == 0.0 { 2.0 * cut } else { (2.0 * std::f64::consts::PI * cut * m).sin() / (std::f64::consts::PI * m) };
                let w = 0.42 - 0.5 * (2.0 * std::f64::consts::PI * i as f64 / (N - 1) as f64).cos() + 0.08 * (4.0 * std::f64::consts::PI * i as f64 / (N - 1) as f64).cos();
                (sinc * w) as f32
            })
            .collect();
        let sum: f32 = taps.iter().sum();
        taps.iter_mut().for_each(|t| *t /= sum);
        Downsample { history: vec![0.0; taps.len()], taps, at: 0, resample: crate::record::Resample::new(f64::from(from), f64::from(RATE)), filter }
    }

    /// Takes samples at the device's rate, adding those at 16 kHz to `out`.
    pub fn push(&mut self, samples: &[f32], out: &mut Vec<f32>) {
        for &s in samples {
            let filtered = if self.filter {
                self.history[self.at] = s;
                self.at = (self.at + 1) % self.history.len();
                let n = self.history.len();
                self.taps.iter().enumerate().map(|(i, t)| t * self.history[(self.at + i) % n]).sum()
            } else {
                s
            };
            self.resample.push((filtered, filtered), |(l, _)| out.push(l));
        }
    }
}

/// Where a meeting is heard from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Source {
    /// The default microphone.
    Microphone,
    /// A steady sound made here, for tests on computers with no microphone.
    Test,
}

/// A meeting being heard: a thread of its own holds the sound input and writes the parts until it is stopped or the
/// longest meeting is reached.
pub struct Capture {
    stop: Arc<AtomicBool>,
    heard: Arc<AtomicU64>,
    level: Arc<AtomicU32>,
    others: Option<String>,
    thread: Option<std::thread::JoinHandle<()>>,
}

/// Called with each finished part, and once at the end with the seconds heard (or why it stopped early).
pub type OnPart = Box<dyn FnMut(Result<Part, String>) + Send>;
pub type OnEnd = Box<dyn FnOnce(Result<f64, String>) + Send>;

/// How far the computer's sound may run behind or ahead of the microphone before it is evened up: a fifth of a
/// second, well inside a spoken word.
const SLACK: u64 = RATE as u64 / 5;

/// The second track, held to the microphone's clock. The computer sends nothing while it plays nothing, so a
/// silence is filled in; and the two devices' clocks drift apart slowly, so what runs ahead is dropped.
struct Others {
    input: Option<Input>,
    parts: Parts,
    down: Downsample,
    raw: Vec<f32>,
    out: Vec<f32>,
}

impl Others {
    fn new(input: Input, dir: &Path, part_seconds: u32, max_seconds: u32) -> Others {
        let down = Downsample::new(input.rate);
        Others { input: Some(input), parts: Parts::named(dir, "others", part_seconds, max_seconds), down, raw: Vec::with_capacity(8192), out: Vec::with_capacity(4096) }
    }

    /// Takes what came since last time and keeps the track within `SLACK` of `you`, the microphone's samples.
    fn hear(&mut self, you: u64, got: &mut impl FnMut(Result<Part, String>)) {
        self.out.clear();
        if let Some(input) = &mut self.input {
            // If it stops (the speakers were unplugged, say), the meeting goes on with silence for the other side.
            if input.take(&mut self.raw).is_some() {
                self.input = None;
            }
            self.down.push(&self.raw, &mut self.out);
            self.raw.clear();
        }
        let room = (you + SLACK).saturating_sub(self.parts.total()) as usize;
        self.out.truncate(room);
        self.parts.push(&self.out, got);
        self.fill(you.saturating_sub(SLACK), got);
    }

    /// Silence up to `until` samples.
    fn fill(&mut self, until: u64, got: &mut impl FnMut(Result<Part, String>)) {
        let missing = until.saturating_sub(self.parts.total()) as usize;
        if missing > 0 {
            self.parts.push(&vec![0.0; missing], got);
        }
    }
}

/// Pairs each part of the microphone with the same part of the computer's sound before handing it over.
#[derive(Default)]
struct Pairs {
    waiting: std::collections::BTreeMap<u32, (Option<Part>, Option<Part>)>,
}

impl Pairs {
    fn add(&mut self, you: bool, part: Part, on_part: &mut OnPart) {
        let entry = self.waiting.entry(part.index).or_default();
        if you {
            entry.0 = Some(part);
        } else {
            entry.1 = Some(part);
        }
        self.flush(false, on_part);
    }

    /// Hands over every part that has both tracks, in order; at the end, every microphone part (with the other track
    /// where there is one), and the files of any lone part of the other track are deleted.
    fn flush(&mut self, end: bool, on_part: &mut OnPart) {
        while let Some((&index, pair)) = self.waiting.iter().next() {
            let ready = matches!(pair, (Some(_), Some(_))) || end;
            if !ready {
                return;
            }
            let (you, others) = self.waiting.remove(&index).unwrap_or_default();
            match you {
                Some(mut you) => {
                    you.others = others.map(|o| o.file);
                    on_part(Ok(you));
                }
                None => {
                    if let Some(o) = others {
                        let _ = std::fs::remove_file(o.file);
                    }
                }
            }
        }
    }
}

impl Capture {
    /// Starts hearing from `source`, and also the computer's own sound when `others` is asked for and it can be heard
    /// here, writing parts to `dir`. Gives back the microphone's name once its first sound has come, or why it couldn't
    /// start.
    ///
    /// # Errors
    /// When there is no input, it can't be opened, or it sends no sound.
    pub fn start(source: Source, others: bool, dir: &Path, part_seconds: u32, max_seconds: u32, mut on_part: OnPart, on_end: OnEnd) -> Result<(Capture, String), String> {
        std::fs::create_dir_all(dir).map_err(|e| format!("Mobius could not make a folder for the meeting: {e}"))?;
        let stop = Arc::new(AtomicBool::new(false));
        let heard = Arc::new(AtomicU64::new(0));
        let level = Arc::new(AtomicU32::new(0));
        let (started_tx, started_rx) = std::sync::mpsc::channel::<Result<(String, Option<String>), String>>();
        let (s, h, l, dir) = (Arc::clone(&stop), Arc::clone(&heard), Arc::clone(&level), dir.to_path_buf());
        let thread = std::thread::Builder::new()
            .name("mobius-meeting".into())
            .spawn(move || {
                let mut input = match open(source) {
                    Ok(input) => input,
                    Err(e) => {
                        let _ = started_tx.send(Err(e));
                        return;
                    }
                };
                // The other side is a help, not a need: if it can't be heard, the meeting is still the microphone's.
                let mut second = if others { open_others(source).ok().flatten().map(|i| Others::new(i, &dir, part_seconds, max_seconds)) } else { None };
                let others_name = second.as_ref().and_then(|o| o.input.as_ref()).map(|i| i.name.clone());
                let _ = started_tx.send(Ok((input.name.clone(), others_name)));
                let mut parts = Parts::new(&dir, part_seconds, max_seconds);
                let mut down = Downsample::new(input.rate);
                let mut pairs = Pairs::default();
                let mut got: Vec<(bool, Result<Part, String>)> = Vec::new();
                let (mut raw, mut out) = (Vec::with_capacity(8192), Vec::with_capacity(4096));
                let mut ended = Ok(());
                let hand_over = |got: &mut Vec<(bool, Result<Part, String>)>, pairs: &mut Pairs, on_part: &mut OnPart, paired: bool| {
                    for (you, part) in got.drain(..) {
                        match part {
                            Ok(part) if paired => pairs.add(you, part, on_part),
                            Ok(part) if you => on_part(Ok(part)),
                            Ok(part) => {
                                let _ = std::fs::remove_file(part.file);
                            }
                            Err(e) => on_part(Err(e)),
                        }
                    }
                };
                while !s.load(Ordering::Acquire) && !parts.full() {
                    std::thread::sleep(std::time::Duration::from_millis(50));
                    if let Some(e) = input.take(&mut raw) {
                        ended = Err(e);
                        break;
                    }
                    out.clear();
                    down.push(&raw, &mut out);
                    raw.clear();
                    let peak = out.iter().fold(0.0f32, |m, v| m.max(v.abs()));
                    l.store(peak.to_bits(), Ordering::Relaxed);
                    parts.push(&out, &mut |p| got.push((true, p)));
                    if let Some(o) = &mut second {
                        o.hear(parts.total(), &mut |p| got.push((false, p)));
                    }
                    hand_over(&mut got, &mut pairs, &mut on_part, second.is_some());
                    h.store(parts.total(), Ordering::Relaxed);
                }
                drop(input);
                let seconds = parts.seconds();
                let you = parts.total();
                parts.finish(&mut |p| got.push((true, p)));
                if let Some(mut o) = second.take() {
                    o.input = None;
                    o.fill(you, &mut |p| got.push((false, p)));
                    o.parts.finish(&mut |p| got.push((false, p)));
                    hand_over(&mut got, &mut pairs, &mut on_part, true);
                    pairs.flush(true, &mut on_part);
                } else {
                    hand_over(&mut got, &mut pairs, &mut on_part, false);
                }
                on_end(ended.map(|()| seconds));
            })
            .map_err(|_| "Mobius could not start hearing the meeting.".to_owned())?;
        match started_rx.recv() {
            Ok(Ok((name, others))) => Ok((Capture { stop, heard, level, others, thread: Some(thread) }, name)),
            Ok(Err(e)) => {
                let _ = thread.join();
                Err(e)
            }
            Err(_) => Err("Mobius could not start hearing the meeting.".into()),
        }
    }

    /// The name of what the computer's sound is heard from, when it is.
    #[must_use]
    pub fn others(&self) -> Option<&str> {
        self.others.as_deref()
    }

    /// The seconds heard so far.
    #[must_use]
    pub fn seconds(&self) -> f64 {
        self.heard.load(Ordering::Relaxed) as f64 / f64::from(RATE)
    }

    /// How loud the last moment was, from 0 to 1.
    #[must_use]
    pub fn level(&self) -> f32 {
        f32::from_bits(self.level.load(Ordering::Relaxed))
    }

    /// Stops hearing; the last part is written and the end called before this returns.
    pub fn stop(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

impl Drop for Capture {
    fn drop(&mut self) {
        self.stop();
    }
}

/// A sound input, mono at its own rate, handed over in blocks.
struct Input {
    name: String,
    rate: u32,
    queue: rtrb::Consumer<f32>,
    failed: Arc<std::sync::Mutex<Option<String>>>,
    #[cfg(any(windows, target_os = "macos"))]
    _stream: Option<cpal::Stream>,
    _test: Option<TestSound>,
}

impl Input {
    /// Moves what has come into `into`, or says why the input stopped.
    fn take(&mut self, into: &mut Vec<f32>) -> Option<String> {
        if let Some(e) = self.failed.lock().unwrap_or_else(std::sync::PoisonError::into_inner).take() {
            return Some(e);
        }
        while let Ok(s) = self.queue.pop() {
            into.push(s);
        }
        None
    }
}

/// Room for a second of sound at 48 kHz: the meeting's thread takes it every 50 ms.
const QUEUE: usize = 48_000;

/// The test sound: a quiet tone at 48 kHz, made in real time on a thread of its own until dropped.
struct TestSound {
    stop: Arc<AtomicBool>,
    thread: Option<std::thread::JoinHandle<()>>,
}

impl Drop for TestSound {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

fn open(source: Source) -> Result<Input, String> {
    match source {
        Source::Test => test_sound("Test sound", 440.0, false),
        Source::Microphone => microphone(Arc::new(std::sync::Mutex::new(None))),
    }
}

/// The computer's own sound, where it can be heard: `None` where it can't.
fn open_others(source: Source) -> Result<Option<Input>, String> {
    match source {
        // Played only every other half second, and nothing sent between, as the computer does in a pause of a call.
        Source::Test => test_sound("Test playback", 660.0, true).map(Some),
        Source::Microphone => loopback(Arc::new(std::sync::Mutex::new(None))),
    }
}

/// A quiet tone at 48 kHz, made in real time on a thread of its own until dropped; with `gaps`, nothing is sent in
/// every other half second.
fn test_sound(name: &str, hz: f64, gaps: bool) -> Result<Input, String> {
    let (mut producer, queue) = rtrb::RingBuffer::<f32>::new(QUEUE);
    let stop = Arc::new(AtomicBool::new(false));
    let s = Arc::clone(&stop);
    let thread = std::thread::Builder::new()
        .name("mobius-meeting-test".into())
        .spawn(move || {
            let (start, mut made) = (std::time::Instant::now(), 0u64);
            while !s.load(Ordering::Acquire) {
                let due = (start.elapsed().as_secs_f64() * 48_000.0) as u64;
                while made < due {
                    let t = made as f64 / 48_000.0;
                    if !gaps || (t * 2.0) as u64 % 2 == 1 {
                        let _ = producer.push((0.2 * (2.0 * std::f64::consts::PI * hz * t).sin()) as f32);
                    }
                    made += 1;
                }
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
        })
        .map_err(|_| "Mobius could not start hearing the meeting.".to_owned())?;
    Ok(Input {
        name: name.into(),
        rate: 48_000,
        queue,
        failed: Arc::new(std::sync::Mutex::new(None)),
        #[cfg(any(windows, target_os = "macos"))]
        _stream: None,
        _test: Some(TestSound { stop, thread: Some(thread) }),
    })
}

#[cfg(any(windows, target_os = "macos"))]
fn microphone(failed: Arc<std::sync::Mutex<Option<String>>>) -> Result<Input, String> {
    use cpal::traits::{DeviceTrait, HostTrait};
    let device = cpal::default_host().default_input_device().ok_or("This computer has no microphone connected.")?;
    let name = device.name().unwrap_or_else(|_| "Microphone".to_owned());
    let config = device.default_input_config().map_err(|e| format!("{name} could not be opened: {e}"))?;
    let (input, frames) = stream(&device, &config, name, "The microphone stopped", failed)?;
    // Wait (up to a second) for its first sound, so a microphone that opens but never starts says so now.
    for _ in 0..100 {
        if frames.load(Ordering::Relaxed) > 0 {
            return Ok(input);
        }
        if let Some(e) = input.failed.lock().unwrap_or_else(std::sync::PoisonError::into_inner).take() {
            return Err(e);
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    Err(format!("{} opened but sent no sound. Check that Windows lets desktop apps use the microphone.", input.name))
}

/// What the computer plays, from its default speakers or headphones: cpal hears an output device opened as an input
/// through WASAPI loopback. Nothing comes while nothing plays, so there is no first sound to wait for.
#[cfg(windows)]
fn loopback(failed: Arc<std::sync::Mutex<Option<String>>>) -> Result<Option<Input>, String> {
    use cpal::traits::{DeviceTrait, HostTrait};
    let Some(device) = cpal::default_host().default_output_device() else { return Ok(None) };
    let name = device.name().unwrap_or_else(|_| "Speakers".to_owned());
    let config = device.default_output_config().map_err(|e| format!("{name} could not be heard: {e}"))?;
    stream(&device, &config, name, "The computer's sound stopped being heard", failed).map(|(input, _)| Some(input))
}

#[cfg(not(windows))]
#[allow(clippy::unnecessary_wraps)]
fn loopback(_failed: Arc<std::sync::Mutex<Option<String>>>) -> Result<Option<Input>, String> {
    Ok(None)
}

/// Opens `device` as an input, each frame's channels averaged into one; the callback only copies, the meeting's thread
/// does the rest. Also gives back a count of the frames that have come.
#[cfg(any(windows, target_os = "macos"))]
fn stream(device: &cpal::Device, config: &cpal::SupportedStreamConfig, name: String, stopped: &'static str, failed: Arc<std::sync::Mutex<Option<String>>>) -> Result<(Input, Arc<AtomicU64>), String> {
    use cpal::traits::{DeviceTrait, StreamTrait};
    let (rate, channels, format) = (config.sample_rate().0, usize::from(config.channels()).max(1), config.sample_format());
    let config: cpal::StreamConfig = config.clone().into();
    let (producer, queue) = rtrb::RingBuffer::<f32>::new(QUEUE.max(rate as usize));
    let frames = Arc::new(AtomicU64::new(0));
    let errors = {
        let failed = Arc::clone(&failed);
        move |e: cpal::StreamError| *failed.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = Some(format!("{stopped}: {e}"))
    };
    fn into_queue<T: Copy>(producer: &mut rtrb::Producer<f32>, frames: &AtomicU64, data: &[T], channels: usize, sample: impl Fn(T) -> f32) {
        for frame in data.chunks_exact(channels) {
            let mono = frame.iter().map(|&s| sample(s)).sum::<f32>() / channels as f32;
            if producer.push(mono).is_err() {
                break;
            }
        }
        frames.fetch_add((data.len() / channels) as u64, Ordering::Relaxed);
    }
    let count = Arc::clone(&frames);
    let stream = match format {
        cpal::SampleFormat::F32 => {
            let mut producer = producer;
            device.build_input_stream(&config, move |data: &[f32], _: &cpal::InputCallbackInfo| into_queue(&mut producer, &count, data, channels, |s| s), errors, None)
        }
        cpal::SampleFormat::I16 => {
            let mut producer = producer;
            device.build_input_stream(&config, move |data: &[i16], _: &cpal::InputCallbackInfo| into_queue(&mut producer, &count, data, channels, |s| f32::from(s) / 32768.0), errors, None)
        }
        other => return Err(format!("{name} records in a format Mobius doesn't take ({other}).")),
    }
    .map_err(|e| format!("{name} could not be opened: {e}"))?;
    stream.play().map_err(|e| format!("{name} could not start: {e}"))?;
    Ok((Input { name, rate, queue, failed, _stream: Some(stream), _test: None }, frames))
}

#[cfg(not(any(windows, target_os = "macos")))]
fn microphone(_failed: Arc<std::sync::Mutex<Option<String>>>) -> Result<Input, String> {
    Err("Mobius can't hear the microphone itself on this system yet.".into())
}

/// Whether the microphone can be heard here (rather than through the window).
#[must_use]
pub const fn microphone_here() -> bool {
    cfg!(any(windows, target_os = "macos"))
}

/// Whether the computer's own sound, the other side of a call, can be heard here: Windows for now (macOS needs a
/// process tap of its own, voice-plan.md section 2).
#[must_use]
pub const fn others_here() -> bool {
    cfg!(windows)
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    type Got = Arc<std::sync::Mutex<Vec<Part>>>;

    fn collect() -> (Got, impl FnMut(Result<Part, String>)) {
        let got = Arc::new(std::sync::Mutex::new(Vec::new()));
        let g = Arc::clone(&got);
        (got, move |p: Result<Part, String>| g.lock().unwrap().push(p.unwrap()))
    }

    #[test]
    fn sound_is_cut_into_parts_with_their_times_and_a_short_end_is_dropped() {
        let dir = tempfile::tempdir().unwrap();
        let (got, mut out) = collect();
        let mut parts = Parts::new(dir.path(), 2, 60);
        // 4.1 seconds: two whole parts, and a tenth of a second that is too short to keep.
        parts.push(&vec![0.1; (4.1 * f64::from(RATE)) as usize], &mut out);
        parts.finish(&mut out);
        let got = got.lock().unwrap();
        assert_eq!(got.iter().map(|p| (p.index, p.start, p.seconds)).collect::<Vec<_>>(), vec![(0, 0.0, 2.0), (1, 2.0, 2.0)]);
        let wav = std::fs::read(&got[1].file).unwrap();
        assert_eq!(wav.len(), 44 + 2 * 2 * RATE as usize);
        assert_eq!(&wav[0..4], b"RIFF");
        assert_eq!(u32::from_le_bytes([wav[24], wav[25], wav[26], wav[27]]), RATE);
    }

    #[test]
    fn a_last_part_long_enough_is_kept_and_the_longest_meeting_stops_the_sound() {
        let dir = tempfile::tempdir().unwrap();
        let (got, mut out) = collect();
        let mut parts = Parts::new(dir.path(), 2, 3);
        parts.push(&vec![0.0; 10 * RATE as usize], &mut out);
        assert!(parts.full());
        assert!((parts.seconds() - 3.0).abs() < 1e-9);
        parts.finish(&mut out);
        let got = got.lock().unwrap();
        assert_eq!(got.iter().map(|p| (p.start, p.seconds)).collect::<Vec<_>>(), vec![(0.0, 2.0), (2.0, 1.0)]);
    }

    #[test]
    fn down_to_16_khz_keeps_speech_and_drops_what_would_fold_back() {
        let tone = |hz: f64, rate: f64, n: usize| (0..n).map(|i| (2.0 * std::f64::consts::PI * hz * i as f64 / rate).sin() as f32).collect::<Vec<f32>>();
        let rms = |s: &[f32]| (s.iter().skip(200).map(|v| v * v).sum::<f32>() / (s.len() - 200) as f32).sqrt();
        let mut out = Vec::new();
        Downsample::new(48_000).push(&tone(1_000.0, 48_000.0, 48_000), &mut out);
        assert!((out.len() as i64 - 16_000).abs() <= 2, "{}", out.len());
        assert!(rms(&out) > 0.6, "a 1 kHz voice stays: {}", rms(&out));
        let mut out = Vec::new();
        Downsample::new(48_000).push(&tone(12_000.0, 48_000.0, 48_000), &mut out);
        assert!(rms(&out) < 0.05, "12 kHz would fold back to 4 kHz: {}", rms(&out));
    }

    #[test]
    fn the_test_sound_is_heard_in_parts_and_stopping_writes_the_last() {
        let dir = tempfile::tempdir().unwrap();
        let (got, out) = collect();
        let (end_tx, end_rx) = std::sync::mpsc::channel();
        let (mut capture, name) = Capture::start(Source::Test, false, dir.path(), 1, 60, Box::new(out), Box::new(move |r| end_tx.send(r).unwrap())).unwrap();
        assert_eq!(name, "Test sound");
        std::thread::sleep(std::time::Duration::from_millis(1600));
        assert!(capture.seconds() > 1.0);
        assert!(capture.level() > 0.1);
        capture.stop();
        let seconds = end_rx.recv().unwrap().unwrap();
        assert!(seconds > 1.3 && seconds < 2.5, "{seconds}");
        let got = got.lock().unwrap();
        assert_eq!(got.len(), 2, "one whole part and the rest");
        assert!(got.iter().all(|p| p.file.is_file() && p.others.is_none()));
        assert!(capture.others().is_none());
    }

    fn samples(file: &Path) -> Vec<i16> {
        std::fs::read(file).unwrap()[44..].chunks_exact(2).map(|b| i16::from_le_bytes([b[0], b[1]])).collect()
    }

    #[test]
    fn the_computers_sound_comes_with_each_part_on_the_same_clock_its_pauses_kept_as_silence() {
        let dir = tempfile::tempdir().unwrap();
        let (got, out) = collect();
        let (end_tx, end_rx) = std::sync::mpsc::channel();
        let (mut capture, _) = Capture::start(Source::Test, true, dir.path(), 1, 60, Box::new(out), Box::new(move |r| end_tx.send(r).unwrap())).unwrap();
        assert_eq!(capture.others(), Some("Test playback"));
        std::thread::sleep(std::time::Duration::from_millis(2600));
        capture.stop();
        end_rx.recv().unwrap().unwrap();
        let got = got.lock().unwrap();
        assert!(got.len() >= 2, "{}", got.len());
        for part in got.iter() {
            let (you, others) = (samples(&part.file), samples(part.others.as_ref().unwrap()));
            assert!(you.len().abs_diff(others.len()) <= SLACK as usize, "part {}: {} and {}", part.index, you.len(), others.len());
        }
        // The first whole second: the playback's pause, then its tone, each about half of it.
        let first = samples(got[0].others.as_ref().unwrap());
        let loud = first.chunks(320).filter(|c| c.iter().any(|s| s.unsigned_abs() > 3000)).count();
        let frames = first.len() / 320;
        assert!(loud > frames / 4 && loud < frames * 3 / 4, "{loud} of {frames}");
    }

    /// An input fed by hand at 16 kHz.
    fn by_hand() -> (rtrb::Producer<f32>, Input) {
        let (producer, queue) = rtrb::RingBuffer::<f32>::new(4 * RATE as usize);
        let input = Input {
            name: "By hand".into(),
            rate: RATE,
            queue,
            failed: Arc::new(std::sync::Mutex::new(None)),
            #[cfg(any(windows, target_os = "macos"))]
            _stream: None,
            _test: None,
        };
        (producer, input)
    }

    #[test]
    fn the_second_track_is_filled_while_silent_and_trimmed_when_it_runs_ahead() {
        let dir = tempfile::tempdir().unwrap();
        let (mut producer, input) = by_hand();
        let mut others = Others::new(input, dir.path(), 60, 600);
        let mut none = |_: Result<Part, String>| {};
        // Nothing played for a second: silence, kept within the slack of the microphone.
        others.hear(u64::from(RATE), &mut none);
        assert_eq!(others.parts.total(), u64::from(RATE) - SLACK);
        // Two seconds come at once, with the microphone at two: no more than the slack ahead of it.
        for _ in 0..2 * RATE {
            producer.push(0.1).unwrap();
        }
        others.hear(2 * u64::from(RATE), &mut none);
        assert_eq!(others.parts.total(), 2 * u64::from(RATE) + SLACK);
    }

    #[test]
    fn a_part_is_handed_over_once_both_tracks_have_it_and_a_lone_second_track_is_deleted() {
        let dir = tempfile::tempdir().unwrap();
        let handed: Got = Arc::default();
        let h = Arc::clone(&handed);
        let mut on_part: OnPart = Box::new(move |p| h.lock().unwrap().push(p.unwrap()));
        let part = |index: u32, name: &str| {
            let file = dir.path().join(format!("{name}-{index}.wav"));
            std::fs::write(&file, b"x").unwrap();
            Part { index, start: f64::from(index), seconds: 1.0, file, others: None }
        };
        let mut pairs = Pairs::default();
        pairs.add(true, part(0, "part"), &mut on_part);
        assert!(handed.lock().unwrap().is_empty(), "waits for the other track");
        pairs.add(true, part(1, "part"), &mut on_part);
        pairs.add(false, part(0, "others"), &mut on_part);
        assert_eq!(handed.lock().unwrap().iter().map(|p| p.index).collect::<Vec<_>>(), vec![0]);
        assert_eq!(handed.lock().unwrap()[0].others, Some(dir.path().join("others-0.wav")));
        pairs.add(false, part(2, "others"), &mut on_part);
        pairs.flush(true, &mut on_part);
        let handed = handed.lock().unwrap();
        assert_eq!(handed.iter().map(|p| (p.index, p.others.is_some())).collect::<Vec<_>>(), vec![(0, true), (1, false)]);
        assert!(!dir.path().join("others-2.wav").exists());
    }
}
