import { useCallback, useEffect, useState } from 'react';
import type { TurnChanges } from '@mobius/shared';

/** How a workspace path reads to a person: notes and task lists by name, other files by their path. */
export function describeChange(path: string): { kind: 'Note' | 'Tasks' | 'File'; name: string } {
  const strip = (p: string) => p.replace(/\.md$/i, '');
  if (path.startsWith('notes/')) return { kind: 'Note', name: strip(path.slice('notes/'.length)).replace('/', ' / ') };
  if (path.startsWith('tasks/')) return { kind: 'Tasks', name: strip(path.slice('tasks/'.length)) };
  return { kind: 'File', name: path };
}

const isChanges = (value: unknown): value is TurnChanges => typeof value === 'object' && value !== null && 'files' in value;

/**
 * One place to review and undo what the agent changed in its last turn: notes, task lists and files together.
 * It appears when a turn ends with changes, and shows each change with its own Undo, and Undo all.
 */
export function ReviewStrip({ conversation, busy }: { conversation: string; busy: boolean }) {
  const [files, setFiles] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [undone, setUndone] = useState(false);
  const load = useCallback(async () => {
    const result = await window.mobius.changes?.lastTurn(conversation).catch(() => null);
    setFiles(isChanges(result) ? result.files : []);
  }, [conversation]);
  useEffect(() => { setOpen(false); setUndone(false); setProblem(null); }, [conversation]);
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
        <button type="button" className="review-btn" data-kind="undo" onClick={() => void undoAll()}>Undo all</button>
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
