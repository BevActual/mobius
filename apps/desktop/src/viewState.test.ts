import { describe, expect, it } from 'vitest';
import { settleViewState } from './viewState';

/** A Storage in memory, in insertion order as the web view's is. */
function memory(): Storage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, String(v)); },
    removeItem: (k: string) => { map.delete(k); },
    clear: () => map.clear(),
  };
}

describe('view state per set of data', () => {
  it('keeps what was there with the first profile opened', () => {
    const s = memory();
    s.setItem('mobius.calendar.hidden', '["Work"]');
    settleViewState(s, 'personal');
    expect(s.getItem('mobius.calendar.hidden')).toBe('["Work"]');
  });
  it('a demo opens with nothing hidden, and Personal gets its own back (round 22)', () => {
    const s = memory();
    settleViewState(s, 'personal');
    s.setItem('mobius.calendar.hidden', '["Work","Home","Calendar"]');
    s.setItem('other.thing', 'kept');
    settleViewState(s, 'demo-1');
    expect(s.getItem('mobius.calendar.hidden')).toBeNull();
    expect(s.getItem('other.thing')).toBe('kept');
    s.setItem('mobius.sheets.last', 'Sales');
    settleViewState(s, 'personal');
    expect(s.getItem('mobius.calendar.hidden')).toBe('["Work","Home","Calendar"]');
    expect(s.getItem('mobius.sheets.last')).toBeNull();
    settleViewState(s, 'personal');
    expect(s.getItem('mobius.calendar.hidden')).toBe('["Work","Home","Calendar"]');
  });
  it('a reset demo is a new set of data, and old shelves are let go', () => {
    const s = memory();
    settleViewState(s, 'personal');
    for (let i = 0; i < 12; i++) { s.setItem('mobius.sheets.last', `Sheet ${i}`); settleViewState(s, `demo-${i}`); }
    expect(s.getItem('mobius.sheets.last')).toBeNull();
    const shelves = Array.from({ length: s.length }, (_, i) => s.key(i)).filter((k) => k?.startsWith('mobius@'));
    expect(shelves.length).toBeLessThanOrEqual(8);
  });
});
