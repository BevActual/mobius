import { describe, expect, it } from 'vitest';
import { cellsText, plainAnswer, placeCard } from './AskHere';

describe('Ask from anywhere: where its card goes', () => {
  const view = { width: 1200, height: 800 };
  const size = { width: 380, height: 260 };
  it('goes under the selection, from its left edge', () => {
    expect(placeCard({ left: 100, top: 200, bottom: 220, width: 60 }, view, size)).toEqual({ left: 100, top: 228 });
  });
  it('goes above it when there is no room below, and stays on screen at the right edge', () => {
    expect(placeCard({ left: 1100, top: 700, bottom: 720, width: 60 }, view, size)).toEqual({ left: 812, top: 432 });
  });
  it('never leaves the top or the left of the window', () => {
    expect(placeCard({ left: -20, top: 100, bottom: 700, width: 10 }, { width: 1200, height: 750 }, size)).toEqual({ left: 8, top: 8 });
  });
});

describe('Ask from anywhere: chosen cells', () => {
  it('go as rows of tab-separated values', () => {
    expect(cellsText([['Name', 'Qty'], ['Pens', '4']])).toBe('Name\tQty\nPens\t4');
  });
  it('a small card above the selection sits right by it, from its own height', () => {
    expect(placeCard({ left: 100, top: 700, bottom: 720, width: 60 }, { width: 1200, height: 800 }, { width: 380, height: 111 }).top).toBe(581);
  });
});

describe('Ask from anywhere: Replace selection', () => {
  it('puts plain words in place: no hashes, stars, ticks or link brackets', () => {
    expect(plainAnswer('## The port\n\n**Piraeus** is *the* port of `Athens`, see [map](https://x.example).')).toBe('The port\n\nPiraeus is the port of Athens, see map.');
  });
});
