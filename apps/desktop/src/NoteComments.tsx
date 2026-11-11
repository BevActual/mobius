import { useCallback, useEffect, useRef, useState } from 'react';
import type { NoteComment } from '@mobius/shared';
import { relativeTime } from './relative-time';

const newId = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Where a comment's quoted words are in the page's text: the first place they appear, or null if they are gone. */
export function quoteAt(text: string, quote: string): number | null {
  if (!quote.trim()) return null;
  const at = text.indexOf(quote);
  return at < 0 ? null : at;
}

/** The open page's comments: read when the page opens, kept beside it when they change. */
export function useNoteComments(path: string | undefined, kind: 'notes' | 'docs' = 'notes') {
  const [comments, setComments] = useState<NoteComment[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const now = useRef(comments);
  now.current = comments;
  const api = window.mobius[kind];
  const available = !!(api?.comments && api.setComments);
  useEffect(() => {
    let live = true;
    setComments([]);
    setProblem(null);
    if (!path || !api?.comments) return;
    const load = () => void api.comments!(path).then((c) => { if (live && Array.isArray(c)) setComments(c); }).catch(() => undefined);
    load();
    // Mobius answers and resolves comments too: what it did shows here at once.
    const stop = api.onChanged?.((change) => { if (change.by !== 'person' && (change.path === null || change.path === path)) load(); });
    return () => { live = false; stop?.(); };
  }, [path, api]);
  const keep = useCallback(async (next: NoteComment[]) => {
    if (!path || !api?.setComments) return false;
    const was = now.current;
    setComments(next);
    const done = await api.setComments(path, next).catch(() => ({ ok: false as const, message: 'the comments could not be kept' }));
    if ('comments' in done) { setProblem(null); return true; }
    setComments(was);
    setProblem(`That could not be kept: ${done.message}.`);
    return false;
  }, [path, api]);
  const add = (quote: string, text: string, by = 'you') => keep([...now.current, { id: newId(), quote: quote.slice(0, 1000), text: text.slice(0, 4000), by, whenMs: Date.now(), resolved: false }]);
  // A thread is resolved, opened again or deleted as one: the comment with its replies.
  const resolve = (id: string, resolved = true) => keep(now.current.map((c) => (c.id === id || c.replyTo === id ? { ...c, resolved } : c)));
  const remove = (id: string) => keep(now.current.filter((c) => c.id !== id && c.replyTo !== id));
  return { available, comments, problem, add, resolve, remove };
}
export type NoteCommentsState = ReturnType<typeof useNoteComments>;

/** Writing a comment on the chosen words: Comment keeps it; Ask Mobius keeps it and hands it to Mobius too. */
export function CommentComposer({ quote, top, left, onDone, onAsk, add }: { quote: string; top: number; left: number; onDone: () => void; onAsk?: (quote: string, text: string) => void; add: NoteCommentsState['add'] }) {
  const [text, setText] = useState('');
  const send = async (ask: boolean) => {
    const words = text.trim();
    if (!words) return;
    if (await add(quote, words)) {
      if (ask) onAsk?.(quote, words);
      onDone();
    }
  };
  return (
    <form className="note-comment-composer" role="dialog" aria-label="New comment" style={{ top, left }} onSubmit={(e) => { e.preventDefault(); void send(false); }}>
      <p className="note-comment-quote">{quote.length > 140 ? `${quote.slice(0, 139)}…` : quote}</p>
      <textarea autoFocus aria-label="Comment" placeholder="Add a comment" rows={3} value={text} onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); onDone(); }
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void send(false); }
        }} />
      <div className="note-comment-actions">
        <button type="button" className="btn" onClick={onDone}>Cancel</button>
        <span className="spacer" />
        {onAsk && <button type="button" className="btn" disabled={!text.trim()} title="Keep the comment and ask Mobius about it" onClick={() => void send(true)}>Ask Mobius</button>}
        <button type="submit" className="btn primary" disabled={!text.trim()}>Comment</button>
      </div>
    </form>
  );
}

/** The page's comments under it: open ones first, each with what it is about; resolved ones folded away. */
export function CommentList({ state, text, onShow }: { state: NoteCommentsState; text: string; onShow: (quote: string) => void }) {
  const [showResolved, setShowResolved] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(t); }, []);
  const threads = state.comments.filter((c) => !c.replyTo || !state.comments.some((p) => p.id === c.replyTo));
  const repliesTo = (id: string) => state.comments.filter((c) => c.replyTo === id);
  const open = threads.filter((c) => !c.resolved);
  const resolved = threads.filter((c) => c.resolved);
  if (!state.comments.length && !state.problem) return null;
  const card = (c: NoteComment) => {
    const gone = quoteAt(text, c.quote) === null;
    return (
      <li key={c.id} className="note-comment" data-resolved={c.resolved || undefined} data-by={c.by === 'Mobius' ? 'mobius' : undefined}>
        <button type="button" className="note-comment-body" title={gone ? 'Those words are no longer in the page' : 'Show the words in the page'} disabled={gone} onClick={() => onShow(c.quote)}>
          {c.quote && <span className={`note-comment-quote${gone ? ' gone' : ''}`}>{c.quote}</span>}
          <span className="note-comment-text">{c.text}</span>
          <span className="note-comment-who">{c.by === 'you' ? 'You' : c.by} · {relativeTime(c.whenMs, Math.max(now, c.whenMs))}</span>
        </button>
        <span className="note-comment-tools">
          <button type="button" className="note-comment-tool" onClick={() => void state.resolve(c.id, !c.resolved)}>{c.resolved ? 'Reopen' : 'Resolve'}</button>
          <button type="button" className="note-comment-tool" aria-label={`Delete the comment “${c.text.slice(0, 40)}”`} onClick={() => void state.remove(c.id)}>Delete</button>
        </span>
        {repliesTo(c.id).length > 0 && (
          <ul className="note-comment-replies" aria-label="Replies">
            {repliesTo(c.id).map((r) => (
              <li key={r.id} className="note-comment-reply" data-by={r.by === 'Mobius' ? 'mobius' : undefined}>
                <span className="note-comment-text">{r.text}</span>
                <span className="note-comment-who">{r.by === 'you' ? 'You' : r.by} · {relativeTime(r.whenMs, Math.max(now, r.whenMs))}</span>
              </li>
            ))}
          </ul>
        )}
      </li>
    );
  };
  return (
    <section className="note-comments" aria-label="Comments">
      <h2>Comments{open.length ? <span className="note-count">{open.length}</span> : null}</h2>
      {state.problem && <p className="review-problem" role="alert">{state.problem}</p>}
      {open.length > 0 && <ul>{open.map(card)}</ul>}
      {open.length === 0 && resolved.length > 0 && <p className="note-comments-none">Every comment is resolved.</p>}
      {resolved.length > 0 && (
        <>
          <button type="button" className="note-comments-fold" aria-expanded={showResolved} onClick={() => setShowResolved((s) => !s)}>{showResolved ? 'Hide resolved' : `Show ${resolved.length} resolved`}</button>
          {showResolved && <ul>{resolved.map(card)}</ul>}
        </>
      )}
    </section>
  );
}
