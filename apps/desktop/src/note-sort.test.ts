import { describe, expect, it } from 'vitest';
import { sortPages } from './note-sort';

const pages = [
  { path: 'W/b.md', title: 'beta', modified: 30, created: 5 },
  { path: 'W/a.md', title: 'Alpha', modified: 10, created: 20 },
  { path: 'W/c.md', title: 'Note 10', modified: 20 },
  { path: 'W/d.md', title: 'Note 9', modified: 5, created: 1 },
];
const order = (by: Parameters<typeof sortPages>[1], pinned?: Set<string>) => sortPages(pages, by, pinned).map((p) => p.title);

describe('a notebook’s notes', () => {
  it('list by last edit, by when they were made, or by title', () => {
    expect(order('edited')).toEqual(['beta', 'Note 10', 'Alpha', 'Note 9']);
    // A note with no made time counts from its last edit.
    expect(order('created')).toEqual(['Alpha', 'Note 10', 'beta', 'Note 9']);
    // A to Z without regard to case, and Note 9 before Note 10.
    expect(order('title')).toEqual(['Alpha', 'beta', 'Note 9', 'Note 10']);
  });
  it('put pinned notes first, in the same order', () => {
    expect(order('title', new Set(['W/d.md', 'W/b.md']))).toEqual(['beta', 'Note 9', 'Alpha', 'Note 10']);
  });
});
