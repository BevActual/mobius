import { useCallback, useEffect, useRef, useState } from 'react';
import type { CalendarSuggestion, MailDraft, TurnChanges, TurnRecord } from '@mobius/shared';
import { ReviewActions } from './ReviewBar';
import { changeTarget } from './actions';
import type { HubTarget } from './search-hub';
import { dateTimeLabel, nearDayLabel, timeLabel } from './dates';

/**
 * Pages' titles as their apps list them ("docs/Documents/Untitled.md" → "Release notes" once it has a heading), so a
 * change is named by what the page says now rather than the file name it was made with.
 */
const knownTitles = new Map<string, string>();
export function rememberTitles(root: string, notebooks: readonly { pages: readonly { path: string; title: string }[] }[]): void {
  for (const key of [...knownTitles.keys()]) if (key.startsWith(`${root}/`)) knownTitles.delete(key);
  for (const nb of notebooks) for (const page of nb.pages) if (page.title) knownTitles.set(`${root}/${page.path}`, page.title);
}

/** How a workspace path reads to a person: notes and task lists by name, other files by their path. */
export function describeChange(path: string): ReturnType<typeof describeFile> {
  const p = path.replace(/\\/g, '/');
  // A page's comments are kept beside it (docs/.comments/Documents/Plan.json): they read as the page's comments.
  const comments = /^(notes|docs|slides|research|reading)\/\.comments\/(.+)\.json$/i.exec(p);
  if (comments) { const page = describeChange(`${comments[1]}/${comments[2]}.md`); return { kind: page.kind, name: `Comments on ${page.name}` }; }
  if (p === 'calendar/.suggestions.json') return { kind: 'Calendar', name: 'Suggested events' };
  const title = knownTitles.get(p);
  const described = describeFile(p);
  const folder = p.split('/')[1];
  return title ? { kind: described.kind, name: p.split('/').length === 3 && folder ? `${folder} / ${title}` : title } : described;
}

function describeFile(path: string): { kind: 'Note' | 'Doc' | 'Deck' | 'Sheet' | 'Tasks' | 'Calendar' | 'Code' | 'Design' | 'Board' | 'Report' | 'Article' | 'Database' | 'Photo' | 'Song' | 'Cut' | 'Skill' | 'File'; name: string } {
  const strip = (p: string) => p.replace(/\.md$/i, '');
  if (path.startsWith('notes/')) return { kind: 'Note', name: strip(path.slice('notes/'.length)).replace('/', ' / ') };
  if (path.startsWith('docs/')) return { kind: 'Doc', name: strip(path.slice('docs/'.length)).replace('/', ' / ') };
  if (path.startsWith('slides/')) return { kind: 'Deck', name: strip(path.slice('slides/'.length)).replace('/', ' / ') };
  if (path.startsWith('sheets/')) return { kind: 'Sheet', name: path.slice('sheets/'.length).replace(/\.csv$/i, '').replace('/', ' › ') };
  if (path.startsWith('tasks/')) return { kind: 'Tasks', name: strip(path.slice('tasks/'.length)) };
  if (path.startsWith('skills/')) return { kind: 'Skill', name: `/${path.slice('skills/'.length).split('/')[0]!}` };
  if (path.startsWith('video/')) return { kind: 'Cut', name: path.slice('video/'.length).split('/')[0]! };
  if (path.startsWith('studio/')) return { kind: 'Song', name: path.slice('studio/'.length).replace(/\.json$/i, '').replace('/', ' / ') };
  if (path.startsWith('photos/')) return { kind: 'Photo', name: path.slice('photos/'.length).replace(/\.edits\.json$/i, '').replace('/', ' / ') };
  if (path.startsWith('designs/')) return { kind: 'Design', name: path.slice('designs/'.length).replace(/\.json$/i, '').replace('/', ' / ') };
  if (path.startsWith('databases/')) return { kind: 'Database', name: path.slice('databases/'.length).replace(/\.sqlite$/i, '') };
  if (path.startsWith('reading/')) return { kind: 'Article', name: strip(path.slice('reading/'.length)).replace('/', ' / ') };
  if (path.startsWith('research/')) return { kind: 'Report', name: strip(path.slice('research/'.length)).replace('/', ' / ') };
  if (path.startsWith('boards/')) return { kind: 'Board', name: path.slice('boards/'.length).replace(/\.json$/i, '').replace('/', ' / ') };
  if (path.startsWith('code/')) return { kind: 'Code', name: path.slice('code/'.length).replace('/', ' › ') };
  if (path.startsWith('calendar/')) return { kind: 'Calendar', name: path.slice('calendar/'.length).replace(/\.ics$/i, '') };
  return { kind: 'File', name: path };
}

const isChanges = (value: unknown): value is TurnChanges => typeof value === 'object' && value !== null && 'files' in value;

/**
 * What a Keep covers: one app's changes in a turn (Keep on the Tasks bar keeps the tasks, not the calendar events or a
 * sheet the person never saw), or the whole turn ('all': the strip under the conversation, which says so).
 */
export type KeepScope = 'all' | 'notes' | 'docs' | 'slides' | 'sheets' | 'tasks' | 'calendar' | 'design' | 'canvas' | 'research' | 'reader' | 'database' | 'studio' | 'photo' | 'video' | 'code' | 'skills';
/** The workspace folders each app's changes are in. */
const SCOPE_FOLDERS: Record<Exclude<KeepScope, 'all'>, string> = { notes: 'notes/', docs: 'docs/', slides: 'slides/', sheets: 'sheets/', tasks: 'tasks/', calendar: 'calendar/', design: 'designs/', canvas: 'boards/', research: 'research/', reader: 'reading/', database: 'databases/', studio: 'studio/', photo: 'photos/', video: 'video/', code: 'code/', skills: 'skills/' };

/** The app a workspace file's change belongs to, for that app's own Keep ('all' for a file no app shows). */
export function scopeOf(path: string): KeepScope {
  const p = path.replace(/\\/g, '/');
  const found = (Object.entries(SCOPE_FOLDERS) as [Exclude<KeepScope, 'all'>, string][]).find(([, folder]) => p.startsWith(folder));
  return found ? found[0] : 'all';
}

/** Turns (or one app's part of a turn, as "turn|tasks") whose changes were kept, so they are not offered again. A few, on this computer only. */
const KEPT_KEY = 'mobius.keptTurns';
const MAX_KEPT = 100;
const keptEntries = (): string[] => { try { const v: unknown = JSON.parse(window.localStorage.getItem(KEPT_KEY) ?? '[]'); return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []; } catch { return []; } };
/** Turns kept as a whole, or (given an app) kept for that app. */
export const keptTurns = (scope: KeepScope = 'all'): string[] => keptEntries().flatMap((e) => {
  const [id, app] = e.split('|') as [string, string | undefined];
  return app === undefined || (scope !== 'all' && app === scope) ? [id] : [];
});
/** Whether this file's change in that turn was kept, as part of the whole turn or of its app's part. */
export const fileKept = (id: string, path: string): boolean => keptEntries().some((e) => {
  const [turn, app] = e.split('|') as [string, string | undefined];
  return turn === id && (app === undefined || path.startsWith(SCOPE_FOLDERS[app as Exclude<KeepScope, 'all'>] ?? '\u0000'));
});
/**
 * Keep a turn's changes (all of them, or one app's), wherever that was said, and let every place showing them know.
 * An app's own bar passes its scope; without one the whole turn is kept.
 */
export const keepTurn = (id: string, scope: KeepScope = 'all') => {
  const entry = scope === 'all' ? id : `${id}|${scope}`;
  try { window.localStorage.setItem(KEPT_KEY, JSON.stringify([...keptEntries().filter((x) => x !== entry), entry].slice(-MAX_KEPT))); } catch { /* Not kept. */ }
  window.dispatchEvent(new CustomEvent(KEPT_EVENT, { detail: id }));
};
/** The apps a list of changed files belongs to, by name, in the order they first appear: "Tasks, Calendar, Sheets". */
export function appsOf(paths: readonly string[]): string[] {
  const NAMES: Record<string, string> = { Note: 'Notes', Doc: 'Docs', Deck: 'Slides', Sheet: 'Sheets', Tasks: 'Tasks', Calendar: 'Calendar', Code: 'Code', Design: 'Design', Board: 'Canvas', Report: 'Research', Article: 'Reader', Database: 'Database', Photo: 'Photo', Song: 'Music', Cut: 'Video', Skill: 'Abilities', File: 'Files' };
  const out: string[] = [];
  for (const p of paths) { const name = NAMES[describeChange(p).kind] ?? 'Files'; if (!out.includes(name)) out.push(name); }
  return out;
}
export const KEPT_EVENT = 'mobius:kept';
/** The id a turn's changes are kept under. */
export const turnId = (conversation: string, checkpoint: string | null) => (checkpoint ? `${conversation}:${checkpoint}` : null);

/** Keep and Discard answer from anywhere in the window, except where they would change text you are typing. */
export function reviewShortcut(event: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }, typing: boolean): 'keep' | 'discard' | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || typing) return null;
  if (event.key === 'Enter') return 'keep';
  if (event.key === 'Backspace') return 'discard';
  return null;
}
const isTyping = (target: EventTarget | null): boolean => {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.value !== '';
  return el.isContentEditable === true;
};

/**
 * One place to review what the agent changed in its last turn: notes, task lists and files together. Like every
 * proposal in Mobius it waits for you: Keep it (Cmd/Ctrl+Enter) or Discard it (Cmd/Ctrl+Backspace), or undo one
 * change at a time under Review.
 */
const modKey = () => (window.mobius?.platform === 'darwin' ? 'Cmd' : 'Ctrl');

/** Replies Mobius suggested in Mail since the turn began: changes too, though they live in Mail and not in a file. */
async function suggestedSince(since: number | undefined): Promise<MailDraft[]> {
  if (since === undefined) return [];
  const got = await window.mobius.mail?.drafts().catch(() => null);
  return Array.isArray(got) ? got.filter((d) => d.by === 'mobius' && d.updatedMs >= since) : [];
}

/** Where Calendar keeps the events Mobius suggests, waiting to be added. */
export const SUGGESTIONS_FILE = 'calendar/.suggestions.json';
const suggestionIds = (text: string | null): Set<string> => {
  try {
    const v: unknown = JSON.parse(text ?? '[]');
    const list = Array.isArray(v) ? v : v && typeof v === 'object' && Array.isArray((v as { suggestions?: unknown }).suggestions) ? (v as { suggestions: unknown[] }).suggestions : [];
    return new Set(list.flatMap((x) => (x && typeof x === 'object' && typeof (x as { id?: unknown }).id === 'string' ? [(x as { id: string }).id] : [])));
  } catch { return new Set(); }
};
/** The events this turn suggested in Calendar: waiting now, and not before the turn. */
/** The events in a calendar file, by id: its title and start (YYYYMMDD…), from the file's iCalendar text. */
export function icsEvents(text: string): Map<string, { title: string; start: string }> {
  const out = new Map<string, { title: string; start: string }>();
  const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  let at: { uid?: string; title?: string; start?: string } | null = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') at = {};
    else if (line === 'END:VEVENT') { if (at?.uid) out.set(at.uid, { title: at.title ?? '', start: at.start ?? '' }); at = null; }
    else if (at) {
      const colon = line.indexOf(':');
      const name = line.slice(0, colon).split(';')[0]!.toUpperCase();
      const value = line.slice(colon + 1);
      if (name === 'UID') at.uid = value.trim();
      else if (name === 'SUMMARY') at.title = value.replace(/\\([,;\\])/g, '$1').replace(/\\n/gi, ' ');
      else if (name === 'DTSTART') at.start = value.trim();
    }
  }
  return out;
}

/** What a turn did to one calendar file, by event: the titles it added or changed, and the day of the first one. */
async function calendarChangesInTurn(conversation: string, path: string): Promise<{ names: string[]; date: string | null }> {
  const calendar = path.replace(/\\/g, '/').replace(/^calendar\//, '').replace(/\.ics$/i, '');
  const today = new Date();
  const day = (offset: number) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset).toLocaleDateString('en-CA');
  const [was, now] = await Promise.all([
    window.mobius.changes.before(conversation, path).catch(() => null),
    window.mobius.calendar?.events(day(-366), day(366)).catch(() => null),
  ]);
  if (!Array.isArray(now)) return { names: [], date: null };
  const before = was && was.ok && was.text ? icsEvents(was.text) : new Map<string, { title: string; start: string }>();
  const changed = now.filter((e) => e.calendar === calendar).filter((e) => {
    const old = before.get(e.id);
    return !old || old.title !== e.title || old.start.slice(0, 8) !== e.start.replace(/-/g, '').slice(0, 8);
  });
  const nowIds = new Set(now.filter((e) => e.calendar === calendar).map((e) => e.id));
  const removed = [...before.entries()].filter(([id]) => !nowIds.has(id)).map(([, e]) => `Removed: ${e.title || 'an event'}`);
  return { names: [...changed.map((e) => e.title), ...removed], date: changed[0]?.start.slice(0, 10) ?? null };
}

async function suggestedInTurn(conversation: string): Promise<CalendarSuggestion[]> {
  const [was, now] = await Promise.all([window.mobius.changes.before(conversation, SUGGESTIONS_FILE).catch(() => null), window.mobius.calendar?.suggestions().catch(() => null)]);
  if (!Array.isArray(now)) return [];
  const before = was && was.ok ? suggestionIds(was.text) : new Set<string>();
  return now.filter((x) => !before.has(x.id));
}

export function ReviewStrip({ conversation, busy, onOpenItem, since }: { conversation: string; busy: boolean; onOpenItem?: ((target: HubTarget) => void) | undefined; /** When the last turn was asked (ms): replies Mobius suggested in Mail since then are part of it. */ since?: number | undefined }) {
  const [files, setFiles] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<MailDraft[]>([]);
  const [suggested, setSuggested] = useState<CalendarSuggestion[]>([]);
  // A calendar file is listed by the events the turn added or changed in it, not by the file's name.
  const [events, setEvents] = useState<Record<string, { names: string[]; date: string | null }>>({});
  const [turn, setTurn] = useState<string | null>(null);
  // Open from the start: what the turn changed is listed, each one a link to it.
  const [open, setOpen] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  const [undone, setUndone] = useState(false);
  // Only the latest read counts: an earlier one (when the strip appeared, before the turn) can come back last on a busy
  // computer, and would say nothing changed.
  const reads = useRef(0);
  const load = useCallback(async () => {
    const n = ++reads.current;
    const [result, suggested] = await Promise.all([window.mobius.changes?.lastTurn(conversation).catch(() => null), suggestedSince(since)]);
    if (n !== reads.current) return;
    setDrafts(suggested);
    const changes = isChanges(result) ? result : null;
    const id = turnId(conversation, changes?.checkpoint ?? null);
    setTurn(id);
    // What is left of the turn: an app's own Keep takes its part away, the rest stays here.
    const waiting = changes && !(id && keptTurns().includes(id)) ? changes.files.filter((f) => !(id && fileKept(id, f))) : [];
    // Suggested events are listed by their titles, not as the file Calendar keeps them in.
    const events = waiting.some((f) => f.replace(/\\/g, '/') === SUGGESTIONS_FILE) ? await suggestedInTurn(conversation) : [];
    const calendars = waiting.filter((f) => /^calendar\/[^/]+\.ics$/i.test(f.replace(/\\/g, '/')));
    const named = Object.fromEntries(await Promise.all(calendars.map(async (f) => [f, await calendarChangesInTurn(conversation, f)] as const)));
    if (n !== reads.current) return;
    setSuggested(events);
    setEvents(named);
    setFiles(waiting);
  }, [conversation, since]);
  useEffect(() => { setOpen(true); setUndone(false); setProblem(null); }, [conversation]);
  // Kept from a note's own bar: the strip goes too.
  useEffect(() => {
    const kept = () => void load();
    window.addEventListener(KEPT_EVENT, kept);
    return () => window.removeEventListener(KEPT_EVENT, kept);
  }, [load]);
  // Read when a turn ends, and when another conversation is shown.
  useEffect(() => { if (!busy) void load(); else { setUndone(false); setProblem(null); } }, [busy, load]);

  const run = async (action: () => Promise<{ ok: true } | { ok: false; error: string }>): Promise<string | null> => {
    setProblem(null);
    const result = await action().catch(() => ({ ok: false as const, error: 'That could not be undone.' }));
    if (!result.ok) { setProblem(result.error); return result.error; }
    await load();
    return null;
  };
  // Only what this turn changed goes back, one item at a time, so edits made since in other files are kept.
  const undoAll = async (): Promise<string | null> => {
    setProblem(null);
    // A suggested reply is discarded as Mail's own Discard does it: deleted, never sent.
    for (const d of drafts) await window.mobius.mail?.deleteDraft(d.id).catch(() => undefined);
    setDrafts([]);
    for (const path of files) {
      const result = await window.mobius.changes.undoFile(conversation, path).catch(() => ({ ok: false as const, error: 'That could not be undone.' }));
      if (!result.ok) { setProblem(result.error); void load(); return result.error; }
    }
    // Say so at once: reading the turn again is slow on some computers. The core still lists a turn after it is put
    // back, so it is settled as a kept one is, and the strip does not return for it.
    setFiles([]);
    setUndone(true);
    setOpen(false);
    if (turn) keepTurn(turn);
    return null;
  };

  const keep = useCallback(async () => {
    setFiles([]);
    setDrafts([]);
    setSuggested([]);
    setOpen(false);
    // A suggested reply is kept as Mail's own Keep does it: it becomes the person's draft, to change and send. Never sent.
    // A suggested event is kept as Calendar's own Keep does it: added to the calendar. Both are settled before the
    // turn is marked kept, so reading the turn again does not find them still waiting.
    await Promise.all([
      ...drafts.map((d) => window.mobius.mail?.saveDraft({ ...d, by: 'you' }).catch(() => undefined)),
      ...suggested.map((x) => window.mobius.calendar?.accept(x.id).catch(() => undefined)),
    ]);
    if (turn) keepTurn(turn, 'all');
  }, [turn, drafts, suggested]);
  // What the strip lists: the files the turn changed, then the replies it suggested in Mail.
  const listed = suggested.length > 0 ? files.filter((f) => f.replace(/\\/g, '/') !== SUGGESTIONS_FILE) : files;
  const apps = [...appsOf(files), ...(drafts.length > 0 && !appsOf(files).includes('Mail') ? ['Mail'] : [])];
  const count = listed.length + suggested.length + drafts.length;
  const shown = !busy && count > 0;
  const discardNow = useRef(undoAll);
  discardNow.current = undoAll;
  useEffect(() => {
    if (!shown) return undefined;
    const onKey = (event: KeyboardEvent) => {
      const what = reviewShortcut(event, isTyping(event.target));
      if (!what) return;
      event.preventDefault();
      if (what === 'keep') void keep(); else void discardNow.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shown, keep]);

  if (busy) return null;
  if (undone && count === 0) {
    return <div className="review-strip" role="status" data-state="undone"><span className="review-summary">Put back as it was before that turn.</span></div>;
  }
  if (count === 0) return null;
  return (
    <section className="review-strip" aria-label="Changes from the last turn" data-open={open || undefined}>
      <div className="review-head">
        <span className="review-dot" aria-hidden="true" />
        <button type="button" className="review-toggle" aria-expanded={open} title={open ? 'Hide what changed' : 'See what changed'} onClick={() => setOpen((o) => !o)}>
          {/* Where the changes are, so a change in an app not on screen is not missed: "4 changes in Tasks, Calendar". */}
          <span className="review-summary">{count === 1 ? '1 change' : `${count} changes`}{` in ${apps.join(', ')}`}</span>
          <span className="review-sep" aria-hidden="true">·</span>
          <span>Review</span>
          <svg className="review-chev" viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 3 7.5 6 4.5 9" /></svg>
        </button>
        <span className="review-actions">
          {/* This one keeps everything the turn changed, so it says so, and in which apps. */}
          <ReviewActions only="keep" onKeep={keep} onDiscard={undoAll} keepText={apps.length > 1 ? 'Keep all' : 'Keep'} keepLabel={`Keep all changes from this turn (${apps.join(', ')})`} keepTitle={`Keep all changes from this turn: ${apps.join(', ')} (${modKey()}+Enter)`} />
        </span>
      </div>
      {open && (
        <ul className="review-list">
          {listed.map((path) => {
            const described = describeChange(path);
            const inCalendar = events[path];
            const kind = inCalendar && inCalendar.names.length > 0 ? (inCalendar.names.length === 1 ? 'Event' : 'Events') : described.kind;
            const name = inCalendar && inCalendar.names.length > 0 ? (inCalendar.names.length > 2 ? `${inCalendar.names.slice(0, 2).join(', ')} and ${inCalendar.names.length - 2} more` : inCalendar.names.join(', ')) : described.name;
            return (
              <li key={path} className="review-item">
                <span className="review-kind">{kind}</span>
                {(() => { const target = onOpenItem ? (inCalendar?.date ? { app: 'calendar' as const, date: inCalendar.date } : changeTarget(path)) : null; return target ? <button type="button" className="review-name link-btn" title={`Open ${name} (${path})`} onClick={() => onOpenItem?.(target)}>{name}</button> : <span className="review-name" title={path}>{name}</span>; })()}
                <button type="button" className="review-btn" aria-label={`Undo the change to ${name}`} onClick={() => void run(() => window.mobius.changes.undoFile(conversation, path))}>Undo</button>
              </li>
            );
          })}
          {suggested.map((x) => (
            <li key={x.id} className="review-item">
              <span className="review-kind">Event</span>
              {onOpenItem
                ? <button type="button" className="review-name link-btn" title={`Open ${x.title} in Calendar`} onClick={() => onOpenItem({ app: 'calendar', date: x.start.slice(0, 10) })}>{x.title}</button>
                : <span className="review-name">{x.title}</span>}
              <button type="button" className="review-btn" aria-label={`Decline the suggested event ${x.title}`} onClick={() => void window.mobius.calendar?.decline(x.id).then(() => load())}>Undo</button>
            </li>
          ))}
          {drafts.map((d) => (
            <li key={d.id} className="review-item">
              <span className="review-kind">Email</span>
              {onOpenItem && d.replyTo
                ? <button type="button" className="review-name link-btn" title={`Open the message this answers: ${d.subject}`} onClick={() => onOpenItem({ app: 'mail', id: d.replyTo! })}>{d.subject || 'Suggested reply'}</button>
                : <span className="review-name">{d.subject || 'Suggested email'}</span>}
              <button type="button" className="review-btn" aria-label={`Discard the suggested email ${d.subject}`} onClick={() => void window.mobius.mail?.deleteDraft(d.id).then(() => load())}>Undo</button>
            </li>
          ))}
        </ul>
      )}
      {open && (
        <div className="review-more">
          <ReviewActions only="others" onKeep={keep} onDiscard={undoAll} discardText={apps.length > 1 ? 'Discard all' : 'Discard'} discardLabel={`Discard all changes from this turn (${apps.join(', ')})`} discardTitle={`Put everything this turn changed back as it was: ${apps.join(', ')} (${modKey()}+Backspace)`} />
        </div>
      )}
      {problem && <p className="review-problem" role="alert">{problem}</p>}
    </section>
  );
}

const when = (ms: number) => (nearDayLabel(ms) === 'Today' ? timeLabel(ms) : dateTimeLabel(ms));

/**
 * Every earlier turn of the conversation that changed something, newest first: what was asked, what it changed, and
 * each item put back as it was before that turn. Something changed again since asks once more before it is put back.
 */
export function TurnHistory({ conversation, busy }: { conversation: string; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<TurnRecord[]>([]);
  const [asking, setAsking] = useState<{ start: string; path: string; why: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const load = useCallback(async () => {
    const result = await window.mobius.changes?.turns?.(conversation).catch(() => null);
    setTurns(result && result.ok ? result.turns.filter((t) => t.files.length > 0) : []);
  }, [conversation]);
  useEffect(() => { setOpen(false); setAsking(null); setProblem(null); }, [conversation]);
  useEffect(() => { if (!busy) void load(); }, [busy, load]);
  // The newest turn is the one the review strip shows; this lists the ones before it.
  const older = turns.slice(1);
  if (busy || older.length === 0) return null;
  const undo = async (start: string, path: string, force = false) => {
    setProblem(null);
    const result = await window.mobius.changes.undoTurnFile(conversation, start, path, force).catch(() => ({ ok: false as const, error: 'That could not be put back.' }));
    if (!result.ok) {
      if ('later' in result && result.later) setAsking({ start, path, why: result.error });
      else setProblem(result.error);
      return;
    }
    setAsking(null);
    await load();
  };
  return (
    <section className="turn-history" aria-label="Earlier changes">
      <button type="button" className="review-btn turn-history-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? 'Hide earlier changes' : `Earlier changes · ${older.length === 1 ? '1 turn' : `${older.length} turns`}`}
      </button>
      {open && (
        <ol className="turn-history-list">
          {older.map((t) => (
            <li key={`${t.start}-${t.when}`} className="turn-history-turn" aria-label={`Turn at ${when(t.when)}`}>
              <div className="turn-history-head">
                <span className="turn-history-ask">{t.ask ? `“${t.ask}”` : 'A turn'}</span>
                <span className="turn-history-when">{when(t.when)}</span>
              </div>
              <ul className="review-list">
                {t.files.map((path) => {
                  const { kind, name } = describeChange(path);
                  const here = asking?.start === t.start && asking.path === path;
                  return (
                    <li key={path} className="review-item">
                      <span className="review-kind">{kind}</span>
                      <span className="review-name" title={path}>{name}</span>
                      {here ? (
                        <>
                          <span className="turn-history-warn" role="alert">{asking.why}</span>
                          <button type="button" className="review-btn" onClick={() => setAsking(null)}>Leave it</button>
                          <button type="button" className="review-btn" data-kind="keep" onClick={() => void undo(t.start, path, true)}>Put back anyway</button>
                        </>
                      ) : (
                        <button type="button" className="review-btn" aria-label={`Put back ${name} as it was before this turn`} onClick={() => void undo(t.start, path)}>Put back</button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ol>
      )}
      {problem && <p className="review-problem" role="alert">{problem}</p>}
    </section>
  );
}
