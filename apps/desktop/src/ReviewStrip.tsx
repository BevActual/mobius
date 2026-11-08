import { useCallback, useEffect, useRef, useState } from 'react';
import type { TurnChanges } from '@mobius/shared';

/** How a workspace path reads to a person: notes and task lists by name, other files by their path. */
export function describeChange(path: string): { kind: 'Note' | 'Tasks' | 'Calendar' | 'File'; name: string } {
  const strip = (p: string) => p.replace(/\.md$/i, '');
  if (path.startsWith('notes/')) return { kind: 'Note', name: strip(path.slice('notes/'.length)).replace('/', ' / ') };
  if (path.startsWith('tasks/')) return { kind: 'Tasks', name: strip(path.slice('tasks/'.length)) };
  if (path.startsWith('calendar/')) return { kind: 'Calendar', name: path.slice('calendar/'.length).replace(/\.ics$/i, '') };
  return { kind: 'File', name: path };
}

const isChanges = (value: unknown): value is TurnChanges => typeof value === 'object' && value !== null && 'files' in value;

/** Turns whose changes were kept, so the strip does not come back for them. A few, on this computer only. */
const KEPT_KEY = 'mobius.keptTurns';
const MAX_KEPT = 50;
export const keptTurns = (): string[] => { try { const v: unknown = JSON.parse(window.localStorage.getItem(KEPT_KEY) ?? '[]'); return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []; } catch { return []; } };
/** Keep a turn's changes, wherever that was said (the strip or a note), and let every place showing them know. */
export const keepTurn = (id: string) => {
  try { window.localStorage.setItem(KEPT_KEY, JSON.stringify([...keptTurns().filter((x) => x !== id), id].slice(-MAX_KEPT))); } catch { /* Not kept. */ }
  window.dispatchEvent(new CustomEvent(KEPT_EVENT, { detail: id }));
};
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

export function ReviewStrip({ conversation, busy }: { conversation: string; busy: boolean }) {
  const [files, setFiles] = useState<string[]>([]);
  const [turn, setTurn] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [undone, setUndone] = useState(false);
  const load = useCallback(async () => {
    const result = await window.mobius.changes?.lastTurn(conversation).catch(() => null);
    const changes = isChanges(result) ? result : null;
    const id = turnId(conversation, changes?.checkpoint ?? null);
    setTurn(id);
    setFiles(changes && !(id && keptTurns().includes(id)) ? changes.files : []);
  }, [conversation]);
  useEffect(() => { setOpen(false); setUndone(false); setProblem(null); }, [conversation]);
  // Kept from a note's own bar: the strip goes too.
  useEffect(() => {
    const kept = () => void load();
    window.addEventListener(KEPT_EVENT, kept);
    return () => window.removeEventListener(KEPT_EVENT, kept);
  }, [load]);
  // Read when a turn ends, and when another conversation is shown.
  useEffect(() => { if (!busy) void load(); else { setUndone(false); setProblem(null); } }, [busy, load]);

  const run = async (action: () => Promise<{ ok: true } | { ok: false; error: string }>) => {
    setProblem(null);
    const result = await action().catch(() => ({ ok: false as const, error: 'That could not be undone.' }));
    if (!result.ok) { setProblem(result.error); return; }
    await load();
  };
  // Only what this turn changed goes back, one item at a time, so edits made since in other files are kept.
  const undoAll = async () => {
    await run(async () => {
      for (const path of files) {
        const result = await window.mobius.changes.undoFile(conversation, path);
        if (!result.ok) return result;
      }
      return { ok: true as const };
    });
    setUndone(true);
    setOpen(false);
  };

  const keep = useCallback(() => {
    if (turn) keepTurn(turn);
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
        <span className="review-summary">Changed {files.length === 1 ? '1 item' : `${files.length} items`}</span>
        <button type="button" className="review-btn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{open ? 'Hide' : 'Review'}</button>
        <button type="button" className="review-btn" title={`Put everything back as it was (${modKey()}+Backspace)`} onClick={() => void undoAll()}>Discard</button>
        <button type="button" className="review-btn" data-kind="keep" title={`Keep these changes (${modKey()}+Enter)`} onClick={keep}>Keep</button>
      </div>
      {open && (
        <ul className="review-list">
          {files.map((path) => {
            const { kind, name } = describeChange(path);
            return (
              <li key={path} className="review-item">
                <span className="review-kind">{kind}</span>
                <span className="review-name" title={path}>{name}</span>
                <button type="button" className="review-btn" aria-label={`Undo the change to ${name}`} onClick={() => void run(() => window.mobius.changes.undoFile(conversation, path))}>Undo</button>
              </li>
            );
          })}
        </ul>
      )}
      {problem && <p className="review-problem" role="alert">{problem}</p>}
    </section>
  );
}
