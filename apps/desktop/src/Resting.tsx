import { useEffect, useState, type ReactNode } from 'react';
import type { ConversationInfo, MailDraft } from '@mobius/shared';
import { APP_ICONS } from './Rail';
import { KEPT_EVENT, ReviewStrip, WaitingRow } from './ReviewStrip';
import type { HubTarget } from './search-hub';

/**
 * The resting Mobius panel: a quiet chat. Before anything is asked it shows a Waiting for you card of the things that
 * wait elsewhere (other chats with a question, the last chat's changes, replies Mobius drafted), each with Open, and the
 * ideas for what is open as chips just above the message box. Earlier chats are in the panel title's list.
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
  const [changes, setChanges] = useState(0);
  const drafts = useSuggestedReplies();
  // What waits for you, as the things themselves (the panel look, 22 November 2026): chats with a question, then the
  // last chat's changes and the replies Mobius drafted, each opened where it is. Kept there, never here: an app's own
  // bar holds Keep. Nothing waiting, no card.
  const count = r.needsYou.length + changes + drafts.length;
  return (
    <div className="resting">
      {glance}
      <section className="resting-part waiting-card" aria-label="Waiting for you" hidden={count === 0 || undefined}>
        <h2 className="waiting-card-title">Waiting for you <span className="waiting-card-count">· {count}</span></h2>
        {r.needsYou.map((c) => (
          <WaitingRow key={c.id} icon={APP_ICONS.agent} name={c.title} state={c.waiting === 1 ? 'Needs your answer' : c.waiting > 1 ? `${c.waiting} questions` : 'Needs you'} onOpen={() => onSelect(c.id)} />
        ))}
        {/* Kept mounted, so the card knows how many changes wait. */}
        {r.latest && <ReviewStrip conversation={r.latest.id} busy={false} onOpenItem={onOpenItem} onCount={setChanges} variant="waiting" />}
        {drafts.map((d) => (
          <WaitingRow key={d.id} icon={APP_ICONS.mail} name={`Reply to ${nameOf(d.to)}`} state={`Draft ready · ${d.subject || 'no subject'}`} title={d.to}
            onOpen={onOpenItem && d.replyTo ? () => onOpenItem({ app: 'mail', id: d.replyTo! }) : undefined} />
        ))}
      </section>
      <section className="resting-part resting-ideas" aria-label="Ideas">{ideas}</section>
    </div>
  );
}

/** "Priya Nair <priya@…>, sam@…" → "Priya Nair": the first person a reply goes to, by name where it has one. */
export function nameOf(to: string): string {
  const first = to.split(',')[0]?.trim() ?? '';
  const named = /^"?([^"<]+?)"?\s*<[^>]+>$/.exec(first);
  return named ? named[1]!.trim() : first || 'someone';
}

/** The replies Mobius drafted in Mail that are not yet yours, read again when Mail changes. */
function useSuggestedReplies(): MailDraft[] {
  const [drafts, setDrafts] = useState<MailDraft[]>([]);
  useEffect(() => {
    let live = true;
    const read = () => void window.mobius.mail?.drafts().then((got) => { if (live && Array.isArray(got)) setDrafts(got.filter((d) => d.by === 'mobius')); }, () => undefined);
    read();
    const off = window.mobius.mail?.onChanged?.(read);
    window.addEventListener(KEPT_EVENT, read);
    return () => { live = false; off?.(); window.removeEventListener(KEPT_EVENT, read); };
  }, []);
  return drafts;
}
