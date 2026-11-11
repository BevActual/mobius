import { useCallback, useEffect, useRef, useState } from 'react';
import type { TurnChanges, TurnRecord } from '@mobius/shared';
import { ReviewActions } from './ReviewBar';
import { changeTarget } from './actions';
import type { HubTarget } from './search-hub';

/** How a workspace path reads to a person: notes and task lists by name, other files by their path. */
export function describeChange(path: string): { kind: 'Note' | 'Doc' | 'Deck' | 'Sheet' | 'Tasks' | 'Calendar' | 'Code' | 'Design' | 'Board' | 'Report' | 'Article' | 'Database' | 'Photo' | 'Song' | 'Cut' | 'Skill' | 'File'; name: string } {
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
  const NAMES: Record<string, string> = { Note: 'Notes', Doc: 'Docs', Deck: 'Slides', Sheet: 'Sheets', Tasks: 'Tasks', Calendar: 'Calendar', Code: 'Code', Design: 'Design', Board: 'Canvas', Report: 'Research', Article: 'Reader', Database: 'Database', Photo: 'Photo', Song: 'Music', Cut: 'Video', Skill: 'Extensions', File: 'Files' };
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

export function ReviewStrip({ conversation, busy, onOpenItem }: { conversation: string; busy: boolean; onOpenItem?: ((target: HubTarget) => void) | undefined }) {
  const [files, setFiles] = useState<string[]>([]);
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
    const result = await window.mobius.changes?.lastTurn(conversation).catch(() => null);
    if (n !== reads.current) return;
    const changes = isChanges(result) ? result : null;
    const id = turnId(conversation, changes?.checkpoint ?? null);
    setTurn(id);
    // What is left of the turn: an app's own Keep takes its part away, the rest stays here.
    setFiles(changes && !(id && keptTurns().includes(id)) ? changes.files.filter((f) => !(id && fileKept(id, f))) : []);
  }, [conversation]);
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

  const keep = useCallback(() => {
    if (turn) keepTurn(turn, 'all');
    setFiles([]);
    setOpen(false);
  }, [turn]);
  const shown = !busy && files.length > 0;
  const discardNow = useRef(undoAll);
  discardNow.current = undoAll;
  useEffect(() => {
    if (!shown) return undefined;
    const onKey = (event: KeyboardEvent) => {
      const what = reviewShortcut(event, isTyping(event.target));
      if (!what) return;
      event.preventDefault();
      if (what === 'keep') keep(); else void discardNow.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shown, keep]);

  if (busy) return null;
  if (undone && files.length === 0) {
    return <div className="review-strip" role="status" data-state="undone"><span className="review-summary">Put back as it was before that turn.</span></div>;
  }
  if (files.length === 0) return null;
  return (
    <section className="review-strip" aria-label="Changes from the last turn" data-open={open || undefined}>
      <div className="review-head">
        <span className="review-dot" aria-hidden="true" />
        <button type="button" className="review-toggle" aria-expanded={open} title={open ? 'Hide what changed' : 'See what changed'} onClick={() => setOpen((o) => !o)}>
          <span className="review-summary">{files.length === 1 ? '1 change' : `${files.length} changes`}</span>
          <span className="review-sep" aria-hidden="true">·</span>
          <span>Review</span>
          <svg className="review-chev" viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 3 7.5 6 4.5 9" /></svg>
        </button>
        <span className="review-actions">
          {/* This one keeps everything the turn changed, so it says so, and in which apps. */}
          <ReviewActions only="keep" onKeep={keep} onDiscard={undoAll} keepText={appsOf(files).length > 1 ? 'Keep all' : 'Keep'} keepLabel={`Keep all changes from this turn (${appsOf(files).join(', ')})`} keepTitle={`Keep all changes from this turn: ${appsOf(files).join(', ')} (${modKey()}+Enter)`} />
        </span>
      </div>
      {open && (
        <ul className="review-list">
          {files.map((path) => {
            const { kind, name } = describeChange(path);
            return (
              <li key={path} className="review-item">
                <span className="review-kind">{kind}</span>
                {(() => { const target = onOpenItem ? changeTarget(path) : null; return target ? <button type="button" className="review-name link-btn" title={`Open ${name} (${path})`} onClick={() => onOpenItem?.(target)}>{name}</button> : <span className="review-name" title={path}>{name}</span>; })()}
                <button type="button" className="review-btn" aria-label={`Undo the change to ${name}`} onClick={() => void run(() => window.mobius.changes.undoFile(conversation, path))}>Undo</button>
              </li>
            );
          })}
        </ul>
      )}
      {open && (
        <div className="review-more">
          <ReviewActions only="others" onKeep={keep} onDiscard={undoAll} discardText={appsOf(files).length > 1 ? 'Discard all' : 'Discard'} discardLabel={`Discard all changes from this turn (${appsOf(files).join(', ')})`} discardTitle={`Put everything this turn changed back as it was: ${appsOf(files).join(', ')} (${modKey()}+Backspace)`} />
        </div>
      )}
      {problem && <p className="review-problem" role="alert">{problem}</p>}
    </section>
  );
}

const when = (ms: number) => {
  const d = new Date(ms);
  const today = new Date();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return d.toDateString() === today.toDateString() ? time : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
};

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
