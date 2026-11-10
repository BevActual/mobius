import { KEPT_EVENT, keepTurn, keptTurns, turnId } from './ReviewStrip';
import { useEffect, useRef, useState } from 'react';
import { onCommand } from './commands';
import { liveTitle } from './notes-state';
import { changeGroups, diffCounts, diffLines, undoGroup, type DiffLine } from './line-diff';
import type { NotesState } from './useNotes';
import { CHECKLIST, TABLE, clipBlock, insertBlock, recordingBlock } from './note-insert';
import { useDictation } from './composer/useDictation';
import { ReviewActions } from './ReviewBar';

/** How long a recording in a note may run: ten minutes. */
const NOTE_RECORDING_SECONDS = 600;

/** What you can do with text selected in a note, right where it is. */
export type SelectionAction = 'ask' | 'rewrite' | 'summarise' | 'task';
const ACTIONS: { id: SelectionAction; label: string; title: string }[] = [
  { id: 'ask', label: 'Ask', title: 'Ask the agent about this' },
  { id: 'rewrite', label: 'Rewrite', title: 'Have the agent rewrite this in the note' },
  { id: 'summarise', label: 'Summarise', title: 'Have the agent summarise this' },
  { id: 'task', label: 'Make a task', title: 'Add this as a task' },
];

/** The open page. Plain Markdown, saved as you type; a page the assistant changed meanwhile is never overwritten. */
/** `autoFocus` is off when the page opens in the pane beside the one you are working in, so typing stays where it was. */
/** `review`: the agent's last turn changed this page; the editor offers to show what changed and to put it back. */
export function NoteEditor({ notes, autoFocus = true, onSelection, review }: { notes: NotesState; autoFocus?: boolean; onSelection?: (action: SelectionAction, text: string) => void; review?: { conversation: string } | null }) {
  const area = useRef<HTMLTextAreaElement>(null);
  const path = notes.page?.path;
  const focusOnOpen = useRef(autoFocus);
  focusOnOpen.current = autoFocus;
  useEffect(() => { if (path && focusOnOpen.current) area.current?.focus(); }, [path]);
  // The selection bar sits just above where the pointer let go, or at the top when the selection came from the keyboard.
  const [selection, setSelection] = useState<{ text: string; top: number; left: number } | null>(null);
  // Where the cursor was last, so Insert puts things there even after its button took the focus.
  const caret = useRef<number | null>(null);
  useEffect(() => { caret.current = null; }, [path]);
  const [clipping, setClipping] = useState<string | null>(null);
  const [insertProblem, setInsertProblem] = useState<string | null>(null);
  const recordedFor = useRef(0);
  const put = (text: string) => {
    const field = area.current;
    const at = field && document.activeElement === field ? field.selectionStart : caret.current ?? notes.text.length;
    const done = insertBlock(notes.text, at, text);
    notes.edit(done.page);
    caret.current = done.cursor;
    window.requestAnimationFrame(() => { const f = area.current; if (f) { f.focus(); f.setSelectionRange(done.cursor, done.cursor); } });
  };
  const recording = useDictation((words) => put(recordingBlock(words, recordedFor.current)), NOTE_RECORDING_SECONDS);
  recordedFor.current = recording.seconds;
  const clip = async (url: string) => {
    const address = /^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`;
    const got = await window.mobius.reading?.fetch(address);
    if (!got) { setInsertProblem('Clipping is not available here.'); return; }
    if (!got.ok) { setInsertProblem(`That page could not be clipped: ${got.message}.`); return; }
    setClipping(null);
    setInsertProblem(null);
    put(clipBlock(got));
  };
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const pressedAt = useRef<number | null>(null);
  useEffect(() => setSelection(null), [path]);
  // What the last turn changed on this page, line by line, read only while it is shown.
  const [diff, setDiff] = useState<DiffLine[] | null>(null);
  // The page as it was before the turn; null when the turn made the page.
  const [before, setBefore] = useState<string | null>(null);
  const [reviewProblem, setReviewProblem] = useState<string | null>(null);
  // Keep is for the whole turn, as in the strip under the conversation; a page of a kept turn shows no bar.
  const [kept, setKept] = useState(false);
  useEffect(() => {
    let live = true;
    const check = async () => {
      if (!review) { setKept(false); return; }
      const last = await window.mobius.changes?.lastTurn(review.conversation).catch(() => null);
      const id = last && 'checkpoint' in last ? turnId(review.conversation, last.checkpoint) : null;
      if (live) setKept(id !== null && keptTurns().includes(id));
    };
    void check();
    window.addEventListener(KEPT_EVENT, check);
    return () => { live = false; window.removeEventListener(KEPT_EVENT, check); };
    // Checked again when the page changes: a new turn's change is not kept yet.
  }, [review?.conversation, path, notes.page?.base]); // eslint-disable-line react-hooks/exhaustive-deps
  const keepChanges = async () => {
    if (!review) return;
    const last = await window.mobius.changes?.lastTurn(review.conversation).catch(() => null);
    const id = last && 'checkpoint' in last ? turnId(review.conversation, last.checkpoint) : null;
    if (id) keepTurn(id);
    setDiff(null);
    setKept(true);
  };
  useEffect(() => { setDiff(null); setBefore(null); setReviewProblem(null); }, [path, review?.conversation]);
  const compare = (was: string | null, now: string): DiffLine[] => (was === null ? now.split('\n').map((text) => ({ kind: 'added' as const, text })) : diffLines(was, now));
  const showChanges = async () => {
    if (!review || !path) return;
    const before = await window.mobius.changes.before(review.conversation, `notes/${path}`).catch(() => null);
    if (!before || !before.ok) { setReviewProblem(before && !before.ok ? before.error : 'The earlier version could not be read.'); return; }
    setBefore(before.text);
    setDiff(compare(before.text, notes.text));
  };
  // One change put back; the rest of the turn's changes stay. Saved like any edit of yours, so it can be typed over.
  const undoOne = (group: number) => {
    if (!diff) return;
    const next = undoGroup(diff, group);
    notes.edit(next);
    const rest = compare(before, next);
    setDiff(rest.some((line) => line.kind !== 'same') ? rest : null);
  };
  // The Notes menu's "Show what the agent changed".
  const showLatest = useRef(showChanges);
  showLatest.current = showChanges;
  useEffect(() => onCommand('show-changes', () => void showLatest.current()), []);
  const undoChanges = async () => {
    if (!review || !path) return;
    const result = await window.mobius.changes.undoFile(review.conversation, `notes/${path}`).catch(() => ({ ok: false as const, error: 'That could not be undone.' }));
    if (!result.ok) setReviewProblem(result.error);
    setDiff(null);
  };
  const readSelection = () => {
    const field = area.current;
    const box = field?.parentElement?.getBoundingClientRect();
    if (!field || !box || !onSelection) return;
    const text = field.value.slice(field.selectionStart, field.selectionEnd);
    if (text.trim().length < 2) { setSelection(null); return; }
    const at = pointer.current;
    // Above the higher end of the drag, so the bar never covers the first line of what was chosen.
    const highest = at ? Math.min(at.y, pressedAt.current ?? at.y) : null;
    const top = highest !== null ? Math.max(8, highest - box.top - 52) : 8;
    const left = at ? Math.min(Math.max(8, at.x - box.left - 150), Math.max(8, box.width - 320)) : Math.max(8, box.width - 320);
    setSelection({ text, top, left });
  };

  if (!notes.page) {
    return (
      <section className="note-editor empty" aria-label="Note">
        <p className="note-empty">{notes.notebooks.length ? 'Choose a page, or make a new one.' : 'Make a notebook to start.'}</p>
      </section>
    );
  }
  const title = liveTitle(notes.text, notes.page.title || path?.split('/')[1]?.replace(/\.md$/, '') || '');
  return (
    <section className="note-editor" aria-label={`Note: ${title}`}>
      {notes.status === 'conflict' && (
        <div className="note-conflict" role="alert">
          <span>The assistant changed this page while you were editing it.</span>
          <button type="button" className="btn" onClick={() => void notes.resolve(false)}>Use their version</button>
          <button type="button" className="btn primary" onClick={() => void notes.resolve(true)}>Keep mine</button>
        </div>
      )}
      {review && !kept && (
        <div className="note-review" role="status">
          <span className="review-dot" aria-hidden="true" />
          <span className="note-review-text">{diff ? (() => { const c = diffCounts(diff); return `${c.added} ${c.added === 1 ? 'line' : 'lines'} added, ${c.removed} removed in the agent's last turn`; })() : "The agent changed this page in its last turn."}</span>
          <button type="button" className="review-btn" aria-pressed={diff !== null} onClick={() => (diff ? setDiff(null) : void showChanges())}>{diff ? 'Back to editing' : 'Show changes'}</button>
          <ReviewActions onKeep={keepChanges} onDiscard={undoChanges} discardTitle="Put this page back as it was before that turn" keepTitle="Keep what the agent changed in that turn" />
          {reviewProblem && <span className="review-problem" role="alert">{reviewProblem}</span>}
        </div>
      )}
      {diff && (
        <ol className="note-diff" aria-label="Changes to this page">
          {(() => {
            const groups = changeGroups(diff);
            return diff.map((line, i) => {
              const group = groups[i];
              const first = group !== null && group !== undefined && groups[i - 1] !== group;
              return (
                <li key={i} data-kind={line.kind} data-first={first || undefined}>
                  <span className="note-diff-sign" aria-hidden="true">{line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ''}</span>
                  <span className="note-diff-text">{line.kind === 'removed' ? <del>{line.text || ' '}</del> : line.kind === 'added' ? <ins>{line.text || ' '}</ins> : (line.text || ' ')}</span>
                  {first && (
                    <button type="button" className="note-diff-undo" aria-label={`Undo change ${group + 1}`} title="Put this change back as it was" onClick={() => undoOne(group)}>Undo</button>
                  )}
                </li>
              );
            });
          })()}
        </ol>
      )}
      {diff === null && (
        <div className="note-insert" role="toolbar" aria-label="Insert">
          <button type="button" className="note-insert-btn" onPointerDown={(e) => e.preventDefault()} onClick={() => put(CHECKLIST)}>Checklist</button>
          <button type="button" className="note-insert-btn" onPointerDown={(e) => e.preventDefault()} onClick={() => put(TABLE)}>Table</button>
          <button type="button" className="note-insert-btn" data-recording={recording.state === 'recording' || undefined} disabled={recording.state === 'transcribing'} title="Record what is said and keep the words in this page" onPointerDown={(e) => e.preventDefault()} onClick={recording.toggle}>
            {recording.state === 'recording' ? `Stop · ${Math.floor(recording.seconds / 60)}:${String(recording.seconds % 60).padStart(2, '0')}` : recording.state === 'transcribing' ? 'Writing it down…' : 'Record'}
          </button>
          <button type="button" className="note-insert-btn" aria-expanded={clipping !== null} onPointerDown={(e) => e.preventDefault()} onClick={() => setClipping((c) => (c === null ? '' : null))}>Clip from web</button>
          {clipping !== null && (
            <form className="note-clip" onSubmit={(e) => { e.preventDefault(); if (clipping.trim()) void clip(clipping); }}>
              <input autoFocus aria-label="Address to clip" placeholder="Paste a link" value={clipping} onChange={(e) => setClipping(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setClipping(null); }} />
              <button type="submit" className="btn" disabled={!clipping.trim()}>Clip</button>
            </form>
          )}
          {(insertProblem ?? recording.problem) && <span className="review-problem" role="alert">{insertProblem ?? recording.problem}</span>}
        </div>
      )}
      <textarea
        hidden={diff !== null}
        ref={area}
        className="note-text"
        aria-label="Page text"
        spellCheck
        value={notes.text}
        onChange={(e) => notes.edit(e.target.value)}
        onSelect={(e) => { caret.current = e.currentTarget.selectionStart; }}
        onPointerDown={(e) => { pointer.current = null; pressedAt.current = e.clientY; setSelection(null); }}
        onPointerUp={(e) => { pointer.current = { x: e.clientX, y: e.clientY }; readSelection(); }}
        onKeyUp={(e) => { if (e.key === 'Escape') { setSelection(null); return; } pointer.current = null; pressedAt.current = null; readSelection(); }}
        onBlur={(e) => { if (!e.currentTarget.parentElement?.contains(e.relatedTarget as Node | null)) setSelection(null); }}
      />
      {selection && onSelection && (
        <div className="selection-bar" role="toolbar" aria-label="Selected text" style={{ top: selection.top, left: selection.left }}>
          {ACTIONS.map((action) => (
            <button key={action.id} type="button" className="selection-btn" data-action={action.id} title={action.title}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => { onSelection(action.id, selection.text); setSelection(null); }}>
              {action.label}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
