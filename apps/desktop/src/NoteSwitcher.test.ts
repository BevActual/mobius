import { describe, expect, it } from 'vitest';
import type { Notebook } from '@mobius/shared';
import { rankNotes } from './NoteSwitcher';

const page = (nb: string, title: string, modified: number) => ({ path: `${nb}/${title}.md`, title, modified, preview: '', tags: [], links: [] });
const books = [
  { name: 'Work', pages: [page('Work', 'Launch brief', 3), page('Work', 'Budget', 5), page('Work', 'Board notes', 1)] },
  { name: 'Home', pages: [page('Home', 'Groceries', 4), page('Home', 'Garden', 2)] },
] as unknown as Notebook[];
const titles = (rows: { title: string }[]) => rows.map((r) => r.title);

describe('rankNotes', () => {
  it('lists the notes edited last when nothing is typed, the open one at the end', () => {
    expect(titles(rankNotes(books, '', 'Work/Budget.md'))).toEqual(['Groceries', 'Launch brief', 'Garden', 'Board notes', 'Budget']);
  });
  it('finds a note by letters of its title in order, a start of a word first', () => {
    expect(titles(rankNotes(books, 'lb', undefined))).toEqual(['Launch brief']);
    expect(titles(rankNotes(books, 'b', undefined))[0]).toBe('Budget');
    expect(titles(rankNotes(books, 'brief', undefined))).toEqual(['Launch brief']);
    expect(rankNotes(books, 'zebra', undefined)).toEqual([]);
  });
  it('also matches the notebook with the title, behind a match in the title alone', () => {
    expect(titles(rankNotes(books, 'home gar', undefined))).toEqual(['Garden']);
    expect(rankNotes(books, 'home gar', undefined)[0]).toEqual({ path: 'Home/Garden.md', title: 'Garden', notebook: 'Home' });
  });
});
