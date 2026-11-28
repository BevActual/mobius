import { barBeats, MAX_LOCATORS, type Locator, type Song } from './song-format';

/**
 * Locators, as Live has them (Live 12 manual, Arrangement View, "Locators"): named places in the song, shown in the
 * ruler, to jump to while playing or not, to step through, and to loop from one to the next. Each change is one Undo.
 */

const EPS = 1e-6;
const quarter = (beat: number) => Math.round(beat * 4) / 4;

/** A locator's name, or its number in the song when it has none. */
export const locatorName = (locs: readonly Locator[], i: number): string => locs[i]?.name || String(i + 1);

/**
 * The song with a locator at `beat` (to the sixteenth, inside the song). One already there stays as it is. Returns its
 * index, or null when the song is at its limit.
 */
export function addLocator(song: Song, beat: number): number | null {
  const at = quarter(Math.max(0, Math.min(beat, song.bars * barBeats(song) - 0.25)));
  const locs = [...(song.locators ?? [])];
  const there = locs.findIndex((l) => Math.abs(l.beat - at) < EPS);
  if (there >= 0) return there;
  if (locs.length >= MAX_LOCATORS) return null;
  locs.push({ beat: at, name: '' });
  locs.sort((a, b) => a.beat - b.beat);
  song.locators = locs;
  return locs.findIndex((l) => Math.abs(l.beat - at) < EPS);
}

/** The song with the locator at `beat` renamed (an empty name numbers it). */
export function renameLocator(song: Song, beat: number, name: string): boolean {
  const l = song.locators?.find((x) => Math.abs(x.beat - beat) < EPS);
  if (!l) return false;
  l.name = name.trim().slice(0, 40);
  return true;
}

/** The song without the locator at `beat`. */
export function removeLocator(song: Song, beat: number): boolean {
  const locs = (song.locators ?? []).filter((x) => Math.abs(x.beat - beat) >= EPS);
  if (locs.length === (song.locators?.length ?? 0)) return false;
  if (locs.length > 0) song.locators = locs; else delete song.locators;
  return true;
}

/** The song with the locator at `beat` moved to `to` (to the sixteenth, inside the song), unless another is there. */
export function moveLocator(song: Song, beat: number, to: number): boolean {
  const at = quarter(Math.max(0, Math.min(to, song.bars * barBeats(song) - 0.25)));
  const l = song.locators?.find((x) => Math.abs(x.beat - beat) < EPS);
  if (!l || song.locators!.some((x) => x !== l && Math.abs(x.beat - at) < EPS)) return false;
  l.beat = at;
  song.locators!.sort((a, b) => a.beat - b.beat);
  return true;
}

/**
 * The locator to jump back to from `beat`: the one before it. While playing just past one (less than a beat on),
 * Live's Previous goes to the one before that, so a second press keeps stepping back.
 */
export function previousLocator(locs: readonly Locator[] | undefined, beat: number, playing = false): Locator | null {
  const before = (locs ?? []).filter((l) => l.beat < beat - (playing ? 1 : EPS));
  return before[before.length - 1] ?? null;
}

/** The locator after `beat`. */
export function nextLocator(locs: readonly Locator[] | undefined, beat: number): Locator | null {
  return (locs ?? []).find((l) => l.beat > beat + EPS) ?? null;
}

/**
 * The bars a loop from the locator at `beat` to the next covers (to the song's end after the last), as the ruler's
 * loop is in whole bars: `a` the first bar, `b` the last.
 */
export function loopToNext(song: Song, beat: number): { a: number; b: number } {
  const end = nextLocator(song.locators, beat)?.beat ?? song.bars * barBeats(song);
  const a = Math.floor(beat / barBeats(song) + EPS);
  const b = Math.max(a, Math.ceil(end / barBeats(song) - EPS) - 1);
  return { a, b: Math.min(b, song.bars - 1) };
}
