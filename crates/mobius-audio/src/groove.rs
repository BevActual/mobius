//! Grooves (Live 12 manual, 14 "Using Grooves"): a clip that names a groove in the song's Groove Pool plays its notes
//! moved toward the groove's timing and velocity, as the clip's own notes stay where they are written. The same moves
//! are in studio-groove.ts, where Commit writes them into the clip (14.1.2).
use serde::Deserialize;

use crate::song::{Note, Song};

/// One note of a groove: where it falls in the groove's own beats, and how loud.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
pub struct Hit {
    pub at: f64,
    #[serde(default = "full")]
    pub velocity: f64,
}

/// A groove in the Groove Pool, with its parameters (14.1.1).
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(default)]
pub struct Groove {
    pub id: String,
    pub name: String,
    /// Base: the grid, in beats, each groove note is measured against (a quarter is 1, an eighth 0.5).
    pub base: f64,
    /// Quantize: how far notes snap to the Base grid before the groove moves them, 0 to 1.
    pub quantize: f64,
    /// Timing: how far toward the groove's notes they move, 0 to 1.
    pub timing: f64,
    /// Random: how much each note is pushed off its place, 0 to 1 (at most a quarter of Base either way).
    pub random: f64,
    /// Velocity: how much the groove's loud and quiet notes reach the clip's, -1 to 1; below 0 turns them round.
    pub velocity: f64,
    /// How many beats the groove goes round in.
    pub length: f64,
    pub hits: Vec<Hit>,
}

impl Default for Groove {
    fn default() -> Groove {
        Groove { id: String::new(), name: String::new(), base: 0.25, quantize: 0.0, timing: 1.0, random: 0.0, velocity: 0.0, length: 4.0, hits: Vec::new() }
    }
}

const fn full() -> f64 {
    1.0
}

/// The most grooves a song keeps, and the most notes one holds.
pub const MAX_GROOVES: usize = 64;
pub const MAX_HITS: usize = 512;

/// Global Amount's top (14.1.1: "up to 130%").
pub const MAX_AMOUNT: f64 = 1.3;

impl Groove {
    /// The groove's offset and velocity at a grid point `g` (in the groove's own beats): its note nearest the point,
    /// within half of Base; none when no note is that near.
    fn at(&self, g: f64) -> Option<(f64, f64)> {
        let length = self.length;
        let p = g.rem_euclid(length);
        let half = self.base * 0.5;
        self.hits
            .iter()
            .take(MAX_HITS)
            .filter(|h| h.at.is_finite())
            .map(|h| {
                // The way round the groove's loop that is nearest.
                let mut d = (h.at - p).rem_euclid(length);
                if d > length * 0.5 {
                    d -= length;
                }
                (d, h.velocity)
            })
            .filter(|(d, _)| d.abs() < half - 1e-9)
            .min_by(|a, b| a.0.abs().total_cmp(&b.0.abs()))
    }

    /// The groove's notes' mean velocity, which Velocity measures loud and quiet against.
    fn mean(&self) -> f64 {
        let hits = &self.hits[..self.hits.len().min(MAX_HITS)];
        if hits.is_empty() { 1.0 } else { hits.iter().map(|h| h.velocity).sum::<f64>() / hits.len() as f64 }
    }

    /// Whether it can move anything.
    fn usable(&self) -> bool {
        self.base.is_finite() && self.base > 1e-6 && self.length.is_finite() && self.length > 1e-6
    }

    /// The notes as they play with this groove at Global Amount `amount`, in the clip's own beats.
    #[must_use]
    pub fn apply(&self, notes: &[Note], amount: f64) -> Vec<Note> {
        if !self.usable() {
            return notes.to_vec();
        }
        let amount = if amount.is_finite() { amount.clamp(0.0, MAX_AMOUNT) } else { 1.0 };
        let quantize = self.quantize.clamp(0.0, 1.0);
        let timing = self.timing.clamp(0.0, 1.0) * amount;
        let random = self.random.clamp(0.0, 1.0) * amount;
        let velocity = self.velocity.clamp(-1.0, 1.0) * amount;
        let mean = self.mean();
        notes
            .iter()
            .map(|n| {
                let g = (n.start / self.base).round() * self.base;
                let mut start = n.start + (g - n.start) * quantize;
                let mut vel = n.velocity;
                if let Some((d, v)) = self.at(g) {
                    start += d * timing;
                    vel += velocity * (v - mean);
                }
                if random > 0.0 {
                    start += (roll(n.pitch, n.start) * 2.0 - 1.0) * random * self.base * 0.25;
                }
                Note { start: start.max(0.0), velocity: vel.clamp(0.0, 1.0), ..*n }
            })
            .collect()
    }
}

/// A roll from 0 to 1 for a note, the same each time (studio-groove.ts `roll`).
#[must_use]
pub fn roll(pitch: u8, start: f64) -> f64 {
    let mut x = u64::from(pitch).wrapping_mul(0x9E37_79B9_7F4A_7C15) ^ ((start * 960.0).round() as i64 as u64).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    x ^= x >> 30;
    x = x.wrapping_mul(0xBF58_476D_1CE4_E5B9);
    x ^= x >> 27;
    x = x.wrapping_mul(0x94D0_49BB_1331_11EB);
    x ^= x >> 31;
    // The top 24 bits, so studio-groove.ts can give the same roll with its doubles.
    (x >> 40) as f64 / f64::from(1u32 << 24)
}

impl Song {
    /// The groove with this id in the Groove Pool, if it is there.
    #[must_use]
    pub fn groove(&self, id: Option<&str>) -> Option<&Groove> {
        let id = id?;
        self.grooves.iter().take(MAX_GROOVES).find(|g| g.id == id)
    }

    /// Plays every clip that names a groove with its notes grooved (14: grooves are applied while the clip plays, and
    /// its notes as written stay as they are in the song file).
    pub fn apply_grooves(&mut self) {
        if self.grooves.is_empty() {
            return;
        }
        let amount = self.groove_amount;
        let grooves = std::mem::take(&mut self.grooves);
        let find = |id: &Option<String>| id.as_deref().and_then(|id| grooves.iter().take(MAX_GROOVES).find(|g| g.id == id));
        for track in &mut self.tracks {
            for clip in &mut track.clips {
                if let Some(g) = find(&clip.groove) {
                    clip.notes = g.apply(&clip.notes, amount);
                }
            }
            for slot in track.slots.iter_mut().flatten() {
                if let Some(g) = find(&slot.groove) {
                    slot.notes = g.apply(&slot.notes, amount);
                }
            }
        }
        self.grooves = grooves;
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    fn note(start: f64, velocity: f64) -> Note {
        Note { pitch: 60, start, length: 0.25, velocity, chance: 1.0, repeat: 0, from: None }
    }

    /// An eighth-note swing at 2:1: every second eighth a third of an eighth late, and quieter.
    fn swing() -> Groove {
        Groove { id: "s".into(), name: "Swing".into(), base: 0.5, length: 1.0, hits: vec![Hit { at: 0.0, velocity: 1.0 }, Hit { at: 2.0 / 3.0, velocity: 0.6 }], ..Groove::default() }
    }

    #[test]
    fn moves_notes_toward_the_groove_and_leaves_its_grid_notes() {
        let g = swing();
        let out = g.apply(&[note(0.0, 0.8), note(0.5, 0.8), note(1.5, 0.8)], 1.0);
        assert!((out[0].start - 0.0).abs() < 1e-9);
        assert!((out[1].start - 2.0 / 3.0).abs() < 1e-9);
        assert!((out[2].start - (1.0 + 2.0 / 3.0)).abs() < 1e-9);
        // Half the timing, half the way.
        let half = Groove { timing: 0.5, ..swing() };
        assert!((half.apply(&[note(0.5, 0.8)], 1.0)[0].start - (0.5 + 1.0 / 12.0)).abs() < 1e-9);
        // Global Amount scales it, up to 130%.
        assert!((g.apply(&[note(0.5, 0.8)], 2.0)[0].start - (0.5 + 1.3 / 6.0)).abs() < 1e-9);
        assert!((g.apply(&[note(0.5, 0.8)], 0.0)[0].start - 0.5).abs() < 1e-9);
    }

    #[test]
    fn quantizes_first_and_follows_velocity_either_way() {
        let g = Groove { quantize: 1.0, timing: 0.0, ..swing() };
        assert!((g.apply(&[note(0.6, 0.8)], 1.0)[0].start - 0.5).abs() < 1e-9);
        let loud = Groove { velocity: 1.0, timing: 0.0, ..swing() };
        let out = loud.apply(&[note(0.0, 0.5), note(0.5, 0.5)], 1.0);
        assert!((out[0].velocity - 0.7).abs() < 1e-9 && (out[1].velocity - 0.3).abs() < 1e-9);
        let turned = Groove { velocity: -1.0, ..loud };
        let out = turned.apply(&[note(0.0, 0.5), note(0.5, 0.5)], 1.0);
        assert!((out[0].velocity - 0.3).abs() < 1e-9 && (out[1].velocity - 0.7).abs() < 1e-9);
    }

    #[test]
    fn random_pushes_each_note_its_own_way_the_same_each_time() {
        let g = Groove { random: 1.0, timing: 0.0, ..swing() };
        let notes: Vec<Note> = (0..16).map(|k| note(f64::from(k) * 0.5, 0.8)).collect();
        let a = g.apply(&notes, 1.0);
        assert_eq!(a.iter().map(|n| n.start.to_bits()).collect::<Vec<_>>(), g.apply(&notes, 1.0).iter().map(|n| n.start.to_bits()).collect::<Vec<_>>());
        assert!(a.iter().zip(&notes).all(|(x, n)| (x.start - n.start).abs() <= 0.125 + 1e-9));
        assert!(a.iter().zip(&notes).filter(|(x, n)| (x.start - n.start).abs() > 1e-6).count() > 8);
        assert!((0.0..1.0).contains(&roll(60, 0.5)));
    }

    #[test]
    fn roll_matches_studio_groove() {
        assert!((roll(60, 0.5) - 0.530_744_493_007_659_9).abs() < 1e-12);
        assert!((roll(36, 1.25) - 0.436_802_506_446_838_4).abs() < 1e-12);
    }

    #[test]
    fn a_song_plays_its_clips_grooved() {
        let mut song = Song::parse(r#"{"version":2,"tempo":120,"bars":1,"grooveAmount":1,
            "grooves":[{"id":"s","name":"Swing","base":0.5,"length":1,"hits":[{"at":0},{"at":0.6666666666666666,"velocity":0.6}]}],
            "tracks":[{"id":"t","instrument":"bass","clips":[{"start":0,"length":4,"groove":"s","notes":[{"pitch":45,"start":0.5,"length":0.25,"velocity":1}]}],
            "slots":[{"bars":1,"groove":"s","notes":[{"pitch":45,"start":1.5,"length":0.25,"velocity":1}]},{"bars":1,"groove":"gone","notes":[{"pitch":45,"start":1.5,"length":0.25,"velocity":1}]}]}]}"#)
        .unwrap();
        assert!((song.tracks[0].clips[0].notes[0].start - 2.0 / 3.0).abs() < 1e-9);
        assert!((song.tracks[0].slots[0].as_ref().unwrap().notes[0].start - (1.0 + 2.0 / 3.0)).abs() < 1e-9);
        assert!((song.tracks[0].slots[1].as_ref().unwrap().notes[0].start - 1.5).abs() < 1e-9);
        // Applying again does not move them twice: parse applies it once, and the engine plays what parse gave.
        assert!(song.groove(Some("s")).is_some() && song.groove(Some("gone")).is_none());
        song.grooves.clear();
        song.apply_grooves();
        assert!((song.tracks[0].clips[0].notes[0].start - 2.0 / 3.0).abs() < 1e-9);
    }
}
