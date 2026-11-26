import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { MAIN_BOT_ID, conversationIdFor, type ContextItem } from '@mobius/shared';
import { MobiusMark } from './MobiusMark';
import { RichText } from './RichText';
import { withSelection, type Here } from './surface';
import { withoutToolTags } from './markdown';
import { KeyCaps } from './ui';

/** Ask from anywhere (docs/design/mobius-agent.md): select something in an app, press this, and ask about it there. */
export const ASK_HERE_KEYS = 'Ctrl+Shift+J';

/**
 * Where the selection is on screen and what it says: words in a note or document, or the chosen cells. `label` is
 * how the card shows it; `text` is what goes with the question (for cells, their address and their values).
 */
export interface Picked { label: string; text: string; cells?: boolean; rect: { left: number; top: number; bottom: number; width: number } }

type Box = Picked['rect'];
const around = (rects: readonly DOMRect[]): Box => {
  const left = Math.min(...rects.map((r) => r.left));
  const right = Math.max(...rects.map((r) => r.right));
  return { left, top: Math.min(...rects.map((r) => r.top)), bottom: Math.max(...rects.map((r) => r.bottom)), width: right - left };
};

/** The chosen cells as rows of tab-separated values, as a copy would give them. */
export function cellsText(rows: readonly (readonly string[])[]): string {
  return rows.map((row) => row.join('\t')).join('\n');
}

/** What is chosen in the open app now, inside the stage only; null when nothing is. */
export function pickedNow(): Picked | null {
  const selection = document.getSelection();
  const node = selection?.anchorNode ?? null;
  const element = node instanceof Element ? node : node?.parentElement ?? null;
  const words = element?.closest('.stage') && selection && selection.rangeCount > 0 ? selection.toString().trim() : '';
  if (words) {
    const r = selection!.getRangeAt(0).getBoundingClientRect();
    return { label: words, text: words, rect: { left: r.left, top: r.top, bottom: r.bottom, width: r.width } };
  }
  // Cells in a sheet: the grid's chosen cells themselves, and the range's name from the name box.
  const cells = [...document.querySelectorAll<HTMLElement>('.stage [role="gridcell"][aria-selected="true"]')];
  if (cells.length > 0) {
    const name = document.querySelector('.stage [aria-label="Selected cell"]')?.textContent?.trim() || cells.map((c) => c.getAttribute('aria-label')).filter(Boolean).join(', ');
    const rows = new Map<Element, string[]>();
    for (const cell of cells) {
      const row = cell.parentElement ?? cell;
      rows.set(row, [...(rows.get(row) ?? []), cell.textContent?.trim() ?? '']);
    }
    return { label: name, text: `${name}\n${cellsText([...rows.values()])}`.slice(0, 20_000), cells: true, rect: around(cells.map((c) => c.getBoundingClientRect())) };
  }
  return null;
}

/** The open item with what is chosen in it, so the question's "this" is the chosen words or cells. */
function withPicked(here: Here | null, picked: Picked, app: string): ContextItem {
  if (!here) return { kind: 'note', title: 'Selection', source: app, text: picked.text.slice(0, 20_000) };
  if (!picked.cells) return withSelection(here.item, picked.text);
  return { ...here.item, text: `Selected cells: ${picked.text}\n\n${here.item.text}`.slice(0, 20_000) };
}

/** Where the card goes: under the selection, or above it when there is no room, kept on screen. */
export function placeCard(rect: Picked['rect'], view: { width: number; height: number }, size: { width: number; height: number }): { left: number; top: number } {
  const left = Math.max(8, Math.min(rect.left, view.width - size.width - 8));
  const below = rect.bottom + 8;
  const top = below + size.height <= view.height - 8 ? below : Math.max(8, rect.top - size.height - 8);
  return { left, top };
}

/**
 * The card: a question about what is selected, sent in Ask mode (read and answer, change nothing) to a chat of its
 * own, with the answer shown here as it comes. Continue in chat opens that chat in the panel; Esc puts the keyboard
 * back where it was.
 */
export function AskHere({ picked, here, app, onClose, onContinue }: {
  picked: Picked;
  here: Here | null;
  app: string;
  onClose: () => void;
  onContinue: (conversation: string) => void;
}) {
  const [question, setQuestion] = useState('');
  const [asked, setAsked] = useState<string | null>(null);
  const [answer, setAnswer] = useState('');
  const [state, setState] = useState<'idle' | 'working' | 'done' | 'failed'>('idle');
  const [problem, setProblem] = useState<string | null>(null);
  const chat = useRef<string>(conversationIdFor(MAIN_BOT_ID, crypto.randomUUID()));
  const field = useRef<HTMLInputElement>(null);
  const card = useRef<HTMLDivElement>(null);
  // Placed from its own size, again as the answer grows: under the selection, or above it with its bottom edge by it.
  useLayoutEffect(() => {
    const el = card.current;
    if (!el) return;
    const at = placeCard(picked.rect, { width: window.innerWidth, height: window.innerHeight }, { width: el.offsetWidth, height: el.offsetHeight });
    el.style.left = `${at.left}px`;
    el.style.top = `${at.top}px`;
  });
  useEffect(() => { field.current?.focus(); }, []);
  useEffect(() => window.mobius.agent.onNotification((n) => {
    if (n.params.conversation !== chat.current) return;
    if (n.method === 'agent.delta') { setAnswer((a) => a + n.params.text); return; }
    if (n.method !== 'agent.event') return;
    const kind = n.params.event.kind;
    if (kind === 'done') {
      setState('done');
      // Nothing streamed (a model that answers at once): what it said is in the chat.
      void window.mobius.agent.history(chat.current).then((messages) => {
        const last = [...messages].reverse().find((m) => m.role === 'assistant' && m.text);
        if (last && last.role === 'assistant') setAnswer(last.text);
      }).catch(() => undefined);
    } else if (kind === 'failed' || kind === 'cancelled') {
      setState('failed');
      setProblem(kind === 'cancelled' ? 'Stopped.' : 'Mobius could not answer that. Try again, or continue in the chat.');
    }
  }), []);
  // A press outside closes it and goes no further (it would land on the restored words: a toolbar's Italic, say).
  // Escape closes it wherever the keyboard is.
  useEffect(() => {
    const swallow = (event: Event) => { event.preventDefault(); event.stopPropagation(); };
    const away = (event: PointerEvent) => {
      if (!card.current || card.current.contains(event.target as Node)) return;
      swallow(event);
      const kinds = ['mousedown', 'mouseup', 'click', 'pointerup'] as const;
      kinds.forEach((k) => document.addEventListener(k, swallow, true));
      window.setTimeout(() => kinds.forEach((k) => document.removeEventListener(k, swallow, true)), 600);
      onClose();
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); onClose(); } };
    document.addEventListener('pointerdown', away, true);
    window.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', away, true); window.removeEventListener('keydown', escape); };
  }, [onClose]);
  // Tab goes round the card's own buttons, not out of it to the page behind.
  const keepIn = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab' || !card.current) return;
    const all = [...card.current.querySelectorAll<HTMLElement>('input, button:not([disabled])')];
    if (all.length === 0) return;
    const at = all.indexOf(document.activeElement as HTMLElement);
    const next = e.shiftKey ? (at <= 0 ? all.length - 1 : at - 1) : (at === all.length - 1 ? 0 : at + 1);
    e.preventDefault();
    all[next]!.focus();
  };
  const ask = async (event?: FormEvent) => {
    event?.preventDefault();
    const text = question.trim();
    if (!text || state === 'working') return;
    const item = withPicked(here, picked, app);
    setAsked(text);
    setAnswer('');
    setProblem(null);
    setState('working');
    setQuestion('');
    const result = await window.mobius.agent.send(chat.current, text, [item], { ask: true, app }).catch((e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }));
    if (!result.ok) { setState('failed'); setProblem(result.error); }
  };
  const stop = () => { void window.mobius.agent.cancel(chat.current); field.current?.focus(); };
  const shown = withoutToolTags(answer).trim();
  return (
    <div ref={card} className="ask-here" role="dialog" aria-label="Ask Mobius about the selection" 
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } else keepIn(e); }}>
      <div className="ask-here-head">
        <MobiusMark size={16} turning={state === 'working'} />
        <span className="ask-here-picked" title={picked.label}>{picked.label.length > 80 ? `${picked.label.slice(0, 79)}…` : picked.label}</span>
      </div>
      {asked && <p className="ask-here-asked">{asked}</p>}
      {asked && (
        <div className="ask-here-answer" role="status" aria-label="Mobius's answer" aria-busy={state === 'working'}>
          {shown ? <RichText text={shown} /> : state === 'working' ? <span className="ask-here-wait">Thinking…</span> : null}
          {problem && <p className="ask-here-problem">{problem}</p>}
        </div>
      )}
      <form className="ask-here-form" onSubmit={(e) => void ask(e)}>
        <input ref={field} type="text" aria-label="Ask about the selection" placeholder={asked ? 'Ask a follow-up' : 'Ask about this'} value={question} onChange={(e) => setQuestion(e.target.value)} />
        {state === 'working'
          ? <button type="button" className="btn" onClick={stop}>Stop</button>
          : <button type="submit" className="btn primary" disabled={!question.trim()}>Ask</button>}
      </form>
      <div className="ask-here-foot">
        {asked && state !== 'working' && <button type="button" className="btn ghost" onClick={() => onContinue(chat.current)}>Continue in chat</button>}
        <span className="ask-here-keys" aria-hidden="true"><KeyCaps keys="Esc" /> to close</span>
      </div>
    </div>
  );
}
