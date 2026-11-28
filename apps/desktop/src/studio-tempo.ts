import type { AutoPoint, Song } from './song-format';

/**
 * Tempo changes along the song, as the engine plays them (crates/mobius-audio/src/clock.rs): Live 12's tempo automation,
 * kept on the Main track as `main.auto.tempo`. Between two points the tempo ramps straight from one to the other in
 * beats; before the first and after the last it holds. The Session view keeps the song's own tempo.
 */

export const TEMPO_MIN = 30;
export const TEMPO_MAX = 300;

interface Ramp { beat: number; seconds: number; bpm: number; slope: number }

const secondsIn = (r: Ramp, d: number) => (Math.abs(r.slope) < 1e-9 ? (d * 60) / r.bpm : (60 / r.slope) * Math.log((r.bpm + r.slope * d) / r.bpm));
const beatsIn = (r: Ramp, t: number) => (Math.abs(r.slope) < 1e-9 ? (t * r.bpm) / 60 : (r.bpm / r.slope) * (Math.exp((r.slope * t) / 60) - 1));

/** The song's tempo line: its points in beat order, kept to the tempos the window allows (none when it has none). */
export function tempoLine(song: Pick<Song, 'main'>): AutoPoint[] {
  if (song.main?.autoOff?.includes('tempo')) return [];
  return [...(song.main?.auto?.tempo ?? [])].filter((p) => Number.isFinite(p.beat) && p.beat >= 0 && Number.isFinite(p.value))
    .map((p) => ({ ...p, value: Math.min(TEMPO_MAX, Math.max(TEMPO_MIN, p.value)) })).sort((a, b) => a.beat - b.beat);
}

function rampsOf(song: Pick<Song, 'tempo' | 'main'>): Ramp[] {
  const pts = tempoLine(song);
  if (pts.length === 0) return [{ beat: 0, seconds: 0, bpm: song.tempo, slope: 0 }];
  const ramps: Ramp[] = [{ beat: 0, seconds: 0, bpm: pts[0]!.value, slope: 0 }];
  pts.forEach((p, i) => {
    const next = pts[i + 1];
    const slope = next && next.beat - p.beat > 1e-9 ? (next.value - p.value) / (next.beat - p.beat) : 0;
    const last = ramps[ramps.length - 1]!;
    const seconds = last.seconds + secondsIn(last, p.beat - last.beat);
    if (p.beat - last.beat < 1e-12) ramps.pop();
    ramps.push({ beat: p.beat, seconds, bpm: p.value, slope });
  });
  return ramps;
}

const lastAtOrBefore = <T,>(list: readonly T[], ok: (x: T) => boolean): T => {
  let found = list[0] as T;
  for (const x of list) if (ok(x)) found = x; else break;
  return found;
};

/** Whether the song's tempo changes along it. */
export const tempoChanges = (song: Pick<Song, 'main'>): boolean => tempoLine(song).length > 0;

/** The tempo at `beat`. */
export function tempoAt(song: Pick<Song, 'tempo' | 'main'>, beat: number): number {
  const r = lastAtOrBefore(rampsOf(song), (x) => x.beat <= beat);
  return r.bpm + r.slope * Math.max(0, beat - r.beat);
}

/** Seconds from the song's start to `beat`. */
export function secondsAt(song: Pick<Song, 'tempo' | 'main'>, beat: number): number {
  const b = Math.max(0, beat);
  const r = lastAtOrBefore(rampsOf(song), (x) => x.beat <= b);
  return r.seconds + secondsIn(r, b - r.beat);
}

/** The beat `seconds` into the song. */
export function beatAt(song: Pick<Song, 'tempo' | 'main'>, seconds: number): number {
  const t = Math.max(0, seconds);
  const r = lastAtOrBefore(rampsOf(song), (x) => x.seconds <= t);
  return r.beat + beatsIn(r, t - r.seconds);
}

/** The song with its tempo line set to `points` (none takes it away), on the Main track. */
export function setTempoLine(song: Song, points: AutoPoint[], mainVolume: number): void {
  const main = song.main ?? { volume: mainVolume };
  const auto = { ...(main.auto ?? {}) };
  if (points.length > 0) auto.tempo = points; else delete auto.tempo;
  if (Object.keys(auto).length > 0) main.auto = auto; else delete main.auto;
  if (main.autoOff) { const off = main.autoOff.filter((n) => n !== 'tempo'); if (off.length > 0) main.autoOff = off; else delete main.autoOff; }
  song.main = main;
}
