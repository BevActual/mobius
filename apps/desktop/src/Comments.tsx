import { useCallback, useEffect, useRef, useState } from 'react';
import type { CommentAnchor, CommentThread, ContextItem, Message } from '@mobius/shared';
import { KEPT_EVENT } from './ReviewStrip';
import { RichText } from './RichText';

/**
 * Comments on anything in the shell, as in a design tool: a speech-bubble button (or C) turns comment mode on, a
 * dashed ring follows the pointer over objects, and a click drops a pin with a thread beside it. A thread can be sent
 * to Mobius (its reply comes back into the thread, and keeping the change resolves it), kept as a note for people
 * (Mobius does not read those), or deleted. Threads are kept per document by the core (`.comments/<app>/`).
 */

const api = () => window.mobius.comments;
const isThreads = (v: unknown): v is CommentThread[] => Array.isArray(v);
const newId = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Threads of one document, kept as they change. */
export function useCommentThreads(app: string, doc: string | null) {
  const [threads, setThreads] = useState<CommentThread[]>([]);
  const live = useRef({ app, doc });
  live.current = { app, doc };
  // Saves go one after another, in the order they were made: two at once could land the wrong way round (a comment
  // kept as a note going back to open). An answer that a later save has overtaken is not shown.
  const writing = useRef<Promise<unknown>>(Promise.resolve());
  const saves = useRef(0);
  const load = useCallback(async () => {
    if (!doc || !api()) { setThreads([]); return; }
    const before = saves.current;
    const got = await api()!.list(app, doc).catch(() => []);
    if (live.current.app === app && live.current.doc === doc && saves.current === before) setThreads(isThreads(got) ? got : []);
  }, [app, doc]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => api()?.onChanged((changed) => { if (!changed || changed === app) void load(); }), [app, load]);
  const save = useCallback(async (next: CommentThread[]) => {
    if (!doc || !api()) return;
    const mine = ++saves.current;
    setThreads(next);
    const run = writing.current.then(() => api()!.set(app, doc, next).catch(() => null));
    writing.current = run;
    const kept = await run;
    if (mine === saves.current && kept && 'threads' in kept) setThreads(kept.threads);
  }, [app, doc]);
  return { threads, save };
}

/** Every thread of an app that is not resolved: for the button's badge and the sidebar's Comments group. */
export function useOpenComments(app: string) {
  const [open, setOpen] = useState<CommentThread[]>([]);
  const load = useCallback(async () => {
    const got = await api()?.all(app).catch(() => []);
    setOpen(Array.isArray(got) ? got.flatMap((d) => d.threads).filter((t) => t.state !== 'resolved') : []);
  }, [app]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => api()?.onChanged((changed) => { if (!changed || changed === app) void load(); }), [app, load]);
  return open;
}

const BUBBLE = <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 4.5h12a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5H9l-4 3v-3H4A1.5 1.5 0 0 1 2.5 13V6A1.5 1.5 0 0 1 4 4.5z" /></svg>;

/** The toolbar's comment button: pressed in comment mode, with the count of open threads in this app. */
export function CommentButton({ on, count, onToggle }: { on: boolean; count: number; onToggle: () => void }) {
  return (
    <button type="button" className="strip-btn comment-toggle" data-comment-toggle data-priority="low" data-keys="C" aria-pressed={on} aria-label="Comments" title={on ? 'Leave comment mode (C)' : 'Comment on anything here (C)'} onClick={onToggle}>
      {BUBBLE}
      {count > 0 && <span className="comment-badge" aria-label={`${count} open`}>{count}</span>}
    </button>
  );
}

const SKIP = '.comment-layer, .comment-card, [data-comment-toggle], .rail, .dock, .context-strip, dialog';

/** What a click or the pointer is on: the nearest object with an id of its own, else the element itself. */
function objectAt(target: Element, stage: Element): { element: Element; anchor: CommentAnchor; context: string } | null {
  if (!stage.contains(target) || target.closest(SKIP)) return null;
  const owned = target.closest('[data-comment-id]');
  const element = owned && stage.contains(owned) ? owned : target;
  const text = piecesOf(element, 4000);
  const label = element.getAttribute('data-comment-label') ?? element.getAttribute('aria-label') ?? piecesOf(target, 80);
  if (owned) return { element, anchor: { id: owned.getAttribute('data-comment-id')!, label }, context: text.slice(0, 4000) };
  const box = element.getBoundingClientRect();
  const area = stage.getBoundingClientRect();
  const x = Math.min(1, Math.max(0, (box.left + box.width / 2 - area.left) / Math.max(1, area.width)));
  const y = Math.min(1, Math.max(0, (box.top + Math.min(box.height / 2, 12) - area.top) / Math.max(1, area.height)));
  return { element, anchor: { x, y, label }, context: text.slice(0, 4000) };
}

/**
 * The words of an element as a person reads them: each child's text on its own, joined with " · " (a row of
 * "Edited just now", "22 words" and "#kestrel" is not one long word), trimmed to `max` characters.
 */
export function piecesOf(element: Element, max: number): string {
  const clean = (t: string | null) => (t ?? '').replace(/\s+/g, ' ').trim();
  const pieces = [...element.childNodes].map((n) => clean(n.textContent)).filter(Boolean);
  const text = (pieces.length > 0 ? pieces : [clean(element.textContent)]).join(' · ');
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** Where a thread's pin goes on screen, or null when what it is pinned to is not shown. */
function pinAt(thread: CommentThread, stage: Element): { x: number; y: number } | null {
  if (thread.anchor.id) {
    const element = stage.querySelector(`[data-comment-id="${CSS.escape(thread.anchor.id)}"]`);
    if (!element) return null;
    const box = element.getBoundingClientRect();
    if (box.width === 0 && box.height === 0) return null;
    return { x: box.right - 6, y: box.top - 18 };
  }
  if (thread.anchor.x === undefined || thread.anchor.y === undefined) return null;
  const area = stage.getBoundingClientRect();
  return { x: area.left + thread.anchor.x * area.width, y: area.top + thread.anchor.y * area.height - 24 };
}

/**
 * Where a card goes: beside its pin, on the right when there is room before the window's edge or the Mobius panel, else
 * on the left, and kept inside the window.
 */
export function cardPlace(at: { x: number; y: number }, width = 280, height = 220): { left: number; top: number } {
  const panel = document.querySelector('.dock.right')?.getBoundingClientRect();
  const limit = Math.min(window.innerWidth, panel && panel.width > 0 ? panel.left : Infinity) - 8;
  const right = at.x + 30;
  const left = right + width <= limit ? right : Math.max(8, at.x - width - 6);
  const top = Math.max(8, Math.min(at.y, window.innerHeight - height - 8));
  return { left, top };
}

interface Draft { anchor: CommentAnchor; context: string; at: { x: number; y: number } }

export interface CommentLayerProps {
  app: string;
  /** The document open in the app; comments need one. */
  doc: string | null;
  on: boolean;
  onOff: () => void;
  threads: CommentThread[];
  save: (threads: CommentThread[]) => Promise<void>;
  /** Ask Mobius in the open conversation; resolves with that conversation's id, or null when it could not. */
  onSend: (text: string, context: ContextItem[]) => Promise<boolean>;
  /** The conversation a comment sent now goes to. */
  conversation: string;
  /** Which thread to open, from the sidebar's Comments group. */
  focus?: string | null;
}

export function CommentLayer({ app, doc, on, onOff, threads, save, onSend, conversation, focus = null }: CommentLayerProps) {
  const [hover, setHover] = useState<DOMRect | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const stage = () => document.querySelector('.stage');
  const latest = useRef(threads);
  latest.current = threads;

  useEffect(() => { if (focus) setOpenId(focus); }, [focus]);
  useEffect(() => { setDraft(null); setOpenId(null); }, [app, doc]);
  // Pins follow what they are pinned to as it scrolls and moves.
  useEffect(() => {
    if (threads.length === 0 && !draft) return undefined;
    const timer = window.setInterval(() => setTick((n) => n + 1), 250);
    return () => window.clearInterval(timer);
  }, [threads.length, draft]);

  // Comment mode: a ring over the object under the pointer, and a click there starts a comment.
  useEffect(() => {
    if (!on) { setHover(null); return undefined; }
    const move = (event: PointerEvent) => {
      const area = stage();
      const found = area && event.target instanceof Element ? objectAt(event.target, area) : null;
      setHover(found ? found.element.getBoundingClientRect() : null);
    };
    const click = (event: MouseEvent) => {
      const area = stage();
      if (!area || !(event.target instanceof Element)) return;
      const found = objectAt(event.target, area);
      if (!found) return;
      event.preventDefault();
      event.stopPropagation();
      const box = found.element.getBoundingClientRect();
      setOpenId(null);
      setDraft({ anchor: found.anchor, context: found.context, at: { x: box.right, y: box.top } });
    };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && !draft) onOff(); };
    document.addEventListener('pointermove', move, true);
    document.addEventListener('click', click, true);
    document.addEventListener('mousedown', swallow, true);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('click', click, true);
      document.removeEventListener('mousedown', swallow, true);
      document.removeEventListener('keydown', key);
    };
  }, [on, onOff, draft]);

  // A reply from Mobius comes back into the thread it was asked from.
  useEffect(() => window.mobius.agent.onNotification((n) => {
    if (n.method !== 'agent.event' || !['done', 'failed'].includes(n.params.event.kind)) return;
    const waiting = latest.current.filter((t) => t.state === 'sent' && t.conversation === n.params.conversation && !t.reply);
    if (waiting.length === 0) return;
    void window.mobius.agent.history(n.params.conversation).then((history: Message[]) => {
      const last = history.findLast((m) => m.role === 'assistant' && m.text.trim() !== '');
      const reply = last && last.role === 'assistant' ? last.text : n.params.event.kind === 'failed' ? 'Mobius could not finish.' : 'Done.';
      void save(latest.current.map((t) => (waiting.some((w) => w.id === t.id) ? { ...t, reply } : t)));
    }).catch(() => undefined);
  }), [save]);
  // Keeping the change Mobius made for a thread resolves it.
  useEffect(() => {
    const kept = (event: Event) => {
      const turn = String((event as CustomEvent).detail ?? '');
      const done = latest.current.filter((t) => t.state === 'sent' && t.conversation && turn.startsWith(`${t.conversation}:`));
      if (done.length > 0) void save(latest.current.map((t) => (done.includes(t) ? { ...t, state: 'resolved' } : t)));
    };
    window.addEventListener(KEPT_EVENT, kept);
    return () => window.removeEventListener(KEPT_EVENT, kept);
  }, [save]);

  const area = stage();
  const update = (id: string, change: Partial<CommentThread>) => void save(threads.map((t) => (t.id === id ? { ...t, ...change } : t)));
  const remove = (id: string) => { setOpenId(null); void save(threads.filter((t) => t.id !== id)); };
  const send = async (t: CommentThread) => {
    const about: ContextItem = { kind: 'note', title: t.anchor.label || 'What the comment is on', source: `${app}: ${t.doc}`, text: t.context || t.anchor.label };
    // Marked as sent before asking, so a quick reply finds the thread waiting for it.
    const before = threads;
    await save(threads.map((x) => (x.id === t.id ? { ...x, state: 'sent', conversation } : x)));
    const asked = await onSend(`About ${t.anchor.label ? `“${t.anchor.label}”` : 'this'} in ${t.doc}: ${t.text}`, [about]);
    if (!asked) void save(before);
  };

  return (
    <div className="comment-layer" data-on={on || undefined}>
      {on && hover && <div className="comment-ring" style={{ left: hover.left - 3, top: hover.top - 3, width: hover.width + 6, height: hover.height + 6 }} aria-hidden="true" />}
      {area && threads.map((t) => {
        const at = pinAt(t, area);
        if (!at) return null;
        return (
          <button key={t.id} type="button" className="comment-pin" data-state={t.state} style={{ left: at.x, top: at.y }} aria-expanded={openId === t.id}
            aria-label={`Comment on ${t.anchor.label || 'this'}: ${t.text}`} onClick={() => { setDraft(null); setOpenId(openId === t.id ? null : t.id); }}>
            {t.state === 'resolved' && <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 6.2 5 8.2l4-4.4" /></svg>}
          </button>
        );
      })}
      {draft && doc && (
        <DraftCard draft={draft} onCancel={() => setDraft(null)} onSave={(text) => {
          const t: CommentThread = { id: newId(), doc, anchor: draft.anchor, text, context: draft.context, by: 'you', whenMs: Date.now(), state: 'open' };
          setDraft(null);
          setOpenId(t.id);
          void save([...threads, t]);
        }} />
      )}
      {area && openId && (() => {
        const t = threads.find((x) => x.id === openId);
        const at = t ? pinAt(t, area) : null;
        if (!t || !at) return null;
        return (
          <section className="comment-card" role="dialog" aria-label={`Comment on ${t.anchor.label || 'this'}`} style={cardPlace(at)}>
            <p className="comment-on">{t.anchor.label}</p>
            <p className="comment-text">{t.text}</p>
            {t.state === 'note' && <p className="comment-meta">A note for people. Mobius does not read it.</p>}
            {t.state === 'sent' && <div className="comment-reply" role="status">{t.reply ? <RichText text={t.reply} /> : 'Asked Mobius…'}</div>}
            {t.state === 'resolved' && t.reply && <div className="comment-reply"><RichText text={t.reply} /></div>}
            <div className="comment-actions">
              {(t.state === 'open' || t.state === 'note') && <button type="button" className="review-btn" data-kind="keep" onClick={() => void send(t)}>Send to Mobius</button>}
              {t.state === 'open' && <button type="button" className="review-btn" onClick={() => update(t.id, { state: 'note' })}>Keep as a note</button>}
              {t.state === 'sent' && t.reply && <button type="button" className="review-btn" onClick={() => update(t.id, { state: 'resolved' })}>Resolve</button>}
              {t.state === 'resolved' && <button type="button" className="review-btn" onClick={() => update(t.id, { state: t.reply ? 'sent' : 'open' })}>Reopen</button>}
              <button type="button" className="review-btn" onClick={() => remove(t.id)}>Delete</button>
            </div>
          </section>
        );
      })()}
    </div>
  );
}

/** In comment mode the page under a click does not act on it: the click is for the comment. */
function swallow(event: MouseEvent) {
  const area = document.querySelector('.stage');
  if (area && event.target instanceof Element && objectAt(event.target, area)) { event.preventDefault(); event.stopPropagation(); }
}

function DraftCard({ draft, onSave, onCancel }: { draft: Draft; onSave: (text: string) => void; onCancel: () => void }) {
  const [text, setText] = useState('');
  return (
    <form className="comment-card" role="dialog" aria-label="New comment" style={cardPlace({ x: draft.at.x - 18, y: draft.at.y })}
      onSubmit={(e) => { e.preventDefault(); if (text.trim()) onSave(text.trim()); }}>
      <p className="comment-on">{draft.anchor.label}</p>
      <textarea autoFocus aria-label="Comment" placeholder="Add a comment" value={text} maxLength={4000} rows={3} onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onCancel(); } if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (text.trim()) onSave(text.trim()); } }} />
      <div className="comment-actions">
        <button type="button" className="review-btn" onClick={onCancel}>Cancel</button>
        <button type="submit" className="review-btn" data-kind="keep" disabled={!text.trim()}>Comment</button>
      </div>
    </form>
  );
}

/** The sidebar's Comments group: the open threads in this app. */
export function CommentsGroup({ threads, onOpen }: { threads: CommentThread[]; onOpen: (t: CommentThread) => void }) {
  if (threads.length === 0) return null;
  return (
    <section className="from-mobius side-comments" aria-label="Comments">
      <h3 className="side-title from-mobius-title">Comments</h3>
      <ul role="list">
        {threads.map((t) => (
          <li key={t.id}>
            <button type="button" className="note-row" data-state={t.state} aria-label={`${t.text}, on ${t.anchor.label || t.doc}`} onClick={() => onOpen(t)}>
              <span className="comment-row-pin" data-state={t.state} aria-hidden="true" />
              <span className="note-title">{t.text}</span>
              <span className="note-sub from-mobius-where">{t.anchor.label || t.doc}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
