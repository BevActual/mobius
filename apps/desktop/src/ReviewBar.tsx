import { createContext, useContext, useEffect, useState } from 'react';
import { linkedFrom } from './conversation';

/**
 * Asking Mobius for another go at what was just discarded. The app provides it while a conversation can take a new
 * message; without it, Try another is not offered.
 */
export const TryAnotherContext = createContext<(() => void) | null>(null);

/** What Mobius is told when its change is discarded with Try another. */
export const TRY_ANOTHER_ASK = 'I discarded that change. Try another way.';

/**
 * "Why this": what was asked in the turn that made a proposal, so the change can be judged against it. Nothing is shown
 * when the turn had no words (a schedule, say) or the turns cannot be read.
 */
export function WhyThis({ conversation, file }: { conversation: string; /** Music (marked): the file under review, to quote the turn that changed it. */ file?: string }) {
  const [ask, setAsk] = useState<string | null>(null);
  const [from, setFrom] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    void window.mobius.changes?.turns?.(conversation).then((r) => { if (live) setAsk(r.ok ? ((file && r.turns.find((t) => t.files?.includes(file))) || r.turns[0])?.ask?.trim() || null : null); }).catch(() => undefined);
    void window.mobius.agent.history(conversation).then((h) => { if (live) setFrom(linkedFrom(h)); }).catch(() => undefined);
    return () => { live = false; };
  }, [conversation, file]);
  return (
    <>
      {ask && <span className="review-why" title={ask}>Why this: you asked “{ask.length > 90 ? `${ask.slice(0, 89)}…` : ask}”</span>}
      {from.length > 0 && <span className="review-why review-linked">Linked from {from.join(' · ')}</span>}
    </>
  );
}

interface Props {
  onKeep: () => unknown;
  /** Puts the change back. May resolve with a reason it could not, which stops Try another. */
  onDiscard: () => unknown;
  keepTitle?: string;
  discardTitle?: string;
  /** Names that say what the buttons act on, for a bar that sits among others (a list of conversations). */
  keepLabel?: string;
  discardLabel?: string;
  /** The buttons' words, when they act on more than one app's changes ("Keep all"). */
  keepText?: string;
  discardText?: string;
}

/**
 * The one review bar's answers, the same in every app and in the order Docs' change blocks use: Discard, Try another
 * (discard, then ask Mobius to do it differently) and Keep. Keep is the filled one, at the end.
 */
export function ReviewActions({ onKeep, onDiscard, keepTitle, discardTitle, keepLabel, discardLabel, keepText = 'Keep', discardText = 'Discard', only }: Props & { /** Just Keep, or just Try another and Discard (a compact row keeps those inside Review). */ only?: 'keep' | 'others' }) {
  const tryAnother = useContext(TryAnotherContext);
  const [busy, setBusy] = useState(false);
  const again = async () => {
    setBusy(true);
    try {
      const problem = await onDiscard();
      if (typeof problem === 'string' && problem) return;
      tryAnother?.();
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {only !== 'keep' && <button type="button" className="review-btn" disabled={busy} title={discardTitle} aria-label={discardLabel} onClick={() => void onDiscard()}>{discardText}</button>}
      {only !== 'keep' && tryAnother && <button type="button" className="review-btn" data-kind="again" disabled={busy} title="Put it back and ask Mobius to do it another way" onClick={() => void again()}>Try another</button>}
      {only !== 'others' && <button type="button" className="review-btn" data-kind="keep" disabled={busy} title={keepTitle} aria-label={keepLabel} onClick={() => void onKeep()}>{keepText}</button>}
    </>
  );
}

/**
 * The line under a change block, for pages drawn in React (Tasks): who changed it, then Discard, Try another and Keep.
 * The editor's pages draw the same line themselves (change-blocks.ts).
 */
export function ChangeBar({ who, problem, ...actions }: Props & { who: string; problem?: string | null }) {
  return (
    <div className="doc-change-bar" role="group" aria-label="A change Mobius made">
      <span>{who}</span>
      <ReviewActions {...actions} />
      {problem && <span className="review-problem" role="alert">{problem}</span>}
    </div>
  );
}
