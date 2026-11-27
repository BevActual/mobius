import { describe, expect, it } from 'vitest';
import type { CodeProblem } from '@mobius/shared';
import { fixPrompt, problemAt, reviewRequest } from './code-mobius';

const p = (o: Partial<CodeProblem>): CodeProblem => ({ line: 0, character: 0, endLine: 0, endCharacter: 1, severity: 'error', message: 'x', ...o });

describe('Code asks Mobius', () => {
  it('asks for a fix with the problem and its place, quoting a message of many lines', () => {
    const prompt = fixPrompt('site', 'src/a.ts', p({ line: 1, character: 6, message: "Type 'string' is not assignable\nto type 'number'.", source: 'ts', code: 2322 }));
    expect(prompt).toBe([
      'Fix this error in src/a.ts of the Code project "site", line 2, column 7 (ts 2322):',
      '',
      "> Type 'string' is not assignable\n> to type 'number'.",
      '',
      'Change only what the fix needs, and say in a line what was wrong.',
    ].join('\n'));
    expect(fixPrompt('site', 'a.py', p({ severity: 'warning' }))).toContain('Fix this warning in a.py');
  });

  it('asks for a review with the diff attached, saying when it was cut, and never to change files', () => {
    const { prompt, item } = reviewRequest('site', 'main', 'diff --git a/a b/a\n-x\n+y\n', true);
    expect(prompt).toContain('Review my changes in the Code project "site" on the branch main');
    expect(prompt).toContain('The diff was cut for length');
    expect(prompt).toContain('Do not change any files.');
    expect(item).toEqual({ kind: 'file', title: 'Changes since the last commit', source: 'site (git diff)', text: 'diff --git a/a b/a\n-x\n+y\n' });
    expect(reviewRequest('site', '', 'd', false).prompt).not.toContain('cut for length');
  });

  it('finds the problem at the caret, else the worst on its line', () => {
    const warn = p({ line: 3, character: 2, endLine: 3, endCharacter: 6, severity: 'warning' });
    const err = p({ line: 3, character: 10, endLine: 3, endCharacter: 14 });
    expect(problemAt([warn, err], 3, 4)).toBe(warn);
    expect(problemAt([warn, err], 3, 20)).toBe(err);
    expect(problemAt([warn, err], 4, 0)).toBeNull();
  });
});
