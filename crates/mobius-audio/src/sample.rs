//! Audio clips' sounds (Live 12 manual, chapter 9 "Audio Clips, Tempo, and Warping"): read from the song's folder
//! and kept while their files stay the same, then placed on the clip's beats, unwarped at the file's own speed or
//! warped to the song's tempo by its tempo or its warp markers. Warped clips play as Re-Pitch for now (9.3.4): faster
//! and higher, or slower and lower, like a turntable.

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

/// An audio clip's sound placed on its own beats: which frame of the file each beat of the clip plays.
#[derive(Clone)]
pub struct Placed {
    sound: Arc<Sound>,
    gain: f32,
    /// Beats of the clip and the file's frames they land on, with straight lines between and the first and last
    /// stretch carried on beyond them.
    map: Vec<(f64, f64)>,
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
        Placed { sound, gain: 10f64.powf(audio.gain_db.clamp(-70.0, 24.0) / 20.0) as f32, map }
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
    pub fn at(&self, beat: f64) -> (f32, f32) {
        let frame = self.frame(beat);
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
        assert!((p.at(0.0).0 - 0.1).abs() < 1e-6);
        assert!((p.at(1.0).0 - 0.6).abs() < 1e-6);
        assert!((p.at(0.25).0 - 0.225).abs() < 1e-6);
        // Past the end, and before the start, nothing.
        assert_eq!(p.at(2.0), (0.0, 0.0));
        assert_eq!(p.at(-1.0), (0.0, 0.0));
    }

    #[test]
    fn re_pitch_follows_the_song_tempo_and_gain_is_in_db() {
        // A 60 BPM file in a 120 BPM song: a beat of the clip is a second of the file, so it plays twice as fast.
        let p = Placed::new(&audio(r#"{"file":"a.wav","warp":true,"mode":"repitch","bpm":240,"gainDb":-6.0206}"#), ramp(), 120.0);
        assert!((p.at(1.0).0 - 0.25 * 0.5).abs() < 1e-4);
    }

    #[test]
    fn warp_markers_pin_beats_to_frames() {
        let mut a = audio(r#"{"file":"a.wav","warp":true}"#);
        a.markers = vec![WarpMarker { sample: 100.0, beat: 0.0 }, WarpMarker { sample: 300.0, beat: 1.0 }, WarpMarker { sample: 900.0, beat: 2.0 }];
        let p = Placed::new(&a, ramp(), 120.0);
        assert!((p.at(0.5).0 - 0.2).abs() < 1e-6);
        assert!((p.at(1.5).0 - 0.6).abs() < 1e-6);
        // Before the first marker the first stretch carries on.
        assert!((p.at(-0.25).0 - 0.05).abs() < 1e-6);
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
