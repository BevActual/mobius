/**
 * A Video project's cut is JSON beside its clips, `cut.json`:
 *
 *     { "version": 1, "shots": [
 *         { "id": "s1", "clip": "terrace.mp4", "in": 2.5, "out": 8, "title": "Day one" },
 *         { "id": "s2", "clip": "sunset.mov", "in": 0, "out": 6.2 } ] }
 *
 * Shots play in order, each the part of its clip from `in` to `out` seconds, with an optional title over it. The
 * clips are never changed.
 */
export interface Shot { id: string; clip: string; in: number; out: number; title: string }
export interface Cut { version: 1; shots: Shot[] }

const obj = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const secs = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : fallback);

export function parseCut(text: string | null): Cut {
  let raw: unknown = {};
  try { raw = text ? JSON.parse(text) : {}; } catch { raw = {}; }
  const taken = new Set<string>();
  const shots = (Array.isArray(obj(raw).shots) ? (obj(raw).shots as unknown[]) : []).slice(0, 500).flatMap((v, i): Shot[] => {
    const o = obj(v);
    if (typeof o.clip !== 'string' || !o.clip) return [];
    let id = typeof o.id === 'string' && o.id ? o.id.slice(0, 40) : `s${i + 1}`;
    while (taken.has(id)) id = `${id}-${i}`;
    taken.add(id);
    const start = secs(o.in, 0);
    const end = Math.max(start + 0.1, secs(o.out, start + 3));
    return [{ id, clip: o.clip.slice(0, 200), in: start, out: Math.round(end * 100) / 100, title: typeof o.title === 'string' ? o.title.slice(0, 200) : '' }];
  });
  return { version: 1, shots };
}

/** One shot to a line. */
export function writeCut(cut: Cut): string {
  const line = (s: Shot) => JSON.stringify({ id: s.id, clip: s.clip, in: s.in, out: s.out, ...(s.title ? { title: s.title } : {}) });
  const body = cut.shots.map((s) => `    ${line(s)}`).join(',\n');
  return `{\n  "version": 1,\n  "shots": [${body ? `\n${body}\n  ` : ''}]\n}\n`;
}

export const shotLength = (s: Shot) => Math.max(0, s.out - s.in);
export const cutLength = (cut: Cut) => cut.shots.reduce((sum, s) => sum + shotLength(s), 0);

/** Where a moment of the cut falls: which shot, and the time in its clip. */
export function locate(cut: Cut, t: number): { index: number; clipTime: number } | null {
  let at = 0;
  for (let i = 0; i < cut.shots.length; i++) {
    const s = cut.shots[i]!;
    const len = shotLength(s);
    if (t < at + len || i === cut.shots.length - 1) return { index: i, clipTime: Math.min(s.out, s.in + Math.max(0, t - at)) };
    at += len;
  }
  return null;
}

/** Where a shot starts in the cut, in seconds. */
export const shotStart = (cut: Cut, index: number) => cut.shots.slice(0, index).reduce((sum, s) => sum + shotLength(s), 0);

/** 1:05.3 */
export function timecode(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

/** Ids of shots new or different after a turn. */
export function changedShots(before: Cut | null, after: Cut): Set<string> {
  const was = new Map((before?.shots ?? []).map((s) => [s.id, JSON.stringify(s)]));
  return new Set(after.shots.filter((s) => was.get(s.id) !== JSON.stringify(s)).map((s) => s.id));
}

export function freshShotId(cut: Cut): string {
  const used = new Set(cut.shots.map((s) => s.id));
  let n = cut.shots.length + 1;
  while (used.has(`s${n}`)) n++;
  return `s${n}`;
}

/** The address the window's player reads a clip from: the shell's `media` scheme. */
export function mediaUrl(project: string, clip: string, platform: string): string {
  const path = `${encodeURIComponent(project)}/${encodeURIComponent(clip)}`;
  return platform === 'win32' ? `http://media.localhost/${path}` : `media://localhost/${path}`;
}
