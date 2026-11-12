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
 *
 * Optional `geometry` turns, flips, straightens and crops the picture before the adjustments, as Photos' Crop does:
 *
 *     "geometry": { "turns": 1, "flip": false, "straighten": -2.5, "crop": { "x": 0.1, "y": 0, "w": 0.8, "h": 1 } }
 *
 * `turns` are quarter turns to the left, `straighten` is degrees (-45 to 45), and `crop` is the part kept, from 0 to 1
 * across and down the turned and straightened picture. Areas are measured on the cropped picture.
 */
export type AreaKind = 'all' | 'below' | 'above' | 'ellipse';
export interface Area { kind: AreaKind; at: number; soft: number; cx: number; cy: number; rx: number; ry: number }
export interface Adjustment { id: string; name: string; exposure: number; highlights: number; shadows: number; contrast: number; saturation: number; warmth: number; tint: number; vignette: number; hidden: boolean; area: Area }
export interface Crop { x: number; y: number; w: number; h: number }
export interface Geometry { turns: 0 | 1 | 2 | 3; flip: boolean; straighten: number; crop: Crop }
export interface PhotoEdits { version: 1; adjustments: Adjustment[]; geometry?: Geometry }

export const AMOUNTS = ['exposure', 'highlights', 'shadows', 'contrast', 'saturation', 'warmth', 'tint', 'vignette'] as const;
export type Amount = (typeof AMOUNTS)[number];
export const AMOUNT_NAMES: Record<Amount, string> = { exposure: 'Exposure', highlights: 'Highlights', shadows: 'Shadows', contrast: 'Contrast', saturation: 'Saturation', warmth: 'Warmth', tint: 'Tint', vignette: 'Vignette' };
/** The sliders in groups, as Photos shows them. */
export const AMOUNT_GROUPS: readonly { name: string; amounts: readonly Amount[] }[] = [
  { name: 'Light', amounts: ['exposure', 'highlights', 'shadows', 'contrast'] },
  { name: 'Color', amounts: ['saturation', 'warmth', 'tint'] },
  { name: 'Effects', amounts: ['vignette'] },
];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const num = (v: unknown, fallback: number, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? clamp(Math.round(v * 1000) / 1000, lo, hi) : fallback);
const obj = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export const wholeArea = (): Area => ({ kind: 'all', at: 0.5, soft: 0.1, cx: 0.5, cy: 0.5, rx: 0.3, ry: 0.3 });
export function blankAdjustment(id: string, name = 'Adjustment'): Adjustment {
  return { id, name, exposure: 0, highlights: 0, shadows: 0, contrast: 0, saturation: 0, warmth: 0, tint: 0, vignette: 0, hidden: false, area: wholeArea() };
}
export const FULL_CROP: Crop = { x: 0, y: 0, w: 1, h: 1 };
export const plainGeometry = (): Geometry => ({ turns: 0, flip: false, straighten: 0, crop: { ...FULL_CROP } });
export const isPlain = (g: Geometry | undefined): boolean =>
  !g || (g.turns === 0 && !g.flip && g.straighten === 0 && g.crop.x === 0 && g.crop.y === 0 && g.crop.w === 1 && g.crop.h === 1);

function parseGeometry(v: unknown): Geometry | undefined {
  if (typeof v !== 'object' || v === null) return undefined;
  const g = obj(v), c = obj(g.crop);
  const turns = (((Math.round(num(g.turns, 0, -1000, 1000)) % 4) + 4) % 4) as Geometry['turns'];
  const x = num(c.x, 0, 0, 0.99), y = num(c.y, 0, 0, 0.99);
  const out: Geometry = { turns, flip: g.flip === true, straighten: num(g.straighten, 0, -45, 45), crop: { x, y, w: num(c.w, 1 - x, 0.01, 1 - x), h: num(c.h, 1 - y, 0.01, 1 - y) } };
  return isPlain(out) ? undefined : out;
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
      exposure: num(o.exposure, 0, -100, 100), highlights: num(o.highlights, 0, -100, 100), shadows: num(o.shadows, 0, -100, 100), contrast: num(o.contrast, 0, -100, 100), saturation: num(o.saturation, 0, -100, 100), warmth: num(o.warmth, 0, -100, 100), tint: num(o.tint, 0, -100, 100), vignette: num(o.vignette, 0, -100, 100),
      hidden: o.hidden === true,
      area: { kind, at: num(a.at, 0.5, 0, 1), soft: num(a.soft, 0.1, 0, 1), cx: num(a.cx, 0.5, 0, 1), cy: num(a.cy, 0.5, 0, 1), rx: num(a.rx, 0.3, 0.01, 2), ry: num(a.ry, 0.3, 0.01, 2) },
    };
  });
  const geometry = parseGeometry(obj(raw).geometry);
  return geometry ? { version: 1, adjustments, geometry } : { version: 1, adjustments };
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
  const g = edits.geometry;
  const geo = g && !isPlain(g) ? `,\n  "geometry": ${JSON.stringify({ turns: g.turns, flip: g.flip, straighten: g.straighten, crop: g.crop })}` : '';
  return `{\n  "version": 1,\n  "adjustments": [${body ? `\n${body}\n  ` : ''}]${geo}\n}\n`;
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
  // Highlights and shadows lift or pull back only the bright or the dark part.
  if (a.highlights !== 0 || a.shadows !== 0) {
    const y = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    const lift = (a.highlights / 100) * smooth(0.45, 1, y) * 70 + (a.shadows / 100) * (1 - smooth(0, 0.55, y)) * 70;
    r += lift; g += lift; b += lift;
  }
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
  const diag = Math.SQRT1_2;
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
        let [nr, ng, nb] = adjustPixel(r, g, b, a);
        if (a.vignette !== 0) {
          // Darkens (or lightens) toward the corners.
          const d = Math.sqrt((u - 0.5) ** 2 + (v - 0.5) ** 2) / diag;
          const f = Math.max(0, 1 - (a.vignette / 100) * 0.75 * smooth(0.3, 1, d));
          nr = clamp(nr * f, 0, 255); ng = clamp(ng * f, 0, 255); nb = clamp(nb * f, 0, 255);
        }
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

/** How much a straightened picture is scaled so it still covers its frame with no empty corners. */
export function coverScale(width: number, height: number, degrees: number): number {
  const t = Math.abs(degrees) * Math.PI / 180;
  if (t === 0 || width <= 0 || height <= 0) return 1;
  return Math.cos(t) + Math.sin(t) * Math.max(width / height, height / width);
}

/** The picture's size once turned: a quarter turn swaps its sides. */
export const turnedSize = (width: number, height: number, turns: number): [number, number] => (turns % 2 === 1 ? [height, width] : [width, height]);

/** Luminance in 64 bins, for the histogram: each bin from 0 to 1 against the fullest. */
export function histogram(data: Uint8ClampedArray, bins = 64): number[] {
  const out = new Array<number>(bins).fill(0);
  for (let i = 0; i < data.length; i += 4) {
    const y = 0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!;
    out[Math.min(bins - 1, Math.floor((y / 256) * bins))]! += 1;
  }
  const top = Math.max(1, ...out);
  return out.map((n) => n / top);
}

/** What Auto sets, from the picture's pixels: exposure toward a mid brightness, and contrast to fill the range. */
export function autoAmounts(data: Uint8ClampedArray): Partial<Record<Amount, number>> {
  const ys: number[] = [];
  for (let i = 0; i < data.length; i += 4) ys.push((0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!) / 255);
  if (ys.length === 0) return {};
  ys.sort((p, q) => p - q);
  const at = (q: number) => ys[Math.min(ys.length - 1, Math.floor(q * ys.length))]!;
  const mean = ys.reduce((s, y) => s + y, 0) / ys.length;
  const spread = at(0.98) - at(0.02);
  const exposure = Math.round(clamp(Math.log2(0.46 / Math.max(0.02, mean)) * 50, -60, 60));
  const contrast = Math.round(clamp((0.85 - spread) * 50, -15, 30));
  const shadows = Math.round(clamp((0.12 - at(0.05)) * 200, 0, 30));
  const highlights = Math.round(clamp((at(0.95) - 0.92) * -400, -30, 0));
  return { exposure, contrast, shadows, highlights, saturation: 8 };
}

export type FilterId = 'vivid' | 'vivid-warm' | 'vivid-cool' | 'dramatic' | 'mono' | 'silvertone' | 'noir';
/** Filters, as Photos names them: each is one adjustment layer, named for the filter, that can be changed after. */
export const FILTERS: readonly { id: FilterId; name: string; amounts: Partial<Record<Amount, number>> }[] = [
  { id: 'vivid', name: 'Vivid', amounts: { contrast: 12, saturation: 30 } },
  { id: 'vivid-warm', name: 'Vivid Warm', amounts: { contrast: 12, saturation: 25, warmth: 22 } },
  { id: 'vivid-cool', name: 'Vivid Cool', amounts: { contrast: 12, saturation: 25, warmth: -22 } },
  { id: 'dramatic', name: 'Dramatic', amounts: { contrast: 35, highlights: -30, shadows: -10, saturation: -15, vignette: 25 } },
  { id: 'mono', name: 'Mono', amounts: { saturation: -100 } },
  { id: 'silvertone', name: 'Silvertone', amounts: { saturation: -100, contrast: -10, exposure: 6, warmth: 8 } },
  { id: 'noir', name: 'Noir', amounts: { saturation: -100, contrast: 45, shadows: -20, vignette: 30 } },
];
export const FILTER_ID = 'filter';

/** The edits with a filter set (one layer, first, so later adjustments build on it), or taken off with null. */
export function withFilter(edits: PhotoEdits, filter: FilterId | null): PhotoEdits {
  const rest = edits.adjustments.filter((a) => a.id !== FILTER_ID);
  const f = FILTERS.find((x) => x.id === filter);
  if (!f) return { ...edits, adjustments: rest };
  return { ...edits, adjustments: [{ ...blankAdjustment(FILTER_ID, f.name), ...f.amounts }, ...rest] };
}
export const filterOf = (edits: PhotoEdits): FilterId | null =>
  FILTERS.find((f) => edits.adjustments.some((a) => a.id === FILTER_ID && a.name === f.name))?.id ?? null;
