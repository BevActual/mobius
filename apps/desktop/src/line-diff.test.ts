import { describe, expect, it } from 'vitest';
import { changeGroups, diffCounts, diffLines, undoGroup } from './line-diff';

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

describe('undoing one change', () => {
  const lines = diffLines('# Plan\n- one\n- two\n\nEnd\n', '# Plan\n- 1\n- two\n\nEnd\n- more\n');
  it('groups neighbouring added and removed lines into one change', () => {
    expect(changeGroups(lines)).toEqual([null, 0, 0, null, null, null, 1, null]);
  });
  it('puts back only the chosen change', () => {
    expect(undoGroup(lines, 0)).toBe('# Plan\n- one\n- two\n\nEnd\n- more\n');
    expect(undoGroup(lines, 1)).toBe('# Plan\n- 1\n- two\n\nEnd\n');
  });
});
