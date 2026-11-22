//! MIDI keyboards in: each one the computer has, and the notes of the one listened to, played on the armed track.
//!
//! A note comes in on the MIDI driver's own thread. There it is made into a voice (or a drum hit) and handed to the
//! audio thread with the moment it arrived, so the audio thread only places it: see [`crate::engine::Engine::listen`].
//! On Windows through its MIDI driver (WinMM) and on macOS through Core MIDI; elsewhere there are no keyboards yet.

/// What a MIDI message asks for: a key pressed (pitch, velocity 0 to 1) or lifted. Anything else is not a note.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Message {
    Press(u8, f64),
    Lift(u8),
}

/// Reads a MIDI message on any channel. A note on at velocity 0 is a note off, as keyboards send them.
#[must_use]
pub fn message(bytes: &[u8]) -> Option<Message> {
    let (status, pitch, velocity) = match bytes {
        [s, p, v, ..] => (s & 0xF0, *p & 0x7F, *v & 0x7F),
        _ => return None,
    };
    match status {
        0x90 if velocity > 0 => Some(Message::Press(pitch, f64::from(velocity) / 127.0)),
        0x80 | 0x90 => Some(Message::Lift(pitch)),
        _ => None,
    }
}

/// Plays what a keyboard sent, arriving `at`, through `keys`.
#[cfg_attr(not(any(windows, target_os = "macos")), allow(dead_code))]
fn play(keys: &crate::engine::Keys, bytes: &[u8], at: std::time::Instant) {
    // A note the engine has no room for is dropped: the next one has room again.
    let _ = match message(bytes) {
        Some(Message::Press(pitch, velocity)) => keys.press(pitch, velocity, at),
        Some(Message::Lift(pitch)) => keys.lift(pitch, at),
        None => Ok(()),
    };
}

pub use device::{inputs, Input};

#[cfg(any(windows, target_os = "macos"))]
mod device {
    use crate::engine::Keys;

    /// The name of each MIDI keyboard (input) the computer has.
    #[must_use]
    pub fn inputs() -> Vec<String> {
        let Ok(midi) = midir::MidiInput::new("Mobius") else { return Vec::new() };
        midi.ports().iter().filter_map(|p| midi.port_name(p).ok()).collect()
    }

    /// A keyboard being listened to, until this is dropped.
    pub struct Input {
        name: String,
        _connection: midir::MidiInputConnection<()>,
    }

    impl Input {
        pub(crate) fn open(name: &str, keys: Keys) -> Result<Input, String> {
            let mut midi = midir::MidiInput::new("Mobius").map_err(|e| format!("MIDI could not start: {e}"))?;
            midi.ignore(midir::Ignore::All);
            let port = midi.ports().into_iter().find(|p| midi.port_name(p).is_ok_and(|n| n == name)).ok_or_else(|| format!("No MIDI keyboard called \"{name}\"."))?;
            let connection = midi
                .connect(&port, "mobius-midi-in", move |_, bytes, ()| super::play(&keys, bytes, std::time::Instant::now()), ())
                .map_err(|e| format!("{name} could not be opened: {e}"))?;
            Ok(Input { name: name.to_owned(), _connection: connection })
        }

        #[must_use]
        pub fn name(&self) -> &str {
            &self.name
        }
    }
}

#[cfg(not(any(windows, target_os = "macos")))]
mod device {
    use crate::engine::Keys;

    /// No keyboards here yet.
    #[must_use]
    pub fn inputs() -> Vec<String> {
        Vec::new()
    }

    pub struct Input {
        name: String,
    }

    impl Input {
        pub(crate) fn open(name: &str, _keys: Keys) -> Result<Input, String> {
            Err(format!("MIDI keyboards are heard on Windows and macOS only for now ({name})."))
        }

        #[must_use]
        pub fn name(&self) -> &str {
            &self.name
        }
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use crate::engine::Engine;
    use crate::song::Song;
    use std::time::{Duration, Instant};

    #[test]
    fn notes_on_and_off_are_read_on_any_channel_and_velocity_0_lifts() {
        assert_eq!(message(&[0x90, 60, 127]), Some(Message::Press(60, 1.0)));
        assert_eq!(message(&[0x9F, 61, 0]), Some(Message::Lift(61)));
        assert_eq!(message(&[0x83, 62, 40]), Some(Message::Lift(62)));
        assert_eq!(message(&[0xB0, 64, 127]), None);
        assert_eq!(message(&[0x90, 60]), None);
    }

    /// Where a run of samples first gets louder than `level`.
    fn onset(samples: &[f32], level: f32) -> Option<usize> {
        samples.iter().position(|s| s.abs() > level)
    }

    #[test]
    fn played_notes_from_a_keyboard_land_a_block_late_to_the_sample_and_release_when_lifted() {
        let (engine, mut audio) = Engine::pair(48_000, "test".into());
        let song = Song::parse(r#"{"version":2,"tempo":120,"bars":1,"tracks":[{"id":"k","instrument":"bass","sound":{"shape":0,"detune":0,"sub":0,"drive":0,"cutoff":12000,"resonance":0,"envAmount":0,"attack":0.001,"decay":0.3,"sustain":1,"release":0.2,"vibrato":0,"rate":5}}]}"#).unwrap();
        engine.arm(Some(&song.tracks[0]), &song.sounds);
        let keys = engine.keys();
        // Blocks of 10 ms, as a sound output asks for them; a note on comes 3 ms before the first, on channel 2.
        let start = Instant::now() + Duration::from_secs(1);
        let block = |i: u64| start + Duration::from_millis(10 * i);
        play(&keys, &[0x91, 69, 127], block(0) - Duration::from_millis(3));
        let mut left = Vec::new();
        let mut buffer = vec![0f32; 480 * 2];
        let mut run = |audio: &mut crate::engine::AudioSide, from: u64, to: u64, left: &mut Vec<f32>| {
            for i in from..to {
                audio.fill_at(&mut buffer, 2, block(i));
                left.extend(buffer.iter().step_by(2));
            }
        };
        run(&mut audio, 0, 50, &mut left);
        // One block late: 7 ms into the first.
        let on = onset(&left, 1e-6).unwrap();
        assert!((334..=338).contains(&on), "{on}");
        // Held at full level until the key is lifted, half a second on, by a note on at velocity 0 halfway into a block.
        let held = left[19_200..24_000].iter().fold(0f32, |m, s| m.max(s.abs()));
        assert!(held > 0.3, "{held}");
        play(&keys, &[0x91, 69, 0], block(50) - Duration::from_millis(5));
        run(&mut audio, 50, 100, &mut left);
        // It falls from the lift (5 ms into the block after), by e each quarter release, and is silent after it.
        let lift = 24_000 + 240;
        let level = |at: usize| left[at..at + 200].iter().fold(0f32, |m, s| m.max(s.abs()));
        assert!(level(lift - 400) > 0.3);
        let quarter = level(lift + 2_400);
        assert!((f64::from(quarter) - 0.35 / std::f64::consts::E).abs() < 0.04, "{quarter}");
        assert!(left[lift + 12_200..].iter().all(|s| *s == 0.0));
        // A second key, pressed and lifted inside one block, still sounds for that sliver and then rings out.
        play(&keys, &[0x90, 60, 100], block(100) - Duration::from_millis(9));
        play(&keys, &[0x80, 60, 0], block(100) - Duration::from_millis(8));
        let before = left.len();
        run(&mut audio, 100, 150, &mut left);
        let on = onset(&left[before..], 1e-6).unwrap();
        assert!((47..=49).contains(&on), "{on}");
        assert!(left[before + 14_400..].iter().all(|s| *s == 0.0));
    }
}
