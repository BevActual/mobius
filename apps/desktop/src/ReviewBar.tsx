import { createContext, useContext, useEffect, useState } from 'react';

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
export function WhyThis({ conversation }: { conversation: string }) {
  const [ask, setAsk] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void window.mobius.changes?.turns?.(conversation).then((r) => { if (live) setAsk(r.ok ? r.turns[0]?.ask?.trim() || null : null); }).catch(() => undefined);
    return () => { live = false; };
  }, [conversation]);
  if (!ask) return null;
  return <span className="review-why" title={ask}>Why this: you asked “{ask.length > 90 ? `${ask.slice(0, 89)}…` : ask}”</span>;
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
}

/**
 * The one review bar's answers, the same in every app: Keep, Discard, and Try another (discard, then ask Mobius to do
 * it differently). Keep is the filled one, at the end.
 */
export function ReviewActions({ onKeep, onDiscard, keepTitle, discardTitle, keepLabel, discardLabel }: Props) {
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
      {tryAnother && <button type="button" className="review-btn" data-kind="again" disabled={busy} title="Put it back and ask Mobius to do it another way" onClick={() => void again()}>Try another</button>}
      <button type="button" className="review-btn" disabled={busy} title={discardTitle} aria-label={discardLabel} onClick={() => void onDiscard()}>Discard</button>
      <button type="button" className="review-btn" data-kind="keep" disabled={busy} title={keepTitle} aria-label={keepLabel} onClick={() => void onKeep()}>Keep</button>
    </>
  );
}
