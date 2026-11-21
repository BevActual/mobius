//! The song made into sound, block by block on the sample clock: the same code for offline render and, next, for the
//! audio thread. Notes start on their own sample; each track's notes are mixed, set to its volume and pan, then go
//! to the master (0.8, as the window's).

use crate::clock::Clock;
use crate::song::{Note, Song, Sound};
use crate::voice::{pan_gains, Voice};

/// The master's level.
const MASTER: f64 = 0.8;
/// How long a render runs past the song's end, so the last notes ring out (studio-audio.ts `RENDER_TAIL`).
pub const RENDER_TAIL: f64 = 2.0;

struct Lane {
    notes: Vec<Note>,
    /// The first note not yet started.
    next: usize,
    sound: Option<Sound>,
    instrument: crate::song::Instrument,
    gains: (f64, f64),
    voices: Vec<Voice>,
    scratch: Vec<f32>,
}

/// Plays a song from a beat, a block at a time.
pub struct Renderer {
    clock: Clock,
    lanes: Vec<Lane>,
    /// The next sample to make, counted from the song's start.
    sample: u64,
}

impl Renderer {
    /// Ready to play `song` from `from_beat`, at `sample_rate`.
    #[must_use]
    pub fn new(song: &Song, sample_rate: u32, from_beat: f64) -> Renderer {
        let clock = Clock::new(sample_rate, song.tempo);
        let start = clock.sample_of_beat(from_beat);
        let lanes = song
            .audible()
            .filter(|t| t.instrument_on != Some(false))
            .map(|t| {
                let notes = Song::notes_of(t);
                // Notes that started before the play position are not caught up: they begin where they begin.
                let next = notes.iter().position(|n| clock.sample_of_beat(n.start) >= start).unwrap_or(notes.len());
                Lane {
                    notes,
                    next,
                    sound: t.sound.or_else(|| Sound::default_for(t.instrument)),
                    instrument: t.instrument,
                    gains: { let (l, r) = pan_gains(t.pan); (l * t.volume, r * t.volume) },
                    voices: Vec::new(),
                    scratch: Vec::new(),
                }
            })
            .collect();
        Renderer { clock, lanes, sample: start }
    }

    /// The beat the next sample is on.
    #[must_use]
    pub fn beat(&self) -> f64 {
        self.clock.beat(self.sample)
    }

    /// Makes the next block: `left` and `right` are overwritten, and must be the same length.
    pub fn render(&mut self, left: &mut [f32], right: &mut [f32]) {
        left.fill(0.0);
        right.fill(0.0);
        let frames = left.len().min(right.len());
        let rate = self.clock.sample_rate;
        let spb = self.clock.seconds_per_beat();
        let (from, to) = (self.sample, self.sample + frames as u64);
        for lane in &mut self.lanes {
            lane.scratch.clear();
            lane.scratch.resize(frames, 0.0);
            // Voices already sounding, for the whole block.
            for voice in &mut lane.voices {
                voice.add_to(&mut lane.scratch, rate);
            }
            // Notes starting in this block, each from its own sample.
            while let Some(note) = lane.notes.get(lane.next) {
                let at = self.clock.sample_of_beat(note.start);
                if at >= to {
                    break;
                }
                lane.next += 1;
                let Some(sound) = lane.sound else { continue };
                let mut voice = Voice::new(lane.instrument, &sound, note.pitch, note.length * spb, note.velocity);
                let offset = usize::try_from(at.saturating_sub(from)).unwrap_or(frames).min(frames);
                voice.add_to(&mut lane.scratch[offset..], rate);
                lane.voices.push(voice);
            }
            lane.voices.retain(|v| !v.done());
            let (gl, gr) = lane.gains;
            for (i, s) in lane.scratch.iter().enumerate() {
                let s = f64::from(*s) * MASTER;
                left[i] += (s * gl) as f32;
                right[i] += (s * gr) as f32;
            }
        }
        self.sample = to;
    }
}

/// The whole song as stereo sound, from its start to its end and its tail.
#[must_use]
pub fn render_song(song: &Song, sample_rate: u32) -> (Vec<f32>, Vec<f32>) {
    let seconds = song.beats() * 60.0 / song.tempo + RENDER_TAIL;
    let frames = (seconds * f64::from(sample_rate)).ceil() as usize;
    let (mut left, mut right) = (vec![0f32; frames], vec![0f32; frames]);
    let mut renderer = Renderer::new(song, sample_rate, 0.0);
    for (l, r) in left.chunks_mut(512).zip(right.chunks_mut(512)) {
        renderer.render(l, r);
    }
    (left, right)
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    fn song(tracks: &str) -> Song {
        Song::parse(&format!(r#"{{"version":2,"tempo":120,"bars":1,"tracks":[{tracks}]}}"#)).unwrap()
    }

    /// The first sample louder than `level`.
    fn onset(samples: &[f32], level: f32) -> Option<usize> {
        samples.iter().position(|s| s.abs() > level)
    }

    #[test]
    fn a_note_starts_on_its_beat_to_the_sample_whatever_the_block_size() {
        let s = song(r#"{"id":"t","instrument":"lead","clips":[{"id":"c","start":0,"length":4,"notes":[{"pitch":72,"start":1.25,"length":0.5,"velocity":1}]}]}"#);
        let whole = render_song(&s, 48_000).0;
        // A beat at 120 is half a second: 1.25 beats is sample 30,000.
        let first = onset(&whole, 1e-6).unwrap();
        assert!((30_000..30_010).contains(&first), "{first}");
        let mut odd = Renderer::new(&s, 48_000, 0.0);
        let (mut l, mut r) = (vec![0f32; whole.len()], vec![0f32; whole.len()]);
        for (a, b) in l.chunks_mut(333).zip(r.chunks_mut(333)) {
            odd.render(a, b);
        }
        assert_eq!(l, whole);
    }

    #[test]
    fn volume_pan_mute_and_solo_are_heard() {
        let track = |id: &str, extra: &str| format!(r#"{{"id":"{id}","instrument":"bass","volume":0.5,{extra}"notes":[{{"pitch":45,"start":0,"length":1,"velocity":1}}]}}"#);
        let peak = |v: &[f32]| v.iter().fold(0f32, |m, s| m.max(s.abs()));
        let centre = render_song(&song(&track("a", "")), 48_000);
        let left = render_song(&song(&track("a", r#""pan":-1,"#)), 48_000);
        assert!(peak(&left.0) > 0.01 && peak(&left.1) < 1e-6);
        assert!((peak(&left.0) - peak(&centre.0)).abs() < 0.01);
        let muted = render_song(&song(&track("a", r#""muted":true,"#)), 48_000);
        assert_eq!(peak(&muted.0), 0.0);
        let solo = render_song(&song(&format!("{},{}", track("a", r#""solo":true,"#), track("b", ""))), 48_000);
        assert!((peak(&solo.0) - peak(&centre.0)).abs() < 1e-6);
    }

    #[test]
    fn playing_from_a_beat_leaves_out_what_came_before() {
        let s = song(r#"{"id":"t","instrument":"piano","notes":[{"pitch":60,"start":0,"length":1,"velocity":1},{"pitch":64,"start":2,"length":1,"velocity":1}]}"#);
        let mut from_two = Renderer::new(&s, 48_000, 2.0);
        assert!((from_two.beat() - 2.0).abs() < 1e-9);
        let (mut l, mut r) = (vec![0f32; 4_800], vec![0f32; 4_800]);
        from_two.render(&mut l, &mut r);
        assert!(onset(&l, 1e-6).is_some_and(|i| i < 10));
    }
}
