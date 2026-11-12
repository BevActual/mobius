import { afterEach, describe, expect, it } from 'vitest';
import { dateTimeLabel, dayLabel, longDateLabel, monthLabel, nearDayLabel, setLocaleForTests, systemLocale, timeLabel, weekdayLabel } from './dates';

const at = new Date(2026, 10, 12, 13, 5);

afterEach(() => {
  setLocaleForTests(null);
  delete (globalThis as { __MOBIUS_SYSTEM__?: unknown }).__MOBIUS_SYSTEM__;
});

describe('dates follow the computer', () => {
  it('British: day before month, a 24-hour clock', () => {
    setLocaleForTests('en-GB');
    expect(timeLabel(at)).toBe('13:05');
    expect(dayLabel(at, { now: at })).toBe('12 Nov');
    expect(dayLabel(at, { weekday: 'short', now: at })).toBe('Thu 12 Nov');
    expect(longDateLabel(at)).toMatch(/^Thursday,? 12 November 2026$/); // The comma depends on the ICU version.
    expect(monthLabel(at)).toBe('November 2026');
    expect(dateTimeLabel(at, { now: at })).toBe('12 Nov, 13:05');
  });

  it('American: month before day, a 12-hour clock', () => {
    setLocaleForTests('en-US');
    expect(timeLabel(at)).toMatch(/^1:05\sPM$/);
    expect(dayLabel(at, { now: at })).toBe('Nov 12');
    expect(longDateLabel(at, { year: false })).toBe('Thursday, November 12');
    expect(weekdayLabel(at, 'long')).toBe('Thursday');
  });

  it('a date in another year says the year', () => {
    setLocaleForTests('en-GB');
    expect(dayLabel(at, { now: new Date(2027, 0, 2) })).toBe('12 Nov 2026');
  });

  it('takes the locale the shell hands over, and ignores one it cannot use', () => {
    (globalThis as { __MOBIUS_SYSTEM__?: unknown }).__MOBIUS_SYSTEM__ = { locale: 'en-GB' };
    expect(systemLocale()).toBe('en-GB');
    expect(timeLabel(at)).toBe('13:05');
    (globalThis as { __MOBIUS_SYSTEM__?: unknown }).__MOBIUS_SYSTEM__ = { locale: 'not a locale!' };
    expect(systemLocale()).toBeUndefined();
  });

  it('names the nearest days', () => {
    expect(nearDayLabel(at, at)).toBe('Today');
    expect(nearDayLabel(new Date(2026, 10, 11, 23, 59), at)).toBe('Yesterday');
    expect(nearDayLabel(new Date(2026, 10, 13, 0, 1), at)).toBe('Tomorrow');
    expect(nearDayLabel(new Date(2026, 10, 15), at)).toBeNull();
  });
});
