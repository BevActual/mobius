import { describe, expect, it } from 'vitest';
import type { Notebook } from '@mobius/shared';
import { noteForSource } from './note-sources';

const page = (path: string, title: string, modified: number) => ({ path, title, modified });
const notebooks: Notebook[] = [
  { name: 'Work', pages: [page('Work/Offsite.md', 'Offsite', 10), page('Work/Hiring.md', 'Hiring', 5)] },
  { name: 'Home', pages: [page('Home/Offsite.md', 'Offsite', 20), page('Home/Garden.md', 'Garden', 1)] },
];

describe('the note a fact came from', () => {
  it('is found by its title, the one changed last when two share it', () => {
    expect(noteForSource('Notes · Hiring', notebooks)?.page.path).toBe('Work/Hiring.md');
    expect(noteForSource('Notes · Offsite', notebooks)?.page.path).toBe('Home/Offsite.md');
    expect(noteForSource('notes · garden ', notebooks)?.notebook).toBe('Home');
  });
  it('is looked for in the notebook the source names', () => {
    expect(noteForSource('Notes · Work · Offsite', notebooks)?.page.path).toBe('Work/Offsite.md');
    expect(noteForSource('Notes · Home · Hiring', notebooks)).toBeNull();
  });
  it('is none for another app, a note that is gone, or a bare source', () => {
    for (const source of ['Calendar · Offsite', 'Notes · Budget', 'Notes', 'Notes · ', '']) expect(noteForSource(source, notebooks)).toBeNull();
  });
});
