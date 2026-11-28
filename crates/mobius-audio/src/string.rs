//! A physically modelled string, after Live 12's Tension (manual, "Live Instrument Reference: Tension"): an exciter sets a string going,
//! and the string is a waveguide, a delay line one period long that its wave goes round, losing a little and
//! darkening a little each time (extended Karplus-Strong). The exciter is a pluck (the line filled with a burst of
//! noise), a hammer (a short soft bump struck at a point) or a bow (noise fed in for as long as the note is held).
//! Where along the string it is struck or bowed takes out the harmonics with a node there, as on a real string.

use serde::Deserialize;

/// How a string is set going.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Exciter {
    #[default]
    Pluck,
    Hammer,
    Bow,
}

/// A string's settings, as the song file has them (a track's `string`).
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct StringSound {
    pub exciter: Exciter,
    /// Seconds for a low note to die away by 60 dB (higher notes die a little sooner, as on a real string).
    pub decay: f64,
    /// 0 bright to 1 dark: how much the top is lost each time round.
    pub damping: f64,
    /// Where along the string it is struck or bowed, 0 at the bridge to 0.5 in the middle.
    pub position: f64,
    /// 0 soft to 1 hard: how bright the pluck, hammer or bow is.
    pub tone: f64,
}

impl Default for StringSound {
    fn default() -> StringSound {
        StringSound { exciter: Exciter::Pluck, decay: 3.0, damping: 0.4, position: 0.2, tone: 0.6 }
    }
}

impl StringSound {
    /// The settings kept to their ranges.
    #[must_use]
    pub fn clamped(self) -> StringSound {
        StringSound {
            exciter: self.exciter,
            decay: if self.decay.is_finite() { self.decay.clamp(0.05, 30.0) } else { 3.0 },
            damping: if self.damping.is_finite() { self.damping.clamp(0.0, 1.0) } else { 0.4 },
            position: if self.position.is_finite() { self.position.clamp(0.02, 0.5) } else { 0.2 },
            tone: if self.tone.is_finite() { self.tone.clamp(0.0, 1.0) } else { 0.6 },
        }
    }
}

/// A sounding string: its delay line and the filters in its loop. Made on the note's first block, at the output's rate.
#[derive(Debug, Clone)]
pub struct Strand {
    line: Vec<f64>,
    at: usize,
    /// The loss filter's share of the sample before (0 to 0.5): the more, the darker each pass.
    smooth: f64,
    last: f64,
    /// The gain each sample goes round with, for the decay asked.
    keep: f64,
    /// The all-pass that tunes the loop between whole samples.
    ap: f64,
    ap_x: f64,
    ap_y: f64,
    /// The bow's noise and its filter, and how hard it bows.
    bow: f64,
    bow_lp: f64,
    bow_tone: f64,
    /// Where the bow touches the line.
    touch: usize,
    seed: u32,
}

impl Strand {
    /// A string tuned to `hz` at `rate` samples a second, set going at `velocity` (0 to 1).
    #[must_use]
    pub fn new(sound: StringSound, hz: f64, rate: f64, velocity: f64, seed: u32) -> Strand {
        let s = sound.clamped();
        let hz = hz.clamp(20.0, rate / 4.0);
        let smooth = 0.02 + 0.48 * s.damping;
        // The loop's length is one period: the line, the loss filter's delay and the all-pass's share.
        let period = rate / hz;
        let whole = (period - smooth - 0.1).floor().max(2.0);
        let frac = period - smooth - whole;
        let ap = (1.0 - frac) / (1.0 + frac);
        let len = whole as usize;
        // Higher notes die a little sooner, as their energy leaves through the bridge more often.
        let t60 = s.decay * (110.0 / hz).powf(0.25).clamp(0.4, 1.6);
        // Each sample of the line goes round once a period, losing this much each time.
        let keep = 10f64.powf(-3.0 / (hz * t60));
        let mut strand = Strand { line: vec![0.0; len], at: 0, smooth, last: 0.0, keep, ap, ap_x: 0.0, ap_y: 0.0, bow: 0.0, bow_lp: 0.0, bow_tone: 0.0, touch: ((len as f64) * s.position) as usize, seed: seed | 1 };
        let level = velocity.clamp(0.0, 1.0);
        // Harder notes are brighter, as a harder pluck or strike is.
        let bright = (0.15 + 0.85 * s.tone) * (0.6 + 0.4 * level);
        match s.exciter {
            Exciter::Pluck => {
                let mut lp = 0.0;
                for i in 0..len {
                    let n = strand.noise();
                    lp += bright * (n - lp);
                    strand.line[i] = lp * level;
                }
                strand.comb(s.position);
            }
            Exciter::Hammer => {
                // A raised-cosine bump: narrow for a hard hammer, wide for a soft one.
                let width = ((len as f64) * (0.35 - 0.3 * s.tone)).max(2.0);
                let centre = (len as f64) * s.position;
                for i in 0..len {
                    let d = (i as f64 - centre) / width;
                    if d.abs() < 1.0 {
                        strand.line[i] = level * 0.5 * (1.0 + (std::f64::consts::PI * d).cos());
                    }
                }
                let mean = strand.line.iter().sum::<f64>() / len as f64;
                for v in &mut strand.line {
                    *v -= mean;
                }
            }
            Exciter::Bow => {
                strand.bow = level * 0.1;
                strand.bow_tone = bright;
            }
        }
        strand
    }

    /// Takes out what a node at `position` would: the line less itself shifted by that much, as plucking there does.
    fn comb(&mut self, position: f64) {
        let len = self.line.len();
        let shift = ((len as f64) * position).round() as usize;
        if shift == 0 || shift >= len {
            return;
        }
        let was = self.line.clone();
        for i in 0..len {
            self.line[i] = was[i] - was[(i + len - shift) % len];
        }
        let peak = self.line.iter().fold(0.0f64, |m, v| m.max(v.abs()));
        let before = was.iter().fold(0.0f64, |m, v| m.max(v.abs()));
        if peak > 1e-9 {
            let scale = before / peak;
            for v in &mut self.line {
                *v *= scale;
            }
        }
    }

    fn noise(&mut self) -> f64 {
        // xorshift32: the same note sounds the same each time it is rendered.
        self.seed ^= self.seed << 13;
        self.seed ^= self.seed >> 17;
        self.seed ^= self.seed << 5;
        f64::from(self.seed) / f64::from(u32::MAX) * 2.0 - 1.0
    }

    /// Stops the bow (the key is let go): the string rings on from there.
    pub fn lift(&mut self) {
        self.bow = 0.0;
    }

    /// The string's next sample.
    pub fn sample(&mut self) -> f64 {
        let len = self.line.len();
        let out = self.line[self.at];
        // Loss: a little quieter and a little darker each time round.
        let lost = self.keep * ((1.0 - self.smooth) * out + self.smooth * self.last);
        self.last = out;
        // Tuning between whole samples.
        let tuned = self.ap * lost + self.ap_x - self.ap * self.ap_y;
        self.ap_x = lost;
        self.ap_y = tuned;
        let mut back = tuned;
        if self.bow > 0.0 {
            let n = self.noise();
            self.bow_lp += self.bow_tone * (n - self.bow_lp);
            back += self.bow * self.bow_lp;
            let touched = (self.at + self.touch) % len;
            self.line[touched] += self.bow * self.bow_lp * 0.5;
        }
        self.line[self.at] = back;
        self.at = (self.at + 1) % len;
        out
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    fn render(sound: StringSound, hz: f64, seconds: f64) -> Vec<f64> {
        let rate = 48_000.0;
        let mut s = Strand::new(sound, hz, rate, 0.9, 7);
        (0..(rate * seconds) as usize).map(|_| s.sample()).collect()
    }

    /// The period, in samples, the signal repeats at most closely (autocorrelation over a window).
    fn period(x: &[f64], lo: usize, hi: usize) -> usize {
        let w = &x[2_000..6_000];
        (lo..hi).max_by(|&a, &b| {
            let c = |p: usize| w.iter().zip(&x[2_000 + p..6_000 + p]).map(|(u, v)| u * v).sum::<f64>();
            c(a).total_cmp(&c(b))
        }).unwrap()
    }

    #[test]
    fn a_plucked_string_sounds_its_note() {
        // A2 at 48 kHz: a period of 436.4 samples.
        let x = render(StringSound::default(), 110.0, 0.3);
        let p = period(&x, 300, 600);
        assert!((435..=438).contains(&p), "period {p}");
        let a4 = render(StringSound::default(), 440.0, 0.3);
        assert!((108..=110).contains(&period(&a4, 80, 140)));
    }

    #[test]
    fn it_dies_away_by_its_decay_and_damping_darkens_it() {
        let rms = |x: &[f64]| (x.iter().map(|v| v * v).sum::<f64>() / x.len() as f64).sqrt();
        let short = render(StringSound { decay: 0.5, ..StringSound::default() }, 110.0, 1.5);
        let long = render(StringSound { decay: 6.0, ..StringSound::default() }, 110.0, 1.5);
        let tail = |x: &[f64]| rms(&x[60_000..72_000]);
        assert!(tail(&short) < tail(&long) * 0.05, "{} vs {}", tail(&short), tail(&long));
        // Darker: less of the change from one sample to the next (the top).
        let edge = |x: &[f64]| rms(&x.windows(2).map(|w| w[1] - w[0]).collect::<Vec<_>>()[10_000..20_000]) / rms(&x[10_000..20_000]);
        let bright = render(StringSound { damping: 0.0, ..StringSound::default() }, 220.0, 0.5);
        let dark = render(StringSound { damping: 1.0, ..StringSound::default() }, 220.0, 0.5);
        assert!(edge(&dark) < edge(&bright) * 0.7);
    }

    #[test]
    fn a_bow_keeps_it_going_until_it_is_lifted_and_a_hammer_rings() {
        let rms = |x: &[f64]| (x.iter().map(|v| v * v).sum::<f64>() / x.len() as f64).sqrt();
        let mut s = Strand::new(StringSound { exciter: Exciter::Bow, decay: 0.3, ..StringSound::default() }, 110.0, 48_000.0, 0.9, 3);
        let held: Vec<f64> = (0..96_000).map(|_| s.sample()).collect();
        assert!(rms(&held[84_000..96_000]) > 0.01, "bowed {}", rms(&held[84_000..96_000]));
        s.lift();
        let after: Vec<f64> = (0..48_000).map(|_| s.sample()).collect();
        assert!(rms(&after[36_000..]) < rms(&held[84_000..96_000]) * 0.01);
        let hit = render(StringSound { exciter: Exciter::Hammer, ..StringSound::default() }, 220.0, 0.5);
        assert!(rms(&hit[4_000..8_000]) > 0.01);
        assert!(hit.iter().all(|v| v.is_finite() && v.abs() < 4.0));
    }

    #[test]
    fn settings_out_of_range_are_kept_in_it() {
        let s = StringSound { exciter: Exciter::Pluck, decay: f64::NAN, damping: 4.0, position: -1.0, tone: 2.0 }.clamped();
        assert_eq!((s.decay, s.damping, s.position, s.tone), (3.0, 1.0, 0.02, 1.0));
        let parsed: StringSound = serde_json::from_str(r#"{"exciter":"bow","decay":2}"#).unwrap();
        assert_eq!((parsed.exciter, parsed.decay, parsed.damping), (Exciter::Bow, 2.0, 0.4));
    }
}
