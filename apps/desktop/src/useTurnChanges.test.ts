import { describe, expect, it } from 'vitest';
import { marksOf } from './useTurnChanges';

describe('turn marks', () => {
  it('turns workspace files into note pages and task lists', () => {
    const marks = marksOf(['notes/Design/Split view.md', 'tasks/This week.md', 'drafts/plan.txt']);
    expect([...marks.notes]).toEqual(['Design/Split view.md']);
    expect([...marks.lists]).toEqual(['This week']);
  });
});
