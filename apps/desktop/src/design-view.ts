/**
 * The Design canvas's geometry, kept apart from the screen so it can be tested: dragging a handle, snapping to the
 * edges and middles of what is nearby (with the guide lines to draw), lining layers up, and picking with a box.
 */
export interface Box { x: number; y: number; w: number; h: number }
export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
export const HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** A box from two corners, either way round. */
export function boxFrom(x0: number, y0: number, x1: number, y1: number): Box {
  return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
}

/** A box after dragging one of its handles by (dx, dy); Shift keeps its shape from a corner. Never smaller than `min`. */
export function resizeBox(b: Box, handle: Handle, dx: number, dy: number, keepRatio = false, min = 1): Box {
  let { x, y, w, h } = b;
  if (handle.includes('e')) w = b.w + dx;
  if (handle.includes('w')) { w = b.w - dx; x = b.x + dx; }
  if (handle.includes('s')) h = b.h + dy;
  if (handle.includes('n')) { h = b.h - dy; y = b.y + dy; }
  if (keepRatio && handle.length === 2 && b.w > 0 && b.h > 0) {
    const ratio = b.w / b.h;
    if (Math.abs(w / b.w) > Math.abs(h / b.h)) h = w / ratio; else w = h * ratio;
    if (handle.includes('w')) x = b.x + b.w - w;
    if (handle.includes('n')) y = b.y + b.h - h;
  }
  if (w < min) { if (handle.includes('w')) x = b.x + b.w - min; w = min; }
  if (h < min) { if (handle.includes('n')) y = b.y + b.h - min; h = min; }
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

/** A line to draw while snapping: vertical at `at` (x) or horizontal at `at` (y), from `from` to `to`. */
export interface Guide { axis: 'x' | 'y'; at: number; from: number; to: number }

const xs = (b: Box) => [b.x, b.x + b.w / 2, b.x + b.w];
const ys = (b: Box) => [b.y, b.y + b.h / 2, b.y + b.h];

/**
 * How far to nudge a moving box so one of its edges or its middle lines up with an edge or middle of another box,
 * within `reach` on each axis, and the guides that show what it lined up with.
 */
export function snapBox(moving: Box, others: readonly Box[], reach: number): { dx: number; dy: number; guides: Guide[] } {
  let best = { x: { d: reach + 1, at: 0 }, y: { d: reach + 1, at: 0 } };
  for (const o of others) {
    for (const a of xs(moving)) for (const t of xs(o)) { const d = t - a; if (Math.abs(d) < Math.abs(best.x.d)) best = { ...best, x: { d, at: t } }; }
    for (const a of ys(moving)) for (const t of ys(o)) { const d = t - a; if (Math.abs(d) < Math.abs(best.y.d)) best = { ...best, y: { d, at: t } }; }
  }
  const dx = Math.abs(best.x.d) <= reach ? best.x.d : 0;
  const dy = Math.abs(best.y.d) <= reach ? best.y.d : 0;
  const placed = { ...moving, x: moving.x + dx, y: moving.y + dy };
  const guides: Guide[] = [];
  if (Math.abs(best.x.d) <= reach) {
    const touching = others.filter((o) => xs(o).some((v) => Math.abs(v - best.x.at) < 0.5));
    guides.push({ axis: 'x', at: best.x.at, from: Math.min(placed.y, ...touching.map((o) => o.y)), to: Math.max(placed.y + placed.h, ...touching.map((o) => o.y + o.h)) });
  }
  if (Math.abs(best.y.d) <= reach) {
    const touching = others.filter((o) => ys(o).some((v) => Math.abs(v - best.y.at) < 0.5));
    guides.push({ axis: 'y', at: best.y.at, from: Math.min(placed.x, ...touching.map((o) => o.x)), to: Math.max(placed.x + placed.w, ...touching.map((o) => o.x + o.w)) });
  }
  return { dx, dy, guides };
}

export type AlignHow = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

/** Where each box goes when lined up: along the edge or middle of `within` (the frame, for one layer) or of all of them. */
export function alignBoxes(boxes: readonly Box[], how: AlignHow, within?: Box): { x: number; y: number }[] {
  if (boxes.length === 0) return [];
  const area = within ?? {
    x: Math.min(...boxes.map((b) => b.x)), y: Math.min(...boxes.map((b) => b.y)),
    w: Math.max(...boxes.map((b) => b.x + b.w)) - Math.min(...boxes.map((b) => b.x)),
    h: Math.max(...boxes.map((b) => b.y + b.h)) - Math.min(...boxes.map((b) => b.y)),
  };
  return boxes.map((b) => {
    switch (how) {
      case 'left': return { x: area.x, y: b.y };
      case 'center': return { x: Math.round(area.x + (area.w - b.w) / 2), y: b.y };
      case 'right': return { x: area.x + area.w - b.w, y: b.y };
      case 'top': return { x: b.x, y: area.y };
      case 'middle': return { x: b.x, y: Math.round(area.y + (area.h - b.h) / 2) };
      case 'bottom': return { x: b.x, y: area.y + area.h - b.h };
    }
  });
}

/** Equal gaps between three or more boxes, across (`x`) or down (`y`); the first and last stay put. */
export function distributeBoxes(boxes: readonly Box[], axis: 'x' | 'y'): { x: number; y: number }[] {
  if (boxes.length < 3) return boxes.map((b) => ({ x: b.x, y: b.y }));
  const pos = (b: Box) => (axis === 'x' ? b.x : b.y);
  const size = (b: Box) => (axis === 'x' ? b.w : b.h);
  const order = boxes.map((b, i) => ({ b, i })).sort((a, c) => pos(a.b) - pos(c.b));
  const first = order[0]!.b, last = order[order.length - 1]!.b;
  const span = pos(last) + size(last) - pos(first);
  const gap = (span - order.reduce((s, o) => s + size(o.b), 0)) / (order.length - 1);
  const out = boxes.map((b) => ({ x: b.x, y: b.y }));
  let at = pos(first);
  for (const o of order) {
    out[o.i] = axis === 'x' ? { x: Math.round(at), y: o.b.y } : { x: o.b.x, y: Math.round(at) };
    at += size(o.b) + gap;
  }
  return out;
}

/** Which boxes a picking box touches. */
export function boxesTouching<T extends Box>(items: readonly T[], pick: Box): T[] {
  return items.filter((b) => b.x < pick.x + pick.w && b.x + b.w > pick.x && b.y < pick.y + pick.h && b.y + b.h > pick.y);
}

/** The box around them all. */
export function around(boxes: readonly Box[]): Box | null {
  if (boxes.length === 0) return null;
  const x = Math.min(...boxes.map((b) => b.x)), y = Math.min(...boxes.map((b) => b.y));
  return { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y };
}
