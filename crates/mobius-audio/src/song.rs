//! The part of `song.json` the engine plays: the song file, version 2 (docs/reference/music-parity.md, "The song file,
//! version 2"; apps/desktop/src/song-format.ts is the full format). Anything it does not know yet is left alone, so a
//! newer file still loads. A version 1 track's one list of `notes` is played as one clip over the whole song.

use serde::Deserialize;

/// Beats in a bar: Music is in 4/4 for now.
pub const BEATS_PER_BAR: f64 = 4.0;
/// The most notes a track plays (as the window keeps to).
const MAX_NOTES: usize = 20_000;

#[derive(Debug, Clone, Deserialize)]
pub struct Song {
    pub tempo: f64,
    pub bars: u32,
    #[serde(default)]
    pub tracks: Vec<Track>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Instrument {
    Piano,
    Bass,
    Pad,
    Lead,
    Drums,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub id: String,
    pub instrument: Instrument,
    #[serde(default = "one")]
    pub volume: f64,
    #[serde(default)]
    pub pan: f64,
    #[serde(default)]
    pub muted: bool,
    #[serde(default)]
    pub solo: bool,
    /// False when the instrument is switched off: its notes are not played.
    #[serde(default)]
    pub instrument_on: Option<bool>,
    /// Arrange's clips, in song beats.
    #[serde(default)]
    pub clips: Vec<Clip>,
    /// Version 1: every note of the track, in song beats.
    #[serde(default)]
    pub notes: Vec<Note>,
    #[serde(default)]
    pub sound: Option<Sound>,
    /// A drums track's kit, and each drum's own settings by its pitch (`"36"` and so on).
    #[serde(default)]
    pub kit: Option<Kit>,
    #[serde(default)]
    pub pads: std::collections::BTreeMap<String, Pad>,
    /// How its volume moves along the song (beats from 0, values 0 to 1); none keeps `volume`.
    #[serde(default)]
    pub volume_auto: Vec<AutoPoint>,
    /// Its effects in order, as the file has them (read by [`crate::fx::Chain`]).
    #[serde(default)]
    pub fx: Vec<serde_json::Value>,
}

/// A drums track's kit (song-format.ts `KitSound`): tune in semitones, decay as a multiple, tone from dark to bright.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
pub struct Kit {
    pub tune: f64,
    pub decay: f64,
    pub tone: f64,
}

impl Default for Kit {
    fn default() -> Kit {
        Kit { tune: 0.0, decay: 1.0, tone: 0.5 }
    }
}

/// One drum's own settings on top of the kit (song-format.ts `DrumPad`).
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
pub struct Pad {
    pub tune: f64,
    pub decay: f64,
    pub level: f64,
    pub pan: f64,
}

impl Default for Pad {
    fn default() -> Pad {
        Pad { tune: 0.0, decay: 1.0, level: 1.0, pan: 0.0 }
    }
}

/// A point on an automation line: the value at a beat, with straight lines between points.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
pub struct AutoPoint {
    pub beat: f64,
    pub value: f64,
}

/// The value of an automation line at a beat (song-format.ts `autoValueAt`): flat before the first point and after
/// the last, straight between. `points` are in beat order.
#[must_use]
pub fn auto_value_at(points: &[AutoPoint], beat: f64, empty: f64) -> f64 {
    let (Some(first), Some(last)) = (points.first(), points.last()) else {
        return empty;
    };
    if beat <= first.beat {
        return first.value;
    }
    for pair in points.windows(2) {
        let (a, b) = (pair[0], pair[1]);
        if beat <= b.beat {
            return if b.beat == a.beat { b.value } else { a.value + (beat - a.beat) / (b.beat - a.beat) * (b.value - a.value) };
        }
    }
    last.value
}

/// A clip in Arrange: `length` song beats from `start`, playing its own notes from `offset`, going round `loop` if it
/// has one.
#[derive(Debug, Clone, Deserialize)]
pub struct Clip {
    pub start: f64,
    pub length: f64,
    #[serde(default)]
    pub muted: bool,
    #[serde(default, rename = "loop")]
    pub cycle: Option<Span>,
    #[serde(default)]
    pub offset: f64,
    #[serde(default)]
    pub notes: Vec<Note>,
}

#[derive(Debug, Clone, Copy, Deserialize)]
pub struct Span {
    pub start: f64,
    pub end: f64,
}

const fn one() -> f64 {
    1.0
}

/// A note, in beats from the song's start.
#[derive(Debug, Clone, Copy, Deserialize)]
pub struct Note {
    pub pitch: u8,
    pub start: f64,
    pub length: f64,
    pub velocity: f64,
}

/// A track's own sound (song-format.ts `Sound`): oscillator, filter, envelope and vibrato.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Sound {
    pub shape: f64,
    pub detune: f64,
    pub sub: f64,
    pub drive: f64,
    pub cutoff: f64,
    pub resonance: f64,
    pub env_amount: f64,
    pub attack: f64,
    pub decay: f64,
    pub sustain: f64,
    pub release: f64,
    pub vibrato: f64,
    pub rate: f64,
}

impl Sound {
    /// What each instrument starts as (song-format.ts `SOUND_DEFAULTS`). Drums have a kit instead.
    #[must_use]
    pub fn default_for(instrument: Instrument) -> Option<Sound> {
        let s = |shape, detune, cutoff, resonance, decay, sustain, attack, release| Sound { shape, detune, sub: 0.0, drive: 0.0, cutoff, resonance, env_amount: 0.0, attack, decay, sustain, release, vibrato: 0.0, rate: 5.0 };
        match instrument {
            Instrument::Piano => Some(s(0.2, 0.0, 5000.0, 0.0, 0.8, 0.3, 0.005, 0.3)),
            Instrument::Bass => Some(s(1.0, 0.0, 700.0, 0.1, 0.3, 1.0, 0.005, 0.08)),
            Instrument::Pad => Some(s(1.0, 14.0, 1800.0, 0.1, 0.3, 1.0, 0.25, 0.5)),
            Instrument::Lead => Some(s(0.7, 0.0, 5000.0, 0.1, 0.3, 1.0, 0.005, 0.08)),
            Instrument::Drums => None,
        }
    }
}

impl Song {
    /// Reads a song from its JSON text.
    ///
    /// # Errors
    /// When the text is not a song.
    pub fn parse(text: &str) -> Result<Song, String> {
        let song: Song = serde_json::from_str(text).map_err(|e| format!("That is not a song Music can play: {e}"))?;
        if !(song.tempo.is_finite() && (20.0..=400.0).contains(&song.tempo)) {
            return Err("The song's tempo is out of range.".to_owned());
        }
        Ok(song)
    }

    /// The tracks heard: the soloed ones if any are, else every one not muted (song-format.ts `audible`).
    pub fn audible(&self) -> impl Iterator<Item = &Track> {
        let solo = self.tracks.iter().any(|t| t.solo);
        self.tracks.iter().filter(move |t| if solo { t.solo } else { !t.muted })
    }

    /// Every note a track plays, in song beats and in time order: its clips laid out (cut at a clip's end, and going
    /// round a clip's loop), or a version 1 track's notes as they are.
    #[must_use]
    pub fn notes_of(track: &Track) -> Vec<Note> {
        let mut out: Vec<Note> = track.notes.iter().filter(|n| n.length > 0.0).copied().collect();
        for clip in track.clips.iter().filter(|c| !c.muted && c.length > 0.0) {
            let (from, to) = match clip.cycle {
                Some(c) if c.end > c.start => (c.start, c.end),
                _ => (f64::NEG_INFINITY, f64::INFINITY),
            };
            let looped = from.is_finite();
            // The clip's own time at its start, and each pass through it (one without a loop).
            let mut own = clip.offset;
            let mut played = 0.0;
            while played < clip.length && out.len() < MAX_NOTES {
                let pass_end = if looped { to } else { f64::INFINITY };
                let span = (pass_end - own).min(clip.length - played);
                for n in &clip.notes {
                    if n.start < own - 1e-9 || n.start >= own + span - 1e-9 || n.length <= 0.0 {
                        continue;
                    }
                    let at = clip.start + played + (n.start - own);
                    let length = n.length.min(clip.start + played + span - at);
                    out.push(Note { start: at, length, ..*n });
                }
                played += span;
                own = if looped { from } else { own + span };
                if !looped || span <= 1e-9 {
                    break;
                }
            }
        }
        out.truncate(MAX_NOTES);
        out.sort_by(|a, b| a.start.total_cmp(&b.start));
        out
    }

    /// The song's length in beats.
    #[must_use]
    pub fn beats(&self) -> f64 {
        f64::from(self.bars) * BEATS_PER_BAR
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn a_song_from_the_window_loads_and_keeps_only_what_is_heard() {
        let song = Song::parse(r#"{"version":1,"tempo":120,"key":"C major","bars":2,"scenes":["A"],"tracks":[
            {"id":"t1","name":"Keys","instrument":"piano","volume":0.8,"pan":0,"muted":false,"solo":false,"color":"blue","notes":[{"pitch":60,"start":0,"length":1,"velocity":0.8}],"fx":[]},
            {"id":"t2","name":"Bass","instrument":"bass","volume":0.7,"pan":-0.2,"muted":true,"solo":false,"color":"amber","notes":[]}]}"#)
        .unwrap();
        assert_eq!(song.beats(), 8.0);
        assert_eq!(song.audible().map(|t| t.id.as_str()).collect::<Vec<_>>(), ["t1"]);
        assert!(Song::parse(r#"{"tempo":0,"bars":1}"#).is_err());
    }

    #[test]
    fn clips_lay_their_notes_out_in_song_time_going_round_their_loops() {
        let song = Song::parse(r#"{"version":2,"tempo":120,"bars":4,"tracks":[{"id":"t1","instrument":"bass","clips":[
            {"id":"c1","start":4,"length":5,"loop":{"start":0,"end":2},"notes":[{"pitch":40,"start":0,"length":1,"velocity":1},{"pitch":43,"start":1.5,"length":1,"velocity":1}]},
            {"id":"c2","start":10,"length":2,"offset":1,"notes":[{"pitch":50,"start":0,"length":1,"velocity":1},{"pitch":52,"start":2,"length":4,"velocity":1}]},
            {"id":"c3","start":12,"length":2,"muted":true,"notes":[{"pitch":60,"start":0,"length":1,"velocity":1}]}]}]}"#).unwrap();
        let notes: Vec<(u8, f64, f64)> = Song::notes_of(&song.tracks[0]).iter().map(|n| (n.pitch, n.start, n.length)).collect();
        // c1 goes round its two beats: 40 at 4, 6, 8; 43 at 5.5 and 7.5 cut to the loop's end. c2 starts a beat in, so
        // 50 is left out and 52 plays at 11, cut at the clip's end. c3 is muted.
        assert_eq!(notes, [(40, 4.0, 1.0), (43, 5.5, 0.5), (40, 6.0, 1.0), (43, 7.5, 0.5), (40, 8.0, 1.0), (52, 11.0, 1.0)]);
    }
}
