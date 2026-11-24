//! The song made into sound, block by block on the sample clock: the same code for offline render and, next, for the
//! audio thread. Notes start on their own sample; each track's notes are mixed, set to its volume and pan, and sent
//! on to the returns; tracks and returns go into Main, through its effects and its level (0.8 unless the song says).

use crate::clock::Clock;
use crate::drum::Hit;
use std::collections::BTreeMap;

use crate::fx::{balance, Aim, Chain, QUANTUM};
use crate::sample::{Placed, Stretch};
use crate::sampler::{SampleVoice, Samplers};
use crate::song::{auto_value_at, fill_auto, AutoPoint, Instrument, InstrumentChain, Kit, Note, Pad, Song, Sound, BEATS_PER_BAR};
use crate::voice::{pan_gains, Voice};

/// The longest block made at once: a longer one is made in pieces of this.
pub const MAX_BLOCK: usize = 4096;
/// The most notes one track sounds at once: a note past it takes the place of the oldest.
const MAX_VOICES: usize = 64;
/// How long a render runs past the song's end, so the last notes ring out (studio-audio.ts `RENDER_TAIL`).
pub const RENDER_TAIL: f64 = 2.0;

struct Lane {
    id: String,
    notes: Vec<Note>,
    /// The first note not yet started.
    next: usize,
    sound: Option<Sound>,
    instrument: Instrument,
    /// Its instrument stack's chains, which play its notes in place of its instrument when there are any.
    chains: Vec<InstrumentChain>,
    /// The stack's notes sounding, each with its chain's left and right gains and how far into the block it starts
    /// the first time (as a hit waits), and a block of one voice's sound.
    stacked: Vec<(Voice, Gains, usize)>,
    mono: Vec<f32>,
    /// A drums track's kit and its drums' own settings by pitch.
    kit: Kit,
    pads: Vec<(u8, Pad)>,
    /// Its pan's left and right gains (at `pan`).
    gains: (f64, f64),
    volume: f64,
    /// How its volume moves along the song; empty keeps `volume`.
    auto: Vec<AutoPoint>,
    /// Its volume at each sample of a block, when it moves.
    volumes: Vec<f32>,
    pan: f64,
    /// Its Arrange clips with envelopes, in time order (none in the Session view), and each Session slot's envelopes.
    env_spans: Vec<EnvSpan>,
    slot_envs: Vec<Option<Envelopes>>,
    /// The lanes keying its chain's compressors (sidechain, Live 12 manual 29.9.1), as a return's `key_from`.
    key_from: Vec<Option<usize>>,
    /// Its effects' automated settings, each with where it lives in `chain` (none in the Session view).
    fx_auto: Vec<Move>,
    /// Its modulators, and what each made this block.
    mods: Vec<Mod>,
    /// The modulators moving its volume and pan.
    volume_mods: Vec<usize>,
    pan_mods: Vec<usize>,
    /// Its effects, and what they were made from (so a song changed while it plays keeps them ringing if unchanged).
    chain: Option<Chain>,
    fx_key: String,
    voices: Vec<Voice>,
    hits: Vec<Hit>,
    /// Varies each drum hit's noise.
    seed: u32,
    /// The track's sound for a block before its volume and pan, left and right.
    scratch: Vec<f32>,
    scratch_right: Vec<f32>,
    /// The loudest sample of the last block, left and right, after volume and pan.
    peak: (f32, f32),
    /// Its sends: a return (by its place in the renderer's) and how much goes to it, after volume and pan.
    sends: Vec<Send>,
    /// How its pan moves along the song (empty keeps `pan`), and its pan at each sample of a block when it moves.
    pan_auto: Vec<AutoPoint>,
    pans: Vec<f32>,
    /// An audio track's clips in Arrange.
    audio: Vec<AudioClip>,
    /// Where the grains of the Session clip playing on it start, when its warp keeps pitch.
    slot_stretch: Stretch,
    /// A sampler track's sound, or the drums' pads that hold sounds of their own.
    samplers: Samplers,
    /// Its sound into Main for the last block, left and right, when the renderer keeps stems (else empty).
    stem: (Vec<f32>, Vec<f32>),
    /// Sampler notes sounding, each with how far into the block it starts the first time (as a hit waits) and the
    /// note that started it.
    sample_voices: Vec<(SampleVoice, usize, u8)>,
}

/// A track's send to a return: how much, or how that moves along the song and its level at each sample of a block.
struct Send {
    to: usize,
    /// The modulators moving it.
    mods: Vec<usize>,
    /// `"send:<return id>"`, as automation and clip envelopes name it.
    name: String,
    level: f32,
    auto: Vec<AutoPoint>,
    levels: Vec<f32>,
}

impl Send {
    fn at(&self, i: usize) -> f32 {
        if self.levels.is_empty() { self.level } else { self.levels[i] }
    }
}

/// An effect setting that moves: where it is in the chain, where it rests (as the song has it), its automation and the
/// modulators on it (by their place in the lane's).
struct Move {
    /// What it moves, as automation names it (`"fx:<effect id>:<setting>"`).
    name: String,
    aim: Aim,
    rest: f64,
    points: Vec<AutoPoint>,
    mods: Vec<usize>,
}

/// The most modulators a track runs.
const MAX_MODS: usize = 16;

/// A modulator as it runs: what it is, how far it moves its setting, and what it made at each sample of a block.
struct Mod {
    kind: ModKind,
    amount: f64,
    values: Vec<f32>,
    /// An LFO's or shaper's value glides to where it jumps (a square's edge, a drawn step) over a couple of
    /// milliseconds, so a jump in what it moves does not click: the share it goes a sample, and where it is (none
    /// before it starts, when it starts where it should be).
    glide: f64,
    at: Option<f64>,
}

/// How long an LFO's or shaper's jump takes, in seconds.
const MOD_GLIDE: f64 = 0.002;

enum ModKind {
    /// Free in Hz, or synced to `sync` beats a round; from `phase`.
    Lfo { shape: Shape, rate: f64, sync: Option<f64>, phase: f64 },
    /// Timed as an LFO, along a drawn line: its points in order through one round, with the last before the first and
    /// the first after the last so that it goes round smoothly.
    Shaper { points: Vec<AutoPoint>, rate: f64, sync: Option<f64>, phase: f64 },
    /// The track's level, rising and falling by these shares a sample.
    Follow { rise: f64, fall: f64, level: f64 },
}

#[derive(Clone, Copy)]
enum Shape {
    Sine,
    Triangle,
    Square,
    Saw,
    Ramp,
}

impl Mod {
    fn new(m: &crate::song::Modulator, sample_rate: u32) -> Mod {
        let rate = f64::from(sample_rate);
        let share = |seconds: f64| 1.0 - (-1.0 / (seconds.max(0.0001) * rate)).exp();
        let rate_of = || m.rate.clamp(0.0, 40.0);
        let sync_of = || m.sync.filter(|b| b.is_finite() && *b > 0.0);
        let kind = if m.kind == "follow" {
            ModKind::Follow { rise: share(m.attack), fall: share(m.release), level: 0.0 }
        } else if m.kind == "shaper" {
            let mut points: Vec<AutoPoint> = m
                .points
                .iter()
                .filter(|p| p.beat.is_finite() && p.value.is_finite())
                .take(MAX_SHAPER_POINTS)
                .map(|p| AutoPoint { beat: p.beat.clamp(0.0, 1.0), value: p.value.clamp(-1.0, 1.0), ..*p })
                .collect();
            points.sort_by(|a, b| a.beat.total_cmp(&b.beat));
            if let (Some(&first), Some(&last)) = (points.first(), points.last()) {
                if first.beat > 0.0 {
                    points.insert(0, AutoPoint { beat: last.beat - 1.0, ..last });
                }
                if last.beat < 1.0 {
                    points.push(AutoPoint { beat: first.beat + 1.0, ..first });
                }
            }
            ModKind::Shaper { points, rate: rate_of(), sync: sync_of(), phase: m.phase.rem_euclid(1.0) }
        } else {
            let shape = match m.shape.as_deref() {
                Some("triangle") => Shape::Triangle,
                Some("square") => Shape::Square,
                Some("saw") => Shape::Saw,
                Some("ramp") => Shape::Ramp,
                _ => Shape::Sine,
            };
            ModKind::Lfo { shape, rate: rate_of(), sync: sync_of(), phase: m.phase.rem_euclid(1.0) }
        };
        Mod { kind, amount: m.amount, values: vec![0.0; MAX_BLOCK], glide: share(MOD_GLIDE), at: None }
    }
}

/// The most points a shaper's line has.
const MAX_SHAPER_POINTS: usize = 64;

/// Moves `at` the share `glide` of the way to `to` and gives where it is (at once to `to` the first time).
fn glide(at: &mut Option<f64>, glide: f64, to: f64) -> f32 {
    let now = at.map_or(to, |a| a + (to - a) * glide);
    *at = Some(now);
    now as f32
}

/// How many rounds an LFO or shaper has gone at sample `at`: synced to `sync` beats a round, or free at `rate` Hz.
fn rounds(clock: &Clock, at: u64, rate: f64, sync: Option<f64>) -> f64 {
    match sync {
        Some(beats) => clock.beat(at) / beats,
        None => at as f64 * (1.0 / clock.sample_rate) * rate,
    }
}

/// One round of an LFO's shape at `p` (0 to 1), from -1 to 1. Sine and triangle start in the middle going up.
fn wave(shape: Shape, p: f64) -> f64 {
    match shape {
        Shape::Sine => (p * std::f64::consts::TAU).sin(),
        Shape::Triangle => {
            let q = (p + 0.25).fract();
            if q < 0.5 { 4.0 * q - 1.0 } else { 3.0 - 4.0 * q }
        }
        Shape::Square => if p < 0.5 { 1.0 } else { -1.0 },
        Shape::Saw => 2.0 * p - 1.0,
        Shape::Ramp => 1.0 - 2.0 * p,
    }
}

/// What a lane's modulators move, sample by sample.
struct Moving<'a> {
    volumes: &'a mut [f32],
    pans: &'a mut [f32],
    sends: &'a mut [Send],
    volume_mods: &'a [usize],
    pan_mods: &'a [usize],
}

/// What each of a lane's modulators makes for this block from its `sound` (before its volume), then its volume, pan
/// and sends moved by theirs.
fn run_mods(mods: &mut [Mod], sound: (&[f32], &[f32]), moving: Moving<'_>, clock: &Clock, from: u64, frames: usize) {
    let (scratch, scratch_right) = sound;
    let Moving { volumes, pans, sends, volume_mods, pan_mods } = moving;
    for m in mods.iter_mut() {
        match &mut m.kind {
            ModKind::Lfo { shape, rate, sync, phase } => {
                for (i, v) in m.values[..frames].iter_mut().enumerate() {
                    let round = rounds(clock, from + i as u64, *rate, *sync);
                    *v = glide(&mut m.at, m.glide, wave(*shape, (*phase + round).rem_euclid(1.0)));
                }
            }
            ModKind::Shaper { points, rate, sync, phase } => {
                for (i, v) in m.values[..frames].iter_mut().enumerate() {
                    let round = rounds(clock, from + i as u64, *rate, *sync);
                    *v = glide(&mut m.at, m.glide, auto_value_at(points, (*phase + round).rem_euclid(1.0), 0.0));
                }
            }
            ModKind::Follow { rise, fall, level } => {
                for (i, v) in m.values[..frames].iter_mut().enumerate() {
                    let now = f64::from(scratch[i].abs().max(scratch_right[i].abs()));
                    *level += (now - *level) * if now > *level { *rise } else { *fall };
                    *v = level.min(1.0) as f32;
                }
            }
        }
    }
    let mods = &*mods;
    let moved = |which: &[usize], i: usize| -> f32 { which.iter().map(|&k| (mods[k].amount * f64::from(mods[k].values[i])) as f32).sum() };
    if !volume_mods.is_empty() {
        for (i, v) in volumes[..frames].iter_mut().enumerate() {
            *v = (*v + moved(volume_mods, i)).max(0.0);
        }
    }
    if !pan_mods.is_empty() {
        for (i, p) in pans[..frames].iter_mut().enumerate() {
            *p = (*p + moved(pan_mods, i)).clamp(-1.0, 1.0);
        }
    }
    for send in sends.iter_mut().filter(|s| !s.mods.is_empty()) {
        for i in 0..frames {
            send.levels[i] = (send.levels[i] + moved(&send.mods, i)).clamp(0.0, 1.0);
        }
    }
}

/// A clip's envelopes (Live 12 manual, 27), in its own beats, as they move what its track plays: a share of its
/// volume, an amount added to its pan, a share of each send (by its place in the track's sends), and its effect
/// settings themselves (by their place in the track's automated settings).
#[derive(Default)]
struct Envelopes {
    /// An audio clip's transposition, in semitones added to its own (27.2.2).
    transpose: Env,
    volume: Env,
    pan: Env,
    sends: Vec<Env>,
    settings: Vec<Env>,
}

/// One envelope: its points, and, when unlinked from the clip, its own loop (27).
#[derive(Default)]
struct Env {
    points: Vec<AutoPoint>,
    unlinked: Option<(f64, f64)>,
}

impl Env {
    /// The envelope `name` of a clip's `env`, unlinked if `unlinked` names it.
    fn of(env: &BTreeMap<String, Vec<AutoPoint>>, unlinked: &BTreeMap<String, crate::song::Span>, name: &str) -> Env {
        Env {
            points: crate::song::points_of(env, &[], name, &[]),
            unlinked: unlinked.get(name).filter(|l| l.start.is_finite() && l.end.is_finite() && l.end > l.start).map(|l| (l.start, l.end)),
        }
    }

    fn is_empty(&self) -> bool {
        self.points.is_empty()
    }

    /// Its value with the clip at its own beat `own`, `played` beats after it started: an unlinked one goes round
    /// its own loop from when the clip started.
    fn at(&self, own: f64, played: f64) -> f64 {
        match self.unlinked {
            Some((from, to)) => env_at(&self.points, from + played.max(0.0).rem_euclid(to - from)),
            None => env_at(&self.points, own),
        }
    }
}

impl Envelopes {
    /// The envelopes of a clip (`env`, and those of them `unlinked`) that move a track with these `sends` and these
    /// automated effect `settings`; None when there are none.
    fn of(env: &BTreeMap<String, Vec<AutoPoint>>, unlinked: &BTreeMap<String, crate::song::Span>, sends: &[Send], settings: &[Move]) -> Option<Envelopes> {
        let one = |name: &str| Env::of(env, unlinked, name);
        let e = Envelopes { transpose: one("transpose"), volume: one("volume"), pan: one("pan"), sends: sends.iter().map(|s| one(&s.name)).collect(), settings: settings.iter().map(|m| one(&m.name)).collect() };
        (!e.transpose.is_empty() || !e.volume.is_empty() || !e.pan.is_empty() || e.sends.iter().any(|p| !p.is_empty()) || e.settings.iter().any(|p| !p.is_empty())).then_some(e)
    }
}

/// The Session slot playing, with its envelopes: Some(None) when Arrange plays, None when the slot playing has none.
fn playing_slot(slot_envs: &[Option<Envelopes>], slot: Option<(f64, f64, usize)>) -> Option<Option<(f64, f64, &Envelopes)>> {
    match slot {
        Some((length, start, at)) => slot_envs.get(at).and_then(Option::as_ref).map(|env| Some((length, start, env))),
        None => Some(None),
    }
}

/// The envelopes of the clip playing at `beat` (the Session slot, or the Arrange clip there), its own beat there and
/// how many beats it has played.
fn clip_at<'a>(env_spans: &'a [EnvSpan], slot: Option<(f64, f64, &'a Envelopes)>, beat: f64) -> Option<(&'a Envelopes, f64, f64)> {
    match slot {
        Some((length, start, env)) => (beat >= start).then(|| (env, (beat - start).rem_euclid(length), beat - start)),
        None => {
            let k = env_spans.partition_point(|s| s.end <= beat);
            env_spans.get(k).filter(|s| s.start <= beat).map(|s| (&s.env, s.own_beat(beat), beat - s.start))
        }
    }
}

/// An Arrange clip with envelopes: the song beats it covers, its own beat at its start, and its loop.
struct EnvSpan {
    start: f64,
    end: f64,
    own: f64,
    cycle: Option<(f64, f64)>,
    env: Envelopes,
}

impl EnvSpan {
    /// The clip's own beat at song beat `beat` (inside it), going round its loop as its notes do.
    fn own_beat(&self, beat: f64) -> f64 {
        let played = beat - self.start;
        match self.cycle {
            Some((from, to)) if self.own < to => {
                let first = to - self.own;
                if played < first { self.own + played } else { from + (played - first).rem_euclid(to - from) }
            }
            Some((from, to)) => from + (self.own - from + played).rem_euclid(to - from),
            None => self.own + played,
        }
    }
}

/// An envelope's value at `beat`, as [`crate::song::auto_value_at`] but found by halving (an envelope is read every sample).
fn env_at(points: &[AutoPoint], beat: f64) -> f64 {
    let at = points.partition_point(|p| p.beat <= beat);
    if at == 0 {
        return points.first().map_or(0.0, |p| p.value);
    }
    if at == points.len() {
        return points[at - 1].value;
    }
    let (a, b) = (points[at - 1], points[at]);
    a.value + crate::song::bend((beat - a.beat) / (b.beat - a.beat), a.curve) * (b.value - a.value)
}

/// An audio clip in Arrange: `length` song beats from `start`, playing its own beats from `offset`, going round
/// `cycle` (its loop) if it has one, as a clip's notes do.
struct AudioClip {
    start: f64,
    length: f64,
    offset: f64,
    cycle: Option<(f64, f64)>,
    placed: Placed,
    stretch: Stretch,
    /// Whether it fades in and out (a clip does; a frozen track's file, which starts and ends with the song, does not).
    fades: bool,
    /// Its transposition envelope (27.2.2), in semitones added to its own.
    transpose: Env,
}

impl AudioClip {
    /// The clip's own beat at a song beat while it plays, and its declick fade: up to 4 ms in from its start and
    /// out to its end, as Live's Clip Fade (Live 12 manual, 9.1 "Clip Fade"), at `spb` seconds a beat.
    fn own_beat(&self, beat: f64, spb: f64) -> Option<(f64, f32)> {
        let elapsed = beat - self.start;
        if elapsed < 0.0 || elapsed >= self.length {
            return None;
        }
        let own = self.offset + elapsed;
        let fade = if self.fades { ((elapsed.min(self.length - elapsed) * spb) / AudioClip::FADE).min(1.0) as f32 } else { 1.0 };
        Some((
            match self.cycle {
                Some((from, to)) if own >= to => from + (own - to).rem_euclid(to - from),
                _ => own,
            },
            fade,
        ))
    }

    const FADE: f64 = 0.004;
}

/// A return track as it plays: what the tracks send it, through its effects, volume and pan, into Main.
struct ReturnLane {
    id: String,
    /// As a lane's `stem`.
    stem: (Vec<f32>, Vec<f32>),
    volume: f64,
    pan: f64,
    chain: Option<Chain>,
    fx_key: String,
    /// The lanes keying its chain's compressors, by its sources' order (None for one not heard).
    key_from: Vec<Option<usize>>,
    left: Vec<f32>,
    right: Vec<f32>,
    peak: (f32, f32),
}

impl Lane {
    /// Moves this block's volume, pan and sends by the envelopes of the clip playing at each sample: a Session
    /// `slot` playing (its length, the beat it started and its place) or the Arrange clip there. Volume and sends are
    /// shares of where they are, pan is added to it (Live 12 manual, 27).
    fn modulate(&mut self, beat_of: impl Fn(usize) -> f64, frames: usize, slot: Option<(f64, f64, usize)>) {
        let Lane { env_spans, slot_envs, volumes, pans, sends, .. } = self;
        let Some(slot) = playing_slot(slot_envs, slot) else { return };
        if env_spans.is_empty() && slot.is_none() {
            return;
        }
        for i in 0..frames {
            let Some((env, own, played)) = clip_at(env_spans, slot, beat_of(i)) else { continue };
            if !env.volume.is_empty() && !volumes.is_empty() {
                volumes[i] *= env.volume.at(own, played).clamp(0.0, 1.0) as f32;
            }
            if !env.pan.is_empty() && !pans.is_empty() {
                pans[i] = (f64::from(pans[i]) + env.pan.at(own, played)).clamp(-1.0, 1.0) as f32;
            }
            for (send, e) in sends.iter_mut().zip(&env.sends) {
                if !e.is_empty() && !send.levels.is_empty() {
                    send.levels[i] *= e.at(own, played).clamp(0.0, 1.0) as f32;
                }
            }
        }
    }

    /// Starts a note `offset` samples into this block. A voice sounds into the scratch from there at once; a drum
    /// hit waits for the second pass, as it can be panned.
    fn start(&mut self, note: &Note, offset: usize, frames: usize, spb: f64, rate: f64) {
        let drums = self.instrument == Instrument::Drums && self.samplers.track.is_none();
        let pad = self.pads.iter().find(|(p, _)| drums && *p == note.pitch).map(|(_, pad)| pad);
        // A sampler track's note, or a pad's own sound.
        if let Some(voice) = self.samplers.note(note.pitch, note.velocity, note.length * spb, self.kit.tune, pad) {
            if self.samplers.monophonic(note.pitch) {
                // One-Shot is monophonic: a new note cuts the last off (on a pad, the last of that pad's).
                for (v, _, key) in &mut self.sample_voices {
                    if !drums || *key == note.pitch {
                        v.choke();
                    }
                }
            }
            if self.sample_voices.len() >= MAX_VOICES {
                self.sample_voices.remove(0);
            }
            self.sample_voices.push((voice, offset.min(frames), note.pitch));
            return;
        }
        if drums {
            const NO_PAD: Pad = Pad { tune: 0.0, decay: 1.0, level: 1.0, pan: 0.0, sample: None };
            let pad = pad.unwrap_or(&NO_PAD);
            self.seed = self.seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            if self.hits.len() >= MAX_VOICES {
                self.hits.remove(0);
            }
            // Held with its offset in the block in `time`'s place until the second pass starts it.
            self.hits.push(Hit::new(note.pitch, note.velocity, self.kit, pad, self.seed).waiting(offset));
            return;
        }
        // A stack's chains each play the notes in their zones, panned on their own, so they wait for the second pass.
        if !self.chains.is_empty() {
            for chain in self.chains.iter().filter(|c| c.plays(note.pitch, note.velocity)) {
                if self.stacked.len() >= MAX_VOICES {
                    self.stacked.remove(0);
                }
                self.stacked.push((chain_voice(chain, note.pitch, note.length * spb, note.velocity), chain_gains(chain), offset.min(frames)));
            }
            return;
        }
        // A track with no sound of its own plays its instrument's own voices, as the window does.
        let mut voice = match &self.sound {
            Some(sound) => Voice::new(self.instrument, sound, note.pitch, note.length * spb, note.velocity),
            None => Voice::legacy(self.instrument, note.pitch, note.length * spb, note.velocity),
        };
        voice.add_to(&mut self.scratch[offset.min(frames)..frames], rate);
        if self.voices.len() >= MAX_VOICES {
            self.voices.remove(0);
        }
        self.voices.push(voice);
    }
}

/// Sounds heard apart from the song, straight out as the window's sampler plays them: a note as a key is pressed or
/// put on the roll, and a count-in's ticks. Room for them is made up front, so the audio thread allocates nothing.
pub struct Oneshots {
    voices: Vec<(Voice, Gains)>,
    held: Vec<Held>,
    hits: Vec<(Hit, Gains)>,
    samples: Vec<HeldSample>,
    ticks: Vec<Tick>,
    /// The song's Main level: notes go through it as the song's own do (Live: a played note is heard through the
    /// Main track). A count-in's ticks do not: they are at the metronome's own level, `metronome`.
    pub main: f32,
    pub metronome: f32,
    mono: Vec<f32>,
    left: Vec<f32>,
    right: Vec<f32>,
}

/// The left and right gains a note is heard at: its track's volume and pan.
pub type Gains = (f32, f32);

/// A stack chain's note: its instrument with its sound, or the instrument's own.
#[must_use]
pub fn chain_voice(chain: &InstrumentChain, pitch: u8, seconds: f64, velocity: f64) -> Voice {
    match &chain.sound {
        Some(sound) => Voice::new(chain.instrument, sound, pitch, seconds, velocity),
        None => Voice::legacy(chain.instrument, pitch, seconds, velocity),
    }
}

/// A stack chain's volume and pan as left and right gains on its instrument's (mono) sound.
#[must_use]
pub fn chain_gains(chain: &InstrumentChain) -> Gains {
    let (l, r) = pan_gains(chain.pan);
    let v = chain.volume.max(0.0);
    ((l * v) as f32, (r * v) as f32)
}

/// A track's volume and pan as left and right gains, as its lane mixes them.
#[must_use]
pub fn track_gains(track: &crate::song::Track) -> Gains {
    let (l, r) = pan_gains(track.pan);
    ((l * track.volume) as f32, (r * track.volume) as f32)
}

/// One sound for [`Oneshots`].
#[derive(Debug, Clone)]
// Carried by value through a fixed ring: boxing the big variant would free memory on the audio thread.
#[allow(clippy::large_enum_variant)]
pub enum Oneshot {
    /// A note at its track's volume and pan.
    Voice(Voice, Gains),
    /// A drum hit at its track's volume and pan.
    Hit(Hit, Gains),
    /// A count-in: `beats` ticks `seconds_per_beat` apart, a high one first, starting 50 ms from now.
    CountIn { beats: usize, seconds_per_beat: f64 },
    /// Silence what is sounding (a count-in cut short).
    Hush,
    /// A key pressed on a keyboard: its note sounds from `wait` samples into the next block until the key is lifted.
    /// The same key pressed again lets its last note go first, unless `layer`: another chain of the same press.
    Press { key: u8, voice: Voice, gains: Gains, wait: usize, layer: bool },
    /// A key lifted, `wait` samples into the next block.
    Lift { key: u8, wait: usize },
    /// A sampler's note (or a drum pad's sound), from `wait` samples into the next block, let go when `key` is lifted
    /// if it has not ended first. It cuts off the notes before it as `cuts` says (One-Shot is monophonic).
    Sample { key: u8, voice: SampleVoice, gains: Gains, wait: usize, cuts: Cuts },
}

/// Which notes sounding a new sampler note cuts off.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Cuts {
    None,
    /// Those of the same key: a One-Shot drum pad.
    SameKey,
    /// All: a One-Shot sampler track.
    All,
}

/// A sampler note sounding apart from the song.
struct HeldSample {
    key: u8,
    voice: SampleVoice,
    gains: Gains,
    wait: usize,
    lift: Option<usize>,
}

/// A note held down on a keyboard.
struct Held {
    key: u8,
    voice: Voice,
    gains: Gains,
    /// Samples until it starts.
    wait: usize,
    /// Samples until it is let go, once its key is lifted.
    lift: Option<usize>,
}

/// The most notes, drum hits and ticks sounding at once apart from the song.
const ONESHOTS: usize = 32;

impl Default for Oneshots {
    fn default() -> Oneshots {
        Oneshots { voices: Vec::with_capacity(ONESHOTS), held: Vec::with_capacity(ONESHOTS), hits: Vec::with_capacity(ONESHOTS), samples: Vec::with_capacity(ONESHOTS), ticks: Vec::with_capacity(ONESHOTS), main: 1.0, metronome: 0.8, mono: vec![0.0; MAX_BLOCK], left: vec![0.0; MAX_BLOCK], right: vec![0.0; MAX_BLOCK] }
    }
}

impl Oneshots {
    /// Starts `shot` at the next block; past the room there is, the oldest of its kind gives way.
    pub fn start(&mut self, shot: Oneshot, rate: f64) {
        match shot {
            Oneshot::Voice(v, gains) => {
                if self.voices.len() >= ONESHOTS {
                    self.voices.remove(0);
                }
                self.voices.push((v, gains));
            }
            Oneshot::Hit(h, gains) => {
                if self.hits.len() >= ONESHOTS {
                    self.hits.remove(0);
                }
                self.hits.push((h, gains));
            }
            Oneshot::CountIn { beats, seconds_per_beat } => {
                self.ticks.clear();
                for i in 0..beats.min(ONESHOTS) {
                    let wait = ((0.05 + i as f64 * seconds_per_beat) * rate).round() as usize;
                    self.ticks.push(Tick { wait, time: 0, accent: i == 0, gain: f64::from(self.metronome) });
                }
            }
            Oneshot::Hush => {
                self.ticks.clear();
                self.voices.clear();
                self.held.clear();
                self.hits.clear();
                self.samples.clear();
            }
            Oneshot::Press { key, voice, gains, wait, layer } => {
                if !layer {
                    self.lift(key, wait);
                }
                if self.held.len() >= ONESHOTS {
                    self.held.remove(0);
                }
                self.held.push(Held { key, voice, gains, wait, lift: None });
            }
            Oneshot::Lift { key, wait } => self.lift(key, wait),
            Oneshot::Sample { key, voice, gains, wait, cuts } => {
                for held in &mut self.samples {
                    if cuts == Cuts::All || (cuts == Cuts::SameKey && held.key == key) {
                        held.voice.choke();
                    }
                }
                if self.samples.len() >= ONESHOTS {
                    self.samples.remove(0);
                }
                self.samples.push(HeldSample { key, voice, gains, wait, lift: None });
            }
        }
    }

    /// Lets go of `key`'s held note `wait` samples from now.
    fn lift(&mut self, key: u8, wait: usize) {
        for held in self.held.iter_mut().filter(|h| h.key == key && h.lift.is_none()) {
            held.lift = Some(wait.max(held.wait));
        }
        for held in self.samples.iter_mut().filter(|h| h.key == key && h.lift.is_none()) {
            held.lift = Some(wait.max(held.wait));
        }
    }

    /// Whether anything is sounding or waiting to.
    #[must_use]
    pub fn busy(&self) -> bool {
        !(self.voices.is_empty() && self.held.is_empty() && self.hits.is_empty() && self.samples.is_empty() && self.ticks.is_empty())
    }

    /// Adds what is sounding into `left` and `right`.
    pub fn add_to(&mut self, left: &mut [f32], right: &mut [f32], rate: f64) {
        let main = self.main;
        for (l, r) in left.chunks_mut(MAX_BLOCK).zip(right.chunks_mut(MAX_BLOCK)) {
            let n = l.len();
            let mono = &mut self.mono[..n];
            for (v, (gl, gr)) in &mut self.voices {
                mono.fill(0.0);
                v.add_to(mono, rate);
                let (gl, gr) = (*gl * main, *gr * main);
                for ((a, b), m) in l.iter_mut().zip(r.iter_mut()).zip(mono.iter()) {
                    *a += *m * gl;
                    *b += *m * gr;
                }
            }
            for h in &mut self.held {
                mono.fill(0.0);
                let start = h.wait.min(n);
                match h.lift {
                    Some(lift) if lift < n => {
                        h.voice.add_to(&mut mono[start..lift], rate);
                        h.voice.release();
                        h.voice.add_to(&mut mono[lift..], rate);
                        h.lift = Some(0);
                    }
                    lift => {
                        h.voice.add_to(&mut mono[start..], rate);
                        h.lift = lift.map(|l| l - n);
                    }
                }
                h.wait -= start;
                for ((a, b), m) in l.iter_mut().zip(r.iter_mut()).zip(mono.iter()) {
                    *a += *m * h.gains.0 * main;
                    *b += *m * h.gains.1 * main;
                }
            }
            let (hl, hr) = (&mut self.left[..n], &mut self.right[..n]);
            for (h, (gl, gr)) in &mut self.hits {
                hl.fill(0.0);
                hr.fill(0.0);
                let wait = h.wait_within(n);
                h.add_to(&mut hl[wait..], &mut hr[wait..], rate);
                for (((a, b), x), y) in l.iter_mut().zip(r.iter_mut()).zip(hl.iter()).zip(hr.iter()) {
                    *a += *x * *gl * main;
                    *b += *y * *gr * main;
                }
            }
            for h in &mut self.samples {
                hl.fill(0.0);
                hr.fill(0.0);
                let start = h.wait.min(n);
                match h.lift {
                    Some(lift) if lift < n => {
                        h.voice.add_to(&mut hl[start..lift], &mut hr[start..lift], rate);
                        h.voice.lift();
                        h.voice.add_to(&mut hl[lift..], &mut hr[lift..], rate);
                        h.lift = Some(0);
                    }
                    lift => {
                        h.voice.add_to(&mut hl[start..], &mut hr[start..], rate);
                        h.lift = lift.map(|l| l - n);
                    }
                }
                h.wait -= start;
                for (((a, b), x), y) in l.iter_mut().zip(r.iter_mut()).zip(hl.iter()).zip(hr.iter()) {
                    *a += *x * h.gains.0 * main;
                    *b += *y * h.gains.1 * main;
                }
            }
            self.ticks.retain_mut(|t| !t.add_to(l, r, rate));
        }
        self.samples.retain(|h| !h.voice.done());
        self.voices.retain(|(v, _)| !v.done());
        self.held.retain(|h| !h.voice.done());
        self.hits.retain(|(h, _)| !h.done());
    }
}

/// Plays a song from a beat, a block at a time. Everything it needs is made when it is made, so `render` allocates
/// nothing and can run on the audio thread.
pub struct Renderer {
    clock: Clock,
    lanes: Vec<Lane>,
    returns: Vec<ReturnLane>,
    /// Main's effects (and what they were made from) and its level.
    main: Option<Chain>,
    main_key: String,
    main_fx_auto: Vec<Move>,
    /// The lanes keying Main's compressors, as a return's `key_from`.
    main_key_from: Vec<Option<usize>>,
    /// Each lane's sound this block (the louder side, with its sign), after its volume and effects and before its pan, for the lanes keying a chain
    /// (empty for the others).
    keys: Vec<Vec<f32>>,
    /// The order lanes are made in: a keying lane before the lanes it keys.
    order: Vec<usize>,
    main_volume: f64,
    /// Main's volume automation (none in the Session view) and its level at each sample of a piece.
    main_auto: Vec<AutoPoint>,
    main_volumes: Vec<f32>,
    /// The next sample to make, counted from the song's start.
    sample: u64,
    peak: (f32, f32),
    /// The loop, in samples: at its end, playing goes back to its start.
    cycle: Option<(u64, u64)>,
    /// The loop's end in beats, where a note running past it is cut.
    cycle_end: f64,
    /// Where the song ends, in samples and in beats.
    end: u64,
    total: f64,
    /// Whether the metronome ticks, and the ticks sounding, at the metronome's own level (not Main's).
    click: bool,
    metronome: f64,
    ticks: Vec<Tick>,
    /// In the Session view, every track's clips and launches (in song order).
    session: Option<Vec<SessionTrack>>,
}

/// What to play: from a beat, round a loop or not, with the metronome or not.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Playing {
    pub from: f64,
    /// The loop's start and end in beats (a whole-song loop is from 0 to the end).
    pub cycle: Option<(f64, f64)>,
    pub click: bool,
    /// The Session view: each track goes round the clip launched on it, instead of the song from `from`.
    pub session: bool,
}

/// A Session slot's clip as it plays: its length in beats, its notes and, on an audio track, its sound.
type SlotPlay = (f64, Vec<Note>, Option<Placed>);

/// A track in the Session view: its slots' clips (length in beats, notes), what it is playing (the slot, from which
/// beat) and the launch waiting for the next bar (a slot, or `None` to stop).
struct SessionTrack {
    id: String,
    /// Its lane, when it is heard.
    lane: Option<usize>,
    /// Each slot's clip: its length in beats, its notes and, on an audio track, its sound.
    slots: Vec<Option<SlotPlay>>,
    playing: Option<(usize, f64)>,
    queued: Option<Option<usize>>,
}

/// What a track of the Session view is doing: playing a slot since a beat, and a launch waiting for the next bar.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct SessionState {
    pub playing: Option<(usize, f64)>,
    pub queued: Option<Option<usize>>,
}

/// A metronome tick (studio-audio.ts `tick`): a sine, 1760 Hz on a bar's first beat and 1320 Hz on the others, falling
/// from 0.28 (or 0.16) to silence over 50 ms and cut at 60 ms.
struct Tick {
    /// Samples until it starts (it may be blocks away), then samples since it started.
    wait: usize,
    time: u64,
    accent: bool,
    /// Through the master (0.8) while a song plays, or straight out for a count-in.
    gain: f64,
}

impl Tick {
    const FALL: f64 = 0.05;
    const LENGTH: f64 = 0.06;

    /// Adds the tick into `out` from its start, and says whether it is over.
    fn add_to(&mut self, left: &mut [f32], right: &mut [f32], rate: f64) -> bool {
        let (freq, level) = if self.accent { (1760.0, 0.28) } else { (1320.0, 0.16) };
        let end = (Tick::LENGTH * rate).ceil() as u64;
        if self.wait >= left.len() {
            self.wait -= left.len();
            return false;
        }
        let wait = std::mem::take(&mut self.wait);
        for (l, r) in left[wait..].iter_mut().zip(right[wait..].iter_mut()) {
            if self.time >= end {
                return true;
            }
            let t = self.time as f64 / rate;
            let gain = level * (0.0001f64 / level).powf((t / Tick::FALL).min(1.0));
            let y = ((std::f64::consts::TAU * freq * t).sin() * gain * self.gain) as f32;
            *l += y;
            *r += y;
            self.time += 1;
        }
        self.time >= end
    }
}

impl Renderer {
    /// Ready to play `song` from `from_beat`, at `sample_rate`.
    #[must_use]
    pub fn new(song: &Song, sample_rate: u32, from_beat: f64) -> Renderer {
        Renderer::playing(song, sample_rate, Playing { from: from_beat, ..Playing::default() })
    }

    /// Ready to play `song` as `how` says, at `sample_rate`. Played from after a loop, it starts at the loop.
    #[must_use]
    pub fn playing(song: &Song, sample_rate: u32, how: Playing) -> Renderer {
        let clock = Clock::new(sample_rate, song.tempo);
        let total = song.beats();
        let cycle = how.cycle.map(|(a, b)| (a.max(0.0), b.min(total))).filter(|(a, b)| b - a > 1e-9);
        // Started past the loop's end, it plays on to the song's end, as Live does; it loops once it is in the loop.
        let from_beat = how.from.max(0.0);
        let start = clock.sample_of_beat(from_beat);
        let heard: Vec<&crate::song::Track> = song.audible().filter(|t| t.instrument_on != Some(false)).collect();
        // The Session view keeps every track's clips, heard or not, so a muted track's clip goes on round.
        let session = how.session.then(|| {
            song.tracks
                .iter()
                .map(|t| SessionTrack {
                    id: t.id.clone(),
                    lane: heard.iter().position(|h| h.id == t.id),
                    slots: t
                        .slots
                        .iter()
                        .map(|c| c.as_ref().filter(|c| c.bars > 0.0).map(|c| (c.bars * BEATS_PER_BAR, c.notes.clone(), placed(song, Song::is_audio(t), c.audio.as_ref()))))
                        .collect(),
                    playing: None,
                    queued: None,
                })
                .collect::<Vec<_>>()
        });
        let returns: Vec<ReturnLane> = song
            .returns
            .iter()
            .take(crate::song::MAX_RETURNS)
            .map(|r| ReturnLane {
                id: r.id.clone(),
                stem: (Vec::new(), Vec::new()),
                volume: if r.muted { 0.0 } else { r.volume },
                pan: r.pan,
                chain: Chain::new(&r.fx, sample_rate, 60.0 / song.tempo, true),
                fx_key: serde_json::to_string(&r.fx).unwrap_or_default(),
                key_from: Vec::new(),
                left: vec![0.0; MAX_BLOCK],
                right: vec![0.0; MAX_BLOCK],
                peak: (0.0, 0.0),
            })
            .collect();
        let lanes: Vec<Lane> = heard
            .into_iter()
            .map(|t| {
                // The Session view plays its clips, not the song's.
                let mut notes = if how.session { Vec::new() } else { Song::notes_of(t) };
                // A note that runs past the loop's end is cut there, so it does not ring over the next time round.
                if let Some((_, to)) = cycle {
                    for n in &mut notes {
                        n.length = n.length.min(to - n.start);
                    }
                }
                // Frozen (38.1.4 "Track Freeze"), Arrange plays its file from the song's start in place of its notes,
                // clips and effects; Session still plays its clips.
                let frozen = t.frozen.as_ref().filter(|_| !how.session).and_then(|f| song.sounds.get(&f.file)).map(|sound| AudioClip {
                    start: 0.0,
                    length: f64::INFINITY,
                    offset: 0.0,
                    cycle: None,
                    placed: Placed::new(&crate::song::Audio { file: String::new(), gain_db: 0.0, offset: 0.0, warp: false, mode: None, bpm: None, transpose: 0.0, markers: Vec::new() }, sound.clone(), song.tempo),
                    stretch: Stretch::default(),
                    fades: false,
                    transpose: Env::default(),
                });
                let is_frozen = frozen.is_some();
                if is_frozen {
                    notes.clear();
                }
                // Arrangement automation (25), not the Session view's.
                let arranged = |name: &str| if how.session { Vec::new() } else { Song::auto_of(t, name) };
                let auto = arranged("volume");
                let pan_auto = arranged("pan");
                // Notes that started before the play position are not caught up: they begin where they begin.
                let next = notes.iter().position(|n| clock.sample_of_beat(n.start) >= start).unwrap_or(notes.len());
                let audio: Vec<AudioClip> = if let Some(frozen) = frozen { vec![frozen] } else if how.session { Vec::new() } else {
                    t.clips
                        .iter()
                        .filter(|c| !c.muted && c.length > 0.0)
                        .filter_map(|c| {
                            Some(AudioClip {
                                start: c.start,
                                length: c.length,
                                offset: c.offset,
                                cycle: c.cycle.filter(|l| l.end > l.start).map(|l| (l.start, l.end)),
                                placed: placed(song, Song::is_audio(t), c.audio.as_ref())?,
                                stretch: Stretch::default(),
                                fades: true,
                                transpose: Env::of(&c.envelopes, &c.unlinked, "transpose"),
                            })
                        })
                        .collect()
                };
                // A sampler track's sound and its drum pads' own sounds, from the files the song has read.
                let samplers = if is_frozen { Samplers::default() } else { Samplers::of(t, &song.sounds) };
                // An audio track's sound comes in with two channels, as a sampler's does.
                let stereo = is_frozen || Song::is_audio(t) || Song::sampler_of(t).is_some() || !samplers.pads.is_empty() || (t.instrument == Instrument::Drums && t.pads.values().any(|p| p.pan.abs() > 1e-9)) || t.chains().iter().any(|c| c.pan.abs() > 1e-9);
                let chain = if is_frozen { None } else { Chain::new(&t.fx, sample_rate, 60.0 / song.tempo, stereo) };
                // Clip envelopes: what they move gets a level for each sample, as automation does.
                let enveloped: std::collections::BTreeSet<&str> = t.clips.iter().map(|c| &c.envelopes).chain(t.slots.iter().flatten().map(|c| &c.envelopes)).flat_map(|e| e.keys().map(String::as_str)).collect();
                // Its modulators, and which of them move what.
                let mods: Vec<(usize, &crate::song::Modulator)> = t.mods.iter().filter(|m| m.on != Some(false) && m.amount.is_finite() && m.amount != 0.0).take(MAX_MODS).enumerate().collect();
                let modding = |name: &str| mods.iter().filter(|(_, m)| m.target == name).map(|(k, _)| *k).collect::<Vec<usize>>();
                let moves = |auto: &[AutoPoint], name: &str| if auto.is_empty() && !enveloped.contains(name) && modding(name).is_empty() { Vec::new() } else { vec![0.0; MAX_BLOCK] };
                // A send that is automated counts even at 0.
                let sends: Vec<Send> = returns
                    .iter()
                    .enumerate()
                    .filter_map(|(to, r)| {
                        let level = t.sends.get(&r.id).copied().unwrap_or(0.0).clamp(0.0, 1.0) as f32;
                        let name = format!("send:{}", r.id);
                        let auto = arranged(&name);
                        (level > 0.0 || !auto.is_empty() || !modding(&name).is_empty()).then(|| Send { to, level, levels: moves(&auto, &name), mods: modding(&name), auto, name })
                    })
                    .collect();
                // Its effect settings that move: by automation, a modulator or a clip envelope.
                let clip_keys = t.clips.iter().map(|c| &c.envelopes).chain(t.slots.iter().flatten().map(|c| &c.envelopes)).flat_map(BTreeMap::keys);
                let fx_auto = fx_moves(chain.as_ref(), &t.fx, t.auto.keys().chain(mods.iter().map(|(_, m)| &m.target)).chain(clip_keys), |name| arranged(name), modding, |name| enveloped.contains(name), 60.0 / song.tempo);
                let mut env_spans: Vec<EnvSpan> = if how.session || is_frozen {
                    Vec::new()
                } else {
                    t.clips
                        .iter()
                        .filter(|c| !c.muted && c.length > 0.0)
                        .filter_map(|c| {
                            Some(EnvSpan { start: c.start, end: c.start + c.length, own: c.offset, cycle: c.cycle.filter(|l| l.end > l.start).map(|l| (l.start, l.end)), env: Envelopes::of(&c.envelopes, &c.unlinked, &sends, &fx_auto)? })
                        })
                        .collect()
                };
                env_spans.sort_by(|a, b| a.start.total_cmp(&b.start));
                let slot_envs = if how.session { t.slots.iter().map(|c| c.as_ref().and_then(|c| Envelopes::of(&c.envelopes, &c.unlinked, &sends, &fx_auto))).collect() } else { Vec::new() };
                Lane {
                    id: t.id.clone(),
                    notes,
                    next,
                    sound: t.sound,
                    instrument: t.instrument,
                    chains: if is_frozen { Vec::new() } else { t.chains().to_vec() },
                    stacked: Vec::with_capacity(MAX_VOICES),
                    mono: vec![0.0; MAX_BLOCK],
                    kit: t.kit.unwrap_or_default(),
                    pads: t.pads.iter().filter_map(|(pitch, pad)| Some((pitch.parse().ok()?, pad.clone()))).collect(),
                    gains: pan_gains(t.pan),
                    volume: t.volume,
                    volumes: moves(&auto, "volume"),
                    auto,
                    pan: t.pan,
                    fx_auto,
                    mods: mods.iter().map(|(_, m)| Mod::new(m, sample_rate)).collect(),
                    volume_mods: modding("volume"),
                    pan_mods: modding("pan"),
                    chain,
                    fx_key: serde_json::to_string(&t.fx).unwrap_or_default(),
                    voices: Vec::with_capacity(MAX_VOICES),
                    hits: Vec::with_capacity(MAX_VOICES),
                    seed: 0x9E37_79B9,
                    scratch: vec![0.0; MAX_BLOCK],
                    scratch_right: vec![0.0; MAX_BLOCK],
                    peak: (0.0, 0.0),
                    sends,
                    env_spans,
                    slot_envs,
                    key_from: Vec::new(),
                    pans: moves(&pan_auto, "pan"),
                    pan_auto,
                    audio,
                    slot_stretch: Stretch::default(),
                    samplers,
                    sample_voices: Vec::with_capacity(MAX_VOICES),
                    stem: (Vec::new(), Vec::new()),
                }
            })
            .collect();
        let mut lanes = lanes;
        let mut returns = returns;
        let main = Chain::new(&song.main.fx, sample_rate, 60.0 / song.tempo, true);
        // Sidechains: which lane keys each chain, each lane's level kept for those that key one, and the lanes in an
        // order that has each keying lane made before the lanes it keys.
        let ids: Vec<String> = lanes.iter().map(|l| l.id.clone()).collect();
        let from = |chain: Option<&Chain>| chain.map_or_else(Vec::new, |c| c.sources().iter().map(|id| ids.iter().position(|i| i == id)).collect::<Vec<_>>());
        for lane in &mut lanes {
            lane.key_from = from(lane.chain.as_ref());
        }
        for ret in &mut returns {
            ret.key_from = from(ret.chain.as_ref());
        }
        let main_key_from = from(main.as_ref());
        let keying: Vec<bool> = (0..lanes.len()).map(|j| lanes.iter().map(|l| &l.key_from).chain(returns.iter().map(|r| &r.key_from)).chain([&main_key_from]).any(|k| k.contains(&Some(j)))).collect();
        let keys = keying.iter().map(|&k| if k { vec![0.0; MAX_BLOCK] } else { Vec::new() }).collect();
        let order = keyed_order(&lanes.iter().map(|l| l.key_from.iter().flatten().copied().collect()).collect::<Vec<Vec<usize>>>());
        let main_fx_auto = fx_moves(main.as_ref(), &song.main.fx, song.main.auto.keys(), |name| if how.session { Vec::new() } else { song.main_auto_of(name) }, |_| Vec::new(), |_| false, 60.0 / song.tempo);
        Renderer {
            clock,
            lanes,
            returns,
            main,
            main_fx_auto,
            main_key_from,
            keys,
            order,
            main_key: serde_json::to_string(&song.main.fx).unwrap_or_default(),
            main_volume: song.main.volume.max(0.0),
            main_auto: if how.session { Vec::new() } else { song.main_auto_of("volume") },
            main_volumes: vec![0.0; MAX_BLOCK],
            metronome: song.metronome.volume.clamp(0.0, 1.0),
            sample: start,
            peak: (0.0, 0.0),
            cycle: cycle.filter(|_| !how.session).map(|(a, b)| (clock.sample_of_beat(a), clock.sample_of_beat(b))),
            cycle_end: cycle.filter(|_| !how.session).map_or(f64::INFINITY, |(_, b)| b),
            // The Session view has no end.
            end: if how.session { u64::MAX } else { clock.sample_of_beat(total) },
            total: if how.session { f64::INFINITY } else { total },
            click: how.click,
            ticks: Vec::with_capacity(8),
            session,
        }
    }

    /// The same renderer keeping each track's and return's own sound, for stems ([`Renderer::stems`]).
    #[must_use]
    pub fn with_stems(mut self) -> Renderer {
        for lane in &mut self.lanes {
            lane.stem = (vec![0.0; MAX_BLOCK], vec![0.0; MAX_BLOCK]);
        }
        for ret in &mut self.returns {
            ret.stem = (vec![0.0; MAX_BLOCK], vec![0.0; MAX_BLOCK]);
        }
        self
    }

    /// After a `render` of `frames` (at most [`MAX_BLOCK`], with no loop or Session view, so it is made in one piece),
    /// what each track heard and then each return put into Main, in [`Renderer::track_ids`] order: post-fader, before
    /// Main's effects and level (Live 12 manual, 5.1.3.1 "Selection Options": All Individual Tracks).
    pub fn stems(&self, frames: usize) -> impl Iterator<Item = (&[f32], &[f32])> {
        let n = frames.min(MAX_BLOCK);
        self.lanes.iter().map(|l| &l.stem).chain(self.returns.iter().map(|r| &r.stem)).map(move |(l, r)| (&l[..n.min(l.len())], &r[..n.min(r.len())]))
    }

    /// The tracks heard, then the returns, in the order `peaks` gives their levels.
    pub fn track_ids(&self) -> impl Iterator<Item = &str> {
        self.lanes.iter().map(|l| l.id.as_str()).chain(self.returns.iter().map(|r| r.id.as_str()))
    }

    /// Listens to the parts of one effect (by its [`crate::fx::fx_key`]) on the lane at `lane`, or to none.
    pub fn watch(&mut self, watch: Option<(usize, u64)>) {
        for (i, lane) in self.lanes.iter_mut().enumerate() {
            if let Some(chain) = &mut lane.chain {
                chain.watch(watch.filter(|(l, _)| *l == i).map(|(_, key)| key));
            }
        }
    }

    /// The levels of the parts listened to on the lane at `lane` since last asked (see [`crate::fx::Chain::levels`]).
    pub fn part_levels(&mut self, lane: usize, level: impl FnMut(usize, f64)) {
        if let Some(chain) = self.lanes.get_mut(lane).and_then(|l| l.chain.as_mut()) {
            chain.levels(level);
        }
    }

    /// Each track's loudest sample in the last block (left, right), then each return's, then Main's.
    pub fn peaks(&self) -> impl Iterator<Item = (f32, f32)> + '_ {
        self.lanes.iter().map(|l| l.peak).chain(self.returns.iter().map(|r| r.peak)).chain(std::iter::once(self.peak))
    }

    /// In the Session view, each track's id and what it is doing, in song order.
    pub fn session(&self) -> impl Iterator<Item = (&str, SessionState)> {
        self.session.iter().flatten().map(|t| (t.id.as_str(), SessionState { playing: t.playing, queued: t.queued }))
    }

    /// In the Session view, starts track `index`'s clip in `slot` (or stops it, with `None`) at the next bar line;
    /// on a bar line, at once.
    pub fn launch(&mut self, index: usize, slot: Option<usize>) {
        let on_bar = self.clock.sample_of_beat(self.bar_at_or_after(self.sample)) == self.sample;
        if let Some(track) = self.session.as_mut().and_then(|s| s.get_mut(index)) {
            track.queued = Some(slot);
        }
        if on_bar {
            self.land();
        }
    }

    /// The first bar line (in beats) on or after `sample`.
    fn bar_at_or_after(&self, sample: u64) -> f64 {
        let beat = self.clock.beat(sample);
        let mut bar = (beat / BEATS_PER_BAR).floor().max(0.0) * BEATS_PER_BAR;
        while self.clock.sample_of_beat(bar) < sample {
            bar += BEATS_PER_BAR;
        }
        bar
    }

    /// The launches waiting land now, on a bar line.
    fn land(&mut self) {
        let at = self.clock.beat(self.sample);
        let at = (at / BEATS_PER_BAR).round() * BEATS_PER_BAR;
        for track in self.session.iter_mut().flatten() {
            if let Some(slot) = track.queued.take() {
                track.playing = slot.filter(|s| track.slots.get(*s).is_some_and(Option::is_some)).map(|s| (s, at));
            }
        }
    }

    /// Takes over the notes still sounding in `old`, track by track, so a song changed while it plays does not cut
    /// what is ringing. Nothing is allocated: the voice lists are swapped.
    pub fn adopt(&mut self, old: &mut Renderer) {
        for lane in &mut self.lanes {
            if let Some(was) = old.lanes.iter_mut().find(|w| w.id == lane.id) {
                std::mem::swap(&mut lane.voices, &mut was.voices);
                std::mem::swap(&mut lane.hits, &mut was.hits);
                std::mem::swap(&mut lane.sample_voices, &mut was.sample_voices);
                std::mem::swap(&mut lane.stacked, &mut was.stacked);
                // Effects that are just as they were keep their echoes and rooms ringing.
                if lane.fx_key == was.fx_key && lane.chain.is_some() {
                    std::mem::swap(&mut lane.chain, &mut was.chain);
                    let_go(lane.chain.as_mut(), was.chain.as_ref(), &was.fx_auto);
                }
            }
        }
        for ret in &mut self.returns {
            if let Some(was) = old.returns.iter_mut().find(|w| w.id == ret.id && w.fx_key == ret.fx_key) {
                std::mem::swap(&mut ret.chain, &mut was.chain);
            }
        }
        if self.main_key == old.main_key {
            std::mem::swap(&mut self.main, &mut old.main);
            let_go(self.main.as_mut(), old.main.as_ref(), &old.main_fx_auto);
        }
        // The Session view's clips go on where they were.
        if let (Some(new), Some(old)) = (self.session.as_mut(), old.session.as_ref()) {
            for track in new {
                if let Some(was) = old.iter().find(|w| w.id == track.id) {
                    track.playing = was.playing.filter(|(s, _)| track.slots.get(*s).is_some_and(Option::is_some));
                    track.queued = was.queued;
                }
            }
        }
    }

    /// The beat the next sample is on.
    #[must_use]
    pub fn beat(&self) -> f64 {
        self.clock.beat(self.sample)
    }

    /// Whether it has played to the song's end (never, round a loop): what is ringing still rings out.
    #[must_use]
    pub fn past_end(&self) -> bool {
        self.sample >= self.end && self.cycle.is_none_or(|(_, to)| self.sample > to)
    }

    /// Whether it has played past the song's end and the tail after it, so nothing more will sound.
    #[must_use]
    pub fn finished(&self) -> bool {
        self.past_end() && self.sample >= self.end + (RENDER_TAIL * self.clock.sample_rate) as u64
    }

    /// Makes the next block: `left` and `right` are overwritten, and must be the same length.
    pub fn render(&mut self, left: &mut [f32], right: &mut [f32]) {
        let frames = left.len().min(right.len());
        self.peak = (0.0, 0.0);
        for lane in &mut self.lanes {
            lane.peak = (0.0, 0.0);
        }
        for ret in &mut self.returns {
            ret.peak = (0.0, 0.0);
        }
        let mut done = 0;
        while done < frames {
            let mut n = (frames - done).min(MAX_BLOCK);
            // A piece stops at the loop's end, and playing goes back to the loop's start.
            let in_loop = self.cycle.is_some_and(|(_, to)| self.sample < to);
            if let Some((_, to)) = self.cycle.filter(|_| in_loop) {
                n = n.min(usize::try_from(to - self.sample).unwrap_or(usize::MAX));
            }
            // In the Session view a piece stops at the next bar line, where launches land.
            let mut bar = None;
            if self.session.is_some() {
                let next = self.clock.sample_of_beat(self.bar_at_or_after(self.sample + 1));
                if next - self.sample <= n as u64 {
                    n = usize::try_from(next - self.sample).unwrap_or(n);
                    bar = Some(next);
                }
            }
            self.piece(&mut left[done..done + n], &mut right[done..done + n]);
            done += n;
            if bar == Some(self.sample) {
                self.land();
            }
            if let Some((from, to)) = self.cycle.filter(|_| in_loop) {
                if self.sample >= to {
                    self.go_to(from);
                }
            }
        }
    }

    /// Moves to `sample`: the next notes are the first at or after it.
    fn go_to(&mut self, sample: u64) {
        self.sample = sample;
        let clock = self.clock;
        for lane in &mut self.lanes {
            lane.next = lane.notes.iter().position(|n| clock.sample_of_beat(n.start) >= sample).unwrap_or(lane.notes.len());
        }
    }

    fn piece(&mut self, left: &mut [f32], right: &mut [f32]) {
        left.fill(0.0);
        right.fill(0.0);
        let frames = left.len();
        let rate = self.clock.sample_rate;
        let spb = self.clock.seconds_per_beat();
        let (from, to) = (self.sample, self.sample + frames as u64);
        let clock = self.clock;
        if self.main_auto.is_empty() {
            self.main_volumes[..frames].fill(self.main_volume as f32);
        } else {
            fill_auto(&self.main_auto, |i| clock.beat(from + i as u64), &mut self.main_volumes[..frames], self.main_volume);
            for v in &mut self.main_volumes[..frames] {
                *v = v.max(0.0);
            }
        }
        let mains = &self.main_volumes[..frames];
        for ret in &mut self.returns {
            ret.left[..frames].fill(0.0);
            ret.right[..frames].fill(0.0);
        }
        let returns = &mut self.returns;
        // A track's sound into Main (before Main's effects and level) and on to its returns; its meter reads it at
        // Main's level, as it is heard with no effects on Main.
        let out = |peak: &mut (f32, f32), stem: &mut (Vec<f32>, Vec<f32>), sends: &[Send], returns: &mut [ReturnLane], i: usize, (l, r): (f32, f32), left: &mut [f32], right: &mut [f32]| {
            *peak = (peak.0.max((l * mains[i]).abs()), peak.1.max((r * mains[i]).abs()));
            if !stem.0.is_empty() {
                stem.0[i] = l;
                stem.1[i] = r;
            }
            left[i] += l;
            right[i] += r;
            for send in sends {
                let level = send.at(i);
                returns[send.to].left[i] += l * level;
                returns[send.to].right[i] += r * level;
            }
        };
        for &index in &self.order {
            let lane = &mut self.lanes[index];
            // The clip the Session view is playing on this track, if any.
            let clip = self.session.as_ref().and_then(|s| s.iter().find(|t| t.lane == Some(index))).and_then(|t| {
                let (slot, start) = t.playing?;
                let (length, notes, audio) = t.slots.get(slot)?.as_ref()?;
                Some((*length, notes, start, audio.as_ref(), slot))
            });
            lane.scratch[..frames].fill(0.0);
            // Voices already sounding, for the whole block.
            for voice in &mut lane.voices {
                voice.add_to(&mut lane.scratch[..frames], rate);
            }
            // Notes starting in this block, each from its own sample. Drum hits wait for the second pass: they can be
            // panned, so they go in after the voices are copied to the right.
            while let Some(note) = lane.notes.get(lane.next) {
                let at = self.clock.sample_of_beat(note.start);
                if at >= to {
                    break;
                }
                lane.next += 1;
                let offset = usize::try_from(at.saturating_sub(from)).unwrap_or(frames).min(frames);
                let note = *note;
                lane.start(&note, offset, frames, spb, rate);
            }
            if let Some((length, notes, start, _, _)) = clip {
                // Each time round the clip that a note starts in this piece; it is cut at the clip's end.
                let from_beat = clock.beat(from);
                for note in notes {
                    let first = ((from_beat - start - note.start) / length - 1e-9).ceil().max(0.0);
                    let mut at = start + note.start + first * length;
                    while clock.sample_of_beat(at) < to {
                        let sample = clock.sample_of_beat(at);
                        if sample >= from {
                            let offset = usize::try_from(sample - from).unwrap_or(frames).min(frames);
                            let held = Note { length: note.length.min(length - note.start), ..*note };
                            lane.start(&held, offset, frames, spb, rate);
                        }
                        at += length;
                    }
                }
            }
            lane.voices.retain(|v| !v.done());
            // The volume, pan and sends at each sample, where they move: to the sample (25).
            let beat_of = |i: usize| clock.beat(from + i as u64);
            if !lane.volumes.is_empty() {
                fill_auto(&lane.auto, beat_of, &mut lane.volumes[..frames], lane.volume);
            }
            if !lane.pans.is_empty() {
                fill_auto(&lane.pan_auto, beat_of, &mut lane.pans[..frames], lane.pan);
            }
            for send in lane.sends.iter_mut().filter(|s| !s.levels.is_empty()) {
                fill_auto(&send.auto, beat_of, &mut send.levels[..frames], f64::from(send.level));
            }
            // Then the playing clip's envelopes move them, relative to where they are (27).
            lane.modulate(beat_of, frames, clip.map(|(length, _, start, _, slot)| (length, start, slot)));
            let scratch = &mut lane.scratch[..frames];
            let right_scratch = &mut lane.scratch_right[..frames];
            right_scratch.copy_from_slice(scratch);
            for hit in &mut lane.hits {
                let offset = hit.take_wait().min(frames);
                hit.add_to(&mut scratch[offset..], &mut right_scratch[offset..], rate);
            }
            lane.hits.retain(|h| !h.done());
            for (voice, wait, _) in &mut lane.sample_voices {
                let offset = std::mem::take(wait).min(frames);
                voice.add_to(&mut scratch[offset..], &mut right_scratch[offset..], rate);
            }
            lane.sample_voices.retain(|(v, _, _)| !v.done());
            for (voice, (gl, gr), wait) in &mut lane.stacked {
                let offset = std::mem::take(wait).min(frames);
                let mono = &mut lane.mono[..frames];
                mono.fill(0.0);
                voice.add_to(&mut mono[offset..], rate);
                for i in offset..frames {
                    scratch[i] += mono[i] * *gl;
                    right_scratch[i] += mono[i] * *gr;
                }
            }
            lane.stacked.retain(|(v, _, _)| !v.done());
            // Audio clips, sample by sample at the file's frame for each beat.
            let slot_audio = clip.and_then(|(length, _, start, audio, slot)| Some((length, start, audio?, slot)));
            if !lane.audio.is_empty() || slot_audio.is_some() {
                // A Session clip's transposition envelope, as it goes round.
                let slot_transpose = slot_audio.and_then(|(_, _, _, slot)| lane.slot_envs.get(slot)?.as_ref()).map(|e| &e.transpose).filter(|e| !e.is_empty());
                for i in 0..frames {
                    let beat = clock.beat(from + i as u64);
                    for c in &mut lane.audio {
                        if let Some((own, fade)) = c.own_beat(beat, spb) {
                            let more = if c.transpose.is_empty() { 0.0 } else { c.transpose.at(own, beat - c.start) };
                            let (l, r) = c.placed.at_transposed(own, &mut c.stretch, more);
                            scratch[i] += l * fade;
                            right_scratch[i] += r * fade;
                        }
                    }
                    if let Some((length, start, placed, _)) = slot_audio {
                        if beat >= start {
                            let own = (beat - start).rem_euclid(length);
                            let more = slot_transpose.map_or(0.0, |e| e.at(own, beat - start));
                            let (l, r) = placed.at_transposed(own, &mut lane.slot_stretch, more);
                            scratch[i] += l;
                            right_scratch[i] += r;
                        }
                    }
                }
            }
            // Its modulators, from the sound as it is now (before its volume), then what they move.
            if !lane.mods.is_empty() {
                let moving = Moving { volumes: &mut lane.volumes, pans: &mut lane.pans, sends: &mut lane.sends, volume_mods: &lane.volume_mods, pan_mods: &lane.pan_mods };
                run_mods(&mut lane.mods, (scratch, right_scratch), moving, &clock, from, frames);
            }
            if let Some(chain) = &mut lane.chain {
                // The track's way into the mix, as the window's: its volume, then its effects, then its pan.
                for (i, (a, b)) in scratch.iter_mut().zip(right_scratch.iter_mut()).enumerate() {
                    let v = if lane.volumes.is_empty() { lane.volume as f32 } else { lane.volumes[i] };
                    *a *= v;
                    *b *= v;
                }
                let playing = playing_slot(&lane.slot_envs, clip.map(|(length, _, start, _, slot)| (length, start, slot))).flatten();
                let env_spans = &lane.env_spans;
                let setting = |k: usize, beat: f64| {
                    let (env, own, played) = clip_at(env_spans, playing, beat)?;
                    env.settings.get(k).filter(|e| !e.is_empty()).map(|e| e.at(own, played))
                };
                run_chain(chain, &lane.fx_auto, &lane.mods, scratch, right_scratch, rate, beat_of, &key_slices(&self.keys, &lane.key_from, frames), setting);
                let key = &mut self.keys[index];
                for i in 0..frames {
                    let (a, b) = (f64::from(scratch[i]), f64::from(right_scratch[i]));
                    if !key.is_empty() {
                        // The louder side, keeping its sign so a sidechain EQ can filter it.
                        key[i] = if scratch[i].abs() >= right_scratch[i].abs() { scratch[i] } else { right_scratch[i] };
                    }
                    let p = if lane.pans.is_empty() { lane.pan } else { f64::from(lane.pans[i]) };
                    let (a, b) = balance(a, b, p);
                    out(&mut lane.peak, &mut lane.stem, &lane.sends, returns, i, (a as f32, b as f32), left, right);
                }
                continue;
            }
            for i in 0..frames {
                let (a, b) = (f64::from(scratch[i]), f64::from(right_scratch[i]));
                let volume = if lane.volumes.is_empty() { lane.volume } else { f64::from(lane.volumes[i]) };
                let p = if lane.pans.is_empty() { lane.pan } else { f64::from(lane.pans[i]) };
                if let Some(k) = self.keys[index].get_mut(i) {
                    *k = ((if a.abs() >= b.abs() { a } else { b }) * volume) as f32;
                }
                // Each side keeps its own channel (a mono sound has the same on both).
                let (gl, gr) = if lane.pans.is_empty() { lane.gains } else { pan_gains(p) };
                let (l, r) = (a * gl * volume, b * gr * volume);
                out(&mut lane.peak, &mut lane.stem, &lane.sends, returns, i, (l as f32, r as f32), left, right);
            }
        }
        // Each return: what was sent to it, through its effects, then its volume and pan, into Main.
        for ret in returns.iter_mut() {
            let (rl, rr) = (&mut ret.left[..frames], &mut ret.right[..frames]);
            if let Some(chain) = &mut ret.chain {
                chain.set_clock(clock.beat(from), clock.beat(from + 1) - clock.beat(from));
                chain.process_keyed(rl, rr, rate, &key_slices(&self.keys, &ret.key_from, frames));
            }
            for i in 0..frames {
                let (a, b) = (f64::from(rl[i]) * ret.volume, f64::from(rr[i]) * ret.volume);
                let (a, b) = balance(a, b, ret.pan);
                let (l, r) = (a as f32, b as f32);
                ret.peak = (ret.peak.0.max((l * mains[i]).abs()), ret.peak.1.max((r * mains[i]).abs()));
                if !ret.stem.0.is_empty() {
                    ret.stem.0[i] = l;
                    ret.stem.1[i] = r;
                }
                left[i] += l;
                right[i] += r;
            }
        }
        // Main: its effects, then its level.
        if let Some(chain) = &mut self.main {
            run_chain(chain, &self.main_fx_auto, &[], left, right, rate, |i| clock.beat(from + i as u64), &key_slices(&self.keys, &self.main_key_from, frames), |_, _| None);
        }
        for ((l, r), v) in left.iter_mut().zip(right.iter_mut()).zip(&self.main_volumes) {
            *l *= v;
            *r *= v;
        }
        // The metronome, on each beat in this piece (inside the song), straight to the master.
        if self.click {
            let clock = self.clock;
            let mut beat = clock.beat(from).floor().max(0.0);
            while clock.sample_of_beat(beat) < from {
                beat += 1.0;
            }
            while clock.sample_of_beat(beat) < to && beat < self.end_beat() {
                if self.ticks.len() >= self.ticks.capacity() {
                    self.ticks.remove(0);
                }
                let wait = usize::try_from(clock.sample_of_beat(beat) - from).unwrap_or(0);
                self.ticks.push(Tick { wait, time: 0, accent: beat.rem_euclid(BEATS_PER_BAR) < 1e-9, gain: self.metronome });
                beat += 1.0;
            }
        }
        self.ticks.retain_mut(|t| !t.add_to(left, right, rate));
        for (l, r) in left.iter().zip(right.iter()) {
            self.peak = (self.peak.0.max(l.abs()), self.peak.1.max(r.abs()));
        }
        self.sample = to;
    }
}

impl Renderer {
    /// Where the song (or the loop) ends, in beats.
    fn end_beat(&self) -> f64 {
        // Past the loop's end (started there), the song's.
        let in_loop = self.cycle.is_some_and(|(_, to)| self.sample < to);
        if in_loop { self.cycle_end.min(self.total) } else { self.total }
    }
}

/// An audio clip's sound placed on its beats, when it is on an audio track and its file was read.
fn placed(song: &Song, audio_track: bool, audio: Option<&crate::song::Audio>) -> Option<Placed> {
    let audio = audio.filter(|_| audio_track)?;
    Some(Placed::new(audio, song.sounds.get(&audio.file)?.clone(), song.tempo))
}

/// How many frames a render of the whole song makes: to its end and its tail.
#[must_use]
pub fn song_frames(song: &Song, sample_rate: u32) -> usize {
    let seconds = song.beats() * 60.0 / song.tempo + RENDER_TAIL;
    (seconds * f64::from(sample_rate)).ceil() as usize
}

/// The whole song as stereo sound, from its start to its end and its tail.
#[must_use]
pub fn render_song(song: &Song, sample_rate: u32) -> (Vec<f32>, Vec<f32>) {
    let frames = song_frames(song, sample_rate);
    let (mut left, mut right) = (vec![0f32; frames], vec![0f32; frames]);
    let mut renderer = Renderer::new(song, sample_rate, 0.0);
    for (l, r) in left.chunks_mut(512).zip(right.chunks_mut(512)) {
        renderer.render(l, r);
    }
    (left, right)
}

/// The effect settings of a chain that move (`"fx:<effect id>:<setting>"` among `names`), each with where it lives
/// in `chain`, its automation (`points` gives a name's, none when overridden) and the modulators on it (`mods`); one
/// the chain can't move is left out.
#[allow(clippy::too_many_arguments)]
fn fx_moves<'a>(chain: Option<&Chain>, fx: &[serde_json::Value], names: impl Iterator<Item = &'a String>, points: impl Fn(&str) -> Vec<AutoPoint>, mods: impl Fn(&str) -> Vec<usize>, enveloped: impl Fn(&str) -> bool, seconds_per_beat: f64) -> Vec<Move> {
    let Some(chain) = chain else { return Vec::new() };
    let mut seen = std::collections::BTreeSet::new();
    names
        .filter(|name| seen.insert(name.as_str()))
        .filter_map(|name| {
            let (id, setting) = name.strip_prefix("fx:")?.split_once(':')?;
            let aim = chain.aim(fx, id, setting, seconds_per_beat)?;
            let (points, mods) = (points(name), mods(name));
            (!points.is_empty() || !mods.is_empty() || enveloped(name)).then(|| Move { name: name.clone(), aim, rest: chain.get(aim), points, mods })
        })
        .collect()
}

/// Runs a block through `chain`, moving its automated settings at the start of each 128-sample piece (where its
/// devices take their settings, as Web Audio's do).
#[allow(clippy::too_many_arguments)]
fn run_chain(chain: &mut Chain, autos: &[Move], mods: &[Mod], left: &mut [f32], right: &mut [f32], rate: f64, beat_of: impl Fn(usize) -> f64, keys: &Keys<'_>, clip: impl Fn(usize, f64) -> Option<f64>) {
    let n = left.len().min(right.len());
    let per = if n > 1 { beat_of(1) - beat_of(0) } else { 0.0 };
    if autos.is_empty() {
        chain.set_clock(beat_of(0), per);
        chain.process_keyed(left, right, rate, &keys.0[..keys.1]);
        return;
    }
    let mut done = 0;
    while done < n {
        let m = (n - done).min(QUANTUM);
        for (k, m) in autos.iter().enumerate() {
            // A clip envelope of the setting, while its clip plays, puts it where it draws; else its automation does.
            let beat = beat_of(done);
            let at = clip(k, beat).unwrap_or_else(|| if m.points.is_empty() { m.rest } else { auto_value_at(&m.points, beat, m.rest) });
            let moved: f64 = m.mods.iter().filter_map(|&k| mods.get(k)).map(|k| k.amount * f64::from(k.values[done])).sum();
            chain.set(m.aim, at + moved);
        }
        let mut piece: [&[f32]; MAX_SOURCES] = [&[]; MAX_SOURCES];
        for (to, key) in piece.iter_mut().zip(&keys.0[..keys.1]) {
            *to = key.get(done..done + m).unwrap_or(&[]);
        }
        chain.set_clock(beat_of(done), per);
        chain.process_keyed(&mut left[done..done + m], &mut right[done..done + m], rate, &piece[..keys.1]);
        done += m;
    }
}

/// The most tracks one chain can be keyed by (one for each of its effects).
const MAX_SOURCES: usize = 16;

/// The levels of the lanes keying a chain, in its sources' order, and how many: on the stack, as the audio thread
/// allocates nothing.
struct Keys<'a>([&'a [f32]; MAX_SOURCES], usize);

impl<'a> std::ops::Deref for Keys<'a> {
    type Target = [&'a [f32]];
    fn deref(&self) -> &Self::Target {
        &self.0[..self.1]
    }
}

/// This block's levels of the lanes `from` names (a lane not heard, or keying nothing, is left empty: silent).
fn key_slices<'a>(keys: &'a [Vec<f32>], from: &[Option<usize>], frames: usize) -> Keys<'a> {
    let mut out: [&[f32]; MAX_SOURCES] = [&[]; MAX_SOURCES];
    for (to, j) in out.iter_mut().zip(from) {
        *to = j.and_then(|j| keys.get(j)).and_then(|k| k.get(..frames)).unwrap_or(&[]);
    }
    Keys(out, from.len().min(MAX_SOURCES))
}

/// An order for lanes where each lane named in another's `keyed_by` comes first; lanes keyed round in a circle go last,
/// in their own order, hearing the last block's level.
fn keyed_order(keyed_by: &[Vec<usize>]) -> Vec<usize> {
    let n = keyed_by.len();
    let mut done = vec![false; n];
    let mut order = Vec::with_capacity(n);
    loop {
        let before = order.len();
        for i in 0..n {
            if !done[i] && keyed_by[i].iter().all(|&j| j >= n || done[j] || j == i) {
                done[i] = true;
                order.push(i);
            }
        }
        if order.len() == before {
            break;
        }
    }
    order.extend((0..n).filter(|&i| !done[i]));
    order
}

/// After a chain kept ringing through a change of song, its settings that were automated go back to the new song's,
/// as `fresh` (made from it) has them; any the song still automates are set again at the next piece.
fn let_go(kept: Option<&mut Chain>, fresh: Option<&Chain>, autos: &[Move]) {
    if let (Some(kept), Some(fresh)) = (kept, fresh) {
        for m in autos {
            kept.copy_setting(fresh, m.aim);
        }
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    fn song(tracks: &str) -> Song {
        Song::parse(&format!(r#"{{"version":2,"tempo":120,"bars":1,"tracks":[{tracks}]}}"#)).unwrap()
    }

    /// The first sample louder than `level`.
    fn onset(samples: &[f32], level: f32) -> Option<usize> {
        samples.iter().position(|s| s.abs() > level)
    }

    #[test]
    fn a_note_starts_on_its_beat_to_the_sample_whatever_the_block_size() {
        let s = song(r#"{"id":"t","instrument":"lead","clips":[{"id":"c","start":0,"length":4,"notes":[{"pitch":72,"start":1.25,"length":0.5,"velocity":1}]}]}"#);
        let whole = render_song(&s, 48_000).0;
        // A beat at 120 is half a second: 1.25 beats is sample 30,000.
        let first = onset(&whole, 1e-6).unwrap();
        assert!((30_000..30_010).contains(&first), "{first}");
        let mut odd = Renderer::new(&s, 48_000, 0.0);
        let (mut l, mut r) = (vec![0f32; whole.len()], vec![0f32; whole.len()]);
        for (a, b) in l.chunks_mut(333).zip(r.chunks_mut(333)) {
            odd.render(a, b);
        }
        assert_eq!(l, whole);
    }

    #[test]
    fn a_stacks_chains_play_their_own_zones_each_panned_on_its_own() {
        let sound = r#""sound":{"shape":0,"detune":0,"sub":0,"drive":0,"cutoff":12000,"resonance":0,"envAmount":0,"attack":0.001,"decay":0.1,"sustain":1,"release":0.02,"vibrato":0,"rate":5}"#;
        let notes = r#""notes":[{"pitch":48,"start":0,"length":0.5,"velocity":1},{"pitch":72,"start":1,"length":0.5,"velocity":1},{"pitch":72,"start":2,"length":0.5,"velocity":0.3}]"#;
        let stack = format!(r#""stack":{{"chains":[
            {{"instrument":"lead",{sound},"keys":{{"low":0,"high":59}},"pan":-1}},
            {{"instrument":"lead",{sound},"keys":{{"low":60,"high":127}},"velocities":{{"low":64,"high":127}},"pan":1}},
            {{"instrument":"lead",{sound},"muted":true}}]}}"#);
        let (l, r) = render_song(&song(&format!(r#"{{"id":"t","instrument":"piano",{stack},{notes}}}"#)), 48_000);
        let rms = |s: &[f32]| (s.iter().map(|x| f64::from(*x).powi(2)).sum::<f64>() / s.len() as f64).sqrt();
        // The low note is the low chain's, hard left; the high one the high chain's, hard right.
        assert!(rms(&l[0..12_000]) > 0.05 && rms(&r[0..12_000]) < 1e-6);
        assert!(rms(&r[24_000..36_000]) > 0.05 && rms(&l[24_000..36_000]) < 1e-6);
        // The soft high note is in no chain's zones: nothing plays it, not even the track's own piano.
        assert!(rms(&l[49_000..60_000]) < 1e-6 && rms(&r[49_000..60_000]) < 1e-6);
        // One chain in the middle at full volume is the track's own instrument with that sound, to the sample.
        let one = render_song(&song(&format!(r#"{{"id":"t","instrument":"piano","stack":{{"chains":[{{"instrument":"lead",{sound}}}]}},{notes}}}"#)), 48_000);
        let plain = render_song(&song(&format!(r#"{{"id":"t","instrument":"lead",{sound},{notes}}}"#)), 48_000);
        assert_eq!(one, plain);
        // A chain's volume scales it, and an empty stack plays the track's own instrument.
        let half = render_song(&song(&format!(r#"{{"id":"t","instrument":"piano","stack":{{"chains":[{{"instrument":"lead",{sound},"volume":0.5}}]}},{notes}}}"#)), 48_000);
        assert!(half.0.iter().zip(&plain.0).all(|(a, b)| (a - b * 0.5).abs() < 1e-6));
        let empty = render_song(&song(&format!(r#"{{"id":"t","instrument":"lead",{sound},"stack":{{"chains":[]}},{notes}}}"#)), 48_000);
        assert_eq!(empty, plain);
    }

    #[test]
    fn drums_hit_on_their_beat_whatever_the_block_size_and_a_panned_pad_leans() {
        let s = song(r#"{"id":"d","instrument":"drums","pads":{"42":{"tune":0,"decay":1,"level":1,"pan":1}},"notes":[{"pitch":36,"start":0,"length":0.25,"velocity":1},{"pitch":42,"start":1.5,"length":0.25,"velocity":1}]}"#);
        let (left, right) = render_song(&s, 48_000);
        let mut r = Renderer::new(&s, 48_000, 0.0);
        let (mut l2, mut r2) = (vec![0.0f32; left.len()], vec![0.0f32; left.len()]);
        for (a, b) in l2.chunks_mut(333).zip(r2.chunks_mut(333)) {
            r.render(a, b);
        }
        assert_eq!(left, l2);
        assert_eq!(right, r2);
        // The kick is in both sides from its first sample; the hat, panned right at 1.5 beats (36 000 samples), only right.
        assert!(left[0] == 0.0 && left[10].abs() > 0.0 && right[10].abs() > 0.0);
        assert!(left[36_000..38_000].iter().all(|x| x.abs() < 1e-6));
        assert!(right[36_000..38_000].iter().any(|x| x.abs() > 0.01));
    }

    #[test]
    fn volume_pan_mute_and_solo_are_heard() {
        let track = |id: &str, extra: &str| format!(r#"{{"id":"{id}","instrument":"bass","volume":0.5,{extra}"notes":[{{"pitch":45,"start":0,"length":1,"velocity":1}}]}}"#);
        let peak = |v: &[f32]| v.iter().fold(0f32, |m, s| m.max(s.abs()));
        let centre = render_song(&song(&track("a", "")), 48_000);
        let left = render_song(&song(&track("a", r#""pan":-1,"#)), 48_000);
        assert!(peak(&left.0) > 0.01 && peak(&left.1) < 1e-6);
        // Hard left is 3 dB up on that side (Live's pan law).
        assert!((peak(&left.0) / peak(&centre.0) - std::f32::consts::SQRT_2).abs() < 0.02);
        let muted = render_song(&song(&track("a", r#""muted":true,"#)), 48_000);
        assert_eq!(peak(&muted.0), 0.0);
        let solo = render_song(&song(&format!("{},{}", track("a", r#""solo":true,"#), track("b", ""))), 48_000);
        assert!((peak(&solo.0) - peak(&centre.0)).abs() < 1e-6);
    }

    #[test]
    fn a_song_changed_while_playing_keeps_its_ringing_notes_and_reports_levels() {
        let s = song(r#"{"id":"t","instrument":"pad","notes":[{"pitch":60,"start":0,"length":4,"velocity":1}]}"#);
        let mut old = Renderer::new(&s, 48_000, 0.0);
        let (mut l, mut r) = (vec![0f32; 9_600], vec![0f32; 9_600]);
        old.render(&mut l, &mut r);
        let (track, master) = (old.peaks().next().unwrap(), old.peaks().last().unwrap());
        assert!(track.0 > 0.01 && (track.0 - master.0).abs() < 1e-6);
        // The same song from where it had got to: without the old voices it would be silent until the next note.
        let mut new = Renderer::new(&s, 48_000, old.beat());
        new.adopt(&mut old);
        new.render(&mut l, &mut r);
        assert!(l.iter().any(|x| x.abs() > 0.01));
        assert_eq!(new.track_ids().collect::<Vec<_>>(), ["t"]);
    }

    #[test]
    fn playing_from_a_beat_leaves_out_what_came_before() {
        let s = song(r#"{"id":"t","instrument":"piano","notes":[{"pitch":60,"start":0,"length":1,"velocity":1},{"pitch":64,"start":2,"length":1,"velocity":1}]}"#);
        let mut from_two = Renderer::new(&s, 48_000, 2.0);
        assert!((from_two.beat() - 2.0).abs() < 1e-9);
        let (mut l, mut r) = (vec![0f32; 4_800], vec![0f32; 4_800]);
        from_two.render(&mut l, &mut r);
        assert!(onset(&l, 1e-6).is_some_and(|i| i < 10));
    }

    /// Plays `how` for `frames` samples in blocks of 333, and gives the left side.
    fn play_for(s: &Song, how: Playing, frames: usize) -> (Vec<f32>, Renderer) {
        let mut r = Renderer::playing(s, 48_000, how);
        let (mut l, mut rt) = (vec![0f32; frames], vec![0f32; frames]);
        for (a, b) in l.chunks_mut(333).zip(rt.chunks_mut(333)) {
            r.render(a, b);
        }
        (l, r)
    }

    #[test]
    fn a_loop_goes_round_and_cuts_a_note_at_its_end() {
        // A note at beat 1 lasting two beats, in a loop of beats 1 to 2 (24 000 samples a time round).
        let s = song(r#"{"id":"t","instrument":"lead","sound":{"shape":0,"detune":0,"sub":0,"drive":0,"cutoff":12000,"resonance":0,"envAmount":0,"attack":0.001,"decay":0.1,"sustain":1,"release":0.02,"vibrato":0,"rate":5},"notes":[{"pitch":72,"start":1,"length":2,"velocity":1}]}"#);
        let how = Playing { from: 0.0, cycle: Some((1.0, 2.0)), click: false, session: false };
        let (l, r) = play_for(&s, how, 24_000 * 4);
        // The note starts at 24 000, then again each time round: 48 000 and 72 000, where its last pass dies away first.
        assert!(l[..24_000].iter().all(|x| *x == 0.0));
        // Cut at the loop's end, the last pass has released (20 ms) by 1 200 samples in, so only one note sounds then.
        let level = |at: usize| l[at + 1_200..at + 2_400].iter().fold(0f32, |m, x| m.max(x.abs()));
        for start in [48_000usize, 72_000] {
            assert!((level(start) / level(24_000) - 1.0).abs() < 0.02, "{start}");
        }
        assert!(level(24_000) > 0.01);
        assert!((r.beat() - 1.0).abs() < 1e-9 && !r.past_end());
        // Played from after the loop, it plays on from there to the song's end without going round, as Live does.
        let mut r = Renderer::playing(&s, 48_000, Playing { from: 3.0, ..how });
        assert!((r.beat() - 3.0).abs() < 1e-9);
        let (mut left, mut right) = (vec![0f32; 1_000], vec![0f32; 1_000]);
        while !r.past_end() {
            r.render(&mut left, &mut right);
            assert!(r.beat() >= 3.0, "{}", r.beat());
        }
        assert!(r.beat() >= 4.0);
    }

    #[test]
    fn the_metronome_ticks_each_beat_higher_and_louder_on_the_bar() {
        let s = song("");
        let (l, r) = play_for(&s, Playing { from: 0.0, cycle: None, click: true, session: false }, 48_000 * 3);
        // Ticks at 0, 24 000, 48 000 and 72 000 (the song's 4 beats), then nothing past its end.
        for at in [0usize, 24_000, 48_000, 72_000] {
            assert_eq!(onset(&l[at..], 1e-6), Some(1), "{at}");
            assert!(l[at + 2_880..at + 24_000.min(l.len() - at)].iter().all(|x| *x == 0.0), "{at}");
        }
        assert!(l[96_000..].iter().all(|x| *x == 0.0));
        let peak = |a: usize| l[a..a + 200].iter().fold(0f32, |m, x| m.max(x.abs()));
        assert!((f64::from(peak(0)) - 0.28 * 0.8).abs() < 0.02 && (f64::from(peak(24_000)) - 0.16 * 0.8).abs() < 0.02);
        assert!(r.past_end() && !r.finished());
        // At the metronome's own level, whatever Main's (Live's metronome volume).
        let mut own = s.clone();
        own.metronome.volume = 0.4;
        own.main.volume = 0.1;
        let (l2, _) = play_for(&own, Playing { from: 0.0, cycle: None, click: true, session: false }, 48_000);
        let peak2 = l2[..200].iter().fold(0f32, |m, x| m.max(x.abs()));
        assert!((f64::from(peak2) - 0.28 * 0.4).abs() < 0.01, "{peak2}");
        // Without the click, silence.
        let (quiet, _) = play_for(&s, Playing::default(), 48_000);
        assert!(quiet.iter().all(|x| *x == 0.0));
    }

    #[test]
    fn volume_automation_moves_the_track_along_its_line() {
        let held = r#""sound":{"shape":0,"detune":0,"sub":0,"drive":0,"cutoff":12000,"resonance":0,"envAmount":0,"attack":0.001,"decay":0.1,"sustain":1,"release":0.02,"vibrato":0,"rate":5},"notes":[{"pitch":69,"start":0,"length":4,"velocity":1}]"#;
        let flat = song(&format!(r#"{{"id":"t","instrument":"lead",{held}}}"#));
        let moving = song(&format!(r#"{{"id":"t","instrument":"lead","volumeAuto":[{{"beat":2,"value":0}},{{"beat":0,"value":1}}],{held}}}"#));
        let level = |x: &[f32]| x.iter().fold(0f32, |m, v| m.max(v.abs()));
        let a = render_song(&flat, 48_000).0;
        let b = render_song(&moving, 48_000).0;
        // From full at beat 0 (points in any order) down to nothing at beat 2 and after: half way at beat 1.
        let at = |x: &[f32], s: usize| level(&x[s..s + 480]);
        assert!((at(&b, 2_400) / at(&a, 2_400) - 0.95).abs() < 0.03);
        assert!((at(&b, 23_760) / at(&a, 23_760) - 0.5).abs() < 0.03);
        assert!(level(&b[48_000..96_000]) < 1e-4);
    }

    /// A held sine-ish lead note across the bar, with `extra` on the track and `rest` on the song.
    fn held(rest: &str, extra: &str) -> Song {
        let sound = r#""sound":{"shape":0,"detune":0,"sub":0,"drive":0,"cutoff":12000,"resonance":0,"envAmount":0,"attack":0.001,"decay":0.1,"sustain":1,"release":0.02,"vibrato":0,"rate":5},"notes":[{"pitch":69,"start":0,"length":4,"velocity":1}]"#;
        Song::parse(&format!(r#"{{"version":2,"tempo":120,"bars":1,{rest}"tracks":[{{"id":"t","instrument":"lead",{sound}{extra}}}]}}"#)).unwrap()
    }

    fn loudest(x: &[f32]) -> f32 {
        x.iter().fold(0f32, |m, v| m.max(v.abs()))
    }

    #[test]
    fn automation_is_to_the_sample_and_needs_no_volume_under_it() {
        // A step from 0 to 1 at beat 1 (sample 24 000): silent before, sounding from that very sample, even with the
        // fader itself at 0 (the automation, not the fader, sets the level while it runs).
        let s = held("", r#","volume":0,"auto":{"volume":[{"beat":0,"value":0},{"beat":0.999999,"value":0},{"beat":1,"value":1}]}"#);
        let (l, _) = render_song(&s, 48_000);
        assert!(loudest(&l[..23_990]) < 1e-6);
        assert!(loudest(&l[24_000..26_400]) > 0.05);
        // The same in blocks of any size.
        let mut odd = Renderer::new(&s, 48_000, 0.0);
        let (mut a, mut b) = (vec![0f32; l.len()], vec![0f32; l.len()]);
        for (x, y) in a.chunks_mut(331).zip(b.chunks_mut(331)) {
            odd.render(x, y);
        }
        assert_eq!(a, l);
    }

    #[test]
    fn a_curved_segment_bends_and_an_overridden_setting_plays_its_fader() {
        let line = |curve: f64| held("", &format!(r#","volume":0.5,"auto":{{"volume":[{{"beat":0,"value":0,"curve":{curve}}},{{"beat":2,"value":1}}]}}"#));
        let at = |s: &Song| loudest(&render_song(s, 48_000).0[23_760..24_240]);
        let (straight, up, down) = (at(&line(0.0)), at(&line(0.8)), at(&line(-0.8)));
        // The curve is on the segment's first point. Half way along, a straight line is at half; bent one way it is further along, the other way less far.
        assert!(up > straight * 1.3 && down < straight * 0.7, "{down} {straight} {up}");
        // Live's rule (25.4): moving an automated control overrides it, and it plays at the control until re-enabled.
        let off = held("", r#","volume":0.5,"auto":{"volume":[{"beat":0,"value":0}]},"autoOff":["volume"]"#);
        assert_eq!(render_song(&off, 48_000).0, render_song(&held("", r#","volume":0.5"#), 48_000).0);
    }

    #[test]
    fn pan_sends_and_main_follow_their_automation() {
        // Pan from hard left to hard right over the bar: left louder than right early, the other way round late.
        let s = held("", r#","auto":{"pan":[{"beat":0,"value":-1},{"beat":4,"value":1}]}"#);
        let (l, r) = render_song(&s, 48_000);
        assert!(loudest(&l[4_800..9_600]) > 4.0 * loudest(&r[4_800..9_600]));
        assert!(loudest(&r[86_400..91_200]) > 4.0 * loudest(&l[86_400..91_200]));
        // A send that rises from nothing to all: the return adds nothing at first and doubles it by the end, even
        // with the send's own level at 0.
        let dry = render_song(&held("", ""), 48_000).0;
        let sent = render_song(&held(r#""returns":[{"id":"a"}],"#, r#","sends":{"a":0},"auto":{"send:a":[{"beat":0,"value":0},{"beat":4,"value":1}]}"#), 48_000).0;
        assert!((loudest(&sent[2_400..4_800]) / loudest(&dry[2_400..4_800]) - 1.0).abs() < 0.05);
        assert!((loudest(&sent[91_200..93_600]) / loudest(&dry[91_200..93_600]) - 2.0).abs() < 0.05);
        // Main's volume falling to nothing over the first two beats, then staying there.
        let main = render_song(&held(r#""main":{"volume":0.8,"auto":{"volume":[{"beat":0,"value":1},{"beat":2,"value":0}]}},"#, ""), 48_000).0;
        assert!(loudest(&main[48_000..]) < 1e-6);
        assert!((loudest(&main[23_760..24_240]) / loudest(&dry[23_760..24_240]) - 0.5 / 0.8).abs() < 0.05);
        // The Session view plays no Arrangement automation.
        let mut session = Renderer::playing(&held(r#""main":{"auto":{"volume":[{"beat":0,"value":0}]}},"#, ""), 48_000, Playing { session: true, ..Playing::default() });
        assert!(session.main_auto.is_empty());
        session.render(&mut [0f32; 64], &mut [0f32; 64]);
    }

    #[test]
    fn effect_settings_follow_their_automation_on_tracks_and_main() {
        let delay = |mix: f64| format!(r#","fx":[{{"id":"d","kind":"delay","time":0.25,"feedback":0,"mix":{mix}}}]"#);
        // Held at one value all along, an automated setting sounds as the setting itself at that value.
        let fixed = render_song(&held("", &delay(1.0)), 48_000).0;
        let auto = render_song(&held("", &format!(r#"{},"auto":{{"fx:d:mix":[{{"beat":0,"value":1}}]}}"#, delay(0.0))), 48_000).0;
        assert_eq!(auto, fixed);
        // Overridden, it is the setting again.
        let off = render_song(&held("", &format!(r#"{},"auto":{{"fx:d:mix":[{{"beat":0,"value":1}}]}},"autoOff":["fx:d:mix"]"#, delay(0.0))), 48_000).0;
        assert_eq!(off, render_song(&held("", &delay(0.0)), 48_000).0);
        // On Main too.
        let main = |rest: &str| render_song(&held(&format!(r#""main":{{"volume":1,"fx":[{{"id":"m","kind":"compressor","threshold":0,"ratio":1,"attack":0.01,"release":0.2,"makeup":0}}]{rest}}},"#), ""), 48_000).0;
        let dry = main("");
        let louder = main(r#","auto":{"fx:m:makeup":[{"beat":0,"value":6}]}"#);
        assert!((loudest(&louder) / loudest(&dry) - linear_of(6.0)).abs() < 0.01, "{}", loudest(&louder) / loudest(&dry));
    }

    fn linear_of(db: f32) -> f32 {
        10f32.powf(db / 20.0)
    }

    #[test]
    fn a_kept_chain_lets_go_of_automation_the_song_no_longer_has() {
        // With no feedback, the delay's insides are the same whatever its mix; only what comes out differs.
        let fx = r#","fx":[{"id":"d","kind":"delay","time":0.25,"feedback":0,"mix":0}]"#;
        let after = |was_song: &Song| {
            let mut was = Renderer::new(was_song, 48_000, 0.0);
            was.render(&mut vec![0f32; 4_800], &mut vec![0f32; 4_800]);
            // The song changes to the same effects with no automation: the chain rings on, its mix back at 0.
            let mut now = Renderer::new(&held("", fx), 48_000, 4_800.0 / 24_000.0);
            now.adopt(&mut was);
            let (mut l, mut r) = (vec![0f32; 9_600], vec![0f32; 9_600]);
            now.render(&mut l, &mut r);
            l
        };
        let automated = after(&held("", &format!(r#"{fx},"auto":{{"fx:d:mix":[{{"beat":0,"value":1}}]}}"#)));
        assert_eq!(automated, after(&held("", fx)));
    }

    /// A track holding one note through an Arrange clip of `clip` (start, length, loop, envelopes), over two bars.
    fn enveloped(rest: &str, track: &str, clip: &str) -> Song {
        let sound = r#""sound":{"shape":0,"detune":0,"sub":0,"drive":0,"cutoff":12000,"resonance":0,"envAmount":0,"attack":0.001,"decay":0.1,"sustain":1,"release":0.02,"vibrato":0,"rate":5}"#;
        Song::parse(&format!(r#"{{"version":2,"tempo":120,"bars":2,{rest}"tracks":[{{"id":"t","instrument":"lead",{sound}{track},"clips":[{{"id":"c","notes":[{{"pitch":69,"start":0,"length":8,"velocity":1}}],{clip}}}]}}]}}"#)).unwrap()
    }

    #[test]
    fn a_clip_envelope_moves_its_track_relative_to_where_it_is() {
        let level = |s: &Song, beat: f64| {
            let l = render_song(s, 48_000).0;
            let at = (beat * 24_000.0) as usize;
            loudest(&l[at..at + 480])
        };
        let plain = enveloped("", r#","volume":0.8"#, r#""start":0,"length":8"#);
        // Volume: a share of the track's volume. A step at the clip's own beat 0.5, with the clip starting at beat 2:
        // heard at song beat 2.5.
        let stepped = enveloped("", r#","volume":0.8"#, r#""start":2,"length":6,"envelopes":{"volume":[{"beat":0,"value":0.5},{"beat":0.499999,"value":0.5},{"beat":0.5,"value":1}]}"#);
        assert!(level(&stepped, 1.0) < 1e-6, "nothing before the clip");
        assert!((level(&stepped, 2.1) / level(&plain, 2.1) - 0.5).abs() < 0.02);
        assert!((level(&stepped, 2.6) / level(&plain, 2.6) - 1.0).abs() < 0.02);
        // On top of automation: half of a fader automated to half.
        let both = enveloped("", r#","volume":0.8,"auto":{"volume":[{"beat":0,"value":0.4}]}"#, r#""start":0,"length":8,"envelopes":{"volume":[{"beat":0,"value":0.5}]}"#);
        assert!((level(&both, 1.0) / level(&plain, 1.0) - 0.25).abs() < 0.02);
        // Round the clip's loop: silent for the first half of each time round a one-beat loop.
        let looped = enveloped("", "", r#""start":0,"length":8,"loop":{"start":0,"end":1},"envelopes":{"volume":[{"beat":0,"value":0},{"beat":0.499999,"value":0},{"beat":0.5,"value":1}]}"#);
        let lp = enveloped("", "", r#""start":0,"length":8,"loop":{"start":0,"end":1}"#);
        for beat in [3.1, 6.2] {
            assert!(level(&looped, beat) < 1e-6, "{beat}");
            assert!((level(&looped, beat + 0.5) / level(&lp, beat + 0.5) - 1.0).abs() < 0.02, "{beat}");
        }
        // Pan is added to the track's: a track at -0.5 with an envelope of +1 sits at +0.5.
        let (l, r) = render_song(&enveloped("", r#","pan":-0.5"#, r#""start":0,"length":8,"envelopes":{"pan":[{"beat":0,"value":1}]}"#), 48_000);
        let (l2, r2) = render_song(&enveloped("", r#","pan":0.5"#, r#""start":0,"length":8"#), 48_000);
        assert!((loudest(&l[24_000..48_000]) / loudest(&l2[24_000..48_000]) - 1.0).abs() < 0.01);
        assert!((loudest(&r[24_000..48_000]) / loudest(&r2[24_000..48_000]) - 1.0).abs() < 0.01);
        // A send: a share of it. Sending all of it to a plain return doubles the sound; half of it, one and a half.
        let send = enveloped(r#""returns":[{"id":"a"}],"#, r#","sends":{"a":1}"#, r#""start":0,"length":8,"envelopes":{"send:a":[{"beat":0,"value":0.5}]}"#);
        let dry = enveloped("", "", r#""start":0,"length":8"#);
        assert!((level(&send, 1.0) / level(&dry, 1.0) - 1.5).abs() < 0.02);
    }

    #[test]
    fn a_clip_envelope_sets_an_effect_setting_while_its_clip_plays_and_an_unlinked_one_keeps_its_own_loop() {
        let level = |s: &Song, beat: f64| {
            let l = render_song(s, 48_000).0;
            let at = (beat * 24_000.0) as usize;
            loudest(&l[at..at + 480])
        };
        // A compressor that changes nothing but its makeup gain: the clip's envelope puts it at 6 dB from its own beat
        // 2 (song beat 3, as the clip starts at 1); before the clip, and with no envelope, it is the setting's 0 dB.
        let comp = r#","fx":[{"id":"m","kind":"compressor","threshold":0,"ratio":1,"attack":0.01,"release":0.2,"makeup":0}]"#;
        let plain = enveloped("", comp, r#""start":1,"length":7"#);
        let made = enveloped("", comp, r#""start":1,"length":7,"envelopes":{"fx:m:makeup":[{"beat":0,"value":0},{"beat":1.999999,"value":0},{"beat":2,"value":6}]}"#);
        assert!((level(&made, 2.0) / level(&plain, 2.0) - 1.0).abs() < 0.01);
        assert!((level(&made, 3.5) / level(&plain, 3.5) - linear_of(6.0)).abs() < 0.02, "{}", level(&made, 3.5) / level(&plain, 3.5));
        // It wins over the setting's automation while the clip plays.
        let auto = enveloped("", &format!(r#"{comp},"auto":{{"fx:m:makeup":[{{"beat":0,"value":12}}]}}"#), r#""start":1,"length":7,"envelopes":{"fx:m:makeup":[{"beat":0,"value":6}]}"#);
        assert!((level(&auto, 3.5) / level(&plain, 3.5) - linear_of(6.0)).abs() < 0.02);
        // Unlinked: a one-beat loop of its own, silent for the first half each time round, though the clip has no loop.
        // Linked, the same points end at beat 1 and stay up from there.
        let env = r#""envelopes":{"volume":[{"beat":0,"value":0},{"beat":0.499999,"value":0},{"beat":0.5,"value":1}]}"#;
        let linked = enveloped("", "", &format!(r#""start":0,"length":8,{env}"#));
        let unlinked = enveloped("", "", &format!(r#""start":0,"length":8,{env},"unlinked":{{"volume":{{"start":0,"end":1}}}}"#));
        let dry = enveloped("", "", r#""start":0,"length":8"#);
        for beat in [3.1, 6.2] {
            assert!((level(&linked, beat) / level(&dry, beat) - 1.0).abs() < 0.02, "{beat}");
            assert!(level(&unlinked, beat) < 1e-6, "{beat}");
            assert!((level(&unlinked, beat + 0.5) / level(&dry, beat + 0.5) - 1.0).abs() < 0.02, "{beat}");
        }
    }

    #[test]
    fn a_session_clip_envelope_goes_round_with_its_clip() {
        let sound = r#""sound":{"shape":0,"detune":0,"sub":0,"drive":0,"cutoff":12000,"resonance":0,"envAmount":0,"attack":0.001,"decay":0.1,"sustain":1,"release":0.02,"vibrato":0,"rate":5}"#;
        let song = |env: &str| Song::parse(&format!(r#"{{"version":2,"tempo":120,"bars":1,"tracks":[{{"id":"t","instrument":"lead",{sound},"slots":[{{"bars":1,"notes":[{{"pitch":69,"start":0,"length":4,"velocity":1}}]{env}}}]}}]}}"#)).unwrap();
        let play = |s: &Song| {
            let mut r = Renderer::playing(s, 48_000, Playing { session: true, ..Playing::default() });
            r.launch(0, Some(0));
            let (mut l, mut rt) = (vec![0f32; 96_000 * 2], vec![0f32; 96_000 * 2]);
            for (x, y) in l.chunks_mut(512).zip(rt.chunks_mut(512)) {
                r.render(x, y);
            }
            l
        };
        // Quiet for the clip's last beat, each time round.
        let plain = play(&song(""));
        let moved = play(&song(r#","envelopes":{"volume":[{"beat":0,"value":1},{"beat":2.999999,"value":1},{"beat":3,"value":0}]}"#));
        assert!((loudest(&moved[24_000..26_400]) / loudest(&plain[24_000..26_400]) - 1.0).abs() < 0.02);
        assert!(loudest(&moved[72_000 + 480..96_000]) < 1e-6);
        assert!(loudest(&moved[96_000 + 24_000..96_000 + 26_400]) > 0.01);
        assert!(loudest(&moved[96_000 + 72_000 + 480..192_000]) < 1e-6);
    }

    #[test]
    fn a_compressor_keyed_by_another_track_ducks_when_that_track_plays() {
        // A pad (first, so it is keyed by a lane after it) held through the bar, through a compressor keyed by a
        // second track that plays one note on beat 2.
        let sound = r#""sound":{"shape":0,"detune":0,"sub":0,"drive":0,"cutoff":12000,"resonance":0,"envAmount":0,"attack":0.001,"decay":0.1,"sustain":1,"release":0.02,"vibrato":0,"rate":5}"#;
        let song = |side: &str| Song::parse(&format!(r#"{{"version":2,"tempo":120,"bars":1,"tracks":[
            {{"id":"p","instrument":"lead",{sound},"fx":[{{"id":"c","kind":"compressor","threshold":-40,"ratio":20,"attack":0.001,"release":0.05,"makeup":0{side}}}],"notes":[{{"pitch":57,"start":0,"length":4,"velocity":0.5}}]}},
            {{"id":"k","instrument":"lead",{sound},"notes":[{{"pitch":45,"start":2,"length":0.5,"velocity":1}}]}}]}}"#)).unwrap();
        // The pad's own sound, block by block.
        let pad = |s: &Song| {
            let mut r = Renderer::new(s, 48_000, 0.0).with_stems();
            let mut out = Vec::new();
            for _ in 0..24 {
                r.render(&mut [0f32; 4_000], &mut [0f32; 4_000]);
                out.extend_from_slice(r.stems(4_000).next().unwrap().0);
            }
            out
        };
        let at = |x: &[f32], beat: f64| loudest(&x[(beat * 24_000.0) as usize..(beat * 24_000.0) as usize + 2_400]);
        let keyed = pad(&song(r#","sidechain":{"track":"k"}"#));
        assert!(at(&keyed, 2.2) < at(&keyed, 1.5) * 0.3, "{} {}", at(&keyed, 2.2), at(&keyed, 1.5));
        // It comes back after the note.
        assert!(at(&keyed, 3.5) > at(&keyed, 1.5) * 0.9);
        // Keyed by a track the song lacks, or with none of the trigger from the sidechain, it doesn't duck there.
        for side in [r#","sidechain":{"track":"gone"}"#, r#","sidechain":{"track":"k","mix":0}"#] {
            let plain = pad(&song(side));
            assert!(at(&plain, 2.2) > at(&plain, 1.5) * 0.9, "{side}");
        }
        // Its gain raises the key: at -30 dB the note barely reaches the threshold.
        let quiet = pad(&song(r#","sidechain":{"track":"k","gain":-30}"#));
        assert!(at(&quiet, 2.2) > at(&keyed, 2.2) * 2.0);
    }

    #[test]
    fn keying_lanes_come_first_and_a_circle_still_plays() {
        assert_eq!(keyed_order(&[vec![1], vec![], vec![0]]), vec![1, 0, 2]);
        assert_eq!(keyed_order(&[vec![1], vec![0], vec![]]), vec![2, 0, 1]);
        assert_eq!(keyed_order(&[vec![0, 9]]), vec![0]);
    }

    #[test]
    fn modulators_move_volume_pan_and_effect_settings() {
        let at = |x: &[f32], beat: f64| loudest(&x[(beat * 24_000.0) as usize..(beat * 24_000.0) as usize + 2_400]);
        // A square LFO synced to two beats, moving a fader at 0.5 by 0.5: full for the first beat, silent the next.
        let lfo = held("", r#","volume":0.5,"mods":[{"kind":"lfo","target":"volume","amount":0.5,"shape":"square","sync":2}]"#);
        let full = render_song(&held("", r#","volume":1"#), 48_000).0;
        let (l, _) = render_song(&lfo, 48_000);
        assert!((at(&l, 0.5) / at(&full, 0.5) - 1.0).abs() < 0.02);
        assert!(at(&l, 1.2) < 1e-6);
        assert!((at(&l, 2.5) / at(&full, 2.5) - 1.0).abs() < 0.02);
        // Switched off, or with nothing to move, it does nothing.
        let half = render_song(&held("", r#","volume":0.5"#), 48_000).0;
        assert_eq!(render_song(&held("", r#","volume":0.5,"mods":[{"kind":"lfo","target":"volume","amount":0.5,"shape":"square","sync":2,"on":false}]"#), 48_000).0, half);
        assert_eq!(render_song(&held("", r#","volume":0.5,"mods":[{"kind":"lfo","target":"fx:none:mix","amount":0.5}]"#), 48_000).0, half);
        // An envelope follower on pan: the louder the track, the further right.
        let (l, r) = render_song(&held("", r#","mods":[{"kind":"follow","target":"pan","amount":10,"attack":0.001}]"#), 48_000);
        assert!(loudest(&r[24_000..48_000]) > 1.5 * loudest(&l[24_000..48_000]));
        // On an effect setting, around where it rests: a delay's mix at 0, raised to 1 for the first beat of every two
        // and held at nothing (it can't go under) for the second, so its echo is heard only after the first.
        let fx = r#","fx":[{"id":"d","kind":"delay","time":0.25,"feedback":0,"mix":0}]"#;
        let dry = render_song(&held("", fx), 48_000).0;
        let moved = render_song(&held("", &format!(r#"{fx},"mods":[{{"kind":"lfo","target":"fx:d:mix","amount":1,"shape":"square","sync":2}}]"#)), 48_000).0;
        assert!(moved[..24_000].iter().zip(&dry[..24_000]).any(|(a, b)| (a - b).abs() > 1e-3));
        assert_eq!(&moved[24_000 + 256..48_000], &dry[24_000 + 256..48_000]);
    }

    #[test]
    fn a_shaper_moves_along_its_drawn_line_and_goes_round() {
        let at = |x: &[f32], beat: f64| loudest(&x[(beat * 24_000.0) as usize..(beat * 24_000.0) as usize + 2_400]);
        // Drawn as a square synced to two beats, it moves a fader as the square LFO does.
        let points = r#"[{"beat":0,"value":1},{"beat":0.5,"value":1},{"beat":0.5,"value":-1},{"beat":1,"value":-1}]"#;
        let shaped = held("", &format!(r#","volume":0.5,"mods":[{{"kind":"shaper","target":"volume","amount":0.5,"sync":2,"points":{points}}}]"#));
        let full = render_song(&held("", r#","volume":1"#), 48_000).0;
        let (l, _) = render_song(&shaped, 48_000);
        assert!((at(&l, 0.5) / at(&full, 0.5) - 1.0).abs() < 0.02);
        assert!(at(&l, 1.2) < 1e-6);
        assert!((at(&l, 2.5) / at(&full, 2.5) - 1.0).abs() < 0.02);
        // A jump in its line (here back up at each round) glides over a couple of milliseconds: no click, the steps
        // between samples no bigger than the tone's own at full volume.
        let pump = held("", r#","volume":0.5,"mods":[{"kind":"shaper","target":"volume","amount":0.4,"sync":1,"phase":0.0005,"points":[{"beat":0,"value":1},{"beat":0.1,"value":-1},{"beat":1,"value":-1}]}]"#);
        let step = |x: &[f32]| x.windows(2).map(|w| (w[1] - w[0]).abs()).fold(0f32, f32::max);
        let (l, _) = render_song(&pump, 48_000);
        assert!(step(&l[..96_000]) <= step(&full[..96_000]) * 1.05, "{} {}", step(&l[..96_000]), step(&full[..96_000]));
        // Its line goes round from the last point to the first: two points a half apart make a triangle whose middle
        // falls at 0, out of order and out of range as they come.
        let m = crate::song::Modulator { kind: "shaper".into(), target: "volume".into(), amount: 1.0, rate: 1.0, sync: None, shape: None, phase: 0.0, points: vec![AutoPoint { beat: 0.75, value: -3.0, curve: 0.0 }, AutoPoint { beat: 0.25, value: 1.0, curve: 0.0 }], attack: 0.01, release: 0.2, on: None };
        let line = |m: &crate::song::Modulator| match Mod::new(m, 48_000).kind {
            ModKind::Shaper { points, .. } => points,
            _ => Vec::new(),
        };
        let points = line(&m);
        assert_eq!(points.len(), 4);
        let v = |p: f64| auto_value_at(&points, p, 0.0);
        assert!(v(0.0).abs() < 1e-12 && (v(0.25) - 1.0).abs() < 1e-12 && (v(0.5)).abs() < 1e-12 && (v(0.75) + 1.0).abs() < 1e-12 && v(0.999) < 0.0 && v(0.999) > -0.01);
        // With no points it rests at nothing.
        let none = crate::song::Modulator { points: Vec::new(), ..m };
        assert_eq!(auto_value_at(&line(&none), 0.3, 0.0), 0.0);
    }

    #[test]
    fn lfo_shapes_go_round_from_minus_one_to_one() {
        for shape in [Shape::Sine, Shape::Triangle, Shape::Square, Shape::Saw, Shape::Ramp] {
            let values: Vec<f64> = (0..100).map(|i| wave(shape, f64::from(i) / 100.0)).collect();
            assert!(values.iter().all(|v| (-1.0..=1.0).contains(v)));
            assert!(values.iter().any(|v| *v > 0.9) && values.iter().any(|v| *v < -0.9));
        }
        assert!(wave(Shape::Sine, 0.0).abs() < 1e-12 && wave(Shape::Triangle, 0.0).abs() < 1e-12);
        assert!(wave(Shape::Saw, 0.25) < wave(Shape::Saw, 0.75) && wave(Shape::Ramp, 0.25) > wave(Shape::Ramp, 0.75));
    }

    #[test]
    fn a_stack_macro_follows_its_automation() {
        let stack = |value: f64| format!(r#","fx":[{{"id":"s","kind":"stack","chains":[{{"fx":[{{"id":"d","kind":"delay","time":0.25,"feedback":0,"mix":0}}]}}],"macros":[{{"value":{value},"maps":[{{"target":"fx:d:mix","min":0,"max":1}}]}}]}}]"#);
        let at_one = render_song(&held("", &stack(1.0)), 48_000).0;
        let automated = render_song(&held("", &format!(r#"{},"auto":{{"fx:s:macro1":[{{"beat":0,"value":1}}]}}"#, stack(0.0))), 48_000).0;
        assert_eq!(automated, at_one);
        assert_ne!(at_one, render_song(&held("", &stack(0.0)), 48_000).0);
    }

    #[test]
    fn the_session_view_goes_round_a_clip_and_launches_land_on_the_bar() {
        // Tempo 120: a beat is 24 000 samples, a bar 96 000. Slot 0 is a one-bar clip with a note on its first beat
        // lasting two bars (cut at the clip's end); slot 1 has a note on beat 2.
        let held = r#""sound":{"shape":0,"detune":0,"sub":0,"drive":0,"cutoff":12000,"resonance":0,"envAmount":0,"attack":0.001,"decay":0.1,"sustain":1,"release":0.02,"vibrato":0,"rate":5}"#;
        let s = song(&format!(r#"{{"id":"t","instrument":"lead",{held},"slots":[{{"bars":1,"notes":[{{"pitch":69,"start":0,"length":8,"velocity":1}}]}},{{"bars":1,"notes":[{{"pitch":69,"start":2,"length":0.5,"velocity":1}}]}}]}},{{"id":"m","instrument":"lead","muted":true,"slots":[{{"bars":1,"notes":[]}}]}}"#));
        let mut r = Renderer::playing(&s, 48_000, Playing { session: true, ..Playing::default() });
        r.launch(0, Some(0));
        r.launch(1, Some(0));
        let (mut l, mut rt) = (vec![0f32; 96_000 * 3], vec![0f32; 96_000 * 3]);
        let (a, b) = (&mut l[..120_000], &mut rt[..120_000]);
        for (x, y) in a.chunks_mut(333).zip(b.chunks_mut(333)) {
            r.render(x, y);
        }
        // Launched before play, slot 0 starts at once and comes round each bar, and the muted track's clip plays on.
        let state: Vec<_> = r.session().map(|(id, s)| (id.to_owned(), s)).collect();
        assert_eq!(state[0].1.playing, Some((0, 0.0)));
        assert_eq!(state[1].1.playing, Some((0, 0.0)));
        assert!(l[100..2_000].iter().any(|x| x.abs() > 0.01));
        assert!(l[96_000 + 100..96_000 + 2_000].iter().any(|x| x.abs() > 0.01));
        // Cut at the clip's end, the first pass has released by 1 200 samples into the next.
        let level = |from: usize| l[from..from + 1_200].iter().fold(0f32, |m, x| m.max(x.abs()));
        assert!((level(96_000 + 1_200) / level(1_200) - 1.0).abs() < 0.02);
        // Slot 1 launched mid-bar lands on the next bar line (beat 8), with its note on beat 10.
        r.launch(0, Some(1));
        assert_eq!(r.session().next().unwrap().1.queued, Some(Some(1)));
        let (a, b) = (&mut l[120_000..], &mut rt[120_000..]);
        for (x, y) in a.chunks_mut(333).zip(b.chunks_mut(333)) {
            r.render(x, y);
        }
        assert_eq!(r.session().next().unwrap().1, SessionState { playing: Some((1, 8.0)), queued: None });
        // Slot 0's note sounded on beat 4 (the second bar) but not beat 8; slot 1's sounds on beat 10.
        assert!(l[192_000 + 1_200..192_000 + 2_400].iter().all(|x| x.abs() < 1e-3));
        assert!(l[240_000 + 100..240_000 + 2_000].iter().any(|x| x.abs() > 0.01));
        // A stop lands on the next bar too, and launching an empty slot stops it.
        r.launch(0, None);
        r.render(&mut vec![0f32; 96_000], &mut vec![0f32; 96_000]);
        assert_eq!(r.session().next().unwrap().1, SessionState::default());
        assert!(!r.past_end());
    }
    #[test]
    fn a_send_reaches_its_return_and_main_sets_the_level() {
        let note = r#""clips":[{"id":"c","start":0,"length":4,"notes":[{"pitch":60,"start":0,"length":1,"velocity":1}]}]"#;
        let with = |rest: &str, sends: &str| {
            Song::parse(&format!(r#"{{"version":2,"tempo":120,"bars":1,{rest}"tracks":[{{"id":"t","instrument":"lead",{note}{sends}}}]}}"#)).unwrap()
        };
        let dry = render_song(&with("", ""), 48_000).0;
        let loud = |s: &[f32]| s.iter().fold(0f32, |m, x| m.max(x.abs()));
        // A return with no effects at full volume, sent all of the track: the track is heard twice over.
        let sent = render_song(&with(r#""returns":[{"id":"a"}],"#, r#","sends":{"a":1}"#), 48_000).0;
        assert!((loud(&sent) / loud(&dry) - 2.0).abs() < 1e-3, "{}", loud(&sent) / loud(&dry));
        // A send to a return the song lacks, or to a muted one, adds nothing.
        assert_eq!(render_song(&with(r#""returns":[{"id":"a"}],"#, r#","sends":{"b":1}"#), 48_000).0, dry);
        assert_eq!(render_song(&with(r#""returns":[{"id":"a","muted":true}],"#, r#","sends":{"a":1}"#), 48_000).0, dry);
        // Main at half its usual 0.8 halves everything.
        let half = render_song(&with(r#""main":{"volume":0.4},"#, ""), 48_000).0;
        assert!((loud(&half) / loud(&dry) - 0.5).abs() < 1e-3);
        // The return has its own meter, after the tracks' and before Main's.
        let mut r = Renderer::new(&with(r#""returns":[{"id":"a","volume":0.5}],"#, r#","sends":{"a":1}"#), 48_000, 0.0);
        let (mut l, mut rr) = (vec![0f32; 4800], vec![0f32; 4800]);
        r.render(&mut l, &mut rr);
        assert_eq!(r.track_ids().collect::<Vec<_>>(), ["t", "a"]);
        let peaks: Vec<_> = r.peaks().collect();
        assert_eq!(peaks.len(), 3);
        assert!((peaks[1].0 / peaks[0].0 - 0.5).abs() < 1e-3);
    }

    /// A song with one audio track playing `clips` (JSON), and a second of 0.5 at 48 kHz as `take.wav`.
    fn audio_song(clips: &str, slots: &str) -> Song {
        let mut song = Song::parse(&format!(r#"{{"version":2,"tempo":120,"bars":2,"main":{{"volume":1}},"tracks":[{{"id":"v","kind":"audio","clips":[{clips}],"slots":[{slots}]}}]}}"#)).unwrap();
        song.sounds.insert("take.wav".into(), std::sync::Arc::new(crate::wav::Sound { rate: 48_000.0, left: vec![0.5; 48_000], right: vec![0.25; 48_000] }));
        song
    }

    #[test]
    fn an_audio_clip_plays_its_file_from_its_start_beat_until_its_end() {
        // From beat 1 (half a second in) for two beats, with the file's second running out after it.
        let song = audio_song(r#"{"start":1,"length":2,"audio":{"file":"take.wav","gainDb":0}}"#, "");
        let (left, right) = render_song(&song, 48_000);
        assert_eq!(onset(&left, 0.0), Some(24_001));
        assert!((left[30_000] - 0.5).abs() < 1e-6 && (right[30_000] - 0.25).abs() < 1e-6);
        // It fades in over 4 ms (192 samples), and out to the clip's end at beat 3.
        assert!((left[24_096] - 0.25).abs() < 1e-3);
        assert!((left[72_000 - 96] - 0.25).abs() < 1e-2);
        assert_eq!(left[72_000], 0.0);
    }

    #[test]
    fn an_audio_clip_on_a_note_track_and_one_with_no_sound_are_silent() {
        let mut song = audio_song(r#"{"start":0,"length":2,"audio":{"file":"missing.wav"}}"#, "");
        let (left, _) = render_song(&song, 48_000);
        assert_eq!(onset(&left, 0.0), None);
        song.tracks[0].kind = None;
        song.tracks[0].clips[0].audio.as_mut().unwrap().file = "take.wav".into();
        let (left, _) = render_song(&song, 48_000);
        assert_eq!(onset(&left, 0.0), None);
    }

    #[test]
    fn a_session_slot_plays_its_audio_round_its_length() {
        let song = audio_song("", r#"{"bars":1,"audio":{"file":"take.wav"}}"#);
        let mut r = Renderer::playing(&song, 48_000, Playing { session: true, ..Playing::default() });
        r.launch(0, Some(0));
        let (mut left, mut right) = (vec![0f32; 512], vec![0f32; 512]);
        r.render(&mut left, &mut right);
        assert!((left[0] - 0.5).abs() < 1e-6);
    }

    #[test]
    fn beat_repeat_repeats_a_grid_on_the_beat_for_its_gate_by_chance() {
        // A rising line, a second long, from beat 0; at 120 a sixteenth is 6000 samples.
        let line: Vec<f32> = (0..48_000).map(|i| i as f32 / 48_000.0).collect();
        let play = |fx: &str| {
            let mut song = Song::parse(&format!(r#"{{"version":2,"tempo":120,"bars":1,"main":{{"volume":1}},"tracks":[{{"id":"v","kind":"audio","fx":[{{"id":"r","kind":"beatrepeat",{fx}}}],"clips":[{{"start":0,"length":2,"audio":{{"file":"line.wav"}}}}]}}]}}"#)).unwrap();
            song.sounds.insert("line.wav".into(), std::sync::Arc::new(crate::wav::Sound { rate: 48_000.0, left: line.clone(), right: line.clone() }));
            render_song(&song, 48_000).0
        };
        // Every beat, the first sixteenth over and over for the beat, in place of what comes in.
        let out = play(r#""interval":4,"grid":1,"gate":4,"mix":"insert""#);
        assert!((out[3_000] - 0.0625).abs() < 1e-3, "{}", out[3_000]);
        for repeat in 1..4 {
            assert!((out[repeat * 6_000 + 3_000] - 0.0625).abs() < 1e-3, "repeat {repeat}: {}", out[repeat * 6_000 + 3_000]);
        }
        // The next beat takes its own first sixteenth.
        assert!((out[24_000 + 6_000 + 3_000] - 0.5625).abs() < 1e-3, "{}", out[33_000]);
        // Decay makes each repeat quieter than the one before; volume sets them all (dB).
        let out = play(r#""interval":4,"grid":1,"gate":4,"mix":"insert","decay":0.5,"volume":-6.0206"#);
        assert!((out[6_000 + 3_000] - 0.03125).abs() < 1e-3 && (out[12_000 + 3_000] - 0.015_625).abs() < 1e-3, "{} {}", out[9_000], out[15_000]);
        // Mix adds the repeats to what comes in; Gate plays only the repeats.
        let out = play(r#""interval":4,"grid":1,"gate":2,"mix":"mix""#);
        assert!((out[9_000] - (0.1875 + 0.0625)).abs() < 1e-3, "{}", out[9_000]);
        assert!((out[15_000] - 0.3125).abs() < 1e-3, "after the gate, only what comes in: {}", out[15_000]);
        let out = play(r#""interval":4,"grid":1,"gate":2,"mix":"gate""#);
        assert!(out[3_000].abs() < 1e-6 && (out[9_000] - 0.0625).abs() < 1e-3 && out[15_000].abs() < 1e-6);
        // With no chance it never repeats; an offset starts it that many sixteenths into the interval.
        let out = play(r#""interval":4,"grid":1,"gate":4,"mix":"insert","chance":0"#);
        assert!((out[9_000] - 0.1875).abs() < 1e-3);
        let out = play(r#""interval":4,"offset":2,"grid":1,"gate":2,"mix":"insert""#);
        assert!((out[9_000] - 0.1875).abs() < 1e-3 && (out[12_000 + 6_000 + 3_000] - 0.3125).abs() < 1e-3, "{} {}", out[9_000], out[21_000]);
    }

    #[test]
    fn an_audio_clips_transpose_and_its_transposition_envelope_add_up_and_keep_its_timing() {
        // Two seconds of a 220 Hz sine, warped at the song's tempo in Complex, from beat 0 for four beats.
        let tone: Vec<f32> = (0..96_000).map(|i| (std::f64::consts::TAU * 220.0 * f64::from(i) / 48_000.0).sin() as f32 * 0.5).collect();
        let pitch = |clip: &str| {
            let mut song = audio_song(clip, "");
            song.sounds.insert("tone.wav".into(), std::sync::Arc::new(crate::wav::Sound { rate: 48_000.0, left: tone.clone(), right: tone.clone() }));
            let (left, _) = render_song(&song, 48_000);
            // Rising zero crossings over half a second in the middle of the clip.
            let rising = left[36_000..60_000].windows(2).filter(|w| w[0] < 0.0 && w[1] >= 0.0).count();
            (rising as f64 * 2.0, left[95_000].abs() > 0.0 || left[90_000].abs() > 0.0)
        };
        let clip = |transpose: f64, envelope: &str| format!(r#"{{"start":0,"length":4,"audio":{{"file":"tone.wav","warp":true,"mode":"complex","bpm":120,"transpose":{transpose}}}{envelope}}}"#);
        let (plain, _) = pitch(&clip(0.0, ""));
        assert!((plain - 220.0).abs() < 6.0, "{plain}");
        // Its own transpose: a fifth down.
        let (fifth, still_playing) = pitch(&clip(-7.0, ""));
        assert!((fifth - 220.0 * 2f64.powf(-7.0 / 12.0)).abs() < 6.0, "{fifth}");
        assert!(still_playing, "the clip still plays to its end");
        // The envelope adds to it: -7 and +19 is an octave up.
        let (octave, _) = pitch(&clip(-7.0, r#","envelopes":{"transpose":[{"beat":0,"value":19}]}"#));
        assert!((octave - 440.0).abs() < 8.0, "{octave}");
    }

    #[test]
    fn a_sampler_track_and_a_drum_pad_play_their_sounds_from_their_notes() {
        // A tenth of a second of steady sound, left 0.5 and right 0.25.
        let sound = std::sync::Arc::new(crate::wav::Sound { rate: 48_000.0, left: vec![0.5; 4_800], right: vec![0.25; 4_800] });
        let mut s = song(r#"{"id":"s","kind":"sampler","sampler":{"file":"hit.wav","mode":"oneshot"},"clips":[{"id":"c","start":0,"length":4,"notes":[{"pitch":60,"start":1,"length":0.01,"velocity":1}]}]}"#);
        s.sounds.insert("hit.wav".into(), sound.clone());
        let (l, r) = render_song(&s, 48_000);
        // From beat 1 (half a second at 120) its whole region plays, though the note is short, in two channels.
        assert_eq!(onset(&l, 1e-3), Some(24_000));
        // Through Main at 0.8.
        assert!((l[24_500] - 0.4).abs() < 0.01 && (r[24_500] - 0.2).abs() < 0.01, "{} {}", l[24_500], r[24_500]);
        assert!(l[24_000 + 4_900..].iter().all(|x| x.abs() < 1e-6));
        // On a drum pad it plays in place of the drum, at the pad's level, and the other drums are as they were.
        let mut d = song(r#"{"id":"d","instrument":"drums","pads":{"36":{"tune":0,"decay":1,"level":0.5,"pan":0,"sample":{"file":"hit.wav","mode":"oneshot"}}},"clips":[{"id":"c","start":0,"length":4,"notes":[{"pitch":36,"start":0,"length":0.25,"velocity":1},{"pitch":38,"start":2,"length":0.25,"velocity":1}]}]}"#);
        d.sounds.insert("hit.wav".into(), sound);
        let (l, r) = render_song(&d, 48_000);
        assert!((l[500] - 0.2).abs() < 0.01 && (r[500] - 0.1).abs() < 0.01, "{} {}", l[500], r[500]);
        assert!(l[5_000..48_000].iter().all(|x| x.abs() < 1e-6));
        assert!(onset(&l[48_000..], 1e-3).is_some());
        // With the file missing, the pad plays its drum.
        d.sounds.clear();
        let (l, _) = render_song(&d, 48_000);
        assert!(l[500..4_800].iter().any(|x| (x.abs() - 0.2).abs() > 0.05));
    }

    #[test]
    fn stems_are_each_track_and_return_post_fader_and_add_up_to_main() {
        let s = Song::parse(r#"{"version":2,"tempo":120,"bars":1,"returns":[{"id":"r","volume":0.5,"fx":[{"id":"e","kind":"echo","on":true}]}],"tracks":[
            {"id":"a","instrument":"lead","volume":0.5,"pan":-0.5,"sends":{"r":0.5},"clips":[{"id":"c","start":0,"length":4,"notes":[{"pitch":60,"start":0,"length":1,"velocity":1}]}]},
            {"id":"d","instrument":"drums","clips":[{"id":"c","start":0,"length":4,"notes":[{"pitch":36,"start":1,"length":0.25,"velocity":1}]}]},
            {"id":"m","instrument":"bass","muted":true,"clips":[{"id":"c","start":0,"length":4,"notes":[{"pitch":40,"start":0,"length":1,"velocity":1}]}]}]}"#).unwrap();
        let mut r = Renderer::new(&s, 48_000, 0.0).with_stems();
        // A muted track is not heard, so it has no stem.
        assert_eq!(r.track_ids().collect::<Vec<_>>(), ["a", "d", "r"]);
        let (mut l, mut rr) = (vec![0f32; 512], vec![0f32; 512]);
        let mut sums = [0f64; 3];
        for _ in 0..(song_frames(&s, 48_000) / 512) {
            r.render(&mut l, &mut rr);
            let stems: Vec<(&[f32], &[f32])> = r.stems(512).collect();
            for i in 0..512 {
                let (sl, sr) = stems.iter().fold((0f32, 0f32), |(a, b), (x, y)| (a + x[i], b + y[i]));
                // Main is the stems added up, at Main's level (no effects on Main).
                assert!((sl * 0.8 - l[i]).abs() < 1e-5 && (sr * 0.8 - rr[i]).abs() < 1e-5);
            }
            for (k, (x, _)) in stems.iter().enumerate() {
                sums[k] += x.iter().map(|v| f64::from(v.abs())).sum::<f64>();
            }
        }
        // Each has sound of its own: the lead, the kick, and the lead's echo on the return.
        assert!(sums.iter().all(|v| *v > 1.0), "{sums:?}");
    }

    #[test]
    fn a_frozen_track_plays_its_file_through_its_volume_and_sends_and_sounds_as_before() {
        let mut s = Song::parse(r#"{"version":2,"tempo":120,"bars":1,"returns":[{"id":"r","volume":1}],"tracks":[
            {"id":"a","instrument":"lead","volume":0.5,"pan":0,"sends":{"r":0.25},"fx":[{"id":"f","kind":"filter","on":true}],"clips":[{"id":"c","start":0,"length":4,"notes":[{"pitch":60,"start":0,"length":1,"velocity":1},{"pitch":67,"start":2,"length":1,"velocity":1}]}]}]}"#).unwrap();
        let before = render_song(&s, 48_000);
        // Frozen: its instrument, clips and effects at full volume, in the middle.
        let (fl, fr) = render_song(&s.for_freezing("a").unwrap(), 48_000);
        s.sounds.insert("Samples/Processed/Freeze/a Freeze.wav".into(), std::sync::Arc::new(crate::wav::Sound { rate: 48_000.0, left: fl, right: fr }));
        s.tracks[0].frozen = Some(crate::song::Frozen { file: "Samples/Processed/Freeze/a Freeze.wav".into() });
        // Its notes and effects no longer play: change them and it sounds the same.
        s.tracks[0].clips.clear();
        let after = render_song(&s, 48_000);
        let worst = before.0.iter().zip(&after.0).chain(before.1.iter().zip(&after.1)).map(|(a, b)| (a - b).abs()).fold(0f32, f32::max);
        assert!(worst < 1e-4, "{worst}");
        assert!(before.0.iter().any(|x| x.abs() > 0.05));
    }
}
