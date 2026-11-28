// Grooves (Live 12 manual, 14 "Using Grooves"): the Groove Pool's grooves, how a clip's notes play with one (as the
// engine's crates/mobius-audio/src/groove.rs moves them), Commit (14.1.2) and Extract Groove (14.2.1).
import { GROOVE_BASES, MAX_GROOVES, MAX_GROOVE_AMOUNT, MAX_HITS, type Groove, type Song, type SongNote } from './song-format';

/** The grooves Music comes with: swing at a few amounts, on eighths and sixteenths, each with its quiet off-beats. */
export interface GrooveTemplate { name: string; base: number; swing: number }
export const GROOVE_LIBRARY: readonly GrooveTemplate[] = [
  { name: 'Swing 8ths 55', base: 0.5, swing: 0.55 },
  { name: 'Swing 8ths 60', base: 0.5, swing: 0.6 },
  { name: 'Swing 8ths 66', base: 0.5, swing: 2 / 3 },
  { name: 'Swing 8ths 71', base: 0.5, swing: 0.71 },
  { name: 'Swing 16ths 54', base: 0.25, swing: 0.54 },
  { name: 'Swing 16ths 58', base: 0.25, swing: 0.58 },
  { name: 'Swing 16ths 62', base: 0.25, swing: 0.62 },
  { name: 'Swing 16ths 66', base: 0.25, swing: 2 / 3 },
];

/** A template's groove, one bar of 4/4: each pair of `base` steps has its second at `swing` of the pair, a touch quieter. */
export function grooveFrom(t: GrooveTemplate, id: string): Groove {
  const length = 4;
  const hits: Groove['hits'] = [];
  for (let at = 0; at < length - 1e-9; at += t.base * 2) {
    hits.push({ at, velocity: Math.abs(at % 1) < 1e-9 ? 1 : 0.85 });
    hits.push({ at: at + t.base * 2 * t.swing, velocity: 0.7 });
  }
  return { id, name: t.name, base: t.base, quantize: 0, timing: 1, random: 0, velocity: 0, length, hits };
}

/** A groove id the pool does not have. */
export function freshGrooveId(song: Song): string {
  const taken = new Set((song.grooves ?? []).map((g) => g.id));
  let n = (song.grooves?.length ?? 0) + 1;
  while (taken.has(`gr-${n}`)) n++;
  return `gr-${n}`;
}

/** Puts a groove in the Groove Pool (a library groove, or one extracted); its id, or null when the pool is full. */
export function addGroove(song: Song, groove: Omit<Groove, 'id'>): string | null {
  const pool = song.grooves ?? [];
  if (pool.length >= MAX_GROOVES) return null;
  const id = freshGrooveId(song);
  song.grooves = [...pool, { ...groove, id }];
  return id;
}

/** Takes a groove out of the pool; its clips play as written again. */
export function removeGroove(song: Song, id: string): void {
  song.grooves = (song.grooves ?? []).filter((g) => g.id !== id);
  if (song.grooves.length === 0) delete song.grooves;
  for (const t of song.tracks) {
    for (const c of t.clips) if (c.groove === id) delete c.groove;
    for (const c of t.slots ?? []) if (c?.groove === id) delete c.groove;
  }
}

/** How many clips play with a groove: an unused one is shown dimmed, as Live's Inactive grooves are. */
export function grooveUses(song: Song, id: string): number {
  return song.tracks.reduce((n, t) => n + t.clips.filter((c) => c.groove === id).length + (t.slots ?? []).filter((c) => c?.groove === id).length, 0);
}

const M = (1n << 64n) - 1n;
const mul = (a: bigint, b: bigint) => (a * b) & M;
/** A roll from 0 to 1 for a note, the same each time and the same as groove.rs `roll`. */
export function roll(pitch: number, start: number): number {
  const t = BigInt.asUintN(64, BigInt(Math.round(start * 960)));
  let x = mul(BigInt(pitch), 0x9E3779B97F4A7C15n) ^ mul(t, 0xBF58476D1CE4E5B9n);
  x ^= x >> 30n;
  x = mul(x, 0xBF58476D1CE4E5B9n);
  x ^= x >> 27n;
  x = mul(x, 0x94D049BB133111EBn);
  x ^= x >> 31n;
  return Number(x >> 40n) / 2 ** 24;
}

/** The groove's offset and velocity at grid point `g`: its note nearest the point within half of Base, if any. */
function hitAt(groove: Groove, g: number): [number, number] | null {
  const { length } = groove;
  const p = ((g % length) + length) % length;
  let best: [number, number] | null = null;
  for (const h of groove.hits.slice(0, MAX_HITS)) {
    let d = (((h.at - p) % length) + length) % length;
    if (d > length * 0.5) d -= length;
    if (Math.abs(d) >= groove.base * 0.5 - 1e-9) continue;
    if (!best || Math.abs(d) < Math.abs(best[0])) best = [d, h.velocity];
  }
  return best;
}

/** The notes as they play with `groove` at Global Amount `amount`, in the clip's own beats (groove.rs `apply`). */
export function grooveNotes(notes: readonly SongNote[], groove: Groove, amount = 1): SongNote[] {
  if (!(groove.base > 1e-6) || !(groove.length > 1e-6)) return notes.map((n) => ({ ...n }));
  const a = Number.isFinite(amount) ? Math.min(MAX_GROOVE_AMOUNT, Math.max(0, amount)) : 1;
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const quantize = clamp(groove.quantize, 0, 1);
  const timing = clamp(groove.timing, 0, 1) * a;
  const random = clamp(groove.random, 0, 1) * a;
  const velocity = clamp(groove.velocity, -1, 1) * a;
  const hits = groove.hits.slice(0, MAX_HITS);
  const mean = hits.length ? hits.reduce((s, h) => s + h.velocity, 0) / hits.length : 1;
  return notes.map((n) => {
    const g = Math.round(n.start / groove.base) * groove.base;
    let start = n.start + (g - n.start) * quantize;
    let vel = n.velocity;
    const hit = hitAt(groove, g);
    if (hit) { start += hit[0] * timing; vel += velocity * (hit[1] - mean); }
    if (random > 0) start += (roll(n.pitch, n.start) * 2 - 1) * random * groove.base * 0.25;
    return { ...n, start: Math.max(0, start), velocity: clamp(vel, 0, 1) };
  });
}

/** Rounded as notes are kept in a song file, so a committed clip saves as it plays. */
const keep = (v: number) => Math.round(v * 1e6) / 1e6;

/**
 * Commit (14.1.2): writes the groove into the clip's notes, which then stay where it put them, and sets its Groove to
 * None. Notes it pushed past the clip's end are kept inside it. Whether anything was committed.
 */
export function commitGroove(song: Song, clip: { notes: SongNote[]; groove?: string }, own: number): boolean {
  const groove = song.grooves?.find((g) => g.id === clip.groove);
  if (!groove) return false;
  clip.notes = grooveNotes(clip.notes, groove, song.grooveAmount ?? 1)
    .map((n) => ({ ...n, start: keep(Math.min(n.start, Math.max(0, own - n.length))), velocity: keep(n.velocity) }))
    .sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  delete clip.groove;
  return true;
}

/**
 * Extract Groove (14.2.1): a groove from a clip's notes, their timing and volume, over its `own` beats. Notes that start
 * together count once, at the loudest. Measured against sixteenths.
 */
export function extractGroove(name: string, notes: readonly SongNote[], own: number): Omit<Groove, 'id'> {
  const length = Math.min(64, Math.max(0.25, own));
  const hits: Groove['hits'] = [];
  for (const n of [...notes].sort((a, b) => a.start - b.start)) {
    if (n.start < 0 || n.start >= length) continue;
    const same = hits.find((h) => Math.abs(h.at - n.start) < 1e-6);
    if (same) same.velocity = Math.max(same.velocity, n.velocity);
    else if (hits.length < MAX_HITS) hits.push({ at: keep(n.start), velocity: keep(n.velocity) });
  }
  return { name: `${name} Groove`.slice(0, 60), base: 0.25, quantize: 0, timing: 1, random: 0, velocity: 0, length, hits };
}

/** Base's choices, as Live writes them. */
export const BASE_CHOICES = GROOVE_BASES.map((b) => ({ value: String(b), label: ({ 1: '1/4', 0.5: '1/8', 0.25: '1/16', 0.125: '1/32' } as Record<number, string>)[b] ?? (b > 0.3 ? '1/8T' : '1/16T') }));
