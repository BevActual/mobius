import type { CalendarEvent, MailMessage, Notebook, TaskItem } from '@mobius/shared';
import { localDate } from './calendar-view';
import { timeLabel } from './dates';
import { agoLabel } from './desk-view';
import type { HubTarget } from './search-hub';
import type { AppId } from './apps';

/** One row of In your apps: the app, the one thing in it worth a look, a short detail, and where a press goes. */
export interface DeskRow {
  app: AppId;
  /** The thing itself: an event, a task, a page, who wrote. Rows without one show only the detail. */
  item?: string;
  /** A few words about it ("10:00 · 3 today", "12 unread"). */
  text: string;
  /** Where a press goes; without one the app opens as it was left. */
  target?: HubTarget;
}

export interface DeskSources {
  tabs: ReadonlyArray<{ title: string; active?: boolean }>;
  /** Inbox messages; only unread, not archived ones count. */
  mail: readonly MailMessage[];
  unread: number;
  /** What is due today or overdue, open only, in the order Tasks shows it. */
  dueToday: ReadonlyArray<{ list: string; task: TaskItem }>;
  events: readonly CalendarEvent[];
  notes: readonly Notebook[];
  docs: readonly Notebook[];
}

/** A page edited this recently is worth picking up from the desk. */
const RECENT_EDIT_MS = 3 * 86_400_000;

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

/** "Just now" and "Yesterday" read in the middle of a line; weekdays and dates keep their capitals. */
const lowerNear = (label: string) => (label === 'Just now' || label === 'Yesterday' ? label.toLowerCase() : label);

/** The page edited last across notebooks, if it was in the last three days. */
function lastEdited(notebooks: readonly Notebook[], now: Date): { path: string; title: string; modified: number } | null {
  let best: { path: string; title: string; modified: number } | null = null;
  for (const nb of notebooks) for (const p of nb.pages) if (!best || p.modified > best.modified) best = p;
  return best && now.getTime() - best.modified <= RECENT_EDIT_MS ? best : null;
}

/** What is left of today on the calendar: events not yet over, soonest first, all-day ones first. */
function restOfToday(events: readonly CalendarEvent[], now: Date): CalendarEvent[] {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const end = start + 86_400_000;
  return events
    .filter((e) => {
      const s = localDate(e.start).getTime();
      // All-day events end on their last day, included.
      const f = e.allDay ? localDate(e.end).getTime() + 86_400_000 : localDate(e.end).getTime();
      return s < end && f > now.getTime() && f > start;
    })
    .sort((a, b) => Number(b.allDay) - Number(a.allDay) || localDate(a.start).getTime() - localDate(b.start).getTime());
}

/**
 * The rows of In your apps, each naming the one thing worth a look: the next event, the first task due, who wrote last,
 * the page edited last. Apps with nothing to say are left out.
 */
export function deskAppRows(s: DeskSources, now: Date): DeskRow[] {
  const rows: DeskRow[] = [];
  const today = restOfToday(s.events, now);
  if (today.length > 0) {
    const next = today[0]!;
    const begun = !next.allDay && localDate(next.start).getTime() <= now.getTime();
    const when = next.allDay ? 'All day' : begun ? 'Now' : timeLabel(localDate(next.start));
    rows.push({ app: 'calendar', item: next.title || 'Event', text: today.length > 1 ? `${when} · ${today.length} today` : when, target: { app: 'calendar', date: next.start.slice(0, 10) } });
  }
  if (s.dueToday.length > 0) {
    const first = s.dueToday[0]!;
    rows.push({ app: 'tasks', item: first.task.text, text: `${s.dueToday.length} due today`, target: { app: 'tasks', list: first.list } });
  }
  const newest = s.mail.filter((m) => m.box === 'inbox' && !m.seen && !m.archived).sort((a, b) => b.dateMs - a.dateMs)[0];
  if (newest) rows.push({ app: 'mail', item: newest.from.name || newest.from.email, text: `${s.unread} unread`, target: { app: 'mail', id: newest.id } });
  else if (s.unread > 0) rows.push({ app: 'mail', text: `${s.unread} unread` });
  for (const [app, notebooks] of [['notes', s.notes], ['docs', s.docs]] as const) {
    const page = lastEdited(notebooks, now);
    if (page) rows.push({ app, item: page.title, text: `Edited ${lowerNear(agoLabel(page.modified, now))}`, target: { app, path: page.path, title: page.title } });
  }
  if (s.tabs.length > 0) {
    const active = s.tabs.find((t) => t.active);
    rows.push({ app: 'browser', item: active?.title || undefined, text: `${plural(s.tabs.length, 'tab')} open` });
  }
  return rows;
}
