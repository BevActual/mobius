//! Music's demo ask, worked out in code: a bass line from the song's own chords, and a warmer pad. The model only
//! calls the tool; when it wrote the bass itself it was in key four runs in five, and with longer wording it stopped
//! writing the bass at all.

use serde_json::{Value, json};

pub const NAME: &str = "studio.bass_and_pad";

pub fn tool_descriptions() -> Vec<Value> {
    vec![json!({ "name": NAME, "capability": "files.write", "resource_arg": "path",
        "description": "In a Music song, add a bass line that follows the song's chords (the chord's own root on each bar line, a fifth, and a passing note into the next bar, all in the song's key) and make the pad warmer, in one change the person can keep or undo. Gives back `line`, what was done, to say.",
        "input_schema": { "type": "object", "properties": { "path": { "type": "string", "description": "The song file, such as studio/Songs/Demo.json." } }, "required": ["path"] } })]
}

pub fn is_bass_tool(name: &str) -> bool {
    name == NAME
}

const NAMES: [&str; 12] = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLATS: [&str; 12] = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

/// The song's key as its tonic's pitch class and its scale (major or minor), from "A minor" or "F# major".
fn key_of(song: &Value) -> (u8, [u8; 7]) {
    let key = song["key"].as_str().unwrap_or("C major");
    let mut parts = key.split_whitespace();
    let tonic = parts.next().unwrap_or("C");
    let pc = NAMES.iter().position(|n| n.eq_ignore_ascii_case(tonic)).or_else(|| FLATS.iter().position(|n| n.eq_ignore_ascii_case(tonic))).unwrap_or(0) as u8;
    let minor = parts.next().is_some_and(|m| m.to_lowercase().starts_with("min"));
    let steps: [u8; 7] = if minor { [0, 2, 3, 5, 7, 8, 10] } else { [0, 2, 4, 5, 7, 9, 11] };
    (pc, steps.map(|s| (pc + s) % 12))
}

/// The root of the chord sounding at `beat`: the note whose third and fifth are also there, or else the lowest note.
fn root_at(notes: &[(u8, f64, f64)], beat: f64) -> Option<u8> {
    let sounding: Vec<u8> = notes.iter().filter(|(_, s, l)| *s <= beat + 1e-6 && beat < s + l - 1e-6).map(|(p, _, _)| *p).collect();
    let lowest = *sounding.iter().min()?;
    let pcs: Vec<u8> = sounding.iter().map(|p| p % 12).collect();
    let has = |pc: u8| pcs.contains(&(pc % 12));
    let root = sounding.iter().map(|p| p % 12).find(|r| (has(r + 3) || has(r + 4)) && has(r + 7)).or_else(|| sounding.iter().map(|p| p % 12).find(|r| has(r + 3) || has(r + 4))).unwrap_or(lowest % 12);
    Some(root)
}

/// A pitch class in the bass range, MIDI 33 to 44 (A1 to G#2), so the line sits low and moves little.
fn low(pc: u8) -> u8 {
    let mut p = 24 + pc;
    while p < 33 {
        p += 12;
    }
    p
}

/// The bass line and the warmer pad, as the new song, or why it can't be done.
pub fn bass_and_pad(song: &Value) -> Result<(Value, String), String> {
    let tracks = song["tracks"].as_array().ok_or("that is not a song")?;
    if tracks.iter().any(|t| t["instrument"] == "bass") {
        return Err("the song already has a bass track".into());
    }
    let beats_per_bar = song["metre"].as_str().and_then(|m| m.split('/').next()?.parse::<f64>().ok()).unwrap_or(4.0);
    // The chords: the track with the most notes sounding together, drums and bass aside.
    let chords = tracks
        .iter()
        .filter(|t| !matches!(t["instrument"].as_str(), Some("drums" | "bass")))
        .max_by_key(|t| {
            let notes = t["notes"].as_array().map(Vec::len).unwrap_or(0);
            (u8::from(t["instrument"] != "pad"), notes)
        })
        .ok_or("the song has no chords to follow")?;
    let notes: Vec<(u8, f64, f64)> = chords["notes"].as_array().into_iter().flatten().filter_map(|n| Some((n["pitch"].as_u64()? as u8, n["start"].as_f64()?, n["length"].as_f64().unwrap_or(1.0)))).collect();
    let end = notes.iter().map(|(_, s, l)| s + l).fold(0.0, f64::max);
    let bars = song["bars"].as_u64().map(|b| b as f64).unwrap_or((end / beats_per_bar).ceil()).max(1.0) as usize;
    let (_, scale) = key_of(song);
    let roots: Vec<u8> = (0..bars).map(|b| root_at(&notes, b as f64 * beats_per_bar).unwrap_or(scale[0])).collect();

    let mut bass = Vec::new();
    for (b, &root) in roots.iter().enumerate() {
        let at = b as f64 * beats_per_bar;
        let fifth = (root + 7) % 12;
        let fifth = if scale.contains(&fifth) { fifth } else { root };
        // Into the next bar's root from the scale step just below it.
        let next = roots.get(b + 1).copied().unwrap_or(roots[0]);
        let below = scale.iter().position(|pc| *pc == next).map_or(root, |i| scale[(i + 6) % 7]);
        let note = |pitch: u8, start: f64, length: f64, velocity: f64| json!({ "pitch": pitch, "start": start, "length": length, "velocity": velocity });
        bass.push(note(low(root), at, 2.0_f64.min(beats_per_bar), 0.9));
        if beats_per_bar >= 4.0 {
            bass.push(note(low(fifth), at + 2.0, 1.0, 0.75));
            bass.push(note(low(below), at + beats_per_bar - 1.0, 1.0, 0.7));
        }
    }
    let used: Vec<&str> = tracks.iter().filter_map(|t| t["color"].as_str()).collect();
    let color = ["indigo", "rose", "violet", "blue", "orange", "lime"].into_iter().find(|c| !used.contains(c)).unwrap_or("indigo");
    let mut id = tracks.len() + 1;
    while tracks.iter().any(|t| t["id"] == format!("t{id}")) {
        id += 1;
    }
    let mut new = song.clone();
    let mut warmed = false;
    if let Some(list) = new["tracks"].as_array_mut() {
        for t in list.iter_mut() {
            if t["instrument"] != "pad" {
                continue;
            }
            if let Some(sound) = t.get_mut("sound").and_then(Value::as_object_mut) {
                let before = sound.clone();
                let num = |k: &str| before.get(k).and_then(Value::as_f64);
                if let Some(c) = num("cutoff") {
                    sound.insert("cutoff".into(), json!((c * 0.45 / 10.0).round() * 10.0));
                }
                if let Some(r) = num("resonance") {
                    sound.insert("resonance".into(), json!(((r * 0.75) * 100.0).round() / 100.0));
                }
                if let Some(s) = num("shape") {
                    sound.insert("shape".into(), json!((s * 0.6 * 100.0).round() / 100.0));
                }
                let d = num("drive").unwrap_or(0.0);
                sound.insert("drive".into(), json!(((d + 0.1).min(1.0) * 100.0).round() / 100.0));
                warmed = true;
            }
        }
        list.push(json!({ "id": format!("t{id}"), "name": "Bass", "instrument": "bass", "color": color, "volume": 0.8, "notes": bass }));
    }
    let names: Vec<&str> = roots.iter().map(|r| FLATS_OR_SHARPS(*r, &scale)).collect();
    let line = format!(
        "Added a bass line on each bar's chord root ({}), with a fifth and a step into the next bar{}.",
        names.join(", "),
        if warmed { ", and warmed the pad: filter down by half, less resonance, a softer shape and a touch of drive" } else { "" }
    );
    Ok((new, line))
}

/// A pitch class's name as the key spells it: flats in a key that has them.
#[allow(non_snake_case)]
fn FLATS_OR_SHARPS(pc: u8, scale: &[u8; 7]) -> &'static str {
    let flat_key = scale.iter().any(|p| FLATS[*p as usize].ends_with('b')) && !scale.iter().any(|p| NAMES[*p as usize].ends_with('#') && !FLATS[*p as usize].ends_with('b'));
    if flat_key { FLATS[pc as usize] } else { NAMES[pc as usize] }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn demo() -> Value {
        serde_json::from_str(&std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../../demo/workspace/studio/Songs/Demo.json")).unwrap()).unwrap()
    }

    #[test]
    fn the_demo_song_gets_a_bass_in_key_on_its_chord_roots_and_a_warmer_pad() {
        let song = demo();
        let (new, line) = bass_and_pad(&song).unwrap();
        let tracks = new["tracks"].as_array().unwrap();
        let bass = tracks.iter().find(|t| t["instrument"] == "bass").unwrap();
        let (_, scale) = key_of(&song);
        let notes = bass["notes"].as_array().unwrap();
        assert_eq!(notes.len(), 4 * 3);
        for n in notes {
            let p = n["pitch"].as_u64().unwrap() as u8;
            assert!((33..=52).contains(&p), "{p}");
            assert!(scale.contains(&(p % 12)), "{p} is out of key");
        }
        // Each bar's first note is the root of the chord sounding on its bar line.
        let chords: Vec<(u8, f64, f64)> = tracks[1]["notes"].as_array().unwrap().iter().map(|n| (n["pitch"].as_u64().unwrap() as u8, n["start"].as_f64().unwrap(), n["length"].as_f64().unwrap())).collect();
        for b in 0..4 {
            let first = notes.iter().find(|n| n["start"].as_f64() == Some(b as f64 * 4.0)).unwrap();
            assert_eq!(first["pitch"].as_u64().unwrap() as u8 % 12, root_at(&chords, b as f64 * 4.0).unwrap());
        }
        assert_eq!(root_at(&chords, 0.0), Some(9), "A minor's first chord is on A");
        let pad = tracks.iter().find(|t| t["instrument"] == "pad").unwrap();
        assert_eq!(pad["sound"]["cutoff"], 1890.0);
        assert_eq!(pad["sound"]["shape"], 0.6);
        assert!(line.starts_with("Added a bass line on each bar's chord root (A, "), "{line}");
        assert!(bass_and_pad(&new).is_err(), "never a second bass");
    }

    #[test]
    fn a_chord_whose_lowest_note_is_not_its_root_still_gets_its_root() {
        // C major in first inversion: E lowest, then G and C.
        let notes = [(52, 0.0, 4.0), (55, 0.0, 4.0), (60, 0.0, 4.0)];
        assert_eq!(root_at(&notes, 0.0), Some(0));
    }
}
