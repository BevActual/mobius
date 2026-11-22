//! The engine's sense of time: a count of samples, turned into seconds and beats at the song's tempo. Every sound is
//! placed on a sample, so two renders of a song are the same to the sample.

/// Seconds and beats from samples, at one sample rate and tempo.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Clock {
    pub sample_rate: f64,
    pub tempo: f64,
}

impl Clock {
    #[must_use]
    pub fn new(sample_rate: u32, tempo: f64) -> Clock {
        Clock { sample_rate: f64::from(sample_rate), tempo }
    }

    #[must_use]
    pub fn seconds_per_beat(self) -> f64 {
        60.0 / self.tempo
    }

    #[must_use]
    pub fn seconds(self, sample: u64) -> f64 {
        sample as f64 / self.sample_rate
    }

    /// The sample a beat falls on (the first one at or after it).
    #[must_use]
    pub fn sample_of_beat(self, beat: f64) -> u64 {
        (beat.max(0.0) * self.seconds_per_beat() * self.sample_rate).ceil() as u64
    }

    #[must_use]
    pub fn beat(self, sample: u64) -> f64 {
        self.seconds(sample) / self.seconds_per_beat()
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
    }
}
