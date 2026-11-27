import { describe, expect, it } from 'vitest';
import type { CodeProblem } from '@mobius/shared';
import { around, fixPrompt, problemAt, reviewPrompt } from './code-mobius';

const p = (o: Partial<CodeProblem>): CodeProblem => ({ line: 0, character: 0, endLine: 0, endCharacter: 1, severity: 'error', message: 'x', ...o });

describe('Code asks Mobius', () => {
  it('shows the lines around a problem, numbered, its own marked', () => {
    const text = Array.from({ length: 20 }, (_, i) => `l${i + 1}`).join('\n');
    expect(around(text, 9, 2)).toBe('   8 | l8\n   9 | l9\n› 10 | l10\n  11 | l11\n  12 | l12');
    expect(around('a\nb', 0, 3)).toBe('› 1 | a\n  2 | b');
  });

  it('asks for a fix with the problem, its place and code, fenced past any backticks in it', () => {
    const text = 'const a = `x`\nconst b: number = "two"\n';
    const prompt = fixPrompt('site', 'src/a.ts', text, p({ line: 1, character: 6, message: "Type 'string' is not assignable\nto type 'number'.", source: 'ts', code: 2322 }));
    expect(prompt).toContain('Fix this error in src/a.ts of the Code project "site", line 2, column 7 (ts 2322):');
    expect(prompt).toContain("> Type 'string' is not assignable\n> to type 'number'.");
    expect(prompt).toContain('The TypeScript around it');
    expect(prompt).toContain('```\n  1 | const a = `x`\n› 2 | const b: number = "two"\n  3 | \n```');
  });

  it('asks for a review of the diff, saying when it was cut, and never to change files', () => {
    const prompt = reviewPrompt('site', 'main', 'diff --git a/a b/a\n-x\n+y\n', true);
    expect(prompt).toContain('Review my changes in the Code project "site" on the branch main');
    expect(prompt).toContain('```diff\ndiff --git a/a b/a\n-x\n+y\n```');
    expect(prompt).toContain('The diff was cut for length');
    expect(prompt).toContain('Do not change any files.');
    expect(reviewPrompt('site', '', 'd', false)).not.toContain('cut for length');
  });

  it('finds the problem at the caret, else the worst on its line', () => {
    const warn = p({ line: 3, character: 2, endLine: 3, endCharacter: 6, severity: 'warning' });
    const err = p({ line: 3, character: 10, endLine: 3, endCharacter: 14 });
    expect(problemAt([warn, err], 3, 4)).toBe(warn);
    expect(problemAt([warn, err], 3, 20)).toBe(err);
    expect(problemAt([warn, err], 4, 0)).toBeNull();
  });
});
