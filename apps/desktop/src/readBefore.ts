/** How long to wait before reading a second time. */
export const RETRY_MS = 1000;

/**
 * Reads a workspace file as it was before the agent's last turn, for review, and hands the text to `use` (null when
 * the turn made the file). The file's change can be seen in an app a little before the turn's record of it is, so a
 * read that fails is said on the console (the e2e logs print it) and tried once more a moment later; `failed` is told
 * only when that one fails too. Returns a cancel function, for an effect's clean-up.
 */
export function readBefore(conversation: string, file: string, use: (text: string | null) => void, failed?: () => void): () => void {
  let live = true;
  let again: ReturnType<typeof setTimeout> | undefined;
  const read = (last: boolean) => {
    void window.mobius.changes.before(conversation, file)
      .catch((e: unknown) => ({ ok: false as const, error: String(e) }))
      .then((was) => {
        if (!live) return;
        if (was && was.ok) { use(was.text); return; }
        console.warn(`[mobius] review: before failed for ${file}: ${was && 'error' in was ? was.error : 'no answer'}${last ? '' : ', reading again'}`);
        if (last) failed?.();
        else again = setTimeout(() => read(true), RETRY_MS);
      });
  };
  read(false);
  return () => { live = false; clearTimeout(again); };
}
