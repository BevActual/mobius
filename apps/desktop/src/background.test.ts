import { describe, expect, it } from 'vitest';
import { addRun, doneText, dropRun, stopRun } from './background';

describe('work handed off to the background', () => {
  it('keeps one run per chat, the newest', () => {
    const runs = addRun(addRun([], { conversation: 'c-1', ask: 'Tidy my notes', at: 1 }), { conversation: 'c-2', ask: 'Plan the week', at: 2 });
    expect(addRun(runs, { conversation: 'c-1', ask: 'Tidy them again', at: 3 }).map((r) => r.ask)).toEqual(['Plan the week', 'Tidy them again']);
    expect(dropRun(runs, 'c-1').map((r) => r.conversation)).toEqual(['c-2']);
  });

  it('says how many changes wait to be kept, leaving out comments', () => {
    expect(doneText([])).toBe('Finished in the background');
    expect(doneText(['notes/A.md'])).toBe('Finished in the background · 1 change to keep');
    expect(doneText(['notes/A.md', 'tasks/Inbox.md', '.comments/notes/A.md.json'])).toBe('Finished in the background · 2 changes to keep');
    // A run stopped, or failed, does not say it finished.
    expect(doneText([], { stopped: true })).toBe('Stopped before it finished');
    expect(doneText(['notes/A.md'], { stopped: true })).toBe('Stopped before it finished · 1 change to keep');
    expect(doneText([], { failed: true })).toBe('Did not finish: something went wrong');
  });
  it('marks only the stopped run', () => {
    const runs = [{ conversation: 'c-1', ask: 'A', at: 1 }, { conversation: 'c-2', ask: 'B', at: 2 }];
    expect(stopRun(runs, 'c-2')).toEqual([{ conversation: 'c-1', ask: 'A', at: 1 }, { conversation: 'c-2', ask: 'B', at: 2, stopped: true }]);
  });
});
