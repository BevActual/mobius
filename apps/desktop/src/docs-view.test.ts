import { describe, expect, it } from 'vitest';
import { activeHeading, docStats, readableText } from './docs-view';

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
  it('marks the heading the cursor is under', () => {
    const outline = [{ pos: 0 }, { pos: 40 }, { pos: 90 }];
    expect(activeHeading(outline, 0)).toBe(0);
    expect(activeHeading(outline, 60)).toBe(1);
    expect(activeHeading(outline, 500)).toBe(2);
    expect(activeHeading([{ pos: 10 }], 2)).toBe(-1);
  });
});
