//! One note through a track's sound, as studio-audio.ts `shaped` makes it: a sine and a saw mixed by `shape` (two of
//! each when detuned), a sine sub an octave down, through drive, a resonant low-pass the envelope can sweep open, and
//! an attack, decay, sustain and release envelope, with vibrato on every oscillator.

use crate::param::Param;
use crate::song::{Instrument, Sound};
use std::f64::consts::{PI, TAU};

/// How loud a note at full velocity peaks, by instrument (as the window has it).
#[must_use]
pub fn peak_of(instrument: Instrument) -> f64 {
    match instrument {
        Instrument::Pad => 0.18,
        Instrument::Lead => 0.12,
        Instrument::Bass => 0.35,
        Instrument::Piano | Instrument::Drums => 0.3,
    }
}

/// The frequency of a MIDI pitch.
#[must_use]
pub fn hz(pitch: f64) -> f64 {
    440.0 * 2f64.powf((pitch - 69.0) / 12.0)
}

/// An oscillator: its phase (0 to 1), how far detuned in cents, a multiple of the note's frequency, and its level.
#[derive(Debug, Clone, Copy)]
struct Osc {
    phase: f64,
    cents: f64,
    ratio: f64,
    wave: Wave,
    level: f64,
}

/// An oscillator's wave, each band-limited as Web Audio's is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Wave {
    Sine,
    Saw,
    Square,
    Triangle,
}

/// A two-pole low-pass, as the Web Audio `BiquadFilterNode` computes it (Q in dB).
#[derive(Debug, Clone, Copy, Default)]
struct LowPass {
    x1: f64,
    x2: f64,
    y1: f64,
    y2: f64,
}

impl LowPass {
    fn run(&mut self, x: f64, cutoff: f64, q_db: f64, rate: f64) -> f64 {
        let w0 = TAU * (cutoff / rate).clamp(1e-5, 0.4999);
        let alpha = w0.sin() / (2.0 * 10f64.powf(q_db / 20.0));
        let cos = w0.cos();
        let (b0, b1, a0, a1, a2) = ((1.0 - cos) / 2.0, 1.0 - cos, 1.0 + alpha, -2.0 * cos, 1.0 - alpha);
        let y = (b0 * x + b1 * self.x1 + b0 * self.x2 - a1 * self.y1 - a2 * self.y2) / a0;
        (self.x2, self.x1, self.y2, self.y1) = (self.x1, x, self.y1, y);
        y
    }
}

/// A sounding note. It is made when the note starts and is done once its release has run out.
#[derive(Debug, Clone)]
pub struct Voice {
    /// At most two detuned pairs of sine and saw, and the sub: held in place, so a note allocates nothing.
    oscs: [Osc; 5],
    count: usize,
    base: f64,
    gain: Param,
    cutoff: Param,
    q_db: f64,
    drive: f64,
    vibrato: f64,
    rate: f64,
    lfo: f64,
    filter: LowPass,
    /// Seconds from the note's start until it is silent.
    end: f64,
    /// Seconds since the note started.
    time: f64,
}

impl Voice {
    /// A note of `pitch`, held for `seconds`, through `sound`.
    #[must_use]
    pub fn new(instrument: Instrument, sound: &Sound, pitch: u8, seconds: f64, velocity: f64) -> Voice {
        let (attack, decay, release) = (sound.attack.max(0.0), sound.decay.max(0.001), sound.release.max(0.001));
        let held = attack.max(seconds);
        let peak = velocity.clamp(0.0, 1.0) * peak_of(instrument);
        let rest = (peak * sound.sustain).max(0.0001);
        let gain = Param::new(0.0).set(0.0, 0.0).linear(peak, attack).target(rest, attack, decay / 3.0).target(0.0001, held, release / 4.0);
        let open = (sound.cutoff * 2f64.powf(sound.env_amount * 4.0)).min(18_000.0);
        let mut cutoff = Param::new(sound.cutoff).set(sound.cutoff, 0.0);
        if sound.env_amount > 0.001 {
            cutoff = cutoff.linear(open, attack).target(sound.cutoff, attack, decay / 3.0);
        }
        let detunes: &[f64] = if sound.detune > 0.0 { &[-0.5, 0.5] } else { &[0.0] };
        let mut oscs = [SILENT; 5];
        let mut count = 0;
        let mut add = |osc: Osc| {
            if let Some(slot) = oscs.get_mut(count) {
                *slot = osc;
                count += 1;
            }
        };
        for share in detunes {
            for (wave, level) in [(Wave::Sine, 1.0 - sound.shape), (Wave::Saw, sound.shape)] {
                if level > 0.001 {
                    add(Osc { phase: 0.0, cents: share * sound.detune, ratio: 1.0, wave, level: level / detunes.len() as f64 });
                }
            }
        }
        if sound.sub > 0.001 {
            add(Osc { phase: 0.0, cents: 0.0, ratio: 0.5, wave: Wave::Sine, level: sound.sub * 0.8 });
        }
        Voice {
            oscs,
            count,
            base: hz(f64::from(pitch)),
            gain,
            cutoff,
            q_db: 0.7 + sound.resonance * 14.0,
            drive: sound.drive,
            vibrato: if sound.vibrato > 0.5 { sound.vibrato } else { 0.0 },
            rate: sound.rate,
            lfo: 0.0,
            filter: LowPass::default(),
            end: held + release + 0.05,
            time: 0.0,
        }
    }

    /// A note of a track with no sound of its own, as studio-audio.ts `tone` plays it: the instrument's own voices
    /// (piano a triangle and a sine an octave up, bass a saw, pad two saws 7 cents apart, lead a square), each at full
    /// level, through a fixed low-pass, with the instrument's own envelope. A piano note dies away as it is held.
    #[must_use]
    pub fn legacy(instrument: Instrument, pitch: u8, seconds: f64, velocity: f64) -> Voice {
        let pad = instrument == Instrument::Pad;
        let attack: f64 = if pad { 0.25 } else { 0.005 };
        let release = match instrument {
            Instrument::Pad => 0.5,
            Instrument::Piano => 0.3,
            _ => 0.08,
        };
        let peak = velocity.clamp(0.0, 1.0) * peak_of(instrument);
        let held = attack.max(seconds);
        let mut gain = Param::new(0.0).set(0.0, 0.0).linear(peak, attack);
        gain = if instrument == Instrument::Piano { gain.exponential((peak * 0.3).max(0.001), (attack + 0.01).max(seconds)) } else { gain.set(peak, held) };
        gain = gain.exponential(0.0001, held + release);
        let osc = |wave: Wave, ratio: f64, cents: f64| Osc { phase: 0.0, cents, ratio, wave, level: 1.0 };
        let mut oscs = [SILENT; 5];
        let list: &[Osc] = match instrument {
            Instrument::Bass => &[osc(Wave::Saw, 1.0, 0.0)],
            Instrument::Pad => &[osc(Wave::Saw, 1.0, -7.0), osc(Wave::Saw, 1.0, 7.0)],
            Instrument::Lead => &[osc(Wave::Square, 1.0, 0.0)],
            Instrument::Piano | Instrument::Drums => &[osc(Wave::Triangle, 1.0, 0.0), osc(Wave::Sine, 2.0, 0.0)],
        };
        oscs[..list.len()].copy_from_slice(list);
        let cutoff = match instrument {
            Instrument::Bass => 700.0,
            Instrument::Pad => 1800.0,
            _ => 5000.0,
        };
        Voice {
            oscs,
            count: list.len(),
            base: hz(f64::from(pitch)),
            gain,
            cutoff: Param::new(cutoff),
            // The filter's Q as the node starts: 1 (dB).
            q_db: 1.0,
            drive: 0.0,
            vibrato: 0.0,
            rate: 5.0,
            lfo: 0.0,
            filter: LowPass::default(),
            end: held + release + 0.05,
            time: 0.0,
        }
    }

    /// Whether it has finished sounding.
    #[must_use]
    pub fn done(&self) -> bool {
        self.time >= self.end
    }

    /// Adds the next `out.len()` samples of the note into `out`.
    pub fn add_to(&mut self, out: &mut [f32], rate: f64) {
        let dt = 1.0 / rate;
        for sample in out.iter_mut() {
            if self.done() {
                return;
            }
            let wobble = if self.vibrato > 0.0 { self.vibrato * (TAU * self.lfo).sin() } else { 0.0 };
            self.lfo = (self.lfo + self.rate * dt).fract();
            let mut x = 0.0;
            for osc in &mut self.oscs[..self.count] {
                let step = self.base * osc.ratio * 2f64.powf((osc.cents + wobble) / 1200.0) * dt;
                x += osc.level * match osc.wave {
                    Wave::Sine => (TAU * osc.phase).sin(),
                    // Web Audio's saw starts at 0 going up, in step with its sine: half a cycle on from one at -1.
                    Wave::Saw => saw((osc.phase + 0.5).fract(), step) * GIBBS,
                    Wave::Square => square(osc.phase, step) * GIBBS,
                    Wave::Triangle => triangle(osc.phase),
                };
                osc.phase = (osc.phase + step).fract();
            }
            if self.drive > 0.001 {
                x = shape(x, self.drive);
            }
            let cutoff = self.cutoff.at(self.time);
            let y = self.filter.run(x, cutoff, self.q_db, rate) * self.gain.at(self.time);
            *sample += y as f32;
            self.time += dt;
        }
    }
}

/// Web Audio scales its saw and square so their band-limited peak (the Gibbs overshoot, 1.179) is 1: they come out
/// this much quieter than a plain one.
const GIBBS: f64 = 1.0 / 1.178_979_744;

const SILENT: Osc = Osc { phase: 0.0, cents: 0.0, ratio: 1.0, wave: Wave::Sine, level: 0.0 };

/// The PolyBLEP correction for a step at phase 0, `step` the phase moved per sample.
fn blep(phase: f64, step: f64) -> f64 {
    if phase < step {
        let t = phase / step;
        t + t - t * t - 1.0
    } else if phase > 1.0 - step {
        let t = (phase - 1.0) / step;
        t * t + t + t + 1.0
    } else {
        0.0
    }
}

/// A band-limited square, +1 for the first half of each cycle (as Web Audio's starts).
fn square(phase: f64, step: f64) -> f64 {
    let y = if phase < 0.5 { 1.0 } else { -1.0 };
    y + blep(phase, step) - blep((phase + 0.5).fract(), step)
}

/// A triangle from 0 up to 1 at a quarter cycle (as Web Audio's starts). Its harmonics fall fast enough not to alias.
fn triangle(phase: f64) -> f64 {
    if phase < 0.25 {
        4.0 * phase
    } else if phase < 0.75 {
        2.0 - 4.0 * phase
    } else {
        4.0 * phase - 4.0
    }
}

/// A band-limited saw from -1 to 1 (PolyBLEP), so high notes do not alias: the Web Audio saw is band-limited too.
fn saw(phase: f64, step: f64) -> f64 {
    let mut y = 2.0 * phase - 1.0;
    if phase < step {
        let t = phase / step;
        y -= t + t - t * t - 1.0;
    } else if phase > 1.0 - step {
        let t = (phase - 1.0) / step;
        y -= t * t + t + t + 1.0;
    }
    y
}

/// The drive curve: tanh, steeper as `drive` goes up, as studio-audio.ts `driveCurve` (its input kept to -1 to 1,
/// as a wave shaper's is).
pub(crate) fn shape(x: f64, drive: f64) -> f64 {
    let k = 1.0 + (drive * 20.0).round() * 1.5;
    (k * x.clamp(-1.0, 1.0)).tanh() / k.tanh()
}

/// The left and right gains for a pan from -1 to 1 (equal power, as `StereoPannerNode` pans a mono input). No pan
/// at all leaves the track at full level on both sides, as the window does without a panner.
#[must_use]
pub fn pan_gains(pan: f64) -> (f64, f64) {
    if pan.abs() < 1e-9 {
        return (1.0, 1.0);
    }
    let x = (pan.clamp(-1.0, 1.0) + 1.0) / 2.0;
    ((x * PI / 2.0).cos(), (x * PI / 2.0).sin())
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    /// The frequency of a run of samples, from how often it crosses zero going up.
    fn frequency(samples: &[f32], rate: f64) -> f64 {
        let ups: Vec<usize> = samples.windows(2).enumerate().filter(|(_, w)| w[0] <= 0.0 && w[1] > 0.0).map(|(i, _)| i).collect();
        match (ups.first(), ups.last()) {
            (Some(a), Some(b)) if b > a => (ups.len() - 1) as f64 * rate / (b - a) as f64,
            _ => 0.0,
        }
    }

    #[test]
    fn a_pure_tone_sounds_at_its_pitch_and_level_then_stops() {
        let sound = Sound { shape: 0.0, detune: 0.0, sub: 0.0, drive: 0.0, cutoff: 12_000.0, resonance: 0.0, env_amount: 0.0, attack: 0.001, decay: 0.3, sustain: 1.0, release: 0.05, vibrato: 0.0, rate: 5.0 };
        let mut voice = Voice::new(Instrument::Bass, &sound, 69, 0.5, 1.0);
        let mut out = vec![0f32; 48_000];
        voice.add_to(&mut out, 48_000.0);
        let held = &out[4_800..19_200];
        assert!((frequency(held, 48_000.0) - 440.0).abs() < 1.0, "{}", frequency(held, 48_000.0));
        let top = held.iter().fold(0f32, |m, s| m.max(s.abs()));
        assert!((f64::from(top) - 0.35).abs() < 0.02, "{top}");
        assert!(voice.done());
        assert!(out[40_000..].iter().all(|s| s.abs() < 1e-4));
    }

    #[test]
    fn the_saw_is_brighter_and_the_filter_takes_its_top_off() {
        let base = Sound::default_for(Instrument::Bass).unwrap();
        let energy = |cutoff: f64| {
            let sound = Sound { cutoff, sustain: 1.0, ..base };
            let mut voice = Voice::new(Instrument::Bass, &sound, 45, 0.4, 1.0);
            let mut out = vec![0f32; 19_200];
            voice.add_to(&mut out, 48_000.0);
            // High-frequency energy: the change from sample to sample.
            out.windows(2).map(|w| f64::from(w[1] - w[0]).powi(2)).sum::<f64>()
        };
        assert!(energy(6_000.0) > energy(300.0) * 4.0);
    }

    #[test]
    fn pan_is_equal_power_and_centre_is_untouched() {
        assert_eq!(pan_gains(0.0), (1.0, 1.0));
        let (l, r) = pan_gains(-1.0);
        assert!((l - 1.0).abs() < 1e-12 && r.abs() < 1e-12);
        let (l, r) = pan_gains(0.5);
        assert!((l * l + r * r - 1.0).abs() < 1e-12 && r > l);
    }
}
