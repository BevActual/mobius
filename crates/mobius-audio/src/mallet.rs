//! Struck things, modelled, after Live 12's Collision (manual, "Live Instrument Reference: Collision"): a mallet hits a
//! resonator, and the resonator rings at its own partials, each a mode that dies away by itself (modal synthesis).
//! Each kind of resonator has its partials where that body has them: a tuned marimba bar, a free beam, a drum's
//! membrane, a square plate, a closed pipe, a bell. A harder mallet rings the high partials more; a softer material
//! loses them sooner; where it is struck takes out the partials with a node there.

use serde::Deserialize;

/// What is struck.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Resonator {
    #[default]
    Marimba,
    Beam,
    Membrane,
    Plate,
    Pipe,
    Bell,
}

impl Resonator {
    /// Its partials, as multiples of the note's frequency.
    #[must_use]
    pub fn ratios(self) -> &'static [f64] {
        match self {
            // A marimba bar is cut so its second and third partials fall near two octaves and a third above.
            Resonator::Marimba => &[1.0, 3.99, 10.65],
            // A free bar (a xylophone left untuned): Euler-Bernoulli's free-free modes.
            Resonator::Beam => &[1.0, 2.756, 5.404, 8.933, 13.344, 18.64],
            // An ideal circular membrane: the Bessel-function zeros over the first.
            Resonator::Membrane => &[1.0, 1.594, 2.136, 2.296, 2.653, 2.918, 3.156, 3.501],
            // A simply supported square plate: (m² + n²) / 2.
            Resonator::Plate => &[1.0, 2.5, 4.0, 5.0, 6.5, 8.5, 9.0, 10.0],
            // A pipe closed at one end: the odd harmonics.
            Resonator::Pipe => &[1.0, 3.0, 5.0, 7.0, 9.0, 11.0],
            // A bell: hum, prime, tierce, quint and nominal, and above.
            Resonator::Bell => &[0.5, 1.0, 1.2, 1.5, 2.0, 2.5, 2.67, 3.0],
        }
    }
}

/// A mallet track's settings, as the song file has them (a track's `mallet`).
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct MalletSound {
    pub resonator: Resonator,
    /// Seconds for the lowest partial to die away by 60 dB.
    pub decay: f64,
    /// 0 metal (every partial rings as long) to 1 wood (the high ones die far sooner).
    pub material: f64,
    /// 0 a soft mallet to 1 a hard one: how much of the high partials the strike sets ringing.
    pub hardness: f64,
    /// Where it is struck, 0 at the edge to 0.5 in the middle.
    pub position: f64,
}

impl Default for MalletSound {
    fn default() -> MalletSound {
        MalletSound { resonator: Resonator::Marimba, decay: 1.2, material: 0.6, hardness: 0.5, position: 0.2 }
    }
}

impl MalletSound {
    /// The settings kept to their ranges.
    #[must_use]
    pub fn clamped(self) -> MalletSound {
        let fit = |v: f64, lo: f64, hi: f64, or: f64| if v.is_finite() { v.clamp(lo, hi) } else { or };
        MalletSound {
            resonator: self.resonator,
            decay: fit(self.decay, 0.05, 20.0, 1.2),
            material: fit(self.material, 0.0, 1.0, 0.6),
            hardness: fit(self.hardness, 0.0, 1.0, 0.5),
            position: fit(self.position, 0.02, 0.5, 0.2),
        }
    }
}

/// The most partials a resonator has.
const MAX_MODES: usize = 8;

/// One partial ringing: a two-pole resonator, set going by the strike.
#[derive(Debug, Clone, Copy, Default)]
struct Mode {
    a1: f64,
    a2: f64,
    y1: f64,
    y2: f64,
}

/// A struck resonator sounding: its partials. Made on the note's first block, at the output's rate.
#[derive(Debug, Clone)]
pub struct Modes {
    modes: [Mode; MAX_MODES],
    count: usize,
}

impl Modes {
    /// The resonator struck at `velocity` (0 to 1), its first partial at `hz`, at `rate` samples a second.
    #[must_use]
    pub fn new(sound: MalletSound, hz: f64, rate: f64, velocity: f64) -> Modes {
        let s = sound.clamped();
        let level = velocity.clamp(0.0, 1.0);
        // The mallet: softer cuts the strike's top lower, and a harder hit is brighter, as on a real bar.
        let corner = hz * (1.5 + 14.0 * s.hardness * s.hardness) * (0.6 + 0.4 * level);
        let mut modes = [Mode::default(); MAX_MODES];
        let mut count = 0;
        for (k, ratio) in s.resonator.ratios().iter().enumerate() {
            let f = hz * ratio;
            if f >= rate * 0.45 || count >= MAX_MODES {
                break;
            }
            // Wood loses its high partials far sooner than metal does.
            let t60 = s.decay / (1.0 + s.material * 6.0 * (ratio - 1.0).max(0.0));
            let r = 10f64.powf(-3.0 / (rate * t60.max(0.005)));
            let w = std::f64::consts::TAU * f / rate;
            // A node where it is struck: the partial is barely set going there.
            let node = (std::f64::consts::PI * (k as f64 + 1.0) * s.position).sin().abs().max(0.05);
            let strike = 1.0 / (1.0 + (f / corner).powi(2));
            let amp = level * node * strike / (k as f64 + 1.0).sqrt();
            // Starts as a sine at its peak a quarter cycle on: y[0] = 0, y[1] = amp·r·sin(w).
            modes[count] = Mode { a1: 2.0 * r * w.cos(), a2: -r * r, y1: amp * r * w.sin(), y2: 0.0 };
            count += 1;
        }
        Modes { modes, count }
    }

    /// The resonator's next sample.
    pub fn sample(&mut self) -> f64 {
        let mut out = 0.0;
        for m in &mut self.modes[..self.count] {
            let y = m.a1 * m.y1 + m.a2 * m.y2;
            m.y2 = m.y1;
            m.y1 = y;
            out += y;
        }
        out
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    fn render(sound: MalletSound, hz: f64, seconds: f64) -> Vec<f64> {
        let mut m = Modes::new(sound, hz, 48_000.0, 0.9);
        (0..(48_000.0 * seconds) as usize).map(|_| m.sample()).collect()
    }
    fn rms(x: &[f64]) -> f64 {
        (x.iter().map(|v| v * v).sum::<f64>() / x.len() as f64).sqrt()
    }
    /// How much of `x` is at `hz` (one bin of a Fourier transform, over a whole number of its cycles).
    fn at(x: &[f64], hz: f64) -> f64 {
        let (mut re, mut im) = (0.0, 0.0);
        for (n, v) in x.iter().enumerate() {
            let p = std::f64::consts::TAU * hz * n as f64 / 48_000.0;
            re += v * p.cos();
            im += v * p.sin();
        }
        (re * re + im * im).sqrt() / x.len() as f64
    }

    #[test]
    fn a_marimba_bar_rings_at_its_note_and_its_tuned_partial() {
        let x = render(MalletSound { hardness: 1.0, material: 0.0, ..MalletSound::default() }, 220.0, 0.5);
        let w = &x[0..12_000];
        assert!(at(w, 220.0) > 10.0 * at(w, 300.0), "{} {}", at(w, 220.0), at(w, 300.0));
        assert!(at(w, 220.0 * 3.99) > 10.0 * at(w, 700.0));
    }

    #[test]
    fn wood_loses_its_high_partials_sooner_and_a_soft_mallet_hits_them_less() {
        let tail = |s: MalletSound| { let x = render(s, 220.0, 0.6); at(&x[19_200..28_800], 220.0 * 3.99) / at(&x[19_200..28_800], 220.0) };
        let metal = tail(MalletSound { material: 0.0, hardness: 1.0, ..MalletSound::default() });
        let wood = tail(MalletSound { material: 1.0, hardness: 1.0, ..MalletSound::default() });
        assert!(wood < metal * 0.2, "{wood} {metal}");
        let start = |h: f64| { let x = render(MalletSound { hardness: h, ..MalletSound::default() }, 220.0, 0.1); at(&x[..4_800], 220.0 * 3.99) / at(&x[..4_800], 220.0) };
        assert!(start(0.0) < start(1.0) * 0.5);
    }

    #[test]
    fn it_dies_away_by_its_decay_and_never_runs_away() {
        let short = render(MalletSound { decay: 0.2, ..MalletSound::default() }, 110.0, 1.0);
        let long = render(MalletSound { decay: 4.0, ..MalletSound::default() }, 110.0, 1.0);
        assert!(rms(&short[38_400..48_000]) < rms(&long[38_400..48_000]) * 0.01);
        for r in [Resonator::Marimba, Resonator::Beam, Resonator::Membrane, Resonator::Plate, Resonator::Pipe, Resonator::Bell] {
            let x = render(MalletSound { resonator: r, decay: 20.0, material: 0.0, hardness: 1.0, ..MalletSound::default() }, 2_000.0, 0.5);
            assert!(x.iter().all(|v| v.is_finite() && v.abs() < 4.0), "{r:?}");
            assert!(rms(&x) > 0.01, "{r:?}");
        }
    }

    #[test]
    fn a_partial_above_the_top_is_left_out_and_settings_are_kept_in_range() {
        let m = Modes::new(MalletSound { resonator: Resonator::Pipe, ..MalletSound::default() }, 4_000.0, 48_000.0, 1.0);
        // 4, 12 and 20 kHz are under 0.45 of the rate; 28 kHz is not.
        assert_eq!(m.count, 3);
        let s = MalletSound { resonator: Resonator::Bell, decay: f64::INFINITY, material: -1.0, hardness: 3.0, position: 0.9 }.clamped();
        assert_eq!((s.decay, s.material, s.hardness, s.position), (1.2, 0.0, 1.0, 0.5));
        let parsed: MalletSound = serde_json::from_str(r#"{"resonator":"membrane","decay":0.5}"#).unwrap();
        assert_eq!((parsed.resonator, parsed.decay, parsed.material), (Resonator::Membrane, 0.5, 0.6));
    }
}
