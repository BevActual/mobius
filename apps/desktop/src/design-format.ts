/**
 * A design is JSON, so other tools and the agent can read and change it:
 *
 *     { "version": 1,
 *       "styles": [{ "name": "Primary", "color": "#5856d6" }],
 *       "frames": [{ "id": "f1", "name": "Home", "x": 0, "y": 0, "w": 393, "h": 852, "fill": "#ffffff", "radius": 0,
 *         "children": [{ "id": "n1", "type": "text", "name": "Title", "x": 24, "y": 80, "w": 345, "h": 40,
 *           "text": "Lisbon offsite", "size": 28, "weight": 700, "color": "style:Primary" }] }] }
 *
 * Frames sit on the canvas; their layers (rectangles, ellipses and text) are placed inside them, first drawn first. A
 * colour is `#rrggbb` (or `#rrggbbaa`) or `style:<name>`, one of the design's colour styles. Anything missing takes a
 * plain default, so a hand-written file still opens.
 */
export type NodeType = 'rect' | 'ellipse' | 'text';
export type Align = 'left' | 'center' | 'right';
export interface DesignStyle { name: string; color: string }
export interface DesignNode { id: string; type: NodeType; name: string; x: number; y: number; w: number; h: number; fill: string; radius: number; opacity: number; text: string; size: number; weight: number; color: string; align: Align }
export interface DesignFrame { id: string; name: string; x: number; y: number; w: number; h: number; fill: string; radius: number; children: DesignNode[] }
export interface DesignDoc { version: 1; styles: DesignStyle[]; frames: DesignFrame[] }

const num = (v: unknown, fallback: number, min = -100_000, max = 100_000) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v * 100) / 100)) : fallback);
const str = (v: unknown, fallback: string, max = 2000) => (typeof v === 'string' ? v.slice(0, max) : fallback);
const COLOR = /^(#[0-9a-f]{3}|#[0-9a-f]{6}|#[0-9a-f]{8}|style:.{1,60}|transparent)$/i;
const color = (v: unknown, fallback: string) => (typeof v === 'string' && COLOR.test(v.trim()) ? v.trim() : fallback);
const obj = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

function readNode(v: unknown, i: number, taken: Set<string>): DesignNode {
  const o = obj(v);
  const type: NodeType = o.type === 'ellipse' || o.type === 'text' ? o.type : 'rect';
  let id = str(o.id, '', 40) || `n${i + 1}`;
  while (taken.has(id)) id = `${id}-${i}`;
  taken.add(id);
  return {
    id, type, name: str(o.name, type === 'text' ? 'Text' : type === 'ellipse' ? 'Ellipse' : 'Rectangle', 80),
    x: num(o.x, 0), y: num(o.y, 0), w: num(o.w, 100, 1), h: num(o.h, type === 'text' ? 24 : 100, 1),
    fill: color(o.fill, type === 'text' ? 'transparent' : '#d9d9de'), radius: num(o.radius, 0, 0, 10_000), opacity: num(o.opacity, 1, 0, 1),
    text: str(o.text, type === 'text' ? 'Text' : ''), size: num(o.size, 16, 4, 400), weight: num(o.weight, 400, 100, 900), color: color(o.color, '#1d1d1f'),
    align: o.align === 'center' || o.align === 'right' ? o.align : 'left',
  };
}

/** The design in a file, or why it cannot be read. */
export function parseDesign(text: string): { doc: DesignDoc } | { error: string } {
  let raw: unknown;
  try { raw = JSON.parse(text || '{}'); } catch (e) { return { error: e instanceof Error ? e.message : 'not JSON' }; }
  const o = obj(raw);
  const taken = new Set<string>();
  const styles = (Array.isArray(o.styles) ? o.styles : []).map((s) => obj(s)).filter((s) => typeof s.name === 'string' && s.name).slice(0, 100).map((s) => ({ name: str(s.name, '', 60), color: color(s.color, '#000000') }));
  const frames = (Array.isArray(o.frames) ? o.frames : []).slice(0, 200).map((f, i): DesignFrame => {
    const fo = obj(f);
    let id = str(fo.id, '', 40) || `f${i + 1}`;
    while (taken.has(id)) id = `${id}-${i}`;
    taken.add(id);
    return {
      id, name: str(fo.name, `Frame ${i + 1}`, 80), x: num(fo.x, i * 460), y: num(fo.y, 0), w: num(fo.w, 393, 1), h: num(fo.h, 852, 1),
      fill: color(fo.fill, '#ffffff'), radius: num(fo.radius, 0, 0, 10_000),
      children: (Array.isArray(fo.children) ? fo.children : []).slice(0, 2000).map((n, j) => readNode(n, j, taken)),
    };
  });
  return { doc: { version: 1, styles, frames } };
}

/** Written back with only what differs from the defaults on each layer, so the file stays short and readable. */
export function writeDesign(doc: DesignDoc): string {
  const node = (n: DesignNode) => {
    const out: Record<string, unknown> = { id: n.id, type: n.type, name: n.name, x: n.x, y: n.y, w: n.w, h: n.h };
    if (n.type !== 'text' || n.fill !== 'transparent') out.fill = n.fill;
    if (n.radius) out.radius = n.radius;
    if (n.opacity !== 1) out.opacity = n.opacity;
    if (n.type === 'text') Object.assign(out, { text: n.text, size: n.size, weight: n.weight, color: n.color }, n.align !== 'left' ? { align: n.align } : {});
    return out;
  };
  const frames = doc.frames.map((f) => ({ id: f.id, name: f.name, x: f.x, y: f.y, w: f.w, h: f.h, fill: f.fill, radius: f.radius, children: f.children.map(node) }));
  // One layer per line: readable, and a change shows as the lines of the layers it touched.
  const lines = ['{', '  "version": 1,', `  "styles": [${doc.styles.length ? `\n${doc.styles.map((s) => `    ${JSON.stringify(s)}`).join(',\n')}\n  ` : ''}],`, '  "frames": ['];
  frames.forEach((f, i) => {
    const { children, ...head } = f;
    const headText = JSON.stringify(head).slice(0, -1);
    lines.push(`    ${headText}, "children": [${children.length ? '' : ']}'}${i < frames.length - 1 && !children.length ? ',' : ''}`);
    if (children.length) {
      children.forEach((c, j) => lines.push(`      ${JSON.stringify(c)}${j < children.length - 1 ? ',' : ''}`));
      lines.push(`    ]}${i < frames.length - 1 ? ',' : ''}`);
    }
  });
  lines.push('  ]', '}', '');
  return lines.join('\n');
}

/** A colour as CSS: a style's colour, or the colour itself. */
export function resolveColor(c: string, styles: readonly DesignStyle[]): string {
  if (c.startsWith('style:')) return styles.find((s) => s.name === c.slice(6))?.color ?? '#ff00ff';
  return c;
}

/** Ids of frames and layers new in `after` or different from `before`. */
export function changedIds(before: DesignDoc | null, after: DesignDoc): Set<string> {
  const was = new Map<string, string>();
  for (const f of before?.frames ?? []) {
    const { children, ...head } = f;
    was.set(f.id, JSON.stringify(head));
    for (const n of children) was.set(n.id, JSON.stringify(n));
  }
  const out = new Set<string>();
  for (const f of after.frames) {
    const { children, ...head } = f;
    if (was.get(f.id) !== JSON.stringify(head)) out.add(f.id);
    for (const n of children) if (was.get(n.id) !== JSON.stringify(n)) out.add(n.id);
  }
  return out;
}

/** An id not used anywhere in the design yet. */
export function freshId(doc: DesignDoc, prefix: 'f' | 'n'): string {
  const used = new Set(doc.frames.flatMap((f) => [f.id, ...f.children.map((c) => c.id)]));
  let n = used.size + 1;
  while (used.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

/** The relative luminance contrast of two #rrggbb colours (1 to 21); AA for body text needs 4.5. */
export function contrast(a: string, b: string): number | null {
  const lum = (hex: string) => {
    const m = /^#([0-9a-f]{6})/i.exec(hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join('')}` : hex);
    if (!m) return null;
    const [r, g, bl] = [0, 2, 4].map((i) => parseInt(m[1]!.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
  };
  const x = lum(a), y = lum(b);
  if (x === null || y === null) return null;
  return Math.round(((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)) * 100) / 100;
}

/** A new frame is placed to the right of the others. */
export function nextFramePlace(doc: DesignDoc): { x: number; y: number } {
  const right = doc.frames.reduce((m, f) => Math.max(m, f.x + f.w), -80);
  return { x: right + 80, y: doc.frames[0]?.y ?? 0 };
}
