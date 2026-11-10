import { describe, expect, it } from 'vitest';
import { GROUP_GAP_MS, stampLabel, startsGroup } from './time-stamps';

const at = (y: number, mo: number, d: number, h: number, mi: number): number => new Date(y, mo - 1, d, h, mi).getTime();
const now = at(2026, 11, 10, 15, 0);

describe('time stamps', () => {
  it('says today, yesterday, the weekday, then the date', () => {
    expect(stampLabel(at(2026, 11, 10, 9, 12), now, 'en-GB')).toBe('Today 9:12');
    expect(stampLabel(at(2026, 11, 9, 18, 40), now, 'en-GB')).toBe('Yesterday 18:40');
    expect(stampLabel(at(2026, 11, 6, 9, 0), now, 'en-GB')).toMatch(/^Fri 9:00$/);
    expect(stampLabel(at(2026, 11, 3, 9, 0), now, 'en-GB')).toBe('3 Nov 9:00');
    expect(stampLabel(at(2025, 11, 3, 9, 0), now, 'en-GB')).toBe('3 Nov 2025 9:00');
  });

  it('starts a group at the first timed message and after a gap of more than fifteen minutes', () => {
    expect(startsGroup(1_000, undefined)).toBe(true);
    expect(startsGroup(1_000 + GROUP_GAP_MS, 1_000)).toBe(false);
    expect(startsGroup(1_001 + GROUP_GAP_MS, 1_000)).toBe(true);
    expect(startsGroup(undefined, undefined)).toBe(false);
  });
});
