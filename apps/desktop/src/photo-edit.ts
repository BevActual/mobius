/**
 * A photo's edits are kept beside it, as `<photo>.edits.json`, never in the photo itself:
 *
 *     { "version": 1, "adjustments": [
 *         { "id": "a1", "name": "Warm the hills", "exposure": 0, "contrast": 0, "saturation": 10, "warmth": 25,
 *           "area": { "kind": "below", "at": 0.55, "soft": 0.1 } } ] }
 *
 * Adjustments apply in order, each to its area of the picture: all of it, the part below or above a line across it
 * (`at` from 0 at the top to 1 at the bottom, `soft` how gradually it fades in), or inside an ellipse. Each amount
 * runs from -100 to 100, 0 changing nothing; `hidden` turns one off without losing it. The photo is never changed:
 * Export writes a new file.
 */
export type AreaKind = 'all' | 'below' | 'above' | 'ellipse';
export interface Area { kind: AreaKind; at: number; soft: number; cx: number; cy: number; rx: number; ry: number }
export interface Adjustment { id: string; name: string; exposure: number; contrast: number; saturation: number; warmth: number; tint: number; hidden: boolean; area: Area }
export interface PhotoEdits { version: 1; adjustments: Adjustment[] }

export const AMOUNTS = ['exposure', 'contrast', 'saturation', 'warmth', 'tint'] as const;
export type Amount = (typeof AMOUNTS)[number];
export const AMOUNT_NAMES: Record<Amount, string> = { exposure: 'Exposure', contrast: 'Contrast', saturation: 'Saturation', warmth: 'Warmth', tint: 'Tint' };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const num = (v: unknown, fallback: number, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? clamp(Math.round(v * 1000) / 1000, lo, hi) : fallback);
const obj = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export const wholeArea = (): Area => ({ kind: 'all', at: 0.5, soft: 0.1, cx: 0.5, cy: 0.5, rx: 0.3, ry: 0.3 });
export function blankAdjustment(id: string, name = 'Adjustment'): Adjustment {
  return { id, name, exposure: 0, contrast: 0, saturation: 0, warmth: 0, tint: 0, hidden: false, area: wholeArea() };
}

export function parseEdits(text: string | null): PhotoEdits {
  let raw: unknown = {};
  try { raw = text ? JSON.parse(text) : {}; } catch { raw = {}; }
  const list = Array.isArray(obj(raw).adjustments) ? (obj(raw).adjustments as unknown[]) : [];
  const taken = new Set<string>();
  const adjustments = list.slice(0, 50).map((v, i): Adjustment => {
    const o = obj(v);
    let id = typeof o.id === 'string' && o.id ? o.id.slice(0, 40) : `a${i + 1}`;
    while (taken.has(id)) id = `${id}-${i}`;
    taken.add(id);
    const a = obj(o.area);
    const kind: AreaKind = a.kind === 'below' || a.kind === 'above' || a.kind === 'ellipse' ? a.kind : 'all';
    return {
      id, name: typeof o.name === 'string' && o.name ? o.name.slice(0, 80) : 'Adjustment',
      exposure: num(o.exposure, 0, -100, 100), contrast: num(o.contrast, 0, -100, 100), saturation: num(o.saturation, 0, -100, 100), warmth: num(o.warmth, 0, -100, 100), tint: num(o.tint, 0, -100, 100),
      hidden: o.hidden === true,
      area: { kind, at: num(a.at, 0.5, 0, 1), soft: num(a.soft, 0.1, 0, 1), cx: num(a.cx, 0.5, 0, 1), cy: num(a.cy, 0.5, 0, 1), rx: num(a.rx, 0.3, 0.01, 2), ry: num(a.ry, 0.3, 0.01, 2) },
    };
  });
  return { version: 1, adjustments };
}

/** Written with each adjustment on one line, its area only when it is not all of the photo. */
export function writeEdits(edits: PhotoEdits): string {
  const line = (a: Adjustment) => {
    const out: Record<string, unknown> = { id: a.id, name: a.name };
    for (const k of AMOUNTS) if (a[k] !== 0) out[k] = a[k];
    if (a.hidden) out.hidden = true;
    if (a.area.kind === 'below' || a.area.kind === 'above') out.area = { kind: a.area.kind, at: a.area.at, soft: a.area.soft };
    else if (a.area.kind === 'ellipse') out.area = { kind: 'ellipse', cx: a.area.cx, cy: a.area.cy, rx: a.area.rx, ry: a.area.ry, soft: a.area.soft };
    return JSON.stringify(out);
  };
  const body = edits.adjustments.map((a) => `    ${line(a)}`).join(',\n');
  return `{\n  "version": 1,\n  "adjustments": [${body ? `\n${body}\n  ` : ''}]\n}\n`;
}

const smooth = (e0: number, e1: number, x: number) => { if (e1 <= e0) return x >= e1 ? 1 : 0; const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

/** How much of an adjustment reaches a point (u, v from 0 to 1 across and down the photo): 0 to 1. */
export function weightAt(area: Area, u: number, v: number): number {
  const half = area.soft / 2;
  switch (area.kind) {
    case 'all': return 1;
    case 'below': return smooth(area.at - half, area.at + half, v);
    case 'above': return 1 - smooth(area.at - half, area.at + half, v);
    case 'ellipse': {
      const d = Math.sqrt(((u - area.cx) / area.rx) ** 2 + ((v - area.cy) / area.ry) ** 2);
      return 1 - smooth(1 - area.soft, 1 + area.soft, d);
    }
  }
}

/** One pixel (0 to 255 each) through one adjustment at full strength. */
export function adjustPixel(r: number, g: number, b: number, a: Adjustment): [number, number, number] {
  // Exposure in stops: ±100 is ±2 stops.
  const gain = 2 ** (a.exposure / 50);
  r *= gain; g *= gain; b *= gain;
  // Warmth moves blue toward amber; tint moves green toward magenta.
  r += a.warmth * 0.3; b -= a.warmth * 0.3;
  g -= a.tint * 0.25; r += a.tint * 0.1; b += a.tint * 0.1;
  // Contrast around mid grey.
  const c = 1 + a.contrast / 100;
  r = (r - 128) * c + 128; g = (g - 128) * c + 128; b = (b - 128) * c + 128;
  // Saturation around the pixel's own brightness.
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const s = 1 + a.saturation / 100;
  r = l + (r - l) * s; g = l + (g - l) * s; b = l + (b - l) * s;
  return [clamp(r, 0, 255), clamp(g, 0, 255), clamp(b, 0, 255)];
}

/** Applies the edits to RGBA pixels in place. */
export function applyEdits(data: Uint8ClampedArray, width: number, height: number, edits: PhotoEdits): void {
  const live = edits.adjustments.filter((a) => !a.hidden && AMOUNTS.some((k) => a[k] !== 0));
  if (live.length === 0) return;
  for (let y = 0; y < height; y++) {
    const v = height > 1 ? y / (height - 1) : 0;
    for (let x = 0; x < width; x++) {
      const u = width > 1 ? x / (width - 1) : 0;
      const i = (y * width + x) * 4;
      let r = data[i]!, g = data[i + 1]!, b = data[i + 2]!;
      for (const a of live) {
        const w = weightAt(a.area, u, v);
        if (w <= 0) continue;
        const [nr, ng, nb] = adjustPixel(r, g, b, a);
        r += (nr - r) * w; g += (ng - g) * w; b += (nb - b) * w;
      }
      data[i] = r; data[i + 1] = g; data[i + 2] = b;
    }
  }
}

/** The average colour of the photo and of its top and bottom halves, for describing it in words to the agent. */
export function describePixels(data: Uint8ClampedArray, width: number, height: number): string {
  const avg = (y0: number, y1: number) => {
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = y0; y < y1; y += 4) for (let x = 0; x < width; x += 4) { const i = (y * width + x) * 4; r += data[i]!; g += data[i + 1]!; b += data[i + 2]!; n++; }
    return n ? [r / n, g / n, b / n].map(Math.round) : [0, 0, 0];
  };
  const hex = (c: number[]) => `#${c.map((x) => x.toString(16).padStart(2, '0')).join('')}`;
  const all = avg(0, height), top = avg(0, Math.floor(height / 2)), bottom = avg(Math.floor(height / 2), height);
  const bright = Math.round((0.2126 * all[0]! + 0.7152 * all[1]! + 0.0722 * all[2]!) / 2.55);
  return `${width} × ${height} px. Average colour ${hex(all)} (brightness ${bright}%); top half ${hex(top)}, bottom half ${hex(bottom)}.`;
}

/** The edits file that goes with a photo. */
export const editsPathFor = (photo: string) => `${photo}.edits.json`;
export const isPhoto = (name: string) => /\.(jpe?g|png|webp|gif)$/i.test(name);
