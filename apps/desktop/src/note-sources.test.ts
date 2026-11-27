import { describe, expect, it } from 'vitest';
import type { Notebook } from '@mobius/shared';
import { citeWhenOpen, citedLines, listForSource, noteForSource, pageForSource, takeCite } from './note-sources';

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

describe('what else a fact came from', () => {
  it('is a page of the app the source names, by title and folder', () => {
    expect(pageForSource('Docs · Offsite', 'Docs', notebooks)?.page.path).toBe('Home/Offsite.md');
    expect(pageForSource('Knowledge · Work · Offsite', 'Knowledge', notebooks)?.page.path).toBe('Work/Offsite.md');
    expect(pageForSource('Notes · Offsite', 'Docs', notebooks)).toBeNull();
  });
  it('is a task list named after Tasks', () => {
    expect(listForSource('Tasks · errands', ['Inbox', 'Errands'])).toBe('Errands');
    expect(listForSource('Tasks · Errands · Milk', ['Errands'])).toBeNull();
    expect(listForSource('Docs · Errands', ['Errands'])).toBeNull();
  });
});

describe('the lines a fact was taken from', () => {
  const lines = ['Offsite planning', 'The offsite is at the lake lodge on March 4.', 'Budget is still open.', 'Lodge holds 8 people.'];
  it('are the ones holding the most of its words', () => {
    expect(citedLines(lines, 'The offsite is on March 4')).toEqual([1]);
    expect(citedLines(lines, '8 people at the lodge')).toEqual([3]);
  });
  it('are none when no line holds half of its words, so the wrong line is never tinted', () => {
    expect(citedLines(lines, 'The catering costs $400 per head')).toEqual([]);
    expect(citedLines(lines, 'the of a')).toEqual([]);
  });
  it('wait for their note once, and only for that note', () => {
    citeWhenOpen('Work/Offsite.md', 'March 4');
    expect(takeCite('Home/Garden.md')).toBeNull();
    expect(takeCite('Work/Offsite.md')).toBe('March 4');
    expect(takeCite('Work/Offsite.md')).toBeNull();
  });
});
