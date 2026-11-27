//! Listening on this computer: Whisper or Parakeet through sherpa-onnx, with Silero VAD cutting the sound into pieces
//! of speech under Whisper's 30-second window, each written down with the time it starts, and, for a meeting, who
//! said it (pyannote segmentation and a 3D-Speaker voice print).
//!
//! Mobius talks to this program one JSON object per line on stdin and stdout. Each request has an `id`, which its
//! answer repeats.
//!
//! - `{"id":1,"op":"ping"}` answers `{"id":1,"ok":true,"version":"0.1.0"}`.
//! - `{"id":2,"op":"transcribe","audio":"<16 kHz mono WAV>","whisper":{"encoder":…,"decoder":…,"tokens":…},
//!   "vad":"<silero_vad.onnx>","language":"en"}` answers `{"id":2,"ok":true,"seconds":12.5,"segments":[{"start":0.4,
//!   "end":3.1,"text":"…"}]}`. `"parakeet":{"encoder":…,"decoder":…,"joiner":…,"tokens":…}` in place of `whisper`
//!   listens with Parakeet TDT v3 (it finds the language itself). `"speakers":{"segmentation":…,"embedding":…,
//!   "meeting":"<id>"}` labels each piece `"speaker":"Speaker 1"`; the parts of one meeting keep the same names, as
//!   each voice is matched against the ones already heard in it.
//!
//! - `{"id":3,"op":"speak","text":"…","kokoro":{"model":…,"voices":…,"tokens":…,"lexicon":…},"voice":3,"speed":1.0,
//!   "out":"<where to write the WAV>"}` answers `{"id":3,"ok":true,"seconds":4.2}`. Kokoro through sherpa-onnx, with the
//!   words turned into its phonemes here (`g2p.rs`), so no GPL phonemizer comes with it.
//!
//! A failure answers `{"id":…,"ok":false,"error":"…"}` in words a person can read. The models stay loaded between
//! requests; Mobius stops the program when it has been idle a few minutes.

use serde::Deserialize;
use serde_json::{Value, json};
use sherpa_onnx::{
    GenerationConfig, OfflineRecognizer, OfflineRecognizerConfig, OfflineSpeakerDiarization, OfflineSpeakerDiarizationConfig, OfflineTts, OfflineTtsConfig, OfflineTtsKokoroModelConfig, SpeakerEmbeddingExtractor,
    SpeakerEmbeddingExtractorConfig, VadModelConfig, VoiceActivityDetector, Wave,
};

pub mod g2p;

/// The most text read in one request: the host sends a long page in parts, so the first is heard soon.
pub const MAX_SPEAK_CHARS: usize = 4000;

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

/// Parakeet TDT 0.6B v3 (NVIDIA, CC-BY-4.0), as sherpa-onnx exports it int8: a transducer in three parts.
#[derive(Debug, Deserialize, PartialEq, Eq, Clone)]
pub struct ParakeetFiles {
    pub encoder: String,
    pub decoder: String,
    pub joiner: String,
    pub tokens: String,
}

/// Who listens.
#[derive(Debug, PartialEq, Eq, Clone)]
pub enum Ear {
    Whisper(WhisperFiles),
    Parakeet(ParakeetFiles),
}

/// Telling voices apart: pyannote's segmentation (MIT) and a 3D-Speaker voice print (Apache-2.0). `meeting` names the
/// meeting a part belongs to, so its speakers keep their names from one part to the next.
#[derive(Debug, Deserialize, PartialEq, Eq, Clone)]
pub struct SpeakerFiles {
    pub segmentation: String,
    pub embedding: String,
    #[serde(default)]
    pub meeting: String,
}

/// How alike two voice prints must be (cosine) to be taken for the same person.
pub const SAME_VOICE: f32 = 0.5;
/// How far apart (cosine distance) the moments of one recording must sound before they are taken for two people.
/// Looser than `SAME_VOICE`, because those moments are a few seconds each and their prints vary more than a whole
/// speaker's: at 0.5 one person was now and then heard as a third, while real voices stay apart well past 0.7.
const APART: f32 = 0.7;
/// The most of one speaker's voice used for their print, in seconds: enough to tell them apart, quick to compute.
const PRINT_SECONDS: usize = 20;

/// Kokoro's files, with misaki's word list (both Apache-2.0).
#[derive(Debug, Deserialize, PartialEq, Eq, Clone)]
pub struct KokoroFiles {
    pub model: String,
    pub voices: String,
    pub tokens: String,
    pub lexicon: String,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "op", rename_all = "lowercase")]
pub enum Op {
    Ping,
    Transcribe {
        audio: String,
        #[serde(default)]
        whisper: Option<WhisperFiles>,
        #[serde(default)]
        parakeet: Option<ParakeetFiles>,
        vad: String,
        #[serde(default)]
        language: Option<String>,
        #[serde(default)]
        speakers: Option<SpeakerFiles>,
    },
    Speak {
        text: String,
        kokoro: KokoroFiles,
        #[serde(default)]
        voice: i32,
        #[serde(default)]
        speed: Option<f32>,
        out: String,
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
    /// Who said it, when speakers were asked for and heard.
    pub speaker: Option<String>,
}

/// One stretch of one voice, as the speaker segmentation heard it.
#[derive(Debug, Clone, PartialEq)]
pub struct Turn {
    pub start: f32,
    pub end: f32,
    pub speaker: usize,
}

/// The speaker of each piece: whoever spoke most of it, or nobody when no turn overlaps it.
#[must_use]
pub fn speaker_of(segment: &Segment, turns: &[Turn]) -> Option<usize> {
    let mut most: Option<(usize, f32)> = None;
    for turn in turns {
        let overlap = segment.end.min(turn.end) - segment.start.max(turn.start);
        if overlap > 0.0 && most.is_none_or(|(_, m)| overlap > m) {
            most = Some((turn.speaker, overlap));
        }
    }
    most.map(|(s, _)| s)
}

fn cosine(a: &[f32], b: &[f32]) -> f32 {
    let dot: f32 = a.iter().zip(b).map(|(x, y)| x * y).sum();
    let norm = |v: &[f32]| v.iter().map(|x| x * x).sum::<f32>().sqrt();
    let n = norm(a) * norm(b);
    if n > 0.0 { dot / n } else { 0.0 }
}

/// The voices heard so far in a meeting, each a voice print kept as the mean of the prints it was matched with.
#[derive(Debug, Default, Clone)]
pub struct Voices {
    meeting: String,
    prints: Vec<(Vec<f32>, f32)>,
}

impl Voices {
    /// The number (from 0) of the voice `print` is, among those not `taken` in this part already; a new voice when it
    /// is like none of them.
    pub fn place(&mut self, print: &[f32], taken: &[usize]) -> usize {
        let best = self.prints.iter().enumerate().filter(|(i, (p, _))| !taken.contains(i) && p.len() == print.len()).map(|(i, (p, _))| (i, cosine(p, print))).max_by(|a, b| a.1.total_cmp(&b.1));
        if let Some((i, _)) = best.filter(|(_, l)| *l >= SAME_VOICE) {
            let (mean, n) = &mut self.prints[i];
            for (m, x) in mean.iter_mut().zip(print) {
                *m = (*m * *n + x) / (*n + 1.0);
            }
            *n += 1.0;
            return i;
        }
        self.prints.push((print.to_vec(), 1.0));
        self.prints.len() - 1
    }
}

/// The answer to a transcription: pieces with no words left out, the rest trimmed.
#[must_use]
pub fn answer(id: &Value, seconds: f32, segments: &[Segment]) -> Value {
    let round = |x: f32| (f64::from(x) * 100.0).round() / 100.0;
    let pieces: Vec<Value> = segments
        .iter()
        .filter(|s| !s.text.trim().is_empty())
        .map(|s| {
            let mut piece = json!({ "start": round(s.start), "end": round(s.end), "text": s.text.trim() });
            if let Some(who) = &s.speaker {
                piece["speaker"] = json!(who);
            }
            piece
        })
        .collect();
    json!({ "id": id, "ok": true, "seconds": round(seconds), "segments": pieces })
}

/// The loaded models, kept between requests and loaded again only when Mobius names other files.
#[derive(Default)]
pub struct Listener {
    kokoro: Option<(KokoroFiles, g2p::Lexicon, OfflineTts)>,
    ear: Option<(Ear, String, OfflineRecognizer)>,
    vad: Option<(String, VadModelConfig)>,
    speakers: Option<(SpeakerFiles, OfflineSpeakerDiarization, SpeakerEmbeddingExtractor)>,
    voices: Voices,
    cores: usize,
}

impl Listener {
    #[must_use]
    pub fn new(cores: usize) -> Listener {
        Listener { cores, ..Listener::default() }
    }

    fn recognizer(&mut self, ear: &Ear, language: &str) -> Result<&OfflineRecognizer, String> {
        let fresh = !matches!(&self.ear, Some((e, l, _)) if e == ear && l == language);
        if fresh {
            self.ear = None;
            let paths: Vec<&String> = match ear {
                Ear::Whisper(f) => vec![&f.encoder, &f.decoder, &f.tokens],
                Ear::Parakeet(f) => vec![&f.encoder, &f.decoder, &f.joiner, &f.tokens],
            };
            if paths.iter().any(|p| !std::path::Path::new(p).is_file()) {
                return Err("A file of the speech model is missing. Set up listening on this computer again in Settings, Models.".to_owned());
            }
            let mut config = OfflineRecognizerConfig::default();
            match ear {
                Ear::Whisper(files) => {
                    config.model_config.whisper.encoder = Some(files.encoder.clone());
                    config.model_config.whisper.decoder = Some(files.decoder.clone());
                    config.model_config.whisper.language = Some(language.to_owned());
                    config.model_config.whisper.task = Some("transcribe".to_owned());
                    config.model_config.tokens = Some(files.tokens.clone());
                }
                Ear::Parakeet(files) => {
                    config.model_config.transducer.encoder = Some(files.encoder.clone());
                    config.model_config.transducer.decoder = Some(files.decoder.clone());
                    config.model_config.transducer.joiner = Some(files.joiner.clone());
                    config.model_config.model_type = Some("nemo_transducer".to_owned());
                    config.model_config.tokens = Some(files.tokens.clone());
                }
            }
            config.model_config.num_threads = threads(self.cores);
            let recognizer = OfflineRecognizer::create(&config).ok_or("The speech model could not be loaded. Set up listening on this computer again in Settings, Models.")?;
            self.ear = Some((ear.clone(), language.to_owned(), recognizer));
        }
        self.ear.as_ref().map(|(_, _, r)| r).ok_or_else(|| "The speech model could not be loaded.".to_owned())
    }

    fn vad(&mut self, model: &str) -> Result<VadModelConfig, String> {
        if let Some((path, config)) = &self.vad {
            if path == model {
                return Ok(config.clone());
            }
        }
        if !std::path::Path::new(model).is_file() {
            return Err("A file of the speech model is missing. Set up listening on this computer again in Settings, Models.".to_owned());
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
    pub fn transcribe(&mut self, audio: &str, ear: &Ear, vad: &str, language: Option<&str>, speakers: Option<&SpeakerFiles>) -> Result<(f32, Vec<Segment>), String> {
        // Parakeet finds the language itself; Whisper is told it.
        let language = if matches!(ear, Ear::Parakeet(_)) { String::new() } else { self::language(language)? };
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
        let recognizer = self.recognizer(ear, &language)?;
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
                out.push(Segment { start, end, text: stream.get_result().map(|r| r.text).unwrap_or_default(), speaker: None });
                detector.pop();
            }
        };
        for chunk in samples.chunks(usize::try_from(VAD_WINDOW).unwrap_or(512)) {
            detector.accept_waveform(chunk);
            take(&detector, &mut out);
        }
        detector.flush();
        take(&detector, &mut out);
        if let Some(files) = speakers {
            if out.iter().any(|s| !s.text.trim().is_empty()) {
                let turns = self.turns(samples, files)?;
                for segment in &mut out {
                    segment.speaker = speaker_of(segment, &turns).map(|n| format!("Speaker {}", n + 1));
                }
            }
        }
        Ok((seconds, out))
    }

    fn diarizer(&mut self, files: &SpeakerFiles) -> Result<&(SpeakerFiles, OfflineSpeakerDiarization, SpeakerEmbeddingExtractor), String> {
        let same = |a: &SpeakerFiles| a.segmentation == files.segmentation && a.embedding == files.embedding;
        if !matches!(&self.speakers, Some((f, ..)) if same(f)) {
            self.speakers = None;
            if [&files.segmentation, &files.embedding].iter().any(|p| !std::path::Path::new(p).is_file()) {
                return Err("A file for telling speakers apart is missing. Set it up again in Settings, Models.".to_owned());
            }
            let embedding = SpeakerEmbeddingExtractorConfig { model: Some(files.embedding.clone()), num_threads: threads(self.cores), ..SpeakerEmbeddingExtractorConfig::default() };
            let mut config = OfflineSpeakerDiarizationConfig { embedding: embedding.clone(), ..OfflineSpeakerDiarizationConfig::default() };
            config.segmentation.pyannote.model = Some(files.segmentation.clone());
            config.segmentation.num_threads = threads(self.cores);
            config.clustering.threshold = APART;
            let diarizer = OfflineSpeakerDiarization::create(&config).ok_or("Telling speakers apart could not be loaded. Set it up again in Settings, Models.")?;
            if diarizer.sample_rate() != SAMPLE_RATE {
                return Err("The speaker model takes another kind of recording.".to_owned());
            }
            let extractor = SpeakerEmbeddingExtractor::create(&embedding).ok_or("Telling speakers apart could not be loaded. Set it up again in Settings, Models.")?;
            self.speakers = Some((files.clone(), diarizer, extractor));
        }
        self.speakers.as_ref().ok_or_else(|| "Telling speakers apart could not be loaded.".to_owned())
    }

    /// Who spoke when, numbered across the meeting: this part's voices are told apart, then each one's print is
    /// matched with the voices heard in the meeting's earlier parts.
    fn turns(&mut self, samples: &[f32], files: &SpeakerFiles) -> Result<Vec<Turn>, String> {
        if self.voices.meeting != files.meeting || files.meeting.is_empty() {
            self.voices = Voices { meeting: files.meeting.clone(), prints: Vec::new() };
        }
        let (_, diarizer, extractor) = self.diarizer(files)?;
        let heard = diarizer.process(samples).ok_or("The speakers could not be told apart.")?.sort_by_start_time();
        let rate = usize::try_from(SAMPLE_RATE).unwrap_or(16_000);
        let mut local: Vec<i32> = heard.iter().map(|t| t.speaker).collect();
        local.sort_unstable();
        local.dedup();
        let mut prints = Vec::new();
        for who in &local {
            let mut voice: Vec<f32> = Vec::new();
            for turn in heard.iter().filter(|t| t.speaker == *who) {
                #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
                let (a, b) = ((turn.start.max(0.0) * SAMPLE_RATE as f32) as usize, (turn.end.max(0.0) * SAMPLE_RATE as f32) as usize);
                voice.extend_from_slice(&samples[a.min(samples.len())..b.min(samples.len())]);
                if voice.len() >= PRINT_SECONDS * rate {
                    break;
                }
            }
            voice.truncate(PRINT_SECONDS * rate);
            let print = extractor.create_stream().and_then(|stream| {
                stream.accept_waveform(SAMPLE_RATE, &voice);
                stream.input_finished();
                if extractor.is_ready(&stream) { extractor.compute(&stream) } else { None }
            });
            prints.push(print);
        }
        let mut names: Vec<(i32, usize)> = Vec::new();
        let mut taken = Vec::new();
        for (who, print) in local.iter().zip(prints) {
            // A voice heard too briefly for a print is left without a name rather than guessed.
            if let Some(print) = print {
                let n = self.voices.place(&print, &taken);
                taken.push(n);
                names.push((*who, n));
            }
        }
        Ok(heard.iter().filter_map(|t| names.iter().find(|(w, _)| *w == t.speaker).map(|(_, n)| Turn { start: t.start, end: t.end, speaker: *n })).collect())
    }

    fn speaker(&mut self, files: &KokoroFiles) -> Result<&(KokoroFiles, g2p::Lexicon, OfflineTts), String> {
        if !matches!(&self.kokoro, Some((f, ..)) if f == files) {
            self.kokoro = None;
            for path in [&files.model, &files.voices, &files.tokens, &files.lexicon] {
                if !std::path::Path::new(path).is_file() {
                    return Err("A file of the voice is missing. Set up speaking on this computer again in Settings, Models.".to_owned());
                }
            }
            let words = std::fs::read_to_string(&files.lexicon).map_err(|_| "The voice's word list could not be read.".to_owned())?;
            let mut config = OfflineTtsConfig::default();
            config.model.kokoro = OfflineTtsKokoroModelConfig { model: Some(files.model.clone()), voices: Some(files.voices.clone()), tokens: Some(files.tokens.clone()), ..OfflineTtsKokoroModelConfig::default() };
            config.model.num_threads = threads(self.cores);
            config.max_num_sentences = 1;
            let tts = OfflineTts::create(&config).ok_or("The voice could not be loaded. Set up speaking on this computer again in Settings, Models.")?;
            self.kokoro = Some((files.clone(), g2p::Lexicon::parse(&words), tts));
        }
        self.kokoro.as_ref().ok_or_else(|| "The voice could not be loaded.".to_owned())
    }

    /// Read a text aloud into a WAV file: its sentences as Kokoro's phonemes, one voice, at the speed asked.
    pub fn speak(&mut self, text: &str, files: &KokoroFiles, voice: i32, speed: Option<f32>, out: &str) -> Result<f32, String> {
        let text: String = text.chars().take(MAX_SPEAK_CHARS).collect();
        let (_, lexicon, tts) = self.speaker(files)?;
        let sentences = g2p::sentences(lexicon, &text);
        if sentences.is_empty() {
            return Err("There is nothing to read.".to_owned());
        }
        if voice < 0 || voice >= tts.num_speakers().max(1) {
            return Err("That voice is not one this model has.".to_owned());
        }
        let config = GenerationConfig {
            sid: voice,
            speed: speed.filter(|s| s.is_finite()).unwrap_or(1.0).clamp(0.5, 2.0),
            phoneme_codepoints: Some(sentences.iter().map(|s| s.chars().map(|c| i32::try_from(u32::from(c)).unwrap_or(0)).collect()).collect()),
            ..GenerationConfig::default()
        };
        let audio = tts.generate_with_config("", &config, None::<fn(&[f32], f32) -> bool>).ok_or("The voice could not read that.")?;
        if audio.samples().is_empty() || !audio.save(out) {
            return Err("The voice could not write the sound.".to_owned());
        }
        #[allow(clippy::cast_precision_loss)]
        Ok(audio.samples().len() as f32 / audio.sample_rate().max(1) as f32)
    }

    /// Answer one request.
    pub fn handle(&mut self, request: Request) -> Value {
        match request.op {
            Op::Ping => json!({ "id": request.id, "ok": true, "version": env!("CARGO_PKG_VERSION") }),
            Op::Transcribe { audio, whisper, parakeet, vad, language, speakers } => {
                let Some(ear) = parakeet.map(Ear::Parakeet).or(whisper.map(Ear::Whisper)) else {
                    return failed(&request.id, "Mobius did not say which speech model to listen with.");
                };
                match self.transcribe(&audio, &ear, &vad, language.as_deref(), speakers.as_ref()) {
                    Ok((seconds, segments)) => answer(&request.id, seconds, &segments),
                    Err(message) => failed(&request.id, &message),
                }
            }
            Op::Speak { text, kokoro, voice, speed, out } => match self.speak(&text, &kokoro, voice, speed, &out) {
                Ok(seconds) => json!({ "id": request.id, "ok": true, "seconds": (f64::from(seconds) * 100.0).round() / 100.0 }),
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
        let segments = [
            Segment { start: 0.333, end: 2.0, text: " Hello. ".to_owned(), speaker: None },
            Segment { start: 3.0, end: 3.5, text: " ".to_owned(), speaker: None },
            Segment { start: 4.0, end: 5.0, text: "Hi.".to_owned(), speaker: Some("Speaker 2".to_owned()) },
        ];
        assert_eq!(
            answer(&json!(1), 6.004, &segments),
            json!({ "id": 1, "ok": true, "seconds": 6.0, "segments": [{ "start": 0.33, "end": 2.0, "text": "Hello." }, { "start": 4.0, "end": 5.0, "text": "Hi.", "speaker": "Speaker 2" }] })
        );
    }

    #[test]
    fn a_parakeet_request_with_speakers_is_read_and_one_with_no_model_says_so() {
        let r = parse(r#"{"id":1,"op":"transcribe","audio":"a.wav","parakeet":{"encoder":"e","decoder":"d","joiner":"j","tokens":"t"},"vad":"v","speakers":{"segmentation":"s","embedding":"m","meeting":"7"}}"#);
        assert!(matches!(r.map(|r| r.op), Ok(Op::Transcribe { parakeet: Some(_), whisper: None, speakers: Some(SpeakerFiles { meeting, .. }), .. }) if meeting == "7"));
        let none = parse(r#"{"id":2,"op":"transcribe","audio":"a.wav","vad":"v"}"#).map(|r| Listener::new(1).handle(r)).unwrap_or_default();
        assert_eq!(none["ok"], false);
    }

    #[test]
    fn each_piece_goes_to_whoever_spoke_most_of_it() {
        let piece = |start: f32, end: f32| Segment { start, end, text: "x".into(), speaker: None };
        let turns = [Turn { start: 0.0, end: 2.0, speaker: 0 }, Turn { start: 1.5, end: 6.0, speaker: 1 }];
        assert_eq!(speaker_of(&piece(0.0, 1.8), &turns), Some(0));
        assert_eq!(speaker_of(&piece(1.0, 5.0), &turns), Some(1));
        assert_eq!(speaker_of(&piece(7.0, 8.0), &turns), None);
    }

    #[test]
    fn a_voice_keeps_its_number_through_a_meeting_and_two_in_one_part_are_never_merged() {
        let mut voices = Voices::default();
        assert_eq!(voices.place(&[1.0, 0.0, 0.0], &[]), 0);
        assert_eq!(voices.place(&[0.0, 1.0, 0.0], &[0]), 1);
        // The next part: the same two people, a little different, and someone new.
        assert_eq!(voices.place(&[0.1, 0.9, 0.0], &[]), 1);
        assert_eq!(voices.place(&[0.9, 0.2, 0.0], &[1]), 0);
        assert_eq!(voices.place(&[0.0, 0.0, 1.0], &[1, 0]), 2);
        // Like voice 0, but voice 0 already spoke in this part as someone else: a new voice, not a merge.
        assert_eq!(voices.place(&[1.0, 0.05, 0.0], &[0]), 3);
    }

    #[test]
    fn a_missing_model_says_how_to_put_it_right() {
        let files = WhisperFiles { encoder: "/nowhere/e.onnx".into(), decoder: "/nowhere/d.onnx".into(), tokens: "/nowhere/t.txt".into() };
        let got = Listener::new(2).handle(Request { id: json!(3), op: Op::Transcribe { audio: "/nowhere/a.wav".into(), whisper: Some(files), parakeet: None, vad: "/nowhere/v.onnx".into(), language: None, speakers: None } });
        assert_eq!(got["ok"], false);
    }

    #[test]
    fn a_speak_request_is_read_and_a_missing_voice_says_how_to_put_it_right() {
        let r = parse(r#"{"id":4,"op":"speak","text":"Hi","kokoro":{"model":"/nowhere/m","voices":"/nowhere/v","tokens":"/nowhere/t","lexicon":"/nowhere/l"},"voice":3,"out":"/nowhere/o.wav"}"#);
        let got = r.map(|request| Listener::new(2).handle(request)).unwrap_or_default();
        assert_eq!(got["ok"], false);
        assert!(got["error"].as_str().unwrap_or("").contains("Settings"));
    }

    /// Reads a sentence aloud with Kokoro, then writes it down with Whisper tiny.en to hear that every word was said,
    /// the plural and the name too. Needs MOBIUS_VOICE_MODELS (as below) and MOBIUS_KOKORO, a folder with
    /// sherpa-onnx's kokoro-int8-multi-lang-v1_0 files. The build workflow runs it.
    #[test]
    #[ignore = "needs the voice and speech models on disk"]
    fn a_sentence_is_read_aloud_with_every_word_in_it() {
        let dir = std::env::var("MOBIUS_VOICE_MODELS").unwrap_or_default();
        let kokoro = std::env::var("MOBIUS_KOKORO").unwrap_or_default();
        let at = |f: &str| format!("{dir}/{f}");
        let k = |f: &str| format!("{kokoro}/{f}");
        let files = KokoroFiles { model: k("model.int8.onnx"), voices: k("voices.bin"), tokens: k("tokens.txt"), lexicon: k("lexicon-us-en.txt") };
        let out = std::env::temp_dir().join("mobius-voice-speak-test.wav");
        let out = out.to_string_lossy();
        let mut listener = Listener::new(4);
        let seconds = listener.speak("Today, plant the tulips before the frost, on the 12th of May.", &files, 3, None, &out).unwrap_or_default();
        assert!(seconds > 1.5, "{seconds}");
        // Whisper takes 16 kHz; Kokoro writes 24 kHz, so it is resampled for the check.
        let wave = Wave::read(&out);
        assert!(wave.is_some(), "no sound written");
        let resampled = wave.and_then(|w| sherpa_onnx::LinearResampler::create(w.sample_rate(), SAMPLE_RATE).map(|r| r.resample(w.samples(), true))).unwrap_or_default();
        let wav16 = std::env::temp_dir().join("mobius-voice-speak-test-16k.wav");
        assert!(sherpa_onnx::write(&wav16.to_string_lossy(), &resampled, SAMPLE_RATE));
        let whisper = WhisperFiles { encoder: at("tiny.en-encoder.int8.onnx"), decoder: at("tiny.en-decoder.int8.onnx"), tokens: at("tiny.en-tokens.txt") };
        let (_, segments) = listener.transcribe(&wav16.to_string_lossy(), &Ear::Whisper(whisper), &at("silero_vad.onnx"), None, None).unwrap_or_default();
        let words: String = segments.iter().map(|s| s.text.to_lowercase()).collect::<Vec<_>>().join(" ");
        // Whisper tiny can split a word it hears ("two lips"), so each word may be heard one of a few ways.
        for heard in [&["plant", "plants"][..], &["tulips", "two lips", "tulip"], &["frost"], &["may"]] {
            assert!(heard.iter().any(|w| words.contains(w)), "{} missing from {words}", heard[0]);
        }
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
        let got = listener.transcribe(&at("test_wavs/0.wav"), &Ear::Whisper(files), &at("silero_vad.onnx"), None, None);
        let (seconds, segments) = got.unwrap_or_default();
        assert!(seconds > 6.0, "{seconds}");
        let words: String = segments.iter().map(|s| s.text.to_lowercase()).collect::<Vec<_>>().join(" ");
        assert!(words.contains("yellow lamps"), "{words}");
        assert!(segments.iter().all(|s| s.end - s.start <= MAX_SPEECH_SECONDS + 0.5));
    }

    /// sherpa-onnx's four-speaker test recording, told apart and written down in two parts of one meeting: every
    /// piece gets a speaker, more than one is heard, and the second part's voices are named as in the first. Needs
    /// MOBIUS_SPEAKERS, a folder with pyannote-segmentation.int8.onnx, campplus-en.onnx and four-speakers.wav, beside
    /// MOBIUS_VOICE_MODELS. The build workflow runs it.
    #[test]
    #[ignore = "needs the speaker and speech models on disk"]
    fn speakers_are_told_apart_and_keep_their_names_across_parts() {
        let dir = std::env::var("MOBIUS_VOICE_MODELS").unwrap_or_default();
        let spk = std::env::var("MOBIUS_SPEAKERS").unwrap_or_default();
        let at = |f: &str| format!("{dir}/{f}");
        let s = |f: &str| format!("{spk}/{f}");
        let ear = Ear::Whisper(WhisperFiles { encoder: at("tiny.en-encoder.int8.onnx"), decoder: at("tiny.en-decoder.int8.onnx"), tokens: at("tiny.en-tokens.txt") });
        let files = SpeakerFiles { segmentation: s("pyannote-segmentation.int8.onnx"), embedding: s("campplus-en.onnx"), meeting: "test".into() };
        let wave = Wave::read(&s("four-speakers.wav"));
        assert!(wave.is_some(), "no recording");
        let samples = wave.map(|w| w.samples().to_vec()).unwrap_or_default();
        let half = samples.len() / 2;
        let mut listener = Listener::new(4);
        let mut heard = Vec::new();
        for (n, part) in [&samples[..half], &samples[half..]].into_iter().enumerate() {
            let path = std::env::temp_dir().join(format!("mobius-voice-speakers-{n}.wav"));
            assert!(sherpa_onnx::write(&path.to_string_lossy(), part, SAMPLE_RATE));
            let (_, segments) = listener.transcribe(&path.to_string_lossy(), &ear, &at("silero_vad.onnx"), None, Some(&files)).unwrap_or_default();
            heard.push(segments.into_iter().filter(|s| !s.text.trim().is_empty()).collect::<Vec<_>>());
        }
        let names = |part: &[Segment]| {
            let mut n: Vec<String> = part.iter().filter_map(|s| s.speaker.clone()).collect();
            n.sort();
            n.dedup();
            n
        };
        let (first, second) = (names(&heard[0]), names(&heard[1]));
        assert!(heard.iter().flatten().all(|s| s.speaker.is_some()), "{heard:?}");
        assert!(first.len() >= 2, "{first:?}");
        // Four people in all; told apart well, the second part names at least one voice from the first.
        assert!(second.iter().any(|n| first.contains(n)), "{first:?} then {second:?}");
        assert!(names(&heard.concat()).len() <= 6, "{heard:?}");
    }

    /// A two-person meeting read aloud by two Kokoro voices taking turns, written down in two parts: each person keeps
    /// one name through both parts and nobody else is heard. Needs MOBIUS_VOICE_MODELS, MOBIUS_KOKORO and
    /// MOBIUS_SPEAKERS (as above). The build workflow runs it.
    #[test]
    #[ignore = "needs the voice, speaker and speech models on disk"]
    fn two_people_taking_turns_keep_one_name_each() {
        let dir = std::env::var("MOBIUS_VOICE_MODELS").unwrap_or_default();
        let kokoro = std::env::var("MOBIUS_KOKORO").unwrap_or_default();
        let spk = std::env::var("MOBIUS_SPEAKERS").unwrap_or_default();
        let at = |f: &str| format!("{dir}/{f}");
        let k = |f: &str| format!("{kokoro}/{f}");
        let s = |f: &str| format!("{spk}/{f}");
        let voice = KokoroFiles { model: k("model.int8.onnx"), voices: k("voices.bin"), tokens: k("tokens.txt"), lexicon: k("lexicon-us-en.txt") };
        let ear = Ear::Whisper(WhisperFiles { encoder: at("tiny.en-encoder.int8.onnx"), decoder: at("tiny.en-decoder.int8.onnx"), tokens: at("tiny.en-tokens.txt") });
        let files = SpeakerFiles { segmentation: s("pyannote-segmentation.int8.onnx"), embedding: s("campplus-en.onnx"), meeting: "two".into() };
        let lines = [
            "Thanks for joining. Shall we start with the garden plan?",
            "Yes. I walked the beds this morning and the soil is still wet.",
            "Then we wait a week before planting the tulips.",
            "Agreed. What about the new fence along the north side?",
            "The quote came in at about four hundred dollars.",
            "That is more than we hoped. Can we do half this year?",
            "We could. The posts are the expensive part.",
            "Okay, let us split it over two seasons then.",
            "Sure. I will call them back tomorrow.",
            "Next, the watering. The timer stopped working again.",
            "I saw that. It needs new batteries, nothing more.",
            "Good. And the compost bin is nearly full.",
            "I will turn it on Saturday and start the second one.",
            "Great. Did the seed order arrive?",
            "It did, except the beans, which are on back order.",
            "Fine, beans can go in late anyway.",
            "Right. Anything else for today?",
            "Only the shed roof. It leaked in the last storm.",
            "I can patch it this weekend if it stays dry.",
            "Perfect. Let us meet again next Thursday.",
            "Sounds good. Thanks, talk soon.",
            "Bye for now.",
        ];
        let mut listener = Listener::new(4);
        let gap = vec![0.0_f32; 8000];
        let (mut samples, mut truth) = (Vec::new(), Vec::new());
        for (n, line) in lines.iter().enumerate() {
            let out = std::env::temp_dir().join(format!("mobius-voice-two-{n}.wav"));
            let said = listener.speak(line, &voice, if n % 2 == 0 { 3 } else { 14 }, None, &out.to_string_lossy());
            assert!(said.is_ok(), "{said:?}");
            let wave = Wave::read(&out.to_string_lossy());
            let line16 = wave.and_then(|w| sherpa_onnx::LinearResampler::create(w.sample_rate(), SAMPLE_RATE).map(|r| r.resample(w.samples(), true))).unwrap_or_default();
            #[allow(clippy::cast_precision_loss)]
            let start = samples.len() as f32 / 16_000.0;
            samples.extend_from_slice(&line16);
            #[allow(clippy::cast_precision_loss)]
            truth.push((start, samples.len() as f32 / 16_000.0, n % 2));
            samples.extend_from_slice(&gap);
        }
        let half = samples.len() / 2;
        let mut heard = Vec::new();
        for (n, part) in [&samples[..half], &samples[half..]].into_iter().enumerate() {
            let path = std::env::temp_dir().join(format!("mobius-voice-two-part-{n}.wav"));
            assert!(sherpa_onnx::write(&path.to_string_lossy(), part, SAMPLE_RATE));
            let (_, segments) = listener.transcribe(&path.to_string_lossy(), &ear, &at("silero_vad.onnx"), None, Some(&files)).unwrap_or_default();
            #[allow(clippy::cast_precision_loss)]
            let offset = if n == 0 { 0.0 } else { half as f32 / 16_000.0 };
            heard.extend(segments.into_iter().filter(|s| !s.text.trim().is_empty()).map(|mut s| { s.start += offset; s.end += offset; s }));
        }
        // Each piece is matched with the line it overlaps most; every person's pieces carry one name, and the two differ.
        let mut names: [Vec<String>; 2] = [Vec::new(), Vec::new()];
        for piece in &heard {
            let who = truth.iter().max_by(|a, b| (piece.end.min(a.1) - piece.start.max(a.0)).total_cmp(&(piece.end.min(b.1) - piece.start.max(b.0)))).map_or(0, |t| t.2);
            names[who].push(piece.speaker.clone().unwrap_or_default());
        }
        let label = |v: &Vec<String>| { let mut u = v.clone(); u.sort(); u.dedup(); u };
        let (a, b) = (label(&names[0]), label(&names[1]));
        assert!(a.len() == 1 && b.len() == 1 && a != b, "first voice {:?}, second voice {:?}", names[0], names[1]);
    }

    /// Writes down sherpa-onnx's English test recording with Parakeet v3. Needs MOBIUS_PARAKEET, a folder with
    /// sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8's files (about 670 MB, so the workflow leaves it out), and
    /// MOBIUS_VOICE_MODELS for the speech detector.
    #[test]
    #[ignore = "needs Parakeet on disk"]
    fn parakeet_writes_a_recording_down() {
        let dir = std::env::var("MOBIUS_PARAKEET").unwrap_or_default();
        if dir.is_empty() {
            return;
        }
        let vad = format!("{}/silero_vad.onnx", std::env::var("MOBIUS_VOICE_MODELS").unwrap_or_default());
        let at = |f: &str| format!("{dir}/{f}");
        let ear = Ear::Parakeet(ParakeetFiles { encoder: at("encoder.int8.onnx"), decoder: at("decoder.int8.onnx"), joiner: at("joiner.int8.onnx"), tokens: at("tokens.txt") });
        // The test recording is not 16 kHz everywhere, so it is resampled first.
        let wave = Wave::read(&at("test_wavs/en.wav"));
        let samples = wave.and_then(|w| if w.sample_rate() == SAMPLE_RATE { Some(w.samples().to_vec()) } else { sherpa_onnx::LinearResampler::create(w.sample_rate(), SAMPLE_RATE).map(|r| r.resample(w.samples(), true)) }).unwrap_or_default();
        let wav16 = std::env::temp_dir().join("mobius-voice-parakeet-16k.wav");
        assert!(sherpa_onnx::write(&wav16.to_string_lossy(), &samples, SAMPLE_RATE));
        let got = Listener::new(4).transcribe(&wav16.to_string_lossy(), &ear, &vad, None, None);
        assert!(got.is_ok(), "{got:?}");
        let words: String = got.unwrap_or_default().1.iter().map(|s| s.text.to_lowercase()).collect::<Vec<_>>().join(" ");
        assert!(words.split_whitespace().count() >= 5, "{words}");
    }
}
