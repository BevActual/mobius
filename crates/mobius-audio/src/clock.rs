//! The engine's sense of time: a count of samples, turned into seconds and beats at the song's tempo. Every sound is
//! placed on a sample, so two renders of a song are the same to the sample.
//!
//! The tempo may change along the song (Live 12's tempo automation on the Main track): between two points of the
//! tempo line it ramps straight from one to the other, in beats, and before the first and after the last it holds.
//! Time then runs as the integral of 60 / tempo over the beats, which for a straight ramp has a closed form both ways,
//! so a beat's sample and a sample's beat are exact however long the song.

use std::sync::Arc;

/// The lowest and highest tempo the clock keeps to, as the window does.
pub const TEMPO_MIN: f64 = 30.0;
pub const TEMPO_MAX: f64 = 300.0;

/// One stretch of the tempo line: from `beat` (which falls `seconds` into the song) at `bpm`, changing by `slope`
/// beats a minute every beat until the next.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Ramp {
    beat: f64,
    seconds: f64,
    bpm: f64,
    slope: f64,
}

impl Ramp {
    /// Seconds from this stretch's start to `d` beats into it.
    fn seconds_in(&self, d: f64) -> f64 {
        if self.slope.abs() < 1e-9 {
            d * 60.0 / self.bpm
        } else {
            60.0 / self.slope * ((self.bpm + self.slope * d) / self.bpm).ln()
        }
    }

    /// Beats from this stretch's start to `t` seconds into it.
    fn beats_in(&self, t: f64) -> f64 {
        if self.slope.abs() < 1e-9 {
            t * self.bpm / 60.0
        } else {
            self.bpm / self.slope * ((self.slope * t / 60.0).exp() - 1.0)
        }
    }
}

/// Seconds and beats from samples, at one sample rate and tempo, or along a tempo line.
#[derive(Debug, Clone, PartialEq)]
pub struct Clock {
    pub sample_rate: f64,
    /// The tempo where there is no line (and where it starts when there is one).
    pub tempo: f64,
    ramps: Option<Arc<[Ramp]>>,
}

impl Clock {
    #[must_use]
    pub fn new(sample_rate: u32, tempo: f64) -> Clock {
        Clock { sample_rate: f64::from(sample_rate), tempo, ramps: None }
    }

    /// A clock that follows a tempo line: `(beat, bpm)` points, in any order. With none, it keeps to `tempo`.
    #[must_use]
    pub fn with_tempo_line(sample_rate: u32, tempo: f64, points: &[(f64, f64)]) -> Clock {
        let mut pts: Vec<(f64, f64)> = points.iter().filter(|(b, v)| b.is_finite() && v.is_finite() && *b >= 0.0).map(|&(b, v)| (b, v.clamp(TEMPO_MIN, TEMPO_MAX))).collect();
        if pts.is_empty() {
            return Clock::new(sample_rate, tempo);
        }
        pts.sort_by(|a, b| a.0.total_cmp(&b.0));
        // Held at the first point's tempo from the start, ramping between points, held after the last.
        let mut ramps = Vec::with_capacity(pts.len() + 1);
        let first = pts[0];
        ramps.push(Ramp { beat: 0.0, seconds: 0.0, bpm: first.1, slope: 0.0 });
        for (i, &(beat, bpm)) in pts.iter().enumerate() {
            let slope = match pts.get(i + 1) {
                Some(&(next, to)) if next - beat > 1e-9 => (to - bpm) / (next - beat),
                _ => 0.0,
            };
            let last = ramps[ramps.len() - 1];
            let seconds = last.seconds + last.seconds_in(beat - last.beat);
            if beat - last.beat < 1e-12 {
                ramps.pop();
            }
            ramps.push(Ramp { beat, seconds, bpm, slope });
        }
        Clock { sample_rate: f64::from(sample_rate), tempo: first.1, ramps: Some(ramps.into()) }
    }

    /// Whether the tempo changes along the song.
    #[must_use]
    pub fn changes(&self) -> bool {
        self.ramps.is_some()
    }

    /// Seconds a beat lasts at the start (the song's tempo).
    #[must_use]
    pub fn seconds_per_beat(&self) -> f64 {
        60.0 / self.tempo
    }

    /// The tempo at `beat`.
    #[must_use]
    pub fn tempo_at(&self, beat: f64) -> f64 {
        match &self.ramps {
            None => self.tempo,
            Some(r) => {
                let ramp = r[r.partition_point(|x| x.beat <= beat).saturating_sub(1)];
                ramp.bpm + ramp.slope * (beat - ramp.beat).max(0.0)
            }
        }
    }

    /// Seconds from the song's start to `beat`.
    #[must_use]
    pub fn seconds_of_beat(&self, beat: f64) -> f64 {
        let beat = beat.max(0.0);
        match &self.ramps {
            None => beat * 60.0 / self.tempo,
            Some(r) => {
                let ramp = r[r.partition_point(|x| x.beat <= beat).saturating_sub(1)];
                ramp.seconds + ramp.seconds_in(beat - ramp.beat)
            }
        }
    }

    /// The beat `seconds` into the song.
    #[must_use]
    pub fn beat_of_seconds(&self, seconds: f64) -> f64 {
        let seconds = seconds.max(0.0);
        match &self.ramps {
            None => seconds * self.tempo / 60.0,
            Some(r) => {
                let ramp = r[r.partition_point(|x| x.seconds <= seconds).saturating_sub(1)];
                ramp.beat + ramp.beats_in(seconds - ramp.seconds)
            }
        }
    }

    /// Seconds from beat `a` to beat `b`: how long a note from one to the other lasts.
    #[must_use]
    pub fn seconds_between(&self, a: f64, b: f64) -> f64 {
        self.seconds_of_beat(b) - self.seconds_of_beat(a)
    }

    #[must_use]
    pub fn seconds(&self, sample: u64) -> f64 {
        sample as f64 / self.sample_rate
    }

    /// The sample a beat falls on (the first one at or after it).
    #[must_use]
    pub fn sample_of_beat(&self, beat: f64) -> u64 {
        // A hair under, so a beat that lands exactly on a sample is not pushed to the next by rounding.
        (self.seconds_of_beat(beat) * self.sample_rate - 1e-7).ceil().max(0.0) as u64
    }

    #[must_use]
    pub fn beat(&self, sample: u64) -> f64 {
        self.beat_of_seconds(self.seconds(sample))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn beats_land_on_samples() {
        let clock = Clock::new(48_000, 120.0);
        assert_eq!(clock.sample_of_beat(1.0), 24_000);
        assert_eq!(clock.sample_of_beat(0.25), 6_000);
        assert!((clock.beat(36_000) - 1.5).abs() < 1e-12);
        assert!(!clock.changes());
    }

    #[test]
    fn a_tempo_line_holds_ramps_and_holds_and_goes_both_ways() {
        // 120 until beat 4, ramping to 60 by beat 8, then 60.
        let clock = Clock::with_tempo_line(48_000, 100.0, &[(8.0, 60.0), (4.0, 120.0)]);
        assert!(clock.changes());
        assert!((clock.tempo_at(2.0) - 120.0).abs() < 1e-9 && (clock.tempo_at(6.0) - 90.0).abs() < 1e-9 && (clock.tempo_at(20.0) - 60.0).abs() < 1e-9);
        // Four beats at 120 are 2 s; the ramp is 60/slope·ln(60/120) with slope -15: 2.7726 s; then a second a beat.
        assert!((clock.seconds_of_beat(4.0) - 2.0).abs() < 1e-9);
        let ramp = 60.0 / -15.0 * (0.5f64).ln();
        assert!((clock.seconds_of_beat(8.0) - (2.0 + ramp)).abs() < 1e-9);
        assert!((clock.seconds_of_beat(10.0) - (4.0 + ramp)).abs() < 1e-9);
        for beat in [0.0, 1.3, 4.0, 5.5, 7.99, 8.0, 12.25] {
            assert!((clock.beat_of_seconds(clock.seconds_of_beat(beat)) - beat).abs() < 1e-9, "{beat}");
            let s = clock.sample_of_beat(beat);
            assert!(clock.beat(s) >= beat - 1e-9 && clock.beat(s.saturating_sub(1)) < beat + 1e-9, "{beat}");
        }
        // A beat in the ramp is longer than one before it.
        assert!(clock.seconds_between(6.0, 7.0) > clock.seconds_between(1.0, 2.0));
        // Out-of-range tempos are kept to the window's.
        let fast = Clock::with_tempo_line(48_000, 120.0, &[(0.0, 9_000.0)]);
        assert!((fast.tempo_at(3.0) - TEMPO_MAX).abs() < 1e-9);
        assert!(!Clock::with_tempo_line(48_000, 120.0, &[]).changes());
    }
}
