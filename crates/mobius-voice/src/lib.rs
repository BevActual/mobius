//! Listening on this computer: Whisper through sherpa-onnx, with Silero VAD cutting the sound into pieces of speech
//! under Whisper's 30-second window, each written down with the time it starts.
//!
//! Mobius talks to this program one JSON object per line on stdin and stdout. Each request has an `id`, which its
//! answer repeats.
//!
//! - `{"id":1,"op":"ping"}` answers `{"id":1,"ok":true,"version":"0.1.0"}`.
//! - `{"id":2,"op":"transcribe","audio":"<16 kHz mono WAV>","whisper":{"encoder":…,"decoder":…,"tokens":…},
//!   "vad":"<silero_vad.onnx>","language":"en"}` answers `{"id":2,"ok":true,"seconds":12.5,"segments":[{"start":0.4,
//!   "end":3.1,"text":"…"}]}`.
//!
//! A failure answers `{"id":…,"ok":false,"error":"…"}` in words a person can read. The models stay loaded between
//! requests; Mobius stops the program when it has been idle a few minutes.

use serde::Deserialize;
use serde_json::{Value, json};
use sherpa_onnx::{OfflineRecognizer, OfflineRecognizerConfig, VadModelConfig, VoiceActivityDetector, Wave};

/// What Whisper and the VAD both take.
pub const SAMPLE_RATE: i32 = 16_000;
/// A piece of speech is cut here at the latest, well inside Whisper's 30-second window.
pub const MAX_SPEECH_SECONDS: f32 = 20.0;
/// The VAD's own frame, in samples, for Silero at 16 kHz.
const VAD_WINDOW: i32 = 512;
/// The longest recording taken in one request: a meeting is sent in parts far shorter than this.
const MAX_SECONDS: usize = 30 * 60;

#[derive(Debug, Deserialize, PartialEq, Eq, Clone)]
pub struct WhisperFiles {
    pub encoder: String,
    pub decoder: String,
    pub tokens: String,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "op", rename_all = "lowercase")]
pub enum Op {
    Ping,
    Transcribe {
        audio: String,
        whisper: WhisperFiles,
        vad: String,
        #[serde(default)]
        language: Option<String>,
    },
}

#[derive(Debug, Deserialize)]
pub struct Request {
    pub id: Value,
    #[serde(flatten)]
    pub op: Op,
}

/// Read one line as a request. A line that isn't one answers with the reason, and an id of null.
pub fn parse(line: &str) -> Result<Request, Value> {
    serde_json::from_str::<Request>(line).map_err(|e| failed(&Value::Null, &format!("Mobius sent a request this program could not read ({e}).")))
}

#[must_use]
pub fn failed(id: &Value, message: &str) -> Value {
    json!({ "id": id, "ok": false, "error": message })
}

/// Threads for one decode: half the computer's cores, between one and four, so a meeting written down in the
/// background leaves the rest of the computer free.
#[must_use]
pub fn threads(cores: usize) -> i32 {
    i32::try_from((cores / 2).clamp(1, 4)).unwrap_or(1)
}

/// Whisper's language: a two-letter code, or English when none is given. Anything else is refused rather than passed
/// to the model.
pub fn language(asked: Option<&str>) -> Result<String, String> {
    let asked = asked.map(str::trim).filter(|s| !s.is_empty()).unwrap_or("en");
    if asked.len() == 2 && asked.bytes().all(|b| b.is_ascii_lowercase()) { Ok(asked.to_owned()) } else { Err(format!("\"{asked}\" is not a language this program knows.")) }
}

/// A piece of what was said.
#[derive(Debug, Clone, PartialEq)]
pub struct Segment {
    pub start: f32,
    pub end: f32,
    pub text: String,
}

/// The answer to a transcription: pieces with no words left out, the rest trimmed.
#[must_use]
pub fn answer(id: &Value, seconds: f32, segments: &[Segment]) -> Value {
    let round = |x: f32| (f64::from(x) * 100.0).round() / 100.0;
    let pieces: Vec<Value> = segments.iter().filter(|s| !s.text.trim().is_empty()).map(|s| json!({ "start": round(s.start), "end": round(s.end), "text": s.text.trim() })).collect();
    json!({ "id": id, "ok": true, "seconds": round(seconds), "segments": pieces })
}

/// The loaded models, kept between requests and loaded again only when Mobius names other files.
#[derive(Default)]
pub struct Listener {
    whisper: Option<(WhisperFiles, String, OfflineRecognizer)>,
    vad: Option<(String, VadModelConfig)>,
    cores: usize,
}

impl Listener {
    #[must_use]
    pub fn new(cores: usize) -> Listener {
        Listener { cores, ..Listener::default() }
    }

    fn recognizer(&mut self, files: &WhisperFiles, language: &str) -> Result<&OfflineRecognizer, String> {
        let fresh = !matches!(&self.whisper, Some((f, l, _)) if f == files && l == language);
        if fresh {
            self.whisper = None;
            for path in [&files.encoder, &files.decoder, &files.tokens] {
                if !std::path::Path::new(path).is_file() {
                    return Err("A file of the speech model is missing. Set up listening on this computer again in Settings, Voice.".to_owned());
                }
            }
            let mut config = OfflineRecognizerConfig::default();
            config.model_config.whisper.encoder = Some(files.encoder.clone());
            config.model_config.whisper.decoder = Some(files.decoder.clone());
            config.model_config.whisper.language = Some(language.to_owned());
            config.model_config.whisper.task = Some("transcribe".to_owned());
            config.model_config.tokens = Some(files.tokens.clone());
            config.model_config.num_threads = threads(self.cores);
            let recognizer = OfflineRecognizer::create(&config).ok_or("The speech model could not be loaded. Set up listening on this computer again in Settings, Voice.")?;
            self.whisper = Some((files.clone(), language.to_owned(), recognizer));
        }
        self.whisper.as_ref().map(|(_, _, r)| r).ok_or_else(|| "The speech model could not be loaded.".to_owned())
    }

    fn vad(&mut self, model: &str) -> Result<VadModelConfig, String> {
        if let Some((path, config)) = &self.vad {
            if path == model {
                return Ok(config.clone());
            }
        }
        if !std::path::Path::new(model).is_file() {
            return Err("A file of the speech model is missing. Set up listening on this computer again in Settings, Voice.".to_owned());
        }
        let mut config = VadModelConfig::default();
        config.silero_vad.model = Some(model.to_owned());
        config.silero_vad.threshold = 0.5;
        config.silero_vad.min_silence_duration = 0.4;
        config.silero_vad.min_speech_duration = 0.25;
        config.silero_vad.max_speech_duration = MAX_SPEECH_SECONDS;
        config.silero_vad.window_size = VAD_WINDOW;
        config.sample_rate = SAMPLE_RATE;
        config.num_threads = 1;
        self.vad = Some((model.to_owned(), config.clone()));
        Ok(config)
    }

    /// Write down a recording: speech pieces from the VAD, each through Whisper, with their times.
    pub fn transcribe(&mut self, audio: &str, files: &WhisperFiles, vad: &str, language: Option<&str>) -> Result<(f32, Vec<Segment>), String> {
        let language = self::language(language)?;
        let wave = Wave::read(audio).ok_or("The recording could not be read.")?;
        if wave.sample_rate() != SAMPLE_RATE {
            return Err(format!("The recording is at {} Hz; this program takes 16 kHz.", wave.sample_rate()));
        }
        let samples = wave.samples();
        if samples.len() > MAX_SECONDS * 16_000 {
            return Err("The recording is too long to write down in one go.".to_owned());
        }
        #[allow(clippy::cast_precision_loss)]
        let seconds = samples.len() as f32 / SAMPLE_RATE as f32;
        let vad_config = self.vad(vad)?;
        let detector = VoiceActivityDetector::create(&vad_config, MAX_SPEECH_SECONDS + 10.0).ok_or("The speech detector could not be loaded.")?;
        let recognizer = self.recognizer(files, &language)?;
        let mut out = Vec::new();
        let take = |detector: &VoiceActivityDetector, out: &mut Vec<Segment>| {
            while let Some(piece) = detector.front() {
                let stream = recognizer.create_stream();
                stream.accept_waveform(SAMPLE_RATE, piece.samples());
                recognizer.decode(&stream);
                #[allow(clippy::cast_precision_loss)]
                let start = piece.start() as f32 / SAMPLE_RATE as f32;
                #[allow(clippy::cast_precision_loss)]
                let end = start + piece.samples().len() as f32 / SAMPLE_RATE as f32;
                out.push(Segment { start, end, text: stream.get_result().map(|r| r.text).unwrap_or_default() });
                detector.pop();
            }
        };
        for chunk in samples.chunks(usize::try_from(VAD_WINDOW).unwrap_or(512)) {
            detector.accept_waveform(chunk);
            take(&detector, &mut out);
        }
        detector.flush();
        take(&detector, &mut out);
        Ok((seconds, out))
    }

    /// Answer one request.
    pub fn handle(&mut self, request: Request) -> Value {
        match request.op {
            Op::Ping => json!({ "id": request.id, "ok": true, "version": env!("CARGO_PKG_VERSION") }),
            Op::Transcribe { audio, whisper, vad, language } => match self.transcribe(&audio, &whisper, &vad, language.as_deref()) {
                Ok((seconds, segments)) => answer(&request.id, seconds, &segments),
                Err(message) => failed(&request.id, &message),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_request_is_read_from_one_line() {
        let r = parse(r#"{"id":7,"op":"transcribe","audio":"a.wav","whisper":{"encoder":"e","decoder":"d","tokens":"t"},"vad":"v.onnx"}"#).ok().map(|r| (r.id, matches!(r.op, Op::Transcribe { .. })));
        assert_eq!(r, Some((json!(7), true)));
        assert!(matches!(parse(r#"{"id":"x","op":"ping"}"#).map(|r| r.op), Ok(Op::Ping)));
    }

    #[test]
    fn a_line_that_is_not_a_request_says_so_with_no_id() {
        let e = parse(r#"{"id":1,"op":"shout"}"#).err();
        assert_eq!(e.as_ref().map(|e| e["ok"].clone()), Some(json!(false)));
        assert_eq!(e.map(|e| e["id"].clone()), Some(Value::Null));
    }

    #[test]
    fn threads_are_half_the_cores_between_one_and_four() {
        assert_eq!([1, 2, 4, 8, 16].map(threads), [1, 1, 2, 4, 4]);
    }

    #[test]
    fn the_language_is_english_unless_a_two_letter_code_is_given() {
        assert_eq!(language(None), Ok("en".to_owned()));
        assert_eq!(language(Some(" ")), Ok("en".to_owned()));
        assert_eq!(language(Some("de")), Ok("de".to_owned()));
        assert!(language(Some("en --task translate")).is_err());
    }

    #[test]
    fn the_answer_leaves_out_empty_pieces_and_rounds_times() {
        let segments = [Segment { start: 0.333, end: 2.0, text: " Hello. ".to_owned() }, Segment { start: 3.0, end: 3.5, text: " ".to_owned() }];
        assert_eq!(answer(&json!(1), 4.004, &segments), json!({ "id": 1, "ok": true, "seconds": 4.0, "segments": [{ "start": 0.33, "end": 2.0, "text": "Hello." }] }));
    }

    #[test]
    fn a_missing_model_says_how_to_put_it_right() {
        let files = WhisperFiles { encoder: "/nowhere/e.onnx".into(), decoder: "/nowhere/d.onnx".into(), tokens: "/nowhere/t.txt".into() };
        let got = Listener::new(2).handle(Request { id: json!(3), op: Op::Transcribe { audio: "/nowhere/a.wav".into(), whisper: files, vad: "/nowhere/v.onnx".into(), language: None } });
        assert_eq!(got["ok"], false);
    }

    /// Writes down sherpa-onnx's own test recording with Whisper tiny.en. Needs the models: set MOBIUS_VOICE_MODELS to
    /// a folder with tiny.en-encoder.int8.onnx, tiny.en-decoder.int8.onnx, tiny.en-tokens.txt, silero_vad.onnx and
    /// test_wavs/0.wav from sherpa-onnx's asr-models release. The build workflow runs it.
    #[test]
    #[ignore = "needs the speech models on disk"]
    fn a_recording_is_written_down_with_its_times() {
        let dir = std::env::var("MOBIUS_VOICE_MODELS").unwrap_or_default();
        let at = |f: &str| format!("{dir}/{f}");
        let files = WhisperFiles { encoder: at("tiny.en-encoder.int8.onnx"), decoder: at("tiny.en-decoder.int8.onnx"), tokens: at("tiny.en-tokens.txt") };
        let mut listener = Listener::new(4);
        let got = listener.transcribe(&at("test_wavs/0.wav"), &files, &at("silero_vad.onnx"), None);
        let (seconds, segments) = got.unwrap_or_default();
        assert!(seconds > 6.0, "{seconds}");
        let words: String = segments.iter().map(|s| s.text.to_lowercase()).collect::<Vec<_>>().join(" ");
        assert!(words.contains("yellow lamps"), "{words}");
        assert!(segments.iter().all(|s| s.end - s.start <= MAX_SPEECH_SECONDS + 0.5));
    }
}
