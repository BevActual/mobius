import { describe, expect, it } from 'vitest';
import { cursorAt, deletePair, findAll, indentLines, langName, lineStart, newLine, rankFiles, toggleComment, typePair, type Edit } from './code-edit';

const apply = (text: string, e: Edit) => `${text.slice(0, e.from)}${e.insert}${text.slice(e.to)}`;

describe('where the cursor is', () => {
  it('counts lines and columns from 1', () => {
    expect(cursorAt('ab\ncd', 0)).toEqual({ line: 1, col: 1 });
    expect(cursorAt('ab\ncd', 4)).toEqual({ line: 2, col: 2 });
    expect(lineStart('ab\ncd\nef', 3)).toBe(6);
    expect(lineStart('ab', 9)).toBe(0);
  });
});

describe('indenting', () => {
  const text = 'a\n  b\nc';
  it('indents every line a selection touches and keeps them selected', () => {
    const e = indentLines(text, 0, 5);
    expect(apply(text, e)).toBe('  a\n    b\nc');
    expect(e.select).toEqual([2, 9]);
  });
  it('outdents, taking no more than a line has', () => {
    const e = indentLines(text, 0, 5, true);
    expect(apply(text, e)).toBe('a\nb\nc');
  });
  it('does not take the next line when the selection ends at its start', () => {
    expect(apply(text, indentLines(text, 0, 2))).toBe('  a\n  b\nc');
  });
});

describe('comments', () => {
  it('comments out lines at their shared indent, and brings them back', () => {
    const text = '  a()\n    b()\n';
    const on = apply(text, toggleComment(text, 0, 10, 'ts')!);
    expect(on).toBe('  // a()\n  //   b()\n');
    expect(apply(on, toggleComment(on, 0, 12, 'ts')!)).toBe(text);
  });
  it('uses # where that is the comment, and nothing where there is none', () => {
    expect(apply('x = 1', toggleComment('x = 1', 0, 0, 'py')!)).toBe('# x = 1');
    expect(toggleComment('{}', 0, 0, 'json')).toBeNull();
  });
});

describe('brackets and quotes', () => {
  it('closes an opener, and steps over the closer when it is typed', () => {
    const e = typePair('f', 1, 1, '(')!;
    expect(apply('f', e)).toBe('f()');
    expect(e.select).toEqual([2, 2]);
    expect(typePair('f()', 2, 2, ')')).toEqual({ from: 2, to: 2, insert: '', select: [3, 3] });
  });
  it('wraps a selection', () => {
    expect(apply('a b', typePair('a b', 2, 3, '"')!)).toBe('a "b"');
  });
  it('leaves quotes inside words alone', () => {
    expect(typePair('it', 2, 2, "'")).toBeNull();
    expect(typePair('x', 0, 0, '(')).toBeNull();
  });
  it('backspace takes an empty pair', () => {
    expect(apply('f()', deletePair('f()', 2, 2)!)).toBe('f');
    expect(deletePair('f(x)', 3, 3)).toBeNull();
  });
  it('enter opens a block between braces and keeps the indent elsewhere', () => {
    const e = newLine('  if (x) {}', 10, 10);
    expect(apply('  if (x) {}', e)).toBe('  if (x) {\n    \n  }');
    expect(e.select).toEqual([15, 15]);
    expect(apply('  a', newLine('  a', 3, 3))).toBe('  a\n  ');
  });
});

describe('finding and quick open', () => {
  it('finds every match, ignoring case unless asked', () => {
    expect(findAll('Ab ab AB', 'ab')).toEqual([[0, 2], [3, 5], [6, 8]]);
    expect(findAll('Ab ab AB', 'ab', true)).toEqual([[3, 5]]);
    expect(findAll('aaa', '')).toEqual([]);
  });
  it('ranks a file by its name first', () => {
    const paths = ['tests/budget.test.js', 'src/budget.js', 'src/money.js', 'README.md'];
    expect(rankFiles('budget', paths)).toEqual(['src/budget.js', 'tests/budget.test.js']);
    expect(rankFiles('mon', paths)[0]).toBe('src/money.js');
    expect(rankFiles('xyz', paths)).toEqual([]);
    expect(rankFiles('', paths)).toHaveLength(4);
  });
  it('names languages as people do', () => {
    expect(langName('src/a.js')).toBe('JavaScript');
    expect(langName('Cargo.toml')).toBe('TOML');
    expect(langName('LICENSE')).toBe('Plain text');
  });
});
