import { describe, expect, it } from 'vitest';
import { fitDocks } from './dock-fit';

describe('fitDocks', () => {
  it('keeps the saved widths when the window has room', () => {
    expect(fitDocks(1440, 248, 380, true, true)).toEqual({ left: 248, right: 380 });
  });
  it('narrows Mobius first, then the sidebar, down to their minimums', () => {
    expect(fitDocks(1100, 248, 380, true, true)).toEqual({ left: 248, right: 300 });
    expect(fitDocks(1024, 248, 380, true, true)).toEqual({ left: 192, right: 280 });
    expect(fitDocks(800, 248, 380, true, true)).toEqual({ left: 180, right: 280 });
  });
  it('leaves a closed dock alone and gives its room to the other', () => {
    expect(fitDocks(1024, 248, 380, true, false)).toEqual({ left: 248, right: 380 });
    expect(fitDocks(900, 248, 380, false, true)).toEqual({ left: 248, right: 348 });
  });
});
