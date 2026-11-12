import { describe, expect, it } from 'vitest';
import { appOf, countByApp, dayOf, filterTurns, gatherTurns } from './review-view';

const turn = (start: string, when: number, files: string[]) => ({ start, ended: true, when, ask: `ask ${start}`, files });

describe('review', () => {
  it('gathers turns that changed something, newest first, with their conversation', () => {
    const turns = new Map([
      ['c1', [turn('a', 100, ['notes/Trip/Plan.md']), turn('b', 300, [])]],
      ['c2', [turn('c', 200, ['boards/Offsite/Ideas.json', 'notes/Trip/Plan.md'])]],
    ]);
    const all = gatherTurns([{ id: 'c1', title: 'Trip' }, { id: 'c2', title: '' }], turns);
    expect(all.map((t) => [t.start, t.title])).toEqual([['c', 'Conversation'], ['a', 'Trip']]);
    expect(filterTurns(all, 'canvas').map((t) => t.files)).toEqual([['boards/Offsite/Ideas.json']]);
    expect(filterTurns(all, 'notes')).toHaveLength(2);
    expect([...countByApp(all)]).toEqual([['canvas', 1], ['notes', 2]]);
  });

  it('knows each file\'s app and names the day', () => {
    expect(appOf('databases/Trips.sqlite')).toBe('database');
    expect(appOf('reading/Reading list/A.md')).toBe('reader');
    expect(appOf('elsewhere/x')).toBeNull();
    const now = new Date(2026, 10, 8, 12);
    expect(dayOf(new Date(2026, 10, 8, 1).getTime(), now)).toBe('Today');
    expect(dayOf(new Date(2026, 10, 7, 23).getTime(), now)).toBe('Yesterday');
  });
});
