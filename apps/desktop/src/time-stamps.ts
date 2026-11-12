import { systemLocale } from './dates';

/** A gap longer than this between messages starts a new group, with its time above it. */
export const GROUP_GAP_MS = 15 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

const startOfDay = (ms: number): number => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** "Today 9:12", "Yesterday 18:40", "Mon 9:12", or "3 Nov 9:12" (with the year when it is not this year). */
export function stampLabel(at: number, now: number, locale: string | undefined = systemLocale()): string {
  const time = new Date(at).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
  const days = Math.round((startOfDay(now) - startOfDay(at)) / DAY_MS);
  if (days <= 0) return `Today ${time}`;
  if (days === 1) return `Yesterday ${time}`;
  if (days < 7) return `${new Date(at).toLocaleDateString(locale, { weekday: 'short' })} ${time}`;
  const sameYear = new Date(at).getFullYear() === new Date(now).getFullYear();
  return `${new Date(at).toLocaleDateString(locale, sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' })} ${time}`;
}

/**
 * Whether a time goes above the message sent at `at`: the first timed message of the conversation, or one sent more
 * than fifteen minutes after the one before it. Messages from before times were kept have none, and get no stamp.
 */
export function startsGroup(at: number | undefined, previous: number | undefined): boolean {
  if (at === undefined) return false;
  return previous === undefined || at - previous > GROUP_GAP_MS;
}
