import { describe, expect, it } from 'vitest';
import { placeCard } from './AskHere';

describe('Ask from anywhere: where its card goes', () => {
  const view = { width: 1200, height: 800 };
  it('goes under the selection, from its left edge', () => {
    expect(placeCard({ left: 100, top: 200, bottom: 220, width: 60 }, view)).toEqual({ left: 100, top: 228 });
  });
  it('goes above it when there is no room below, and stays on screen at the right edge', () => {
    expect(placeCard({ left: 1100, top: 700, bottom: 720, width: 60 }, view)).toEqual({ left: 812, top: 432 });
  });
  it('never leaves the top or the left of the window', () => {
    expect(placeCard({ left: -20, top: 100, bottom: 700, width: 10 }, { width: 1200, height: 750 })).toEqual({ left: 8, top: 8 });
  });
});
