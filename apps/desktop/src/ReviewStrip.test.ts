import { describe, expect, it } from 'vitest';
import { describeChange } from './ReviewStrip';

describe('review strip names', () => {
  it('names notes, task lists and other files', () => {
    expect(describeChange('notes/Design/Split view.md')).toEqual({ kind: 'Note', name: 'Design / Split view' });
    expect(describeChange('tasks/This week.md')).toEqual({ kind: 'Tasks', name: 'This week' });
    expect(describeChange('drafts/plan.txt')).toEqual({ kind: 'File', name: 'drafts/plan.txt' });
  });
});
