import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setLocaleForTests } from './dates';
import { agoLabel, deskGreeting, deskTitle, nextRun, recent, upcoming, whenLabel } from './desk-view';

// Monday 9 November 2026, 19:30.
const now = new Date(2026, 10, 9, 19, 30);
const schedule = (time: string, days: number[], enabled = true) => ({ id: time, title: `At ${time}`, prompt: 'p', time, days, enabled, lastRunMs: null });

describe('desk', () => {
  beforeEach(() => setLocaleForTests('en-GB'));
  afterEach(() => setLocaleForTests(null));

  it('greets for the time of day', () => {
    expect(deskGreeting(now)).toBe('Good evening');
    expect(deskGreeting(new Date(2026, 10, 10, 8))).toBe('Good morning');
    expect(deskGreeting(new Date(2026, 10, 10, 14))).toBe('Good afternoon');
    expect(deskGreeting(new Date(2026, 10, 10, 2))).toBe('Good evening');
  });

  it('the line under it names the date, then only the counts that are not zero', () => {
    expect(deskTitle(now, { waiting: 0, working: 0, changed: 0 })).toEqual(['Monday 9 November']);
    expect(deskTitle(now, { waiting: 2, working: 1, changed: 1 })).toEqual(['Monday 9 November', '2 waiting for you', 'Mobius is working', '1 app changed']);
    expect(deskTitle(new Date(2026, 10, 10, 8), { waiting: 0, working: 3, changed: 2 })).toEqual(['Tuesday 10 November', 'Mobius is working on 3', '2 apps changed']);
    setLocaleForTests('en-US');
    expect(deskTitle(now, { waiting: 0, working: 0, changed: 0 })).toEqual(['Monday, November 9']);
  });

  it('says when a conversation was last active, in words', () => {
    const ago = (minutes: number) => now.getTime() - minutes * 60_000;
    expect(agoLabel(ago(0), now)).toBe('Just now');
    expect(agoLabel(ago(25), now)).toBe('25 min ago');
    expect(agoLabel(ago(185), now)).toBe('3 hr ago');
    expect(agoLabel(new Date(2026, 10, 8, 23, 0).getTime(), now)).toBe('Yesterday');
    expect(agoLabel(new Date(2026, 10, 5, 9, 0).getTime(), now)).toBe('Thursday');
    expect(agoLabel(new Date(2026, 10, 2, 9, 0).getTime(), now)).toBe('2 Nov');
    // The system's locale decides the order, as in Mail.
    setLocaleForTests('en-US');
    expect(agoLabel(new Date(2026, 10, 2, 9, 0).getTime(), now)).toBe('Nov 2');
  });

  it('lists conversations to pick up again, most recent first, without empty or skipped ones', () => {
    const c = (id: string, updated_ms: number, messages = 2) => ({ id, updated_ms, messages });
    const list = recent([c('a', 1), c('b', 3), c('empty', 9, 0), c('busy', 8), c('c', 2), c('d', 0), c('e', 4)], new Set(['busy']));
    expect(list.map((x) => x.id)).toEqual(['e', 'b', 'c', 'a']);
  });

  it('a schedule runs next later today, or on its next day, and never when it is off', () => {
    expect(nextRun(schedule('20:00', [1]), now)).toEqual(new Date(2026, 10, 9, 20, 0));
    // Already past today: next Monday.
    expect(nextRun(schedule('08:00', [1]), now)).toEqual(new Date(2026, 10, 16, 8, 0));
    // Weekdays: tomorrow.
    expect(nextRun(schedule('08:00', [1, 2, 3, 4, 5]), now)).toEqual(new Date(2026, 10, 10, 8, 0));
    // Sunday is 7.
    expect(nextRun(schedule('09:00', [7]), now)).toEqual(new Date(2026, 10, 15, 9, 0));
    expect(nextRun(schedule('08:00', [1], false), now)).toBeNull();
    expect(nextRun(schedule('08:00', []), now)).toBeNull();
    expect(nextRun(schedule('8am', [1]), now)).toBeNull();
  });

  it('says when in words: today, tomorrow, or the weekday', () => {
    expect(whenLabel(new Date(2026, 10, 9, 20, 0), now)).toBe('Today at 20:00');
    expect(whenLabel(new Date(2026, 10, 10, 8, 5), now)).toBe('Tomorrow at 8:05');
    expect(whenLabel(new Date(2026, 10, 12, 8, 0), now)).toBe('Thursday at 8:00');
    // A 12-hour clock where the computer keeps one.
    setLocaleForTests('en-US');
    expect(whenLabel(new Date(2026, 10, 10, 8, 5), now)).toBe('Tomorrow at 8:05 AM');
  });

  it('lists what runs next, soonest first, leaving out what is off', () => {
    const list = upcoming([schedule('08:00', [1, 2, 3, 4, 5]), schedule('20:00', [1]), schedule('07:00', [2], false)], now);
    expect(list.map((x) => x.schedule.time)).toEqual(['20:00', '08:00']);
  });
});
