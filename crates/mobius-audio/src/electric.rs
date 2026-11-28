//! An electric piano, modelled after Live 12's Electric (manual, "Live Instrument Reference: Electric"): a hammer
//! strikes a fork, and a pickup turns its swing into sound. The fork is a tine (or a reed) that rings at its own bent-bar
//! partials, the high ones a bright bell that dies quickly, and a tone bar that sustains the note. The pickup is not
//! linear: the closer the fork swings to it, the more it adds of its own harmonics, the bark of a hard-played note. A
//! tine's magnetic pickup is lopsided and adds even harmonics; a reed's electrostatic one adds odd ones.

use serde::Deserialize;

/// Which piano: a tine with a magnetic pickup, or a reed with an electrostatic one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Fork {
    #[default]
    Tine,
    Reed,
}

/// An electric piano track's settings, as the song file has them (a track's `electric`).
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ElectricSound {
    pub fork: Fork,
    /// Seconds for a low note to die away by 60 dB (higher notes die sooner, as on a real piano).
    pub decay: f64,
    /// 0 a soft hammer tip to 1 a hard one: how much of the bell and the strike's click it sets going.
    pub hardness: f64,
    /// 0 to 1: how loud the fork's high partials, the bell of the attack, ring.
    pub bell: f64,
    /// 0 to 1: how close the pickup sits, so how much it barks when played hard.
    pub drive: f64,
}

impl Default for ElectricSound {
    fn default() -> ElectricSound {
        ElectricSound { fork: Fork::Tine, decay: 4.0, hardness: 0.5, bell: 0.4, drive: 0.35 }
    }
}

impl ElectricSound {
    /// The settings kept to their ranges.
    #[must_use]
    pub fn clamped(self) -> ElectricSound {
        let fit = |v: f64, lo: f64, hi: f64, or: f64| if v.is_finite() { v.clamp(lo, hi) } else { or };
        ElectricSound {
            fork: self.fork,
            decay: fit(self.decay, 0.2, 20.0, 4.0),
            hardness: fit(self.hardness, 0.0, 1.0, 0.5),
            bell: fit(self.bell, 0.0, 1.0, 0.4),
            drive: fit(self.drive, 0.0, 1.0, 0.35),
        }
    }
}

/// One partial ringing: a two-pole resonator, set going by the strike.
#[derive(Debug, Clone, Copy, Default)]
struct Mode {
    a1: f64,
    a2: f64,
    y1: f64,
    y2: f64,
}

impl Mode {
    /// A partial at `f` Hz, dying away by 60 dB in `t60` seconds, starting at `amp`.
    fn new(f: f64, t60: f64, amp: f64, rate: f64) -> Mode {
        let r = 10f64.powf(-3.0 / (rate * t60.max(0.005)));
        let w = std::f64::consts::TAU * f / rate;
        // A sine from 0, at its peak a quarter cycle on: y[0] = 0, y[1] = amp·r·sin(w).
        Mode { a1: 2.0 * r * w.cos(), a2: -r * r, y1: amp * r * w.sin(), y2: 0.0 }
    }

    fn sample(&mut self) -> f64 {
        let y = self.a1 * self.y1 + self.a2 * self.y2;
        self.y2 = self.y1;
        self.y1 = y;
        y
    }
}

/// A clamped-free bar's partials over its first (Euler-Bernoulli): a tine and a reed are both such bars.
const FORK_RATIOS: [f64; 2] = [6.267, 17.55];

/// An electric piano note sounding: its fork's partials, the hammer's click and the pickup. Made on the note's first
/// block, at the output's rate.
#[derive(Debug, Clone)]
pub struct Tines {
    modes: [Mode; 4],
    count: usize,
    fork: Fork,
    /// The pickup's gain into its curve: the closer and the harder, the more.
    push: f64,
    /// The hammer's click: what is left of it, how fast it goes, its filter and its noise.
    click: f64,
    click_fall: f64,
    click_lp: f64,
    seed: u32,
    /// Takes out the steady offset a lopsided pickup adds.
    dc_x: f64,
    dc_y: f64,
}

impl Tines {
    /// The fork struck at `velocity` (0 to 1), tuned to `hz`, at `rate` samples a second.
    #[must_use]
    pub fn new(sound: ElectricSound, hz: f64, rate: f64, velocity: f64) -> Tines {
        let s = sound.clamped();
        let level = velocity.clamp(0.0, 1.0);
        let hz = hz.clamp(20.0, rate * 0.45);
        // Higher notes die sooner; a reed sooner than a tine.
        let t60 = s.decay * (110.0 / hz).powf(0.3).clamp(0.3, 1.8) * if s.fork == Fork::Reed { 0.6 } else { 1.0 };
        // The hammer: a harder tip and a harder hit reach higher.
        let corner = hz * (2.0 + 22.0 * s.hardness * s.hardness) * (0.5 + 0.5 * level);
        let mut modes = [Mode::default(); 4];
        // The fork's swing and the tone bar beside it, a hair apart, which sustains it a little longer.
        modes[0] = Mode::new(hz, t60, level * 0.75, rate);
        modes[1] = Mode::new(hz * 1.0008, t60 * 1.6, level * 0.25, rate);
        let mut count = 2;
        for (k, ratio) in FORK_RATIOS.iter().enumerate() {
            let f = hz * ratio;
            if f >= rate * 0.45 {
                break;
            }
            let strike = 1.0 / (1.0 + (f / corner).powi(2));
            // The bell is gone in a fraction of the note's own decay.
            modes[count] = Mode::new(f, (t60 * 0.06 / (k as f64 + 1.0)).max(0.02), level * s.bell * strike * 0.6 / (k as f64 + 1.0), rate);
            count += 1;
        }
        Tines {
            modes,
            count,
            fork: s.fork,
            push: 0.3 + 4.0 * s.drive * s.drive * (0.4 + 0.6 * level),
            click: level * s.hardness * 0.12,
            click_fall: (-1.0 / (0.002 * rate)).exp(),
            click_lp: 0.0,
            seed: 0x2545_f491 ^ (hz.to_bits() as u32),
            dc_x: 0.0,
            dc_y: 0.0,
        }
    }

    fn noise(&mut self) -> f64 {
        // xorshift32: the same note sounds the same each time it is rendered.
        self.seed ^= self.seed << 13;
        self.seed ^= self.seed >> 17;
        self.seed ^= self.seed << 5;
        f64::from(self.seed) / f64::from(u32::MAX) * 2.0 - 1.0
    }

    /// The piano's next sample.
    pub fn sample(&mut self) -> f64 {
        let mut x = 0.0;
        for m in &mut self.modes[..self.count] {
            x += m.sample();
        }
        if self.click > 1e-5 {
            let n = self.noise();
            self.click_lp += 0.5 * (n - self.click_lp);
            x += self.click * self.click_lp;
            self.click *= self.click_fall;
        }
        // The pickup: a magnetic one is lopsided (even harmonics), an electrostatic one is even-handed (odd ones).
        let u = self.push * x;
        let y = match self.fork {
            Fork::Tine => (u + 0.35 * u * u).tanh() / self.push,
            Fork::Reed => (u + 0.1 * u * u).tanh() / self.push,
        };
        // A gentle high-pass at about 10 Hz.
        let out = y - self.dc_x + 0.9987 * self.dc_y;
        self.dc_x = y;
        self.dc_y = out;
        out
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    fn render(sound: ElectricSound, hz: f64, velocity: f64, seconds: f64) -> Vec<f64> {
        let mut t = Tines::new(sound, hz, 48_000.0, velocity);
        (0..(48_000.0 * seconds) as usize).map(|_| t.sample()).collect()
    }
    fn rms(x: &[f64]) -> f64 {
        (x.iter().map(|v| v * v).sum::<f64>() / x.len() as f64).sqrt()
    }
    /// How much of `x` is at `hz` (one bin of a Fourier transform).
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
    fn it_sounds_its_note() {
        let x = render(ElectricSound::default(), 220.0, 0.7, 0.5);
        let w = &x[4_800..14_400];
        assert!(at(w, 220.0) > 10.0 * at(w, 290.0), "{} {}", at(w, 220.0), at(w, 290.0));
    }

    #[test]
    fn a_hard_hit_barks_and_a_tine_barks_even_where_a_reed_barks_odd() {
        let bark = |fork: Fork, velocity: f64| {
            let x = render(ElectricSound { fork, drive: 1.0, bell: 0.0, ..ElectricSound::default() }, 110.0, velocity, 0.3);
            let w = &x[4_800..14_400];
            (at(w, 220.0) / at(w, 110.0), at(w, 330.0) / at(w, 110.0))
        };
        let (soft, hard) = (bark(Fork::Tine, 0.2), bark(Fork::Tine, 1.0));
        assert!(hard.0 > soft.0 * 2.0, "{soft:?} {hard:?}");
        let reed = bark(Fork::Reed, 1.0);
        assert!(hard.0 > reed.0 * 1.5 && reed.1 / reed.0 > hard.1 / hard.0, "tine {hard:?} reed {reed:?}");
    }

    #[test]
    fn a_hard_hammer_rings_the_bell_which_dies_before_the_note() {
        let bell = |hardness: f64, from: usize| {
            let x = render(ElectricSound { hardness, bell: 1.0, drive: 0.0, ..ElectricSound::default() }, 220.0, 0.8, 1.0);
            let w = &x[from..from + 2_400];
            at(w, 220.0 * 6.267) / at(w, 220.0)
        };
        assert!(bell(1.0, 0) > bell(0.0, 0) * 2.0, "{} {}", bell(1.0, 0), bell(0.0, 0));
        assert!(bell(1.0, 38_400) < bell(1.0, 0) * 0.1);
    }

    #[test]
    fn it_dies_away_by_its_decay_and_never_runs_away() {
        let short = render(ElectricSound { decay: 0.3, ..ElectricSound::default() }, 110.0, 0.8, 1.5);
        let long = render(ElectricSound { decay: 8.0, ..ElectricSound::default() }, 110.0, 0.8, 1.5);
        assert!(rms(&short[60_000..72_000]) < rms(&long[60_000..72_000]) * 0.05);
        for fork in [Fork::Tine, Fork::Reed] {
            for hz in [27.5, 440.0, 4_186.0] {
                let x = render(ElectricSound { fork, decay: 20.0, hardness: 1.0, bell: 1.0, drive: 1.0 }, hz, 1.0, 0.3);
                assert!(x.iter().all(|v| v.is_finite() && v.abs() < 2.0), "{fork:?} {hz}");
                assert!(rms(&x) > 0.01, "{fork:?} {hz} {}", rms(&x));
            }
        }
    }

    #[test]
    fn settings_out_of_range_are_kept_in_it() {
        let s = ElectricSound { fork: Fork::Reed, decay: f64::NAN, hardness: -1.0, bell: 3.0, drive: 0.5 }.clamped();
        assert_eq!((s.decay, s.hardness, s.bell, s.drive), (4.0, 0.0, 1.0, 0.5));
        let parsed: ElectricSound = serde_json::from_str(r#"{"fork":"reed","bell":0.9}"#).unwrap();
        assert_eq!((parsed.fork, parsed.bell, parsed.decay), (Fork::Reed, 0.9, 4.0));
    }
}
