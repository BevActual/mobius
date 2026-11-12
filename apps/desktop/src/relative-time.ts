import { dayLabel } from './dates';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** "5 min ago", "Yesterday", "Oct 4": how long ago something happened, in a few words. */
export function relativeTime(then: number, now: number): string {
  if (!Number.isFinite(then) || !Number.isFinite(now) || then <= 0) return '';
  const age = now - then;
  if (age < MIN) return 'Just now';
  if (age < HOUR) return `${Math.floor(age / MIN)} min ago`;
  if (age < DAY) return `${Math.floor(age / HOUR)} hr ago`;
  if (age < 2 * DAY) return 'Yesterday';
  if (age < 7 * DAY) return `${Math.floor(age / DAY)} days ago`;
  return dayLabel(then, { now });
}
