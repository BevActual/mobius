import { describe, expect, it } from 'vitest';
import { diffCounts, diffLines } from './line-diff';

describe('line diff', () => {
  it('marks added and removed lines and keeps the rest', () => {
    const lines = diffLines('# Plan\n- one\n- two\n', '# Plan\n- one\n- 2\n- three\n');
    expect(lines).toEqual([
      { kind: 'same', text: '# Plan' },
      { kind: 'same', text: '- one' },
      { kind: 'removed', text: '- two' },
      { kind: 'added', text: '- 2' },
      { kind: 'added', text: '- three' },
      { kind: 'same', text: '' },
    ]);
    expect(diffCounts(lines)).toEqual({ added: 2, removed: 1 });
  });
  it('treats a new page as all added', () => {
    expect(diffCounts(diffLines('', 'a\nb'))).toEqual({ added: 2, removed: 1 });
  });
});
