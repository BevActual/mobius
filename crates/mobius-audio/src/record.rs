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

/// A new take's file for a track called `name`: `Samples/Recorded/<name> <n>.wav` in the song's `folder`, with the
/// first number not yet used. The folder is made if need be.
///
/// # Errors
/// When the folder cannot be made.
pub fn next_take(folder: &Path, name: &str) -> Result<(PathBuf, String), String> {
    let recorded = folder.join("Samples").join("Recorded");
    std::fs::create_dir_all(&recorded).map_err(|e| format!("The Samples folder could not be made: {e}"))?;
    let clean: String = name.chars().map(|c| if c.is_control() || "/\\:*?\"<>|".contains(c) { ' ' } else { c }).collect();
    let clean = clean.trim().trim_matches('.').trim();
    let stem = if clean.is_empty() { "Audio" } else { clean };
    let mut n = 1;
    loop {
        let file = format!("{stem} {n}.wav");
        if !recorded.join(&file).exists() {
            return Ok((recorded.join(&file), format!("Samples/Recorded/{file}")));
        }
        n += 1;
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

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
