import { useEffect, useState } from 'react';
import { KEPT_EVENT, fileKept, keepTurn, scopeOf, turnId } from './ReviewStrip';
import { readBefore } from './readBefore';

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
      // Kept with the whole turn, or with this app's part of it.
      if (live) setKept(id !== null && file !== null && fileKept(id, file));
    };
    void check();
    window.addEventListener(KEPT_EVENT, check);
    return () => { live = false; window.removeEventListener(KEPT_EVENT, check); };
  }, [review?.conversation, file, version]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!review || kept || !file) { setBefore(undefined); return; }
    return readBefore(review.conversation, file, setBefore);
  }, [review?.conversation, kept, file, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const keep = async () => {
    if (!review) return;
    const last = await window.mobius.changes?.lastTurn(review.conversation).catch(() => null);
    const id = last && 'checkpoint' in last ? turnId(review.conversation, last.checkpoint) : null;
    // Only this app's part of the turn: what it changed elsewhere still waits in its own app.
    if (id) keepTurn(id, file ? scopeOf(file) : 'all');
    setKept(true);
  };
  const discard = async () => {
    if (!review || !file) return;
    await window.mobius.changes.undoFile(review.conversation, file).catch(() => null);
  };
  return { before, keep, discard };
}
