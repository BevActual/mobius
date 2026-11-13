import { BEATS_PER_BAR, type SongNote } from './song-format';

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
