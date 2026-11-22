//! Recording audio (Live 12 manual, chapter 19 "Recording New Clips"). The audio thread hands what comes in from the
//! input to a take through a wait-free queue while the song plays; a thread of the take's own writes it as it comes to
//! a 32-bit float WAV in the song's `Samples/Recorded` folder (19.7 "Recording File Type"; 19.8 "Where Are the
//! Recordings?"), named for its track and numbered: `Vocal 1.wav`, `Vocal 2.wav` and so on.

use std::path::{Path, PathBuf};

/// Seconds of sound the queue to the writer holds: plenty for a disk that stalls a moment.
const QUEUE_SECONDS: usize = 4;

/// A take being written.
pub struct Recorder {
    file: PathBuf,
    rate: u32,
    writing: std::thread::JoinHandle<Result<u64, String>>,
}

/// A finished take's file, how many frames it holds and at what rate.
#[derive(Debug, Clone, PartialEq)]
pub struct Written {
    pub file: PathBuf,
    pub frames: u64,
    pub rate: u32,
}

impl Recorder {
    /// Starts a take in `file` (made new, never over one there) at `rate`, and the queue the audio thread fills it from,
    /// left and right interleaved. It is written until the queue's other end is dropped.
    ///
    /// # Errors
    /// When the file cannot be made.
    pub fn start(file: &Path, rate: u32) -> Result<(Recorder, rtrb::Producer<f32>), String> {
        let out = std::fs::OpenOptions::new().write(true).create_new(true).open(file).map_err(|e| format!("The recording could not be saved: {e}"))?;
        let mut writer = crate::wav::Writer::new(std::io::BufWriter::new(out), rate).map_err(|e| e.to_string())?;
        let (producer, mut queue) = rtrb::RingBuffer::<f32>::new(rate as usize * 2 * QUEUE_SECONDS);
        let writing = std::thread::Builder::new()
            .name("mobius-take".into())
            .spawn(move || -> Result<u64, String> {
                loop {
                    // Read whether it has been let go before what is waiting, so nothing put in last is missed.
                    let ended = queue.is_abandoned();
                    let waiting = queue.slots() & !1;
                    if waiting > 0 {
                        let chunk = queue.read_chunk(waiting).map_err(|e| e.to_string())?;
                        let (a, b) = chunk.as_slices();
                        writer.write(a).and_then(|()| writer.write(b)).map_err(|e| e.to_string())?;
                        chunk.commit_all();
                    } else if ended {
                        break;
                    } else {
                        std::thread::sleep(std::time::Duration::from_millis(10));
                    }
                }
                writer.finish().map_err(|e| e.to_string())
            })
            .map_err(|e| e.to_string())?;
        Ok((Recorder { file: file.to_path_buf(), rate, writing }, producer))
    }

    /// Waits for the take to be written (once its queue has been let go).
    ///
    /// # Errors
    /// When writing failed.
    pub fn finish(self) -> Result<Written, String> {
        let frames = self.writing.join().map_err(|_| "The recording stopped unexpectedly.".to_owned())??;
        Ok(Written { file: self.file, frames, rate: self.rate })
    }
}

/// An input's sound brought to the engine's rate as it comes: each frame out is a cubic (Catmull-Rom) curve through
/// the four frames around it, so a 48 kHz microphone records into a 44.1 kHz song. At the same rate, frames pass
/// straight through.
pub struct Resample {
    /// Input frames per frame out.
    step: f64,
    /// Where the next frame out falls between the middle two of `last`.
    at: f64,
    last: [(f32, f32); 4],
}

impl Resample {
    #[must_use]
    pub fn new(from: f64, to: f64) -> Resample {
        Resample { step: from / to, at: 0.0, last: [(0.0, 0.0); 4] }
    }

    /// Takes one input frame, giving `out` each frame out it completes (none, one or more).
    pub fn push(&mut self, frame: (f32, f32), mut out: impl FnMut((f32, f32))) {
        if (self.step - 1.0).abs() < 1e-12 {
            out(frame);
            return;
        }
        self.last = [self.last[1], self.last[2], self.last[3], frame];
        while self.at < 1.0 {
            let t = self.at as f32;
            let curve = |a: f32, b: f32, c: f32, d: f32| b + 0.5 * t * (c - a + t * (2.0 * a - 5.0 * b + 4.0 * c - d + t * (3.0 * (b - c) + d - a)));
            let [p0, p1, p2, p3] = self.last;
            out((curve(p0.0, p1.0, p2.0, p3.0), curve(p0.1, p1.1, p2.1, p3.1)));
            self.at += self.step;
        }
        self.at -= 1.0;
    }
}

/// A new take's file for a track called `name`: `Samples/Recorded/<name> <n>.wav` in the song's `folder`, with the
/// first number not yet used. The folder is made if need be.
///
/// # Errors
/// When the folder cannot be made.
pub fn next_take(folder: &Path, name: &str) -> Result<(PathBuf, String), String> {
    let recorded = folder.join("Samples").join("Recorded");
    std::fs::create_dir_all(&recorded).map_err(|e| format!("The Samples folder could not be made: {e}"))?;
    let stem = file_stem(name, "Audio");
    let mut n = 1;
    loop {
        let file = format!("{stem} {n}.wav");
        if !recorded.join(&file).exists() {
            return Ok((recorded.join(&file), format!("Samples/Recorded/{file}")));
        }
        n += 1;
    }
}

/// `name` made safe as a file's name on any system (no slashes, colons and the like, no leading or trailing dots),
/// or `otherwise` when nothing is left.
#[must_use]
pub fn file_stem(name: &str, otherwise: &str) -> String {
    let clean: String = name.chars().map(|c| if c.is_control() || "/\\:*?\"<>|".contains(c) { ' ' } else { c }).collect();
    let clean = clean.trim().trim_matches('.').trim();
    if clean.is_empty() { otherwise.to_owned() } else { clean.chars().take(120).collect() }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn a_48k_input_is_brought_to_44_1k_at_the_same_pitch() {
        let mut r = Resample::new(48_000.0, 44_100.0);
        let mut out = Vec::new();
        for n in 0..48_000 {
            let x = (std::f64::consts::TAU * 1000.0 * f64::from(n) / 48_000.0).sin() as f32;
            r.push((x, -x), |f| out.push(f));
        }
        assert!((out.len() as i64 - 44_100).abs() <= 1, "{}", out.len());
        // 1 kHz still: as many upward crossings in the second as before, and the curve stays close to the sine.
        let ups = out.windows(2).filter(|w| w[0].0 < 0.0 && w[1].0 >= 0.0).count();
        assert!((ups as i64 - 1000).abs() <= 1, "{ups}");
        for (i, f) in out.iter().enumerate().skip(10).take(1000) {
            // Two input frames late.
            let want = (std::f64::consts::TAU * 1000.0 * (i as f64 / 44_100.0 - 2.0 / 48_000.0)).sin() as f32;
            assert!((f.0 - want).abs() < 0.01 && (f.1 + f.0).abs() < 1e-6, "{i}: {} vs {want}", f.0);
        }
        // The same rate passes frames straight through.
        let mut same = Vec::new();
        Resample::new(44_100.0, 44_100.0).push((0.5, 0.25), |f| same.push(f));
        assert_eq!(same, [(0.5, 0.25)]);
    }

    #[test]
    fn a_take_is_written_as_it_comes_and_numbered_for_its_track() {
        let dir = std::env::temp_dir().join(format!("mobius-take-{}", std::process::id()));
        let (file, relative) = next_take(&dir, "Vocal: lead").unwrap();
        assert_eq!(relative, "Samples/Recorded/Vocal  lead 1.wav");
        let (recorder, mut queue) = Recorder::start(&file, 48_000).unwrap();
        for s in [0.5, 0.25, -0.5, 0.0] {
            queue.push(s).unwrap();
        }
        drop(queue);
        let written = recorder.finish().unwrap();
        assert_eq!(written.frames, 2);
        let sound = crate::wav::read(&std::fs::read(&file).unwrap()).unwrap();
        assert_eq!((sound.left, sound.right), (vec![0.5, -0.5], vec![0.25, 0.0]));
        // The next take does not overwrite it.
        assert_eq!(next_take(&dir, "Vocal: lead").unwrap().1, "Samples/Recorded/Vocal  lead 2.wav");
        assert!(Recorder::start(&file, 48_000).is_err());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
