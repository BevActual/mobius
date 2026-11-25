//! Listening on this computer, for free: `mobius-voice` (crates/mobius-voice) with Whisper and Silero VAD. Neither the
//! program nor the models are in the installer. When the person sets it up in Settings, Voice, Mobius downloads the
//! program for this computer and the models from its own `voice-0.1.0` prerelease (`.github/workflows/voice.yml`),
//! checks each file against the SHA-256 pinned below (never against anything fetched), and keeps them in Mobius's
//! folder. The program runs only while it's used: it is started on the first recording and stopped after a few idle
//! minutes, so its models don't hold memory.
//!
//! The window follows the download as `mobius:voice-device` events: `{ state, done, total, message, offline, model }`.

use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{Receiver, RecvTimeoutError, channel};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// Where the files are published: a prerelease that is never Latest.
const RELEASE: &str = "https://github.com/BevActual/mobius/releases/download/voice-0.1.0/";
/// The program for each computer and its SHA-256, from the workflow's run.
const PROGRAMS: &[(&str, &str, &str)] = &[];
/// The name it is kept under: a new version is a new file, so an old build is never run by mistake.
const PROGRAM: &str = "mobius-voice-0.1.0";
/// A file of a model: its name in the release, its size and its SHA-256 (the same bytes as sherpa-onnx's asr-models).
struct File {
    name: &'static str,
    size: u64,
    sha: &'static str,
}
const VAD: File = File { name: "silero_vad.onnx", size: 643_854, sha: "9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6" };
/// The Whisper models to choose from: (`listenModel`, encoder, decoder, tokens). The English ones only, for now.
const WHISPER: &[(&str, File, File, File)] = &[
    (
        "base.en",
        File { name: "whisper-base.en-encoder.int8.onnx", size: 29_120_534, sha: "ef6b936f4c9b1d90a3b68634b60c4ed8576b26172b33c2535ec0e933c9edb823" },
        File { name: "whisper-base.en-decoder.int8.onnx", size: 130_669_978, sha: "f7162ad6db2dbef16cfaeaa7f945b9d7dd9c1b8d472f6aca82f2273d185e4d41" },
        File { name: "whisper-base.en-tokens.txt", size: 835_554, sha: "306cd27f03c1a714eca7108e03d66b7dc042abe8c258b44c199a7ed9838dd930" },
    ),
    (
        "small.en",
        File { name: "whisper-small.en-encoder.int8.onnx", size: 112_442_483, sha: "8bdac288f369aa94ee2194059238c465ed82ea9d47ee8fa4a8c0a891873e462f" },
        File { name: "whisper-small.en-decoder.int8.onnx", size: 262_223_042, sha: "710ccf890e10f3faa15f51ec346081a2723c9f3adb6e4da81c6573a5a6f877fb" },
        File { name: "whisper-small.en-tokens.txt", size: 835_554, sha: "306cd27f03c1a714eca7108e03d66b7dc042abe8c258b44c199a7ed9838dd930" },
    ),
];
/// The model chosen when none is: quick enough for dictation on most computers.
pub const DEFAULT_MODEL: &str = "base.en";
/// The program is stopped once it has had nothing to do for this long.
const IDLE: Duration = Duration::from_secs(5 * 60);
/// The longest one recording may take to write down before the program is stopped.
const ANSWER_WITHIN: Duration = Duration::from_secs(5 * 60);
/// Larger than any file here (the largest is about 262 MB); a download past this is stopped.
const MAX_BYTES: u64 = 512 * 1024 * 1024;
const EVENT: &str = "mobius:voice-device";

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// Whether listening on this computer can be set up here at all: there is a build of the program for it.
#[must_use]
pub fn available() -> bool {
    program_build().is_some()
}

fn program_build() -> Option<(&'static str, &'static str)> {
    let key = format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH);
    PROGRAMS.iter().find(|(k, _, _)| *k == key).map(|(_, file, sha)| (*file, *sha))
}

fn whisper(model: &str) -> Option<&'static (&'static str, File, File, File)> {
    WHISPER.iter().find(|(m, ..)| *m == model)
}

/// What a model takes on disk, with the speech detector; the program comes on top.
#[must_use]
pub fn model_bytes(model: &str) -> u64 {
    whisper(model).map_or(0, |(_, e, d, t)| e.size + d.size + t.size + VAD.size)
}

/// What listening on this computer is doing.
#[derive(Debug, Clone, PartialEq)]
pub enum State {
    /// Not set up (or not this model).
    Absent,
    Downloading { done: u64, total: u64 },
    Ready,
    /// Setting up failed. `offline` when the computer couldn't reach GitHub at all: try again later.
    Failed { message: String, offline: bool },
}

impl State {
    fn to_json(&self, model: &str) -> Value {
        let mut v = match self {
            State::Absent => json!({ "state": "absent" }),
            State::Downloading { done, total } => json!({ "state": "downloading", "done": done, "total": total }),
            State::Ready => json!({ "state": "ready" }),
            State::Failed { message, offline } => json!({ "state": "failed", "message": message, "offline": offline }),
        };
        v["model"] = json!(model);
        v["available"] = json!(available());
        v["bytes"] = json!(model_bytes(model));
        v
    }
}

/// The program while it runs: its input, its answers as they come, and when it was last asked.
struct Running {
    child: Child,
    input: ChildStdin,
    answers: Receiver<String>,
    used: Instant,
}

pub struct DeviceVoice {
    dir: PathBuf,
    release: String,
    program: Option<(String, String)>,
    state: Mutex<(String, State)>,
    busy: AtomicBool,
    emit: crate::bridge::Emit,
    running: Arc<Mutex<Option<Running>>>,
    next_id: AtomicU64,
}

fn failed(message: impl Into<String>) -> Value {
    json!({ "ok": false, "error": message.into() })
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Why a download failed, in words, and whether it was the connection.
struct Failure(String, bool);

impl DeviceVoice {
    /// Listening on this computer, kept in `dir` (Mobius's data folder `/voice`).
    pub fn new(dir: PathBuf, emit: crate::bridge::Emit) -> DeviceVoice {
        let program = program_build().map(|(f, s)| (f.to_owned(), s.to_owned()));
        DeviceVoice::serving(dir, emit, RELEASE.to_owned(), program)
    }

    fn serving(dir: PathBuf, emit: crate::bridge::Emit, release: String, program: Option<(String, String)>) -> DeviceVoice {
        DeviceVoice { dir, release, program, state: Mutex::new((String::new(), State::Absent)), busy: AtomicBool::new(false), emit, running: Arc::new(Mutex::new(None)), next_id: AtomicU64::new(1) }
    }

    fn program_path(&self) -> PathBuf {
        self.dir.join(format!("{PROGRAM}{}", std::env::consts::EXE_SUFFIX))
    }

    fn file_path(&self, file: &File) -> PathBuf {
        self.dir.join("models").join(file.name)
    }

    /// Whether the program and this model are all here. Sizes are checked, not hashes: each was checked on arrival.
    #[must_use]
    pub fn ready(&self, model: &str) -> bool {
        let Some((_, e, d, t)) = whisper(model) else { return false };
        self.program_path().is_file() && [&VAD, e, d, t].iter().all(|f| std::fs::metadata(self.file_path(f)).is_ok_and(|m| m.len() == f.size))
    }

    /// What it's doing for this model.
    pub fn status(&self, model: &str) -> Value {
        let (busy_model, state) = lock(&self.state).clone();
        let state = if busy_model == model && !matches!(state, State::Absent) && !(matches!(state, State::Ready) && !self.ready(model)) { state } else if self.ready(model) { State::Ready } else { State::Absent };
        state.to_json(model)
    }

    fn set(&self, model: &str, state: State) {
        (self.emit)(EVENT, state.to_json(model));
        *lock(&self.state) = (model.to_owned(), state);
    }

    /// Downloads the program and the model, on a thread of its own; the window follows `mobius:voice-device`. Asked
    /// again while on its way, it does nothing; after a failure it tries again.
    pub fn setup(self: &Arc<Self>, model: &str) -> Value {
        if whisper(model).is_none() {
            return failed("That is not a model Mobius can listen with.");
        }
        if self.ready(model) {
            self.set(model, State::Ready);
            return self.status(model);
        }
        if self.busy.swap(true, Ordering::AcqRel) {
            return self.status(model);
        }
        let me = Arc::clone(self);
        let asked = model.to_owned();
        let model = model.to_owned();
        let spawned = std::thread::Builder::new().name("mobius-voice-setup".into()).spawn(move || {
            let state = match me.fetch_all(&model) {
                Ok(()) => State::Ready,
                Err(Failure(message, offline)) => State::Failed { message, offline },
            };
            me.set(&model, state);
            me.busy.store(false, Ordering::Release);
        });
        if spawned.is_err() {
            self.busy.store(false, Ordering::Release);
            return failed("Mobius could not start setting up listening.");
        }
        State::Downloading { done: 0, total: model_bytes(&asked) }.to_json(&asked)
    }

    fn fetch_all(&self, model: &str) -> Result<(), Failure> {
        let Some((program, program_sha)) = self.program.clone() else {
            return Err(Failure("Listening on this computer isn't available on this computer yet.".into(), false));
        };
        let Some((_, e, d, t)) = whisper(model) else { return Err(Failure("That is not a model Mobius can listen with.".into(), false)) };
        let files: Vec<&File> = [&VAD, e, d, t].into_iter().filter(|f| !std::fs::metadata(self.file_path(f)).is_ok_and(|m| m.len() == f.size)).collect();
        let program_here = self.program_path().is_file();
        let total: u64 = files.iter().map(|f| f.size).sum::<u64>() + if program_here { 0 } else { 15 * 1024 * 1024 };
        let mut done = 0u64;
        std::fs::create_dir_all(self.dir.join("models")).map_err(|e| Failure(format!("Mobius could not make its folder for listening: {e}"), false))?;
        self.set(model, State::Downloading { done, total });
        if !program_here {
            let packed = self.dir.join(format!("{PROGRAM}.gz.part"));
            self.download(&program, &program_sha, &packed, model, &mut done, total)?;
            let part = self.dir.join(format!("{PROGRAM}.part"));
            let unpacked = std::fs::File::open(&packed).and_then(|f| {
                let mut gz = flate2::read::GzDecoder::new(f).take(MAX_BYTES);
                let mut to = std::fs::File::create(&part)?;
                std::io::copy(&mut gz, &mut to)?;
                to.sync_all()
            });
            let _ = std::fs::remove_file(&packed);
            unpacked.map_err(|e| Failure(format!("Mobius could not unpack the listening program: {e}"), false))?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&part, std::fs::Permissions::from_mode(0o755)).map_err(|e| Failure(format!("Mobius could not unpack the listening program: {e}"), false))?;
            }
            std::fs::rename(&part, self.program_path()).map_err(|e| Failure(format!("Mobius could not unpack the listening program: {e}"), false))?;
        }
        for file in files {
            let part = self.dir.join("models").join(format!("{}.part", file.name));
            self.download(file.name, file.sha, &part, model, &mut done, total)?;
            std::fs::rename(&part, self.file_path(file)).map_err(|e| Failure(format!("Mobius could not save the speech model: {e}"), false))?;
        }
        Ok(())
    }

    /// One file from the release into `to`, checked against `sha`. A file that doesn't match is deleted.
    fn download(&self, name: &str, sha: &str, to: &Path, model: &str, done: &mut u64, total: u64) -> Result<(), Failure> {
        let agent: ureq::Agent = ureq::Agent::config_builder().timeout_connect(Some(Duration::from_secs(15))).timeout_recv_body(Some(Duration::from_secs(60))).build().into();
        let mut response = agent.get(&format!("{}{name}", self.release)).call().map_err(|e| match e {
            ureq::Error::StatusCode(code) => Failure(format!("The speech model could not be downloaded (GitHub answered {code})."), false),
            _ => Failure("Mobius couldn't reach GitHub to download the speech model. Check the connection and try again.".into(), true),
        })?;
        if response.body().content_length().is_some_and(|n| n > MAX_BYTES) {
            return Err(Failure("A download was larger than expected, so it was stopped.".into(), false));
        }
        let saving = |e: std::io::Error| Failure(format!("Mobius could not save the speech model: {e}"), false);
        let mut out = std::fs::File::create(to).map_err(saving)?;
        let mut reader = response.body_mut().with_config().limit(MAX_BYTES).reader();
        let (mut hasher, mut buffer, mut told) = (Sha256::new(), vec![0u8; 256 * 1024], Instant::now());
        loop {
            let n = match reader.read(&mut buffer) {
                Ok(n) => n,
                Err(_) => {
                    drop(out);
                    let _ = std::fs::remove_file(to);
                    return Err(Failure("The download was cut off. Check the connection and try again.".into(), true));
                }
            };
            if n == 0 {
                break;
            }
            hasher.update(&buffer[..n]);
            out.write_all(&buffer[..n]).map_err(saving)?;
            *done += n as u64;
            if told.elapsed() > Duration::from_millis(150) {
                told = Instant::now();
                self.set(model, State::Downloading { done: *done, total: total.max(*done) });
            }
        }
        drop(out);
        if hex(&hasher.finalize()) != sha {
            let _ = std::fs::remove_file(to);
            return Err(Failure("A file that was downloaded doesn't match the one Mobius expects, so it wasn't used.".into(), false));
        }
        Ok(())
    }

    /// Takes the program and every model off this computer.
    pub fn remove(&self, model: &str) -> Value {
        if self.busy.load(Ordering::Acquire) {
            return failed("Wait for the download to finish first.");
        }
        self.stop();
        let gone = |p: &Path| match std::fs::remove_file(p) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e),
        };
        let mut result = gone(&self.program_path());
        for (_, e, d, t) in WHISPER {
            for f in [e, d, t] {
                result = result.and(gone(&self.file_path(f)));
            }
        }
        result = result.and(gone(&self.file_path(&VAD)));
        match result {
            Ok(()) => {
                self.set(model, State::Absent);
                json!({ "ok": true })
            }
            Err(e) => failed(format!("Mobius could not remove every file: {e}")),
        }
    }

    /// Stops the program if it runs.
    pub fn stop(&self) {
        if let Some(mut running) = lock(&self.running).take() {
            let _ = running.child.kill();
            let _ = running.child.wait();
        }
    }

    fn start(&self) -> Result<Running, String> {
        let log = std::fs::File::create(self.dir.join("voice.log")).map_err(|e| format!("Mobius could not start listening: {e}"))?;
        let mut command = Command::new(self.program_path());
        command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(log);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x0800_0000); // no console window
        }
        let mut child = command.spawn().map_err(|e| format!("The listening program could not start: {e}"))?;
        let input = child.stdin.take().ok_or("The listening program could not start.")?;
        let output = child.stdout.take().ok_or("The listening program could not start.")?;
        let (send, answers) = channel();
        std::thread::Builder::new()
            .name("mobius-voice-answers".into())
            .spawn(move || {
                for line in BufReader::new(output).lines() {
                    let Ok(line) = line else { break };
                    if send.send(line).is_err() {
                        break;
                    }
                }
            })
            .map_err(|_| "The listening program could not start.".to_owned())?;
        let running = Arc::downgrade(&self.running);
        let _ = std::thread::Builder::new().name("mobius-voice-idle".into()).spawn(move || {
            loop {
                std::thread::sleep(Duration::from_secs(30));
                let Some(running) = running.upgrade() else { return };
                let mut slot = lock(&running);
                match slot.as_mut() {
                    Some(r) if r.used.elapsed() >= IDLE => {
                        let _ = r.child.kill();
                        let _ = r.child.wait();
                        *slot = None;
                        return;
                    }
                    Some(_) => {}
                    None => return,
                }
            }
        });
        Ok(Running { child, input, answers, used: Instant::now() })
    }

    /// Sends one request and waits for its answer. The program is started if it isn't running, and stopped if it
    /// doesn't answer in time or goes away.
    fn ask(&self, request: &Value) -> Result<Value, String> {
        let mut slot = lock(&self.running);
        if slot.as_mut().is_some_and(|r| r.child.try_wait().ok().flatten().is_some()) {
            *slot = None;
        }
        if slot.is_none() {
            *slot = Some(self.start()?);
        }
        let Some(running) = slot.as_mut() else { return Err("The listening program could not start.".into()) };
        let id = request["id"].clone();
        let sent = writeln!(running.input, "{request}").and_then(|()| running.input.flush());
        let answer = sent.map_err(|_| RecvTimeoutError::Disconnected).and_then(|()| {
            let deadline = Instant::now() + ANSWER_WITHIN;
            loop {
                let line = running.answers.recv_timeout(deadline.saturating_duration_since(Instant::now()))?;
                if let Ok(v) = serde_json::from_str::<Value>(&line) {
                    if v["id"] == id {
                        return Ok(v);
                    }
                }
            }
        });
        running.used = Instant::now();
        match answer {
            Ok(v) => Ok(v),
            Err(gone) => {
                if let Some(mut r) = slot.take() {
                    let _ = r.child.kill();
                    let _ = r.child.wait();
                }
                Err(match gone {
                    RecvTimeoutError::Timeout => "Listening on this computer took too long, so it was stopped.".into(),
                    RecvTimeoutError::Disconnected => format!("The listening program stopped. Its log is in {}.", self.dir.join("voice.log").display()),
                })
            }
        }
    }

    /// Writes down a 16 kHz mono WAV with `model`: the words, and each piece with its times.
    pub fn transcribe(&self, wav: &[u8], model: &str) -> Value {
        let Some((_, e, d, t)) = whisper(model) else { return failed("That is not a model Mobius can listen with.") };
        if !self.ready(model) {
            return json!({ "ok": false, "error": "Listening on this computer isn't set up yet. Set it up in Settings, Voice.", "setup": true });
        }
        if !is_listening_wav(wav) {
            return json!({ "ok": false, "error": "Listening on this computer takes a 16 kHz recording.", "wav": true });
        }
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let file = self.dir.join(format!("recording-{id}.wav"));
        if let Err(e) = std::fs::write(&file, wav) {
            return failed(format!("Mobius could not keep the recording to write it down: {e}"));
        }
        let path = |p: PathBuf| p.to_string_lossy().into_owned();
        let request = json!({
            "id": id, "op": "transcribe", "audio": path(file.clone()),
            "whisper": { "encoder": path(self.file_path(e)), "decoder": path(self.file_path(d)), "tokens": path(self.file_path(t)) },
            "vad": path(self.file_path(&VAD)), "language": "en",
        });
        let answer = self.ask(&request);
        let _ = std::fs::remove_file(&file);
        match answer {
            Ok(v) if v["ok"] == true => words(&v),
            Ok(v) => failed(v["error"].as_str().unwrap_or("Listening on this computer failed.")),
            Err(message) => failed(message),
        }
    }
}

impl Drop for DeviceVoice {
    fn drop(&mut self) {
        self.stop();
    }
}

/// The program's answer as the window takes it: the words in one go, and the pieces with their times.
fn words(answer: &Value) -> Value {
    let segments = answer["segments"].as_array().cloned().unwrap_or_default();
    let text: String = segments.iter().filter_map(|s| s["text"].as_str()).map(str::trim).filter(|s| !s.is_empty()).collect::<Vec<_>>().join(" ");
    let text: String = text.chars().take(20_000).collect();
    if text.is_empty() { failed("No speech was heard.") } else { json!({ "ok": true, "text": text, "segments": segments }) }
}

/// Whether `bytes` is what the program takes: a PCM WAV, 16 kHz, one channel, 16 bits.
#[must_use]
pub fn is_listening_wav(bytes: &[u8]) -> bool {
    if bytes.len() < 44 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return false;
    }
    let u16_at = |i: usize| bytes.get(i..i + 2).map(|b| u16::from_le_bytes([b[0], b[1]]));
    let u32_at = |i: usize| bytes.get(i..i + 4).map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]));
    let mut at = 12;
    while at + 8 <= bytes.len() {
        let size = u32_at(at + 4).unwrap_or(0) as usize;
        if &bytes[at..at + 4] == b"fmt " {
            return u16_at(at + 8) == Some(1) && u16_at(at + 10) == Some(1) && u32_at(at + 12) == Some(16_000) && u16_at(at + 22) == Some(16);
        }
        at += 8 + size + (size & 1);
    }
    false
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use std::io::BufRead;
    use std::net::TcpListener;

    fn wav(rate: u32, channels: u16) -> Vec<u8> {
        let mut b = Vec::new();
        b.extend_from_slice(b"RIFF");
        b.extend_from_slice(&36u32.to_le_bytes());
        b.extend_from_slice(b"WAVEfmt ");
        b.extend_from_slice(&16u32.to_le_bytes());
        b.extend_from_slice(&1u16.to_le_bytes());
        b.extend_from_slice(&channels.to_le_bytes());
        b.extend_from_slice(&rate.to_le_bytes());
        b.extend_from_slice(&(rate * 2 * u32::from(channels)).to_le_bytes());
        b.extend_from_slice(&(2 * channels).to_le_bytes());
        b.extend_from_slice(&16u16.to_le_bytes());
        b.extend_from_slice(b"data");
        b.extend_from_slice(&0u32.to_le_bytes());
        b
    }

    #[test]
    fn only_a_16_khz_mono_pcm_wav_is_taken() {
        assert!(is_listening_wav(&wav(16_000, 1)));
        assert!(!is_listening_wav(&wav(48_000, 1)));
        assert!(!is_listening_wav(&wav(16_000, 2)));
        assert!(!is_listening_wav(b"\x1aE\xdf\xa3 a webm recording, not a wav at all"));
    }

    #[test]
    fn the_words_are_the_pieces_joined_and_nothing_heard_says_so() {
        let answer = json!({ "ok": true, "segments": [{ "start": 0.3, "end": 2.0, "text": " Hello there. " }, { "start": 3.0, "end": 4.0, "text": "How are you?" }] });
        let got = words(&answer);
        assert_eq!(got["text"], "Hello there. How are you?");
        assert_eq!(got["segments"].as_array().map(Vec::len), Some(2));
        assert_eq!(words(&json!({ "ok": true, "segments": [] }))["ok"], false);
    }

    #[test]
    fn each_model_is_pinned_and_sized() {
        for (name, e, d, t) in WHISPER {
            for f in [e, d, t] {
                assert_eq!(f.sha.len(), 64, "{name} {}", f.name);
                assert!(f.sha.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase()));
                assert!(f.size > 0 && f.size < MAX_BYTES);
                assert!(f.name.starts_with(&format!("whisper-{name}-")));
            }
        }
        assert!(whisper(DEFAULT_MODEL).is_some());
        assert!(model_bytes("base.en") > 150_000_000 && model_bytes("base.en") < 170_000_000);
        assert_eq!(model_bytes("large"), 0);
    }

    /// Serves each request from `files` by its path, or 404.
    fn serve(files: Vec<(String, Vec<u8>)>) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/", listener.local_addr().unwrap());
        std::thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let mut reader = std::io::BufReader::new(stream.try_clone().unwrap());
                let mut first = String::new();
                let _ = reader.read_line(&mut first);
                let mut line = String::new();
                while reader.read_line(&mut line).is_ok_and(|n| n > 2) {
                    line.clear();
                }
                let path = first.split(' ').nth(1).unwrap_or("/").trim_start_matches('/').to_owned();
                let mut stream = stream;
                match files.iter().find(|(name, _)| *name == path) {
                    Some((_, body)) => {
                        let _ = write!(stream, "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len());
                        let _ = stream.write_all(body);
                    }
                    None => {
                        let _ = write!(stream, "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                    }
                }
            }
        });
        url
    }

    fn quiet() -> crate::bridge::Emit {
        Arc::new(|_: &str, _: Value| {})
    }

    fn wait_until_settled(voice: &DeviceVoice, model: &str) -> Value {
        let deadline = Instant::now() + Duration::from_secs(20);
        while voice.busy.load(Ordering::Acquire) && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(20));
        }
        voice.status(model)
    }

    #[test]
    fn a_program_that_does_not_match_its_pin_is_deleted_and_never_run() {
        let dir = tempfile::tempdir().unwrap();
        let url = serve(vec![("prog.gz".into(), b"not the program".to_vec())]);
        let voice = Arc::new(DeviceVoice::serving(dir.path().to_path_buf(), quiet(), url, Some(("prog.gz".into(), "0".repeat(64)))));
        voice.setup("base.en");
        let got = wait_until_settled(&voice, "base.en");
        assert_eq!(got["state"], "failed", "{got}");
        assert!(got["message"].as_str().unwrap().contains("doesn't match"));
        assert!(!voice.program_path().exists());
        assert!(std::fs::read_dir(dir.path()).unwrap().flatten().all(|e| !e.file_name().to_string_lossy().ends_with(".part")));
    }

    #[test]
    fn with_no_build_for_this_computer_it_says_so() {
        let dir = tempfile::tempdir().unwrap();
        let voice = Arc::new(DeviceVoice::serving(dir.path().to_path_buf(), quiet(), "http://127.0.0.1:9/".into(), None));
        voice.setup("base.en");
        let got = wait_until_settled(&voice, "base.en");
        assert_eq!(got["state"], "failed");
        assert!(got["message"].as_str().unwrap().contains("isn't available on this computer"));
    }

    #[test]
    fn a_recording_before_set_up_points_to_settings_and_another_model_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let voice = DeviceVoice::new(dir.path().to_path_buf(), quiet());
        let got = voice.transcribe(&wav(16_000, 1), "base.en");
        assert_eq!((got["ok"].clone(), got["setup"].clone()), (json!(false), json!(true)));
        assert_eq!(voice.transcribe(&wav(16_000, 1), "large")["ok"], false);
        assert_eq!(voice.status("base.en")["state"], "absent");
    }

    /// The whole way, with the real program and base.en: `MOBIUS_VOICE_RELEASE` is a folder of the release's files
    /// (the program packed as `program.gz`), and `MOBIUS_VOICE_WAV` a 16 kHz recording of speech.
    #[test]
    #[ignore = "needs the program and the base.en files"]
    fn sets_up_from_the_release_and_writes_a_recording_down() {
        let (Some(release), Some(recording)) = (std::env::var_os("MOBIUS_VOICE_RELEASE"), std::env::var_os("MOBIUS_VOICE_WAV")) else { return };
        let files: Vec<(String, Vec<u8>)> = std::fs::read_dir(release).unwrap().flatten().map(|e| (e.file_name().to_string_lossy().into_owned(), std::fs::read(e.path()).unwrap())).collect();
        let program_sha = files.iter().find(|(n, _)| n == "program.gz").map(|(_, b)| hex(&Sha256::digest(b))).unwrap();
        let dir = tempfile::tempdir().unwrap();
        let seen = Arc::new(Mutex::new(Vec::new()));
        let log = Arc::clone(&seen);
        let emit: crate::bridge::Emit = Arc::new(move |_: &str, v: Value| lock(&log).push(v["state"].as_str().unwrap_or("").to_owned()));
        let voice = Arc::new(DeviceVoice::serving(dir.path().to_path_buf(), emit, serve(files), Some(("program.gz".into(), program_sha))));
        voice.setup("base.en");
        assert_eq!(wait_until_settled(&voice, "base.en")["state"], "ready");
        assert!(lock(&seen).iter().any(|s| s == "downloading"));
        let wav = std::fs::read(recording).unwrap();
        let first = voice.transcribe(&wav, "base.en");
        assert_eq!(first["ok"], true, "{first}");
        assert!(first["text"].as_str().unwrap().to_lowercase().contains("yellow lamps"), "{first}");
        // The program stays up for the next one, and a webm is sent back to be converted.
        assert_eq!(voice.transcribe(&wav, "base.en")["ok"], true);
        assert_eq!(voice.transcribe(b"\x1aE\xdf\xa3 webm", "base.en")["wav"], true);
        assert_eq!(voice.remove("base.en")["ok"], true);
        assert_eq!(voice.status("base.en")["state"], "absent");
    }

    #[test]
    fn remove_takes_every_file_away() {
        let dir = tempfile::tempdir().unwrap();
        let voice = DeviceVoice::new(dir.path().to_path_buf(), quiet());
        std::fs::create_dir_all(dir.path().join("models")).unwrap();
        std::fs::write(voice.program_path(), b"x").unwrap();
        std::fs::write(voice.file_path(&VAD), b"x").unwrap();
        assert_eq!(voice.remove("base.en")["ok"], true);
        assert!(!voice.program_path().exists() && !voice.file_path(&VAD).exists());
    }
}
