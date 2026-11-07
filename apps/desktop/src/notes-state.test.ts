import { describe, expect, it } from 'vitest';
import { liveTitle, onPageChanged, statusText } from './notes-state';

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
