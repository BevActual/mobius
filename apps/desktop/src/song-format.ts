import { parseDevice, PART_KINDS, type Device, type DevicePart, type PartSetting } from './device-format';
/**
 * A song is JSON, notes rather than sound, so the agent can read and write it like a score:
 *
 *     { "version": 2, "tempo": 112, "key": "A minor", "bars": 8,
 *       "tracks": [{ "id": "t1", "name": "Bass", "instrument": "bass", "color": "blue", "volume": 0.8,
 *         "clips": [{ "id": "c1", "start": 0, "length": 16,
 *           "notes": [{ "pitch": 45, "start": 0, "length": 1.5, "velocity": 0.9 }] }] }] }
 *
 * Bars are four beats. A clip's `start` and `length` are in beats from the start of the song, and its notes' `start`
 * from the clip's start (a track's `notes` in song time, as version 1 had them, are read into clips); `pitch` is a MIDI note
 * number (60 is middle C); `velocity` runs from 0 to 1. On a drums track the pitch picks the drum: 36 kick, 38 snare,
 * 42 closed hat, 46 open hat, 39 clap, 45 tom. Mobius writes notes, never audio over recordings.
 */
export type Instrument = 'piano' | 'bass' | 'pad' | 'lead' | 'drums';
export const INSTRUMENTS: Instrument[] = ['piano', 'bass', 'pad', 'lead', 'drums'];
export const INSTRUMENT_NAMES: Record<Instrument, string> = { piano: 'Piano', bass: 'Bass', pad: 'Pad', lead: 'Lead', drums: 'Drums' };
export interface SongNote { pitch: number; start: number; length: number; velocity: number }
/**
 * How a track's instrument sounds (the Device panel):
 *
 * - Oscillator: `shape` (0 a pure sine, 1 a bright saw), two voices `detune`d apart in cents, a `sub` one octave down
 *   (0 to 1) and `drive` (0 clean to 1 saturated).
 * - Filter: a low-pass `cutoff` in Hz and `resonance` (0 to 1); `envAmount` (0 to 1) opens it by up to four octaves at
 *   each note's start, closing back over the envelope's decay.
 * - Envelope: `attack`, `decay` and `release` in seconds, and `sustain` (0 to 1) as a share of the peak.
 * - Motion: `vibrato` depth in cents at `rate` Hz.
 *
 * A track without one sounds as its instrument always has; a sound missing a setting takes its instrument's.
 */
export interface Sound {
  shape: number; detune: number; sub: number; drive: number;
  cutoff: number; resonance: number; envAmount: number;
  attack: number; decay: number; sustain: number; release: number;
  vibrato: number; rate: number;
}
/**
 * How a drums track's kit sounds: every drum `tune`d up or down in semitones, its `decay` as a multiple of how long it
 * rings, and its `tone` from dark (0) to bright (1).
 */
export interface KitSound { tune: number; decay: number; tone: number }
/**
 * A track's colour: one of the shared content colours (tokens.css, --c-<name>), chosen by the person. Its clips are
 * drawn in it. A track without one takes the next colour along by its place in the song.
 */
export const TRACK_COLOURS = ['blue', 'amber', 'green', 'violet', 'teal', 'pink', 'yellow', 'coral', 'stone'] as const;
export type TrackColour = (typeof TRACK_COLOURS)[number];
export const COLOUR_NAMES: Record<TrackColour, string> = { blue: 'Blue', amber: 'Amber', green: 'Green', violet: 'Violet', teal: 'Teal', pink: 'Pink', yellow: 'Yellow', coral: 'Coral', stone: 'Stone' };
/** The colour a new track gets: the first one no other track has (coral and stone last), else by count. */
export function nextColour(tracks: readonly { color: TrackColour }[]): TrackColour {
  const used = new Set(tracks.map((t) => t.color));
  return TRACK_COLOURS.find((c) => !used.has(c)) ?? TRACK_COLOURS[tracks.length % TRACK_COLOURS.length]!;
}
/**
 * An effect on a track, in the order the sound goes through them. Each can be switched off (`on`) and keeps its settings:
 *
 * - `eq`: a `low` shelf below `lowFreq`, a `mid` bell at `midFreq` Hz `midQ` wide, and a `high` shelf above `highFreq`,
 *   each in dB (-18 to +18). Older files without the frequencies get 120 Hz, Q 1 and 6 kHz.
 * - `compressor`: above `threshold` dB it turns the level down by `ratio` to 1, reacting in `attack` and letting go in
 *   `release` seconds, then lifts the whole track by `makeup` dB.
 * - `delay`: echoes `time` beats apart, each `feedback` (0 to 0.9) as loud as the last, blended in by `mix` (0 to 1).
 * - `reverb`: a room that rings for `size` seconds, its highs softened by `damp` (0 to 1), blended in by `mix`.
 */
export type Effect =
  | { id: string; kind: 'eq'; on: boolean; low: number; lowFreq: number; mid: number; midFreq: number; midQ: number; high: number; highFreq: number }
  | { id: string; kind: 'compressor'; on: boolean; threshold: number; ratio: number; attack: number; release: number; makeup: number }
  | { id: string; kind: 'delay'; on: boolean; time: number; feedback: number; mix: number }
  | { id: string; kind: 'reverb'; on: boolean; size: number; damp: number; mix: number }
  | { id: string; kind: 'device'; on: boolean; device: Device };
/** The four built-in effects; a song's own devices (`kind: "device"`) are the rest. */
export type EffectKind = Exclude<Effect['kind'], 'device'>;
export type BuiltinEffect = Extract<Effect, { kind: EffectKind }>;
export const EFFECT_KINDS: EffectKind[] = ['eq', 'compressor', 'delay', 'reverb'];
export const EFFECT_NAMES: Record<EffectKind, string> = { eq: 'EQ', compressor: 'Compressor', delay: 'Delay', reverb: 'Reverb' };
/** Each effect's settings: range, and where a new one starts. */
export const EFFECT_PARAMS: { [K in EffectKind]: Record<string, { lo: number; hi: number; start: number }> } = {
  eq: {
    low: { lo: -18, hi: 18, start: 0 }, lowFreq: { lo: 30, hi: 400, start: 120 },
    mid: { lo: -18, hi: 18, start: 0 }, midFreq: { lo: 200, hi: 8000, start: 1000 }, midQ: { lo: 0.3, hi: 8, start: 1 },
    high: { lo: -18, hi: 18, start: 0 }, highFreq: { lo: 2000, hi: 16000, start: 6000 },
  },
  compressor: { threshold: { lo: -60, hi: 0, start: -18 }, ratio: { lo: 1, hi: 20, start: 4 }, attack: { lo: 0.001, hi: 0.5, start: 0.01 }, release: { lo: 0.02, hi: 1, start: 0.2 }, makeup: { lo: 0, hi: 24, start: 0 } },
  delay: { time: { lo: 0.25, hi: 2, start: 0.75 }, feedback: { lo: 0, hi: 0.9, start: 0.35 }, mix: { lo: 0, hi: 1, start: 0.25 } },
  reverb: { size: { lo: 0.3, hi: 8, start: 2 }, damp: { lo: 0, hi: 1, start: 0.4 }, mix: { lo: 0, hi: 1, start: 0.25 } },
};
/**
 * Each built-in effect as the device it is: the same parts and cables a song's own device would use, so the four
 * effects and every device are played by one piece of code. Heard exactly as before the effects were devices.
 */
export function builtinDevice(e: BuiltinEffect): Device {
  const p = (id: string, kind: DevicePart['kind'], settings: Record<string, string | number> = {}): DevicePart => ({ ...partStarts(kind), ...settings, id, kind });
  switch (e.kind) {
    case 'eq':
      return { name: 'EQ', parts: [p('in', 'input'), p('low', 'filter', { type: 'lowshelf', cutoff: e.lowFreq, gain: e.low }), p('mid', 'filter', { type: 'peaking', cutoff: e.midFreq, resonance: e.midQ, gain: e.mid }), p('high', 'filter', { type: 'highshelf', cutoff: e.highFreq, gain: e.high }), p('out', 'output')],
        cables: [['in', 'low'], ['low', 'mid'], ['mid', 'high'], ['high', 'out']], controls: [] };
    case 'compressor':
      return { name: 'Compressor', parts: [p('in', 'input'), p('comp', 'compressor', { threshold: e.threshold, ratio: e.ratio, attack: e.attack, release: e.release, knee: 6 }), p('makeup', 'gain', { gain: 10 ** (e.makeup / 20) }), p('out', 'output')],
        cables: [['in', 'comp'], ['comp', 'makeup'], ['makeup', 'out']], controls: [] };
    case 'delay':
      return { name: 'Delay', parts: [p('in', 'input'), p('echo', 'delay', { time: e.time }), p('back', 'gain', { gain: e.feedback }), p('mix', 'mix', { amount: e.mix }), p('out', 'output')],
        cables: [['in', 'mix.dry'], ['in', 'echo'], ['echo', 'back'], ['back', 'echo'], ['echo', 'mix.wet'], ['mix', 'out']], controls: [] };
    case 'reverb':
      return { name: 'Reverb', parts: [p('in', 'input'), p('room', 'reverb', { size: e.size, damp: e.damp }), p('mix', 'mix', { amount: e.mix }), p('out', 'output')],
        cables: [['in', 'mix.dry'], ['in', 'room'], ['room', 'mix.wet'], ['mix', 'out']], controls: [] };
  }
}
/** A part kind's settings where they start. */
export const partStarts = (kind: DevicePart['kind']): Record<string, string | number> => Object.fromEntries(Object.entries(PART_KINDS[kind].settings as Record<string, PartSetting>).map(([k, s]) => [k, s.start]));

/** A new effect of a kind, with its starting settings. */
export function newEffect(kind: EffectKind, id: string): Effect {
  return { id, kind, on: true, ...Object.fromEntries(Object.entries(EFFECT_PARAMS[kind]).map(([k, r]) => [k, r.start])) } as Effect;
}
/** An effect id not yet on the track. */
export function freshEffectId(track: { fx?: readonly { id: string }[] }): string {
  const used = new Set((track.fx ?? []).map((e) => e.id));
  let n = (track.fx?.length ?? 0) + 1;
  while (used.has(`fx${n}`)) n++;
  return `fx${n}`;
}

/**
 * A clip in the Session view: a short loop of notes for one track, started and stopped live. Its notes start from the
 * clip's own beat 0 and it goes round every `bars` bars.
 */
export interface Clip { name: string; bars: number; notes: SongNote[]; /** On an audio track: the sound it plays. */ audio?: ClipAudio }
/**
 * An audio clip's sound (Live 12 manual, chapter 9), as the engine reads it (mobius-audio song.rs `Audio`): a WAV file
 * in the song's folder (`file`, relative to it), from `offset` seconds in, at `gainDb`. Unwarped, it plays at its own
 * speed; warped, it follows the song's tempo by its `bpm` or its warp `markers` (a sample frame of the file at a beat
 * of the clip, as WaveformView's WarpMarker). `mode` is the warp mode, "repitch" first.
 */
export interface ClipAudio { file: string; gainDb?: number; offset?: number; warp?: boolean; mode?: string; bpm?: number; markers?: { sample: number; beat: number }[] }

/**
 * A sampler's sound (Live 12 manual, 36.8 "Working with Samples"), as the engine reads it (mobius-audio sampler.rs
 * `SamplerSound`): a WAV in the song's folder (`file`) played from `start` to `end` seconds, at its own pitch on the
 * `root` note (60 when left out). Classic (the default) plays as long as a key is held, through the track's
 * attack/decay/sustain/release, and goes round from `loopStart` when `loop`; One-Shot plays it through (or until the key
 * lifts, with `gate`), faded in and out by `fadeIn` and `fadeOut` seconds. A sampler track's sound, or a drum pad's.
 */
export interface SamplerSound { file: string; mode?: 'classic' | 'oneshot'; root?: number; gainDb?: number; start?: number; end?: number; loop?: boolean; loopStart?: number; gate?: boolean; fadeIn?: number; fadeOut?: number }

/** A sampler's sound from a file, or undefined when it names none. */
export function readSampler(v: unknown): SamplerSound | undefined {
  const a = obj(v);
  if (typeof a.file !== 'string' || !a.file.trim()) return undefined;
  const out: SamplerSound = { file: a.file.slice(0, 400) };
  const secs = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? Math.min(x, 24 * 3600) : undefined);
  if (a.mode === 'oneshot') out.mode = 'oneshot';
  if (typeof a.root === 'number' && Number.isFinite(a.root) && Math.round(a.root) !== 60) out.root = Math.round(num(a.root, 60, 0, 127));
  if (typeof a.gainDb === 'number' && Number.isFinite(a.gainDb) && a.gainDb !== 0) out.gainDb = num(a.gainDb, 0, -70, 24);
  for (const k of ['start', 'end', 'loopStart', 'fadeIn', 'fadeOut'] as const) { const t = secs(a[k]); if (t !== undefined && (t > 0 || k === 'end')) out[k] = t; }
  if (a.loop === true) out.loop = true;
  if (a.gate === true) out.gate = true;
  return out;
}

/** An audio clip's sound from a file, or undefined when it has none it can play (no file). */
export function readAudio(v: unknown): ClipAudio | undefined {
  const a = obj(v);
  if (typeof a.file !== 'string' || !a.file.trim()) return undefined;
  const audio: ClipAudio = { file: a.file.slice(0, 400) };
  if (typeof a.gainDb === 'number' && Number.isFinite(a.gainDb) && a.gainDb !== 0) audio.gainDb = num(a.gainDb, 0, -70, 24);
  if (typeof a.offset === 'number' && Number.isFinite(a.offset) && a.offset > 0) audio.offset = num(a.offset, 0, 0, 24 * 3600);
  if (a.warp === true) audio.warp = true;
  if (typeof a.mode === 'string' && a.mode) audio.mode = a.mode.slice(0, 20);
  if (typeof a.bpm === 'number' && Number.isFinite(a.bpm) && a.bpm > 0) audio.bpm = num(a.bpm, 120, 20, 999);
  const markers = (Array.isArray(a.markers) ? a.markers : []).flatMap((m) => {
    const mo = obj(m);
    return typeof mo.sample === 'number' && typeof mo.beat === 'number' && Number.isFinite(mo.sample) && Number.isFinite(mo.beat) && mo.sample >= 0 ? [{ sample: mo.sample, beat: mo.beat }] : [];
  }).slice(0, 4096);
  if (markers.length > 0) audio.markers = markers;
  return audio;
}
export const CLIP_BARS = [1, 2, 4, 8, 16] as const;
/** The rows of the Session view are scenes: one clip slot per track in each. */
export const MIN_SCENES = 4;
export const MAX_SCENES = 64;

/** A track: its instrument and notes, its colour, in the mix its `volume` (0 to 1) and `pan` (-1 left to 1 right), and its effects. */
/** A point on an automation line: where in the song (beats from 0) and the setting there, 0 to 1. */
export interface AutoPoint { beat: number; value: number }

/** Automation points read from a file: in the song, values kept 0 to 1, in order, at most one a sixty-fourth apart. */
export function readAuto(list: unknown, beats: number): AutoPoint[] {
  const points = (Array.isArray(list) ? list : []).slice(0, 512).flatMap((p): AutoPoint[] => {
    const o = obj(p);
    if (typeof o.beat !== 'number' || typeof o.value !== 'number' || !Number.isFinite(o.beat) || !Number.isFinite(o.value)) return [];
    return [{ beat: Math.round(Math.max(0, Math.min(beats, o.beat)) * 1e4) / 1e4, value: Math.round(Math.max(0, Math.min(1, o.value)) * 1000) / 1000 }];
  });
  return points.sort((a, b) => a.beat - b.beat);
}

/** An automation line's value at a beat: flat before the first point and after the last, straight between. */
export function autoValueAt(points: readonly AutoPoint[], beat: number, empty: number): number {
  if (!points.length) return empty;
  if (beat <= points[0]!.beat) return points[0]!.value;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!;
    if (beat <= b.beat) return b.beat === a.beat ? b.value : a.value + ((beat - a.beat) / (b.beat - a.beat)) * (b.value - a.value);
  }
  return points[points.length - 1]!.value;
}

/**
 * A clip in the Arrange view: where it sits in the song (`start` and `length`, in beats) and its notes, timed from the
 * clip's own start. Clips on a track are in time order and never overlap. A muted clip is kept but not played.
 */
/**
 * A clip in Arrange: `length` song beats from `start`. Its notes are in its own time, from 0. As in Live, it plays from
 * `offset` (its start marker) in its own time; with a `loop` it goes round from `loop.start` to `loop.end` until
 * `length` runs out, so stretching a looped clip repeats it. The engine plays it the same way (song.rs `notes_of`).
 */
export interface ArrangeClip { id: string; start: number; length: number; name?: string; muted?: boolean; loop?: { start: number; end: number }; offset?: number; notes: SongNote[]; /** On an audio track: the sound it plays. */ audio?: ClipAudio }

export interface Track { id: string; name: string; /** "audio" for an audio track (it plays its clips' sounds, not notes); left out, a MIDI track. */ kind?: 'audio' | 'sampler'; /** A sampler track's sound: its notes play it (none until a sample is dropped on it). */ sampler?: SamplerSound; /** Frozen (Live 12, 38.1.4): this render plays in Arrange in place of its notes, clips and effects, which can't be edited until it is unfrozen. */ frozen?: { file: string }; /** An audio track's input, by channel of the sound input (Live 12, 19.1). */ input?: number; instrument: Instrument; volume: number; pan: number; muted: boolean; solo: boolean; color: TrackColour; /** False when the instrument is switched off (bypassed); the track's effects stay as they are. */ instrumentOn?: false; /** The Arrange view's clips, in time order. */ clips: ArrangeClip[]; sound?: Sound; kit?: KitSound; pads?: Record<number, DrumPad>; fx?: Effect[]; /** How the track's volume moves along the song (beats from 0, values 0 to 1); none keeps `volume`. */ volumeAuto?: AutoPoint[]; /** The Session view's clips, one slot per scene; an empty slot is null. */ slots?: (Clip | null)[]; /** How much goes to each return track (0 to 1), after the fader, by the return's id. */ sends?: Record<string, number> }
export interface Song { version: 2; tempo: number; key: string; bars: number; tracks: Track[]; /** The Session view's scene names, top to bottom; a scene with no name is numbered. */ scenes?: string[]; /** The Main track (Live 12's name for the master): its volume and effects. Left out, it is at 0.8 with none. */ main?: MainTrack; /** Return tracks, fed by each track's `sends`; at most 12, as in Live. */ returns?: ReturnTrack[] }
/** The Main track: everything heard goes through its effects, then its volume (0 to 1). */
export interface MainTrack { volume: number; fx?: Effect[] }
/** A return track: what tracks send to it goes through its effects, its volume and pan, into Main. Its id never matches a track's. */
export interface ReturnTrack { id: string; name?: string; volume: number; pan: number; muted?: boolean; fx?: Effect[] }
export const MAX_RETURNS = 12;
export const MAIN_VOLUME = 0.8;
/** A return's name: its own, or a letter by its place, as Live names them (A, B, C…). */
export const returnName = (r: ReturnTrack, i: number): string => r.name || String.fromCharCode(65 + i);
export const BEATS_PER_BAR = 4;
export const DRUMS: { pitch: number; name: string }[] = [
  { pitch: 46, name: 'Open hat' }, { pitch: 42, name: 'Closed hat' }, { pitch: 45, name: 'Tom' }, { pitch: 39, name: 'Clap' }, { pitch: 38, name: 'Snare' }, { pitch: 36, name: 'Kick' },
];
export const KEYS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'].flatMap((n) => [`${n} major`, `${n} minor`]);

/** Each setting's range, so a value from a file (or Mobius) is kept to what the panel can show. */
export const SOUND_RANGE: Record<keyof Sound, { lo: number; hi: number }> = {
  shape: { lo: 0, hi: 1 }, detune: { lo: 0, hi: 50 }, sub: { lo: 0, hi: 1 }, drive: { lo: 0, hi: 1 },
  cutoff: { lo: 80, hi: 12000 }, resonance: { lo: 0, hi: 1 }, envAmount: { lo: 0, hi: 1 },
  attack: { lo: 0.001, hi: 2 }, decay: { lo: 0.01, hi: 4 }, sustain: { lo: 0, hi: 1 }, release: { lo: 0.02, hi: 4 },
  vibrato: { lo: 0, hi: 50 }, rate: { lo: 0.1, hi: 12 },
};
export const KIT_RANGE: Record<keyof KitSound, { lo: number; hi: number }> = { tune: { lo: -12, hi: 12 }, decay: { lo: 0.5, hi: 2 }, tone: { lo: 0, hi: 1 } };
export const KIT_DEFAULTS: KitSound = { tune: 0, decay: 1, tone: 0.5 };
/** What each instrument starts as, close to how it sounded before it had settings. */
export const SOUND_DEFAULTS: Record<Exclude<Instrument, 'drums'>, Sound> = {
  piano: { shape: 0.2, detune: 0, sub: 0, drive: 0, cutoff: 5000, resonance: 0, envAmount: 0, attack: 0.005, decay: 0.8, sustain: 0.3, release: 0.3, vibrato: 0, rate: 5 },
  bass: { shape: 1, detune: 0, sub: 0, drive: 0, cutoff: 700, resonance: 0.1, envAmount: 0, attack: 0.005, decay: 0.3, sustain: 1, release: 0.08, vibrato: 0, rate: 5 },
  pad: { shape: 1, detune: 14, sub: 0, drive: 0, cutoff: 1800, resonance: 0.1, envAmount: 0, attack: 0.25, decay: 0.3, sustain: 1, release: 0.5, vibrato: 0, rate: 5 },
  lead: { shape: 0.7, detune: 0, sub: 0, drive: 0, cutoff: 5000, resonance: 0.1, envAmount: 0, attack: 0.005, decay: 0.3, sustain: 1, release: 0.08, vibrato: 0, rate: 5 },
};
/** A track's sound as the panel shows it: its own settings, or its instrument's. Drums have a kit instead. */
export const soundOf = (t: Track): Sound | null => (t.instrument === 'drums' ? null : (t.sound ?? SOUND_DEFAULTS[t.instrument]));
/** A drums track's kit: its own, or the kit as it always sounded. */
export const kitOf = (t: Track): KitSound | null => (t.instrument === 'drums' ? (t.kit ?? KIT_DEFAULTS) : null);
/**
 * One drum's own settings on top of the kit: `tune` in semitones (-12 to 12), `decay` as a multiple (0.25 to 4),
 * `level` (0 to 1) and `pan` (-1 left to 1 right). Kept per drum pitch in `pads`; a drum at its defaults is left out.
 */
export interface DrumPad { tune: number; decay: number; level: number; pan: number; /** A sample the pad plays in place of its drum (Live 12, 25.6.1), at its own pitch moved by the kit's and pad's tune. */ sample?: SamplerSound }
/** A pad's settings that are numbers. */
export type PadSetting = Exclude<keyof DrumPad, 'sample'>;
export const PAD_RANGE: Record<PadSetting, { lo: number; hi: number }> = { tune: { lo: -12, hi: 12 }, decay: { lo: 0.25, hi: 4 }, level: { lo: 0, hi: 1 }, pan: { lo: -1, hi: 1 } };
export const PAD_DEFAULTS: DrumPad = { tune: 0, decay: 1, level: 1, pan: 0 };
/** A drum's own settings, or its defaults. */
export const padOf = (t: Track, pitch: number): DrumPad => t.pads?.[pitch] ?? PAD_DEFAULTS;
/** The kit as one drum hears it: the kit's tune and decay, moved by the drum's own. */
export const drumKit = (kit: KitSound, pad: DrumPad): KitSound => ({ tune: Math.max(-24, Math.min(24, kit.tune + pad.tune)), decay: kit.decay * pad.decay, tone: kit.tone });

const obj = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const num = (v: unknown, fallback: number, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v * 1000) / 1000)) : fallback);

/** Notes from a file, kept to `beats`; a note may also be written [pitch, start, length, velocity]. */
function readNotes(list: unknown, beats: number): SongNote[] {
  return (Array.isArray(list) ? list : []).slice(0, 5000).flatMap((n): SongNote[] => {
    const v = Array.isArray(n) ? { pitch: n[0], start: n[1], length: n[2], velocity: n[3] } : obj(n);
    if (typeof v.pitch !== 'number' || typeof v.start !== 'number') return [];
    return [{ pitch: Math.round(num(v.pitch, 60, 0, 127)), start: num(v.start, 0, 0, beats), length: num(v.length, 1, 0.0625, 64), velocity: num(v.velocity, 0.8, 0, 1) }];
  }).sort((a, b) => a.start - b.start || a.pitch - b.pitch);
}

/** A clip from a file: its length snapped to the lengths a clip can be, and its notes kept inside it. */
function readClip(v: unknown, fallbackName: string): Clip | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const c = obj(v);
  const asked = num(c.bars, 1, 1, 16);
  const bars = [...CLIP_BARS].reverse().find((b) => b <= asked) ?? 1;
  const clip: Clip = { name: typeof c.name === 'string' && c.name ? c.name.slice(0, 60) : fallbackName, bars, notes: readNotes(c.notes, bars * BEATS_PER_BAR).filter((n) => n.start < bars * BEATS_PER_BAR) };
  const audio = readAudio(c.audio);
  if (audio) clip.audio = audio;
  return clip;
}

export function parseSong(text: string): { song: Song } | { error: string } {
  let raw: unknown;
  try { raw = JSON.parse(text || '{}'); } catch (e) { return { error: e instanceof Error ? e.message : 'not JSON' }; }
  const o = obj(raw);
  const bars = Math.round(num(o.bars, 8, 1, 512));
  const taken = new Set<string>();
  // The first rule a device in the song breaks: a song with a device that can't play is refused, saying which.
  let refused: string | null = null;
  const tracks = (Array.isArray(o.tracks) ? o.tracks : []).slice(0, 32).map((t, i): Track => {
    const to = obj(t);
    let id = typeof to.id === 'string' && to.id ? to.id.slice(0, 40) : `t${i + 1}`;
    while (taken.has(id)) id = `${id}-${i}`;
    taken.add(id);
    const instrument = INSTRUMENTS.includes(to.instrument as Instrument) ? (to.instrument as Instrument) : 'piano';
    // Version 2 keeps Arrange's notes in clips. A version 1 track's notes (one list for the song), or notes written
    // beside the clips, are put into the clips they fall in, and new clips are made for the rest.
    const written = readClips(to.clips, bars * BEATS_PER_BAR);
    const loose = readNotes(to.notes, bars * BEATS_PER_BAR);
    const clips = loose.length > 0 ? putNotes(written, [...trackNotes({ clips: written }), ...loose], bars) : written;
    const color = TRACK_COLOURS.includes(to.color as TrackColour) ? (to.color as TrackColour) : TRACK_COLOURS[i % (TRACK_COLOURS.length - 2)]!;
    const track: Track = { id, name: typeof to.name === 'string' && to.name ? to.name.slice(0, 60) : INSTRUMENT_NAMES[instrument], instrument, volume: num(to.volume, 0.8, 0, 1), pan: num(to.pan, 0, -1, 1), muted: to.muted === true, solo: to.solo === true, color, clips };
    if (to.instrumentOn === false) track.instrumentOn = false;
    if (to.kind === 'audio') track.kind = 'audio';
    const fz = obj(to.frozen);
    if (typeof fz.file === 'string' && fz.file.trim()) track.frozen = { file: fz.file.slice(0, 400) };
    if (to.kind === 'sampler') {
      track.kind = 'sampler';
      const sampler = readSampler(to.sampler);
      if (sampler) track.sampler = sampler;
    }
    if (typeof to.input === 'number' && Number.isInteger(to.input) && to.input >= 0 && to.input < 64) track.input = to.input;
    const so = obj(to.sound);
    if (instrument !== 'drums' && Object.keys(so).length > 0) {
      const base = SOUND_DEFAULTS[instrument];
      track.sound = Object.fromEntries((Object.keys(SOUND_RANGE) as (keyof Sound)[]).map((k) => [k, num(so[k], base[k], SOUND_RANGE[k].lo, SOUND_RANGE[k].hi)])) as unknown as Sound;
    }
    const fx = readFx(to.fx, `Track “${track.name}”`, (why) => { refused ??= why; });
    if (fx.length > 0) track.fx = fx;
    const volumeAuto = readAuto(to.volumeAuto, bars * BEATS_PER_BAR);
    if (volumeAuto.length > 0) track.volumeAuto = volumeAuto;
    const slots = (Array.isArray(to.slots) ? to.slots : []).slice(0, MAX_SCENES).map((c) => readClip(c, track.name));
    while (slots.length > 0 && slots[slots.length - 1] === null) slots.pop();
    if (slots.length > 0) track.slots = slots;
    const ko = obj(to.kit);
    if (instrument === 'drums' && Object.keys(ko).length > 0) {
      track.kit = Object.fromEntries((Object.keys(KIT_RANGE) as (keyof KitSound)[]).map((k) => [k, num(ko[k], KIT_DEFAULTS[k], KIT_RANGE[k].lo, KIT_RANGE[k].hi)])) as unknown as KitSound;
    }
    if (track.instrument === 'drums' && to.pads && typeof to.pads === 'object') {
      const pads: Record<number, DrumPad> = {};
      for (const d of DRUMS) {
        const po = (to.pads as Record<string, unknown>)[String(d.pitch)];
        if (!po || typeof po !== 'object') continue;
        const o = po as Record<string, unknown>;
        const pad = Object.fromEntries((Object.keys(PAD_RANGE) as PadSetting[]).map((k) => [k, num(o[k], PAD_DEFAULTS[k], PAD_RANGE[k].lo, PAD_RANGE[k].hi)])) as unknown as DrumPad;
        const sample = readSampler(o.sample);
        if (sample) pad.sample = sample;
        pads[d.pitch] = pad;
      }
      if (Object.keys(pads).length > 0) track.pads = pads;
    }
    return track;
  });
  // Return tracks first need ids no track has (the engine reports their meters by id beside the tracks').
  const returns = (Array.isArray(o.returns) ? o.returns : []).slice(0, MAX_RETURNS).map((r, i): ReturnTrack => {
    const ro = obj(r);
    let id = typeof ro.id === 'string' && ro.id ? ro.id.slice(0, 40) : `r-${i + 1}`;
    while (taken.has(id)) id = `r-${id}`;
    taken.add(id);
    const ret: ReturnTrack = { id, volume: num(ro.volume, MAIN_VOLUME, 0, 1), pan: num(ro.pan, 0, -1, 1) };
    if (typeof ro.name === 'string' && ro.name) ret.name = ro.name.slice(0, 40);
    if (ro.muted === true) ret.muted = true;
    const fx = readFx(ro.fx, `Return ${returnName(ret, i)}`, (why) => { refused ??= why; });
    if (fx.length > 0) ret.fx = fx;
    return ret;
  });
  const returnIds = new Set(returns.map((r) => r.id));
  (Array.isArray(o.tracks) ? o.tracks : []).slice(0, 32).forEach((t, i) => {
    const so = obj(obj(t).sends);
    const sends = Object.fromEntries(Object.entries(so).filter(([id, v]) => returnIds.has(id) && typeof v === 'number' && Number.isFinite(v) && v > 0).map(([id, v]) => [id, Math.min(1, v as number)]));
    if (Object.keys(sends).length > 0 && tracks[i]) tracks[i]!.sends = sends;
  });
  const mo = obj(o.main);
  const mainFx = readFx(mo.fx, 'Main', (why) => { refused ??= why; });
  if (refused) return { error: refused };
  const song: Song = { version: 2, tempo: Math.round(num(o.tempo, 112, 30, 300)), key: typeof o.key === 'string' && KEYS.includes(o.key) ? o.key : 'C major', bars, tracks };
  if (Object.keys(mo).length > 0) { song.main = { volume: num(mo.volume, MAIN_VOLUME, 0, 1) }; if (mainFx.length > 0) song.main.fx = mainFx; }
  if (returns.length > 0) song.returns = returns;
  if (Array.isArray(o.scenes) && o.scenes.length > 0) song.scenes = o.scenes.slice(0, MAX_SCENES).map((n) => (typeof n === 'string' ? n.slice(0, 40) : ''));
  return { song };
}

/** A chain of effects from a file: built-in ones with their settings, and devices, which must be able to play. */
function readFx(list: unknown, where: string, refuse: (why: string) => void): Effect[] {
  return (Array.isArray(list) ? list : []).slice(0, 8).flatMap((e, j): Effect[] => {
    const eo = obj(e);
    const fxId = typeof eo.id === 'string' && eo.id ? eo.id.slice(0, 20) : `fx${j + 1}`;
    if (eo.kind === 'device') {
      const read = parseDevice(eo.device);
      if ('error' in read) { refuse(`${where}, effect ${fxId}: ${read.error}`); return []; }
      return [{ id: fxId, kind: 'device', on: eo.on !== false, device: read.device }];
    }
    const kind = EFFECT_KINDS.includes(eo.kind as EffectKind) ? (eo.kind as EffectKind) : null;
    if (!kind) return [];
    const params = Object.fromEntries(Object.entries(EFFECT_PARAMS[kind]).map(([k, r]) => [k, num(eo[k], r.start, r.lo, r.hi)]));
    return [{ id: fxId, kind, on: eo.on !== false, ...params } as Effect];
  });
}

/** How many scenes the Session view shows: the named ones, the deepest clip, and never fewer than four. */
export const sceneCount = (song: Song): number => Math.min(MAX_SCENES, Math.max(MIN_SCENES, song.scenes?.length ?? 0, ...song.tracks.map((t) => t.slots?.length ?? 0)));
/** A scene's name, or its number when it has none. */
export const sceneName = (song: Song, i: number): string => song.scenes?.[i] || String(i + 1);

/** One note to a line, so a change reads as the notes it touched. */
export function writeSong(song: Song): string {
  const lines = ['{', '  "version": 2,', `  "tempo": ${song.tempo},`, `  "key": ${JSON.stringify(song.key)},`, `  "bars": ${song.bars},`, ...(song.scenes && song.scenes.length > 0 ? [`  "scenes": ${JSON.stringify(song.scenes)},`] : []),
    ...(song.main ? [`  "main": ${JSON.stringify(song.main)},`] : []),
    ...(song.returns && song.returns.length > 0 ? ['  "returns": [', ...song.returns.map((r, i) => `    ${JSON.stringify(r)}${i < song.returns!.length - 1 ? ',' : ''}`), '  ],'] : []),
    '  "tracks": ['];
  song.tracks.forEach((t, i) => {
    const head: Record<string, unknown> = { id: t.id, name: t.name, ...(t.kind ? { kind: t.kind } : {}), ...(t.input !== undefined ? { input: t.input } : {}), instrument: t.instrument, color: t.color, volume: t.volume };
    if (t.muted) head.muted = true;
    if (t.solo) head.solo = true;
    if (t.instrumentOn === false) head.instrumentOn = false;
    if (t.pan) head.pan = t.pan;
    if (t.sends && Object.keys(t.sends).length > 0) head.sends = t.sends;
    if (t.sound && t.instrument !== 'drums') head.sound = t.sound;
    if (t.kind === 'sampler' && t.sampler) head.sampler = t.sampler;
    if (t.frozen) head.frozen = t.frozen;
    if (t.kit && t.instrument === 'drums') head.kit = t.kit;
    if (t.pads && t.instrument === 'drums') {
      const pads = Object.fromEntries(Object.entries(t.pads).filter(([, p]) => p.sample || (Object.keys(PAD_RANGE) as PadSetting[]).some((k) => p[k] !== PAD_DEFAULTS[k])));
      if (Object.keys(pads).length > 0) head.pads = pads;
    }
    if (t.fx && t.fx.length > 0) head.fx = t.fx;
    if (t.volumeAuto && t.volumeAuto.length > 0) head.volumeAuto = t.volumeAuto;
    if (t.slots && t.slots.some((c) => c !== null)) head.slots = t.slots;
    const last = i === song.tracks.length - 1;
    if (t.clips.length === 0) { lines.push(`    ${JSON.stringify({ ...head, clips: [] })}${last ? '' : ','}`); return; }
    lines.push(`    ${JSON.stringify(head).slice(0, -1)}, "clips": [`);
    t.clips.forEach((c, k) => {
      const { notes, ...rest } = c;
      const end = k < t.clips.length - 1 ? ',' : '';
      if (notes.length === 0) { lines.push(`      ${JSON.stringify({ ...rest, notes: [] })}${end}`); return; }
      lines.push(`      ${JSON.stringify(rest).slice(0, -1)}, "notes": [`);
      notes.forEach((n, j) => lines.push(`        ${JSON.stringify(n)}${j < notes.length - 1 ? ',' : ''}`));
      lines.push(`      ]}${end}`);
    });
    lines.push(`    ]}${last ? '' : ','}`);
  });
  lines.push('  ]', '}', '');
  return lines.join('\n');
}

/** Ids of tracks new in `after` or different from `before`. */
export function changedTracks(before: Song | null, after: Song): Set<string> {
  const was = new Map((before?.tracks ?? []).map((t) => [t.id, JSON.stringify({ ...t, muted: false, solo: false })]));
  return new Set(after.tracks.filter((t) => was.get(t.id) !== JSON.stringify({ ...t, muted: false, solo: false })).map((t) => t.id));
}

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const noteName = (pitch: number) => `${NAMES[pitch % 12]}${Math.floor(pitch / 12) - 1}`;

/** The pitch classes (0 for C) in a key, to shade the piano roll rows that belong. */
export function keyPitches(key: string): Set<number> {
  const [name, mode] = key.split(' ');
  const flats: Record<string, string> = { Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#' };
  const root = NAMES.indexOf(flats[name ?? ''] ?? name ?? 'C');
  const steps = mode === 'minor' ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
  return new Set(steps.map((s) => (root + s) % 12));
}

/** How long a song lasts, in seconds. */
export const songSeconds = (song: Song) => (song.bars * BEATS_PER_BAR * 60) / song.tempo;

/** Which tracks are heard: the soloed ones if any are, else every one not muted. */
export function audible(song: Song): Track[] {
  const solo = song.tracks.filter((t) => t.solo);
  return solo.length > 0 ? solo : song.tracks.filter((t) => !t.muted);
}

/** A new track's id. */
export function freshTrackId(song: Song): string {
  const used = new Set(song.tracks.map((t) => t.id));
  let n = song.tracks.length + 1;
  while (used.has(`t${n}`)) n++;
  return `t${n}`;
}

const byStart = (a: SongNote, b: SongNote) => a.start - b.start || a.pitch - b.pitch;
const round = (v: number) => Math.round(v * 1e4) / 1e4;

/** Arrange's clips from a file: in the song, in time order, never overlapping (a later one cuts an earlier one short), with ids. */
function readClips(list: unknown, beats: number): ArrangeClip[] {
  const taken = new Set<string>();
  const read = (Array.isArray(list) ? list : []).slice(0, 512).flatMap((v, i): ArrangeClip[] => {
    const c = obj(v);
    if (typeof c.start !== 'number' || typeof c.length !== 'number' || !Number.isFinite(c.start) || !Number.isFinite(c.length)) return [];
    const start = round(num(c.start, 0, 0, beats));
    if (beats - start < 0.25) return [];
    const length = round(num(c.length, BEATS_PER_BAR, 0.25, beats - start));
    let id = typeof c.id === 'string' && c.id ? c.id.slice(0, 40) : `c${i + 1}`;
    while (taken.has(id)) id = `${id}-${i}`;
    taken.add(id);
    const lp = obj(c.loop);
    const loop = typeof lp.start === 'number' && typeof lp.end === 'number' && Number.isFinite(lp.start) && Number.isFinite(lp.end) && lp.end - lp.start >= 0.25
      ? { start: round(num(lp.start, 0, 0, MAX_OWN)), end: round(num(lp.end, 4, 0.25, MAX_OWN)) } : null;
    const offset = typeof c.offset === 'number' && Number.isFinite(c.offset) ? round(num(c.offset, 0, 0, MAX_OWN)) : 0;
    const clip: ArrangeClip = { id, start, length, notes: [] };
    if (loop && loop.end > loop.start) clip.loop = loop;
    if (offset > 0) clip.offset = offset;
    const own = ownLength(clip);
    clip.notes = readNotes(c.notes, own).filter((n) => n.start < own);
    if (typeof c.name === 'string' && c.name) clip.name = c.name.slice(0, 60);
    if (c.muted === true) clip.muted = true;
    const audio = readAudio(c.audio);
    if (audio) clip.audio = audio;
    return [clip];
  }).sort((a, b) => a.start - b.start);
  return read.flatMap((c, i): ArrangeClip[] => {
    const next = read[i + 1];
    if (!next || c.start + c.length <= next.start) return [c];
    const length = round(next.start - c.start);
    // Cut short by the next clip: a looped or offset clip keeps all its notes (Live keeps a clip's contents when it's shortened).
    return length > 0 ? [{ ...c, length, notes: c.loop || c.offset ? c.notes : c.notes.filter((n) => n.start < length) }] : [];
  });
}

/** The furthest a clip's own time reaches (a loop or start marker can be far into it). */
const MAX_OWN = 4096;
/** How far a clip's notes may reach in its own time: past its loop's end, or its start marker plus its length. */
export function ownLength(c: Pick<ArrangeClip, 'length' | 'loop' | 'offset'>): number {
  return round(Math.max(c.loop?.end ?? 0, (c.offset ?? 0) + c.length, c.length));
}

/**
 * The clip's first pass (what the notes editor edits in place): from the start marker to the loop's end, or to the
 * clip's end without a loop, in its own time; and its length in song beats.
 */
export function firstPass(c: Pick<ArrangeClip, 'length' | 'loop' | 'offset'>): { from: number; to: number } {
  const from = c.offset ?? 0;
  const to = c.loop && from < c.loop.end ? Math.min(c.loop.end, from + c.length) : from + c.length;
  return { from, to: round(to) };
}

/** Where a beat `rel` from the clip's start falls in its own time: through the first pass, then round the loop. */
export function ownAt(c: Pick<ArrangeClip, 'length' | 'loop' | 'offset'>, rel: number): number {
  const { from, to } = firstPass(c);
  if (rel < to - from - 1e-9 || !c.loop) return round(from + rel);
  const span = c.loop.end - c.loop.start;
  return round(c.loop.start + ((((rel - (to - from)) % span) + span) % span));
}

/**
 * The notes a clip plays, in song time: from its start marker, cut at its end and going round its loop. The same as
 * the engine's `notes_of` (crates/mobius-audio/src/song.rs), so the window player and the engine agree.
 */
export function playedNotes(c: ArrangeClip): SongNote[] {
  const looped = !!c.loop && c.loop.end > c.loop.start;
  const [lo, hi] = looped ? [c.loop!.start, c.loop!.end] : [-Infinity, Infinity];
  const out: SongNote[] = [];
  let own = c.offset ?? 0;
  let played = 0;
  while (played < c.length && out.length < 20_000) {
    const span = Math.min((looped ? hi : Infinity) - own, c.length - played);
    for (const n of c.notes) {
      if (n.start < own - 1e-9 || n.start >= own + span - 1e-9 || n.length <= 0) continue;
      const at = c.start + played + (n.start - own);
      out.push({ ...n, start: round(at), length: round(Math.min(n.length, c.start + played + span - at)) });
    }
    played += span;
    own = looped ? lo : own + span;
    if (!looped || span <= 1e-9) break;
  }
  return out;
}

/**
 * A track's notes in song time, in order. For the notes editor: each clip's first pass, where it can be edited in
 * place (its loop's repeats are drawn from `playedNotes`). `playing`: what is heard, round loops and without muted clips.
 */
export function trackNotes(track: Pick<Track, 'clips'>, playing = false): SongNote[] {
  if (playing) return track.clips.flatMap((c) => (c.muted ? [] : playedNotes(c))).sort(byStart);
  return track.clips.flatMap((c) => {
    const { from, to } = firstPass(c);
    return c.notes.filter((n) => n.start >= from - 1e-9 && n.start < to - 1e-9).map((n) => ({ ...n, start: round(c.start + n.start - from) }));
  }).sort(byStart);
}

/** A fresh clip id among a track's clips. */
export function newClipId(clips: readonly ArrangeClip[]): string {
  const taken = new Set(clips.map((c) => c.id));
  let n = clips.length + 1;
  while (taken.has(`c${n}`)) n++;
  return `c${n}`;
}

/**
 * Puts notes (in song time) into a track's clips: each into the clip it starts in, and the rest into new clips made a
 * whole bar at a time around them, where no clip is. A clip left with no notes goes, as an empty stretch of the lane
 * did before clips were kept; new clips next to each other join.
 */
export function putNotes(clips: readonly ArrangeClip[], notes: readonly SongNote[], bars: number): ArrangeClip[] {
  // Notes outside a clip's first pass (before its start marker, or past its loop) aren't in the editor; they stay.
  const kept = clips.map((c) => { const { from, to } = firstPass(c); return { ...c, notes: c.notes.filter((n) => n.start < from - 1e-9 || n.start >= to - 1e-9) }; });
  const rest: SongNote[] = [];
  for (const n of [...notes].sort(byStart)) {
    const home = kept.find((c) => n.start >= c.start - 1e-9 && n.start < c.start + c.length - 1e-9);
    // In a looped clip's repeats, a note goes into the loop, so it is heard on every pass (as editing a loop in Live).
    if (home) home.notes.push({ ...n, start: ownAt(home, n.start - home.start) }); else rest.push(n);
  }
  for (const c of kept) c.notes.sort(byStart);
  const made: ArrangeClip[] = [];
  for (const n of rest) {
    // A note at or after the song's end has no bar to go in, and is never heard.
    if (n.start >= bars * BEATS_PER_BAR - 1e-9) continue;
    const into = made.find((c) => n.start >= c.start - 1e-9 && n.start < c.start + c.length - 1e-9);
    if (into) { into.notes.push({ ...n, start: round(n.start - into.start) }); continue; }
    // A new clip from the note's bar to the bar its end falls in, kept clear of the clips around it.
    const all = [...kept, ...made];
    const bar = Math.floor(n.start / BEATS_PER_BAR) * BEATS_PER_BAR;
    const lo = Math.max(bar, ...all.filter((c) => c.start + c.length <= n.start + 1e-9).map((c) => c.start + c.length));
    const want = Math.min(bars * BEATS_PER_BAR, Math.max(bar + BEATS_PER_BAR, Math.ceil((n.start + n.length) / BEATS_PER_BAR - 1e-9) * BEATS_PER_BAR));
    const hi = Math.min(want, ...all.filter((c) => c.start > n.start).map((c) => c.start));
    const start = round(lo);
    made.push({ id: newClipId(all), start, length: round(Math.max(0.25, hi - lo)), notes: [{ ...n, start: round(n.start - start) }] });
  }
  const joined: ArrangeClip[] = [];
  for (const c of made.sort((a, b) => a.start - b.start)) {
    const was = joined[joined.length - 1];
    if (was && Math.abs(was.start + was.length - c.start) < 1e-9) {
      was.notes.push(...c.notes.map((n) => ({ ...n, start: round(n.start + c.start - was.start) })));
      was.length = round(was.length + c.length);
    } else joined.push(c);
  }
  return [...kept.filter((c) => c.notes.length > 0), ...joined].map((c) => ({ ...c, notes: c.notes.sort(byStart) })).sort((a, b) => a.start - b.start);
}
