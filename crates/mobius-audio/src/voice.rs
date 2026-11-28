//! One note through a track's sound, as studio-audio.ts `shaped` makes it: a sine and a saw mixed by `shape` (two of
//! each when detuned), a sine sub an octave down, through drive, a resonant low-pass the envelope can sweep open, and
//! an attack, decay, sustain and release envelope, with vibrato on every oscillator.

use crate::param::Param;
use crate::song::{Instrument, Sound};
use crate::electric::{ElectricSound, Tines};
use crate::wavetable::{Wavetable, WavetableSound};
use crate::mallet::{MalletSound, Modes};
use crate::string::{Exciter, Strand, StringSound};
use std::f64::consts::{PI, SQRT_2, TAU};

/// How loud a note at full velocity peaks, by instrument (as the window has it).
#[must_use]
pub fn peak_of(instrument: Instrument) -> f64 {
    match instrument {
        Instrument::Pad => 0.18,
        Instrument::Lead => 0.12,
        Instrument::Bass => 0.35,
        Instrument::Piano | Instrument::Drums => 0.3,
        Instrument::String => 0.5,
        Instrument::Mallet => 0.4,
        Instrument::Electric => 0.45,
        Instrument::Wavetable => 0.3,
    }
}

/// A track's modelled instruments' settings, for the one its instrument is.
#[derive(Debug, Clone, Copy, Default)]
pub struct Models<'a> {
    pub string: Option<&'a StringSound>,
    pub mallet: Option<&'a MalletSound>,
    pub electric: Option<&'a ElectricSound>,
    pub wavetable: Option<&'a WavetableSound>,
}

/// How long a held note is made to last: far longer than any key is held, so only letting it go ends it.
pub const HELD_SECONDS: f64 = 3_600.0;

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
    /// How long it takes to die away once let go.
    release: f64,
    /// Let go early (a key lifted): when, and the level it fell from.
    fade: Option<(f64, f64)>,
    /// A modelled string in place of the oscillators: its settings, the string once made (it needs the output's
    /// rate), and when its bow lifts.
    string: Option<StringNote>,
    /// A modelled struck resonator in place of the oscillators: its settings and strike, and its partials once made.
    mallet: Option<MalletNote>,
    /// A modelled electric piano in place of the oscillators: its settings and strike, and its fork once made.
    electric: Option<ElectricNote>,
    /// A wavetable synth's oscillators in place of the plain ones: its settings, and its tables once read.
    wavetable: Option<WavetableNote>,
}

/// A note on the wavetable synth: its settings, and its oscillators once made (at the output's rate).
struct WavetableNote {
    sound: WavetableSound,
    oscs: Option<Box<Wavetable>>,
}

impl std::fmt::Debug for WavetableNote {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("WavetableNote").field("sound", &self.sound).finish_non_exhaustive()
    }
}

impl Clone for WavetableNote {
    fn clone(&self) -> WavetableNote {
        WavetableNote { sound: self.sound, oscs: None }
    }
}

/// A note on a modelled electric piano: its settings and how hard it was struck, and its fork once made (at the
/// output's rate).
#[derive(Debug, Clone)]
struct ElectricNote {
    sound: ElectricSound,
    velocity: f64,
    tines: Option<Box<Tines>>,
}

/// A note on a modelled resonator: what was struck and how hard, and its partials once made (at the output's rate).
#[derive(Debug, Clone)]
struct MalletNote {
    sound: MalletSound,
    velocity: f64,
    modes: Option<Box<Modes>>,
}

/// A note on a modelled string: its settings and how it was played, and the string once made (it needs the output's
/// rate, which only the first block brings).
#[derive(Debug, Clone)]
struct StringNote {
    sound: StringSound,
    velocity: f64,
    seed: u32,
    /// When the bow lifts (the note's end).
    lift: f64,
    strand: Option<Box<Strand>>,
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
            release,
            fade: None,
            string: None,
            mallet: None,
            electric: None,
            wavetable: None,
        }
    }

    /// A note on an instrument: a string plays its `string` settings (or its own); another plays `sound`, or its
    /// instrument's own voices without one.
    #[must_use]
    pub fn for_note(instrument: Instrument, sound: Option<&Sound>, models: Models, pitch: u8, seconds: f64, velocity: f64) -> Voice {
        match (instrument, sound) {
            (Instrument::String, _) => Voice::string(&models.string.copied().unwrap_or_default(), pitch, seconds, velocity),
            (Instrument::Mallet, _) => Voice::mallet(&models.mallet.copied().unwrap_or_default(), pitch, seconds, velocity),
            (Instrument::Electric, _) => Voice::electric(&models.electric.copied().unwrap_or_default(), pitch, seconds, velocity),
            (Instrument::Wavetable, _) => Voice::wavetable(&models.wavetable.copied().unwrap_or_default(), pitch, seconds, velocity),
            (_, Some(sound)) => Voice::new(instrument, sound, pitch, seconds, velocity),
            (_, None) => Voice::legacy(instrument, pitch, seconds, velocity),
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
            Instrument::Piano | Instrument::Drums | Instrument::String | Instrument::Mallet | Instrument::Electric | Instrument::Wavetable => &[osc(Wave::Triangle, 1.0, 0.0), osc(Wave::Sine, 2.0, 0.0)],
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
            release,
            fade: None,
            string: None,
            mallet: None,
            electric: None,
            wavetable: None,
        }
    }

    /// A note of `pitch` on a modelled string (Live 12's Tension), held for `seconds`. A pluck or a hammer
    /// rings by itself for as long as its decay; a bow plays for as long as the note is held.
    #[must_use]
    pub fn string(sound: &StringSound, pitch: u8, seconds: f64, velocity: f64) -> Voice {
        let s = sound.clamped();
        let release = if s.exciter == Exciter::Bow { 0.25 } else { 0.12 };
        let held = seconds.max(0.01);
        let rings = if s.exciter == Exciter::Bow { held } else { held.min(s.decay * 2.0) };
        let peak = peak_of(Instrument::String);
        let gain = Param::new(peak).set(peak, 0.0).target(0.0001, rings, release / 4.0);
        Voice {
            oscs: [SILENT; 5],
            count: 0,
            base: hz(f64::from(pitch)),
            gain,
            cutoff: Param::new(18_000.0),
            q_db: 0.0,
            drive: 0.0,
            vibrato: 0.0,
            rate: 5.0,
            lfo: 0.0,
            filter: LowPass::default(),
            end: rings + release + 0.05,
            time: 0.0,
            release,
            fade: None,
            // The same note sounds the same each time it is rendered.
            string: Some(StringNote { sound: s, velocity: velocity.clamp(0.0, 1.0), seed: 0x9e37_79b9 ^ u32::from(pitch).wrapping_mul(2_654_435_761), lift: held, strand: None }),
            mallet: None,
            electric: None,
            wavetable: None,
        }
    }

    /// A note on a struck resonator (Live 12's Collision): it rings by itself for as long as its decay, and lifting the
    /// key damps it, as a hand on a bar does.
    #[must_use]
    pub fn mallet(sound: &MalletSound, pitch: u8, seconds: f64, velocity: f64) -> Voice {
        let s = sound.clamped();
        let release = 0.08;
        let rings = seconds.max(0.01).min(s.decay * 1.5);
        let peak = peak_of(Instrument::Mallet);
        let gain = Param::new(peak).set(peak, 0.0).target(0.0001, rings, release / 4.0);
        Voice {
            oscs: [SILENT; 5],
            count: 0,
            base: hz(f64::from(pitch)),
            gain,
            cutoff: Param::new(18_000.0),
            q_db: 0.0,
            drive: 0.0,
            vibrato: 0.0,
            rate: 5.0,
            lfo: 0.0,
            filter: LowPass::default(),
            end: rings + release + 0.05,
            time: 0.0,
            release,
            fade: None,
            string: None,
            mallet: Some(MalletNote { sound: s, velocity: velocity.clamp(0.0, 1.0), modes: None }),
            electric: None,
            wavetable: None,
        }
    }

    /// A note on the wavetable synth (Live 12's Wavetable): its oscillators through its own amp envelope and low-pass
    /// filter, the filter opened by the envelope as much as its `filter_env` says.
    #[must_use]
    pub fn wavetable(sound: &WavetableSound, pitch: u8, seconds: f64, velocity: f64) -> Voice {
        let s = sound.clamped();
        crate::wavetable::warm(&s);
        let held = s.attack.max(seconds);
        let peak = velocity.clamp(0.0, 1.0) * peak_of(Instrument::Wavetable);
        let rest = (peak * s.sustain).max(0.0001);
        let gain = Param::new(0.0).set(0.0, 0.0).linear(peak, s.attack).target(rest, s.attack, s.decay / 3.0).target(0.0001, held, s.release / 4.0);
        let open = (s.cutoff * 2f64.powf(s.filter_env * 4.0)).min(18_000.0);
        let mut cutoff = Param::new(s.cutoff).set(s.cutoff, 0.0);
        if s.filter_env > 0.001 {
            cutoff = cutoff.linear(open, s.attack).target(s.cutoff, s.attack, s.decay / 3.0);
        }
        Voice {
            oscs: [SILENT; 5],
            count: 0,
            base: hz(f64::from(pitch)),
            gain,
            cutoff,
            q_db: 0.7 + s.resonance * 14.0,
            drive: 0.0,
            vibrato: 0.0,
            rate: 5.0,
            lfo: 0.0,
            filter: LowPass::default(),
            end: held + s.release + 0.05,
            time: 0.0,
            release: s.release,
            fade: None,
            string: None,
            mallet: None,
            electric: None,
            wavetable: Some(WavetableNote { sound: s, oscs: None }),
        }
    }

    /// A note on an electric piano (Live 12's Electric): it rings by itself while the key is held, and lifting the key
    /// brings the damper down on it.
    #[must_use]
    pub fn electric(sound: &ElectricSound, pitch: u8, seconds: f64, velocity: f64) -> Voice {
        let s = sound.clamped();
        let release = 0.15;
        let rings = seconds.max(0.01).min(s.decay * 2.0);
        let peak = peak_of(Instrument::Electric);
        let gain = Param::new(peak).set(peak, 0.0).target(0.0001, rings, release / 4.0);
        Voice {
            oscs: [SILENT; 5],
            count: 0,
            base: hz(f64::from(pitch)),
            gain,
            cutoff: Param::new(18_000.0),
            q_db: 0.0,
            drive: 0.0,
            vibrato: 0.0,
            rate: 5.0,
            lfo: 0.0,
            filter: LowPass::default(),
            end: rings + release + 0.05,
            time: 0.0,
            release,
            fade: None,
            string: None,
            mallet: None,
            electric: Some(ElectricNote { sound: s, velocity: velocity.clamp(0.0, 1.0), tines: None }),
            wavetable: None,
        }
    }

    /// Lets the note go now (a key lifted): it dies away over its release from wherever its envelope has reached, as
    /// Web Audio's `setTargetAtTime` takes over from the level a ramp is at. A note already let go is left alone.
    pub fn release(&mut self) {
        if let Some(strand) = self.string.as_mut().and_then(|n| n.strand.as_mut()) {
            strand.lift();
        }
        if self.fade.is_none() && self.time < self.end {
            self.fade = Some((self.time, self.gain.at(self.time)));
            self.end = self.end.min(self.time + self.release + 0.05);
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
            let mut x = 0.0;
            if let Some(note) = &mut self.string {
                let (sound, velocity, seed, base) = (note.sound, note.velocity, note.seed, self.base);
                let made = note.strand.get_or_insert_with(|| Box::new(Strand::new(sound, base, rate, velocity, seed)));
                if self.time >= note.lift {
                    made.lift();
                }
                x = made.sample();
            }
            if let Some(note) = &mut self.mallet {
                let (sound, velocity, base) = (note.sound, note.velocity, self.base);
                x = note.modes.get_or_insert_with(|| Box::new(Modes::new(sound, base, rate, velocity))).sample();
            }
            if let Some(note) = &mut self.electric {
                let (sound, velocity, base) = (note.sound, note.velocity, self.base);
                x = note.tines.get_or_insert_with(|| Box::new(Tines::new(sound, base, rate, velocity))).sample();
            }
            if let Some(note) = &mut self.wavetable {
                let (sound, base) = (note.sound, self.base);
                x = note.oscs.get_or_insert_with(|| Box::new(Wavetable::new(sound, base, rate))).sample();
            }
            let wobble = if self.vibrato > 0.0 { self.vibrato * (TAU * self.lfo).sin() } else { 0.0 };
            self.lfo = (self.lfo + self.rate * dt).fract();
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
            let gain = match self.fade {
                Some((from, level)) => level * (-(self.time - from) / (self.release / 4.0)).exp(),
                None => self.gain.at(self.time),
            };
            let y = self.filter.run(x, cutoff, self.q_db, rate) * gain;
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

/// The left and right gains for a pan from -1 to 1: Live's constant-power law, 0 dB on both sides in the middle and
/// +3 dB on one side hard over.
#[must_use]
pub fn pan_gains(pan: f64) -> (f64, f64) {
    if pan.abs() < 1e-9 {
        return (1.0, 1.0);
    }
    // Live's law (Audio Fact Sheet, Panning): constant power with sinusoidal curves, 0 dB in the middle and +3 dB
    // hard to one side, so the level changes smoothly away from the middle.
    let x = (pan.clamp(-1.0, 1.0) + 1.0) / 2.0;
    (SQRT_2 * (x * PI / 2.0).cos(), SQRT_2 * (x * PI / 2.0).sin())
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
    fn a_held_note_sounds_until_it_is_let_go_then_dies_away_over_its_release() {
        let sound = Sound { shape: 0.0, detune: 0.0, sub: 0.0, drive: 0.0, cutoff: 12_000.0, resonance: 0.0, env_amount: 0.0, attack: 0.001, decay: 0.3, sustain: 1.0, release: 0.2, vibrato: 0.0, rate: 5.0 };
        let mut voice = Voice::new(Instrument::Bass, &sound, 69, HELD_SECONDS, 1.0);
        let mut out = vec![0f32; 48_000];
        voice.add_to(&mut out, 48_000.0);
        // A second in, still at full level.
        let top = out[40_000..].iter().fold(0f32, |m, s| m.max(s.abs()));
        assert!((f64::from(top) - 0.35).abs() < 0.02, "{top}");
        voice.release();
        let mut tail = vec![0f32; 24_000];
        voice.add_to(&mut tail, 48_000.0);
        // A release's quarter in it is down by e, and gone by its end.
        let near = tail[2_200..2_600].iter().fold(0f32, |m, s| m.max(s.abs()));
        assert!((f64::from(near) - 0.35 / std::f64::consts::E).abs() < 0.03, "{near}");
        assert!(voice.done() && tail[12_500..].iter().all(|s| *s == 0.0));
    }

    #[test]
    fn pan_follows_lives_law_0_db_in_the_middle_and_3_db_up_hard_over() {
        assert_eq!(pan_gains(0.0), (1.0, 1.0));
        let (l, r) = pan_gains(-1.0);
        assert!((20.0 * l.log10() - 3.0103).abs() < 1e-3 && r.abs() < 1e-12);
        // Constant power everywhere, and no step just off the middle.
        let (l, r) = pan_gains(0.5);
        assert!((l * l + r * r - 2.0).abs() < 1e-12 && r > l);
        let (l, r) = pan_gains(0.001);
        assert!((l - 1.0).abs() < 0.01 && (r - 1.0).abs() < 0.01);
    }
}
