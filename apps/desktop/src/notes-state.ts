/** Pure decisions for the Notes app, kept apart so they can be tested without a window. */
export type SaveStatus = 'saved' | 'unsaved' | 'saving' | 'conflict' | 'error';

/**
 * Something changed a page on disk. The person's own saves only refresh the list. A change by the assistant to the
 * page that is open is loaded at once when nothing is waiting to be saved; otherwise the person chooses, so neither
 * version is lost.
 */
export function onPageChanged(status: SaveStatus, isOpenPage: boolean, by: 'person' | 'assistant' | 'another app' | 'undo'): 'reload' | 'ask' | 'list-only' {
  if ((by !== 'assistant' && by !== 'undo') || !isOpenPage) return 'list-only';
  return status === 'saved' ? 'reload' : 'ask';
}

/** What the status line says. Empty when there is nothing worth saying. */
export function statusText(status: SaveStatus): string {
  switch (status) {
    case 'saving': return 'Saving…';
    case 'unsaved': return 'Edited';
    case 'conflict': return 'Changed by the assistant';
    case 'error': return 'Not saved';
    default: return 'Saved';
  }
}

/** The title shown for a page while it is edited: its first `# ` heading, else what the list calls it. */
export function liveTitle(content: string, fallback: string): string {
  for (const line of content.split('\n')) {
    const t = line.trim();
    if (t.startsWith('# ') && t.slice(2).trim()) return t.slice(2).trim().slice(0, 200);
  }
  return fallback;
}

/** The notebook that holds the dated notes Today's note makes. */
export const JOURNAL = 'Journal';

/** Today's note's title: the day as 2026-11-19, which sorts by date and reads the same everywhere. */
export function todayNoteTitle(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Today's note in the Journal, if it was made already. */
export function findTodayNote<P extends { title: string; path: string }>(notebooks: readonly { name: string; pages: readonly P[] }[], now: Date = new Date()): P | undefined {
  const title = todayNoteTitle(now);
  return notebooks.find((nb) => nb.name === JOURNAL)?.pages.find((pg) => pg.title === title);
}

/**
 * The page to open when the open one has gone from disk (Undo took away a page Mobius made, or another app deleted
 * it): the one now where it was in its notebook, else the one before it, else the first page of the first notebook
 * that has one. Null when no page is left. `before` is the list as it was while the page was there.
 */
export function nearestPage<P extends { path: string }>(before: readonly { name: string; pages: readonly P[] }[],
  after: readonly { name: string; pages: readonly P[] }[], gone: string): P | null {
  const notebook = gone.split('/')[0];
  const was = before.find((nb) => nb.name === notebook)?.pages.findIndex((pg) => pg.path === gone) ?? -1;
  const left = after.find((nb) => nb.name === notebook)?.pages.filter((pg) => pg.path !== gone) ?? [];
  if (left.length) return left[Math.min(Math.max(was, 0), left.length - 1)] ?? null;
  return after.flatMap((nb) => nb.pages).find((pg) => pg.path !== gone) ?? null;
}
