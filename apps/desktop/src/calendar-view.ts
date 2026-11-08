import type { CalendarEvent } from '@mobius/shared';

/** What the Calendar app shows: one day, a week (Monday first), or a month as whole weeks. */
export type CalendarMode = 'day' | 'week' | 'month';

const pad = (n: number) => String(n).padStart(2, '0');
export const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** `YYYY-MM-DD` or `YYYY-MM-DDTHH:MM`, read as local time. */
export function localDate(text: string): Date {
  const [day = '', time = '00:00'] = text.split('T');
  const [y, m, d] = day.split('-').map(Number);
  const [h, min] = time.split(':').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, h ?? 0, min ?? 0);
}
export const isoTime = (d: Date) => `${isoDay(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const sameDay = (a: Date, b: Date) => isoDay(a) === isoDay(b);

export function weekStart(d: Date): Date {
  return addDays(d, -((d.getDay() + 6) % 7));
}

/** The days on screen for a view around `anchor`. A month is the whole weeks that hold it, Monday first. */
export function daysFor(mode: CalendarMode, anchor: Date): Date[] {
  if (mode === 'day') return [addDays(anchor, 0)];
  if (mode === 'week') return Array.from({ length: 7 }, (_, i) => addDays(weekStart(anchor), i));
  const first = weekStart(new Date(anchor.getFullYear(), anchor.getMonth(), 1));
  const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  const days: Date[] = [];
  for (let d = first; d <= last || days.length % 7 !== 0; d = addDays(d, 1)) days.push(d);
  return days;
}

/** Back or forward by one day, week or month. */
export function step(mode: CalendarMode, anchor: Date, by: 1 | -1): Date {
  if (mode === 'day') return addDays(anchor, by);
  if (mode === 'week') return addDays(anchor, 7 * by);
  // The 31st into a month without one lands on its last day.
  const target = new Date(anchor.getFullYear(), anchor.getMonth() + by, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return new Date(target.getFullYear(), target.getMonth(), Math.min(anchor.getDate(), lastDay));
}

/** The heading: "November 2026", or the day itself in Day view. A week across two months names both. */
export function heading(mode: CalendarMode, anchor: Date, locale?: string): string {
  if (mode === 'day') return anchor.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const month = (d: Date) => d.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  if (mode === 'week') {
    const days = daysFor('week', anchor);
    const [a, b] = [days[0]!, days[6]!];
    if (a.getMonth() === b.getMonth()) return month(a);
    if (a.getFullYear() === b.getFullYear()) return `${a.toLocaleDateString(locale, { month: 'short' })} – ${b.toLocaleDateString(locale, { month: 'short', year: 'numeric' })}`;
    return `${a.toLocaleDateString(locale, { month: 'short', year: 'numeric' })} – ${b.toLocaleDateString(locale, { month: 'short', year: 'numeric' })}`;
  }
  return month(anchor);
}

/** "9:00", "13:30": the 24-hour clock, as on the design. */
export const clock = (text: string) => { const d = localDate(text); return `${d.getHours()}:${pad(d.getMinutes())}`; };

/** The events that cover a day without a time on it: all-day ones, and timed ones that run through the whole day. */
export function allDayOn(events: readonly CalendarEvent[], day: Date): CalendarEvent[] {
  const start = day.getTime();
  const end = addDays(day, 1).getTime();
  return events.filter((e) => {
    const s = localDate(e.start).getTime();
    const f = localDate(e.end).getTime();
    if (e.allDay) return s < end && f > start;
    return s <= start && f >= end;
  });
}

export interface Placed { event: CalendarEvent; top: number; height: number; column: number; columns: number }

/**
 * The timed events of a day, in minutes from midnight, side by side where they overlap: each group of events that
 * overlap one another shares the width in columns, the way calendars draw them. Events that run past midnight are cut
 * at the day's edge; ones shorter than `minimum` minutes are drawn that tall so they can be read and clicked.
 */
export function placeDay(events: readonly CalendarEvent[], day: Date, minimum = 20): Placed[] {
  const dayStart = day.getTime();
  const dayEnd = addDays(day, 1).getTime();
  const minutes = (t: number) => (t - dayStart) / 60000;
  const timed = events
    .filter((e) => !e.allDay)
    .map((event) => ({ event, s: localDate(event.start).getTime(), f: localDate(event.end).getTime() }))
    .filter(({ s, f }) => (s < dayEnd && f > dayStart) || (s === f && s >= dayStart && s < dayEnd))
    .filter(({ s, f }) => !(s <= dayStart && f >= dayEnd))
    .map(({ event, s, f }) => {
      const top = Math.max(0, minutes(s));
      const bottom = Math.min(24 * 60, minutes(f));
      return { event, top, height: Math.max(minimum, bottom - top) };
    })
    .sort((a, b) => a.top - b.top || b.height - a.height);
  const placed: Placed[] = [];
  let group: Placed[] = [];
  let groupEnd = -1;
  const close = () => { const columns = Math.max(0, ...group.map((p) => p.column)) + 1; group.forEach((p) => { p.columns = columns; }); group = []; };
  for (const t of timed) {
    if (t.top >= groupEnd) { close(); groupEnd = -1; }
    // The first column whose last event has ended.
    let column = 0;
    while (group.some((p) => p.column === column && p.top + p.height > t.top)) column += 1;
    const p: Placed = { ...t, column, columns: 1 };
    group.push(p);
    placed.push(p);
    groupEnd = Math.max(groupEnd, t.top + t.height);
  }
  close();
  return placed;
}

/** Events that start on or cover a day, all-day ones first: what a month cell lists. */
export function eventsOn(events: readonly CalendarEvent[], day: Date): CalendarEvent[] {
  const start = day.getTime();
  const end = addDays(day, 1).getTime();
  const on = events.filter((e) => {
    const s = localDate(e.start).getTime();
    const f = localDate(e.end).getTime();
    return (s < end && f > start) || (s === f && s >= start && s < end);
  });
  return on.sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.localeCompare(b.start));
}

/** A colour for each calendar, by its place in the list, the same everywhere it is drawn. */
const PALETTE = ['#5856d6', '#0a84ff', '#ff9f0a', '#34c759', '#ff3b30', '#af52de', '#00a3a3', '#a2845e'];
export const calendarColor = (calendars: readonly string[], name: string) => PALETTE[Math.max(0, calendars.indexOf(name)) % PALETTE.length]!;

/** Which calendars are hidden, per device. */
const HIDDEN_KEY = 'mobius.calendar.hidden';
export function hiddenCalendars(): Set<string> {
  try {
    const v: unknown = JSON.parse(window.localStorage.getItem(HIDDEN_KEY) ?? '[]');
    return new Set(Array.isArray(v) ? v.filter((n): n is string => typeof n === 'string') : []);
  } catch {
    return new Set();
  }
}
export function keepHidden(hidden: ReadonlySet<string>): void {
  try { window.localStorage.setItem(HIDDEN_KEY, JSON.stringify([...hidden])); } catch { /* Not kept. */ }
}
