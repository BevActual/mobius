import { afterEach, describe, expect, it } from 'vitest';
import { dayOf } from './NoteHistory';
import { setLocaleForTests } from './dates';

describe('the day a version of a note sits under', () => {
  afterEach(() => setLocaleForTests(null));
  const now = new Date(2026, 10, 12, 15).getTime();

  it('says Today and Yesterday by the calendar, not by hours', () => {
    expect(dayOf(new Date(2026, 10, 12, 0, 5).getTime(), now)).toBe('Today');
    expect(dayOf(new Date(2026, 10, 11, 23, 50).getTime(), now)).toBe('Yesterday');
  });

  it("follows the computer's regional format for older days", () => {
    setLocaleForTests('en-GB');
    expect(dayOf(new Date(2026, 10, 9).getTime(), now)).toBe('Monday 9 November');
    expect(dayOf(new Date(2026, 9, 1).getTime(), now)).toBe('1 October');
    expect(dayOf(new Date(2025, 9, 1).getTime(), now)).toBe('1 October 2025');
    setLocaleForTests('en-US');
    expect(dayOf(new Date(2026, 9, 1).getTime(), now)).toBe('October 1');
  });
});
