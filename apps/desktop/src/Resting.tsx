import { useState, type ReactNode } from 'react';
import type { ConversationInfo } from '@mobius/shared';
import { ReviewStrip } from './ReviewStrip';
import type { HubTarget } from './search-hub';

/**
 * The resting Mobius panel: a quiet chat. Before anything is asked it shows one line for what waits elsewhere (other
 * chats with a question, the last chat's changes still to keep or discard), which opens to them, and the ideas for
 * what is open as chips just above the message box. Earlier chats are in the panel title's list.
 */
export interface Resting {
  /** Other chats waiting for your answer or approval. */
  needsYou: ConversationInfo[];
  /** The most recent other chat, whose last turn's changes may still wait to be kept. */
  latest: ConversationInfo | null;
  /** A few earlier chats to go back to, newest first (not the ones listed above). */
  earlier: ConversationInfo[];
}

export function restingOf(list: readonly ConversationInfo[], active: string, earlierLimit = 3): Resting {
  const others = list.filter((c) => c.id !== active && c.messages > 0).sort((a, b) => b.updated_ms - a.updated_ms);
  const needsYou = others.filter((c) => c.activity === 'needs_you' || c.waiting > 0);
  const latest = others.find((c) => !needsYou.includes(c) && c.activity !== 'working') ?? null;
  const earlier = others.filter((c) => !needsYou.includes(c)).slice(0, earlierLimit);
  return { needsYou, latest, earlier };
}

export function RestingPanel({ conversations, active, onSelect, onOpenItem, ideas, glance }: {
  conversations: readonly ConversationInfo[];
  active: string;
  onSelect: (id: string) => void;
  onOpenItem?: ((target: HubTarget) => void) | undefined;
  /** The slot the composer fills with ideas for what is open. */
  ideas: ReactNode;
  /** The Glance slot, first of all: live facts about what is open (hidden while the app puts nothing there). */
  glance?: ReactNode;
}) {
  const r = restingOf(conversations, active);
  const [changes, setChanges] = useState(false);
  const [open, setOpen] = useState(false);
  const waiting = r.needsYou.length;
  // One line for what waits elsewhere (Andrew, 21 November 2026: the panel is a conversation first): it opens to the
  // chats that wait and the last chat's changes. Earlier chats are in the title's list.
  const said = [waiting > 0 ? `${waiting} waiting` : '', changes ? 'changes to review' : ''].filter(Boolean).join(' · ');
  return (
    <div className="resting">
      {glance}
      {(r.needsYou.length > 0 || r.latest) && (
        <section className="resting-part resting-waiting" aria-label="Waiting for you" data-open={open || undefined} hidden={!said || undefined}>
          <button type="button" className="resting-status" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            <span className="resting-status-dot" aria-hidden="true" />
            <span className="resting-status-text">{said}</span>
            <span className="resting-status-more">{open ? 'Hide' : 'Review'}</span>
          </button>
          <div className="resting-status-list" hidden={!open}>
            {r.needsYou.map((c) => (
              <button key={c.id} type="button" className="resting-row resting-needs" onClick={() => onSelect(c.id)} title={`Open ${c.title}`}>
                <span className="resting-row-title">{c.title}</span>
                <span className="resting-row-meta">{c.waiting === 1 ? 'Needs your answer' : c.waiting > 1 ? `${c.waiting} questions` : 'Needs you'}</span>
              </button>
            ))}
            {/* The last chat's changes, with Keep and Discard; it says nothing when none are left. Kept mounted, so the
                line knows whether there are any. */}
            {r.latest && (
              <div className="resting-changes" data-from={r.latest.title}>
                <ReviewStrip conversation={r.latest.id} busy={false} onOpenItem={onOpenItem} onShown={setChanges} />
              </div>
            )}
          </div>
        </section>
      )}
      <section className="resting-part resting-ideas" aria-label="Ideas">{ideas}</section>
    </div>
  );
}
