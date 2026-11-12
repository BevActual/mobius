import { describe, expect, it } from 'vitest';
import { blankAdjustment } from './photo-edit';
import { GRID_SIZES, aspectRatio, dragCrop, emptyHistory, fitAspect, flippedCrop, groupChanged, recorded, redone, resetGroup, stepTo, turnedCrop, undone, zoomStep } from './photo-view';

describe('history', () => {
  it('undoes and redoes, and a slider dragged undoes as one step', () => {
    let h = emptyHistory<number>();
    h = recorded(h, 0, 'slider:a1:warmth', 1000);
    h = recorded(h, 1, 'slider:a1:warmth', 1500);
    h = recorded(h, 2, 'add', 1600);
    expect(h.past).toEqual([0, 2]);
    const u = undone(h, 3)!;
    expect(u.value).toBe(2);
    const u2 = undone(u.history, 2)!;
    expect(u2.value).toBe(0);
    expect(undone(u2.history, 0)).toBeNull();
    const r = redone(u2.history, 0)!;
    expect(r.value).toBe(2);
    expect(recorded(r.history, 2, 'x', 5000).future).toEqual([]);
  });
});

describe('stepTo', () => {
  it('steps through an album and stops at its ends', () => {
    expect(stepTo(['a', 'b', 'c'], 'b', 1)).toBe('c');
    expect(stepTo(['a', 'b', 'c'], 'c', 1)).toBe('c');
    expect(stepTo(['a', 'b', 'c'], 'a', -1)).toBe('a');
    expect(stepTo(['a', 'b'], 'z', 1)).toBe('a');
    expect(stepTo([], 'a', 1)).toBeNull();
  });
});

describe('crop', () => {
  it('fits an aspect as large as it goes, upright on a portrait picture', () => {
    expect(aspectRatio('16:9', 1.5)).toBeCloseTo(16 / 9);
    expect(aspectRatio('16:9', 0.75)).toBeCloseTo(9 / 16);
    expect(aspectRatio('free', 1.5)).toBeNull();
    const sq = fitAspect({ x: 0, y: 0, w: 1, h: 1 }, 1, 2);
    expect(sq).toEqual({ x: 0.25, y: 0, w: 0.5, h: 1 });
  });
  it('moves inside the frame and drags its sides and corners', () => {
    const c = { x: 0.2, y: 0.2, w: 0.5, h: 0.5 };
    expect(dragCrop(c, 'move', 0.6, 0, null)).toEqual({ x: 0.5, y: 0.2, w: 0.5, h: 0.5 });
    const se = dragCrop(c, 'se', 0.1, 0.1, null);
    expect(se.w).toBeCloseTo(0.6);
    expect(se.h).toBeCloseTo(0.6);
    expect(dragCrop(c, 'w', 0.9, 0, null).w).toBeCloseTo(0.05);
    // Locked square: dragging the right side grows the height too, about the middle.
    const locked = dragCrop(c, 'e', 0.1, 0, 1);
    expect(locked.w).toBeCloseTo(0.6);
    expect(locked.h).toBeCloseTo(0.6);
    expect(locked.y).toBeCloseTo(0.15);
    // Never past the frame.
    const big = dragCrop(c, 'se', 0.9, 0.9, 1);
    expect(big.x + big.w).toBeLessThanOrEqual(1 + 1e-9);
    expect(big.y + big.h).toBeLessThanOrEqual(1 + 1e-9);
  });
  it('turns and flips with the picture', () => {
    const t = turnedCrop({ x: 0.1, y: 0.2, w: 0.3, h: 0.4 });
    expect([t.x, t.y, t.w, t.h].map((n) => Math.round(n * 1000) / 1000)).toEqual([0.2, 0.6, 0.4, 0.3]);
    expect(flippedCrop({ x: 0.1, y: 0.2, w: 0.3, h: 0.4 }).x).toBeCloseTo(0.6);
  });
});

describe('grid zoom', () => {
  it('steps through the sizes and stops at either end', () => {
    expect(zoomStep(2, 1)).toBe(3);
    expect(zoomStep(0, -1)).toBe(0);
    expect(zoomStep(GRID_SIZES.length - 1, 1)).toBe(GRID_SIZES.length - 1);
    expect(zoomStep(Number.NaN, 0)).toBe(2);
    expect(zoomStep(99, 0)).toBe(GRID_SIZES.length - 1);
  });
});

describe('adjust sections', () => {
  it('knows when a section has moved and puts only that section back', () => {
    const a = { ...blankAdjustment('a1'), exposure: 20, warmth: 30, area: { ...blankAdjustment('x').area, kind: 'below' as const, at: 0.7 } };
    expect(groupChanged(a, ['exposure', 'contrast'])).toBe(true);
    expect(groupChanged(a, ['vignette'])).toBe(false);
    expect(groupChanged(a, 'where')).toBe(true);
    const light = resetGroup(a, ['exposure', 'contrast']);
    expect(light.exposure).toBe(0);
    expect(light.warmth).toBe(30);
    expect(a.exposure).toBe(20);
    const where = resetGroup(a, 'where');
    expect(where.area.kind).toBe('all');
    expect(where.warmth).toBe(30);
  });
});
