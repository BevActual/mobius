//! One drum hit, as studio-audio.ts `drum` makes it. The kick and the tom are a sine falling in pitch; the others are
//! noise through a filter (high-pass for the hats, band-pass for the clap and snare), each dying away exponentially.
//! The kit's tune, decay and tone and the drum's own pad (tune, decay, level, pan) shape it.

use crate::param::Param;
use crate::song::{Kit, Pad};
use crate::voice::pan_gains;
use std::f64::consts::TAU;

/// How long the window's noise lasts: a hit longer than this goes quiet when its noise runs out.
const NOISE_SECONDS: f64 = 0.5;

#[derive(Debug, Clone, Copy)]
enum Body {
    /// A sine, its frequency swept by a value.
    Sine { phase: f64 },
    /// Noise through a two-pole filter, the Web Audio way: high-pass (Q 1 in dB) or band-pass (Q 1).
    Noise { high: bool, freq: f64, seed: u32, x1: f64, x2: f64, y1: f64, y2: f64 },
}

#[derive(Debug, Clone)]
pub struct Hit {
    body: Body,
    freq: Param,
    gain: Param,
    /// Left and right levels from the drum's pan.
    sides: (f64, f64),
    end: f64,
    time: f64,
    /// Samples into the block it starts in: it starts there the first time it is played.
    wait: usize,
}

impl Hit {
    /// A hit of the drum at `pitch` through `kit`, with the drum's own `pad`. `seed` varies the noise.
    #[must_use]
    pub fn new(pitch: u8, velocity: f64, kit: Kit, pad: Pad, seed: u32) -> Hit {
        let tune = 2f64.powf((kit.tune + pad.tune).clamp(-24.0, 24.0) / 12.0);
        let decay = kit.decay * pad.decay;
        let bright = 2f64.powf((kit.tone - 0.5) * 2.0);
        let velocity = velocity.clamp(0.0, 1.0) * pad.level;
        let sides = pan_gains(pad.pan);
        if pitch == 36 || pitch == 45 {
            let kick = pitch == 36;
            let ring = 0.35 * decay;
            let freq = Param::new((if kick { 140.0 } else { 220.0 }) * tune).set((if kick { 140.0 } else { 220.0 }) * tune, 0.0).exponential((if kick { 45.0 } else { 90.0 }) * tune, 0.15 * decay);
            let gain = Param::new(velocity).set(velocity, 0.0).exponential(0.001, ring);
            return Hit { body: Body::Sine { phase: 0.0 }, freq, gain, sides, end: ring + 0.05, time: 0.0, wait: 0 };
        }
        let open = pitch == 46;
        let hat = pitch == 42 || open;
        let base = if hat { 7000.0 } else if pitch == 39 { 1500.0 } else { 1800.0 };
        let len = (if hat { if open { 0.3 } else { 0.05 } } else { 0.18 }) * decay;
        let level = velocity * if hat { 0.35 } else { 0.7 };
        let gain = Param::new(level).set(level, 0.0).exponential(0.001, len);
        let body = Body::Noise { high: hat, freq: (base * tune * bright).min(16_000.0), seed: seed | 1, x1: 0.0, x2: 0.0, y1: 0.0, y2: 0.0 };
        Hit { body, freq: Param::new(0.0), gain, sides, end: (len + 0.05).min(NOISE_SECONDS), time: 0.0, wait: 0 }
    }

    /// The same hit, starting `samples` into the block it is next played in.
    /// Where in a block of `n` samples it starts (`n` when not in this one), counting that block off its wait.
    pub fn wait_within(&mut self, n: usize) -> usize {
        let wait = self.wait.min(n);
        self.wait -= wait;
        wait
    }

    #[must_use]
    pub fn waiting(mut self, samples: usize) -> Hit {
        self.wait = samples;
        self
    }

    /// Where in this block it starts (0 once it has started), taken so the next block starts at its beginning.
    pub fn take_wait(&mut self) -> usize {
        std::mem::take(&mut self.wait)
    }

    #[must_use]
    pub fn done(&self) -> bool {
        self.time >= self.end
    }

    /// Adds the next samples of the hit into `left` and `right` (the same length).
    pub fn add_to(&mut self, left: &mut [f32], right: &mut [f32], rate: f64) {
        let dt = 1.0 / rate;
        // The filter does not move during a hit: its coefficients are worked out once a block.
        let coefficients = match self.body {
            Body::Noise { high, freq, .. } => Some(filter(high, freq, rate)),
            Body::Sine { .. } => None,
        };
        for (l, r) in left.iter_mut().zip(right.iter_mut()) {
            if self.done() {
                return;
            }
            let x = match &mut self.body {
                Body::Sine { phase } => {
                    let y = (TAU * *phase).sin();
                    *phase = (*phase + self.freq.at(self.time) * dt).fract();
                    y
                }
                Body::Noise { seed, x1, x2, y1, y2, .. } => {
                    // xorshift: white noise from -1 to 1, as the window's random buffer is.
                    *seed ^= *seed << 13;
                    *seed ^= *seed >> 17;
                    *seed ^= *seed << 5;
                    let x = f64::from(*seed) / f64::from(u32::MAX) * 2.0 - 1.0;
                    let [b0, b1, b2, a1, a2] = coefficients.unwrap_or_default();
                    let y = b0 * x + b1 * *x1 + b2 * *x2 - a1 * *y1 - a2 * *y2;
                    (*x2, *x1, *y2, *y1) = (*x1, x, *y1, y);
                    y
                }
            };
            let y = x * self.gain.at(self.time);
            *l += (y * self.sides.0) as f32;
            *r += (y * self.sides.1) as f32;
            self.time += dt;
        }
    }
}

/// The Web Audio high-pass (Q 1, in dB) or band-pass (Q 1) at `freq`, divided through by a0.
fn filter(high: bool, freq: f64, rate: f64) -> [f64; 5] {
    let w0 = TAU * (freq / rate).clamp(1e-5, 0.4999);
    let (sin, cos) = w0.sin_cos();
    let q = if high { 10f64.powf(1.0 / 20.0) } else { 1.0 };
    let alpha = sin / (2.0 * q);
    let a0 = 1.0 + alpha;
    let (b0, b1, b2) = if high { ((1.0 + cos) / 2.0, -(1.0 + cos), (1.0 + cos) / 2.0) } else { (alpha, 0.0, -alpha) };
    [b0 / a0, b1 / a0, b2 / a0, -2.0 * cos / a0, (1.0 - alpha) / a0]
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    fn run(mut hit: Hit, seconds: f64) -> (Vec<f32>, Vec<f32>) {
        let n = (seconds * 48_000.0) as usize;
        let (mut l, mut r) = (vec![0.0; n], vec![0.0; n]);
        hit.add_to(&mut l, &mut r, 48_000.0);
        (l, r)
    }

    fn rms(s: &[f32]) -> f64 {
        (s.iter().map(|x| f64::from(*x).powi(2)).sum::<f64>() / s.len().max(1) as f64).sqrt()
    }

    #[test]
    fn a_kick_falls_in_pitch_and_dies_away() {
        let (l, r) = run(Hit::new(36, 1.0, Kit::default(), Pad::default(), 1), 0.5);
        assert_eq!(l, r);
        let peak = l.iter().fold(0.0f32, |m, x| m.max(x.abs()));
        assert!(peak > 0.9 && peak <= 1.0, "{peak}");
        assert!(rms(&l[..2400]) > 10.0 * rms(&l[16_000..16_800]));
        assert!(l[19_300..].iter().all(|x| *x == 0.0), "silent after its ring");
    }

    #[test]
    fn a_closed_hat_is_short_and_a_panned_drum_leans_to_its_side() {
        let (l, _) = run(Hit::new(42, 1.0, Kit::default(), Pad::default(), 7), 0.2);
        assert!(rms(&l[..1200]) > 0.01);
        assert!(l[4_900..].iter().all(|x| *x == 0.0));
        let pad = Pad { pan: -1.0, ..Pad::default() };
        let (l, r) = run(Hit::new(38, 1.0, Kit::default(), pad, 7), 0.2);
        assert!(rms(&l) > 0.01 && rms(&r) < 1e-6);
    }

    #[test]
    fn a_longer_decay_rings_longer_and_level_scales_it() {
        let short = run(Hit::new(38, 1.0, Kit::default(), Pad::default(), 3), 0.5).0;
        let long = run(Hit::new(38, 1.0, Kit { decay: 2.0, ..Kit::default() }, Pad::default(), 3), 0.5).0;
        assert!(rms(&long[9000..12_000]) > 3.0 * rms(&short[9000..12_000]));
        let half = run(Hit::new(38, 1.0, Kit::default(), Pad { level: 0.5, ..Pad::default() }, 3), 0.1).0;
        let full = run(Hit::new(38, 1.0, Kit::default(), Pad::default(), 3), 0.1).0;
        // The fall is to a fixed 0.001, as the window's, so half the level is a little more than half as loud.
        let ratio = rms(&half) / rms(&full);
        assert!(ratio > 0.5 && ratio < 0.75, "{ratio}");
    }
}
