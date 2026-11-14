import { describe, expect, it } from 'vitest';
import { clampWidth, draggedWidth, keyedWidth } from './resize';

describe('dragging a sidebar edge', () => {
  it('grows the left list to the right and the agent panel to the left', () => {
    expect(draggedWidth('left', 248, 100, 160)).toBe(308);
    expect(draggedWidth('left', 248, 100, 70)).toBe(218);
    expect(draggedWidth('right', 380, 900, 840)).toBe(440);
    expect(draggedWidth('right', 380, 900, 950)).toBe(330);
  });

  it('stays inside each side\'s range however far the pointer goes', () => {
    expect(draggedWidth('left', 248, 0, 5000)).toBe(420);
    expect(draggedWidth('left', 248, 5000, 0)).toBe(200);
    expect(draggedWidth('right', 380, 0, 5000)).toBe(300);
    expect(draggedWidth('right', 380, 5000, 0)).toBe(640);
    expect(clampWidth('left', Number.NaN)).toBe(248);
    expect(clampWidth('right', Number.POSITIVE_INFINITY)).toBe(340);
    expect(clampWidth('left', 250.4)).toBe(250);
  });

  it('can also be moved with the arrow keys, in the direction the edge moves', () => {
    expect(keyedWidth('left', 248, 'ArrowRight', false)).toBe(264);
    expect(keyedWidth('left', 248, 'ArrowLeft', false)).toBe(232);
    expect(keyedWidth('left', 248, 'ArrowRight', true)).toBe(312);
    expect(keyedWidth('right', 380, 'ArrowLeft', false)).toBe(396);
    expect(keyedWidth('right', 380, 'ArrowRight', false)).toBe(364);
    expect(keyedWidth('left', 410, 'ArrowRight', true)).toBe(420);
    expect(keyedWidth('left', 248, 'Home', false)).toBe(200);
    expect(keyedWidth('right', 380, 'End', false)).toBe(640);
    expect(keyedWidth('left', 248, 'a', false)).toBeNull();
    expect(keyedWidth('left', 248, 'ArrowUp', false)).toBeNull();
  });
});
