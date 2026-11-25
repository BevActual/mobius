import type { CalendarEvent } from '@mobius/shared';

/** A meeting, for Record meeting and its nudge: a timed event with people invited or a place to be. */
export const isMeeting = (event: Pick<CalendarEvent, 'allDay' | 'attendees' | 'location'>): boolean =>
  !event.allDay && ((event.attendees?.length ?? 0) > 0 || (event.location ?? '').trim() !== '');

/** One time of one event, so a repeating meeting is offered again on its next day. */
export const meetingKey = (event: CalendarEvent): string => `${event.calendar}/${event.id}/${event.occurrence ?? event.start}`;

/** How early before its start, and how late after, a meeting is offered for recording. */
export const OFFER_BEFORE_MS = 60_000;
export const OFFER_AFTER_MS = 5 * 60_000;
/** The nudge goes by itself after this long. */
export const OFFER_SHOWN_MS = 60_000;

/** The day of a date as the calendar files it (YYYY-MM-DD, local). */
export const calendarDay = (at: Date): string =>
  `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;

/**
 * The meeting starting now, to offer for recording: from a minute before it starts to five minutes after, not offered
 * already. When two start together, the one that started first (then the first by title) is offered.
 */
export function meetingStarting(events: readonly CalendarEvent[], now: Date, offered: ReadonlySet<string>): CalendarEvent | null {
  const at = now.getTime();
  const due = events.filter((event) => {
    if (!isMeeting(event) || offered.has(meetingKey(event))) return false;
    const start = new Date(event.start.length === 16 ? `${event.start}:00` : event.start).getTime();
    return Number.isFinite(start) && at >= start - OFFER_BEFORE_MS && at <= start + OFFER_AFTER_MS;
  });
  due.sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
  return due[0] ?? null;
}
