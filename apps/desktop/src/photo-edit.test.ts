import { describe, expect, it } from 'vitest';
import { adjustPixel, applyEdits, autoAmounts, blankAdjustment, coverScale, filterOf, histogram, parseEdits, plainGeometry, turnedSize, weightAt, withFilter, writeEdits, describePixels } from './photo-edit';

describe('photo edits', () => {
  it('read and write adjustments, with defaults and limits', () => {
    const edits = parseEdits('{"adjustments":[{"id":"a1","name":"Warm the hills","warmth":25,"saturation":500,"area":{"kind":"below","at":0.55}},{"exposure":-20}]}');
    expect(edits.adjustments[0]).toMatchObject({ id: 'a1', warmth: 25, saturation: 100, area: { kind: 'below', at: 0.55, soft: 0.1 } });
    expect(edits.adjustments[1]).toMatchObject({ id: 'a2', name: 'Adjustment', exposure: -20, area: { kind: 'all' } });
    expect(parseEdits(writeEdits(edits))).toEqual(edits);
    expect(writeEdits(edits)).toContain('\n    {"id":"a2","name":"Adjustment","exposure":-20}\n');
    expect(parseEdits('nonsense')).toEqual({ version: 1, adjustments: [] });
    expect(parseEdits(null).adjustments).toEqual([]);
  });

  it('reach only their area, fading at its edge', () => {
    const below = { ...blankAdjustment('a').area, kind: 'below' as const, at: 0.5, soft: 0.2 };
    expect(weightAt(below, 0.5, 0.1)).toBe(0);
    expect(weightAt(below, 0.5, 0.9)).toBe(1);
    expect(weightAt(below, 0.5, 0.5)).toBeCloseTo(0.5);
    const ellipse = { ...below, kind: 'ellipse' as const, cx: 0.5, cy: 0.5, rx: 0.2, ry: 0.2, soft: 0 };
    expect(weightAt(ellipse, 0.5, 0.5)).toBe(1);
    expect(weightAt(ellipse, 0.95, 0.5)).toBe(0);
  });

  it('change pixels the way the sliders say', () => {
    const a = blankAdjustment('a');
    expect(adjustPixel(100, 120, 140, a)).toEqual([100, 120, 140]);
    const [r, , b] = adjustPixel(100, 120, 140, { ...a, warmth: 50 });
    expect(r).toBeGreaterThan(100);
    expect(b).toBeLessThan(140);
    expect(adjustPixel(100, 100, 100, { ...a, exposure: 50 })).toEqual([200, 200, 200]);
    const [gr, gg, gb] = adjustPixel(200, 100, 50, { ...a, saturation: -100 });
    expect(Math.abs(gr - gg)).toBeLessThan(1e-9);
    expect(Math.abs(gg - gb)).toBeLessThan(1e-9);
    // Two rows: the adjustment below the middle changes only the bottom one.
    const px = new Uint8ClampedArray([100, 100, 100, 255, 100, 100, 100, 255]);
    applyEdits(px, 1, 2, { version: 1, adjustments: [{ ...a, exposure: 50, area: { ...a.area, kind: 'below', at: 0.5, soft: 0 } }] });
    expect([...px]).toEqual([100, 100, 100, 255, 200, 200, 200, 255]);
    expect(describePixels(px, 1, 2)).toContain('1 × 2 px');
  });
});

describe('photo geometry, filters and Auto', () => {
  it('keeps turns, flips, straightening and crop beside the adjustments, and leaves them out when plain', () => {
    const text = '{"adjustments":[],"geometry":{"turns":5,"flip":true,"straighten":80,"crop":{"x":0.1,"y":0.2,"w":2,"h":0.5}}}';
    const e = parseEdits(text);
    expect(e.geometry).toEqual({ turns: 1, flip: true, straighten: 45, crop: { x: 0.1, y: 0.2, w: 0.9, h: 0.5 } });
    expect(parseEdits(writeEdits(e))).toEqual(e);
    expect(parseEdits('{"geometry":{"turns":0}}').geometry).toBeUndefined();
    expect(writeEdits({ version: 1, adjustments: [], geometry: plainGeometry() })).not.toContain('geometry');
  });
  it('covers the frame when straightened, and swaps sides when turned', () => {
    expect(coverScale(400, 300, 0)).toBe(1);
    expect(coverScale(400, 300, 10)).toBeGreaterThan(1.2);
    expect(turnedSize(400, 300, 1)).toEqual([300, 400]);
  });
  it('lift shadows and pull back highlights only where they are', () => {
    const a = blankAdjustment('a');
    expect(adjustPixel(20, 20, 20, { ...a, shadows: 100 })[0]).toBeGreaterThan(60);
    expect(adjustPixel(240, 240, 240, { ...a, shadows: 100 })[0]).toBe(240);
    expect(adjustPixel(240, 240, 240, { ...a, highlights: -100 })[0]).toBeLessThan(200);
    // A vignette darkens the corner and leaves the middle.
    const px = new Uint8ClampedArray(9 * 4).fill(200);
    applyEdits(px, 3, 3, { version: 1, adjustments: [{ ...a, vignette: 100 }] });
    expect(px[0]).toBeLessThan(100);
    expect(px[4 * 4]).toBe(200);
  });
  it('sets a filter as one layer, first, and takes it off', () => {
    const start = { version: 1 as const, adjustments: [blankAdjustment('a1')] };
    const mono = withFilter(start, 'mono');
    expect(mono.adjustments.map((a) => a.id)).toEqual(['filter', 'a1']);
    expect(mono.adjustments[0]).toMatchObject({ name: 'Mono', saturation: -100 });
    expect(filterOf(mono)).toBe('mono');
    expect(withFilter(withFilter(mono, 'noir'), null).adjustments.map((a) => a.id)).toEqual(['a1']);
  });
  it('Auto brightens a dark picture and reads a histogram', () => {
    const dark = new Uint8ClampedArray(100 * 4).map((_, i) => (i % 4 === 3 ? 255 : 30 + (i % 7)));
    expect(autoAmounts(dark).exposure).toBeGreaterThan(30);
    const h = histogram(dark, 8);
    expect(h).toHaveLength(8);
    expect(Math.max(...h)).toBe(1);
    expect(h.slice(0, 2)).toContain(1);
    expect(h.slice(2).every((n) => n === 0)).toBe(true);
  });
});
