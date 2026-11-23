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
    /// The Main track: where every track and return ends up, with its own effects and level.
    #[serde(default)]
    pub main: Main,
    /// The metronome's own level, apart from Main's (as Live's metronome volume is).
    #[serde(default)]
    pub metronome: Metronome,
    /// Return tracks, fed by the tracks' sends (at most [`MAX_RETURNS`]).
    #[serde(default)]
    pub returns: Vec<Return>,
    /// The sounds its audio clips, samplers and drum pads play, by the file they name: read from the song's folder by
    /// [`crate::sample::Samples::attach`], not from the song file.
    #[serde(skip)]
    pub sounds: Sounds,
}

/// Sounds read from a song's folder, by the file the song names.
pub type Sounds = std::collections::BTreeMap<String, std::sync::Arc<crate::wav::Sound>>;

/// The most return tracks a song has, as in Live; any past them are left out.
pub const MAX_RETURNS: usize = 12;

/// The Main track (Live's Master): its effects, then its level.
#[derive(Debug, Clone, Deserialize)]
pub struct Main {
    #[serde(default = "main_volume")]
    pub volume: f64,
    /// Its effects in order, as a track's are.
    #[serde(default)]
    pub fx: Vec<serde_json::Value>,
    /// Its automation and what of it is overridden, as a track's (`"volume"`).
    #[serde(default)]
    pub auto: std::collections::BTreeMap<String, Vec<AutoPoint>>,
    #[serde(default)]
    pub auto_off: Vec<String>,
}

impl Default for Main {
    fn default() -> Main {
        Main { volume: main_volume(), fx: Vec::new(), auto: std::collections::BTreeMap::new(), auto_off: Vec::new() }
    }
}

/// The metronome's settings in the song file.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
pub struct Metronome {
    /// 0 to 1; 0.8 unless the file says, as loud as the metronome has always played.
    #[serde(default = "main_volume")]
    pub volume: f64,
}

impl Default for Metronome {
    fn default() -> Metronome {
        Metronome { volume: main_volume() }
    }
}

/// The Main track's level when the file says none: 0.8, as Music has always mixed.
const fn main_volume() -> f64 {
    0.8
}

/// A return track: what the tracks send to it goes through its effects, then its volume and pan, into Main.
#[derive(Debug, Clone, Deserialize)]
pub struct Return {
    pub id: String,
    #[serde(default = "one")]
    pub volume: f64,
    #[serde(default)]
    pub pan: f64,
    #[serde(default)]
    pub muted: bool,
    #[serde(default)]
    pub fx: Vec<serde_json::Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Instrument {
    #[default]
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
    /// What the person calls it: a recording on it is named for it.
    #[serde(default)]
    pub name: Option<String>,
    /// What it plays: notes on an instrument (none in the file), `"audio"`, its clips' recorded sound (Live 12
    /// manual, chapter 9 "Audio Clips, Tempo, and Warping"), or `"sampler"`, notes on its `sampler`'s sound.
    #[serde(default)]
    pub kind: Option<String>,
    /// When frozen (Live 12 manual, 38.1.4 "Track Freeze"): the file its instrument, clips and effects were rendered
    /// to, played in their place from the song's start; its volume, pan and sends still apply.
    #[serde(default)]
    pub frozen: Option<Frozen>,
    /// A sampler track's sound (36.8 "Working with Samples").
    #[serde(default)]
    pub sampler: Option<crate::sampler::SamplerSound>,
    /// An audio track's input, by its place in the sound input's channels (chapter 19.1 "Choosing what to record").
    #[serde(default)]
    pub input: Option<u32>,
    /// An audio track has none; one from an older window is a piano.
    #[serde(default)]
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
    /// An instrument stack (Live 12's Instrument Rack): its chains play each note in their key and velocity zones in
    /// place of the track's own instrument. None, or no chain, plays the track's own.
    #[serde(default)]
    pub stack: Option<InstrumentStack>,
    /// A drums track's kit, and each drum's own settings by its pitch (`"36"` and so on).
    #[serde(default)]
    pub kit: Option<Kit>,
    #[serde(default)]
    pub pads: std::collections::BTreeMap<String, Pad>,
    /// How its volume moves along the song (beats from 0, values 0 to 1); none keeps `volume`. The older form of
    /// `auto["volume"]`, read when that is not there.
    #[serde(default)]
    pub volume_auto: Vec<AutoPoint>,
    /// Arrangement automation (Live 12 manual, chapter 25): how a setting moves along the song, by the setting's name:
    /// `"volume"` (0 to 1), `"pan"` (-1 to 1), `"send:<return id>"` (0 to 1), `"fx:<effect id>:<setting>"` (in the
    /// setting's own units). A setting with automation plays it in place of its own value.
    #[serde(default)]
    pub auto: std::collections::BTreeMap<String, Vec<AutoPoint>>,
    /// Automation overridden by hand, by the same names: it does not play until re-enabled, as Live's does when a
    /// control is moved (25.4 "Deleting Automation", the Re-Enable Automation button).
    #[serde(default)]
    pub auto_off: Vec<String>,
    /// Its modulators: each moves one setting (named as automation names it) up and down around where it is, in the
    /// Arrange and Session views alike.
    #[serde(default)]
    pub mods: Vec<Modulator>,
    /// The Session view's clips, one slot per scene; an empty slot is null.
    #[serde(default)]
    pub slots: Vec<Option<SlotClip>>,
    /// Its effects in order, as the file has them (read by [`crate::fx::Chain`]).
    #[serde(default)]
    pub fx: Vec<serde_json::Value>,
    /// How much it sends to each return (by the return's id, 0 to 1), after its volume and pan. A send to a return the
    /// song does not have is left out.
    #[serde(default)]
    pub sends: std::collections::BTreeMap<String, f64>,
}

/// A track's instrument stack: chains side by side, each an instrument of its own.
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
pub struct InstrumentStack {
    #[serde(default)]
    pub chains: Vec<InstrumentChain>,
}

/// One chain of an instrument stack: an instrument and its sound, the notes it plays (Live's key and velocity zones,
/// without their fades), and its volume and pan after the instrument. A drums chain plays nothing.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct InstrumentChain {
    #[serde(default)]
    pub instrument: Instrument,
    /// None plays the instrument's own sound, as a track with none does.
    #[serde(default)]
    pub sound: Option<Sound>,
    /// The lowest and highest key it plays (MIDI notes, 0 to 127); none plays every key.
    #[serde(default)]
    pub keys: Option<Zone>,
    /// The softest and hardest note it plays (MIDI velocities, 1 to 127); none plays every one.
    #[serde(default)]
    pub velocities: Option<Zone>,
    #[serde(default = "one")]
    pub volume: f64,
    #[serde(default)]
    pub pan: f64,
    #[serde(default)]
    pub muted: bool,
}

/// A key or velocity zone, both ends in it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
pub struct Zone {
    pub low: u8,
    pub high: u8,
}

impl InstrumentChain {
    /// Whether it plays `pitch` at `velocity` (0 to 1).
    #[must_use]
    pub fn plays(&self, pitch: u8, velocity: f64) -> bool {
        let v = (velocity.clamp(0.0, 1.0) * 127.0).round().max(1.0) as u8;
        !self.muted && self.instrument != Instrument::Drums && self.keys.is_none_or(|z| (z.low..=z.high).contains(&pitch)) && self.velocities.is_none_or(|z| (z.low..=z.high).contains(&v))
    }
}

/// The most chains an instrument stack plays, as Live's racks.
pub const MAX_CHAINS: usize = 16;

impl Track {
    /// Its instrument stack's chains that play, if it has any (no more than [`MAX_CHAINS`]).
    #[must_use]
    pub fn chains(&self) -> &[InstrumentChain] {
        self.stack.as_ref().map_or(&[], |s| &s.chains[..s.chains.len().min(MAX_CHAINS)])
    }
}

/// A frozen track's sound (relative to the song's folder, as `Samples/Processed/Freeze/Lead Freeze.wav`).
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct Frozen {
    pub file: String,
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

/// One drum's own settings on top of the kit (song-format.ts `DrumPad`), and the sound it plays in place of its
/// drum, if it holds one (Live 12 manual, 25.6.1 "Pad View": a sample dropped on a pad plays from that pad's note).
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct Pad {
    pub tune: f64,
    pub decay: f64,
    pub level: f64,
    pub pan: f64,
    #[serde(default)]
    pub sample: Option<crate::sampler::SamplerSound>,
}

impl Default for Pad {
    fn default() -> Pad {
        Pad { tune: 0.0, decay: 1.0, level: 1.0, pan: 0.0, sample: None }
    }
}

/// A point on an automation line: the value at a beat, and how the line bends on its way to the next point (Live 12
/// manual, 25.5.2: a segment is curved by Alt-dragging it): 0 straight; toward 1 it moves early and eases in, toward -1
/// it waits and moves late.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
pub struct AutoPoint {
    pub beat: f64,
    pub value: f64,
    #[serde(default)]
    pub curve: f64,
}

/// How far along a segment bent by `curve` its value is, `t` of the way (0 to 1) from one point to the next.
#[must_use]
pub fn bend(t: f64, curve: f64) -> f64 {
    let c = curve.clamp(-1.0, 1.0);
    if c.abs() < 1e-9 { t } else { t.clamp(0.0, 1.0).powf(4f64.powf(-c)) }
}

/// An automation line's value at each sample of a block: `beat_of(i)` is sample `i`'s beat (rising), and `out` is
/// filled from where the last call left `at` (a place in `points`), so a block costs a step per sample, not a search.
pub fn fill_auto(points: &[AutoPoint], beat_of: impl Fn(usize) -> f64, out: &mut [f32], empty: f64) {
    if points.is_empty() {
        out.fill(empty as f32);
        return;
    }
    // The first point after the block's first beat.
    let mut next = points.partition_point(|p| p.beat <= beat_of(0));
    for (i, v) in out.iter_mut().enumerate() {
        let beat = beat_of(i);
        while next < points.len() && points[next].beat <= beat {
            next += 1;
        }
        *v = (if next == 0 {
            points[0].value
        } else if next == points.len() {
            points[next - 1].value
        } else {
            let (a, b) = (points[next - 1], points[next]);
            a.value + bend((beat - a.beat) / (b.beat - a.beat), a.curve) * (b.value - a.value)
        }) as f32;
    }
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
            return if b.beat == a.beat { b.value } else { a.value + bend((beat - a.beat) / (b.beat - a.beat), a.curve) * (b.value - a.value) };
        }
    }
    last.value
}

/// A modulator on a track (Live 12's LFO, Shaper and Envelope Follower, as devices that map to a setting): it moves `target`
/// by `amount` (in the setting's own units) times what it makes, added to where the setting is (its automation, or
/// its own value).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Modulator {
    /// `"lfo"`, from -1 to 1 along its shape; `"shaper"`, from -1 to 1 along the line its `points` draw; or `"follow"`,
    /// from 0 to 1 with the track's level before its volume.
    pub kind: String,
    /// `"volume"`, `"pan"`, `"send:<return id>"` or `"fx:<effect id>:<setting>"`.
    pub target: String,
    pub amount: f64,
    /// An LFO's speed in Hz, unless it is synced.
    #[serde(default = "one")]
    pub rate: f64,
    /// Synced to the song: beats for once round (in place of `rate`).
    #[serde(default)]
    pub sync: Option<f64>,
    /// An LFO's shape: `"sine"` (the default), `"triangle"`, `"square"`, `"saw"` (rising) or `"ramp"` (falling).
    #[serde(default)]
    pub shape: Option<String>,
    /// Where in its round an LFO or shaper starts, 0 to 1, at the song's start.
    #[serde(default)]
    pub phase: f64,
    /// A shaper's line through one round: each point's `beat` is where in the round (0 to 1), its `value` -1 to 1, and
    /// its `curve` bends the line to the next point, as automation's. It goes round from the last point to the first.
    #[serde(default)]
    pub points: Vec<AutoPoint>,
    /// An envelope follower's rise and fall times in seconds.
    #[serde(default = "follow_attack")]
    pub attack: f64,
    #[serde(default = "follow_release")]
    pub release: f64,
    /// Off, it moves nothing.
    #[serde(default)]
    pub on: Option<bool>,
}

const fn follow_attack() -> f64 {
    0.01
}

const fn follow_release() -> f64 {
    0.2
}

/// A clip in a Session slot: `bars` long, going round while it plays.
#[derive(Debug, Clone, Deserialize)]
pub struct SlotClip {
    pub bars: f64,
    #[serde(default)]
    pub notes: Vec<Note>,
    /// On an audio track, the sound it plays.
    #[serde(default)]
    pub audio: Option<Audio>,
    /// Its clip envelopes (Live 12 manual, 27), in the clip's own beats: `"volume"` (0 to 1, a share of the track's
    /// volume), `"pan"` (-1 to 1, added to the track's pan), `"send:<return id>"` (0 to 1, a share of the send) and
    /// `"fx:<effect id>:<setting>"` (the setting itself, in its own units, while the clip plays).
    #[serde(default)]
    pub envelopes: std::collections::BTreeMap<String, Vec<AutoPoint>>,
    /// Envelopes unlinked from the clip (27): each goes round its own loop, in beats from when the clip starts, and
    /// not the clip's.
    #[serde(default)]
    pub unlinked: std::collections::BTreeMap<String, Span>,
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
    /// On an audio track, the sound it plays.
    #[serde(default)]
    pub audio: Option<Audio>,
    /// Its clip envelopes (Live 12 manual, 27), in the clip's own beats: `"volume"` (0 to 1, a share of the track's
    /// volume), `"pan"` (-1 to 1, added to the track's pan), `"send:<return id>"` (0 to 1, a share of the send) and
    /// `"fx:<effect id>:<setting>"` (the setting itself, in its own units, while the clip plays).
    #[serde(default)]
    pub envelopes: std::collections::BTreeMap<String, Vec<AutoPoint>>,
    /// Envelopes unlinked from the clip (27): each goes round its own loop, in beats from when the clip starts, and
    /// not the clip's.
    #[serde(default)]
    pub unlinked: std::collections::BTreeMap<String, Span>,
}

/// An audio clip's sound (Live 12 manual, chapter 9): a WAV file in the song's folder, from `offset` seconds in, at
/// `gain_db`. Unwarped, it plays at its own speed whatever the tempo (9.2 "Tempo Control and Warping"). Warped, it
/// follows the song's tempo: its `bpm`, or its warp markers (9.2.3), pin its own beats to places in the file.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Audio {
    /// Relative to the song's folder, as `Samples/Recorded/Vocal 1.wav`.
    pub file: String,
    #[serde(default)]
    pub gain_db: f64,
    /// Where in the file the clip's first beat is, in seconds.
    #[serde(default)]
    pub offset: f64,
    #[serde(default)]
    pub warp: bool,
    /// The warp mode (9.3): `"repitch"` plays faster or slower like a turntable. The others (beats, tones, texture,
    /// complex, complexpro) keep their pitch with the granular stretcher in [`crate::sample`]; none is Re-Pitch.
    #[serde(default)]
    pub mode: Option<String>,
    /// The file's own tempo, warped with no markers.
    #[serde(default)]
    pub bpm: Option<f64>,
    /// Warp markers: a sample frame of the file at a beat of the clip, in order.
    #[serde(default)]
    pub markers: Vec<WarpMarker>,
}

/// A warp marker (ui/Waveform.tsx `WarpMarker`): the file's `sample` frame lands on the clip's `beat`.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
pub struct WarpMarker {
    pub sample: f64,
    pub beat: f64,
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

    /// Whether a track plays audio clips rather than notes.
    #[must_use]
    pub fn is_audio(track: &Track) -> bool {
        track.kind.as_deref() == Some("audio")
    }

    /// The automation of `track`'s setting `name`, in beat order, unless it has none or it is overridden.
    #[must_use]
    pub fn auto_of(track: &Track, name: &str) -> Vec<AutoPoint> {
        let fallback = if name == "volume" { track.volume_auto.as_slice() } else { &[] };
        points_of(&track.auto, &track.auto_off, name, fallback)
    }

    /// Main's automation of `name` (`"volume"`), as [`Song::auto_of`] a track's.
    #[must_use]
    pub fn main_auto_of(&self, name: &str) -> Vec<AutoPoint> {
        points_of(&self.main.auto, &self.main.auto_off, name, &[])
    }

    /// The sampler a track plays its notes on, if it is a sampler track.
    #[must_use]
    pub fn sampler_of(track: &Track) -> Option<&crate::sampler::SamplerSound> {
        track.sampler.as_ref().filter(|_| track.kind.as_deref() == Some("sampler"))
    }

    /// The song as one track heard alone for freezing `id`: its instrument, clips and effects at full volume, in the
    /// middle, sending nothing, through a Main with no effects at 1 (so the file is what goes into its volume and pan).
    /// `None` when the song has no such track.
    #[must_use]
    pub fn for_freezing(&self, id: &str) -> Option<Song> {
        let mut track = self.tracks.iter().find(|t| t.id == id)?.clone();
        track.volume = 1.0;
        track.pan = 0.0;
        track.muted = false;
        track.solo = false;
        track.frozen = None;
        track.volume_auto.clear();
        track.auto.retain(|name, _| name.starts_with("fx:"));
        track.mods.retain(|m| m.target.starts_with("fx:"));
        track.sends.clear();
        track.slots.clear();
        Some(Song { tracks: vec![track], returns: Vec::new(), main: Main { volume: 1.0, ..Main::default() }, ..self.clone() })
    }

    /// The song's length in beats.
    #[must_use]
    pub fn beats(&self) -> f64 {
        f64::from(self.bars) * BEATS_PER_BAR
    }
}

/// The points of `name` in `auto` (or `fallback` when it has none), finite and in beat order; none when it is overridden.
pub(crate) fn points_of(auto: &std::collections::BTreeMap<String, Vec<AutoPoint>>, off: &[String], name: &str, fallback: &[AutoPoint]) -> Vec<AutoPoint> {
    if off.iter().any(|n| n == name) {
        return Vec::new();
    }
    let mut points = auto.get(name).map_or_else(|| fallback.to_vec(), Clone::clone);
    points.retain(|p| p.beat.is_finite() && p.value.is_finite());
    points.sort_by(|a, b| a.beat.total_cmp(&b.beat));
    points
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

