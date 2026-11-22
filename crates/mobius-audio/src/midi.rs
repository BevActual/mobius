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
mod tests {
    use super::*;

    #[test]
    fn notes_on_and_off_are_read_on_any_channel_and_velocity_0_lifts() {
        assert_eq!(message(&[0x90, 60, 127]), Some(Message::Press(60, 1.0)));
        assert_eq!(message(&[0x9F, 61, 0]), Some(Message::Lift(61)));
        assert_eq!(message(&[0x83, 62, 40]), Some(Message::Lift(62)));
        assert_eq!(message(&[0xB0, 64, 127]), None);
        assert_eq!(message(&[0x90, 60]), None);
    }
}
