import { describe, expect, it } from 'vitest';
import { acceptGroup, countLabel, docStats, headingInView, placeChanges, readableText } from './docs-view';
import { changeGroups, diffLines } from './line-diff';

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

describe("Mobius's changes in the page", () => {
  const before = '# Brief\n\nWe have been talking for a while.\n\n## Agenda\n\n- Arrive on the 12th\n- Plan on the 13th\n';
  const now = '# Brief\n\nWe need a few days away.\n\n## Agenda\n\n- Arrive on the 12th\n- Plan on the terrace on the 13th\n- Leave on the 14th\n';
  const blocks = ['Brief', 'We need a few days away.', 'Agenda', 'Arrive on the 12th', 'Plan on the terrace on the 13th', 'Leave on the 14th'];
  it('finds the blocks each change added, and puts its note before them', () => {
    const lines = diffLines(before, now);
    const groups = changeGroups(lines);
    const { added, notes } = placeChanges(lines, groups, blocks);
    expect([...added.entries()]).toEqual([[1, 0], [4, 1], [5, 1]]);
    expect(notes.get(0)).toEqual({ block: 1, before: true });
    expect(notes.get(1)).toEqual({ block: 4, before: true });
  });
  it('puts the note of a change that only took words away after the block before it', () => {
    const lines = diffLines('# Brief\n\nOne.\n\nTwo.\n', '# Brief\n\nTwo.\n');
    const { added, notes } = placeChanges(lines, changeGroups(lines), ['Brief', 'Two.']);
    expect(added.size).toBe(0);
    expect(notes.get(0)).toEqual({ block: 0, before: false });
  });
  it('keeping one change takes it into the text before, and leaves the others to decide', () => {
    const lines = diffLines(before, now);
    const groups = changeGroups(lines);
    const kept = acceptGroup(lines, groups, 0);
    expect(kept).toContain('We need a few days away.');
    expect(kept).toContain('- Plan on the 13th');
    expect(changeGroups(diffLines(kept, now)).filter((g) => g !== null).length).toBeGreaterThan(0);
  });
});
