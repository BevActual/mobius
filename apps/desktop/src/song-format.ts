/**
 * A song is JSON, notes rather than sound, so the agent can read and write it like a score:
 *
 *     { "version": 1, "tempo": 112, "key": "A minor", "bars": 8,
 *       "tracks": [{ "id": "t1", "name": "Bass", "instrument": "bass", "volume": 0.8,
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
 * How a track's instrument sounds (the Device panel): the oscillator's shape (0 a pure sine, 1 a bright saw), two voices
 * detuned apart in cents, a low-pass filter's cutoff in Hz and resonance (0 to 1), and the envelope's attack and
 * release in seconds. A track without one sounds as its instrument always has.
 */
export interface Sound { shape: number; detune: number; cutoff: number; resonance: number; attack: number; release: number }
export interface Track { id: string; name: string; instrument: Instrument; volume: number; muted: boolean; solo: boolean; notes: SongNote[]; sound?: Sound }
export interface Song { version: 1; tempo: number; key: string; bars: number; tracks: Track[] }
export const BEATS_PER_BAR = 4;
export const DRUMS: { pitch: number; name: string }[] = [
  { pitch: 46, name: 'Open hat' }, { pitch: 42, name: 'Closed hat' }, { pitch: 45, name: 'Tom' }, { pitch: 39, name: 'Clap' }, { pitch: 38, name: 'Snare' }, { pitch: 36, name: 'Kick' },
];
export const KEYS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'].flatMap((n) => [`${n} major`, `${n} minor`]);

/** Each setting's range, so a value from a file (or Mobius) is kept to what the panel can show. */
export const SOUND_RANGE: Record<keyof Sound, { lo: number; hi: number }> = {
  shape: { lo: 0, hi: 1 }, detune: { lo: 0, hi: 50 }, cutoff: { lo: 80, hi: 12000 }, resonance: { lo: 0, hi: 1 }, attack: { lo: 0.001, hi: 2 }, release: { lo: 0.02, hi: 4 },
};
/** What each instrument starts as, close to how it sounded before it had settings. */
export const SOUND_DEFAULTS: Record<Exclude<Instrument, 'drums'>, Sound> = {
  piano: { shape: 0.2, detune: 0, cutoff: 5000, resonance: 0, attack: 0.005, release: 0.3 },
  bass: { shape: 1, detune: 0, cutoff: 700, resonance: 0.1, attack: 0.005, release: 0.08 },
  pad: { shape: 1, detune: 14, cutoff: 1800, resonance: 0.1, attack: 0.25, release: 0.5 },
  lead: { shape: 0.7, detune: 0, cutoff: 5000, resonance: 0.1, attack: 0.005, release: 0.08 },
};
/** A track's sound as the panel shows it: its own settings, or its instrument's. Drums have none. */
export const soundOf = (t: Track): Sound | null => (t.instrument === 'drums' ? null : (t.sound ?? SOUND_DEFAULTS[t.instrument]));

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
    const track: Track = { id, name: typeof to.name === 'string' && to.name ? to.name.slice(0, 60) : INSTRUMENT_NAMES[instrument], instrument, volume: num(to.volume, 0.8, 0, 1), muted: to.muted === true, solo: to.solo === true, notes };
    const so = obj(to.sound);
    if (instrument !== 'drums' && Object.keys(so).length > 0) {
      const base = SOUND_DEFAULTS[instrument];
      track.sound = Object.fromEntries((Object.keys(SOUND_RANGE) as (keyof Sound)[]).map((k) => [k, num(so[k], base[k], SOUND_RANGE[k].lo, SOUND_RANGE[k].hi)])) as unknown as Sound;
    }
    return track;
  });
  return { song: { version: 1, tempo: Math.round(num(o.tempo, 112, 30, 300)), key: typeof o.key === 'string' && KEYS.includes(o.key) ? o.key : 'C major', bars, tracks } };
}

/** One note to a line, so a change reads as the notes it touched. */
export function writeSong(song: Song): string {
  const lines = ['{', '  "version": 1,', `  "tempo": ${song.tempo},`, `  "key": ${JSON.stringify(song.key)},`, `  "bars": ${song.bars},`, '  "tracks": ['];
  song.tracks.forEach((t, i) => {
    const head: Record<string, unknown> = { id: t.id, name: t.name, instrument: t.instrument, volume: t.volume };
    if (t.muted) head.muted = true;
    if (t.solo) head.solo = true;
    if (t.sound && t.instrument !== 'drums') head.sound = t.sound;
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
