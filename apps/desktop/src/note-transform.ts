import { keyPitches, type SongNote } from './song-format';
import { settle, type Picked } from './studio-view';

/**
 * The notes editor's Transform menu, kept apart from the screen so it can be tested. Each tool works on the picked
 * notes, or on all of them when none are picked, and gives back the notes in order with what it made picked.
 */
export type TransformId = 'arpeggiate' | 'strum' | 'chop' | 'connect' | 'humanize' | 'reverse' | 'fit-key';

const round = (n: number) => Math.round(n * 1000) / 1000;
const EPS = 1e-6;

/** Which notes a tool works on: the picked ones, or every note when none are. */
const chosenOf = (notes: readonly SongNote[], picked: Picked) => (picked.size === 0 ? new Set(notes.map((_, i) => i)) : new Set(picked));

/**
 * The list again: notes not chosen as they were, and each chosen note replaced by what the tool `made` of it (itself
 * when it made nothing). What came of a pick stays picked; working on every note picks nothing.
 */
function rebuild(notes: readonly SongNote[], chosen: ReadonlySet<number>, made: Map<number, SongNote[]>, keep: boolean) {
  return settle(notes.flatMap((note, i) => (chosen.has(i) ? (made.get(i) ?? [note]).map((n) => ({ note: n, picked: keep })) : [{ note, picked: false }])));
}

/** The chosen notes grouped into chords: notes that start together. */
function chords(notes: readonly SongNote[], chosen: ReadonlySet<number>): number[][] {
  const groups: number[][] = [];
  [...chosen].sort((a, b) => notes[a]!.start - notes[b]!.start).forEach((i) => {
    const last = groups[groups.length - 1];
    if (last && Math.abs(notes[last[0]!]!.start - notes[i]!.start) < EPS) last.push(i);
    else groups.push([i]);
  });
  return groups;
}

/**
 * Each chord played one note at a time, a grid step each, for as long as the chord lasted: up (low to high), down,
 * or up and down. A note on its own is left alone.
 */
export function arpeggiate(notes: readonly SongNote[], picked: Picked, grid: number, style: 'up' | 'down' | 'updown' = 'up') {
  const chosen = chosenOf(notes, picked);
  const made = new Map<number, SongNote[]>();
  for (const group of chords(notes, chosen)) {
    if (group.length < 2) continue;
    const these = group.map((i) => notes[i]!).sort((a, b) => a.pitch - b.pitch);
    const order = style === 'down' ? [...these].reverse() : style === 'updown' ? [...these, ...these.slice(1, -1).reverse()] : these;
    const start = these[0]!.start;
    const end = Math.max(...these.map((n) => n.start + n.length));
    const out: SongNote[] = [];
    for (let k = 0, at = start; at < end - EPS; k++, at = round(start + k * grid)) {
      const n = order[k % order.length]!;
      out.push({ pitch: n.pitch, start: at, length: round(Math.min(grid, end - at)), velocity: n.velocity });
    }
    made.set(group[0]!, out);
    group.slice(1).forEach((i) => made.set(i, []));
  }
  return rebuild(notes, chosen, made, picked.size > 0);
}

/**
 * Each chord spread out like a strummed guitar: each note `step` beats after the one below it (above it when
 * `down`), ending where it did. The spread never takes a note below a sixty-fourth.
 */
export function strum(notes: readonly SongNote[], picked: Picked, step: number, down = false) {
  const chosen = chosenOf(notes, picked);
  const made = new Map<number, SongNote[]>();
  for (const group of chords(notes, chosen)) {
    if (group.length < 2) continue;
    const order = [...group].sort((a, b) => (down ? notes[b]!.pitch - notes[a]!.pitch : notes[a]!.pitch - notes[b]!.pitch));
    order.forEach((i, k) => {
      const n = notes[i]!;
      const shift = Math.min(k * step, Math.max(0, n.length - 0.0625));
      const start = round(n.start + shift);
      made.set(i, [{ ...n, start, length: round(n.start + n.length - start) }]);
    });
  }
  return rebuild(notes, chosen, made, picked.size > 0);
}

/** Each note longer than a grid step cut into notes a step long, keeping its end. */
export function chop(notes: readonly SongNote[], picked: Picked, grid: number) {
  const chosen = chosenOf(notes, picked);
  const made = new Map<number, SongNote[]>();
  chosen.forEach((i) => {
    const n = notes[i]!;
    if (n.length <= grid + EPS) return;
    const out: SongNote[] = [];
    const end = n.start + n.length;
    for (let k = 0, at = n.start; at < end - EPS; k++, at = round(n.start + k * grid)) out.push({ ...n, start: at, length: round(Math.min(grid, end - at)) });
    made.set(i, out);
  });
  return rebuild(notes, chosen, made, picked.size > 0);
}

/** Each note held until the next one starts (legato). The last notes keep their length. */
export function connect(notes: readonly SongNote[], picked: Picked) {
  const chosen = chosenOf(notes, picked);
  const starts = [...new Set([...chosen].map((i) => notes[i]!.start))].sort((a, b) => a - b);
  const made = new Map<number, SongNote[]>();
  chosen.forEach((i) => {
    const n = notes[i]!;
    const next = starts.find((s) => s > n.start + EPS);
    if (next !== undefined) made.set(i, [{ ...n, length: round(next - n.start) }]);
  });
  return rebuild(notes, chosen, made, picked.size > 0);
}

/** A small random number generator, so the same `seed` gives the same feel (and tests can check it). */
function random(seed: number) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 10000) / 10000; };
}

/**
 * The notes loosened as a player would: each start moved by up to `timing` beats either way and its velocity by up
 * to `level`, kept inside the song and between 0.05 and 1.
 */
export function humanize(notes: readonly SongNote[], picked: Picked, total: number, seed: number, timing = 0.03, level = 0.08) {
  const chosen = chosenOf(notes, picked);
  const next = random(seed);
  const made = new Map<number, SongNote[]>();
  chosen.forEach((i) => {
    const n = notes[i]!;
    const start = round(Math.max(0, Math.min(total - n.length, n.start + (next() * 2 - 1) * timing)));
    const velocity = Math.round(Math.max(0.05, Math.min(1, n.velocity + (next() * 2 - 1) * level)) * 100) / 100;
    made.set(i, [{ ...n, start, velocity }]);
  });
  return rebuild(notes, chosen, made, picked.size > 0);
}

/** The notes played backwards across the span they fill: the last one first. */
export function reverse(notes: readonly SongNote[], picked: Picked) {
  const chosen = chosenOf(notes, picked);
  if (chosen.size === 0) return rebuild(notes, chosen, new Map(), false);
  const these = [...chosen].map((i) => notes[i]!);
  const first = Math.min(...these.map((n) => n.start));
  const last = Math.max(...these.map((n) => n.start + n.length));
  const made = new Map<number, SongNote[]>();
  chosen.forEach((i) => { const n = notes[i]!; made.set(i, [{ ...n, start: round(first + last - n.start - n.length) }]); });
  return rebuild(notes, chosen, made, picked.size > 0);
}

/** Notes outside the song's key moved to the nearest note in it (down when both are as near). Drums are left alone. */
export function fitKey(notes: readonly SongNote[], picked: Picked, key: string) {
  const chosen = chosenOf(notes, picked);
  const inKey = keyPitches(key);
  const made = new Map<number, SongNote[]>();
  chosen.forEach((i) => {
    const n = notes[i]!;
    if (inKey.has(n.pitch % 12)) return;
    const to = [n.pitch - 1, n.pitch + 1, n.pitch - 2, n.pitch + 2].find((p) => p >= 0 && p <= 127 && inKey.has(p % 12));
    if (to !== undefined) made.set(i, [{ ...n, pitch: to }]);
  });
  return rebuild(notes, chosen, made, picked.size > 0);
}
