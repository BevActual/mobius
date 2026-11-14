import type { EqBand } from './ui';
import { BEATS_PER_BAR, EFFECT_PARAMS, type Effect, type EffectKind, type KitSound, type SongNote, type Sound } from './song-format';

/**
 * The piano roll's editing, kept apart from the screen so it can be tested: notes picked by their place in the track,
 * moved, stretched, copied and lined up to the grid. Each change gives back the notes in order and which of them are
 * still picked, since sorting moves them about.
 */
export type Picked = ReadonlySet<number>;

const byTime = (a: SongNote, b: SongNote) => a.start - b.start || a.pitch - b.pitch;
const round = (n: number) => Math.round(n * 1000) / 1000;

/** Notes in order with the ones marked `picked` found again after sorting. */
function settle(notes: { note: SongNote; picked: boolean }[]): { notes: SongNote[]; picked: Set<number> } {
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
export function duplicateNotes(notes: readonly SongNote[], picked: Picked, total: number) {
  const chosen = notes.filter((_, i) => picked.has(i));
  if (chosen.length === 0) return { notes: [...notes], picked: new Set<number>() };
  const first = Math.min(...chosen.map((n) => n.start));
  const span = Math.max(...chosen.map((n) => n.start + n.length)) - first;
  // A copy starts on the next bar line when the picked notes fill whole bars, so loops stay in time.
  const step = span % BEATS_PER_BAR === 0 || span > BEATS_PER_BAR ? Math.ceil(span / BEATS_PER_BAR) * BEATS_PER_BAR : span;
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
export function cycleOf(barA: number, barB: number, bars: number): Cycle {
  const a = Math.max(0, Math.min(bars - 1, Math.min(barA, barB)));
  const b = Math.max(a + 1, Math.min(bars, Math.max(barA, barB) + 1));
  return { from: a * BEATS_PER_BAR, to: b * BEATS_PER_BAR };
}

/** The notes inside a box drawn on the roll, from beat `b0` to `b1` and pitch `p0` to `p1` (either way round). */
export function notesIn(notes: readonly SongNote[], b0: number, b1: number, p0: number, p1: number): Set<number> {
  const [s, e] = b0 < b1 ? [b0, b1] : [b1, b0];
  const [lo, hi] = p0 < p1 ? [p0, p1] : [p1, p0];
  return new Set(notes.flatMap((n, i) => (n.pitch >= lo && n.pitch <= hi && n.start < e && n.start + n.length > s ? [i] : [])));
}

/** Where the song is, as the transport shows it: bar.beat.sixteenth, and minutes and seconds. */
export function position(beat: number, tempo: number): { bars: string; time: string } {
  const b = Math.max(0, beat);
  const bar = Math.floor(b / BEATS_PER_BAR) + 1;
  const inBar = Math.floor(b % BEATS_PER_BAR) + 1;
  const sixteenth = Math.floor((b % 1) * 4) + 1;
  const seconds = (b * 60) / tempo;
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
export function clipsOf(notes: readonly SongNote[], bars: number): { from: number; to: number }[] {
  const used = new Array<boolean>(bars).fill(false);
  for (const n of notes) {
    const first = Math.floor(n.start / BEATS_PER_BAR);
    const last = Math.min(bars - 1, Math.floor((n.start + n.length - 1e-6) / BEATS_PER_BAR));
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

/** Steps in a bar: sixteenth notes, four to a beat. */
export const STEPS_PER_BAR = BEATS_PER_BAR * 4;
const sameBeat = (a: number, b: number) => Math.abs(a - b) < 1e-6;

/** A bar of drum notes as step cells, one row per pitch: each step is the velocity of a hit starting on it, or 0. */
export function stepCells(notes: readonly SongNote[], bar: number, pitches: readonly number[]): number[][] {
  return pitches.map((pitch) => Array.from({ length: STEPS_PER_BAR }, (_, i) => {
    const at = bar * BEATS_PER_BAR + i / 4;
    return notes.find((n) => n.pitch === pitch && sameBeat(n.start, at))?.velocity ?? 0;
  }));
}

/** A step switched on (a sixteenth hit at that velocity), changed, or off (velocity 0); the notes stay in order. */
export function setStep(notes: readonly SongNote[], bar: number, pitch: number, step: number, velocity: number): SongNote[] {
  const at = bar * BEATS_PER_BAR + step / 4;
  const kept = notes.filter((n) => !(n.pitch === pitch && sameBeat(n.start, at)));
  if (velocity > 0) kept.push({ pitch, start: at, length: 0.25, velocity: Math.min(1, velocity) });
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
export const nextBar = (beat: number): number => Math.max(0, Math.ceil(beat / BEATS_PER_BAR - 1e-9) * BEATS_PER_BAR);
