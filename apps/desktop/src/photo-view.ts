import { wholeArea, type Adjustment, type Amount, type Crop } from './photo-edit';

/**
 * The Photo app's arithmetic, kept apart from the screen so it can be tested: undo, stepping through an album,
 * and the crop box (its handles and its aspect ratios).
 */

/** Undo for one photo's edits. Changes with the same tag close together (a slider dragged, a name typed) undo as one. */
export interface History<T> { past: T[]; future: T[]; tag: string; at: number }
export const emptyHistory = <T>(): History<T> => ({ past: [], future: [], tag: '', at: 0 });
const COALESCE_MS = 1200;
const LIMIT = 200;

/** The history once `before` has been changed into something new. */
export function recorded<T>(h: History<T>, before: T, tag: string, now: number): History<T> {
  const joins = tag !== '' && tag === h.tag && now - h.at < COALESCE_MS && h.past.length > 0;
  return { past: joins ? h.past : [...h.past, before].slice(-LIMIT), future: [], tag, at: now };
}
/** Undo: what to show, and the history after; null when there is nothing to undo. */
export function undone<T>(h: History<T>, current: T): { value: T; history: History<T> } | null {
  const value = h.past[h.past.length - 1];
  if (value === undefined) return null;
  return { value, history: { past: h.past.slice(0, -1), future: [current, ...h.future], tag: '', at: 0 } };
}
export function redone<T>(h: History<T>, current: T): { value: T; history: History<T> } | null {
  const [value, ...rest] = h.future;
  if (value === undefined) return null;
  return { value, history: { past: [...h.past, current], future: rest, tag: '', at: 0 } };
}

/** The photo `step` along from `path` in the list, staying put at either end; the first when `path` is not there. */
export function stepTo(list: readonly string[], path: string | null, step: number): string | null {
  if (list.length === 0) return null;
  const at = path === null ? -1 : list.indexOf(path);
  if (at < 0) return list[0]!;
  return list[Math.max(0, Math.min(list.length - 1, at + step))]!;
}

export type AspectId = 'free' | 'original' | 'square' | '16:9' | '4:3' | '3:2' | '5:4';
export const ASPECTS: readonly { id: AspectId; name: string }[] = [
  { id: 'free', name: 'Freeform' },
  { id: 'original', name: 'Original' },
  { id: 'square', name: 'Square' },
  { id: '16:9', name: '16:9' },
  { id: '4:3', name: '4:3' },
  { id: '3:2', name: '3:2' },
  { id: '5:4', name: '5:4' },
];
/** The ratio (width over height, in pixels) an aspect asks for, turned to match the picture; null for freeform. */
export function aspectRatio(id: AspectId, original: number): number | null {
  const base = id === 'free' ? null : id === 'original' ? original : id === 'square' ? 1 : (() => { const [a, b] = id.split(':').map(Number); return a! / b!; })();
  if (base === null) return null;
  // A landscape ratio on a portrait picture is used upright, as Photos does.
  return original < 1 && base > 1 ? 1 / base : base;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const MIN = 0.05;

/** The largest crop with `ratio` (pixels) on a frame of `frameAspect`, centred where `around` is centred. */
export function fitAspect(around: Crop, ratio: number, frameAspect: number): Crop {
  const k = ratio / frameAspect; // width over height in 0 to 1 units
  let w = 1, h = 1 / k;
  if (h > 1) { h = 1; w = k; }
  const cx = around.x + around.w / 2, cy = around.y + around.h / 2;
  return { x: clamp(cx - w / 2, 0, 1 - w), y: clamp(cy - h / 2, 0, 1 - h), w, h };
}

export type Handle = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
export const HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/**
 * The crop after dragging `handle` by (dx, dy) in 0 to 1 units of the frame, from the crop when the drag began.
 * `k` keeps width over height (in 0 to 1 units) when set; the crop stays inside the frame and no smaller than 5%.
 */
export function dragCrop(start: Crop, handle: Handle, dx: number, dy: number, k: number | null): Crop {
  if (handle === 'move') return { ...start, x: clamp(start.x + dx, 0, 1 - start.w), y: clamp(start.y + dy, 0, 1 - start.h) };
  let x0 = start.x, y0 = start.y, x1 = start.x + start.w, y1 = start.y + start.h;
  if (handle.includes('w')) x0 = clamp(x0 + dx, 0, x1 - MIN);
  if (handle.includes('e')) x1 = clamp(x1 + dx, x0 + MIN, 1);
  if (handle.includes('n')) y0 = clamp(y0 + dy, 0, y1 - MIN);
  if (handle.includes('s')) y1 = clamp(y1 + dy, y0 + MIN, 1);
  if (k === null) return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  // Locked: the side dragged leads, and the other follows, from the opposite edge or corner.
  const horizontal = handle === 'e' || handle === 'w' || (handle.length === 2 && Math.abs(dx) >= Math.abs(dy) * k);
  let w = x1 - x0, h = y1 - y0;
  if (horizontal) h = w / k; else w = h * k;
  // Too big for the frame from the fixed side: shrink both.
  const ax = handle.includes('w') ? x1 : handle.includes('e') ? x0 : (start.x + start.w / 2);
  const ay = handle.includes('n') ? y1 : handle.includes('s') ? y0 : (start.y + start.h / 2);
  const roomW = handle.includes('w') ? ax : handle.includes('e') ? 1 - ax : 2 * Math.min(ax, 1 - ax);
  const roomH = handle.includes('n') ? ay : handle.includes('s') ? 1 - ay : 2 * Math.min(ay, 1 - ay);
  const fit = Math.min(1, roomW / w, roomH / h);
  w *= fit; h *= fit;
  const x = handle.includes('w') ? ax - w : handle.includes('e') ? ax : ax - w / 2;
  const y = handle.includes('n') ? ay - h : handle.includes('s') ? ay : ay - h / 2;
  return { x, y, w, h };
}

/** The crop with the picture turned a quarter to the left: the box turns with it. */
export const turnedCrop = (c: Crop): Crop => ({ x: c.y, y: 1 - c.x - c.w, w: c.h, h: c.w });
/** The crop with the picture flipped left to right. */
export const flippedCrop = (c: Crop): Crop => ({ ...c, x: 1 - c.x - c.w });

/** The album grid's tile sizes, smallest first, as the zoom slider steps through them. */
export const GRID_SIZES = [90, 120, 160, 220, 300] as const;
/** The zoom step after moving `by`, kept within the sizes there are; anything unreadable is the middle size. */
export function zoomStep(at: number, by: number): number {
  const n = Number.isFinite(at) ? Math.round(at) : 2;
  return Math.max(0, Math.min(GRID_SIZES.length - 1, n + by));
}

/** One section of the Adjust panel: its sliders, or 'where' for the part of the photo it applies to. */
export type Section = readonly Amount[] | 'where';
/** Whether a section has been moved from where it starts, so it shows its reset. */
export function groupChanged(a: Adjustment, section: Section): boolean {
  if (section === 'where') return a.area.kind !== 'all';
  return section.some((k) => a[k] !== 0);
}
/** The adjustment with one section put back to where it starts. */
export function resetGroup(a: Adjustment, section: Section): Adjustment {
  if (section === 'where') return { ...a, area: wholeArea() };
  const out = { ...a };
  for (const k of section) out[k] = 0;
  return out;
}
