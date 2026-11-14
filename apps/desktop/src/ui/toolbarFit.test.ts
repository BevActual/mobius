import { describe, expect, it } from 'vitest';
import { dropOrder } from './toolbarFit';

describe('fitting the toolbar', () => {
  it('drops low controls first, then the rest, the last first, and never one marked keep', () => {
    expect(dropOrder(['normal', 'low', 'keep', 'normal', 'low'])).toEqual([4, 1, 3, 0]);
    expect(dropOrder(['keep'])).toEqual([]);
    expect(dropOrder([])).toEqual([]);
  });
});
