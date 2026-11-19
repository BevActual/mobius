import { isNotesFailure, type CalendarEvent, type ChatChannel, type Contact, type MailMessage, type NoteHit, type Notebook } from '@mobius/shared';
import type { FoundItem, LauncherPreview } from './Launcher';
import { useLauncherSource } from './launcher-sources';
import type { HubTarget } from './search-hub';
import { parseWhen, parseWhenAndTime, timeWords, type SmartView } from './tasks-view';
import { parseEventWords } from './calendar-view';

/**
 * What the everyday apps add to the launcher (docs/design/launcher.md, "How apps take part"): what the launcher can't
 * find from what Mobius already holds (mail, events, people, and the words inside notes and documents), and the
 * commands that take you straight to a place in an app.
 */

const words = (q: string) => q.toLowerCase().split(/\s+/).filter(Boolean);
const has = (text: string, ws: readonly string[]) => { const t = text.toLowerCase(); return ws.every((w) => t.includes(w)); };

const DAY = 86_400_000;
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const shortDay = (iso: string) => {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  return Number.isNaN(d.getTime()) ? iso.slice(0, 10) : d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
};

/** Events whose title, place or people match: the coming ones first, soonest first, then past ones, latest first. */
export function eventsMatching(events: readonly CalendarEvent[], query: string, now: Date, limit = 6): CalendarEvent[] {
  const ws = words(query);
  if (!ws.length) return [];
  const today = isoDay(now);
  const hit = events.filter((e) => has([e.title, e.location, ...(e.attendees ?? []).map((a) => `${a.name} ${a.email}`)].join(' '), ws));
  const coming = hit.filter((e) => e.end.slice(0, 10) >= today).sort((a, b) => a.start.localeCompare(b.start));
  const past = hit.filter((e) => e.end.slice(0, 10) < today).sort((a, b) => b.start.localeCompare(a.start));
  const seen = new Set<string>();
  return [...coming, ...past].filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true))).slice(0, limit);
}

/** "Fri 21 Nov, 13:00 – 14:00", or "Fri 21 Nov, all day". */
export function eventWhen(e: { start: string; end: string; allDay?: boolean }): string {
  const day = new Date(e.allDay ? `${e.start.slice(0, 10)}T12:00:00` : e.start);
  const d = day.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  if (e.allDay) return `${d}, all day`;
  const t = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${d}, ${t(e.start)} – ${t(e.end)}`;
}

/** What the launcher shows beside a found event. */
export function eventPreview(e: CalendarEvent): LauncherPreview {
  const people = (e.attendees ?? []).map((a) => a.name || a.email).filter(Boolean);
  const rows: [string, string][] = [['When', eventWhen(e)]];
  if (e.location) rows.push(['Where', e.location]);
  if (people.length) rows.push(['People', people.slice(0, 4).join(', ') + (people.length > 4 ? ` and ${people.length - 4} more` : '')]);
  return { title: e.title || '(no title)', meta: 'Calendar', rows };
}

/**
 * "event lunch with Sam fri 1pm" (or "new event …"): the event said in the words, for adding it from
 * the launcher without opening Calendar. Null when the words don't start that way or say no title.
 */
export function quickEvent(query: string, now: Date): { title: string; start: string; end: string; allDay: boolean } | null {
  const m = /^\s*(?:(?:add|new)\s+event|event)\s+(.+)$/i.exec(query);
  const rest = m?.[1]?.trim().slice(0, 200);
  if (!rest) return null;
  const parsed = parseEventWords(rest, now, parseWhen);
  return parsed && parsed.title.trim() ? parsed : null;
}

/** How an event reads in the launcher: its day, and its time unless it lasts all day. */
export function eventDetail(e: CalendarEvent): string {
  const time = e.allDay ? 'All day' : new Date(e.start).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return [`Calendar, ${shortDay(e.start)}`, time, e.location].filter(Boolean).join(' · ');
}

/** Messages as launcher rows: the subject, and who it is from. */
export function mailRows(messages: readonly MailMessage[], limit = 5): { id: string; label: string; detail: string; preview: LauncherPreview }[] {
  return messages.slice(0, limit).map((m) => {
    const label = m.subject.trim() || '(no subject)';
    const from = m.from.name || m.from.email;
    const when = Number.isFinite(m.dateMs) ? new Date(m.dateMs).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '';
    return {
      id: m.id, label, detail: `Mail, from ${from}`,
      preview: { title: label, meta: when ? `${from} · ${when}` : from, body: (m.preview ?? '').trim().slice(0, 600) || undefined, rows: m.attachments?.length ? [['Attached', m.attachments.join(', ')]] : undefined },
    };
  });
}

/** People with an email address, as "Email <name>" rows. */
export function peopleRows(people: readonly Contact[], limit = 4): { id: string; label: string; detail: string; email: string }[] {
  return people.filter((p) => p.emails[0]?.value).slice(0, limit).map((p) => ({ id: p.id, label: `Email ${p.name || p.emails[0]!.value}`, detail: [p.emails[0]!.value, p.org].filter(Boolean).join(' · '), email: p.emails[0]!.value }));
}

/** Pages whose words match but whose title doesn't: the launcher already finds those by title. */
export function bodyHits(hits: readonly NoteHit[], query: string, limit = 4): NoteHit[] {
  const ws = words(query);
  return hits.filter((h) => !has(h.title, ws)).slice(0, limit);
}

/**
 * "task Call Sam fri 3pm" (or "todo …", "add task …", "new task …"): the task's words, and the day and time said at
 * the end, for adding it from the launcher without opening Tasks. Null when the words don't start that way.
 */
export function quickTask(query: string, now: Date): { text: string; due: string | null; time?: string } | null {
  const m = /^\s*(?:(?:add|new)\s+task|task|todo)\s+(.+)$/i.exec(query);
  const rest = m?.[1]?.trim().slice(0, 500);
  if (!rest) return null;
  const said = parseWhenAndTime(rest, now);
  if (said && said.text.trim()) return { text: said.text.trim(), due: said.due, ...(said.time ? { time: said.time } : {}) };
  return { text: rest, due: null };
}

/** "Tasks, to Inbox, due Fri 20 Nov at 15:00" under the quick add row. */
export function quickTaskDetail(task: { due: string | null; time?: string }, list: string): string {
  if (!task.due) return `Tasks, to ${list}`;
  return `Tasks, to ${list}, due ${shortDay(task.due)}${task.time ? ` at ${timeWords(task.time)}` : ''}`;
}

interface Daily {
  openTarget: (target: HubTarget, label?: string) => void;
  /** A new message to this address. */
  composeTo: (email: string) => void;
  tasksView: (id: SmartView) => void;
  /** The calendar at today. */
  calendarToday: () => void;
  /** Files at Trash. */
  filesTrash: () => void;
  /** Where a task added from the launcher goes. */
  taskList: () => string;
  /** Where an event added from the launcher goes. */
  calendarInto: () => string;
  /** Adds an event (from "event …" in the launcher) and says so. */
  addEvent: (calendar: string, event: { title: string; start: string; end: string }) => void;
  /** Adds a task (from "task …" in the launcher) and says so. */
  addTask: (list: string, text: string, due: string | null, time?: string) => void;
}

const after = (signal: AbortSignal, ms: number) => new Promise<boolean>((done) => {
  const t = setTimeout(() => done(!signal.aborted), ms);
  signal.addEventListener('abort', () => { clearTimeout(t); done(false); }, { once: true });
});

/** Notes or Docs: pages that say the words, though their title doesn't. */
function wordsInside(app: 'notes' | 'docs', d: Daily) {
  return {
    app,
    find: async (query: string, signal: AbortSignal): Promise<FoundItem[]> => {
      const api = window.mobius[app];
      if (!api || !(await after(signal, 150))) return [];
      const hits = await api.search(query).catch(() => []);
      if (isNotesFailure(hits)) return [];
      return bodyHits(hits, query).map((h) => ({ id: `text:${h.path}`, app, label: h.title, detail: `${app === 'notes' ? 'Notes' : 'Docs'}, says “${h.line.trim().slice(0, 60)}”`, run: () => d.openTarget({ app, path: h.path, title: h.title }, h.title) }));
    },
  };
}

/** Registers Mail, Calendar, Tasks, Notes, Docs and Files with the launcher, for as long as the shell is up. */
export function useDailyLauncherSources(d: Daily): void {
  // Tasks first, so "task …" puts Add task at the top of what the apps found.
  useLauncherSource({
    app: 'tasks',
    find: (query) => {
      const task = quickTask(query, new Date());
      if (!task) return [];
      const list = d.taskList();
      const due = task.due ? `${shortDay(task.due)}${task.time ? `, ${timeWords(task.time)}` : ''}` : '';
      return [{
        id: 'quick-add', app: 'tasks', label: `Add task “${task.text.length > 60 ? `${task.text.slice(0, 59)}…` : task.text}”`, detail: quickTaskDetail(task, list),
        fields: [{ label: 'Task', value: task.text }, { label: 'Due', value: due }, { label: 'List', value: list }],
        preview: { title: task.text, meta: `Tasks · ${list}`, rows: [['Due', due || 'No date']] },
        run: () => d.addTask(list, task.text, task.due, task.time),
      }];
    },
    commands: () => [
      { id: 'today', label: 'Due today', detail: 'Tasks', run: () => d.tasksView('today') },
      { id: 'scheduled', label: 'Scheduled tasks', detail: 'Tasks', run: () => d.tasksView('scheduled') },
      { id: 'flagged', label: 'Flagged tasks', detail: 'Tasks', run: () => d.tasksView('flagged') },
    ],
  });
  useLauncherSource({
    app: 'mail',
    find: async (query, signal) => {
      const api = window.mobius;
      if (!(await after(signal, 120))) return [];
      const [letters, people] = await Promise.all([
        api.mail ? api.mail.list('all', 'all', query).catch(() => []) : Promise.resolve([]),
        api.contacts ? api.contacts.search(query, 4).catch(() => []) : Promise.resolve([]),
      ]);
      const found: FoundItem[] = [];
      if (!isNotesFailure(people)) for (const p of peopleRows(people)) found.push({ id: `person:${p.id}`, app: 'mail', label: p.label, detail: p.detail, run: () => d.composeTo(p.email) });
      if (!isNotesFailure(letters)) for (const m of mailRows(letters)) found.push({ id: m.id, app: 'mail', label: m.label, detail: m.detail, preview: m.preview, run: () => d.openTarget({ app: 'mail', id: m.id }, m.label) });
      return found;
    },
    commands: () => [{ id: 'inbox', label: 'Inbox', detail: 'Mail', run: () => d.openTarget({ app: 'open', id: 'mail' }) }],
  });
  useLauncherSource({
    app: 'calendar',
    find: async (query, signal) => {
      const api = window.mobius.calendar;
      if (!api) return [];
      const now = new Date();
      // "event …" adds one, at once, with what it read shown before Enter.
      const said = quickEvent(query, now);
      if (said) {
        const into = d.calendarInto();
        const when = eventWhen(said);
        return [{
          id: 'quick-event', app: 'calendar', label: `Add event “${said.title.length > 60 ? `${said.title.slice(0, 59)}…` : said.title}”`, detail: `Calendar, to ${into}`,
          fields: [{ label: 'Title', value: said.title }, { label: 'When', value: when }, { label: 'Calendar', value: into }],
          preview: { title: said.title, meta: `Calendar · ${into}`, rows: [['When', when]] },
          run: () => d.addEvent(into, { title: said.title, start: said.start, end: said.end }),
        }];
      }
      if (!(await after(signal, 120))) return [];
      const events = await api.events(isoDay(new Date(now.getTime() - 60 * DAY)), isoDay(new Date(now.getTime() + 180 * DAY))).catch(() => []);
      if (!Array.isArray(events)) return [];
      return eventsMatching(events, query, now).map((e) => ({ id: e.id, app: 'calendar' as const, label: e.title || '(no title)', detail: eventDetail(e), preview: eventPreview(e), run: () => d.openTarget({ app: 'calendar', date: e.start.slice(0, 10) }, e.title) }));
    },
    commands: () => [{ id: 'today', label: 'Today in Calendar', detail: 'Calendar', run: d.calendarToday }],
  });
  useLauncherSource(wordsInside('notes', d));
  useLauncherSource(wordsInside('docs', d));
  useLauncherSource({ app: 'files', commands: () => [{ id: 'trash', label: 'Trash', detail: 'Files', run: d.filesTrash }] });
}

/** Channels and direct messages whose name has every word, the busiest first. */
export function channelsMatching(channels: readonly ChatChannel[], query: string, limit = 5): ChatChannel[] {
  const ws = words(query.replace(/^#/, ''));
  if (!ws.length) return [];
  return channels.filter((c) => has(c.name, ws)).sort((a, b) => (b.mentions - a.mentions) || (b.unread - a.unread) || ((b.last ?? 0) - (a.last ?? 0))).slice(0, limit);
}

/** Knowledge pages whose title has every word. */
export function pagesMatching(notebooks: readonly Notebook[], query: string, limit = 5): { path: string; title: string; notebook: string }[] {
  const ws = words(query);
  if (!ws.length) return [];
  const out: { path: string; title: string; notebook: string }[] = [];
  for (const nb of notebooks) for (const p of nb.pages) if (out.length < limit && has(p.title, ws)) out.push({ path: p.path, title: p.title, notebook: nb.name });
  return out;
}

interface More {
  /** Messages at this channel. */
  openChannel: (account: string, channel: string) => void;
  /** Knowledge's pages, as loaded. */
  knowledge: () => readonly Notebook[];
  openPage: (path: string, title: string) => void;
  howIWork: () => void;
}

/** Registers Messages and Knowledge with the launcher. */
export function useMoreLauncherSources(m: More): void {
  useLauncherSource({
    app: 'messages',
    find: async (query, signal) => {
      const api = window.mobius.messages;
      if (!api || !(await after(signal, 150))) return [];
      const accounts = await api.accounts().catch(() => []);
      if (isNotesFailure(accounts) || signal.aborted) return [];
      const lists = await Promise.all(accounts.map((a) => api.channels(a.id).catch(() => [])));
      const all = lists.flatMap((l) => (isNotesFailure(l) ? [] : l));
      return channelsMatching(all, query).map((c) => ({ id: `${c.account}:${c.id}`, app: 'messages' as const, label: c.kind === 'channel' ? `#${c.name}` : c.name, detail: ['Messages', c.mentions ? `${c.mentions} mentioning you` : c.unread ? `${c.unread} unread` : ''].filter(Boolean).join(' · '), run: () => m.openChannel(c.account, c.id) }));
    },
  });
  useLauncherSource({
    app: 'wiki',
    find: (query) => pagesMatching(m.knowledge(), query).map((p) => ({ id: p.path, app: 'wiki' as const, label: p.title, detail: `Knowledge, ${p.notebook}`, run: () => m.openPage(p.path, p.title) })),
    commands: () => [{ id: 'how-i-work', label: 'How I work', detail: 'Knowledge', run: m.howIWork }],
  });
}
