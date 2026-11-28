//! A wavetable synth, after Live 12's Wavetable (ableton.com/en/packs/wavetable: "two main oscillators (plus a third
//! sub oscillator)", each with "a control to sweep through the position in the wavetable", a sub that "offers a sine
//! wave – with selectable octave", unison voices, and frequency modulation among the oscillator effects). Each table is
//! a run of single-cycle frames; a note reads between the two frames nearest its position, and the position moves with
//! an envelope and an LFO. Frames are kept band-limited at each octave, so high notes do not alias.

use serde::Deserialize;
use std::f64::consts::{PI, TAU};
use std::sync::OnceLock;

/// The tables Music comes with: each sweeps from one sound to another as its position goes from 0 to 1.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Table {
    /// Sine, then triangle, saw and square.
    #[default]
    Basic,
    /// A square narrowing to a thin pulse.
    Pulse,
    /// A saw hard-synced higher and higher.
    Sync,
    /// A sine folded over on itself more and more.
    Fold,
    /// Harmonics added one by one, the organ opening up.
    Harmonics,
    /// A vowel-like peak moving up through the harmonics.
    Formant,
}

pub const TABLES: [Table; 6] = [Table::Basic, Table::Pulse, Table::Sync, Table::Fold, Table::Harmonics, Table::Formant];

/// A wavetable track's settings, as the song file has them (a track's `wavetable`).
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct WavetableSound {
    pub table1: Table,
    /// 0 to 1: where in its table oscillator 1 reads.
    pub position1: f64,
    pub level1: f64,
    /// Semitones, -24 to 24.
    pub transpose1: f64,
    /// Cents, -50 to 50.
    pub detune1: f64,
    pub table2: Table,
    pub position2: f64,
    /// 0 leaves oscillator 2 off.
    pub level2: f64,
    pub transpose2: f64,
    pub detune2: f64,
    /// The sub oscillator's level, a sine an octave (or two) down.
    pub sub: f64,
    /// -1 or -2 octaves.
    pub sub_octave: i32,
    /// Unison voices per oscillator, 1 to 8, spread `spread` (0 to 1, up to 25 cents either way).
    pub unison: u32,
    pub spread: f64,
    /// 0 to 1: oscillator 2's main oscillator modulated by a sine at its own pitch (the FM oscillator effect), on both.
    pub fm: f64,
    /// The low-pass filter: cutoff in Hz, resonance 0 to 1, and how far the amp envelope opens it (0 to 1, four octaves).
    pub cutoff: f64,
    pub resonance: f64,
    pub filter_env: f64,
    /// The amp envelope, in seconds and 0 to 1.
    pub attack: f64,
    pub decay: f64,
    pub sustain: f64,
    pub release: f64,
    /// The position LFO: its rate in Hz and how far it moves both positions (0 to 1).
    pub lfo_rate: f64,
    pub lfo_position: f64,
    /// The position envelope: how far it moves both positions at the start (-1 to 1), back over `mod_decay` seconds.
    pub env_position: f64,
    pub mod_decay: f64,
}

impl Default for WavetableSound {
    fn default() -> WavetableSound {
        WavetableSound {
            table1: Table::Basic,
            position1: 0.5,
            level1: 1.0,
            transpose1: 0.0,
            detune1: 0.0,
            table2: Table::Harmonics,
            position2: 0.3,
            level2: 0.0,
            transpose2: 12.0,
            detune2: 0.0,
            sub: 0.0,
            sub_octave: -1,
            unison: 1,
            spread: 0.3,
            fm: 0.0,
            cutoff: 12_000.0,
            resonance: 0.1,
            filter_env: 0.0,
            attack: 0.005,
            decay: 0.4,
            sustain: 0.8,
            release: 0.25,
            lfo_rate: 0.5,
            lfo_position: 0.0,
            env_position: 0.0,
            mod_decay: 0.6,
        }
    }
}

impl WavetableSound {
    /// The settings kept to their ranges.
    #[must_use]
    pub fn clamped(self) -> WavetableSound {
        let fit = |v: f64, lo: f64, hi: f64, or: f64| if v.is_finite() { v.clamp(lo, hi) } else { or };
        let d = WavetableSound::default();
        WavetableSound {
            table1: self.table1,
            position1: fit(self.position1, 0.0, 1.0, d.position1),
            level1: fit(self.level1, 0.0, 1.0, d.level1),
            transpose1: fit(self.transpose1, -24.0, 24.0, 0.0).round(),
            detune1: fit(self.detune1, -50.0, 50.0, 0.0),
            table2: self.table2,
            position2: fit(self.position2, 0.0, 1.0, d.position2),
            level2: fit(self.level2, 0.0, 1.0, 0.0),
            transpose2: fit(self.transpose2, -24.0, 24.0, d.transpose2).round(),
            detune2: fit(self.detune2, -50.0, 50.0, 0.0),
            sub: fit(self.sub, 0.0, 1.0, 0.0),
            sub_octave: if self.sub_octave <= -2 { -2 } else { -1 },
            unison: self.unison.clamp(1, 8),
            spread: fit(self.spread, 0.0, 1.0, d.spread),
            fm: fit(self.fm, 0.0, 1.0, 0.0),
            cutoff: fit(self.cutoff, 30.0, 18_000.0, d.cutoff),
            resonance: fit(self.resonance, 0.0, 1.0, d.resonance),
            filter_env: fit(self.filter_env, 0.0, 1.0, 0.0),
            attack: fit(self.attack, 0.0, 10.0, d.attack),
            decay: fit(self.decay, 0.001, 10.0, d.decay),
            sustain: fit(self.sustain, 0.0, 1.0, d.sustain),
            release: fit(self.release, 0.001, 10.0, d.release),
            lfo_rate: fit(self.lfo_rate, 0.01, 20.0, d.lfo_rate),
            lfo_position: fit(self.lfo_position, 0.0, 1.0, 0.0),
            env_position: fit(self.env_position, -1.0, 1.0, 0.0),
            mod_decay: fit(self.mod_decay, 0.01, 10.0, d.mod_decay),
        }
    }
}

/// Frames in a table, samples in a frame, and the most harmonics a frame keeps.
const FRAMES: usize = 16;
const LEN: usize = 2048;
const HARMONICS: usize = 256;
/// Each frame at 9 widths of band: 256 harmonics, 128, … 1.
const LEVELS: usize = 9;

/// A table's frames, each at each band, as one run of samples: `[frame][level][sample]`.
pub struct Frames {
    data: Vec<f32>,
}

impl Frames {
    fn at(&self, frame: usize, level: usize) -> &[f32] {
        let from = (frame * LEVELS + level) * LEN;
        &self.data[from..from + LEN]
    }
}

/// The wave of `table` at position `p`, at phase `x` (0 to 1): the shape its frames are made from.
fn shape(table: Table, x: f64, p: f64) -> f64 {
    let sine = (TAU * x).sin();
    match table {
        Table::Basic => {
            let tri = if x < 0.25 { 4.0 * x } else if x < 0.75 { 2.0 - 4.0 * x } else { 4.0 * x - 4.0 };
            let saw = if x < 0.5 { 2.0 * x } else { 2.0 * x - 2.0 };
            let square = if x < 0.5 { 1.0 } else { -1.0 };
            let s = p * 3.0;
            let (a, b, t) = if s < 1.0 { (sine, tri, s) } else if s < 2.0 { (tri, saw, s - 1.0) } else { (saw, square, s - 2.0) };
            a + (b - a) * t
        }
        Table::Pulse => {
            if x < 0.5 - 0.45 * p { 1.0 } else { -1.0 }
        }
        Table::Sync => {
            let r = 1.0 + 7.0 * p;
            2.0 * (x * r).fract() - 1.0
        }
        Table::Fold => (2.0 / PI) * ((PI / 2.0) * sine * (1.0 + 5.0 * p)).sin().asin(),
        Table::Harmonics => {
            let top = 1.0 + 23.0 * p;
            (1..=24).map(f64::from).filter(|n| *n <= top.ceil()).map(|n| (TAU * n * x).sin() / n.powf(0.7) * (top - n + 1.0).clamp(0.0, 1.0)).sum()
        }
        Table::Formant => {
            let c = 2.0 + 14.0 * p;
            (1..=40).map(f64::from).map(|n| (TAU * n * x).sin() * ((-((n - c) / 1.5).powi(2)).exp() + 0.3 / n)).sum()
        }
    }
}

/// Builds a table's frames: each frame's harmonics from its shape, then the frame again with only the harmonics each
/// band keeps, scaled so the full frame peaks at 1.
fn build(table: Table) -> Frames {
    let sin: Vec<f64> = (0..LEN).map(|i| (TAU * i as f64 / LEN as f64).sin()).collect();
    let cos = |k: usize| sin[(k + LEN / 4) % LEN];
    let mut data = vec![0.0f32; FRAMES * LEVELS * LEN];
    let mut wave = vec![0.0f64; LEN];
    let mut out = vec![0.0f64; LEN];
    for frame in 0..FRAMES {
        let p = frame as f64 / (FRAMES - 1) as f64;
        for (i, w) in wave.iter_mut().enumerate() {
            *w = shape(table, i as f64 / LEN as f64, p);
        }
        // Its harmonics (a sine and a cosine part each), leaving out any offset.
        let parts: Vec<(f64, f64)> = (1..=HARMONICS)
            .map(|n| {
                let (mut a, mut b) = (0.0, 0.0);
                for (i, w) in wave.iter().enumerate() {
                    let k = (n * i) % LEN;
                    a += w * sin[k];
                    b += w * cos(k);
                }
                (a * 2.0 / LEN as f64, b * 2.0 / LEN as f64)
            })
            .collect();
        let mut scale = 1.0;
        for level in 0..LEVELS {
            let keep = HARMONICS >> level;
            out.iter_mut().for_each(|o| *o = 0.0);
            for (n, (a, b)) in parts.iter().take(keep).enumerate() {
                let n = n + 1;
                for (i, o) in out.iter_mut().enumerate() {
                    let k = (n * i) % LEN;
                    *o += a * sin[k] + b * cos(k);
                }
            }
            if level == 0 {
                let peak = out.iter().fold(0.0f64, |m, v| m.max(v.abs()));
                scale = if peak > 1e-9 { 1.0 / peak } else { 1.0 };
            }
            let from = (frame * LEVELS + level) * LEN;
            for (d, o) in data[from..from + LEN].iter_mut().zip(&out) {
                *d = (o * scale) as f32;
            }
        }
    }
    Frames { data }
}

/// A table's frames, made the first time they are asked for and kept.
pub fn frames(table: Table) -> &'static Frames {
    static MADE: [OnceLock<Frames>; 6] = [OnceLock::new(), OnceLock::new(), OnceLock::new(), OnceLock::new(), OnceLock::new(), OnceLock::new()];
    let i = TABLES.iter().position(|t| *t == table).unwrap_or(0);
    MADE[i].get_or_init(|| build(table))
}

/// Makes a sound's tables ahead of its notes, off the audio thread.
pub fn warm(sound: &WavetableSound) {
    frames(sound.table1);
    if sound.level2 > 0.0 {
        frames(sound.table2);
    }
}

/// The table's wave at `phase` and `position` (both 0 to 1), for a note at `hz` played at `rate`: from the band that
/// keeps every harmonic under the Nyquist, between the two nearest frames.
fn read(frames: &Frames, phase: f64, position: f64, hz: f64, rate: f64) -> f64 {
    let allowed = (0.45 * rate / hz.max(1.0)).floor() as usize;
    let level = (0..LEVELS).find(|l| HARMONICS >> l <= allowed).unwrap_or(LEVELS - 1);
    let fp = position.clamp(0.0, 1.0) * (FRAMES - 1) as f64;
    let f0 = (fp.floor() as usize).min(FRAMES - 1);
    let f1 = (f0 + 1).min(FRAMES - 1);
    let ft = fp - f0 as f64;
    let x = phase * LEN as f64;
    let i0 = (x.floor() as usize) % LEN;
    let i1 = (i0 + 1) % LEN;
    let t = x - x.floor();
    let one = |frame: &[f32]| f64::from(frame[i0]) + (f64::from(frame[i1]) - f64::from(frame[i0])) * t;
    let (a, b) = (one(frames.at(f0, level)), one(frames.at(f1, level)));
    a + (b - a) * ft
}

/// One oscillator's unison voices: each its own phase and pitch, a little off the note.
#[derive(Debug, Clone, Copy)]
struct Unison {
    phase: f64,
    cents: f64,
}

/// A note on the wavetable synth: its oscillators' phases, the position envelope and LFO; the amp envelope and filter
/// are the voice's own.
pub struct Wavetable {
    sound: WavetableSound,
    base: f64,
    rate: f64,
    one: [Unison; 8],
    two: [Unison; 8],
    fm1: f64,
    fm2: f64,
    sub: f64,
    lfo: f64,
    time: f64,
}

impl Wavetable {
    #[must_use]
    pub fn new(sound: WavetableSound, base: f64, rate: f64) -> Wavetable {
        let n = sound.unison as usize;
        let voices = |seed: f64| {
            let mut v = [Unison { phase: 0.0, cents: 0.0 }; 8];
            for (k, u) in v.iter_mut().enumerate().take(n) {
                let share = if n == 1 { 0.0 } else { k as f64 / (n - 1) as f64 * 2.0 - 1.0 };
                // Spread round the cycle so the voices do not start in step (the same each time).
                *u = Unison { phase: if n == 1 { 0.0 } else { (seed + k as f64 * 0.618_034).fract() }, cents: share * sound.spread * 25.0 };
            }
            v
        };
        Wavetable { sound, base, rate, one: voices(0.0), two: voices(0.37), fm1: 0.0, fm2: 0.0, sub: 0.0, lfo: 0.0, time: 0.0 }
    }

    /// The next sample, about -1 to 1.
    pub fn sample(&mut self) -> f64 {
        let s = self.sound;
        let dt = 1.0 / self.rate;
        let env = if s.env_position == 0.0 { 0.0 } else { s.env_position * (-self.time / (s.mod_decay / 3.0)).exp() };
        let lfo = if s.lfo_position > 0.0 { s.lfo_position * 0.5 * (TAU * self.lfo).sin() } else { 0.0 };
        let n = s.unison as usize;
        let mut x = 0.0;
        for (which, level, table, position, transpose, detune) in
            [(0, s.level1, s.table1, s.position1, s.transpose1, s.detune1), (1, s.level2, s.table2, s.position2, s.transpose2, s.detune2)]
        {
            if level <= 0.0 {
                continue;
            }
            let frames = frames(table);
            let position = (position + env + lfo).clamp(0.0, 1.0);
            let hz = self.base * 2f64.powf((transpose * 100.0 + detune) / 1200.0);
            let fm = if which == 0 { &mut self.fm1 } else { &mut self.fm2 };
            let push = if s.fm > 0.0 { s.fm * 0.25 * (TAU * *fm).sin() } else { 0.0 };
            *fm = (*fm + hz * dt).fract();
            let voices = if which == 0 { &mut self.one } else { &mut self.two };
            let mut sum = 0.0;
            for u in voices.iter_mut().take(n) {
                let f = hz * 2f64.powf(u.cents / 1200.0);
                sum += read(frames, (u.phase + push).rem_euclid(1.0), position, f, self.rate);
                u.phase = (u.phase + f * dt).fract();
            }
            x += level * sum / (n as f64).sqrt();
        }
        if s.sub > 0.0 {
            x += s.sub * (TAU * self.sub).sin();
            self.sub = (self.sub + self.base * 2f64.powi(s.sub_octave) * dt).fract();
        }
        self.lfo = (self.lfo + s.lfo_rate * dt).fract();
        self.time += dt;
        x * 0.5
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rms(x: &[f64]) -> f64 {
        (x.iter().map(|v| v * v).sum::<f64>() / x.len() as f64).sqrt()
    }

    #[test]
    fn frames_sweep_from_one_sound_to_another_and_keep_to_their_band() {
        let t = frames(Table::Basic);
        // The first frame is a sine: its narrowest band (one harmonic) is the same as its widest.
        let (wide, narrow) = (t.at(0, 0), t.at(0, LEVELS - 1));
        assert!(wide.iter().zip(narrow).all(|(a, b)| (a - b).abs() < 0.02));
        // The last is a square: far from a sine, and peaking at 1.
        let last = t.at(FRAMES - 1, 0);
        assert!((last.iter().fold(0.0f32, |m, v| m.max(v.abs())) - 1.0).abs() < 1e-3);
        assert!(last.iter().zip(narrow).map(|(a, b)| (a - b).abs()).fold(0.0f32, f32::max) > 0.2);
        for table in TABLES {
            assert!(frames(table).data.iter().all(|v| v.is_finite() && v.abs() <= 1.5), "{table:?}");
        }
    }

    #[test]
    fn a_note_plays_at_its_pitch_and_high_notes_do_not_alias() {
        let rate = 48_000.0;
        let mut note = Wavetable::new(WavetableSound { position1: 1.0, ..WavetableSound::default() }.clamped(), 440.0, rate);
        let x: Vec<f64> = (0..9_600).map(|_| note.sample()).collect();
        assert!(rms(&x) > 0.1);
        // 440 Hz: one period is 109.09 samples.
        let like = |shift: usize| x[2_000..6_000].iter().zip(&x[2_000 + shift..6_000 + shift]).map(|(a, b)| a * b).sum::<f64>() / (rms(&x[2_000..6_000]).powi(2) * 4_000.0);
        assert!(like(109) > 0.9 && like(55) < 0.0, "{} {}", like(109), like(55));
        // A square at 7 kHz keeps only its fundamental: it is near a sine, with no folded-back partials.
        let mut high = Wavetable::new(WavetableSound { position1: 1.0, ..WavetableSound::default() }.clamped(), 7_040.0, rate);
        let y: Vec<f64> = (0..4_800).map(|_| high.sample()).collect();
        let peak = y.iter().fold(0.0f64, |m, v| m.max(v.abs()));
        assert!((peak / rms(&y) - std::f64::consts::SQRT_2).abs() < 0.1, "{}", peak / rms(&y));
    }

    #[test]
    fn unison_fm_sub_and_the_position_envelope_change_the_sound() {
        let rate = 48_000.0;
        let run = |s: WavetableSound| -> Vec<f64> {
            let mut n = Wavetable::new(s.clamped(), 220.0, rate);
            (0..4_800).map(|_| n.sample()).collect()
        };
        let plain = run(WavetableSound::default());
        for other in [
            WavetableSound { unison: 4, spread: 1.0, ..WavetableSound::default() },
            WavetableSound { fm: 1.0, ..WavetableSound::default() },
            WavetableSound { sub: 1.0, ..WavetableSound::default() },
            WavetableSound { env_position: -1.0, ..WavetableSound::default() },
            WavetableSound { level2: 1.0, ..WavetableSound::default() },
        ] {
            let x = run(other);
            assert!(x.iter().all(|v| v.is_finite() && v.abs() < 4.0));
            assert!(x.iter().zip(&plain).map(|(a, b)| (a - b).abs()).sum::<f64>() > 10.0, "{other:?}");
        }
        // The same note sounds the same each time.
        assert_eq!(run(WavetableSound { unison: 5, ..WavetableSound::default() }), run(WavetableSound { unison: 5, ..WavetableSound::default() }));
    }
}
