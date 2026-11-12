import { describe, expect, it } from 'vitest';
import { alignBoxes, around, boxFrom, boxesTouching, distributeBoxes, resizeBox, snapBox, zoomOnto } from './design-view';

const b = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

describe('dragging handles', () => {
  it('moves the edges the handle holds', () => {
    expect(resizeBox(b(10, 10, 100, 50), 'se', 20, 10)).toEqual(b(10, 10, 120, 60));
    expect(resizeBox(b(10, 10, 100, 50), 'nw', 20, 10)).toEqual(b(30, 20, 80, 40));
    expect(resizeBox(b(10, 10, 100, 50), 'e', 5, 99)).toEqual(b(10, 10, 105, 50));
  });
  it('keeps the shape from a corner with Shift', () => {
    expect(resizeBox(b(0, 0, 100, 50), 'se', 100, 0, true)).toEqual(b(0, 0, 200, 100));
    expect(resizeBox(b(0, 0, 100, 50), 'nw', -100, 0, true)).toEqual(b(-100, -50, 200, 100));
  });
  it('never goes below the smallest size, keeping the far edge still', () => {
    expect(resizeBox(b(10, 10, 100, 50), 'w', 200, 0)).toEqual(b(109, 10, 1, 50));
  });
});

describe('snapping', () => {
  const frame = b(0, 0, 400, 800);
  it('pulls an edge or middle onto one nearby and draws the guide', () => {
    const s = snapBox(b(197, 300, 10, 10), [frame], 4);
    expect(s.dx).toBe(-2);
    expect(s.guides).toEqual([{ axis: 'x', at: 200, from: 0, to: 800 }]);
  });
  it('leaves it alone when nothing is within reach', () => {
    expect(snapBox(b(50, 50, 10, 10), [b(300, 300, 10, 10)], 4)).toEqual({ dx: 0, dy: 0, guides: [] });
  });
  it('snaps both ways at once', () => {
    const s = snapBox(b(102, 98, 20, 20), [b(0, 0, 100, 100)], 5);
    expect([s.dx, s.dy]).toEqual([-2, 2]);
    expect(s.guides.map((g) => g.axis)).toEqual(['x', 'y']);
  });
});

describe('lining up', () => {
  const boxes = [b(10, 10, 20, 20), b(50, 40, 40, 10)];
  it('aligns to the edges of all of them, or of the frame', () => {
    expect(alignBoxes(boxes, 'left')).toEqual([{ x: 10, y: 10 }, { x: 10, y: 40 }]);
    expect(alignBoxes(boxes, 'bottom')).toEqual([{ x: 10, y: 30 }, { x: 50, y: 40 }]);
    expect(alignBoxes([b(10, 10, 20, 20)], 'center', b(0, 0, 100, 100))).toEqual([{ x: 40, y: 10 }]);
    expect(alignBoxes([b(10, 10, 20, 20)], 'middle', b(0, 0, 100, 100))).toEqual([{ x: 10, y: 40 }]);
  });
  it('spaces three or more evenly, keeping the ends', () => {
    expect(distributeBoxes([b(0, 0, 10, 10), b(70, 0, 10, 10), b(20, 0, 10, 10)], 'x')).toEqual([{ x: 0, y: 0 }, { x: 70, y: 0 }, { x: 35, y: 0 }]);
    expect(distributeBoxes([b(0, 0, 10, 10), b(5, 5, 10, 10)], 'y')).toEqual([{ x: 0, y: 0 }, { x: 5, y: 5 }]);
  });
});

describe('picking with a box', () => {
  it('takes what it touches, drawn either way', () => {
    const items = [{ id: 'a', ...b(0, 0, 10, 10) }, { id: 'b', ...b(50, 50, 10, 10) }];
    expect(boxesTouching(items, boxFrom(15, 15, 5, 5)).map((i) => i.id)).toEqual(['a']);
    expect(boxesTouching(items, boxFrom(0, 0, 100, 100)).map((i) => i.id)).toEqual(['a', 'b']);
    expect(around(items)).toEqual(b(0, 0, 60, 60));
    expect(around([])).toBeNull();
  });
});

describe('zooming onto a box', () => {
  it('centres it with a margin, no closer than the limit', () => {
    expect(zoomOnto(b(0, 0, 400, 200), 1000, 600)).toEqual({ zoom: 2, pan: { x: 100, y: 100 } });
    expect(zoomOnto(b(100, 100, 1840, 1040), 1000, 600)).toEqual({ zoom: 0.5, pan: { x: -10, y: -10 } });
    expect(zoomOnto(b(0, 0, 10, 10), 1000, 600, 40, 1).zoom).toBe(1);
  });
});
