import { useEffect, useRef, useState, type FormEvent } from 'react';
import { MAIN_BOT_ID, conversationIdFor, type ContextItem } from '@mobius/shared';
import { MobiusMark } from './MobiusMark';
import { RichText } from './RichText';
import { withSelection, type Here } from './surface';
import { withoutToolTags } from './markdown';
import { KeyCaps } from './ui';

/** Ask from anywhere (docs/design/mobius-agent.md): select something in an app, press this, and ask about it there. */
export const ASK_HERE_KEYS = 'Ctrl+Shift+J';

/** Where the selection is on screen and what it says: words in a note or document, or the chosen cells. */
export interface Picked { text: string; rect: { left: number; top: number; bottom: number; width: number } }

/** What is chosen in the open app now, inside the stage only; null when nothing is. */
export function pickedNow(): Picked | null {
  const cell = document.querySelector<HTMLElement>('.stage [aria-label="Selected cell"]');
  const selection = document.getSelection();
  const node = selection?.anchorNode ?? null;
  const element = node instanceof Element ? node : node?.parentElement ?? null;
  const words = element?.closest('.stage') && selection && selection.rangeCount > 0 ? selection.toString().trim() : '';
  if (words) {
    const r = selection!.getRangeAt(0).getBoundingClientRect();
    return { text: words, rect: { left: r.left, top: r.top, bottom: r.bottom, width: r.width } };
  }
  const cells = cell?.textContent?.trim();
  if (cell && cells) {
    const r = cell.getBoundingClientRect();
    return { text: cells, rect: { left: r.left, top: r.top, bottom: r.bottom, width: r.width } };
  }
  return null;
}

/** Where the card goes: under the selection, or above it when there is no room, kept on screen. */
export function placeCard(rect: Picked['rect'], view: { width: number; height: number }, size = { width: 380, height: 260 }): { left: number; top: number } {
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
  const where = placeCard(picked.rect, { width: window.innerWidth, height: window.innerHeight });
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
  // Escape anywhere in the card closes it; a press outside it does too.
  useEffect(() => {
    const away = (event: PointerEvent) => { if (card.current && !card.current.contains(event.target as Node)) onClose(); };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [onClose]);
  const ask = async (event?: FormEvent) => {
    event?.preventDefault();
    const text = question.trim();
    if (!text || state === 'working') return;
    const item: ContextItem = here ? withSelection(here.item, picked.text) : { kind: 'note', title: 'Selection', source: app, text: picked.text.slice(0, 20_000) };
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
    <div ref={card} className="ask-here" role="dialog" aria-label="Ask Mobius about the selection" style={{ left: where.left, top: where.top }}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } }}>
      <div className="ask-here-head">
        <MobiusMark size={16} turning={state === 'working'} />
        <span className="ask-here-picked" title={picked.text}>{picked.text.length > 80 ? `${picked.text.slice(0, 79)}…` : picked.text}</span>
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
