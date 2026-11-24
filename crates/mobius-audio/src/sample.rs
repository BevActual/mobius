//! Audio clips' sounds (Live 12 manual, chapter 9 "Audio Clips, Tempo, and Warping"): read from the song's folder
//! and kept while their files stay the same, then placed on the clip's beats, unwarped at the file's own speed or
//! warped to the song's tempo by its tempo or its warp markers. Re-Pitch (9.3.4) plays faster and higher, or slower
//! and lower, like a turntable; every other mode keeps the file's pitch with a granular stretcher (WSOLA): short
//! overlapping grains, each read at the file's own speed from near where the warp puts that moment, nudged to where
//! its sound best carries on from the grain before (so their waves line up and neither cancel nor shift the pitch),
//! faded in and out so they add up to one.

use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::SystemTime;

use crate::song::{Audio, Song};
use crate::wav::Sound;

/// Each file read, with when it last changed and its sound.
type Kept = HashMap<PathBuf, (Option<SystemTime>, Arc<Sound>)>;

/// The sounds read so far, by file, with when the file last changed, so a song changed while it plays does not read
/// its files again.
#[derive(Default)]
pub struct Samples {
    kept: Mutex<Kept>,
}

impl Samples {
    #[must_use]
    pub fn new() -> Samples {
        Samples::default()
    }

    /// The sound in `file` in `folder` (kept, as a clip's is), for drawing its waveform.
    ///
    /// # Errors
    /// When it is outside the folder, missing, or not a WAV it reads.
    pub fn sound(&self, folder: &Path, file: &str) -> Result<Arc<Sound>, String> {
        let mut kept = self.kept.lock().unwrap_or_else(PoisonError::into_inner);
        read(folder, file, &mut kept).map(|(_, sound)| sound)
    }

    /// Reads every sound the song's audio clips, samplers and drum pads name, from `folder`, into the song's `sounds`. A file outside the
    /// folder, missing or not a WAV it reads is left out, so its clip is silent; what went wrong with each is returned.
    pub fn attach(&self, song: &mut Song, folder: &Path) -> Vec<String> {
        let clips = song
            .tracks
            .iter()
            .filter(|t| Song::is_audio(t))
            .flat_map(|t| t.clips.iter().filter_map(|c| c.audio.as_ref()).chain(t.slots.iter().flatten().filter_map(|c| c.audio.as_ref())))
            .map(|a| a.file.clone());
        // And what its samplers and drum pads play.
        let samplers = song.tracks.iter().flat_map(|t| {
            let pads = t.pads.values().filter(move |_| t.instrument == crate::song::Instrument::Drums).filter_map(|p| p.sample.as_ref());
            Song::sampler_of(t).into_iter().chain(pads).map(|s| s.file.clone())
        });
        // And frozen tracks' files, their Session clips' included.
        let frozen = song.tracks.iter().filter_map(|t| t.frozen.as_ref()).flat_map(|f| std::iter::once(&f.file).chain(f.slots.iter().flatten()).cloned());
        let files: Vec<String> = clips.chain(samplers).chain(frozen).collect();
        let mut kept = self.kept.lock().unwrap_or_else(PoisonError::into_inner);
        let mut used = Vec::new();
        let mut problems = Vec::new();
        song.sounds.clear();
        for file in files {
            if song.sounds.contains_key(&file) {
                continue;
            }
            match read(folder, &file, &mut kept) {
                Ok((path, sound)) => {
                    used.push(path);
                    song.sounds.insert(file, sound);
                }
                Err(why) => problems.push(format!("{file}: {why}")),
            }
        }
        // Only the song's own sounds stay kept.
        kept.retain(|path, _| used.contains(path));
        problems
    }
}

/// The file at `file` in `folder`, from what is kept when it has not changed.
fn read(folder: &Path, file: &str, kept: &mut Kept) -> Result<(PathBuf, Arc<Sound>), String> {
    let relative = Path::new(file);
    if file.is_empty() || !relative.components().all(|c| matches!(c, Component::Normal(_))) {
        return Err("the file must be inside the song's folder".into());
    }
    let path = std::fs::canonicalize(folder.join(relative)).map_err(|_| "the file is not there".to_owned())?;
    let root = std::fs::canonicalize(folder).map_err(|e| e.to_string())?;
    if !path.starts_with(&root) {
        return Err("the file must be inside the song's folder".into());
    }
    let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    if meta.len() > crate::wav::MAX_READ as u64 {
        return Err("the file is too long".into());
    }
    let changed = meta.modified().ok();
    if let Some((when, sound)) = kept.get(&path) {
        if *when == changed && changed.is_some() {
            return Ok((path, sound.clone()));
        }
    }
    let sound = Arc::new(crate::wav::read(&std::fs::read(&path).map_err(|e| e.to_string())?)?);
    kept.insert(path.clone(), (changed, sound.clone()));
    Ok((path, sound))
}

/// The most points [`peaks`] gives.
pub const MAX_PEAKS: usize = 100_000;

/// A sound's waveform for drawing: the lowest and highest of left and right together over each `per` frames (more
/// frames a point when that would pass [`MAX_PEAKS`]). Returns the frames a point, and the points.
#[must_use]
pub fn peaks(sound: &Sound, per: usize) -> (usize, Vec<[f32; 2]>) {
    let frames = sound.left.len();
    let per = per.max(1).max(frames.div_ceil(MAX_PEAKS));
    let points = (0..frames)
        .step_by(per)
        .map(|start| {
            let end = (start + per).min(frames);
            let both = sound.left[start..end].iter().chain(&sound.right[start..end]);
            both.fold([f32::INFINITY, f32::NEG_INFINITY], |[lo, hi], x| [lo.min(*x), hi.max(*x)])
        })
        .collect();
    (per, points)
}

/// Where a playing clip's last two grains start in its file (for a warp mode that keeps pitch), so each new grain
/// lines up with the one before. Kept by whoever plays the clip; a new one starts afresh.
#[derive(Debug, Clone, Copy)]
pub struct Stretch {
    grain: i64,
    starts: [f64; 2],
    /// How fast each of the two grains reads the file: 1 at its own pitch, 2 an octave up.
    speeds: [f64; 2],
}

impl Default for Stretch {
    fn default() -> Stretch {
        Stretch { grain: i64::MIN, starts: [0.0; 2], speeds: [1.0; 2] }
    }
}

/// The most a clip is transposed, either way, in semitones (Live 12 manual, 27.2.2).
pub const MAX_TRANSPOSE: f64 = 48.0;

/// An audio clip's sound placed on its own beats: which frame of the file each beat of the clip plays.
#[derive(Clone)]
pub struct Placed {
    sound: Arc<Sound>,
    gain: f32,
    /// Beats of the clip and the file's frames they land on, with straight lines between and the first and last
    /// stretch carried on beyond them.
    map: Vec<(f64, f64)>,
    /// Kept at its pitch: each grain's length in the clip's beats. `None` plays as Re-Pitch (or unwarped).
    grain: Option<f64>,
    /// The file's frames in a second of the song's time, as a grain reads them.
    frames_per_beat: f64,
    /// Its own transposition, in semitones (kept at its pitch only).
    transpose: f64,
}

impl Placed {
    /// `audio` at a song's `tempo`. Unwarped, a beat of the clip is a beat of the song's time; warped, the file's own
    /// tempo (the song's when it says none) or its warp markers pin its beats.
    #[must_use]
    pub fn new(audio: &Audio, sound: Arc<Sound>, tempo: f64) -> Placed {
        let rate = sound.rate;
        let start = audio.offset.max(0.0) * rate;
        let per_beat = |bpm: f64| 60.0 / bpm * rate;
        let mut markers: Vec<(f64, f64)> = audio.markers.iter().filter(|m| m.beat.is_finite() && m.sample.is_finite()).map(|m| (m.beat, m.sample)).collect();
        markers.sort_by(|a, b| a.0.total_cmp(&b.0));
        markers.dedup_by(|a, b| (a.0 - b.0).abs() < 1e-9);
        let bpm = audio.bpm.filter(|b| b.is_finite() && *b > 0.0).unwrap_or(tempo);
        let map = if !audio.warp {
            vec![(0.0, start), (1.0, start + per_beat(tempo))]
        } else if markers.len() >= 2 {
            markers
        } else if let Some(&(beat, sample)) = markers.first() {
            vec![(beat, sample), (beat + 1.0, sample + per_beat(bpm))]
        } else {
            vec![(0.0, start), (1.0, start + per_beat(bpm))]
        };
        // Each mode's grain (Live 12 manual, 9.3): Beats keeps its grains on the beat grid, a sixteenth note long;
        // Tones uses short grains for a clear pitch, Texture long ones for a smooth sound, Complex in between.
        let seconds_per_beat = 60.0 / tempo;
        let grain = match audio.mode.as_deref().filter(|_| audio.warp) {
            None | Some("repitch") => None,
            Some("beats") => Some(0.25),
            Some("tones") => Some(0.04 / seconds_per_beat),
            Some("texture") => Some(0.1 / seconds_per_beat),
            Some(_) => Some(0.06 / seconds_per_beat),
        };
        let transpose = if audio.transpose.is_finite() { audio.transpose.clamp(-MAX_TRANSPOSE, MAX_TRANSPOSE) } else { 0.0 };
        Placed { sound, gain: 10f64.powf(audio.gain_db.clamp(-70.0, 24.0) / 20.0) as f32, map, grain, frames_per_beat: seconds_per_beat * rate, transpose }
    }

    /// The file's frame at a beat of the clip.
    fn frame(&self, beat: f64) -> f64 {
        let map = &self.map;
        let i = map.partition_point(|m| m.0 <= beat).clamp(1, map.len() - 1);
        let ((b0, f0), (b1, f1)) = (map[i - 1], map[i]);
        f0 + (beat - b0) / (b1 - b0) * (f1 - f0)
    }

    /// The sound at a beat of the clip, left and right, at its gain: between two frames, a straight line between
    /// them; before the file's start or past its end, silence.
    #[must_use]
    /// Beats are asked for in order as it plays; `stretch` keeps where its grains start, for a mode that keeps pitch.
    pub fn at(&self, beat: f64, stretch: &mut Stretch) -> (f32, f32) {
        self.at_transposed(beat, stretch, 0.0)
    }

    /// As [`Placed::at`], transposed by `more` semitones beyond its own (a clip's transposition envelope, added to
    /// its Transpose: 27.2.2), all of it kept within ±48. Each grain reads the file faster or slower from where the
    /// warp puts it, so the clip keeps its timing and changes its pitch; a grain keeps the speed it started with.
    pub fn at_transposed(&self, beat: f64, stretch: &mut Stretch, more: f64) -> (f32, f32) {
        let Some(grain) = self.grain else { return self.at_frame(self.frame(beat)) };
        let more = if more.is_finite() { more } else { 0.0 };
        let speed = 2f64.powf((self.transpose + more).clamp(-MAX_TRANSPOSE, MAX_TRANSPOSE) / 12.0);
        // The two grains sounding at this beat, half a grain apart, each under a Hann window (the two windows always
        // add up to one). A new grain starts near where the warp puts it, lined up with the one before; after a jump
        // (a seek, or round a loop) both start where the warp puts them.
        let half = grain / 2.0;
        let k = (beat / half).floor() as i64;
        if k != stretch.grain {
            // Where a grain starts reading: transposed, it reads faster or slower than the warp moves, so it starts
            // that much earlier or later for its middle (where its window is loudest) to land where the warp puts it,
            // and the clip's timing stays where it was.
            let at = |k: i64, speed: f64| self.frame(k as f64 * half) - (speed - 1.0) * half * self.frames_per_beat;
            (stretch.starts, stretch.speeds) = if stretch.grain != i64::MIN && k == stretch.grain + 1 {
                let (before, was) = (stretch.starts[1], stretch.speeds[1]);
                // Transposed, it looks only 5 ms either way: further, a burst lines up with the wrong part of itself and moves.
                let within = if (speed - 1.0).abs() > 1e-6 { 0.005 } else { 0.012 };
                ([before, self.line_up(before + half * self.frames_per_beat * was, at(k, speed), within)], [was, speed])
            } else {
                ([at(k - 1, speed), at(k, speed)], [speed; 2])
            };
            stretch.grain = k;
        }
        let (mut l, mut r) = (0.0, 0.0);
        for (i, start) in [k - 1, k].into_iter().enumerate() {
            let start_beat = start as f64 * half;
            let u = (beat - start_beat) / grain;
            let w = (std::f64::consts::PI * u).sin().powi(2) as f32;
            let (a, b) = self.at_frame(stretch.starts[i] + (beat - start_beat) * self.frames_per_beat * stretch.speeds[i]);
            l += a * w;
            r += b * w;
        }
        (l, r)
    }

    /// Where near `target` (`within` seconds either way) the file sounds most like it does at `carry_on`, where the grain before
    /// would have gone on to: the best normalised match over 10 ms, compared every few frames.
    fn line_up(&self, carry_on: f64, target: f64, within: f64) -> f64 {
        let x = &self.sound.left;
        let rate = self.sound.rate;
        let (reach, span) = ((within * rate) as i64, (0.01 * rate) as usize);
        let from = carry_on.floor();
        if from < 0.0 || from as usize + span >= x.len() {
            return target;
        }
        let from = from as usize;
        let mono = |i: usize| x[i] + self.sound.right[i];
        let centre = target.floor() as i64;
        // Nearest the warp first, so a tie (silence, or a steady sound) stays where the warp puts it, and only a sound
        // that carries on (a positive match) moves it.
        let (mut best, mut best_score) = (target, f32::NEG_INFINITY);
        let lags = (0..=reach / 2).flat_map(|step| if step == 0 { vec![0] } else { vec![-2 * step, 2 * step] });
        for lag in lags {
            let p = centre + lag;
            if p < 0 || p as usize + span >= x.len() {
                continue;
            }
            let p = p as usize;
            let (mut dot, mut energy) = (0.0f32, 1e-9f32);
            for i in (0..span).step_by(4) {
                let y = mono(p + i);
                dot += mono(from + i) * y;
                energy += y * y;
            }
            let score = dot / energy.sqrt();
            if score > best_score {
                best_score = score;
                best = p as f64 + (carry_on - carry_on.floor());
            }
        }
        best
    }

    /// The sound at a frame of the file, at its gain.
    fn at_frame(&self, frame: f64) -> (f32, f32) {
        let (left, right) = (&self.sound.left, &self.sound.right);
        if left.len() < 2 || frame.is_nan() || frame < 0.0 || frame >= (left.len() - 1) as f64 {
            return (0.0, 0.0);
        }
        let i = frame as usize;
        let t = (frame - i as f64) as f32;
        let mix = |s: &[f32]| s[i] + (s[i + 1] - s[i]) * t;
        (mix(left) * self.gain, mix(right) * self.gain)
    }
}

/// Puts a sound the person brought into the song's `Samples` folder, under `name` (made safe, and numbered if the name
/// is taken: `Kick.wav`, `Kick 2.wav`), and gives its file relative to the folder (`Samples/Kick.wav`). Only a WAV that
/// [`crate::wav::read`] reads is taken.
///
/// # Errors
/// When it is not such a WAV, or cannot be saved.
pub fn import(folder: &Path, name: &str, bytes: &[u8]) -> Result<String, String> {
    if bytes.len() > crate::wav::MAX_READ {
        return Err("That sound is too big.".into());
    }
    crate::wav::read(bytes).map_err(|why| format!("Music takes WAV files for now ({why})."))?;
    let stem = name.strip_suffix(".wav").or_else(|| name.strip_suffix(".WAV")).unwrap_or(name);
    let stem = crate::record::file_stem(stem, "Sample");
    let samples = folder.join("Samples");
    std::fs::create_dir_all(&samples).map_err(|e| format!("The Samples folder could not be made: {e}"))?;
    for n in 1u32.. {
        let file = if n == 1 { format!("{stem}.wav") } else { format!("{stem} {n}.wav") };
        match std::fs::OpenOptions::new().write(true).create_new(true).open(samples.join(&file)) {
            Ok(mut out) => {
                std::io::Write::write_all(&mut out, bytes).map_err(|e| format!("The sound could not be saved: {e}"))?;
                return Ok(format!("Samples/{file}"));
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(e) => return Err(format!("The sound could not be saved: {e}")),
        }
    }
    Err("The sound could not be saved.".into())
}

/// The WAV files in the song's `Samples` folder and the folders in it (`Recorded` and so on), relative to the song's
/// folder, in name order.
#[must_use]
pub fn list(folder: &Path) -> Vec<String> {
    fn walk(dir: &Path, relative: &str, depth: usize, out: &mut Vec<String>) {
        let Ok(entries) = std::fs::read_dir(dir) else { return };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            let Ok(kind) = entry.file_type() else { continue };
            if kind.is_dir() && depth < 3 {
                walk(&entry.path(), &format!("{relative}/{name}"), depth + 1, out);
            } else if kind.is_file() && name.to_lowercase().ends_with(".wav") {
                out.push(format!("{relative}/{name}"));
            }
        }
    }
    let mut out = Vec::new();
    walk(&folder.join("Samples"), "Samples", 0, &mut out);
    out.sort();
    out
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use crate::song::WarpMarker;

    fn audio(json: &str) -> Audio {
        serde_json::from_str(json).unwrap()
    }

    /// A second of a ramp at 1 kHz: frame n is n / 1000.
    fn ramp() -> Arc<Sound> {
        let left: Vec<f32> = (0..1000).map(|n| n as f32 / 1000.0).collect();
        Arc::new(Sound { rate: 1000.0, right: left.clone(), left })
    }

    #[test]
    fn unwarped_plays_at_its_own_speed_from_its_offset() {
        // At 120 BPM a beat is half a second: 500 frames.
        let p = Placed::new(&audio(r#"{"file":"a.wav","offset":0.1}"#), ramp(), 120.0);
        assert!((p.at(0.0, &mut Stretch::default()).0 - 0.1).abs() < 1e-6);
        assert!((p.at(1.0, &mut Stretch::default()).0 - 0.6).abs() < 1e-6);
        assert!((p.at(0.25, &mut Stretch::default()).0 - 0.225).abs() < 1e-6);
        // Past the end, and before the start, nothing.
        assert_eq!(p.at(2.0, &mut Stretch::default()), (0.0, 0.0));
        assert_eq!(p.at(-1.0, &mut Stretch::default()), (0.0, 0.0));
    }

    #[test]
    fn re_pitch_follows_the_song_tempo_and_gain_is_in_db() {
        // A 60 BPM file in a 120 BPM song: a beat of the clip is a second of the file, so it plays twice as fast.
        let p = Placed::new(&audio(r#"{"file":"a.wav","warp":true,"mode":"repitch","bpm":240,"gainDb":-6.0206}"#), ramp(), 120.0);
        assert!((p.at(1.0, &mut Stretch::default()).0 - 0.25 * 0.5).abs() < 1e-4);
    }

    /// A second of a 440 Hz sine at 48 kHz and -12 dBFS.
    fn tone() -> Arc<Sound> {
        let rate = 48_000.0;
        let left: Vec<f32> = (0..48_000).map(|n| (0.251 * (std::f64::consts::TAU * 440.0 * f64::from(n) / rate).sin()) as f32).collect();
        Arc::new(Sound { rate, right: left.clone(), left })
    }

    /// `p` played for `seconds` of a 120 BPM song at 48 kHz, in order as the engine asks.
    fn play(p: &Placed, seconds: f64) -> Vec<f32> {
        let mut st = Stretch::default();
        (0..(seconds * 48_000.0) as usize).map(|i| p.at(i as f64 / 24_000.0, &mut st).0).collect()
    }

    /// The pitch over the middle of `s`, from the time between its first and last upward zero crossings.
    fn pitch(s: &[f32]) -> f64 {
        let mid = &s[s.len() / 5..s.len() * 4 / 5];
        let ups: Vec<usize> = mid.windows(2).enumerate().filter(|(_, w)| w[0] < 0.0 && w[1] >= 0.0).map(|(i, _)| i).collect();
        (ups.len() - 1) as f64 * 48_000.0 / (ups[ups.len() - 1] - ups[0]) as f64
    }

    #[test]
    fn transpose_changes_the_pitch_and_keeps_the_timing_but_not_in_re_pitch() {
        let at = |mode: &str, transpose: f64| Placed::new(&audio(&format!(r#"{{"file":"a.wav","warp":true,"mode":"{mode}","bpm":60,"transpose":{transpose}}}"#)), tone(), 120.0);
        let cents = |hz: f64, want: f64| (1200.0 * (hz / want).log2()).abs();
        for mode in ["beats", "tones", "texture", "complex"] {
            // An octave up, a fifth down, and a semitone and a half up as cents: still played in half the time.
            for (st, want) in [(12.0, 880.0), (-7.0, 440.0 * 2f64.powf(-7.0 / 12.0)), (1.5, 440.0 * 2f64.powf(1.5 / 12.0))] {
                let s = play(&at(mode, st), 0.5);
                assert!(cents(pitch(&s), want) < 8.0, "{mode} {st}: {} Hz", pitch(&s));
                for w in s[4_800..19_200].chunks(480) {
                    let rms = (w.iter().map(|x| x * x).sum::<f32>() / w.len() as f32).sqrt();
                    assert!((20.0 * (rms / (0.251 / 2f32.sqrt())).log10()).abs() < 2.0, "{mode} {st}");
                }
            }
        }
        // Re-Pitch deactivates it (9.3.4): an octave up from the speed alone.
        assert!(cents(pitch(&play(&at("repitch", 12.0), 0.5)), 880.0) < 2.0);
        // An envelope's semitones add to the clip's own, and the sum stays within 48.
        let p = at("complex", 5.0);
        let mut st = Stretch::default();
        let s: Vec<f32> = (0..24_000).map(|i| p.at_transposed(i as f64 / 24_000.0, &mut st, 7.0).0).collect();
        assert!(cents(pitch(&s), 880.0) < 8.0, "{}", pitch(&s));
        assert!(Placed::new(&audio(r#"{"file":"a.wav","warp":true,"mode":"complex","transpose":90}"#), tone(), 120.0).transpose == MAX_TRANSPOSE);
    }

    #[test]
    fn transposing_keeps_each_sound_where_it_was() {
        // A 20 ms burst of 440 Hz every quarter second, at the song's tempo.
        let rate = 48_000.0;
        let left: Vec<f32> = (0..96_000).map(|n| if n % 12_000 < 960 { (0.5 * (std::f64::consts::TAU * 440.0 * f64::from(n) / rate).sin()) as f32 } else { 0.0 }).collect();
        let bursts = Arc::new(Sound { rate, right: left.clone(), left });
        // Where each burst's sound is centred, in ms from where it starts, from its energy.
        let centres = |s: &[f32]| -> Vec<f64> {
            // From 60 ms before each burst to 80 ms after it, so the next burst's sound never counts.
            (1..7).map(|k| {
                let from = k * 12_000 - 2_880;
                let (sum, at) = s[from..from + 6_720].iter().enumerate().fold((0.0, 0.0), |(e, t), (i, x)| (e + f64::from(x * x), t + i as f64 * f64::from(x * x)));
                at / sum / 48.0 - 60.0
            }).collect()
        };
        for mode in ["beats", "tones", "texture", "complex"] {
            let at = |transpose: f64| Placed::new(&audio(&format!(r#"{{"file":"a.wav","warp":true,"mode":"{mode}","bpm":120,"transpose":{transpose}}}"#)), bursts.clone(), 120.0);
            let plain = centres(&play(&at(0.0), 1.75));
            for transpose in [7.0, -7.0, 12.0] {
                let moved = centres(&play(&at(transpose), 1.75));
                // Each burst's 20 ms centred 10 ms in, as the file has it: within 5 ms when transposed (grains repeat or skip a little of it).
                for (a, b) in plain.iter().zip(&moved) {
                    assert!((a - 10.0).abs() < 0.5 && (b - 10.0).abs() < 5.0, "{mode} {transpose}: {plain:?} {moved:?}");
                }
            }
        }
    }

    #[test]
    fn every_mode_that_keeps_pitch_keeps_it_and_its_level() {
        // A 60 BPM file in a 120 BPM song: played in half the time. Re-Pitch goes up an octave; the others stay at 440.
        let at = |mode: &str| Placed::new(&audio(&format!(r#"{{"file":"a.wav","warp":true,"mode":"{mode}","bpm":60}}"#)), tone(), 120.0);
        let turntable = play(&at("repitch"), 0.5);
        assert!((pitch(&turntable) - 880.0).abs() < 1.0, "{}", pitch(&turntable));
        for mode in ["beats", "tones", "texture", "complex", "complexpro"] {
            let s = play(&at(mode), 0.5);
            let hz = pitch(&s);
            // Within 5 cents.
            assert!((1200.0 * (hz / 440.0).log2()).abs() < 5.0, "{mode}: {hz} Hz");
            // No grains cancelling: every 10 ms of the middle is within 1.5 dB of the tone's level.
            for w in s[4_800..19_200].chunks(480) {
                let rms = (w.iter().map(|x| x * x).sum::<f32>() / w.len() as f32).sqrt();
                let db = 20.0 * (rms / (0.251 / 2f32.sqrt())).log10();
                assert!(db.abs() < 1.5, "{mode}: {db} dB");
            }
        }
        // And at its own tempo it is the file as it is, near enough.
        let same = Placed::new(&audio(r#"{"file":"a.wav","warp":true,"mode":"texture","bpm":60}"#), Arc::new(Sound { rate: 1000.0, left: vec![0.5; 2000], right: vec![0.5; 2000] }), 60.0);
        assert!((same.at(0.7, &mut Stretch::default()).0 - 0.5).abs() < 1e-4);
    }

    #[test]
    fn peaks_give_each_stretch_its_lowest_and_highest() {
        let sound = Sound { rate: 1000.0, left: vec![0.1, -0.5, 0.2, 0.9, 0.0], right: vec![0.0, 0.0, -0.3, 0.0, 0.0] };
        assert_eq!(peaks(&sound, 2), (2, vec![[-0.5, 0.1], [-0.3, 0.9], [0.0, 0.0]]));
        let long = Sound { rate: 1000.0, left: vec![0.0; MAX_PEAKS * 3], right: vec![0.0; MAX_PEAKS * 3] };
        assert_eq!(peaks(&long, 1).0, 3);
    }

    #[test]
    fn warp_markers_pin_beats_to_frames() {
        let mut a = audio(r#"{"file":"a.wav","warp":true}"#);
        a.markers = vec![WarpMarker { sample: 100.0, beat: 0.0 }, WarpMarker { sample: 300.0, beat: 1.0 }, WarpMarker { sample: 900.0, beat: 2.0 }];
        let p = Placed::new(&a, ramp(), 120.0);
        assert!((p.at(0.5, &mut Stretch::default()).0 - 0.2).abs() < 1e-6);
        assert!((p.at(1.5, &mut Stretch::default()).0 - 0.6).abs() < 1e-6);
        // Before the first marker the first stretch carries on.
        assert!((p.at(-0.25, &mut Stretch::default()).0 - 0.05).abs() < 1e-6);
    }

    #[test]
    fn sounds_are_read_from_inside_the_song_folder_only() {
        let dir = std::env::temp_dir().join(format!("mobius-samples-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("Samples")).unwrap();
        let mut bytes = Vec::new();
        crate::wav::write(&mut bytes, &[0.5; 10], &[0.5; 10], 48_000).unwrap();
        std::fs::write(dir.join("Samples/take.wav"), &bytes).unwrap();
        let mut song = Song::parse(
            r#"{"tempo":120,"bars":1,"tracks":[{"id":"v","kind":"audio","clips":[
            {"start":0,"length":4,"audio":{"file":"Samples/take.wav"}},{"start":0,"length":4,"audio":{"file":"../x.wav"}},{"start":0,"length":4,"audio":{"file":"Samples/none.wav"}}]}]}"#,
        )
        .unwrap();
        let samples = Samples::new();
        let problems = samples.attach(&mut song, &dir);
        assert_eq!(song.sounds.len(), 1);
        assert_eq!(song.sounds["Samples/take.wav"].left.len(), 10);
        assert_eq!(problems.len(), 2);
        // Read again, the kept sound is the same one.
        let first = song.sounds["Samples/take.wav"].clone();
        samples.attach(&mut song, &dir);
        assert!(Arc::ptr_eq(&first, &song.sounds["Samples/take.wav"]));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_brought_sound_goes_in_the_samples_folder_under_a_fresh_name_and_is_listed() {
        let dir = std::env::temp_dir().join(format!("mobius-import-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let mut wav = std::io::Cursor::new(Vec::new());
        let mut w = crate::wav::Writer::new(&mut wav, 48_000).unwrap();
        w.write(&[0.5, 0.5]).unwrap();
        w.finish().unwrap();
        let wav = wav.into_inner();
        assert_eq!(import(&dir, "Kick.wav", &wav).unwrap(), "Samples/Kick.wav");
        assert_eq!(import(&dir, "Kick.wav", &wav).unwrap(), "Samples/Kick 2.wav");
        assert_eq!(import(&dir, "../up/Snare", &wav).unwrap(), "Samples/up Snare.wav");
        assert!(import(&dir, "notes.txt", b"hello").is_err());
        std::fs::create_dir_all(dir.join("Samples/Recorded")).unwrap();
        std::fs::write(dir.join("Samples/Recorded/Vocal 1.wav"), &wav).unwrap();
        assert_eq!(list(&dir), ["Samples/Kick 2.wav", "Samples/Kick.wav", "Samples/Recorded/Vocal 1.wav", "Samples/up Snare.wav"]);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
