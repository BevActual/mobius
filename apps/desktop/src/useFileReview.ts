import { useEffect, useState } from 'react';
import { KEPT_EVENT, keepTurn, keptTurns, turnId } from './ReviewStrip';

/**
 * What the agent's last turn did to one workspace file: the file as it was before (`null` when the turn made it,
 * `undefined` when there is nothing to review, or it was kept), and Keep and Discard. `version` changes whenever the
 * file does, so a new turn's change is looked at again.
 */
export function useFileReview(review: { conversation: string } | null | undefined, file: string | null, version: unknown) {
  const [kept, setKept] = useState(false);
  const [before, setBefore] = useState<string | null | undefined>(undefined);
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
  }, [review?.conversation, file, version]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let live = true;
    if (!review || kept || !file) { setBefore(undefined); return; }
    void window.mobius.changes.before(review.conversation, file).then((was) => { if (live && was && was.ok) setBefore(was.text); }).catch(() => {});
    return () => { live = false; };
  }, [review?.conversation, kept, file, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const keep = async () => {
    if (!review) return;
    const last = await window.mobius.changes?.lastTurn(review.conversation).catch(() => null);
    const id = last && 'checkpoint' in last ? turnId(review.conversation, last.checkpoint) : null;
    if (id) keepTurn(id);
    setKept(true);
  };
  const discard = async () => {
    if (!review || !file) return;
    await window.mobius.changes.undoFile(review.conversation, file).catch(() => null);
  };
  return { before, keep, discard };
}
