import { describe, expect, it } from 'vitest';
import { relativeTime } from './relative-time';

const now = Date.UTC(2026, 10, 3, 12, 0, 0);
const ago = (ms: number) => relativeTime(now - ms, now);
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;

describe('relative time', () => {
  it('says "just now" for the last minute, and for clocks that are a little ahead', () => {
    expect(ago(0)).toBe('Just now');
    expect(ago(59_000)).toBe('Just now');
    expect(ago(-30_000)).toBe('Just now');
  });
  it('counts minutes, hours and days', () => {
    expect(ago(MIN)).toBe('1 min ago');
    expect(ago(59 * MIN)).toBe('59 min ago');
    expect(ago(HOUR)).toBe('1 hr ago');
    expect(ago(23 * HOUR)).toBe('23 hr ago');
    expect(ago(DAY)).toBe('Yesterday');
    expect(ago(2 * DAY)).toBe('2 days ago');
    expect(ago(6 * DAY)).toBe('6 days ago');
  });
  it('gives a date for anything older, with the year only when it is not this year', () => {
    expect(ago(30 * DAY)).toBe('Oct 4');
    expect(relativeTime(Date.UTC(2025, 11, 25, 12), now)).toBe('Dec 25, 2025');
  });
  it('copes with values that are not times', () => {
    expect(relativeTime(Number.NaN, now)).toBe('');
    expect(relativeTime(Infinity, now)).toBe('');
    expect(relativeTime(0, now)).toBe('');
  });
});
