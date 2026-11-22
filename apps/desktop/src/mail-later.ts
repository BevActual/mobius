/**
 * Later (H): when a put-off message comes back to the inbox. The quick choices follow Superhuman's Remind Me
 * (help.superhuman.com, "Remind Me") and Gmail's snooze: later today, tomorrow, this weekend, next week. The field
 * takes a time in words, as Superhuman's does: "tomorrow", "monday 9am", "in 2 hours", "tonight", "fri 14:30".
 */

const HOUR = 3_600_000;
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;

/** `hour`:`minute` on the day `days` after `now`'s. */
function dayAt(now: Date, days: number, hour: number, minute = 0): number {
  const at = new Date(now);
  at.setDate(at.getDate() + days);
  at.setHours(hour, minute, 0, 0);
  return at.getTime();
}

/** Days from `now` to the next `weekday` (0 Sunday … 6 Saturday), counting a week ahead when it is today. */
const daysTo = (now: Date, weekday: number) => ((weekday - now.getDay() + 7) % 7) || 7;

/** The quick choices: Later today (three hours on, or 18:00 if that is sooner and still ahead), Tomorrow 8:00,
 * This weekend (Saturday 9:00; next Saturday when it is the weekend), Next week (Monday 8:00). */
export function laterChoices(now = new Date()): { id: string; label: string; at: number }[] {
  const evening = dayAt(now, 0, 18);
  const soon = now.getTime() + 3 * HOUR;
  const today = evening > now.getTime() + HOUR && evening < soon ? evening : soon;
  return [
    { id: 'today', label: 'Later today', at: today },
    { id: 'tomorrow', label: 'Tomorrow', at: dayAt(now, 1, 8) },
    { id: 'weekend', label: 'This weekend', at: dayAt(now, daysTo(now, 6), 9) },
    { id: 'week', label: 'Next week', at: dayAt(now, daysTo(now, 1), 8) },
  ];
}

/** "9am", "9:30 pm", "14:00", "noon": hours and minutes, or null. */
function timeOf(words: string): { h: number; m: number } | null {
  if (/\bnoon\b/.test(words)) return { h: 12, m: 0 };
  if (/\bmidnight\b/.test(words)) return { h: 0, m: 0 };
  const t = /\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?(?=\s|$)/.exec(words.replace(/\bin\s+\d+\s*\w+/, ''));
  if (!t) return null;
  let h = Number(t[1]);
  const m = t[2] ? Number(t[2]) : 0;
  const half = t[3]?.[0];
  // A bare number is a time only with minutes or am/pm ("9" alone could be a date); "at 9" counts.
  if (!t[2] && !half && !/\bat\s+\d/.test(words)) return null;
  if (half === 'p' && h < 12) h += 12;
  if (half === 'a' && h === 12) h = 0;
  if (h > 23 || m > 59) return null;
  return { h, m };
}

/** A time in words, from `now`; null when the words don't say one (or say one already past). */
export function parseLater(text: string, now = new Date()): number | null {
  const words = text.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!words) return null;
  const quick = laterChoices(now);
  const by = (id: string) => quick.find((q) => q.id === id)!.at;
  const amount = /\bin (an?|\d+(?:\.\d+)?) ?(min(?:ute)?s?|h(?:ou)?rs?|hours?|days?|weeks?)\b/.exec(words);
  if (amount) {
    const n = amount[1]!.startsWith('a') ? 1 : Number(amount[1]);
    const unit = amount[2]!;
    const ms = unit.startsWith('min') ? 60_000 : unit.startsWith('h') ? HOUR : unit.startsWith('d') ? 24 * HOUR : 7 * 24 * HOUR;
    return Math.round(now.getTime() + n * ms);
  }
  const time = timeOf(words);
  const at = (days: number, fallback: { h: number; m: number }) => dayAt(now, days, (time ?? fallback).h, (time ?? fallback).m);
  let found: number | null = null;
  if (/\blater( today)?\b/.test(words) && !time) found = by('today');
  else if (/\btonight\b/.test(words)) found = at(0, { h: 20, m: 0 });
  else if (/\bthis evening\b/.test(words)) found = at(0, { h: 18, m: 0 });
  else if (/\btoday\b/.test(words)) found = time ? at(0, time) : by('today');
  else if (/\btomorrow\b|\btmrw?\b/.test(words)) found = at(1, { h: 8, m: 0 });
  else if (/\b(this )?weekend\b/.test(words)) found = at(daysTo(now, 6), { h: 9, m: 0 });
  else if (/\bnext week\b/.test(words)) found = at(daysTo(now, 1), { h: 8, m: 0 });
  else {
    const day = DAYS.findIndex((d) => new RegExp(`\\b(${d}|${d.slice(0, 3)})\\b`).test(words));
    if (day >= 0) found = at(daysTo(now, day), { h: 8, m: 0 });
    else if (time) {
      // A time alone: today if it is still ahead, otherwise tomorrow.
      const today = at(0, time);
      found = today > now.getTime() ? today : at(1, time);
    }
  }
  return found !== null && found > now.getTime() ? found : null;
}
