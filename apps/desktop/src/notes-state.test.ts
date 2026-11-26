import { describe, expect, it } from 'vitest';
import { findTodayNote, JOURNAL, liveTitle, nearestPage, onPageChanged, statusText, todayNoteTitle } from './notes-state';

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

describe('the page opened when the open one has gone', () => {
  const pg = (path: string) => ({ path });
  const home = { name: 'Home', pages: [pg('Home/D.md')] };
  const before = [{ name: 'Work', pages: [pg('Work/A.md'), pg('Work/B.md'), pg('Work/C.md')] }, home];
  it('is the one now in its place in the same notebook', () => {
    expect(nearestPage(before, [{ name: 'Work', pages: [pg('Work/A.md'), pg('Work/C.md')] }, home], 'Work/B.md')?.path).toBe('Work/C.md');
  });
  it('is the one before it when it was last', () => {
    expect(nearestPage(before, [{ name: 'Work', pages: [pg('Work/A.md'), pg('Work/B.md')] }, home], 'Work/C.md')?.path).toBe('Work/B.md');
  });
  it('is a page in another notebook when its own is empty, and none when nothing is left', () => {
    expect(nearestPage(before, [{ name: 'Work', pages: [] }, home], 'Work/A.md')?.path).toBe('Home/D.md');
    expect(nearestPage(before, [{ name: 'Work', pages: [] }], 'Work/A.md')).toBeNull();
  });
  it('works when the page was new and not yet listed before', () => {
    expect(nearestPage([], [{ name: 'Work', pages: [pg('Work/A.md')] }], 'Work/New.md')?.path).toBe('Work/A.md');
  });
});
