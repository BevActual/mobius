//! The Sampler: a recorded sound played from notes (Live 12 manual, 36.8 "Working with Samples", which describes
//! Simpler). A track with `kind: "sampler"` plays its `sampler` sound, and a drum pad can hold a sound of its own in
//! place of its synthesised drum (25.6.1 "Pad View": a sample dropped on a pad plays from that pad's note).
//!
//! Two of Simpler's modes, as 36.8 describes them:
//! - **Classic**, the default: polyphonic, with an ADSR envelope (the track's `sound` attack, decay, sustain and
//!   release) and an optional loop, so a held note sustains.
//! - **One-Shot**: monophonic; a note plays the whole region whatever its length (Trigger), or fades out when the
//!   note ends (Gate), with a fade in and a fade out.
//!
//! The sound plays at its own pitch on its `root` note (C3, MIDI 60, unless the file says), a semitone higher for each
//! note above, re-pitched like a turntable. Its region is `start` to `end` in seconds of the file; a Classic loop goes
//! round from `loopStart` to the region's end.

use std::sync::Arc;

use serde::Deserialize;

use crate::wav::Sound;

/// A sampler's settings in the song file.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SamplerSound {
    /// Relative to the song's folder, as an audio clip's file is.
    pub file: String,
    /// `"classic"` (the default) or `"oneshot"`.
    #[serde(default)]
    pub mode: Option<String>,
    /// The note that plays the sound at its own pitch.
    #[serde(default = "root")]
    pub root: u8,
    #[serde(default)]
    pub gain_db: f64,
    /// The region played, in seconds of the file; no end is the file's end.
    #[serde(default)]
    pub start: f64,
    #[serde(default)]
    pub end: Option<f64>,
    /// Classic: go round from `loop_start` (seconds of the file) to the region's end while the note is held.
    #[serde(default, rename = "loop")]
    pub looped: bool,
    #[serde(default)]
    pub loop_start: Option<f64>,
    /// One-Shot: fade out when the note ends, rather than playing on.
    #[serde(default)]
    pub gate: bool,
    /// One-Shot: seconds to fade in from the start, and to fade out before the region's end (or after a gated note).
    #[serde(default)]
    pub fade_in: f64,
    #[serde(default)]
    pub fade_out: f64,
}

const fn root() -> u8 {
    60
}

/// An ADSR envelope in seconds and a sustain level from 0 to 1.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Adsr {
    pub attack: f64,
    pub decay: f64,
    pub sustain: f64,
    pub release: f64,
}

impl Default for Adsr {
    /// Simpler's sound as it comes: a click-free start and a short release.
    fn default() -> Adsr {
        Adsr { attack: 0.001, decay: 0.0, sustain: 1.0, release: 0.05 }
    }
}

/// A sampler ready to play: its settings in frames of its sound, and the sound.
#[derive(Clone)]
pub struct Sampler {
    sound: Arc<Sound>,
    oneshot: bool,
    root: f64,
    gain: f64,
    start: f64,
    end: f64,
    /// Where a held Classic note goes back to at the region's end.
    loop_start: Option<f64>,
    gate: bool,
    fade_in: f64,
    fade_out: f64,
    env: Adsr,
}

impl Sampler {
    /// `settings` playing `sound`, with a Classic note shaped by `env`.
    #[must_use]
    pub fn new(settings: &SamplerSound, sound: Arc<Sound>, env: Adsr) -> Sampler {
        let rate = sound.rate;
        let length = sound.left.len() as f64;
        let start = (settings.start.max(0.0) * rate).min(length);
        let end = settings.end.map_or(length, |e| (e * rate).clamp(start, length));
        let oneshot = settings.mode.as_deref() == Some("oneshot");
        let loop_start = (settings.looped && !oneshot).then(|| (settings.loop_start.unwrap_or(settings.start) * rate).clamp(start, end)).filter(|l| end - l > 1.0);
        Sampler {
            sound,
            oneshot,
            root: f64::from(settings.root),
            gain: 10f64.powf(settings.gain_db.clamp(-70.0, 24.0) / 20.0),
            start,
            end,
            loop_start,
            gate: settings.gate,
            fade_in: settings.fade_in.max(0.0),
            fade_out: settings.fade_out.max(0.0),
            env,
        }
    }

    /// The note that plays the sound at its own pitch.
    #[must_use]
    pub fn root(&self) -> u8 {
        self.root as u8
    }

    /// Whether a new note cuts the one before (One-Shot is monophonic).
    #[must_use]
    pub fn monophonic(&self) -> bool {
        self.oneshot
    }

    /// A note of `pitch` (moved by `tune` semitones) at `velocity`, held `seconds`.
    #[must_use]
    pub fn note(&self, pitch: u8, tune: f64, velocity: f64, seconds: f64) -> SampleVoice {
        SampleVoice {
            sampler: self.clone(),
            step: 2f64.powf((f64::from(pitch) + tune - self.root) / 12.0),
            at: self.start,
            time: 0.0,
            held: seconds.max(0.0),
            level: velocity.clamp(0.0, 1.0) * self.gain,
            released: None,
            done: false,
            sides: (1.0, 1.0),
            choked: None,
        }
    }
}

/// A sampler note sounding.
pub struct SampleVoice {
    sampler: Sampler,
    /// Frames of the file a frame at the file's own rate moves on: the note's pitch against the root.
    step: f64,
    /// Where in the file it is.
    at: f64,
    /// Seconds since the note started.
    time: f64,
    held: f64,
    level: f64,
    /// The envelope level when the note ended, and seconds since.
    released: Option<(f64, f64)>,
    done: bool,
    /// Its left and right gains: a drum pad's pan.
    sides: (f32, f32),
    /// When it was cut off by the next note of a monophonic sampler: it fades out over [`CHOKE`] from then.
    choked: Option<f64>,
}

/// Seconds a note cut off by the next fades over, so it does not click.
const CHOKE: f64 = 0.005;

impl SampleVoice {
    #[must_use]
    pub fn done(&self) -> bool {
        self.done
    }

    /// The same note panned, as a drum pad pans its drum (Live's pan law, [`crate::voice::pan_gains`]).
    #[must_use]
    pub fn panned(mut self, pan: f64) -> SampleVoice {
        let (l, r) = crate::voice::pan_gains(pan);
        self.sides = (l as f32, r as f32);
        self
    }

    /// Cuts the note off (quickly faded), as the next note of a monophonic sampler does.
    pub fn choke(&mut self) {
        self.choked.get_or_insert(self.time);
    }

    /// Ends the note now, as a key lifted does.
    pub fn lift(&mut self) {
        self.held = self.held.min(self.time);
    }

    /// Adds the note into `left` and `right` at `rate`.
    pub fn add_to(&mut self, left: &mut [f32], right: &mut [f32], rate: f64) {
        let sound = Arc::clone(&self.sampler.sound);
        let (end, loop_start) = (self.sampler.end, self.sampler.loop_start);
        let (sl, sr) = (&sound.left, &sound.right);
        // File frames each output frame: the note's step, and the file's rate against the output's.
        let advance = self.step * sound.rate / rate;
        for (l, r) in left.iter_mut().zip(right.iter_mut()) {
            if self.done {
                return;
            }
            if self.at >= end - 1.0 {
                match loop_start {
                    Some(from) if self.released.is_none() && self.time < self.held => self.at = from + (self.at - (end - 1.0)),
                    _ => {
                        self.done = true;
                        return;
                    }
                }
            }
            let choke = self.choked.map_or(1.0, |at| 1.0 - (self.time - at) / CHOKE);
            if choke <= 0.0 {
                self.done = true;
                return;
            }
            let env = self.envelope() * choke;
            if env <= 0.0 && self.released.is_some_and(|(_, since)| since > 0.0) {
                self.done = true;
                return;
            }
            let i = self.at as usize;
            let t = (self.at - i as f64) as f32;
            let j = (i + 1).min(sl.len() - 1);
            let g = (env * self.level) as f32;
            *l += (sl[i] + (sl[j] - sl[i]) * t) * g * self.sides.0;
            *r += (sr[i] + (sr[j] - sr[i]) * t) * g * self.sides.1;
            self.at += advance;
            self.time += 1.0 / rate;
            if let Some((_, since)) = self.released.as_mut() {
                *since += 1.0 / rate;
            }
        }
    }

    /// The envelope now: Classic's ADSR, or One-Shot's fades.
    fn envelope(&mut self) -> f64 {
        let s = &self.sampler;
        let rate = s.sound.rate;
        if s.oneshot {
            let fade_in = if s.fade_in > 0.0 { (self.time / s.fade_in).min(1.0) } else { 1.0 };
            let left_in_region = (s.end - self.at) / rate / self.step;
            let fade_out = if s.fade_out > 0.0 { (left_in_region / s.fade_out).min(1.0) } else { 1.0 };
            // Gate: when the note ends it fades over the fade out time (at once with none).
            let gated = if s.gate && self.time >= self.held {
                let since = self.time - self.held;
                if s.fade_out > 0.0 { (1.0 - since / s.fade_out).max(0.0) } else { 0.0 }
            } else {
                1.0
            };
            if gated <= 0.0 {
                self.released = Some((0.0, 1.0));
            }
            return fade_in.min(fade_out) * gated;
        }
        let e = s.env;
        if self.released.is_none() && self.time >= self.held {
            let level = held_level(e, self.held);
            self.released = Some((level, 0.0));
        }
        match self.released {
            Some((from, since)) => {
                if e.release <= 0.0 {
                    0.0
                } else {
                    from * (1.0 - since / e.release).max(0.0)
                }
            }
            None => held_level(e, self.time),
        }
    }
}

/// A Classic note's level `t` seconds in while held: up over the attack, down to the sustain over the decay.
fn held_level(e: Adsr, t: f64) -> f64 {
    if t < e.attack {
        return t / e.attack;
    }
    let t = t - e.attack;
    if t < e.decay {
        1.0 - (1.0 - e.sustain) * t / e.decay
    } else {
        e.sustain
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    fn settings(json: &str) -> SamplerSound {
        serde_json::from_str(json).unwrap()
    }

    /// A second of a 100 Hz sine at 48 kHz.
    fn sine() -> Arc<Sound> {
        let left: Vec<f32> = (0..48_000).map(|n| (std::f64::consts::TAU * 100.0 * f64::from(n) / 48_000.0).sin() as f32).collect();
        Arc::new(Sound { rate: 48_000.0, right: left.clone(), left })
    }

    fn play(v: &mut SampleVoice, frames: usize) -> Vec<f32> {
        let (mut l, mut r) = (vec![0f32; frames], vec![0f32; frames]);
        v.add_to(&mut l, &mut r, 48_000.0);
        l
    }

    fn crossings(s: &[f32]) -> usize {
        s.windows(2).filter(|w| w[0] < 0.0 && w[1] >= 0.0).count()
    }

    #[test]
    fn the_root_note_plays_the_sound_as_it_is_and_an_octave_up_twice_as_fast() {
        let s = Sampler::new(&settings(r#"{"file":"a.wav"}"#), sine(), Adsr::default());
        let at_root = play(&mut s.note(60, 0.0, 1.0, 10.0), 48_000);
        assert!((crossings(&at_root) as i64 - 100).abs() <= 1);
        let up = play(&mut s.note(72, 0.0, 1.0, 10.0), 48_000);
        // Twice the pitch, and over in half the time.
        assert!((crossings(&up[..24_000]) as i64 - 100).abs() <= 1);
        assert!(up[30_000..].iter().all(|x| *x == 0.0));
    }

    #[test]
    fn a_held_classic_note_goes_round_its_loop_and_releases() {
        let s = Sampler::new(&settings(r#"{"file":"a.wav","loop":true,"loopStart":0.5}"#), sine(), Adsr { attack: 0.001, decay: 0.0, sustain: 1.0, release: 0.1 });
        let mut v = s.note(60, 0.0, 1.0, 2.0);
        // Two seconds held from a one-second sound: still sounding at 1.5 s, by the loop.
        let out = play(&mut v, 48_000 * 2);
        assert!(out[72_000..73_000].iter().any(|x| x.abs() > 0.5));
        // Released, it is gone 0.1 s later.
        let tail = play(&mut v, 9_600);
        assert!(tail[..480].iter().any(|x| x.abs() > 0.1));
        assert!(v.done() || tail[9_000..].iter().all(|x| x.abs() < 1e-3));
    }

    #[test]
    fn a_one_shot_plays_its_region_whatever_the_note_length_unless_gated() {
        let s = Sampler::new(&settings(r#"{"file":"a.wav","mode":"oneshot","start":0.25,"end":0.5}"#), sine(), Adsr::default());
        assert!(s.monophonic());
        let mut v = s.note(60, 0.0, 1.0, 0.01);
        let out = play(&mut v, 24_000);
        // A quarter of a second plays, though the note was 10 ms.
        assert!(out[11_000..11_500].iter().any(|x| x.abs() > 0.5));
        assert!(out[12_100..].iter().all(|x| *x == 0.0));
        let gated = Sampler::new(&settings(r#"{"file":"a.wav","mode":"oneshot","gate":true,"fadeOut":0.01}"#), sine(), Adsr::default());
        let out = play(&mut gated.note(60, 0.0, 1.0, 0.05), 24_000);
        assert!(out[(0.07 * 48_000.0) as usize..].iter().all(|x| *x == 0.0));
    }
}
