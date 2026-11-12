import { describe, expect, it } from 'vitest';
import { countLabel, docStats, headingInView, readableText } from './docs-view';

describe('what a document counts', () => {
  it('counts the words a reader sees, not the Markdown around them', () => {
    const md = '# Build brief\n\n- [x] Book the **sled**\n- Read [the plan](Plan.md)\n\n![cell](files/cell.png)\n\n| Day | Who |\n| --- | --- |\n| Monday | Dana |\n';
    expect(readableText(md)).not.toMatch(/[#*|[\]]/);
    expect(docStats(md).words).toBe(12);
    expect(docStats('').minutes).toBe(1);
    expect(docStats('one two').characters).toBe(6);
  });
  it('a long document takes longer to read', () => {
    expect(docStats(Array.from({ length: 690 }, () => 'word').join(' ')).minutes).toBe(3);
  });
});

describe('the outline', () => {
  it('marks the heading whose part is in view, as the page scrolls', () => {
    // Headings 0, 300 and 900 pixels from the top of an 800-pixel view: the title is marked.
    expect(headingInView([0, 300, 900], 800, false)).toBe(0);
    // Scrolled so the second heading is near the top.
    expect(headingInView([-400, 100, 700], 800, false)).toBe(1);
    // Before the first heading reaches the top, the first is still marked.
    expect(headingInView([120, 600], 800, false)).toBe(0);
    // At the end of the document, the last heading that shows is marked, though it never reaches the top.
    expect(headingInView([-900, -200, 650], 800, true)).toBe(2);
    expect(headingInView([], 800, false)).toBe(-1);
  });
});

describe('the count in the foot', () => {
  const stats = { words: 120, characters: 640, minutes: 1 };
  it('shows one count at a time', () => {
    expect(countLabel('words', stats)).toBe('120 words');
    expect(countLabel('characters', stats)).toBe('640 characters');
    expect(countLabel('minutes', stats)).toBe('1 min read');
    expect(countLabel('words', { words: 1, characters: 4, minutes: 1 })).toBe('1 word');
  });
  it('shows chosen words as part of the whole, unless they are all of it', () => {
    expect(countLabel('words', stats, 12)).toBe('12 of 120 words');
    expect(countLabel('words', { words: 1, characters: 8, minutes: 1 }, 1)).toBe('1 word');
  });
});
