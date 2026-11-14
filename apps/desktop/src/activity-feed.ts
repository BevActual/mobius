import type { ActivityEntry } from '@mobius/shared';
import type { AppId } from './apps';
import { formatWith, weekdayLabel } from './dates';

/** What the Activity app's sidebar can narrow the list to. */
export type ActivityFilter = 'everything' | 'needs' | 'mobius' | 'you' | 'final' | `app:${AppId}`;

/** One thing that happened, as a sentence the person can read. */
export interface FeedItem {
  seq: number;
  when: number;
  text: string;
  /** The app it happened in, or null when it was Mobius's own (the clock, its memory of the session). */
  app: AppId | null;
  by: 'mobius' | 'you' | 'other';
  /** Sending, paying, deleting and running commands: nothing puts these back. */
  final: boolean;
  /** Mobius changed something in an app (wrote, added, sent, deleted), not only looked. */
  changed: boolean;
  /** It went wrong. */
  warn: boolean;
}

export interface FeedDay { label: string; items: FeedItem[] }

/** Where the sidebar looks: what needs you, a stretch of time, or one app. */
export type ActivityPlace = 'needs' | 'today' | 'week' | 'all' | `app:${AppId}`;
/** Who did it, from the toolbar: everything, Mobius alone, you alone, or only what cannot be undone. */
export type ActivityWho = 'everything' | 'mobius' | 'you' | 'final';

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** The item is in that place: today since midnight, this week the last seven days counting today. */
export function inPlace(item: FeedItem, place: ActivityPlace, now: Date): boolean {
  if (place === 'all') return true;
  if (place === 'needs') return false;
  if (place === 'today') return item.when >= startOfDay(now);
  if (place === 'week') return item.when >= startOfDay(now) - 6 * 86_400_000;
  return item.app === place.slice(4);
}

/** The item was done by whom the toolbar asks for. */
export function byWho(item: FeedItem, who: ActivityWho): boolean {
  return who === 'everything' || matches(item, who);
}

/** The app a capability belongs to, by the part before its dot. */
const APP_OF: Record<string, AppId> = {
  browser: 'browser', net: 'browser', mail: 'mail', calendar: 'calendar', events: 'calendar', code: 'code', db: 'database',
  files: 'files', fs: 'files', document: 'docs', docs: 'docs', comments: 'docs', notes: 'notes', tasks: 'tasks', sheets: 'sheets',
  slides: 'slides', memory: 'wiki', wiki: 'wiki', images: 'photo', photo: 'photo', terminal: 'terminal', shell: 'terminal',
  research: 'research', reader: 'reader', design: 'design', canvas: 'canvas', studio: 'studio', video: 'video', skills: 'skills',
};

export function appOfCapability(capability: string | null): AppId | null {
  if (!capability) return null;
  return APP_OF[capability.split('.')[0] ?? ''] ?? null;
}

/** The workspace folder a file lives in, and the app it belongs to: a write to notes/… happened in Notes. */
const APP_OF_FOLDER: Record<string, AppId> = {
  notes: 'notes', docs: 'docs', slides: 'slides', sheets: 'sheets', tasks: 'tasks', calendar: 'calendar', code: 'code',
  designs: 'design', boards: 'canvas', research: 'research', reading: 'reader', databases: 'database', photos: 'photo',
  studio: 'studio', video: 'video', skills: 'skills',
};

/**
 * A file capability's resource, when it is a workspace path: the app it belongs to and its name as that app shows it
 * ("notes/P2 build/Supplier notes.md" is Notes' "P2 build / Supplier notes"). Null for anything else.
 */
export function appOfFile(resource: string | null): { app: AppId; name: string } | null {
  if (!resource) return null;
  const parts = resource.replace(/\\/g, '/').split('/');
  const app = parts.length > 1 ? APP_OF_FOLDER[parts[0]!] : undefined;
  if (!app) return null;
  const name = parts.slice(1).join(' / ').replace(/\.(md|csv|json|ics|sqlite)$/i, '');
  return { app, name };
}

/** Paying, sending, deleting and running commands always ask first, because none of them can be undone. */
export function isFinal(capability: string | null): boolean {
  if (!capability) return false;
  const [area = '', verb = ''] = capability.split('.');
  return verb === 'send' || verb === 'pay' || verb === 'push' || verb === 'delete' || verb === 'run' || area === 'payments' || area === 'terminal' || area === 'shell';
}

/** What a finished capability did, in a few words, with the thing it did it to when there is one. */
const DID: Record<string, (on: string) => string> = {
  'browser.navigate': (on) => `Opened ${on || 'a page'}`,
  'browser.open': (on) => `Opened ${on || 'a page'}`,
  'browser.read': (on) => `Read ${on || 'a page'}`,
  'browser.click': (on) => `Clicked on ${on || 'a page'}`,
  'browser.type': (on) => `Typed on ${on || 'a page'}`,
  'browser.interact': (on) => `Used ${on || 'a page'}`,
  'browser.tabs': () => 'Looked at your tabs',
  'browser.list': () => 'Looked at your tabs',
  'net.http_get': (on) => `Fetched ${on || 'a page'}`,
  'mail.read': () => 'Read your mail',
  'mail.draft': (on) => (on ? `Drafted an email to ${on}` : 'Drafted an email'),
  'mail.send': (on) => (on ? `Sent an email to ${on}` : 'Sent an email'),
  'calendar.read': () => 'Looked at your calendar',
  'calendar.list': () => 'Looked at your calendar',
  'calendar.add': (on) => (on ? `Added “${on}” to your calendar` : 'Added an event'),
  'calendar.write': (on) => (on ? `Changed “${on}” in your calendar` : 'Changed your calendar'),
  'calendar.update': (on) => (on ? `Changed “${on}” in your calendar` : 'Changed your calendar'),
  'calendar.suggest': () => 'Suggested a time',
  'calendar.free': () => 'Looked for a free time',
  'files.read': (on) => `Read ${on || 'a file'}`,
  'files.read_all': () => 'Read your files',
  'files.list': () => 'Looked through your files',
  'files.search': () => 'Searched your files',
  'files.write': (on) => `Changed ${on || 'a file'}`,
  'files.edit': (on) => `Changed ${on || 'a file'}`,
  'files.delete': (on) => `Deleted ${on || 'a file'}`,
  'fs.delete': (on) => `Deleted ${on || 'a file'}`,
  'document.write': (on) => `Wrote ${on || 'a document'}`,
  'comments.reply': () => 'Answered a comment',
  'comments.resolve': () => 'Resolved a comment',
  'code.run': (on) => (on ? `Ran ${on}` : 'Ran a command'),
  'code.test': () => 'Ran the tests',
  'code.commit': () => 'Committed code',
  'code.push': () => 'Pushed code',
  'db.query': (on) => (on ? `Looked in ${on}` : 'Looked in a database'),
  'db.read': (on) => (on ? `Looked in ${on}` : 'Looked in a database'),
  'db.write': (on) => (on ? `Changed ${on}` : 'Changed a database'),
  'db.execute': (on) => (on ? `Changed ${on}` : 'Changed a database'),
  'memory.remember': () => 'Remembered something about you',
  'memory.write': () => 'Remembered something about you',
  'memory.forget': () => 'Forgot something it had remembered',
  'images.generate': () => 'Made a picture',
  'payments.pay': (on) => (on ? `Paid ${on}` : 'Made a payment'),
  'clock.read': () => 'Checked the time',
  'clock.now': () => 'Checked the time',
};

/** What a question or an approval was about, as Mobius would ask it: "send email". */
const ASKED: Record<string, string> = {
  'browser.navigate': 'open pages', 'browser.open': 'open pages', 'browser.read': 'read pages', 'browser.click': 'click on pages',
  'browser.type': 'type on pages', 'browser.interact': 'use pages', 'net.http_get': 'fetch pages', 'mail.read': 'read your mail',
  'mail.draft': 'draft email', 'mail.send': 'send email', 'calendar.add': 'add events', 'calendar.write': 'change your calendar',
  'calendar.update': 'change your calendar', 'files.read': 'read files', 'files.write': 'change files', 'files.edit': 'change files',
  'files.delete': 'delete files', 'fs.delete': 'delete files', 'code.run': 'run commands', 'code.push': 'push code',
  'code.commit': 'commit code', 'db.write': 'change a database', 'db.execute': 'change a database', 'payments.pay': 'pay',
  'memory.remember': 'remember things', 'memory.write': 'remember things', 'images.generate': 'make pictures',
};
function about(capability: string | null, tool: string | null): string {
  return (capability && ASKED[capability]) || `use ${tool ?? capability ?? 'a tool'}`;
}

const WHO: Record<string, FeedItem['by']> = { agent: 'mobius', person: 'you' };

/**
 * The log, as sentences. A tool's start is left out once it has finished (its finish says what it did), and so are an
 * approval already given and a question that was then answered: what is left reads as what happened.
 */
export function feedOf(entries: readonly ActivityEntry[]): FeedItem[] {
  const out: FeedItem[] = [];
  for (const e of entries) {
    // A file Mobius changed belongs to the app that shows it: a sheet to Sheets, a note to Notes.
    const file = /^(files|fs)\./.test(e.capability ?? '') ? appOfFile(e.resource) : null;
    const on = file?.name ?? e.resource ?? '';
    const app = file?.app ?? appOfCapability(e.capability);
    // Only what actually happened (or was allowed to) is marked: a refused send changed nothing.
    const final = isFinal(e.capability) && (e.kind === 'tool.completed' || e.kind === 'permission.approved');
    const by = e.who ? (WHO[e.who] ?? 'other') : 'mobius';
    const verb = e.capability?.split('.')[1] ?? '';
    const changed = by === 'mobius' && e.kind === 'tool.completed' && /^(write|edit|add|update|draft|send|delete|execute|remember|forget|generate|pay|push|commit|run)$/.test(verb);
    const base = { seq: e.seq, when: e.tsMs, app, final, by, changed } as const;
    const tool = e.tool ?? e.capability ?? 'a tool';
    switch (e.kind) {
      case 'tool.completed': {
        const did = e.capability ? DID[e.capability] : undefined;
        out.push({ ...base, text: did ? did(on) : `Used ${tool}${on ? ` on ${on}` : ''}`, warn: false });
        break;
      }
      case 'tool.failed': out.push({ ...base, text: `Couldn’t ${about(e.capability, e.tool)}${on ? ` (${on})` : ''}`, warn: true }); break;
      case 'permission.approved': out.push({ ...base, by: 'you', text: `You let Mobius ${about(e.capability, e.tool)}${on ? ` (${on})` : ''}`, warn: false }); break;
      case 'permission.rejected': out.push({ ...base, by: 'you', text: `You didn’t let Mobius ${about(e.capability, e.tool)}${on ? ` (${on})` : ''}`, warn: false }); break;
      case 'permission.denied': out.push({ ...base, text: `Your rules stopped Mobius from trying to ${about(e.capability, e.tool)}${on ? ` (${on})` : ''}`, warn: false }); break;
      case 'permission.revoked': out.push({ ...base, by: 'you', text: `You took back Mobius’s approval to ${about(e.capability, e.tool)}`, warn: false }); break;
      default: break;
    }
  }
  return out.sort((a, b) => b.when - a.when || b.seq - a.seq);
}

export function matches(item: FeedItem, filter: ActivityFilter): boolean {
  if (filter === 'everything') return true;
  // Needs you lists conversations, not log entries.
  if (filter === 'needs') return false;
  if (filter === 'mobius') return item.by === 'mobius';
  if (filter === 'you') return item.by === 'you';
  if (filter === 'final') return item.final;
  return item.app === filter.slice(4);
}

/** How many there are for each app, most first: the sidebar's By app list. */
export function appsIn(items: readonly FeedItem[]): { app: AppId; count: number }[] {
  const counts = new Map<AppId, number>();
  for (const i of items) if (i.app) counts.set(i.app, (counts.get(i.app) ?? 0) + 1);
  return [...counts].map(([app, count]) => ({ app, count })).sort((a, b) => b.count - a.count || a.app.localeCompare(b.app));
}

/** Today, Yesterday, then the weekday for this week, then the date: the order a person scans a history in. */
export function dayLabel(when: number, now: Date): string {
  const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((start(now) - start(new Date(when))) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  const date = new Date(when);
  if (days < 7) return weekdayLabel(date, 'long');
  return formatWith(date, { month: 'long', day: 'numeric', ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }) });
}

/** The items, newest first, in one group per day. */
export function byDay(items: readonly FeedItem[], now: Date): FeedDay[] {
  const days: FeedDay[] = [];
  for (const item of items) {
    const label = dayLabel(item.when, now);
    const last = days[days.length - 1];
    if (last && last.label === label) last.items.push(item);
    else days.push({ label, items: [item] });
  }
  return days;
}
