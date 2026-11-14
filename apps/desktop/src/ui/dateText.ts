import { dayMonthOrder, weekStart } from '../dates';

/**
 * Reading dates and times as people type them ("tomorrow", "fri 3pm", "20 nov", "9:30"), for the shared date and time
 * fields. Plain functions, so apps and the agent can use the same reading.
 */

export const DAY_MINUTES = 24 * 60;

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** Midnight of the day `when` falls on, on this computer's clock. */
export function startOfDay(when: Date | number): Date {
  const d = new Date(typeof when === 'number' ? when : when.getTime());
  d.setHours(0, 0, 0, 0);
  return d;
}

/** The same time of day, `days` later (a calendar day, so a clock change doesn't shift it). */
export function addDays(when: Date, days: number): Date {
  const d = new Date(when.getTime());
  d.setDate(d.getDate() + days);
  return d;
}

/** The first day of `when`'s month, moved by `months`. */
export function addMonths(when: Date, months: number): Date {
  return new Date(when.getFullYear(), when.getMonth() + months, 1);
}

/** Same calendar day. */
export const sameDay = (a: Date, b: Date): boolean => startOfDay(a).getTime() === startOfDay(b).getTime();

/** The first day of the next week, by this computer's week start ("Next week" in the date picker). */
export function nextWeek(now: Date, first = weekStart()): Date {
  const today = startOfDay(now);
  const ahead = (first - today.getDay() + 7) % 7 || 7;
  return addDays(today, ahead);
}

/** The six weeks the month grid shows for `month`, starting on the week start: 42 days. */
export function monthGrid(month: Date, first = weekStart()): Date[] {
  const start = new Date(month.getFullYear(), month.getMonth(), 1);
  const back = (start.getDay() - first + 7) % 7;
  return Array.from({ length: 42 }, (_, i) => new Date(month.getFullYear(), month.getMonth(), 1 - back + i));
}

/** Minutes since midnight from typed text: "9", "9:30", "0930", "3pm", "3.15 pm", "15:30", "noon", "midnight". */
export function parseTime(text: string): number | null {
  const t = text.trim().toLowerCase().replace(/\s+/g, '');
  if (t === '') return null;
  if (t === 'noon' || t === 'midday') return 12 * 60;
  if (t === 'midnight') return 0;
  const m = /^(\d{1,2})(?:[:.h]?(\d{2}))?(am|pm|a|p)?$/.exec(t);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = m[2] === undefined ? 0 : Number(m[2]);
  const half = m[3]?.[0];
  if (minute > 59) return null;
  if (half) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (half === 'p' ? 12 : 0);
  } else if (hour > 23) return null;
  return hour * 60 + minute;
}

export interface ReadDate {
  /** The day, or null for "no date" ("none", "someday"). */
  date: Date | null;
  /** Minutes since midnight when a time was typed too ("fri 3pm"). */
  time: number | null;
}

const prefixOf = (word: string, list: readonly string[], min = 3): number =>
  word.length >= min ? list.findIndex((name) => name.startsWith(word)) : -1;

function readDay(words: string[], now: Date, order: 'dm' | 'md', first: number): Date | null | undefined {
  const today = startOfDay(now);
  const text = words.join(' ');
  if (text === '' || text === 'today' || text === 'tod' || text === 'now') return today;
  if (['tomorrow', 'tmr', 'tmrw', 'tom'].includes(text)) return addDays(today, 1);
  if (text === 'yesterday') return addDays(today, -1);
  if (['none', 'no date', 'someday', 'clear'].includes(text)) return null;
  if (text === 'next week') return nextWeek(now, first);
  if (text === 'next month') return addMonths(today, 1);

  let m = /^(?:in )?(\d+) ?(d|day|days|w|wk|wks|week|weeks|m|mo|month|months)$/.exec(text);
  if (m) {
    const n = Number(m[1]);
    const unit = (m[2] ?? 'd')[0];
    if (unit === 'd') return addDays(today, n);
    if (unit === 'w') return addDays(today, n * 7);
    const d = addMonths(today, n);
    d.setDate(Math.min(today.getDate(), new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
    return d;
  }

  // A weekday: the next one from today (today itself counts; "next" skips today).
  m = /^(next |this )?([a-z]+)$/.exec(text);
  if (m) {
    const day = prefixOf(m[2] ?? '', WEEKDAYS, 2);
    if (day >= 0) {
      const ahead = (day - today.getDay() + 7) % 7;
      return addDays(today, m[1] === 'next ' && ahead === 0 ? 7 : ahead);
    }
  }

  // 2026-11-20
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (m) return valid(Number(m[1]), Number(m[2]) - 1, Number(m[3]));

  // 20/11, 20.11.2027, 11/20 (by the computer's order)
  m = /^(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?$/.exec(text);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    const [day, month] = order === 'dm' ? [a, b] : [b, a];
    return withYear(m[3], month - 1, day, today);
  }

  // 20 nov, nov 20, 20 november 2027, nov 20 2027, 20th nov
  m = /^(\d{1,2})(?:st|nd|rd|th)? ([a-z]+)(?: (\d{4}))?$/.exec(text) ?? null;
  if (m) {
    const month = prefixOf(m[2] ?? '', MONTHS);
    if (month >= 0) return withYear(m[3], month, Number(m[1]), today);
  }
  m = /^([a-z]+) (\d{1,2})(?:st|nd|rd|th)?(?: (\d{4}))?$/.exec(text);
  if (m) {
    const month = prefixOf(m[1] ?? '', MONTHS);
    if (month >= 0) return withYear(m[3], month, Number(m[2]), today);
  }
  // A day of this month or the next: "20", "20th"
  m = /^(\d{1,2})(?:st|nd|rd|th)$/.exec(text);
  if (m) {
    const day = Number(m[1]);
    const here = valid(today.getFullYear(), today.getMonth(), day);
    if (here && here.getTime() >= today.getTime()) return here;
    return valid(today.getFullYear(), today.getMonth() + 1, day);
  }
  return undefined;
}

function valid(year: number, month: number, day: number): Date | undefined {
  const d = new Date(year, month, day);
  return d.getMonth() === ((month % 12) + 12) % 12 && d.getDate() === day ? d : undefined;
}

/** A day and month with no year means the next time it comes round (today counts). */
function withYear(year: string | undefined, month: number, day: number, today: Date): Date | undefined {
  if (year) return valid(year.length === 2 ? 2000 + Number(year) : Number(year), month, day);
  const here = valid(today.getFullYear(), month, day);
  if (here && here.getTime() >= today.getTime()) return here;
  return valid(today.getFullYear() + 1, month, day);
}

/**
 * Reads a typed date, with an optional time at the end ("fri 3pm", "tomorrow at 9:30", "20 nov 14:00"). A time alone
 * means today. Returns null when the text doesn't read as a date.
 */
export function parseDate(text: string, now: Date = new Date(), options: { order?: 'dm' | 'md'; weekStart?: number } = {}): ReadDate | null {
  const order = options.order ?? dayMonthOrder();
  const first = options.weekStart ?? weekStart();
  const words = text.trim().toLowerCase().replace(/,/g, ' ').split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  // Peel a time off the end: "3pm", "3 pm", "at 9:30", "noon".
  let time: number | null = null;
  for (const take of [2, 1]) {
    if (words.length < take) continue;
    const tail = words.slice(-take).join(' ');
    if (take === 1 && /^\d{1,2}$/.test(tail)) continue; // "20" alone is a day, not 20:00
    if (take === 1 && /^\d{1,2}(st|nd|rd|th)$/.test(tail)) continue;
    const read = parseTime(tail);
    if (read !== null && (take === 2 ? /\d\s*(am|pm|a|p)$/.test(tail) : /[:.apmnoid]/.test(tail))) {
      time = read;
      words.splice(-take, take);
      break;
    }
  }
  if (words[words.length - 1] === 'at') words.pop();
  const date = readDay(words, now, order, first);
  if (date === undefined) return null;
  if (date === null) return time === null ? { date: null, time: null } : null;
  return { date, time };
}

/** "15 min", "1 hr", "1 hr 30 min": the length of an event, shown grey beside its end time. */
export function lengthLabel(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const hours = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${hours} hr ${rest} min` : `${hours} hr`;
}

/** A Date for a day plus minutes since midnight. */
export function atTime(day: Date, minutes: number): Date {
  const d = startOfDay(day);
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return d;
}

/** Minutes since midnight of a Date. */
export const minutesOf = (when: Date): number => when.getHours() * 60 + when.getMinutes();
