import { describe, expect, it } from 'vitest';
import { withLive } from './liveMarks';
import { marksOf } from './useTurnChanges';

describe('the running turn\'s marks', () => {
  it('adds the files changed so far to the last turn\'s marks, once each', () => {
    const last = marksOf(['tasks/Inbox.md']);
    const live = withLive(last, ['tasks/Inbox.md', 'calendar/Work.ics', 'tasks/Offsite.md']);
    expect([...live.lists].sort()).toEqual(['Inbox', 'Offsite']);
    expect([...live.calendars]).toEqual(['Work']);
    expect(live.files).toEqual(['tasks/Inbox.md', 'calendar/Work.ics', 'tasks/Offsite.md']);
  });
  it('keeps the same marks while the turn has said nothing', () => {
    const last = marksOf(['notes/Plan.md']);
    expect(withLive(last, [])).toBe(last);
  });
});
