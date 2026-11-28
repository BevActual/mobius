import type { EqBand } from './ui';
import { PART_KINDS, type Device, type PartSetting } from './device-format';
import { BEATS_PER_BAR, EFFECT_NAMES, EFFECT_PARAMS, KIT_DEFAULTS, kitOf, soundOf, type Effect, type EffectKind, type KitSound, type SongNote, type Sound, type Track, trackNotes, type ArrangeClip } from './song-format';

/**
 * The piano roll's editing, kept apart from the screen so it can be tested: notes picked by their place in the track,
 * moved, stretched, copied and lined up to the grid. Each change gives back the notes in order and which of them are
 * still picked, since sorting moves them about.
 */
export type Picked = ReadonlySet<number>;

const byTime = (a: SongNote, b: SongNote) => a.start - b.start || a.pitch - b.pitch;
const round = (n: number) => Math.round(n * 1000) / 1000;

/** Notes in order with the ones marked `picked` found again after sorting. */
export function settle(notes: { note: SongNote; picked: boolean }[]): { notes: SongNote[]; picked: Set<number> } {
  const sorted = [...notes].sort((a, b) => byTime(a.note, b.note));
  return { notes: sorted.map((n) => n.note), picked: new Set(sorted.flatMap((n, i) => (n.picked ? [i] : []))) };
}

/** A beat put on the grid (`grid` in beats: 1 a quarter, 0.25 a sixteenth). */
export const snap = (beat: number, grid: number) => round(Math.floor(beat / grid + 1e-6) * grid);
/** A beat put on the nearest grid line. */
export const snapNear = (beat: number, grid: number) => round(Math.round(beat / grid) * grid);

/** The picked notes moved by `beats` and `semitones`, kept inside the song and the keyboard. */
export function moveNotes(notes: readonly SongNote[], picked: Picked, beats: number, semitones: number, total: number) {
  const chosen = notes.filter((_, i) => picked.has(i));
  if (chosen.length === 0) return { notes: [...notes], picked: new Set<number>() };
  // The whole group stops at an edge together, so chords keep their shape.
  const first = Math.min(...chosen.map((n) => n.start));
  const last = Math.max(...chosen.map((n) => n.start + n.length));
  const db = Math.max(-first, Math.min(total - last, beats));
  const lo = Math.min(...chosen.map((n) => n.pitch));
  const hi = Math.max(...chosen.map((n) => n.pitch));
  const dp = Math.max(-lo, Math.min(127 - hi, semitones));
  return settle(notes.map((note, i) => (picked.has(i) ? { note: { ...note, start: round(note.start + db), pitch: note.pitch + dp }, picked: true } : { note, picked: false })));
}

/** The picked notes made `beats` longer or shorter, never shorter than `min` nor past the end of the song. */
export function stretchNotes(notes: readonly SongNote[], picked: Picked, beats: number, total: number, min = 0.0625) {
  return settle(notes.map((note, i) => (picked.has(i) ? { note: { ...note, length: round(Math.max(min, Math.min(total - note.start, note.length + beats))) }, picked: true } : { note, picked: false })));
}

/** The picked notes taken out. */
export const removeNotes = (notes: readonly SongNote[], picked: Picked) => notes.filter((_, i) => !picked.has(i));

/** A note added (or the same note, if it is already there) and picked on its own. */
export function addNote(notes: readonly SongNote[], note: SongNote) {
  const same = notes.findIndex((n) => n.pitch === note.pitch && n.start === note.start);
  if (same >= 0) return { notes: [...notes], picked: new Set([same]) };
  return settle([...notes.map((n) => ({ note: n, picked: false })), { note, picked: true }]);
}

/** The picked notes copied straight after themselves (Ctrl+D), the copies picked; what would run past the end is left out. */
export function duplicateNotes(notes: readonly SongNote[], picked: Picked, total: number, perBar = BEATS_PER_BAR) {
  const chosen = notes.filter((_, i) => picked.has(i));
  if (chosen.length === 0) return { notes: [...notes], picked: new Set<number>() };
  const first = Math.min(...chosen.map((n) => n.start));
  const span = Math.max(...chosen.map((n) => n.start + n.length)) - first;
  // A copy starts on the next bar line when the picked notes fill whole bars, so loops stay in time.
  const step = Math.abs(span % perBar) < 1e-9 || span > perBar ? Math.ceil(span / perBar - 1e-9) * perBar : span;
  const copies = chosen.map((n) => ({ ...n, start: round(n.start + step) })).filter((n) => n.start + n.length <= total + 1e-6);
  return settle([...notes.map((n) => ({ note: n, picked: false })), ...copies.map((n) => ({ note: n, picked: true }))]);
}

/** Copied notes put in from `at`, keeping their spacing; the pasted notes picked. */
export function pasteNotes(notes: readonly SongNote[], copied: readonly SongNote[], at: number, total: number) {
  if (copied.length === 0) return { notes: [...notes], picked: new Set<number>() };
  const first = Math.min(...copied.map((n) => n.start));
  const put = copied.map((n) => ({ ...n, start: round(n.start - first + at) })).filter((n) => n.start + n.length <= total + 1e-6);
  return settle([...notes.map((n) => ({ note: n, picked: false })), ...put.map((n) => ({ note: n, picked: true }))]);
}

/** The picked notes (all of them when none are picked) lined up to the grid: starts to the nearest line, lengths at least one step. */
export function quantizeNotes(notes: readonly SongNote[], picked: Picked, grid: number, total: number) {
  const all = picked.size === 0;
  return settle(notes.map((note, i) => {
    if (!all && !picked.has(i)) return { note, picked: false };
    const start = Math.min(total - grid, snapNear(note.start, grid));
    const length = Math.max(grid, snapNear(note.length, grid));
    return { note: { ...note, start, length: round(Math.min(length, total - start)) }, picked: !all };
  }));
}

/**
 * The picked notes cut in two (Ctrl+E): at `at` where it falls inside a note, else on the grid line nearest its middle.
 * A note too short to cut is left whole. Both halves stay picked.
 */
export function splitNotes(notes: readonly SongNote[], picked: Picked, at: number, grid: number) {
  return settle(notes.flatMap((note, i): { note: SongNote; picked: boolean }[] => {
    if (!picked.has(i)) return [{ note, picked: false }];
    const end = note.start + note.length;
    const inside = at > note.start + 1e-6 && at < end - 1e-6;
    const cut = round(inside ? at : snapNear(note.start + note.length / 2, grid));
    if (cut <= note.start + 1e-6 || cut >= end - 1e-6) return [{ note, picked: true }];
    return [{ note: { ...note, length: round(cut - note.start) }, picked: true }, { note: { ...note, start: cut, length: round(end - cut) }, picked: true }];
  }));
}

/**
 * The picked notes of each pitch made one (Ctrl+J): from the first start to the last end, at the first note's
 * loudness. Notes alone on their pitch are left as they are.
 */
export function joinNotes(notes: readonly SongNote[], picked: Picked) {
  const groups = new Map<number, number[]>();
  notes.forEach((n, i) => { if (picked.has(i)) groups.set(n.pitch, [...(groups.get(n.pitch) ?? []), i]); });
  const gone = new Set<number>();
  const joined: SongNote[] = [];
  for (const at of groups.values()) {
    if (at.length < 2) continue;
    const these = at.map((i) => notes[i]!).sort(byTime);
    const first = these[0]!;
    const end = Math.max(...these.map((n) => n.start + n.length));
    joined.push({ ...first, length: round(end - first.start) });
    at.forEach((i) => gone.add(i));
  }
  return settle([
    ...notes.flatMap((note, i) => (gone.has(i) ? [] : [{ note, picked: picked.has(i) }])),
    ...joined.map((note) => ({ note, picked: true })),
  ]);
}

/**
 * A note played while recording, once its key is let go: from where it was pressed to `end`. When the loop went round
 * while it was held, it ends at the loop's end. At least a 1/64 note long, and never past the song's end; null if it
 * began past the end.
 */
export function recordedNote(held: { pitch: number; start: number; velocity: number }, end: number, cycle: Cycle | null, total: number): SongNote | null {
  const start = round(Math.max(0, held.start));
  if (start >= total) return null;
  const to = end < held.start && cycle ? cycle.to : end;
  const length = round(Math.min(total - start, Math.max(1 / 16, to - start)));
  return { pitch: held.pitch, start, length, velocity: round(Math.max(0, Math.min(1, held.velocity))) };
}

/** The picked notes set to one loudness (0 to 1). */
export function setVelocity(notes: readonly SongNote[], picked: Picked, velocity: number): SongNote[] {
  const v = round(Math.max(0, Math.min(1, velocity)));
  return notes.map((n, i) => (picked.has(i) ? { ...n, velocity: v } : n));
}

/** The picked notes made louder or softer by `by` (−1 to 1), each kept between 0 and 1, so a group keeps its accents. */
export function nudgeVelocity(notes: readonly SongNote[], picked: Picked, by: number): SongNote[] {
  return notes.map((n, i) => (picked.has(i) ? { ...n, velocity: round(Math.max(0, Math.min(1, n.velocity + by))) } : n));
}

/** How tall the track list is when it fits its tracks: the ruler plus one lane each, at least room for one. */
export const fitTracks = (tracks: number, ruler = 24, lane = 49) => ruler + Math.max(1, tracks) * lane;

/** A loop of whole bars, in beats: from `from` up to (not including) `to`. */
export interface Cycle { from: number; to: number }

/**
 * Where the song is after `played` beats of playing from `start`, going round `cycle` when there is one. Playing from
 * before the loop runs into it and then goes round; playing from after it starts at the loop.
 */
export function songBeat(played: number, start: number, cycle: Cycle | null): number {
  if (!cycle) return start + played;
  const from = start >= cycle.to ? cycle.from : start;
  const at = from + played;
  return at < cycle.to ? at : cycle.from + ((at - cycle.to) % (cycle.to - cycle.from));
}

/** The loop between two bars picked on the ruler (either way round, counted from 0), kept inside the song. */
export function cycleOf(barA: number, barB: number, bars: number, perBar = BEATS_PER_BAR): Cycle {
  const a = Math.max(0, Math.min(bars - 1, Math.min(barA, barB)));
  const b = Math.max(a + 1, Math.min(bars, Math.max(barA, barB) + 1));
  return { from: a * perBar, to: b * perBar };
}

/** The notes inside a box drawn on the roll, from beat `b0` to `b1` and pitch `p0` to `p1` (either way round). */
export function notesIn(notes: readonly SongNote[], b0: number, b1: number, p0: number, p1: number): Set<number> {
  const [s, e] = b0 < b1 ? [b0, b1] : [b1, b0];
  const [lo, hi] = p0 < p1 ? [p0, p1] : [p1, p0];
  return new Set(notes.flatMap((n, i) => (n.pitch >= lo && n.pitch <= hi && n.start < e && n.start + n.length > s ? [i] : [])));
}

/**
 * Where the song is, as the transport shows it: bar.beat.sixteenth, and minutes and seconds. The beat is the time
 * signature's own (an eighth in 6/8), as Live counts it.
 */
export function position(beat: number, tempo: number, signature?: readonly [number, number], at?: number): { bars: string; time: string } {
  const b = Math.max(0, beat);
  const [num, unit] = signature ?? [4, 4];
  const perBar = (num * 4) / unit;
  const per = 4 / unit;
  const bar = Math.floor(b / perBar + 1e-9) + 1;
  const into = Math.max(0, b - (bar - 1) * perBar);
  const inBar = Math.floor(into / per + 1e-9) + 1;
  const sixteenth = Math.floor(((into - (inBar - 1) * per) / 0.25) + 1e-9) + 1;
  // `at`: the seconds it falls at along a tempo line, when the song has one.
  const seconds = at ?? (b * 60) / tempo;
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return { bars: `${bar}.${inBar}.${sixteenth}`, time: `${m}:${s.toFixed(1).padStart(4, '0')}` };
}

/** The grid choices for the roll, in beats. */
export const GRIDS: readonly { label: string; beats: number }[] = [
  { label: '1 bar', beats: 4 }, { label: '1/2', beats: 2 }, { label: '1/4', beats: 1 }, { label: '1/8', beats: 0.5 }, { label: '1/16', beats: 0.25 }, { label: '1/32', beats: 0.125 },
];

/** Whether a MIDI pitch is a black key. */
export const isBlack = (pitch: number) => [1, 3, 6, 8, 10].includes(((pitch % 12) + 12) % 12);

/**
 * A track's notes as clips along the arrangement: each run of bars that has notes, split where a whole bar is empty.
 * `from` and `to` are bars counted from 0, `to` not included.
 */
export function clipsOf(notes: readonly SongNote[], bars: number, perBar = BEATS_PER_BAR): { from: number; to: number }[] {
  const used = new Array<boolean>(bars).fill(false);
  for (const n of notes) {
    const first = Math.floor(n.start / perBar);
    const last = Math.min(bars - 1, Math.floor((n.start + n.length - 1e-6) / perBar));
    for (let b = Math.max(0, first); b <= last; b++) used[b] = true;
  }
  const clips: { from: number; to: number }[] = [];
  used.forEach((on, b) => {
    if (!on) return;
    const was = clips[clips.length - 1];
    if (was && was.to === b) was.to = b + 1; else clips.push({ from: b, to: b + 1 });
  });
  return clips;
}

/** A Device setting's value as the panel writes it: "35%", "12 ct", "1.2 kHz", "840 ms", "2.1 s", "5.0 Hz". */
export function soundText(key: keyof Sound, v: number): string {
  if (key === 'detune' || key === 'vibrato') return `${Math.round(v)} ct`;
  if (key === 'cutoff') return v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)} kHz` : `${Math.round(v)} Hz`;
  if (key === 'rate') return `${v.toFixed(1)} Hz`;
  if (key === 'attack' || key === 'decay' || key === 'release') return v >= 1 ? `${v.toFixed(1)} s` : `${Math.round(v * 1000)} ms`;
  return `${Math.round(v * 100)}%`;
}

/** A kit setting as the panel writes it: "+3 st", "1.5×", "60%". */
export function kitText(key: keyof KitSound, v: number): string {
  if (key === 'tune') return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(Math.round(v))} st`;
  if (key === 'decay') return `${Number(v.toFixed(2))}×`;
  return `${Math.round(v * 100)}%`;
}

/** Where a track sits left to right, as the panel writes it: "L 40", "C", "R 40". */
export function panText(v: number): string {
  const n = Math.round(Math.abs(v) * 100);
  return n === 0 ? 'C' : `${v < 0 ? 'L' : 'R'} ${n}`;
}

/**
 * Where a setting sits along its slider, from 0 to 1, and back. Cutoff, attack and release are heard in ratios, so
 * they move evenly in octaves rather than in Hz or seconds.
 */
export function toSlider(v: number, lo: number, hi: number, log: boolean): number {
  return log ? Math.log(v / lo) / Math.log(hi / lo) : (v - lo) / (hi - lo);
}
export function fromSlider(t: number, lo: number, hi: number, log: boolean): number {
  const x = Math.max(0, Math.min(1, t));
  const v = log ? lo * (hi / lo) ** x : lo + x * (hi - lo);
  return Math.round(v * 1000) / 1000;
}

/** An effect setting as the Device panel shows it: dB, Hz, a ratio, a time or a share. */
export function effectText(kind: EffectKind, k: string, v: number): string {
  const db = (x: number) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(1)} dB`;
  const hz = (x: number) => (x >= 1000 ? `${(x / 1000).toFixed(1)} kHz` : `${Math.round(x)} Hz`);
  const secs = (x: number) => (x >= 1 ? `${x.toFixed(2)} s` : x >= 0.01 ? `${Math.round(x * 1000)} ms` : `${(x * 1000).toFixed(1)} ms`);
  if (kind === 'gate' || kind === 'limiter') {
    if (k === 'return' || k === 'gain' || k === 'ceiling') return db(v);
    if (k === 'threshold' || k === 'floor') return `${v < 0 ? '−' : ''}${Math.abs(Math.round(v))} dB`;
    return secs(v);
  }
  if (kind === 'saturator' && (k === 'drive' || k === 'output')) return db(v);
  if (kind === 'beatrepeat') {
    if (k === 'volume') return db(v);
    // Offset and Gate in sixteenths, as Live shows them; a whole bar or more as bars.
    if (k === 'offset' || k === 'gate') return v >= 16 && v % 16 === 0 ? `${v / 16} ${v === 16 ? 'bar' : 'bars'}` : `${Number(v.toFixed(2))}/16`;
  }
  if (kind === 'autofilter' || kind === 'chorus' || kind === 'phaser') {
    if (k === 'cutoff' || k === 'center') return hz(v);
    if (k === 'depth') return kind === 'chorus' ? secs(v) : hz(v);
    if (k === 'rate') return `${v < 10 ? v.toFixed(2) : v.toFixed(1)} Hz`;
    if (k === 'resonance') return v.toFixed(1);
    if (k === 'delay') return secs(v);
    if (k === 'highpass') return v < 20 ? 'Off' : hz(v);
  }
  if (k === 'midFreq') return v >= 1000 ? `${(v / 1000).toFixed(1)} kHz` : `${Math.round(v)} Hz`;
  if (kind === 'eq' || k === 'makeup') return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)} dB`;
  if (k === 'threshold') return `${v < 0 ? '−' : ''}${Math.abs(Math.round(v))} dB`;
  if (k === 'ratio') return `${Number(v.toFixed(1))}:1`;
  if (k === 'attack' || k === 'release') return v >= 1 ? `${v.toFixed(1)} s` : `${Math.round(v * 1000)} ms`;
  if (k === 'size') return `${v.toFixed(1)} s`;
  return `${Math.round(v * 100)}%`;
}

export type EqEffect = Extract<Effect, { kind: 'eq' }>;
/** A track EQ as the shared graph's three bands: low shelf, bell, high shelf. */
export function eqBands(e: EqEffect): EqBand[] {
  return [
    { type: 'lowshelf', freq: e.lowFreq, gain: e.low, q: 0.7 },
    { type: 'peak', freq: e.midFreq, gain: e.mid, q: e.midQ },
    { type: 'highshelf', freq: e.highFreq, gain: e.high, q: 0.7 },
  ];
}
/** A band moved on the graph, back as the EQ's own settings, kept to their ranges. */
export function eqFromBand(i: number, band: EqBand): Partial<EqEffect> {
  const r = EFFECT_PARAMS.eq, c = (k: string, v: number) => Math.min(r[k]!.hi, Math.max(r[k]!.lo, v));
  if (i === 0) return { low: c('low', band.gain), lowFreq: c('lowFreq', band.freq) };
  if (i === 1) return { mid: c('mid', band.gain), midFreq: c('midFreq', band.freq), midQ: c('midQ', band.q) };
  return { high: c('high', band.gain), highFreq: c('highFreq', band.freq) };
}

/** Steps in a bar of 4/4: sixteenth notes, four to a beat. */
export const STEPS_PER_BAR = BEATS_PER_BAR * 4;
/** Steps in a bar of `perBar` beats: a sixteenth each, so 12 in 3/4 and 14 in 7/8. */
export const stepsPerBar = (perBar = BEATS_PER_BAR): number => Math.round(perBar * 4);
const sameBeat = (a: number, b: number) => Math.abs(a - b) < 1e-6;

/** A bar of drum notes as step cells, one row per pitch: each step is the velocity of a hit starting on it, or 0. */
export function stepCells(notes: readonly SongNote[], bar: number, pitches: readonly number[], perBar = BEATS_PER_BAR): number[][] {
  return pitches.map((pitch) => Array.from({ length: stepsPerBar(perBar) }, (_, i) => {
    const at = bar * perBar + i / 4;
    return notes.find((n) => n.pitch === pitch && sameBeat(n.start, at))?.velocity ?? 0;
  }));
}

/** A step switched on (a hit at that velocity, a sixteenth long unless `length` says), changed, or off (velocity 0); the notes stay in order. */
export function setStep(notes: readonly SongNote[], bar: number, pitch: number, step: number, velocity: number, length = 0.25, perBar = BEATS_PER_BAR): SongNote[] {
  const at = bar * perBar + step / 4;
  const kept = notes.filter((n) => !(n.pitch === pitch && sameBeat(n.start, at)));
  if (velocity > 0) kept.push({ pitch, start: at, length, velocity: Math.min(1, velocity) });
  return kept.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
}

/**
 * Where a looping clip's notes fall in [from, to): the clip started at `start` (in beats played) and goes round every
 * `length` beats. Each hit is the note and the beat it plays on.
 */
export function clipHits<N extends { start: number }>(notes: readonly N[], length: number, start: number, from: number, to: number): { note: N; at: number }[] {
  if (length <= 0 || to <= from) return [];
  const hits: { note: N; at: number }[] = [];
  for (const note of notes) {
    // The first time round that this note is at or after `from`.
    let at = start + note.start + Math.max(0, Math.ceil((from - start - note.start) / length - 1e-9)) * length;
    for (; at < to - 1e-9; at += length) if (at >= from - 1e-9) hits.push({ note, at });
  }
  return hits.sort((a, b) => a.at - b.at);
}

/** The next bar line at or after `beat`, where a launched clip starts, so it lands in time with what is playing. */
export const nextBar = (beat: number, perBar = BEATS_PER_BAR): number => Math.max(0, Math.ceil(beat / perBar - 1e-9) * perBar);

/** A melody's step rows, high to low: `count` notes in the key, from the C of `octave` up (C4 is middle C). */
export function scaleRows(inKey: ReadonlySet<number>, octave: number, count = 15): number[] {
  const rows: number[] = [];
  for (let p = 12 * (octave + 1); rows.length < count && p <= 127; p++) if (inKey.has(p % 12)) rows.push(p);
  return rows.reverse();
}

/** The octave a melody's steps open on: the one its notes sit in most, or a starting point for the instrument. */
export function stepOctave(notes: readonly SongNote[], fallback: number): number {
  if (notes.length === 0) return fallback;
  const counts = new Map<number, number>();
  for (const n of notes) { const o = Math.floor(n.pitch / 12) - 1; counts.set(o, (counts.get(o) ?? 0) + 1); }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]![0];
}

const FLAT_KEYS = new Set(['F major', 'Bb major', 'Eb major', 'Ab major', 'Db major', 'Gb major', 'D minor', 'G minor', 'C minor', 'F minor', 'Bb minor', 'Eb minor']);
const SHARP_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const FLAT_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
/** A note's name as the song's key spells it: B♭5 in F major, A♯5 in B major (C4 is middle C). */
export function spellIn(pitch: number, key: string): string {
  return `${(FLAT_KEYS.has(key) ? FLAT_NAMES : SHARP_NAMES)[pitch % 12]}${Math.floor(pitch / 12) - 1}`;
}

/**
 * The computer keyboard as an instrument, the way desktop studios lay it out: the middle letter row is the white keys
 * from C (A S D F G H J K L ;), the row above the black keys between them (W E, T Y U, O P). Gives the semitone above
 * the octave's C, or null for a key that plays nothing.
 */
const KEY_SEMITONES: Record<string, number> = { a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12, o: 13, l: 14, p: 15, ';': 16 };
export const KEYBOARD_KEYS = Object.keys(KEY_SEMITONES);
export function keyboardPitch(key: string, octave: number): number | null {
  const semi = KEY_SEMITONES[key.toLowerCase()];
  if (semi === undefined) return null;
  const pitch = 12 * (octave + 1) + semi;
  return pitch >= 0 && pitch <= 127 ? pitch : null;
}
/** For drums, the white keys from A play the drums from the kick up; the others play nothing. */
export function keyboardDrum(key: string, drumsUp: readonly number[]): number | null {
  const i = ['a', 's', 'd', 'f', 'g', 'h'].indexOf(key.toLowerCase());
  return i >= 0 && i < drumsUp.length ? drumsUp[i]! : null;
}
/** The keyboard's velocity moves in steps of 20 out of 127 (C softer, V louder), kept between 1 and 127. */
export const nudgeKeyVelocity = (v: number, by: -1 | 1): number => Math.max(1, Math.min(127, v + by * 20));

const SOUND_WORDS: Record<keyof Sound, string> = {
  shape: 'shape', detune: 'detune', sub: 'sub', drive: 'drive', cutoff: 'cutoff', resonance: 'resonance', envAmount: 'filter envelope',
  attack: 'attack', decay: 'decay', sustain: 'sustain', release: 'release', vibrato: 'vibrato', rate: 'vibrato rate',
};
const KIT_WORDS: Record<keyof KitSound, string> = { tune: 'tune', decay: 'decay', tone: 'tone' };

/** One setting Mobius moved on a track: `key` names the knob (`sound:cutoff`, `kit:tone`, `fx:<id>:mix`, `fx:<id>`, `volume`, `pan`). */
export interface SoundChange { key: string; text: string }

/**
 * What changed in how a track sounds, setting by setting, for the review bar: "cutoff 4.2 kHz → 1.1 kHz", "added Delay".
 * Notes are not counted here. A track that is new has nothing to compare, so it gives none.
 */
export function soundChanges(was: Track | undefined, now: Track): SoundChange[] {
  if (!was) return [];
  const out: SoundChange[] = [];
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  if (was.volume !== now.volume) out.push({ key: 'volume', text: `volume ${pct(was.volume)} → ${pct(now.volume)}` });
  if (was.pan !== now.pan) out.push({ key: 'pan', text: `pan ${panText(was.pan)} → ${panText(now.pan)}` });
  const a = soundOf(was), b = soundOf(now);
  if (a && b && was.instrument === now.instrument) {
    for (const k of Object.keys(SOUND_WORDS) as (keyof Sound)[]) {
      if (a[k] !== b[k]) out.push({ key: `sound:${k}`, text: `${SOUND_WORDS[k]} ${soundText(k, a[k])} → ${soundText(k, b[k])}` });
    }
  }
  if (was.instrument === 'drums' && now.instrument === 'drums') {
    const x = kitOf(was) ?? KIT_DEFAULTS, y = kitOf(now) ?? KIT_DEFAULTS;
    for (const k of Object.keys(KIT_WORDS) as (keyof KitSound)[]) {
      if (x[k] !== y[k]) out.push({ key: `kit:${k}`, text: `${KIT_WORDS[k]} ${kitText(k, x[k])} → ${kitText(k, y[k])}` });
    }
  }
  if (JSON.stringify(was.stack ?? null) !== JSON.stringify(now.stack ?? null)) out.push({ key: 'stack', text: now.stack ? (was.stack ? 'changed Instrument Stack' : 'added Instrument Stack') : 'removed Instrument Stack' });
  const before = new Map((was.fx ?? []).map((e) => [e.id, e]));
  for (const e of now.fx ?? []) {
    const o = before.get(e.id);
    const name = effectName(e);
    if (!o || o.kind !== e.kind) { out.push({ key: `fx:${e.id}`, text: `added ${name}` }); continue; }
    if (o.on !== e.on) out.push({ key: `fx:${e.id}`, text: `${name} ${e.on ? 'on' : 'off'}` });
    if (e.kind === 'stack' || o.kind === 'stack') {
      if (JSON.stringify(o) !== JSON.stringify(e)) out.push({ key: `fx:${e.id}`, text: `changed ${name}` });
      continue;
    }
    if (e.kind === 'device' || o.kind === 'device') {
      if (e.kind === 'device' && o.kind === 'device') out.push(...deviceChanges(e.id, o.device, e.device));
      continue;
    }
    for (const k of Object.keys(EFFECT_PARAMS[e.kind])) {
      const p = (o as unknown as Record<string, number>)[k]!, q = (e as unknown as Record<string, number>)[k]!;
      if (p !== q) out.push({ key: `fx:${e.id}:${k}`, text: `${e.kind === 'eq' ? 'EQ' : name.toLowerCase()} ${k} ${effectText(e.kind, k, p)} → ${effectText(e.kind, k, q)}` });
    }
  }
  const kept = new Set((now.fx ?? []).map((e) => e.id));
  for (const e of was.fx ?? []) if (!kept.has(e.id)) out.push({ key: `fx:${e.id}`, text: `took out ${effectName(e)}` });
  return out;
}

/** An effect's name: a built-in's, or a device's own. */
export const effectName = (e: Effect): string => (e.kind === 'device' ? e.device.name : e.kind === 'stack' ? 'Stack' : EFFECT_NAMES[e.kind]);

/** A device setting as it reads on its knob, from its unit: 2.4 kHz, −6.0 dB, 0.75 beats, 120 ms, or a share. */
export function deviceSettingText(range: { lo: number; hi: number; unit?: string }, v: number): string {
  switch (range.unit) {
    case 'Hz': return v >= 1000 ? `${(v / 1000).toFixed(1)} kHz` : `${v < 10 ? v.toFixed(2) : Math.round(v)} Hz`;
    case 'dB': return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)} dB`;
    case 's': return v >= 1 ? `${v.toFixed(1)} s` : `${Math.round(v * 1000)} ms`;
    case 'beats': return `${Number(v.toFixed(2))} ${v === 1 ? 'beat' : 'beats'}`;
  }
  if (range.lo === 0 && range.hi === 1) return `${Math.round(v * 100)}%`;
  return `${Number(v.toFixed(2))}`;
}

/** What moved inside a device: each part's setting that changed (by its control's name when it has one), or that the patch itself was changed. */
export function deviceChanges(id: string, was: Device, now: Device): SoundChange[] {
  const shape = (d: Device) => JSON.stringify([d.parts.map((p) => [p.id, p.kind]), d.cables]);
  if (shape(was) !== shape(now)) return [{ key: `fx:${id}`, text: `changed ${now.name}’s parts` }];
  const out: SoundChange[] = [];
  for (const p of now.parts) {
    const q = was.parts.find((x) => x.id === p.id)!;
    for (const [k, s] of Object.entries(PART_KINDS[p.kind].settings) as [string, PartSetting][]) {
      if (q[k] === p[k]) continue;
      const label = now.controls.find((c) => c.part === p.id && c.param === k)?.label ?? `${p.id} ${k}`;
      const text = 'choices' in s ? `${q[k]} → ${p[k]}` : `${deviceSettingText(s, Number(q[k]))} → ${deviceSettingText(s, Number(p[k]))}`;
      out.push({ key: `fx:${id}:${p.id}.${k}`, text: `${now.name} ${label.toLowerCase()} ${text}` });
    }
  }
  return out;
}

/** Whether two versions of a track have different notes (by pitch, start, length and velocity). */
export function notesDiffer(a: Track | undefined, b: Track): boolean {
  return !a || JSON.stringify(trackNotes(a)) !== JSON.stringify(trackNotes(b));
}

/**
 * Where the song's view should scroll to keep the playhead in sight while playing, as a page turn: null while it is in
 * view. `x` is the playhead from the start of the lanes; `head` is the track headers' width, which covers the lanes'
 * left edge.
 */
export function followScroll(scrollLeft: number, width: number, head: number, x: number): number | null {
  const left = scrollLeft;
  const right = scrollLeft + width - head;
  if (width - head <= 0) return null;
  if (x >= left && x < right - 16) return null;
  return Math.max(0, x - 16);
}

/** Where a clip may sit: from the end of the clip before it to the start of the one after, within the song. */
function roomFor(clips: readonly ArrangeClip[], id: string, songBeats: number): { lo: number; hi: number } {
  const i = clips.findIndex((c) => c.id === id);
  return { lo: i > 0 ? clips[i - 1]!.start + clips[i - 1]!.length : 0, hi: i >= 0 && i < clips.length - 1 ? clips[i + 1]!.start : songBeats };
}
const cleanBeat = (v: number) => Math.round(v * 1e4) / 1e4;

/** A clip moved to start at `start` (beats), kept between its neighbours and inside the song; clips never pass each other. */
export function moveClip(clips: readonly ArrangeClip[], id: string, start: number, songBeats: number): ArrangeClip[] {
  const c = clips.find((x) => x.id === id);
  if (!c) return [...clips];
  const { lo, hi } = roomFor(clips, id, songBeats);
  const at = cleanBeat(Math.max(lo, Math.min(hi - c.length, start)));
  return clips.map((x) => (x.id === id ? { ...x, start: at } : x));
}

/** A clip made `length` beats long, at least a beat, up to the next clip or the song's end; notes past its new end go. */
export function resizeClip(clips: readonly ArrangeClip[], id: string, length: number, songBeats: number): ArrangeClip[] {
  const c = clips.find((x) => x.id === id);
  if (!c) return [...clips];
  const { hi } = roomFor(clips, id, songBeats);
  const to = cleanBeat(Math.max(Math.min(1, hi - c.start), Math.min(hi - c.start, length)));
  // A looped clip keeps its notes (stretching it shows more passes); a plain one loses what falls past its new end.
  return clips.map((x) => (x.id === id ? { ...x, length: to, notes: x.loop || x.offset ? x.notes : x.notes.filter((n) => n.start < to) } : x));
}

const beat4 = (v: number) => Math.round(v * 1e4) / 1e4;

/**
 * Sets a clip's start marker (`offset`) and loop (`loopStart`, `loopLength`), as Live's Clip View fields do, in beats of
 * the clip's own time. A loop is at least a quarter beat; nothing goes below 0.
 */
export function setClipLoop(clips: readonly ArrangeClip[], id: string, to: { offset?: number; loopStart?: number; loopLength?: number }): ArrangeClip[] {
  return clips.map((c) => {
    if (c.id !== id) return c;
    const next = { ...c };
    if (to.offset !== undefined) { const o = beat4(Math.max(0, to.offset)); if (o > 0) next.offset = o; else delete next.offset; }
    if (c.loop && (to.loopStart !== undefined || to.loopLength !== undefined)) {
      const start = beat4(Math.max(0, to.loopStart ?? c.loop.start));
      const length = beat4(Math.max(0.25, to.loopLength ?? c.loop.end - c.loop.start));
      next.loop = { start, end: beat4(start + length) };
    }
    return next;
  });
}

/** Doubles (`factor` 2) or halves (0.5) a looped clip's loop, as Ctrl+Up and Ctrl+Down do in Live's Clip View. */
export function scaleClipLoop(clips: readonly ArrangeClip[], id: string, factor: number): ArrangeClip[] {
  const c = clips.find((x) => x.id === id);
  if (!c?.loop) return [...clips];
  return setClipLoop(clips, id, { loopLength: (c.loop.end - c.loop.start) * factor });
}

/**
 * Turns a clip's loop on or off, as Live's Loop switch does. On, the loop is what the clip plays now: from its start
 * marker for its length, so it sounds the same until it is stretched, when it repeats.
 */
export function toggleClipLoop(clips: readonly ArrangeClip[], id: string): ArrangeClip[] {
  return clips.map((c) => {
    if (c.id !== id) return c;
    if (c.loop) { const { loop: _, ...rest } = c; return rest; }
    const from = c.offset ?? 0;
    return { ...c, loop: { start: from, end: Math.round((from + c.length) * 1e4) / 1e4 } };
  });
}

/** A copy of a clip straight after it, when there is room there before the next clip and the song's end; else null. */
export function duplicateClip(clips: readonly ArrangeClip[], id: string, songBeats: number): { clips: ArrangeClip[]; id: string } | null {
  const c = clips.find((x) => x.id === id);
  if (!c) return null;
  const { hi } = roomFor(clips, id, songBeats);
  if (c.start + 2 * c.length > hi + 1e-9) return null;
  const taken = new Set(clips.map((x) => x.id));
  let n = clips.length + 1;
  while (taken.has(`c${n}`)) n++;
  const copy: ArrangeClip = { ...c, id: `c${n}`, start: cleanBeat(c.start + c.length), notes: c.notes.map((x) => ({ ...x })) };
  return { clips: [...clips, copy].sort((a, b) => a.start - b.start), id: copy.id };
}

/**
 * The track's clips once a recording from `from` to `to` (beats) lands on it, as Live's Arrangement records: what the
 * take covers goes. A clip it covers whole is removed, one it overlaps is cut back to where it starts or ends (the
 * later part keeps playing from the same place in its notes or sound), and one it falls inside is split in two around
 * it. `nextId` names any new piece; `tempo` turns beats into seconds for an unwarped sound.
 */
export function recordOver(clips: readonly ArrangeClip[], from: number, to: number, tempo: number, nextId: () => string): ArrangeClip[] {
  const out: ArrangeClip[] = [];
  const later = (c: ArrangeClip, cut: number, id: string): ArrangeClip => {
    const by = cut - c.start;
    const next: ArrangeClip = { ...c, id, start: beat4(cut), length: beat4(c.start + c.length - cut), notes: c.notes.map((n) => ({ ...n })) };
    if (c.audio) {
      const secs = (by * 60) / (c.audio.warp && c.audio.bpm ? c.audio.bpm : tempo);
      next.audio = { ...c.audio, offset: Math.round(((c.audio.offset ?? 0) + secs) * 1e6) / 1e6 };
    } else next.offset = beat4((c.offset ?? 0) + by);
    return next;
  };
  const earlier = (c: ArrangeClip, cut: number): ArrangeClip => {
    const length = beat4(cut - c.start);
    return { ...c, length, notes: c.loop || c.offset ? c.notes : c.notes.filter((n) => n.start < length) };
  };
  for (const c of clips) {
    const end = c.start + c.length;
    if (end <= from + 1e-9 || c.start >= to - 1e-9) { out.push(c); continue; }
    if (c.start < from - 1e-9) out.push(earlier(c, from));
    if (end > to + 1e-9) out.push(later(c, to, c.start < from - 1e-9 ? nextId() : c.id));
  }
  return out.sort((a, b) => a.start - b.start);
}
