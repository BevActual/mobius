//! A value that moves over time the way a Web Audio `AudioParam` does, so the engine's envelopes and sweeps follow
//! the same curves as the window's version (studio-audio.ts): set, linear ramp, exponential ramp and set-target.

#[derive(Debug, Clone, Copy)]
enum Event {
    Set(f64),
    Linear(f64),
    Exponential(f64),
    /// Approach `target` with time constant `tau` seconds.
    Target { target: f64, tau: f64 },
}

/// The most events one value holds: a note's envelope needs four.
const MAX_EVENTS: usize = 6;

/// Events in time order, read forward one sample at a time. It holds them in place, so making one on the audio
/// thread allocates nothing.
#[derive(Debug, Clone)]
pub struct Param {
    events: [(f64, Event); MAX_EVENTS],
    count: usize,
    /// The first event not yet reached.
    next: usize,
    /// The value where the event before `next` left it, and when.
    from: (f64, f64),
    /// The set-target running since the last event, if one is.
    target: Option<(f64, f64, f64)>,
}

impl Param {
    #[must_use]
    pub fn new(value: f64) -> Param {
        Param { events: [(0.0, Event::Set(value)); MAX_EVENTS], count: 0, next: 0, from: (0.0, value), target: None }
    }

    /// The value from `at` on (`setValueAtTime`).
    #[must_use]
    pub fn set(self, value: f64, at: f64) -> Param {
        self.push(at, Event::Set(value))
    }

    /// A straight line from the last event to `value` at `at` (`linearRampToValueAtTime`).
    #[must_use]
    pub fn linear(self, value: f64, at: f64) -> Param {
        self.push(at, Event::Linear(value))
    }

    /// An exponential curve from the last event to `value` at `at` (`exponentialRampToValueAtTime`).
    #[must_use]
    pub fn exponential(self, value: f64, at: f64) -> Param {
        self.push(at, Event::Exponential(value))
    }

    /// From `at`, moving toward `target` with time constant `tau` seconds (`setTargetAtTime`).
    #[must_use]
    pub fn target(self, target: f64, at: f64, tau: f64) -> Param {
        self.push(at, Event::Target { target, tau: tau.max(1e-6) })
    }

    fn push(mut self, at: f64, event: Event) -> Param {
        if let Some(slot) = self.events.get_mut(self.count) {
            *slot = (at, event);
            self.count += 1;
        }
        self
    }

    /// The value at `time` seconds. Times must not go backwards between calls.
    pub fn at(&mut self, time: f64) -> f64 {
        while let Some(&(when, event)) = self.events[..self.count].get(self.next) {
            let start = self.current(when);
            match event {
                // A ramp is under way until its time: the line from where the last event left the value.
                Event::Linear(v) | Event::Exponential(v) if time < when => {
                    let (t0, v0) = self.from;
                    let share = if when > t0 { (time - t0) / (when - t0) } else { 1.0 };
                    return match event {
                        Event::Exponential(_) if v0 * v > 0.0 => v0 * (v / v0).powf(share),
                        Event::Exponential(_) => v0,
                        _ => v0 + (v - v0) * share,
                    };
                }
                _ if time < when => break,
                Event::Set(v) | Event::Linear(v) | Event::Exponential(v) => {
                    self.from = (when, v);
                    self.target = None;
                }
                Event::Target { target, tau } => {
                    self.from = (when, start);
                    self.target = Some((when, target, tau));
                }
            }
            self.next += 1;
        }
        self.current(time)
    }

    /// The value at `time` between events: the last event's, or where a running set-target has brought it.
    fn current(&self, time: f64) -> f64 {
        match self.target {
            Some((t0, target, tau)) => target + (self.from.1 - target) * (-(time - t0).max(0.0) / tau).exp(),
            None => self.from.1,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn near(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-6
    }

    #[test]
    fn an_envelope_follows_the_web_audio_curves() {
        // As studio-audio.ts shapes a note: up to the peak, down toward the sustain, then away at the release.
        let mut gain = Param::new(1.0).set(0.0, 1.0).linear(0.5, 1.1).target(0.25, 1.1, 0.1).target(0.0001, 2.0, 0.05);
        assert!(near(gain.at(0.5), 1.0));
        assert!(near(gain.at(1.0), 0.0));
        assert!(near(gain.at(1.05), 0.25));
        assert!(near(gain.at(1.1), 0.5));
        assert!(near(gain.at(1.2), 0.25 + 0.25 * (-1.0f64).exp()));
        let at_release = 0.25 + 0.25 * (-9.0f64).exp();
        assert!(near(gain.at(2.05), 0.0001 + (at_release - 0.0001) * (-1.0f64).exp()));
    }

    #[test]
    fn an_exponential_ramp_runs_from_the_last_value() {
        let mut gain = Param::new(0.0).set(1.0, 0.0).exponential(0.01, 2.0);
        assert!(near(gain.at(1.0), 0.1));
        assert!(near(gain.at(3.0), 0.01));
    }
}
