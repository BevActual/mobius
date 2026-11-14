import { afterEach, describe, expect, it, vi } from 'vitest';
import { chooseItem } from './MenuBar';

describe('choosing a menu item', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('runs the item even when the window draws no frames (covered, or not drawn, as the e2e window can be)', () => {
    // A window with no frames: requestAnimationFrame callbacks never come. Before, the item waited for one and never ran.
    vi.stubGlobal('requestAnimationFrame', () => 0);
    const order: string[] = [];
    chooseItem({ run: () => order.push('run') }, () => order.push('close'));
    expect(order).toEqual(['close', 'run']);
  });
  it('does nothing for a disabled item', () => {
    const run = vi.fn();
    const close = vi.fn();
    chooseItem({ disabled: true, run }, close);
    expect(run).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });
});
