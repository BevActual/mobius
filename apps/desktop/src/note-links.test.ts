import { describe, expect, it } from 'vitest';
import { linkTo, linkedFrom, linksIn, pageOfLink, pagesMatching } from './note-links';

const books = [
  { name: 'Work', pages: [{ path: 'Work/Plan.md', title: 'Plan', modified: 3, links: ['Home/Groceries.md'] }, { path: 'Work/Supplier notes.md', title: 'Supplier notes', modified: 5, links: ['Work/Plan.md', 'Home/Groceries.md'] }] },
  { name: 'Home', pages: [{ path: 'Home/Groceries.md', title: 'Groceries', modified: 1 }] },
];

describe('links between notes', () => {
  it('reads a link the way the Rust list does', () => {
    expect(pageOfLink('Supplier%20notes.md', 'Work/Plan.md')).toBe('Work/Supplier notes.md');
    expect(pageOfLink('../Home/Groceries.md', 'Work/Plan.md')).toBe('Home/Groceries.md');
    expect(pageOfLink('<Plan.md>', 'Work/X.md')).toBe('Work/Plan.md');
    for (const bad of ['https://x.example/a.md', '../../etc/x.md', '/x.md', 'Plan%20files/q.pdf', '../a/b/c.md', 'C:/x.md']) expect(pageOfLink(bad, 'Work/Plan.md')).toBeNull();
  });
  it('writes a link that goes back to the same page', () => {
    for (const [from, to] of [['Work/Plan.md', 'Work/Supplier notes.md'], ['Work/Plan.md', 'Home/Groceries.md']] as const) {
      expect(pageOfLink(linkTo(from, to), from)).toBe(to);
    }
    expect(linkTo('Work/Plan.md', 'Work/Supplier notes.md')).toBe('Supplier%20notes.md');
  });
  it('lists the pages that link here, newest first, and finds pages by title', () => {
    expect(linkedFrom(books, 'Home/Groceries.md').map((p) => p.title)).toEqual(['Supplier notes', 'Plan']);
    expect(linkedFrom(books, 'Work/Supplier notes.md')).toEqual([]);
    expect(pagesMatching(books, 'pl', 'Work/Supplier notes.md').map((p) => p.title)).toEqual(['Plan']);
    expect(pagesMatching(books, '', 'Work/Plan.md').map((p) => p.title)).toEqual(['Supplier notes', 'Groceries']);
  });
  it('finds the links in a page as the Rust list does', () => {
    const page = '# Plan\n\nSee [the notes](Supplier%20notes.md), [groceries](../Home/Groceries.md) and [again](<Supplier notes.md>).\nNot [the web](https://x.example/a.md), ![a picture](Plan%20files/a.md), `[code](Code.md)` or [self](Plan.md).\n```\n[fenced](Fenced.md)\n```\n';
    expect(linksIn(page, 'Work/Plan.md')).toEqual(['Work/Supplier notes.md', 'Home/Groceries.md']);
  });
});
