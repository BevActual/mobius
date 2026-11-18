import { describe, expect, it } from 'vitest';
import { fitDocks } from './dock-fit';

describe('fitDocks', () => {
  it('keeps the saved width when the window has room', () => {
    expect(fitDocks(1440, 380, true)).toEqual({ right: 380 });
  });
  it('narrows Mobius on a narrow window, down to its minimum', () => {
    expect(fitDocks(900, 380, true)).toEqual({ right: 348 });
    expect(fitDocks(800, 380, true)).toEqual({ right: 280 });
  });
  it('leaves a closed dock alone', () => {
    expect(fitDocks(800, 380, false)).toEqual({ right: 380 });
  });
});
