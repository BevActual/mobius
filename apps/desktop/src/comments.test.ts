import { describe, expect, it } from 'vitest';
import { piecesOf } from './Comments';

/** A stand-in element: its children's texts, and its own text as the browser joins them (with nothing between). */
const el = (...parts: string[]): Element => ({ childNodes: parts.map((textContent) => ({ textContent })), textContent: parts.join('') }) as unknown as Element;

describe('the words a comment quotes', () => {
  it('reads each part on its own, not run together', () => {
    expect(piecesOf(el('Edited just now', '22 words', '#kestrel'), 80)).toBe('Edited just now · 22 words · #kestrel');
  });
  it('is trimmed to the length asked for', () => {
    const got = piecesOf(el('word '.repeat(40)), 80);
    expect(got.length).toBeLessThanOrEqual(80);
    expect(got.endsWith('…')).toBe(true);
  });
  it('keeps plain text as it is, with its spaces tidied', () => {
    expect(piecesOf(el('Hello   there'), 80)).toBe('Hello there');
  });
});
