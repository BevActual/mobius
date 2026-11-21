//! Convolution with a long impulse response and no latency, as the Web Audio `ConvolverNode` the window's reverb uses.
//!
//! The first 128 samples of the response are applied directly. The rest is split into segments that are each applied
//! a block at a time by FFT (uniformly partitioned overlap-save): samples 128 to 2176 in blocks of 128, the rest in
//! blocks of 2048. A segment starting at least one of its blocks into the response has its result ready before it is
//! due, so nothing comes out late. Everything is made up front; `process` allocates nothing.

use realfft::num_complex::Complex32;
use realfft::{ComplexToReal, RealFftPlanner, RealToComplex};
use std::sync::Arc;

/// Taps applied directly, one by one.
const HEAD: usize = 128;
/// The middle segment: blocks of 128, up to this many taps into the response.
const MID_END: usize = HEAD + 16 * 128;
const MID_BLOCK: usize = 128;
const TAIL_BLOCK: usize = 2048;

/// One segment of the response, applied a block at a time by FFT.
struct Segment {
    /// Where the segment starts in the response.
    start: usize,
    block: usize,
    /// Each partition's spectrum (FFT of 2 × block, the partition in its first half).
    parts: Vec<Vec<Complex32>>,
    /// The spectra of the last inputs, newest at `newest`.
    history: Vec<Vec<Complex32>>,
    newest: usize,
    /// The last two blocks of input, and how much of the current one has come.
    input: Vec<f32>,
    filled: usize,
    sum: Vec<Complex32>,
    time: Vec<f32>,
    forward: Arc<dyn RealToComplex<f32>>,
    inverse: Arc<dyn ComplexToReal<f32>>,
    scratch: Vec<Complex32>,
}

impl Segment {
    fn new(response: &[f32], start: usize, block: usize, planner: &mut RealFftPlanner<f32>) -> Option<Segment> {
        let taps = response.get(start..)?;
        if taps.is_empty() {
            return None;
        }
        let forward = planner.plan_fft_forward(2 * block);
        let inverse = planner.plan_fft_inverse(2 * block);
        let bins = block + 1;
        let mut parts = Vec::new();
        for chunk in taps.chunks(block) {
            let mut time = vec![0.0f32; 2 * block];
            time[..chunk.len()].copy_from_slice(chunk);
            let mut spectrum = vec![Complex32::default(); bins];
            forward.process(&mut time, &mut spectrum).ok()?;
            parts.push(spectrum);
        }
        let scratch_len = forward.get_scratch_len().max(inverse.get_scratch_len());
        Some(Segment {
            start,
            block,
            history: vec![vec![Complex32::default(); bins]; parts.len()],
            parts,
            newest: 0,
            input: vec![0.0; 2 * block],
            filled: 0,
            sum: vec![Complex32::default(); bins],
            time: vec![0.0; 2 * block],
            forward,
            inverse,
            scratch: vec![Complex32::default(); scratch_len],
        })
    }

    /// Takes one input sample; when a block is complete, adds its result into `out` from `at` (a ring of `out.len()`).
    fn push(&mut self, x: f32, out: &mut [f32], at: usize) {
        let block = self.block;
        self.input[block + self.filled] = x;
        self.filled += 1;
        if self.filled < block {
            return;
        }
        self.filled = 0;
        // The newest input spectrum, from the last two blocks.
        self.newest = (self.newest + 1) % self.history.len();
        self.time.copy_from_slice(&self.input);
        if self.forward.process_with_scratch(&mut self.time, &mut self.history[self.newest], &mut self.scratch).is_err() {
            return;
        }
        self.input.copy_within(block.., 0);
        // Each partition with the input that far back, added up.
        self.sum.fill(Complex32::default());
        let n = self.history.len();
        for (j, part) in self.parts.iter().enumerate() {
            let past = &self.history[(self.newest + n - j) % n];
            for ((s, h), x) in self.sum.iter_mut().zip(part).zip(past) {
                *s += h * x;
            }
        }
        // A real signal's spectrum: the first and last bins have no imaginary part (rounding can leave a trace).
        if let Some(first) = self.sum.first_mut() {
            first.im = 0.0;
        }
        if let Some(last) = self.sum.last_mut() {
            last.im = 0.0;
        }
        if self.inverse.process_with_scratch(&mut self.sum, &mut self.time, &mut self.scratch).is_err() {
            return;
        }
        // The second half is this block's result (overlap-save), due `start` samples after the block began.
        let scale = 1.0 / (2 * block) as f32;
        let len = out.len();
        let began = at + len + 1 - block;
        for (i, y) in self.time[block..].iter().enumerate() {
            out[(began + self.start + i) % len] += y * scale;
        }
    }
}

/// One channel of a convolver: input in, the response applied, out.
pub struct Convolver {
    head: Vec<f32>,
    /// The last `HEAD` inputs, newest at `pos`.
    recent: Vec<f32>,
    pos: usize,
    segments: Vec<Segment>,
    /// What the segments have worked out ahead, by the sample it is due at.
    ahead: Vec<f32>,
    now: usize,
}

impl Convolver {
    #[must_use]
    pub fn new(response: &[f32]) -> Convolver {
        let mut planner = RealFftPlanner::new();
        let mid = response.get(..MID_END.min(response.len())).unwrap_or(&[]);
        let segments: Vec<Segment> = [Segment::new(mid, HEAD, MID_BLOCK, &mut planner), Segment::new(response, MID_END, TAIL_BLOCK, &mut planner)].into_iter().flatten().collect();
        Convolver {
            head: response.iter().take(HEAD).copied().collect(),
            recent: vec![0.0; HEAD],
            pos: 0,
            segments,
            // Long enough for the furthest a block's result lands ahead: the tail's start plus its block.
            ahead: vec![0.0; MID_END + 2 * TAIL_BLOCK],
            now: 0,
        }
    }

    /// The next output sample for input `x`.
    pub fn process(&mut self, x: f32) -> f32 {
        self.pos = (self.pos + 1) % HEAD;
        self.recent[self.pos] = x;
        let mut y = 0.0;
        for (k, h) in self.head.iter().enumerate() {
            y += h * self.recent[(self.pos + HEAD - k) % HEAD];
        }
        let len = self.ahead.len();
        let slot = self.now % len;
        y += std::mem::take(&mut self.ahead[slot]);
        for segment in &mut self.segments {
            segment.push(x, &mut self.ahead, self.now);
        }
        self.now += 1;
        y
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    fn direct(x: &[f32], h: &[f32]) -> Vec<f32> {
        (0..x.len()).map(|n| (0..h.len().min(n + 1)).map(|k| h[k] * x[n - k]).sum()).collect()
    }

    #[test]
    fn it_matches_direct_convolution_from_the_first_sample() {
        let mut seed = 1u32;
        let mut rand = || {
            seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            (seed >> 8) as f32 / (1u32 << 24) as f32 - 0.5
        };
        let h: Vec<f32> = (0..9000).map(|_| rand()).collect();
        let x: Vec<f32> = (0..12_000).map(|i| if i % 997 == 0 { 1.0 } else { rand() * 0.1 }).collect();
        let want = direct(&x, &h);
        let mut c = Convolver::new(&h);
        let got: Vec<f32> = x.iter().map(|s| c.process(*s)).collect();
        let worst = want.iter().zip(&got).map(|(a, b)| (a - b).abs()).fold(0.0f32, f32::max);
        assert!(worst < 1e-3, "{worst}");
    }

    #[test]
    fn a_short_response_works_too() {
        let mut c = Convolver::new(&[0.5, 0.25]);
        let got: Vec<f32> = [1.0, 0.0, 0.0, 0.0].iter().map(|s| c.process(*s)).collect();
        assert_eq!(got, vec![0.5, 0.25, 0.0, 0.0]);
    }
}
