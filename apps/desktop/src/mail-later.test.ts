import { describe, expect, it } from 'vitest';
import { laterChoices, parseLater } from './mail-later';

// Wednesday 19 November 2025, 10:15 local time.
const now = new Date(2025, 10, 19, 10, 15);
const at = (d: number, h: number, m = 0) => new Date(2025, 10, d, h, m).getTime();

describe('Later choices', () => {
  it('offers later today, tomorrow, this weekend and next week', () => {
    const c = laterChoices(now);
    expect(c.map((x) => x.label)).toEqual(['Later today', 'Tomorrow', 'This weekend', 'Next week']);
    expect(c[0]!.at).toBe(at(19, 13, 15));
    expect(c[1]!.at).toBe(at(20, 8));
    expect(c[2]!.at).toBe(at(22, 9));
    expect(c[3]!.at).toBe(at(24, 8));
  });
  it('later today in the afternoon is 18:00 when that comes first', () => {
    expect(laterChoices(new Date(2025, 10, 19, 16, 0))[0]!.at).toBe(at(19, 18));
  });
});

describe('a time in words', () => {
  it('reads days, times and amounts', () => {
    expect(parseLater('tomorrow', now)).toBe(at(20, 8));
    expect(parseLater('tomorrow 3pm', now)).toBe(at(20, 15));
    expect(parseLater('Monday 9am', now)).toBe(at(24, 9));
    expect(parseLater('fri 14:30', now)).toBe(at(21, 14, 30));
    expect(parseLater('in 2 hours', now)).toBe(at(19, 12, 15));
    expect(parseLater('in an hour', now)).toBe(at(19, 11, 15));
    expect(parseLater('in 3 days', now)).toBe(at(22, 10, 15));
    expect(parseLater('tonight', now)).toBe(at(19, 20));
    expect(parseLater('next week', now)).toBe(at(24, 8));
    expect(parseLater('this weekend', now)).toBe(at(22, 9));
  });
  it('a time alone is today if still ahead, else tomorrow', () => {
    expect(parseLater('4pm', now)).toBe(at(19, 16));
    expect(parseLater('9:00', now)).toBe(at(20, 9));
  });
  it('today names the same weekday a week on', () => {
    expect(parseLater('wednesday', now)).toBe(at(26, 8));
  });
  it('gives nothing for words that are not a time', () => {
    expect(parseLater('', now)).toBeNull();
    expect(parseLater('whenever', now)).toBeNull();
    expect(parseLater('today 9am', now)).toBeNull();
  });
});
