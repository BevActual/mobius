import { describe, expect, it } from 'vitest';
import { CHECKLIST, TABLE, clipBlock, insertBlock, recordingBlock, tidyMarkdown } from './note-insert';

describe('note insert', () => {
  it('puts a block on lines of its own at the cursor', () => {
    expect(insertBlock('# Trip\nIdeas', 13, CHECKLIST)).toEqual({ page: `# Trip\nIdeas\n\n${CHECKLIST}\n`, cursor: 20 });
    expect(insertBlock('', 0, TABLE)).toEqual({ page: `${TABLE}\n`, cursor: 2 });
    const mid = insertBlock('one\n\ntwo', 4, 'X');
    expect(mid.page).toBe('one\n\nX\n\ntwo');
    expect(insertBlock('# Untitled\n\n', 0, 'X').page).toBe('# Untitled\n\nX\n\n');
  });

  it('writes a recording and a clipping', () => {
    expect(recordingBlock(' Rui says the terrace fits twelve. ', 252, new Date(2026, 10, 8, 9, 5))).toBe('### Recording · 4:12 · 09:05\n\nRui says the terrace fits twelve.');
    expect(clipBlock({ url: 'https://a.example/x', title: 'Casa [Amora]', text: '## Casa Amora\n\nNine rooms.\n\nBreakfast.\n\nPool.\n\nMore.' })).toBe('> Nine rooms.\n>\n> Breakfast.\n>\n> Pool.\n\n— [Casa Amora](https://a.example/x)');
  });
});

describe('the Markdown a note is saved as', () => {
  it('keeps one blank line between blocks and no &nbsp; for an empty line', () => {
    expect(tidyMarkdown('# A\n\n- x\n\n&nbsp;\n\nNext')).toBe('# A\n\n- x\n\nNext\n');
    expect(tidyMarkdown('Keep &nbsp; inside a line\n\n\n')).toBe('Keep &nbsp; inside a line\n');
  });
});
