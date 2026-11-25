import { describe, expect, it } from 'vitest';
import type { Notebook } from '@mobius/shared';
import { recentNotes } from './note-quick-open';

const page = (nb: string, title: string, modified: number) => ({ path: `${nb}/${title}.md`, title, modified, preview: '', tags: [], links: [] });
const books = [
  { name: 'Work', pages: [page('Work', 'Launch brief', 3), page('Work', 'Budget', 5)] },
  { name: 'Home', pages: [page('Home', 'Groceries', 4), page('Home', 'Garden', 2)] },
] as unknown as Notebook[];

describe('recentNotes', () => {
  it('lists the notes edited last, newest first, with the open one at the end', () => {
    expect(recentNotes(books, 'Work/Budget.md').map((r) => r.title)).toEqual(['Groceries', 'Launch brief', 'Garden', 'Budget']);
    expect(recentNotes(books, undefined, 2)).toEqual([
      { path: 'Work/Budget.md', title: 'Budget', notebook: 'Work' },
      { path: 'Home/Groceries.md', title: 'Groceries', notebook: 'Home' },
    ]);
  });
});
