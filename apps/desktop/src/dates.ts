/**
 * Dates and times, written the way this computer writes them. Every app uses these rather than its own
 * `toLocaleDateString`, so Mail, Calendar, Home and the rest agree: one order of day and month, one clock (13:00 or
 * 1:00 PM).
 *
 * The locale is the computer's regional format, which the shell hands over before the window draws
 * (`__MOBIUS_SYSTEM__.locale`, "en-GB"). The web view alone knows only the display language, which can differ. Outside
 * the shell (the preview, tests) the browser's own language is used.
 */

type When = Date | number;

let override: string | undefined;

/** For tests: write as this locale (`null` goes back to the system's). */
export function setLocaleForTests(locale: string | null): void {
  override = locale ?? undefined;
  cache.clear();
}

export function systemLocale(): string | undefined {
  if (override !== undefined) return override;
  const given = (globalThis as { __MOBIUS_SYSTEM__?: { locale?: unknown } }).__MOBIUS_SYSTEM__?.locale;
  if (typeof given !== 'string' || given === '') return undefined;
  try {
    return Intl.DateTimeFormat.supportedLocalesOf([given]).length > 0 ? given : undefined;
  } catch {
    return undefined;
  }
}

const cache = new Map<string, Intl.DateTimeFormat>();

/** Any other shape, still in the system's locale. Formatters are kept, as making one is slow. */
export function formatWith(when: When, options: Intl.DateTimeFormatOptions): string {
  const locale = systemLocale();
  const key = `${locale ?? ''}|${JSON.stringify(options)}`;
  let format = cache.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(locale, options);
    cache.set(key, format);
  }
  const date = typeof when === 'number' ? new Date(when) : when;
  return Number.isNaN(date.getTime()) ? '' : format.format(date);
}

/** "13:00" or "1:00 PM", as the computer keeps its clock. */
export const timeLabel = (when: When): string => formatWith(when, { hour: 'numeric', minute: '2-digit' });

/** "Thu", "Thursday" or "T". */
export const weekdayLabel = (when: When, width: 'narrow' | 'short' | 'long' = 'short'): string => formatWith(when, { weekday: width });

/** "12 Nov" or "Nov 12", with the year when it is not this year (or when asked), and the weekday when asked. */
export function dayLabel(when: When, options: { weekday?: 'short' | 'long'; year?: boolean; now?: When } = {}): string {
  const date = typeof when === 'number' ? new Date(when) : when;
  const now = options.now === undefined ? new Date() : typeof options.now === 'number' ? new Date(options.now) : options.now;
  const year = options.year ?? date.getFullYear() !== now.getFullYear();
  return formatWith(date, { ...(options.weekday ? { weekday: options.weekday } : {}), day: 'numeric', month: 'short', ...(year ? { year: 'numeric' } : {}) });
}

/** "Thursday 12 November 2026" or "Thursday, November 12, 2026": a heading. `year: false` leaves the year out. */
export const longDateLabel = (when: When, options: { year?: boolean } = {}): string =>
  formatWith(when, { weekday: 'long', day: 'numeric', month: 'long', ...(options.year === false ? {} : { year: 'numeric' }) });

/** "November 2026". */
export const monthLabel = (when: When): string => formatWith(when, { month: 'long', year: 'numeric' });

/** "12 Nov, 13:00" or "Nov 12, 1:00 PM". */
export const dateTimeLabel = (when: When, options: { year?: boolean; now?: When } = {}): string =>
  formatWith(when, { day: 'numeric', month: 'short', ...((options.year ?? !sameYear(when, options.now ?? Date.now())) ? { year: 'numeric' } : {}), hour: 'numeric', minute: '2-digit' });

const startOfDay = (when: When): number => {
  const d = new Date(typeof when === 'number' ? when : when.getTime());
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

function sameYear(a: When, b: When): boolean {
  return new Date(typeof a === 'number' ? a : a.getTime()).getFullYear() === new Date(typeof b === 'number' ? b : b.getTime()).getFullYear();
}

/** Whole calendar days from `now` to `when` (1 is tomorrow, -1 yesterday), counted on this computer's clock. */
export const daysFrom = (when: When, now: When): number => Math.round((startOfDay(when) - startOfDay(now)) / 86_400_000);

/** "Today", "Yesterday" or "Tomorrow", or null for any other day. */
export function nearDayLabel(when: When, now: When = Date.now()): 'Today' | 'Yesterday' | 'Tomorrow' | null {
  const days = daysFrom(when, now);
  return days === 0 ? 'Today' : days === -1 ? 'Yesterday' : days === 1 ? 'Tomorrow' : null;
}

/** Regions whose weeks start on Sunday, for engines without `Intl.Locale` week info. */
const SUNDAY_REGIONS = new Set(['US', 'CA', 'JP', 'BR', 'IL', 'PH', 'MX', 'KR', 'TW', 'IN', 'ZA', 'SA', 'AU', 'HK']);

/** The first day of the week on this computer: 0 Sunday, 1 Monday, 6 Saturday. Calendars and date pickers start here. */
export function weekStart(): number {
  const tag = systemLocale() ?? new Intl.DateTimeFormat().resolvedOptions().locale;
  try {
    const locale = new Intl.Locale(tag) as Intl.Locale & { getWeekInfo?: () => { firstDay: number }; weekInfo?: { firstDay: number } };
    const info = locale.getWeekInfo?.() ?? locale.weekInfo;
    if (info) return info.firstDay % 7;
    const region = locale.maximize().region;
    return region && SUNDAY_REGIONS.has(region) ? 0 : 1;
  } catch {
    return 1;
  }
}

/** True when this computer keeps a 12-hour clock (1:00 PM), false for 24 hours (13:00). */
export function uses12Hour(): boolean {
  const cycle = new Intl.DateTimeFormat(systemLocale(), { hour: 'numeric' }).resolvedOptions().hourCycle;
  return cycle === 'h11' || cycle === 'h12';
}

/** Whether a short numeric date puts the day first ("20/11", 'dm') or the month first ("11/20", 'md'). */
export function dayMonthOrder(): 'dm' | 'md' {
  const parts = new Intl.DateTimeFormat(systemLocale(), { day: 'numeric', month: 'numeric' }).formatToParts(new Date(2026, 10, 20));
  return parts.findIndex((p) => p.type === 'day') < parts.findIndex((p) => p.type === 'month') ? 'dm' : 'md';
}
