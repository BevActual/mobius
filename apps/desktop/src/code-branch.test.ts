import { describe, expect, it } from 'vitest';
import { branchName, startBranch, takeBranchName } from './code-branch';

describe('a task starts its branch', () => {
  it('makes a branch name of the task’s words', () => {
    expect(branchName('Fix the split: cents add up!')).toBe('fix-the-split-cents-add-up');
    expect(branchName('Café menü über')).toBe('cafe-menu-uber');
    expect(branchName('  ...  ')).toBe('new-branch');
    const long = branchName('Make the budget page show every person’s share with the rounding explained clearly');
    expect(long.length).toBeLessThanOrEqual(48);
    expect(long).toBe('make-the-budget-page-show-every-person-s-share');
  });
  it('keeps the name for Code once', () => {
    startBranch('Split cents');
    expect(takeBranchName()).toBe('split-cents');
    expect(takeBranchName()).toBeNull();
  });
});
