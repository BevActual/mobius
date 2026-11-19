import { isNotesFailure, type CalendarEvent, type ChatChannel, type Contact, type MailMessage, type NoteHit, type Notebook } from '@mobius/shared';
import type { FoundItem } from './Launcher';
import { useLauncherSource } from './launcher-sources';
import type { HubTarget } from './search-hub';
import type { SmartView } from './tasks-view';

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

/** How an event reads in the launcher: its day, and its time unless it lasts all day. */
export function eventDetail(e: CalendarEvent): string {
  const time = e.allDay ? 'All day' : new Date(e.start).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return [`Calendar, ${shortDay(e.start)}`, time, e.location].filter(Boolean).join(' · ');
}

/** Messages as launcher rows: the subject, and who it is from. */
export function mailRows(messages: readonly MailMessage[], limit = 5): { id: string; label: string; detail: string }[] {
  return messages.slice(0, limit).map((m) => ({ id: m.id, label: m.subject.trim() || '(no subject)', detail: `Mail, from ${m.from.name || m.from.email}` }));
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

interface Daily {
  openTarget: (target: HubTarget, label?: string) => void;
  /** A new message to this address. */
  composeTo: (email: string) => void;
  tasksView: (id: SmartView) => void;
  /** The calendar at today. */
  calendarToday: () => void;
  /** Files at Trash. */
  filesTrash: () => void;
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
      if (!isNotesFailure(letters)) for (const m of mailRows(letters)) found.push({ id: m.id, app: 'mail', label: m.label, detail: m.detail, run: () => d.openTarget({ app: 'mail', id: m.id }, m.label) });
      return found;
    },
    commands: () => [{ id: 'inbox', label: 'Inbox', detail: 'Mail', run: () => d.openTarget({ app: 'open', id: 'mail' }) }],
  });
  useLauncherSource({
    app: 'calendar',
    find: async (query, signal) => {
      const api = window.mobius.calendar;
      if (!api || !(await after(signal, 120))) return [];
      const now = new Date();
      const events = await api.events(isoDay(new Date(now.getTime() - 60 * DAY)), isoDay(new Date(now.getTime() + 180 * DAY))).catch(() => []);
      if (!Array.isArray(events)) return [];
      return eventsMatching(events, query, now).map((e) => ({ id: e.id, app: 'calendar' as const, label: e.title || '(no title)', detail: eventDetail(e), run: () => d.openTarget({ app: 'calendar', date: e.start.slice(0, 10) }, e.title) }));
    },
    commands: () => [{ id: 'today', label: 'Today in Calendar', detail: 'Calendar', run: d.calendarToday }],
  });
  useLauncherSource({
    app: 'tasks',
    commands: () => [
      { id: 'today', label: 'Due today', detail: 'Tasks', run: () => d.tasksView('today') },
      { id: 'scheduled', label: 'Scheduled tasks', detail: 'Tasks', run: () => d.tasksView('scheduled') },
      { id: 'flagged', label: 'Flagged tasks', detail: 'Tasks', run: () => d.tasksView('flagged') },
    ],
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
