import { describe, expect, it } from 'vitest';
import { remindAt, remindChoice, remindDay, waitingOn } from './mail-follow-ups';

describe('Remind if no reply', () => {
  const now = new Date(2026, 10, 21, 15, 30);
  it('lands at 9:00 on the day picked', () => {
    const at = new Date(remindAt(3, now));
    expect([at.getDate(), at.getHours(), at.getMinutes()]).toEqual([24, 9, 0]);
    expect(remindChoice(remindAt(7, now), now)).toBe(7);
    expect(remindChoice(null, now)).toBeNull();
  });
  it('says the day the way the button reads', () => {
    expect(remindDay(remindAt(1, now), now)).toBe('Tomorrow');
    expect(remindDay(remindAt(10, now), now)).toMatch(/1 Dec|Dec 1/);
  });
  it('names who it waits on by first name', () => {
    expect(waitingOn(['Priya Nair <priya@x.org>'])).toBe('Priya');
    expect(waitingOn(['sam@x.org', 'Lee <lee@x.org>', 'b@x.org'])).toBe('sam and 2 others');
    expect(waitingOn([])).toBe('anyone');
  });
});
