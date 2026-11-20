import { describe, expect, it } from 'vitest';
import { clipboardQuery, findCopied } from './launcher-clipboard';

describe('clipboard history', () => {
  it('is asked for by "clipboard", "clip" or "cb", with words to look for after', () => {
    expect(clipboardQuery('clipboard')).toEqual({ words: '' });
    expect(clipboardQuery('cb invoice 42')).toEqual({ words: 'invoice 42' });
    expect(clipboardQuery('Clip')).toEqual({ words: '' });
    expect(clipboardQuery('clips of the band')).toBeNull();
    expect(clipboardQuery('cbx')).toBeNull();
  });
  it('finds the copies holding every word, newest first', () => {
    const entries = [{ text: 'Invoice 42 for Axion', at: 3 }, { text: 'invoice 41', at: 2 }, { text: 'hello', at: 1 }];
    expect(findCopied(entries, 'invoice').map((e) => e.at)).toEqual([3, 2]);
    expect(findCopied(entries, 'axion 42').map((e) => e.at)).toEqual([3]);
    expect(findCopied(entries, '')).toHaveLength(3);
  });
});
