import { describe, expect, it } from 'vitest';
import { applyGroups, changeGroups, gitMark, gitMarks, highlight, langOf, lineDiff, parentsOf, testLineKind } from './code-view';

const OLD = `import { Share } from './types'

export function splitTotal(total: number, people: number): Share[] {
  const cents = Math.round(total * 100)
  const each = cents / people
  return Array.from({ length: people }, () => Math.round(each) / 100)
}
`;
const NEW = `import { Share } from './types'

export function splitTotal(total: number, people: number): Share[] {
  const cents = Math.round(total * 100)
  const each = Math.floor(cents / people)
  const extra = cents - each * people
  return Array.from({ length: people }, (_, i) => (each + (i < extra ? 1 : 0)) / 100)
}
`;

describe('code', () => {
  it('knows a file by its name', () => {
    expect(langOf('src/budget.ts')).toBe('ts');
    expect(langOf('main.rs')).toBe('rust');
    expect(langOf('README')).toBe('plain');
    expect(parentsOf('src/lib/a.ts')).toEqual(['src', 'src/lib']);
  });

  it('colours keywords, types, calls, strings, numbers and comments', () => {
    expect(highlight("export function splitTotal(total: number) { // why", 'ts')).toEqual([
      { t: 'export', k: 'kw' }, { t: ' ', k: 'plain' }, { t: 'function', k: 'kw' }, { t: ' ', k: 'plain' }, { t: 'splitTotal', k: 'fn' },
      { t: '(total: ', k: 'plain' }, { t: 'number', k: 'type' }, { t: ') { ', k: 'plain' }, { t: '// why', k: 'com' },
    ]);
    expect(highlight("x = 'a # b' # c", 'py').map((t) => t.k)).toEqual(['plain', 'str', 'plain', 'com']);
    expect(highlight('let n = 100_000;', 'rust').find((t) => t.k === 'num')?.t).toBe('100_000');
    expect(highlight('v2 = 3', 'ts').filter((t) => t.k === 'num').map((t) => t.t)).toEqual(['3']);
  });

  it('shows what changed line by line, and keeps or puts back each change', () => {
    const rows = lineDiff(OLD, NEW);
    expect(rows.filter((r) => r.kind === 'del').map((r) => r.text.trim())).toEqual(['const each = cents / people', 'return Array.from({ length: people }, () => Math.round(each) / 100)']);
    expect(rows.filter((r) => r.kind === 'add')).toHaveLength(3);
    expect(rows[rows.length - 1]).toEqual({ kind: 'same', text: '}', n: 8 });
    expect(changeGroups(rows)).toEqual([[4, 8]]);
    expect(applyGroups(rows, new Set([0]), true)).toBe(NEW);
    expect(applyGroups(rows, new Set(), true)).toBe(OLD);
    const two = lineDiff('a\nb\nc\nd\n', 'A\nb\nc\nD\n');
    expect(changeGroups(two)).toHaveLength(2);
    expect(applyGroups(two, new Set([1]), true)).toBe('a\nb\nc\nD\n');
    expect(lineDiff('', 'x\n')).toEqual([{ kind: 'add', text: 'x', n: 1 }]);
  });

  it('reads test output as passed or failed', () => {
    expect(testLineKind('  ✓ splits 5420 across 7')).toBe('pass');
    expect(testLineKind(' ✕ shares always add back to the total')).toBe('fail');
    expect(testLineKind('test result: ok. 3 passed; 0 failed')).toBe('pass');
    expect(testLineKind('Tests  1 failed | 1 passed (2)')).toBe('fail');
    expect(testLineKind('running 3 tests')).toBe('plain');
  });
});

describe('git marks', () => {
  it('reads porcelain status letters as Xcode marks them', () => {
    expect(gitMark('M').letter).toBe('M');
    expect(gitMark('MM').letter).toBe('M');
    expect(gitMark('AM').letter).toBe('A');
    expect(gitMark('D').letter).toBe('D');
    expect(gitMark('R').letter).toBe('R');
    expect(gitMark('??')).toEqual({ letter: '?', label: 'Not tracked by git yet' });
    expect(gitMark('UU').letter).toBe('C');
  });
  it('marks a renamed file under its new name', () => {
    const marks = gitMarks([{ status: 'R', path: 'src/old.js -> src/new.js' }, { status: '??', path: 'notes.txt' }]);
    expect([...marks.keys()]).toEqual(['src/new.js', 'notes.txt']);
  });
});
