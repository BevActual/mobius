import type { BookmarkEntry, ConversationInfo, HistoryEntry, MailMessage, NoteHit, Notebook, TaskItem, WorkbookInfo } from '@mobius/shared';

/** Everything Mobius keeps, found in one place: conversations, notes, documents and decks, sheets, mail, tasks and pages. */
export type HubKind = 'conversation' | 'note' | 'doc' | 'sheet' | 'made' | 'mail' | 'task' | 'page';
export type HubFilter = 'all' | HubKind;
export type HubTarget =
  | { app: 'agent'; conversation: string }
  | { app: 'notes'; path: string; title: string }
  | { app: 'docs'; path: string; title: string }
  | { app: 'slides'; path: string; title: string }
  | { app: 'sheets'; workbook: string; sheet: string }
  | { app: 'mail'; id: string }
  | { app: 'tasks'; list: string }
  | { app: 'design'; path: string; title: string }
  | { app: 'studio'; path: string; title: string }
  | { app: 'photo'; path: string }
  | { app: 'video'; project: string }
  | { app: 'code'; project: string }
  | { app: 'browser'; url: string };

export interface HubResult {
  key: string;
  kind: HubKind;
  title: string;
  /** Where it lives, in a few words: "Notes › Work", "Tasks › Inbox", "example.com". */
  where: string;
  /** When it last changed or was visited (ms), if known. */
  when: number | null;
  /** A due date (YYYY-MM-DD), for tasks. */
  due?: string | null;
  done?: boolean;
  target: HubTarget;
}

export const FILTERS: { id: HubFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'conversation', label: 'Conversations' },
  { id: 'note', label: 'Notes' },
  { id: 'doc', label: 'Docs' },
  { id: 'sheet', label: 'Sheets' },
  { id: 'made', label: 'Made' },
  { id: 'mail', label: 'Mail' },
  { id: 'task', label: 'Tasks' },
  { id: 'page', label: 'Pages' },
];

export interface HubSources {
  conversations: ConversationInfo[];
  /** Notes search hits for the query (empty query: none). */
  noteHits: NoteHit[];
  /** Every notebook with its pages, for recent activity. */
  notebooks: Notebook[];
  tasks: Record<string, TaskItem[]>;
  /** Docs and Slides: search hits for the query, and their folders for recent activity. */
  docHits?: NoteHit[];
  docFolders?: Notebook[];
  deckHits?: NoteHit[];
  deckFolders?: Notebook[];
  workbooks?: WorkbookInfo[];
  /** What the creative apps keep: designs and songs by folder, photos by album, video and code projects by name. */
  designFolders?: Notebook[];
  songFolders?: Notebook[];
  albums?: { name: string; photos: { path: string; name: string; modified: number }[] }[];
  videoProjects?: string[];
  codeProjects?: { name: string; modified: number }[];
  /** Mail matching the query (or the latest). */
  mail?: MailMessage[];
  history: HistoryEntry[];
  bookmarks: BookmarkEntry[];
}

const MAX = 60;
const words = (q: string) => q.toLowerCase().split(/\s+/).filter(Boolean);
const matches = (text: string, ws: string[]) => { const t = text.toLowerCase(); return ws.every((w) => t.includes(w)); };
const host = (url: string) => { try { return new URL(url).host; } catch { return url; } };

/**
 * With no query: what changed most recently, across every app (open tasks only when Tasks is the filter, since they
 * have no time of their own). With a query: everything that matches every word, names that start with it first.
 */
export function hubResults(sources: HubSources, query: string, filter: HubFilter): HubResult[] {
  const ws = words(query);
  const searching = ws.length > 0;
  const out: HubResult[] = [];
  const want = (k: HubKind) => filter === 'all' || filter === k;

  if (want('conversation')) {
    for (const c of sources.conversations) {
      if (searching && !matches(c.title, ws)) continue;
      out.push({ key: `c:${c.id}`, kind: 'conversation', title: c.title || 'New conversation', where: 'Conversation', when: c.updated_ms, target: { app: 'agent', conversation: c.id } });
    }
  }
  if (want('note')) {
    if (searching) {
      for (const h of sources.noteHits) out.push({ key: `n:${h.path}`, kind: 'note', title: h.title, where: `Notes › ${h.notebook}`, when: modifiedOf(sources.notebooks, h.path), target: { app: 'notes', path: h.path, title: h.title } });
    } else {
      for (const nb of sources.notebooks) for (const p of nb.pages) out.push({ key: `n:${p.path}`, kind: 'note', title: p.title, where: `Notes › ${nb.name}`, when: p.modified, target: { app: 'notes', path: p.path, title: p.title } });
    }
  }
  if (want('doc')) {
    for (const [app, label, hits, folders] of [['docs', 'Docs', sources.docHits, sources.docFolders], ['slides', 'Slides', sources.deckHits, sources.deckFolders]] as const) {
      if (searching) {
        for (const h of hits ?? []) out.push({ key: `${app}:${h.path}`, kind: 'doc', title: h.title, where: `${label} › ${h.notebook}`, when: modifiedOf(folders ?? [], h.path), target: { app, path: h.path, title: h.title } });
      } else {
        for (const nb of folders ?? []) for (const p of nb.pages) out.push({ key: `${app}:${p.path}`, kind: 'doc', title: p.title, where: `${label} › ${nb.name}`, when: p.modified, target: { app, path: p.path, title: p.title } });
      }
    }
  }
  if (want('sheet')) {
    for (const w of sources.workbooks ?? []) {
      if (searching && !matches(`${w.name} ${w.sheets.join(' ')}`, ws)) continue;
      out.push({ key: `s:${w.name}`, kind: 'sheet', title: w.name, where: `Sheets · ${w.sheets.length === 1 ? '1 sheet' : `${w.sheets.length} sheets`}`, when: null, target: { app: 'sheets', workbook: w.name, sheet: w.sheets[0] ?? 'Sheet 1' } });
    }
  }
  if (want('made')) {
    const add = (r: HubResult, text: string) => { if (!searching || matches(text, ws)) out.push(r); };
    for (const [app, label, folders] of [['design', 'Design', sources.designFolders], ['studio', 'Studio', sources.songFolders]] as const) {
      for (const nb of folders ?? []) for (const p of nb.pages) add({ key: `${app}:${p.path}`, kind: 'made', title: p.title, where: `${label} › ${nb.name}`, when: p.modified, target: { app, path: p.path, title: p.title } }, `${p.title} ${nb.name}`);
    }
    for (const a of sources.albums ?? []) for (const p of a.photos) add({ key: `photo:${p.path}`, kind: 'made', title: p.name, where: `Photo › ${a.name}`, when: p.modified, target: { app: 'photo', path: p.path } }, `${p.name} ${a.name}`);
    for (const v of sources.videoProjects ?? []) add({ key: `video:${v}`, kind: 'made', title: v, where: 'Video', when: null, target: { app: 'video', project: v } }, v);
    for (const c of sources.codeProjects ?? []) add({ key: `code:${c.name}`, kind: 'made', title: c.name, where: 'Code', when: c.modified, target: { app: 'code', project: c.name } }, c.name);
  }
  if (want('mail')) {
    for (const m of sources.mail ?? []) {
      const who = m.box === 'sent' ? `To ${m.to.map((p) => p.name || p.email).join(', ')}` : (m.from.name || m.from.email);
      out.push({ key: `m:${m.id}`, kind: 'mail', title: m.subject || '(no subject)', where: `Mail · ${who}`, when: m.dateMs || null, target: { app: 'mail', id: m.id } });
    }
  }
  if (want('task') && (searching || filter === 'task')) {
    for (const [list, items] of Object.entries(sources.tasks)) {
      for (const t of items) {
        if (searching ? !matches(t.text, ws) : t.done) continue;
        out.push({ key: `t:${list}:${t.line}`, kind: 'task', title: t.text, where: `Tasks › ${list}`, when: null, due: t.due, done: t.done, target: { app: 'tasks', list } });
      }
    }
  }
  if (want('page')) {
    const seen = new Set<string>();
    const pages = [...sources.bookmarks.map((b) => ({ url: b.url, title: b.title, when: b.added })), ...sources.history.map((h) => ({ url: h.url, title: h.title, when: h.visited }))];
    for (const p of pages.sort((a, b) => b.when - a.when)) {
      if (seen.has(p.url) || (searching && !matches(`${p.title} ${p.url}`, ws))) continue;
      seen.add(p.url);
      out.push({ key: `p:${p.url}`, kind: 'page', title: p.title || p.url, where: host(p.url), when: p.when, target: { app: 'browser', url: p.url } });
    }
  }

  const q = ws.join(' ');
  const starts = (r: HubResult) => (searching && r.title.toLowerCase().startsWith(q) ? 0 : 1);
  return out
    .sort((a, b) => starts(a) - starts(b) || (b.when ?? 0) - (a.when ?? 0) || (a.due ?? '9').localeCompare(b.due ?? '9'))
    .slice(0, MAX);
}

function modifiedOf(notebooks: Notebook[], path: string): number | null {
  for (const nb of notebooks) for (const p of nb.pages) if (p.path === path) return p.modified;
  return null;
}
