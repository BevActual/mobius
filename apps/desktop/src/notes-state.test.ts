import { describe, expect, it } from 'vitest';
import { findTodayNote, JOURNAL, liveTitle, onPageChanged, statusText, todayNoteTitle } from './notes-state';

describe('a page changed on disk', () => {
  it('reloads an assistant change to the open page only when nothing is waiting to be saved', () => {
    expect(onPageChanged('saved', true, 'assistant')).toBe('reload');
    // Something put back from the review strip reloads the open page too, or asks when it has unsaved edits.
    expect(onPageChanged('saved', true, 'undo')).toBe('reload');
    expect(onPageChanged('unsaved', true, 'undo')).toBe('ask');
    for (const status of ['unsaved', 'saving', 'conflict', 'error'] as const) expect(onPageChanged(status, true, 'assistant')).toBe('ask');
  });
  it('only refreshes the list for the person\'s own saves and for other pages', () => {
    expect(onPageChanged('unsaved', true, 'person')).toBe('list-only');
    expect(onPageChanged('saved', false, 'assistant')).toBe('list-only');
  });
});

describe('what the editor shows', () => {
  it('uses the first heading as the title', () => {
    expect(liveTitle('intro\n# Trip\n# Other', 'file')).toBe('Trip');
    expect(liveTitle('#   \nno heading', 'file')).toBe('file');
  });
  it('says plainly whether the page is saved', () => {
    expect(statusText('saved')).toBe('Saved');
    expect(statusText('conflict')).toContain('assistant');
    expect(statusText('error')).toBe('Not saved');
  });
});

describe("today's note", () => {
  const day = new Date(2026, 10, 9, 23, 30);
  it('is titled by the local day, padded so it sorts', () => {
    expect(todayNoteTitle(day)).toBe('2026-11-09');
  });
  it('is found only in the Journal, by that title', () => {
    const page = { title: '2026-11-09', path: 'Journal/2026-11-09.md' };
    expect(findTodayNote([{ name: 'Notes', pages: [{ title: '2026-11-09', path: 'Notes/2026-11-09.md' }] }], day)).toBeUndefined();
    expect(findTodayNote([{ name: JOURNAL, pages: [{ title: '2026-11-08', path: 'x' }, page] }], day)).toBe(page);
  });
});
