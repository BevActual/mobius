import type { CalendarEvent } from '@mobius/shared';
import { meetingKey } from './meeting-start';

/**
 * Alerts (docs/design/calendar.md): an event's alert is minutes before it starts (negative: after its start, as an
 * all-day event's 9:00 on the day). When one comes, the pill at the foot of the app says so, once.
 */

/** The choices for a timed event, and for an all-day one, as Google Calendar and Fantastical offer them. */
export const TIMED_ALERTS: readonly { value: number | null; label: string }[] = [
  { value: null, label: 'None' },
  { value: 0, label: 'At the time' },
  { value: 5, label: '5 minutes before' },
  { value: 10, label: '10 minutes before' },
  { value: 15, label: '15 minutes before' },
  { value: 30, label: '30 minutes before' },
  { value: 60, label: '1 hour before' },
  { value: 1440, label: '1 day before' },
];
export const DAY_ALERTS: readonly { value: number | null; label: string }[] = [
  { value: null, label: 'None' },
  { value: -540, label: 'On the day (9:00)' },
  { value: 900, label: 'The day before (9:00)' },
];

/** An alert the choices do not have (set in another app), said in words. */
export function alertLabel(minutes: number | null | undefined, allDay: boolean): string {
  if (minutes === null || minutes === undefined) return 'None';
  const listed = (allDay ? DAY_ALERTS : TIMED_ALERTS).find((a) => a.value === minutes);
  if (listed) return listed.label;
  if (minutes < 0) return `${-minutes} minutes after it starts`;
  if (minutes % 1440 === 0) return `${minutes / 1440} days before`;
  if (minutes % 60 === 0) return `${minutes / 60} hours before`;
  return `${minutes} minutes before`;
}

/** How long an alert's pill stays, and how late after its time it still shows (the calendar is read every 30s). */
export const ALERT_LATE_MS = 2 * 60_000;

const startOf = (event: CalendarEvent): number => new Date(event.start.length === 10 ? `${event.start}T00:00:00` : event.start.length === 16 ? `${event.start}:00` : event.start).getTime();

/** The alert that has come: its time reached in the last two minutes, not shown already; the earliest first. */
export function alertDue(events: readonly CalendarEvent[], now: Date, shown: ReadonlySet<string>): CalendarEvent | null {
  const at = now.getTime();
  const due = events.filter((e) => {
    if (typeof e.alert !== 'number' || shown.has(meetingKey(e))) return false;
    const when = startOf(e) - e.alert * 60_000;
    return Number.isFinite(when) && at >= when && at < when + ALERT_LATE_MS;
  });
  due.sort((a, b) => (startOf(a) - (a.alert ?? 0) * 60_000) - (startOf(b) - (b.alert ?? 0) * 60_000) || a.title.localeCompare(b.title));
  return due[0] ?? null;
}

/** What the pill says: "Budget review in 10 minutes", "Budget review is starting", "Trip is today". */
export function alertSaid(event: CalendarEvent, now: Date): string {
  const title = event.title.trim() || 'An event';
  if (event.allDay) {
    const day = new Date(`${event.start.slice(0, 10)}T00:00:00`);
    return now.toDateString() === day.toDateString() ? `${title} is today` : `${title} is tomorrow`;
  }
  const minutes = Math.round((startOf(event) - now.getTime()) / 60_000);
  if (minutes <= 0) return `${title} is starting`;
  if (minutes < 60) return `${title} in ${minutes === 1 ? '1 minute' : `${minutes} minutes`}`;
  if (minutes < 1440) { const h = Math.round(minutes / 60); return `${title} in ${h === 1 ? '1 hour' : `${h} hours`}`; }
  return `${title} is tomorrow`;
}
