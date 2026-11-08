import { describe, expect, it } from 'vitest';
import { adjustPixel, applyEdits, blankAdjustment, parseEdits, weightAt, writeEdits, describePixels } from './photo-edit';

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
