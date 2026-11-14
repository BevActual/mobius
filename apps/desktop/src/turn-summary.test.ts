import { describe, expect, it } from 'vitest';
import { countOf, groupByApp } from './ReviewStrip';

describe('the turn summary', () => {
  it('has one row per app, in the order the apps first appear', () => {
    const groups = groupByApp([{ app: 'Tasks', n: 1 }, { app: 'Calendar', n: 2 }, { app: 'Tasks', n: 3 }]);
    expect(groups.map((g) => [g.app, g.entries.map((e) => e.n)])).toEqual([['Tasks', [1, 3]], ['Calendar', [2]]]);
  });

  it('counts an app\'s changes by what they are', () => {
    expect(countOf([{ count: 1, unit: 'event' }, { count: 2, unit: 'event' }])).toBe('3 events');
    expect(countOf([{ count: 2, unit: 'page' }, { count: 1, unit: 'sheet' }])).toBe('2 pages, 1 sheet');
    expect(countOf([{ count: 2, unit: 'draft reply' }])).toBe('2 draft replies');
  });
});
