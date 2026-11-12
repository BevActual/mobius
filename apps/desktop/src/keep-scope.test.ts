import { beforeEach, describe, expect, it } from 'vitest';
import { appsOf, fileKept, keepTurn, keptTurns } from './ReviewStrip';

// A window with storage, as the app has (the tests run without one).
beforeEach(() => {
  const store = new Map<string, string>();
  (globalThis as { window?: unknown }).window = {
    localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) },
    dispatchEvent: () => true,
  };
  (globalThis as { CustomEvent?: unknown }).CustomEvent ??= class { constructor(public type: string) {} };
});

describe('Keep on an app bar keeps only that app\'s changes', () => {
  const turn = 'c1:abc';
  const files = ['tasks/P2 build.md', 'calendar/Work.ics', 'sheets/Kestrel/Costs.csv'];
  it('Tasks keeps the tasks; the calendar and the sheet are still to be reviewed', () => {
    keepTurn(turn, 'tasks');
    expect(files.map((f) => fileKept(turn, f))).toEqual([true, false, false]);
    expect(keptTurns('tasks')).toContain(turn);
    expect(keptTurns('slides')).not.toContain(turn);
    expect(keptTurns()).not.toContain(turn);
  });
  it('Slides keeping its slides leaves the Docs bar alone', () => {
    keepTurn(turn, 'slides');
    expect(keptTurns('docs')).not.toContain(turn);
    expect(fileKept(turn, 'docs/P2.md')).toBe(false);
  });
  it('keeping the whole turn keeps everything, for every app', () => {
    keepTurn(turn);
    expect(files.every((f) => fileKept(turn, f))).toBe(true);
    expect(keptTurns('docs')).toContain(turn);
  });
  it('a whole-turn Keep names the apps it covers', () => {
    expect(appsOf(files)).toEqual(['Tasks', 'Calendar', 'Sheets']);
  });
});

import { scopeOf } from './ReviewStrip';
describe('a file belongs to the app that shows it', () => {
  it('by its folder', () => {
    expect(['tasks/P2 build.md', 'docs/P2.md', 'boards/Plan.json', 'drafts/x.txt'].map(scopeOf)).toEqual(['tasks', 'docs', 'canvas', 'all']);
  });
});
