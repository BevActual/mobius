/**
 * A Canvas board is JSON, so other tools and the agent can read and change it:
 *
 *     { "version": 1,
 *       "items": [
 *         { "id": "s1", "type": "sticky", "x": 0, "y": 0, "w": 180, "h": 180, "color": "yellow", "text": "Walkable" },
 *         { "id": "b1", "type": "shape", "shape": "diamond", "x": 300, "y": 0, "w": 200, "h": 120, "color": "blue", "text": "Under $6k?" },
 *         { "id": "t1", "type": "text", "x": 0, "y": -80, "w": 400, "h": 40, "text": "Offsite", "size": 28 },
 *         { "id": "a1", "type": "arrow", "from": "s1", "to": "b1", "text": "then" },
 *         { "id": "i1", "type": "ink", "color": "ink", "points": [[0, 0], [10, 4], [22, 9]] }
 *       ] }
 *
 * Stickies, shapes and text sit where their x and y say, first drawn first; an arrow joins two of them by id and
 * follows them when they move; ink is a pen line. Colours are names from `BOARD_COLORS`. Anything missing takes a
 * plain default, so a hand-written file still opens.
 */
export const BOARD_COLORS = {
  yellow: { fill: '#fff3a3', edge: '#e0c53b' },
  orange: { fill: '#ffd8a8', edge: '#e8963c' },
  pink: { fill: '#ffc9de', edge: '#e0679a' },
  green: { fill: '#c8f0c4', edge: '#4cad5a' },
  blue: { fill: '#c6e2ff', edge: '#3d8be0' },
  purple: { fill: '#ddd6ff', edge: '#7a6ae6' },
  grey: { fill: '#e8e8ed', edge: '#8e8e93' },
  white: { fill: '#ffffff', edge: '#c7c7cc' },
  ink: { fill: '#1d1d1f', edge: '#1d1d1f' },
} as const;
export type BoardColor = keyof typeof BOARD_COLORS;
export const COLOR_NAMES = Object.keys(BOARD_COLORS) as BoardColor[];
export type ShapeKind = 'rect' | 'ellipse' | 'diamond';

interface Base { id: string }
export interface Sticky extends Base { type: 'sticky'; x: number; y: number; w: number; h: number; color: BoardColor; text: string }
export interface Shape extends Base { type: 'shape'; shape: ShapeKind; x: number; y: number; w: number; h: number; color: BoardColor; text: string }
export interface TextItem extends Base { type: 'text'; x: number; y: number; w: number; h: number; text: string; size: number }
export interface Arrow extends Base { type: 'arrow'; from: string; to: string; text: string }
export interface Ink extends Base { type: 'ink'; color: BoardColor; points: [number, number][] }
export type BoardItem = Sticky | Shape | TextItem | Arrow | Ink;
export type Boxed = Sticky | Shape | TextItem;
export interface Board { version: 1; items: BoardItem[] }

const num = (v: unknown, fallback: number, min = -1_000_000, max = 1_000_000) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback);
const str = (v: unknown, fallback: string, max = 4000) => (typeof v === 'string' ? v.slice(0, max) : fallback);
const color = (v: unknown, fallback: BoardColor): BoardColor => (typeof v === 'string' && v in BOARD_COLORS ? (v as BoardColor) : fallback);
const obj = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export const isBoxed = (item: BoardItem): item is Boxed => item.type === 'sticky' || item.type === 'shape' || item.type === 'text';

function readItem(v: unknown, i: number, taken: Set<string>): BoardItem | null {
  const o = obj(v);
  const type = o.type;
  let id = str(o.id, '', 40).trim() || `i${i + 1}`;
  while (taken.has(id)) id = `${id}-${i}`;
  const box = (w: number, h: number) => ({ x: num(o.x, 0), y: num(o.y, 0), w: num(o.w, w, 8, 20_000), h: num(o.h, h, 8, 20_000) });
  let item: BoardItem | null = null;
  if (type === 'sticky' || type === undefined) item = { id, type: 'sticky', ...box(180, 180), color: color(o.color, 'yellow'), text: str(o.text, '') };
  else if (type === 'shape') item = { id, type: 'shape', shape: o.shape === 'ellipse' || o.shape === 'diamond' ? o.shape : 'rect', ...box(200, 120), color: color(o.color, 'white'), text: str(o.text, '') };
  else if (type === 'text') item = { id, type: 'text', ...box(320, 40), text: str(o.text, 'Text'), size: num(o.size, 20, 8, 200) };
  else if (type === 'arrow' && typeof o.from === 'string' && typeof o.to === 'string') item = { id, type: 'arrow', from: o.from, to: o.to, text: str(o.text, '', 200) };
  else if (type === 'ink' && Array.isArray(o.points)) {
    const points = o.points.slice(0, 5000).filter((p): p is [number, number] => Array.isArray(p) && typeof p[0] === 'number' && typeof p[1] === 'number').map((p): [number, number] => [num(p[0], 0), num(p[1], 0)]);
    if (points.length >= 2) item = { id, type: 'ink', color: color(o.color, 'ink'), points };
  }
  if (item) taken.add(id);
  return item;
}

/** The board in a file, or why it cannot be read. Arrows to items that are not there are left out. */
export function parseBoard(text: string): { board: Board } | { error: string } {
  let raw: unknown;
  try { raw = JSON.parse(text || '{}'); } catch (e) { return { error: e instanceof Error ? e.message : 'not JSON' }; }
  const o = obj(raw);
  const taken = new Set<string>();
  const items = (Array.isArray(o.items) ? o.items : []).slice(0, 5000).map((v, i) => readItem(v, i, taken)).filter((x): x is BoardItem => x !== null);
  const boxes = new Set(items.filter(isBoxed).map((x) => x.id));
  return { board: { version: 1, items: items.filter((x) => x.type !== 'arrow' || (boxes.has(x.from) && boxes.has(x.to) && x.from !== x.to)) } };
}

/** One item per line, with only what differs from the defaults, so a change shows as the lines it touched. */
export function writeBoard(board: Board): string {
  const line = (x: BoardItem) => {
    switch (x.type) {
      case 'sticky': return { id: x.id, type: x.type, x: x.x, y: x.y, w: x.w, h: x.h, color: x.color, text: x.text };
      case 'shape': return { id: x.id, type: x.type, shape: x.shape, x: x.x, y: x.y, w: x.w, h: x.h, color: x.color, ...(x.text ? { text: x.text } : {}) };
      case 'text': return { id: x.id, type: x.type, x: x.x, y: x.y, w: x.w, h: x.h, text: x.text, ...(x.size !== 20 ? { size: x.size } : {}) };
      case 'arrow': return { id: x.id, type: x.type, from: x.from, to: x.to, ...(x.text ? { text: x.text } : {}) };
      case 'ink': return { id: x.id, type: x.type, color: x.color, points: x.points };
    }
  };
  const body = board.items.map((x, i) => `    ${JSON.stringify(line(x))}${i < board.items.length - 1 ? ',' : ''}`);
  return ['{', '  "version": 1,', `  "items": [${body.length ? '' : ']'}`, ...(body.length ? [...body, '  ]'] : []), '}', ''].join('\n');
}

export interface Rect { x: number; y: number; w: number; h: number }

/** Where an item sits: its box, or for ink the box around its line; arrows have none of their own. */
export function boundsOf(item: BoardItem): Rect | null {
  if (isBoxed(item)) return { x: item.x, y: item.y, w: item.w, h: item.h };
  if (item.type === 'ink') {
    const xs = item.points.map((p) => p[0]), ys = item.points.map((p) => p[1]);
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }
  return null;
}

/** The box around everything on the board, or null when it is empty. */
export function boardBounds(board: Board): Rect | null {
  const boxes = board.items.map(boundsOf).filter((b): b is Rect => b !== null);
  if (!boxes.length) return null;
  const x = Math.min(...boxes.map((b) => b.x)), y = Math.min(...boxes.map((b) => b.y));
  return { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y };
}

/** The point on a box's edge on the way from its centre toward `to`, where an arrow starts or ends. */
export function edgePoint(box: Rect, to: { x: number; y: number }, shape: ShapeKind = 'rect'): { x: number; y: number } {
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  const dx = to.x - cx, dy = to.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const hw = box.w / 2, hh = box.h / 2;
  let t: number;
  if (shape === 'ellipse') t = 1 / Math.sqrt((dx * dx) / (hw * hw) + (dy * dy) / (hh * hh));
  else if (shape === 'diamond') t = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh);
  else t = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity);
  return { x: Math.round(cx + dx * t), y: Math.round(cy + dy * t) };
}

/** An arrow's two ends, on the edges of the items it joins; null when either is missing. */
export function arrowEnds(board: Board, arrow: Arrow, moved?: (item: Boxed) => Rect): { x1: number; y1: number; x2: number; y2: number } | null {
  const a = board.items.find((x) => x.id === arrow.from), b = board.items.find((x) => x.id === arrow.to);
  if (!a || !b || !isBoxed(a) || !isBoxed(b)) return null;
  const ra = moved ? moved(a) : a, rb = moved ? moved(b) : b;
  const ca = { x: ra.x + ra.w / 2, y: ra.y + ra.h / 2 }, cb = { x: rb.x + rb.w / 2, y: rb.y + rb.h / 2 };
  const p = edgePoint(ra, cb, a.type === 'shape' ? a.shape : 'rect');
  const q = edgePoint(rb, ca, b.type === 'shape' ? b.shape : 'rect');
  return { x1: p.x, y1: p.y, x2: q.x, y2: q.y };
}

/** Ids of items new in `after` or different from `before`. */
export function changedItems(before: Board | null, after: Board): Set<string> {
  const was = new Map((before?.items ?? []).map((x) => [x.id, JSON.stringify(x)]));
  return new Set(after.items.filter((x) => was.get(x.id) !== JSON.stringify(x)).map((x) => x.id));
}

/** Ids of items `before` had that `after` no longer has. */
export function removedItems(before: Board | null, after: Board): string[] {
  const now = new Set(after.items.map((x) => x.id));
  return (before?.items ?? []).filter((x) => !now.has(x.id)).map((x) => x.id);
}

/** An id not used on the board yet, starting with the kind's letter. */
export function freshItemId(board: Board, type: BoardItem['type']): string {
  const prefix = { sticky: 's', shape: 'b', text: 't', arrow: 'a', ink: 'i' }[type];
  const used = new Set(board.items.map((x) => x.id));
  let n = board.items.filter((x) => x.type === type).length + 1;
  while (used.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

/** A pen line with the points closer than `min` to the last one kept left out, so a stroke stays small in the file. */
export function thinPoints(points: readonly [number, number][], min = 3): [number, number][] {
  const out: [number, number][] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) >= min) out.push([Math.round(p[0]), Math.round(p[1])]);
  }
  const end = points[points.length - 1];
  if (end && out.length && (out[out.length - 1]![0] !== Math.round(end[0]) || out[out.length - 1]![1] !== Math.round(end[1]))) out.push([Math.round(end[0]), Math.round(end[1])]);
  return out;
}

/** Moves an item by dx, dy; arrows follow their ends and do not move themselves. */
export function moveItem(item: BoardItem, dx: number, dy: number): void {
  if (isBoxed(item)) { item.x += dx; item.y += dy; }
  else if (item.type === 'ink') item.points = item.points.map(([x, y]) => [x + dx, y + dy]);
}

/**
 * Copies of `items` added to the board, moved by dx, dy, each with a new id; an arrow comes along only when both its
 * ends do, joined to their copies. Gives the new ids.
 */
export function pasteItems(board: Board, items: readonly BoardItem[], dx: number, dy: number): string[] {
  const ids = new Map<string, string>();
  const made: string[] = [];
  for (const it of items.filter((x) => x.type !== 'arrow')) {
    const copy = structuredClone(it);
    copy.id = freshItemId(board, it.type);
    moveItem(copy, dx, dy);
    board.items.push(copy);
    ids.set(it.id, copy.id);
    made.push(copy.id);
  }
  for (const it of items) {
    if (it.type !== 'arrow') continue;
    const from = ids.get(it.from), to = ids.get(it.to);
    if (!from || !to) continue;
    const id = freshItemId(board, 'arrow');
    board.items.push({ ...it, id, from, to });
    made.push(id);
  }
  return made;
}

/**
 * Lines the chosen stickies, shapes and text up in a tidy grid, as FigJam's Tidy up does: in reading order (top to
 * bottom, then left to right), starting where the top-left one was, as close to square as they go, `gap` apart.
 */
export function tidyItems(board: Board, ids: ReadonlySet<string>, gap = 24): void {
  const items = board.items.filter((x): x is Boxed => isBoxed(x) && ids.has(x.id));
  if (items.length < 2) return;
  const rowOf = (y: number) => Math.round(y / 60);
  items.sort((a, b) => rowOf(a.y) - rowOf(b.y) || a.x - b.x);
  const x0 = Math.min(...items.map((i) => i.x)), y0 = Math.min(...items.map((i) => i.y));
  const cols = Math.ceil(Math.sqrt(items.length));
  const cellW = Math.max(...items.map((i) => i.w)) + gap, cellH = Math.max(...items.map((i) => i.h)) + gap;
  items.forEach((item, n) => { item.x = x0 + (n % cols) * cellW; item.y = y0 + Math.floor(n / cols) * cellH; });
}

/** Removes items and the arrows that joined them. */
export function removeItems(board: Board, ids: ReadonlySet<string>): void {
  board.items = board.items.filter((x) => !ids.has(x.id) && !(x.type === 'arrow' && (ids.has(x.from) || ids.has(x.to))));
}

/** Where a new sticky goes: right of the one selected, or at the centre of the view, kept off any sticky already there. */
export function placeNew(board: Board, at: { x: number; y: number }, size: { w: number; h: number }): { x: number; y: number } {
  let x = Math.round(at.x - size.w / 2), y = Math.round(at.y - size.h / 2);
  for (let tries = 0; tries < 50; tries++) {
    const clash = board.items.some((it) => isBoxed(it) && Math.abs(it.x - x) < 12 && Math.abs(it.y - y) < 12);
    if (!clash) break;
    x += 24; y += 24;
  }
  return { x, y };
}

/** The items whose boxes meet a rectangle, for selecting by dragging over them. */
export function itemsIn(board: Board, r: Rect): string[] {
  const meets = (b: Rect) => b.x < r.x + r.w && b.x + b.w > r.x && b.y < r.y + r.h && b.y + b.h > r.y;
  return board.items.filter((x) => { const b = boundsOf(x); return b !== null && meets(b); }).map((x) => x.id);
}

/** The board as plain text for the agent and for search: what each item says, stickies grouped by colour. */
export function boardOutline(board: Board): string {
  const named = new Map(board.items.filter(isBoxed).map((x) => [x.id, x.text.split('\n')[0] || x.id]));
  const lines: string[] = [];
  for (const x of board.items) {
    if (x.type === 'text') lines.push(`# ${x.text}`);
    else if (x.type === 'sticky') lines.push(`- [${x.color} sticky] ${x.text.replace(/\n/g, ' ')}`);
    else if (x.type === 'shape') lines.push(`- [${x.shape}] ${x.text.replace(/\n/g, ' ')}`);
    else if (x.type === 'arrow') lines.push(`- ${named.get(x.from)} → ${named.get(x.to)}${x.text ? ` (${x.text})` : ''}`);
  }
  return lines.join('\n');
}
