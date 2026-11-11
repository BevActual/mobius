import { describe, expect, it } from 'vitest';
import { hereOf, withSelection } from './surface';

describe('what is open goes with the message', () => {
  it('names the open item the way the panel says it', () => {
    const sheet = hereOf({ app: 'sheets', hasPage: false, note: null, sheet: { title: 'Kestrel › Costs', source: 'sheets/Kestrel/Costs.csv', text: 'D2: 1200' } });
    expect([sheet?.what, sheet?.label, sheet?.item?.source]).toEqual(['this sheet', 'Kestrel › Costs', 'sheets/Kestrel/Costs.csv']);
    expect(hereOf({ app: 'docs', hasPage: false, note: { path: 'P2.md', title: 'P2', text: '# P2', folder: 'docs' } })?.what).toBe('this document');
    expect(hereOf({ app: 'browser', hasPage: true, note: null })).toMatchObject({ what: 'this page', item: null });
  });
  it('an app with nothing open sends nothing', () => {
    expect(hereOf({ app: 'sheets', hasPage: false, note: null, sheet: null })).toBeNull();
    expect(hereOf({ app: 'calendar', hasPage: false, note: null })).toBeNull();
  });
  it('says what is chosen in it: cells by name, words in quotes', () => {
    const item = { kind: 'file' as const, title: 'Costs', source: 'sheets/K/Costs.csv', text: 'D2: 1200' };
    expect(withSelection(item, 'D2').text).toBe('Selected: D2\n\nD2: 1200');
    expect(withSelection(item, 'B2:D9').text.startsWith('Selected: B2:D9')).toBe(true);
    expect(withSelection(item, 'the brake kit').text.startsWith('Selected text: "the brake kit"')).toBe(true);
    expect(withSelection(item, null)).toBe(item);
  });
});
