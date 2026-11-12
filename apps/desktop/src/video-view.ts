import { freshShotId, shotLength, shotStart, type Cut, type Shot } from './cut-format';

/**
 * The Video app's arithmetic, kept apart from the screen so it can be tested: changing the cut (adding, splitting,
 * trimming, moving and removing shots), and placing things on the timeline (its ruler, edit points, and where a drop lands).
 */

const round = (v: number) => Math.round(v * 100) / 100;
/** The shortest a shot can be, in seconds. */
export const MIN_SHOT = 0.1;

/** A clip as a new shot: all of it, up to six seconds. */
export function shotOf(cut: Cut, clip: string, length: number | undefined): Shot {
  return { id: freshShotId(cut), clip, in: 0, out: round(Math.min(length || 5, 6)), title: '' };
}

/** The cut with `clip` put in at `index` (the end when past it). */
export function insertClip(cut: Cut, clip: string, length: number | undefined, index = cut.shots.length): Cut {
  const shots = [...cut.shots];
  shots.splice(Math.max(0, Math.min(index, shots.length)), 0, shotOf(cut, clip, length));
  return { ...cut, shots };
}

/** The cut cut in two at `t` seconds; unchanged when `t` is at an edit point or outside the cut. The title stays on the first part. */
export function splitAt(cut: Cut, t: number): { cut: Cut; id: string } | null {
  let start = 0;
  for (let i = 0; i < cut.shots.length; i++) {
    const s = cut.shots[i]!;
    const len = shotLength(s);
    if (t > start + MIN_SHOT - 1e-9 && t < start + len - MIN_SHOT + 1e-9) {
      const at = round(s.in + (t - start));
      const id = freshShotId(cut);
      const shots = [...cut.shots];
      shots.splice(i, 1, { ...s, out: at }, { ...s, id, in: at, title: '' });
      return { cut: { ...cut, shots }, id };
    }
    start += len;
  }
  return null;
}

/** The cut with one edge of a shot moved to `clipTime` (seconds in its clip), kept within the clip and no shorter than MIN_SHOT. */
export function trimShot(cut: Cut, id: string, edge: 'in' | 'out', clipTime: number, clipLength: number | undefined): Cut {
  return {
    ...cut,
    shots: cut.shots.map((s) => {
      if (s.id !== id) return s;
      if (edge === 'in') return { ...s, in: round(Math.max(0, Math.min(clipTime, s.out - MIN_SHOT))) };
      const end = clipLength && clipLength > 0 ? clipLength : Infinity;
      return { ...s, out: round(Math.min(end, Math.max(clipTime, s.in + MIN_SHOT))) };
    }),
  };
}

/** The cut with a shot moved to `to` (its index once moved). */
export function moveShot(cut: Cut, id: string, to: number): Cut {
  const from = cut.shots.findIndex((s) => s.id === id);
  if (from < 0) return cut;
  const shots = [...cut.shots];
  const [shot] = shots.splice(from, 1);
  shots.splice(Math.max(0, Math.min(to, shots.length)), 0, shot!);
  return shots.every((s, i) => s === cut.shots[i]) ? cut : { ...cut, shots };
}

export const removeShot = (cut: Cut, id: string): Cut => ({ ...cut, shots: cut.shots.filter((s) => s.id !== id) });

/** Where each shot starts, and where the last ends: the cut's edit points. */
export function editPoints(cut: Cut): number[] {
  return [...cut.shots.map((_, i) => round(shotStart(cut, i))), round(shotStart(cut, cut.shots.length))];
}

/** The edit point after (or before) `t`; null at either end. */
export function nextEdit(cut: Cut, t: number, dir: 1 | -1): number | null {
  const points = editPoints(cut);
  if (dir > 0) return points.find((p) => p > t + 0.01) ?? null;
  return [...points].reverse().find((p) => p < t - 0.01) ?? null;
}

/** Where a drop at `x` pixels along the track lands: before the shot whose middle is past it. */
export function dropIndex(cut: Cut, x: number, pxPerSec: number): number {
  for (let i = 0; i < cut.shots.length; i++) {
    const mid = (shotStart(cut, i) + shotLength(cut.shots[i]!) / 2) * pxPerSec;
    if (x < mid) return i;
  }
  return cut.shots.length;
}

/** The ruler's marks: a step in seconds that leaves at least `minGap` pixels between labels, and the marks to `total`. */
export function rulerMarks(total: number, pxPerSec: number, minGap = 64): { step: number; marks: number[] } {
  const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
  const step = steps.find((s) => s * pxPerSec >= minGap) ?? steps[steps.length - 1]!;
  const marks: number[] = [];
  for (let t = 0; t <= total + 1e-9; t += step) marks.push(round(t));
  return { step, marks };
}

/** 0:05, 1:30: a ruler label, without tenths. */
export function rulerLabel(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return Number.isInteger(s) ? `${m}:${String(s).padStart(2, '0')}` : `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

/** The times in a clip to show as a shot's filmstrip: one frame for every `frameWidth` pixels, in the middle of each. */
export function filmstrip(shot: Shot, widthPx: number, frameWidth: number): number[] {
  const n = Math.max(1, Math.ceil(widthPx / frameWidth));
  const len = shotLength(shot);
  // Rounded to a quarter second, so neighbouring shots of the same clip share frames.
  return Array.from({ length: n }, (_, i) => Math.round((shot.in + ((i + 0.5) / n) * len) * 4) / 4);
}
