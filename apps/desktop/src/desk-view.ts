import type { ScheduleInfo } from '@mobius/shared';

/** The words for the time of day the desk is read at. */
export const partOfDay = (hour: number): string => (hour < 5 ? 'night' : hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening');

/** The desk's title line: the day, the part of day, then only the counts that are not zero. */
export function deskTitle(now: Date, counts: { waiting: number; working: number; changed: number }): string[] {
  const day = now.toLocaleDateString('en-GB', { weekday: 'long' });
  return [
    `${day} ${partOfDay(now.getHours())}`,
    counts.waiting > 0 ? `${counts.waiting} waiting for you` : '',
    counts.working > 0 ? (counts.working === 1 ? 'Mobius is working' : `Mobius is working on ${counts.working}`) : '',
    counts.changed > 0 ? `${counts.changed} ${counts.changed === 1 ? 'app' : 'apps'} changed` : '',
  ].filter(Boolean);
}

/** When a schedule runs next, from `now` on, or null when it is off or has no days. Days are 1 (Monday) to 7 (Sunday). */
export function nextRun(schedule: Pick<ScheduleInfo, 'enabled' | 'days' | 'time'>, now: Date): Date | null {
  const match = /^(\d{2}):(\d{2})$/.exec(schedule.time);
  if (!schedule.enabled || schedule.days.length === 0 || !match) return null;
  for (let ahead = 0; ahead <= 7; ahead++) {
    const at = new Date(now.getFullYear(), now.getMonth(), now.getDate() + ahead, Number(match[1]), Number(match[2]));
    const weekday = at.getDay() === 0 ? 7 : at.getDay();
    if (schedule.days.includes(weekday) && at.getTime() > now.getTime()) return at;
  }
  return null;
}

/** "Today at 08:00", "Tomorrow at 08:00", "Thursday at 08:00". */
export function whenLabel(at: Date, now: Date): string {
  const days = Math.round((new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86_400_000);
  const time = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
  const day = days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : at.toLocaleDateString('en-GB', { weekday: 'long' });
  return `${day} at ${time}`;
}

/** The schedules that run next, soonest first, at most `limit`. */
export function upcoming(schedules: readonly ScheduleInfo[], now: Date, limit = 3): Array<{ schedule: ScheduleInfo; at: Date }> {
  return schedules
    .flatMap((schedule) => { const at = nextRun(schedule, now); return at ? [{ schedule, at }] : []; })
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .slice(0, limit);
}
