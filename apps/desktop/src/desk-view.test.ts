import { describe, expect, it } from 'vitest';
import { deskTitle, nextRun, upcoming, whenLabel } from './desk-view';

// Monday 9 November 2026, 19:30.
const now = new Date(2026, 10, 9, 19, 30);
const schedule = (time: string, days: number[], enabled = true) => ({ id: time, title: `At ${time}`, prompt: 'p', time, days, enabled, lastRunMs: null });

describe('desk', () => {
  it('the title line names the day and part of day, then only the counts that are not zero', () => {
    expect(deskTitle(now, { waiting: 0, working: 0, changed: 0 })).toEqual(['Monday evening']);
    expect(deskTitle(now, { waiting: 2, working: 1, changed: 1 })).toEqual(['Monday evening', '2 waiting for you', 'Mobius is working', '1 app changed']);
    expect(deskTitle(new Date(2026, 10, 10, 8), { waiting: 0, working: 3, changed: 2 })).toEqual(['Tuesday morning', 'Mobius is working on 3', '2 apps changed']);
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
    expect(whenLabel(new Date(2026, 10, 10, 8, 5), now)).toBe('Tomorrow at 08:05');
    expect(whenLabel(new Date(2026, 10, 12, 8, 0), now)).toBe('Thursday at 08:00');
  });

  it('lists what runs next, soonest first, leaving out what is off', () => {
    const list = upcoming([schedule('08:00', [1, 2, 3, 4, 5]), schedule('20:00', [1]), schedule('07:00', [2], false)], now);
    expect(list.map((x) => x.schedule.time)).toEqual(['20:00', '08:00']);
  });
});
