import { describe, expect, it } from 'vitest';
import { CHECKLIST, TABLE, clipBlock, insertBlock, meetingAsk, meetingBlock, meetingNote, recordingBlock, tidyMarkdown } from './note-insert';

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

  it('writes a meeting and what Mobius is asked after it', () => {
    expect(meetingBlock([' First part. ', '', 'Second part.'], 3725, new Date(2026, 10, 18, 14, 3))).toBe('## Meeting · 14:03 · 62:05\n\n### Transcript\n\nFirst part.\n\nSecond part.');
    expect(meetingBlock([], 4, new Date(2026, 10, 18, 9, 0))).toBe('## Meeting · 09:00 · 0:04\n\n### Transcript\n\n(nothing was heard)');
    const ask = meetingAsk('Standup', 'Work/Standup.md');
    expect(ask).toContain('"Standup" (Work/Standup.md)');
    expect(ask).toContain('Add each action to Tasks');
  });

  it('names a calendar event meeting page for its day and title, and says which event it was', () => {
    const page = meetingNote({ title: 'Plan: Q1 / budget', start: '2026-11-18T14:00', end: '2026-11-18T15:00', allDay: false, calendar: 'Work', location: 'Room 4' });
    expect(page.title).toBe('2026-11-18 Plan Q1 budget');
    expect(page.content).toBe('# 2026-11-18 Plan Q1 budget\n\nEvent: Plan: Q1 / budget  \nWhen: 2026-11-18, 14:00–15:00  \nCalendar: Work  \nWhere: Room 4\n');
    expect(meetingNote({ title: '', start: '2026-11-19', end: '2026-11-20', allDay: true, calendar: 'Home', location: '' }).content).toBe('# 2026-11-19 Meeting\n\nEvent: Meeting  \nWhen: 2026-11-19  \nCalendar: Home\n');
  });
});

describe('the Markdown a note is saved as', () => {
  it('keeps one blank line between blocks and no &nbsp; for an empty line', () => {
    expect(tidyMarkdown('# A\n\n- x\n\n&nbsp;\n\nNext')).toBe('# A\n\n- x\n\nNext\n');
    expect(tidyMarkdown('Keep &nbsp; inside a line\n\n\n')).toBe('Keep &nbsp; inside a line\n');
  });
});
