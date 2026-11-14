import { useState, type ReactNode } from 'react';
import type { ConversationInfo } from '@mobius/shared';
import { ReviewStrip } from './ReviewStrip';
import type { HubTarget } from './search-hub';
import { relativeTime } from './relative-time';

/**
 * The resting Mobius panel (Instrument, "The Mobius panel, improved": never empty). Before anything is asked in this
 * chat it shows, in order: what waits for you (other chats with a question, and the last chat's changes still to keep
 * or discard), the ideas for what is open, then earlier chats. Each part shows only when it has something.
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

export function RestingPanel({ conversations, active, onSelect, onOpenItem, ideas }: {
  conversations: readonly ConversationInfo[];
  active: string;
  onSelect: (id: string) => void;
  onOpenItem?: ((target: HubTarget) => void) | undefined;
  /** The slot the composer fills with ideas for what is open. */
  ideas: ReactNode;
}) {
  const r = restingOf(conversations, active);
  const [changes, setChanges] = useState(false);
  const waiting = r.needsYou.length + (r.latest && changes ? 1 : 0);
  return (
    <div className="resting">
      {(r.needsYou.length > 0 || r.latest) && (
        <section className="resting-part resting-waiting" aria-label="Waiting for you">
          <h3 className="resting-title">Waiting for you{waiting > 0 && <span className="resting-count">{waiting}</span>}</h3>
          {r.needsYou.map((c) => (
            <button key={c.id} type="button" className="resting-row resting-needs" onClick={() => onSelect(c.id)} title={`Open ${c.title}`}>
              <span className="resting-row-title">{c.title}</span>
              <span className="resting-row-meta">{c.waiting === 1 ? 'Needs your answer' : c.waiting > 1 ? `${c.waiting} questions` : 'Needs you'}</span>
            </button>
          ))}
          {/* The last chat's changes, with Keep and Discard; it says nothing when none are left. */}
          {r.latest && (
            <div className="resting-changes" data-from={r.latest.title}>
              <ReviewStrip conversation={r.latest.id} busy={false} onOpenItem={onOpenItem} onShown={setChanges} />
            </div>
          )}
        </section>
      )}
      <section className="resting-part" aria-label="Ideas">{ideas}</section>
      {r.earlier.length > 0 && (
        <section className="resting-part" aria-label="Earlier chats">
          <h3 className="resting-title">Earlier chats</h3>
          {r.earlier.map((c) => (
            <button key={c.id} type="button" className="resting-row" onClick={() => onSelect(c.id)}>
              <span className="resting-row-title">{c.title}</span>
              <span className="resting-row-meta">{relativeTime(c.updated_ms, Date.now())}</span>
            </button>
          ))}
        </section>
      )}
    </div>
  );
}
