/**
 * A song is JSON, notes rather than sound, so the agent can read and write it like a score:
 *
 *     { "version": 1, "tempo": 112, "key": "A minor", "bars": 8,
 *       "tracks": [{ "id": "t1", "name": "Bass", "instrument": "bass", "color": "blue", "volume": 0.8,
 *         "notes": [{ "pitch": 45, "start": 0, "length": 1.5, "velocity": 0.9 }] }] }
 *
 * Bars are four beats. A note's `start` and `length` are in beats from the start of the song; `pitch` is a MIDI note
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
  | { id: string; kind: 'reverb'; on: boolean; size: number; damp: number; mix: number };
export type EffectKind = Effect['kind'];
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

/** A track: its instrument and notes, its colour, in the mix its `volume` (0 to 1) and `pan` (-1 left to 1 right), and its effects. */
export interface Track { id: string; name: string; instrument: Instrument; volume: number; pan: number; muted: boolean; solo: boolean; color: TrackColour; /** False when the instrument is switched off (bypassed); the track's effects stay as they are. */ instrumentOn?: false; notes: SongNote[]; sound?: Sound; kit?: KitSound; pads?: Record<number, DrumPad>; fx?: Effect[] }
export interface Song { version: 1; tempo: number; key: string; bars: number; tracks: Track[] }
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
export interface DrumPad { tune: number; decay: number; level: number; pan: number }
export const PAD_RANGE: Record<keyof DrumPad, { lo: number; hi: number }> = { tune: { lo: -12, hi: 12 }, decay: { lo: 0.25, hi: 4 }, level: { lo: 0, hi: 1 }, pan: { lo: -1, hi: 1 } };
export const PAD_DEFAULTS: DrumPad = { tune: 0, decay: 1, level: 1, pan: 0 };
/** A drum's own settings, or its defaults. */
export const padOf = (t: Track, pitch: number): DrumPad => t.pads?.[pitch] ?? PAD_DEFAULTS;
/** The kit as one drum hears it: the kit's tune and decay, moved by the drum's own. */
export const drumKit = (kit: KitSound, pad: DrumPad): KitSound => ({ tune: Math.max(-24, Math.min(24, kit.tune + pad.tune)), decay: kit.decay * pad.decay, tone: kit.tone });

const obj = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const num = (v: unknown, fallback: number, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v * 1000) / 1000)) : fallback);

export function parseSong(text: string): { song: Song } | { error: string } {
  let raw: unknown;
  try { raw = JSON.parse(text || '{}'); } catch (e) { return { error: e instanceof Error ? e.message : 'not JSON' }; }
  const o = obj(raw);
  const bars = Math.round(num(o.bars, 8, 1, 512));
  const taken = new Set<string>();
  const tracks = (Array.isArray(o.tracks) ? o.tracks : []).slice(0, 32).map((t, i): Track => {
    const to = obj(t);
    let id = typeof to.id === 'string' && to.id ? to.id.slice(0, 40) : `t${i + 1}`;
    while (taken.has(id)) id = `${id}-${i}`;
    taken.add(id);
    const instrument = INSTRUMENTS.includes(to.instrument as Instrument) ? (to.instrument as Instrument) : 'piano';
    const notes = (Array.isArray(to.notes) ? to.notes : []).slice(0, 5000).flatMap((n): SongNote[] => {
      // A note may also be written [pitch, start, length, velocity].
      const v = Array.isArray(n) ? { pitch: n[0], start: n[1], length: n[2], velocity: n[3] } : obj(n);
      if (typeof v.pitch !== 'number' || typeof v.start !== 'number') return [];
      return [{ pitch: Math.round(num(v.pitch, 60, 0, 127)), start: num(v.start, 0, 0, bars * BEATS_PER_BAR), length: num(v.length, 1, 0.0625, 64), velocity: num(v.velocity, 0.8, 0, 1) }];
    }).sort((a, b) => a.start - b.start || a.pitch - b.pitch);
    const color = TRACK_COLOURS.includes(to.color as TrackColour) ? (to.color as TrackColour) : TRACK_COLOURS[i % (TRACK_COLOURS.length - 2)]!;
    const track: Track = { id, name: typeof to.name === 'string' && to.name ? to.name.slice(0, 60) : INSTRUMENT_NAMES[instrument], instrument, volume: num(to.volume, 0.8, 0, 1), pan: num(to.pan, 0, -1, 1), muted: to.muted === true, solo: to.solo === true, color, notes };
    if (to.instrumentOn === false) track.instrumentOn = false;
    const so = obj(to.sound);
    if (instrument !== 'drums' && Object.keys(so).length > 0) {
      const base = SOUND_DEFAULTS[instrument];
      track.sound = Object.fromEntries((Object.keys(SOUND_RANGE) as (keyof Sound)[]).map((k) => [k, num(so[k], base[k], SOUND_RANGE[k].lo, SOUND_RANGE[k].hi)])) as unknown as Sound;
    }
    const fx = (Array.isArray(to.fx) ? to.fx : []).slice(0, 8).flatMap((e, j): Effect[] => {
      const eo = obj(e);
      const kind = EFFECT_KINDS.includes(eo.kind as EffectKind) ? (eo.kind as EffectKind) : null;
      if (!kind) return [];
      const params = Object.fromEntries(Object.entries(EFFECT_PARAMS[kind]).map(([k, r]) => [k, num(eo[k], r.start, r.lo, r.hi)]));
      return [{ id: typeof eo.id === 'string' && eo.id ? eo.id.slice(0, 20) : `fx${j + 1}`, kind, on: eo.on !== false, ...params } as Effect];
    });
    if (fx.length > 0) track.fx = fx;
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
        pads[d.pitch] = Object.fromEntries((Object.keys(PAD_RANGE) as (keyof DrumPad)[]).map((k) => [k, num(o[k], PAD_DEFAULTS[k], PAD_RANGE[k].lo, PAD_RANGE[k].hi)])) as unknown as DrumPad;
      }
      if (Object.keys(pads).length > 0) track.pads = pads;
    }
    return track;
  });
  return { song: { version: 1, tempo: Math.round(num(o.tempo, 112, 30, 300)), key: typeof o.key === 'string' && KEYS.includes(o.key) ? o.key : 'C major', bars, tracks } };
}

/** One note to a line, so a change reads as the notes it touched. */
export function writeSong(song: Song): string {
  const lines = ['{', '  "version": 1,', `  "tempo": ${song.tempo},`, `  "key": ${JSON.stringify(song.key)},`, `  "bars": ${song.bars},`, '  "tracks": ['];
  song.tracks.forEach((t, i) => {
    const head: Record<string, unknown> = { id: t.id, name: t.name, instrument: t.instrument, color: t.color, volume: t.volume };
    if (t.muted) head.muted = true;
    if (t.solo) head.solo = true;
    if (t.instrumentOn === false) head.instrumentOn = false;
    if (t.pan) head.pan = t.pan;
    if (t.sound && t.instrument !== 'drums') head.sound = t.sound;
    if (t.kit && t.instrument === 'drums') head.kit = t.kit;
    if (t.pads && t.instrument === 'drums') {
      const pads = Object.fromEntries(Object.entries(t.pads).filter(([, p]) => (Object.keys(PAD_DEFAULTS) as (keyof DrumPad)[]).some((k) => p[k] !== PAD_DEFAULTS[k])));
      if (Object.keys(pads).length > 0) head.pads = pads;
    }
    if (t.fx && t.fx.length > 0) head.fx = t.fx;
    const last = i === song.tracks.length - 1;
    if (t.notes.length === 0) { lines.push(`    ${JSON.stringify({ ...head, notes: [] })}${last ? '' : ','}`); return; }
    lines.push(`    ${JSON.stringify(head).slice(0, -1)}, "notes": [`);
    t.notes.forEach((n, j) => lines.push(`      ${JSON.stringify(n)}${j < t.notes.length - 1 ? ',' : ''}`));
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
