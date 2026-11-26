import type { CalendarEvent, MailMessage, ProjectInfo, TaskItem, WikiChange } from '@mobius/shared';
import { localDate } from './calendar-view';
import { updateDue } from './projects-view';
import type { AppId } from './apps';
import type { HubTarget } from './search-hub';

/**
 * The Inbox on Home (docs/apps/assistant.md), as Linear's Inbox: everything across the apps that waits on you, in one
 * list. Each item can be opened, set aside until later (Later, as Linear's snooze), or cleared (Done). Done does what
 * the item asks where it can (a task is ticked off); otherwise it clears the item until it comes up again.
 */
export type InboxKind = 'task' | 'update' | 'suggested' | 'reply' | 'invite';

export interface InboxItem {
  /** Stays the same while the item does, so Done and Later stick to it; a new round of the same thing has a new key. */
  key: string;
  kind: InboxKind;
  app: AppId;
  name: string;
  text: string;
  /** The word for opening it ("Open", "Reply", "Write"). */
  go: string;
  /** Where a press goes. Projects and Knowledge open by name (they have no hub target). */
  target?: HubTarget;
  project?: string;
  /** For a task: its list and the task, so Done ticks it off. */
  task?: { list: string; task: TaskItem };
  /** When it is about, for its order: a task's due day, an invite's start, a message's date. */
  at: number;
}

export interface InboxSources {
  /** Due today or overdue, open only, in the order Tasks shows them. */
  dueToday: ReadonlyArray<{ list: string; task: TaskItem }>;
  projects: readonly ProjectInfo[];
  /** Lines offered to Knowledge pages, waiting to be kept. */
  suggested: readonly WikiChange[];
  mail: readonly MailMessage[];
  events: readonly CalendarEvent[];
  /** The person's own addresses (their mail accounts), to find the invitations they have not answered. */
  me: readonly string[];
}

const day = (iso: string) => { const [y, m, d] = iso.split('-').map(Number) as [number, number, number]; return new Date(y, m - 1, d).getTime(); };

/** What waits, newest kinds first: tasks due, invitations, mail to answer, project updates due, then suggested changes. */
export function inboxItems(s: InboxSources, now: Date): InboxItem[] {
  const out: InboxItem[] = [];
  const today = day(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`);
  for (const { list, task } of s.dueToday) {
    const due = task.due ? day(task.due) : today;
    out.push({ key: `task:${list}:${task.text}:${task.due ?? ''}`, kind: 'task', app: 'tasks', name: task.text, text: due < today ? `Overdue · ${list}` : `Due today · ${list}`, go: 'Open', target: { app: 'tasks', list }, task: { list, task }, at: due });
  }
  const mine = new Set(s.me.map((e) => e.trim().toLowerCase()).filter(Boolean));
  const seen = new Set<string>();
  for (const e of s.events) {
    const start = localDate(e.start).getTime();
    if (start < now.getTime() || seen.has(e.id)) continue;
    const me = e.attendees?.find((a) => mine.has(a.email.toLowerCase()));
    if (!me || me.status !== 'needs-action' || (e.organizer && mine.has(e.organizer.email.toLowerCase()))) continue;
    seen.add(e.id);
    const from = e.organizer?.name || e.organizer?.email || 'Someone';
    out.push({ key: `invite:${e.id}:${e.start}`, kind: 'invite', app: 'calendar', name: e.title || 'Invitation', text: `Invitation from ${from}`, go: 'Answer', target: { app: 'calendar', date: e.start.slice(0, 10) }, at: start });
  }
  for (const m of s.mail) {
    if (!m.needsReply || m.archived || m.box !== 'inbox') continue;
    out.push({ key: `reply:${m.id}`, kind: 'reply', app: 'mail', name: m.subject || '(no subject)', text: `Needs a reply to ${m.from.name || m.from.email}`, go: 'Reply', target: { app: 'mail', id: m.id }, at: m.dateMs });
  }
  for (const p of s.projects) {
    if (!updateDue(p, now.getTime())) continue;
    const last = p.updates?.at(-1);
    out.push({ key: `update:${p.id}:${last?.id ?? 'none'}`, kind: 'update', app: 'projects', name: p.name, text: last ? 'A project update is due' : 'No update yet', go: 'Write', project: p.id, at: last?.at ?? 0 });
  }
  if (s.suggested.length > 0) {
    const n = s.suggested.length;
    out.push({ key: `suggested:${s.suggested.map((c) => c.id).sort().join(',')}`, kind: 'suggested', app: 'wiki', name: n === 1 ? '1 suggested change' : `${n} suggested changes`, text: 'Waiting to be kept in Knowledge', go: 'Look', at: Math.max(...s.suggested.map((c) => c.whenMs)) });
  }
  return out;
}

/** Later, as Linear's snooze: later today (three hours on), tomorrow morning, or next Monday morning, at 8:00. */
export const LATER: readonly { id: string; label: string }[] = [
  { id: 'today', label: 'Later today' },
  { id: 'tomorrow', label: 'Tomorrow' },
  { id: 'week', label: 'Next week' },
];
export function laterUntil(choice: string, now: Date): number {
  const morning = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 8, 0).getTime();
  if (choice === 'today') return now.getTime() + 3 * 3_600_000;
  if (choice === 'week') {
    const d = new Date(now);
    d.setDate(d.getDate() + (((8 - d.getDay()) % 7) || 7));
    return morning(d);
  }
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  return morning(d);
}

/** What the person did with items: cleared (Done) and set aside until a time (Later). Kept on this device. */
export interface InboxKept { done: readonly string[]; later: Readonly<Record<string, number>> }

/** The items to show now, and the ones set aside for later (soonest back first). Done ones are gone. */
export function sortInbox(items: readonly InboxItem[], kept: InboxKept, now: number): { shown: InboxItem[]; later: (InboxItem & { until: number })[] } {
  const done = new Set(kept.done);
  const shown: InboxItem[] = [];
  const later: (InboxItem & { until: number })[] = [];
  for (const it of items) {
    if (done.has(it.key)) continue;
    const until = kept.later[it.key];
    if (until && until > now) later.push({ ...it, until }); else shown.push(it);
  }
  later.sort((a, b) => a.until - b.until);
  return { shown, later };
}

/** Done keys kept: the newest 500, so the list does not grow for ever; Later times past are dropped. */
export function trimKept(kept: InboxKept, now: number): InboxKept {
  return { done: kept.done.slice(-500), later: Object.fromEntries(Object.entries(kept.later).filter(([, t]) => t > now)) };
}
