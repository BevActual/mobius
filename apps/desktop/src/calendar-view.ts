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

/** The ways an event can repeat, as the editor offers them; `''` is Never. */
export const REPEAT_OPTIONS: readonly { id: string; name: string }[] = [
  { id: '', name: 'Never' },
  { id: 'daily', name: 'Every day' },
  { id: 'weekdays', name: 'Every weekday' },
  { id: 'weekly', name: 'Every week' },
  { id: 'biweekly', name: 'Every 2 weeks' },
  { id: 'monthly', name: 'Every month' },
  { id: 'yearly', name: 'Every year' },
];

/** Minutes from midnight, rounded to the nearest `snap` and kept inside the day. */
export const snapMinutes = (minutes: number, snap = 15) => Math.max(0, Math.min(24 * 60, Math.round(minutes / snap) * snap));
/** A local time `minutes` after the start of `day`. */
export const atMinutes = (day: Date, minutes: number) => isoTime(new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, minutes));

/**
 * Where a dragged timed event lands: moved by whole days and snapped minutes, keeping its length; or, resizing, only
 * its end changes (never shorter than one snap).
 */
export function dragged(event: { start: string; end: string }, byDays: number, byMinutes: number, resize: boolean, snap = 15): { start: string; end: string } {
  const s = localDate(event.start);
  const f = localDate(event.end);
  if (resize) {
    const end = new Date(f.getTime() + Math.round(byMinutes / snap) * snap * 60_000);
    return { start: event.start, end: isoTime(new Date(Math.max(end.getTime(), s.getTime() + snap * 60_000))) };
  }
  // Days are added on the calendar, not as 24 hours, so a move across a clock change keeps the time.
  const move = (d: Date) => { const t = new Date(d.getTime() + Math.round(byMinutes / snap) * snap * 60_000); return new Date(t.getFullYear(), t.getMonth(), t.getDate() + byDays, t.getHours(), t.getMinutes()); };
  return { start: isoTime(move(s)), end: isoTime(move(f)) };
}

const TIME = /(?:^|\s)(?:at\s+|@\s*)?(noon|midday|midnight|(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?)(?:\s*(?:-|–|to|until)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?\s*$/i;
const LENGTH = /\s+for\s+(\d+(?:\.\d+)?)\s*(h|hr|hrs|hours?|m|min|mins|minutes?)\s*$/i;

/** "1pm", "13:30", "9", "noon" in minutes from midnight; a bare number needs am/pm or a colon unless `bare`. */
function minutesOf(h: string | undefined, m: string | undefined, ampm: string | undefined, word: string, bare: boolean): number | null {
  const w = word.toLowerCase();
  if (w === 'noon' || w === 'midday') return 12 * 60;
  if (w === 'midnight') return 0;
  if (h === undefined) return null;
  let hour = Number(h);
  const min = m === undefined ? 0 : Number(m);
  if (!ampm && m === undefined && !bare) return null;
  if (hour > 23 || min > 59) return null;
  const p = ampm?.toLowerCase().replace(/\./g, '');
  if (p === 'pm' && hour < 12) hour += 12;
  if (p === 'am' && hour === 12) hour = 0;
  if (p && hour > 23) return null;
  return hour * 60 + min;
}

/**
 * A new event said in words, as in "Lunch with Sam fri 1pm", "Standup tomorrow 9:30 for 15m", "Dentist 12 dec at 3pm",
 * "Offsite next week": its title, and when. A time without a day is today (tomorrow if it has passed); a day without
 * a time is all day; neither is the next hour. `parseDay` reads a day said at the end of the words.
 */
export function parseEventWords(text: string, now: Date, parseDay: (text: string, now: Date) => { text: string; due: string } | null): { title: string; start: string; end: string; allDay: boolean } | null {
  let rest = text.trim().replace(/\s+/g, ' ');
  if (!rest) return null;
  let length: number | null = null;
  const len = LENGTH.exec(rest);
  if (len) { length = Number(len[1]) * (/^m/i.test(len[2]!) ? 1 : 60); rest = rest.slice(0, len.index).trim(); }
  let day: string | null = null;
  let start: number | null = null;
  let end: number | null = null;
  // The day and the time can come in either order at the end.
  for (let i = 0; i < 2; i += 1) {
    if (start === null) {
      const t = TIME.exec(rest);
      const explicit = !!t && (/\b(at|@)\b|@/.test(t[0]) || !!t[4] || !!t[3] || t[5] !== undefined || /noon|midday|midnight/i.test(t[1]!));
      const mins = t ? minutesOf(t[2], t[3], t[4], t[1]!, explicit) : null;
      if (t && mins !== null && rest.slice(0, t.index).trim()) {
        start = mins;
        if (t[5] !== undefined) end = minutesOf(t[5], t[6], t[7] ?? t[4], t[5], true);
        // "2-3pm": the start takes the end's afternoon.
        if (end !== null && t[7] && !t[4] && start + 12 * 60 <= end) start += 12 * 60;
        if (end !== null && end <= start && !t[7] && end + 12 * 60 > start) end += 12 * 60;
        rest = rest.slice(0, t.index).trim();
        continue;
      }
    }
    if (day === null) {
      const d = parseDay(rest, now);
      if (d) { day = d.due; rest = d.text; continue; }
    }
  }
  rest = rest.replace(/\s+(?:on|at|by)$/i, '').trim();
  // Nothing left but a day ("fri 1pm"): there is no title.
  if (!rest || parseDay(`x ${rest}`, now)?.text === 'x') return null;
  if (start === null && day === null) return null;
  if (start === null) return { title: rest, start: day!, end: day!, allDay: true };
  let date = day ?? isoDay(now);
  if (day === null && start < now.getHours() * 60 + now.getMinutes()) date = isoDay(addDays(now, 1));
  const base = localDate(date);
  const finish = end !== null && end > start ? end : start + (length ?? 60);
  return { title: rest, start: atMinutes(base, start), end: atMinutes(base, finish), allDay: false };
}

/** An event as the editor sends it back: an all-day event's end is its last day, not the day after. */
export const draftEnd = (event: { end: string; allDay: boolean }) => (event.allDay ? isoDay(addDays(localDate(event.end), -1)) : event.end);

/** Where an event dropped `n` days later (or earlier) lands, in the form the editor sends: its time and length kept. */
export function movedByDays(event: { start: string; end: string; allDay: boolean }, n: number): { start: string; end: string } {
  if (!event.allDay) return dragged(event, n, 0, false);
  return { start: isoDay(addDays(localDate(event.start), n)), end: isoDay(addDays(localDate(event.end), n - 1)) };
}
