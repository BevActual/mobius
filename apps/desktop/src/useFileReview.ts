import { useEffect, useState } from 'react';
import { KEPT_EVENT, fileKept, keepTurn, scopeOf, turnId } from './ReviewStrip';

const RETRY_MS = 1000;

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
    let live = true;
    if (!review || kept || !file) { setBefore(undefined); return; }
    // A read that fails is said on the console (the e2e logs print it) and tried once more a moment later: the file's
    // change can be seen here a little before the turn's record of it is, and nothing else would ask again.
    let again: ReturnType<typeof setTimeout> | undefined;
    const read = (last: boolean) => {
      void window.mobius.changes.before(review.conversation, file)
        .catch((e: unknown) => ({ ok: false as const, error: String(e) }))
        .then((was) => {
          if (!live) return;
          if (was && was.ok) { setBefore(was.text); return; }
          console.warn(`[mobius] review: before failed for ${file}: ${was && 'error' in was ? was.error : 'no answer'}${last ? '' : ', reading again'}`);
          if (!last) again = setTimeout(() => read(true), RETRY_MS);
        });
    };
    read(false);
    return () => { live = false; clearTimeout(again); };
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
