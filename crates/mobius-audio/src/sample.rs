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

    /// Reads every sound the song's audio clips name, from `folder`, into the song's `sounds`. A file outside the
    /// folder, missing or not a WAV it reads is left out, so its clip is silent; what went wrong with each is returned.
    pub fn attach(&self, song: &mut Song, folder: &Path) -> Vec<String> {
        let files: Vec<String> = song
            .tracks
            .iter()
            .filter(|t| Song::is_audio(t))
            .flat_map(|t| t.clips.iter().filter_map(|c| c.audio.as_ref()).chain(t.slots.iter().flatten().filter_map(|c| c.audio.as_ref())))
            .map(|a| a.file.clone())
            .collect();
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

/// Where a playing clip's last two grains start in its file (for a warp mode that keeps pitch), so each new grain
/// lines up with the one before. Kept by whoever plays the clip; a new one starts afresh.
#[derive(Debug, Clone, Copy)]
pub struct Stretch {
    grain: i64,
    starts: [f64; 2],
}

impl Default for Stretch {
    fn default() -> Stretch {
        Stretch { grain: i64::MIN, starts: [0.0; 2] }
    }
}

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
        Placed { sound, gain: 10f64.powf(audio.gain_db.clamp(-70.0, 24.0) / 20.0) as f32, map, grain, frames_per_beat: seconds_per_beat * rate }
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
        let Some(grain) = self.grain else { return self.at_frame(self.frame(beat)) };
        // The two grains sounding at this beat, half a grain apart, each under a Hann window (the two windows always
        // add up to one). A new grain starts near where the warp puts it, lined up with the one before; after a jump
        // (a seek, or round a loop) both start where the warp puts them.
        let half = grain / 2.0;
        let k = (beat / half).floor() as i64;
        if k != stretch.grain {
            let at = |k: i64| self.frame(k as f64 * half);
            stretch.starts = if stretch.grain != i64::MIN && k == stretch.grain + 1 {
                let before = stretch.starts[1];
                [before, self.line_up(before + half * self.frames_per_beat, at(k))]
            } else {
                [at(k - 1), at(k)]
            };
            stretch.grain = k;
        }
        let (mut l, mut r) = (0.0, 0.0);
        for (i, start) in [k - 1, k].into_iter().enumerate() {
            let start_beat = start as f64 * half;
            let u = (beat - start_beat) / grain;
            let w = (std::f64::consts::PI * u).sin().powi(2) as f32;
            let (a, b) = self.at_frame(stretch.starts[i] + (beat - start_beat) * self.frames_per_beat);
            l += a * w;
            r += b * w;
        }
        (l, r)
    }

    /// Where near `target` (within 12 ms) the file sounds most like it does at `carry_on`, where the grain before
    /// would have gone on to: the best normalised match over 10 ms, compared every few frames.
    fn line_up(&self, carry_on: f64, target: f64) -> f64 {
        let x = &self.sound.left;
        let rate = self.sound.rate;
        let (reach, span) = ((0.012 * rate) as i64, (0.01 * rate) as usize);
        let from = carry_on.floor();
        if from < 0.0 || from as usize + span >= x.len() {
            return target;
        }
        let from = from as usize;
        let mono = |i: usize| x[i] + self.sound.right[i];
        let centre = target.floor() as i64;
        let (mut best, mut best_score) = (target, f32::NEG_INFINITY);
        let mut lag = -reach;
        while lag <= reach {
            let p = centre + lag;
            lag += 2;
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
}
