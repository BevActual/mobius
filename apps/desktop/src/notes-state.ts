/** Pure decisions for the Notes app, kept apart so they can be tested without a window. */
export type SaveStatus = 'saved' | 'unsaved' | 'saving' | 'conflict' | 'error';

/**
 * Something changed a page on disk. The person's own saves only refresh the list. A change by the assistant to the
 * page that is open is loaded at once when nothing is waiting to be saved; otherwise the person chooses, so neither
 * version is lost.
 */
export function onPageChanged(status: SaveStatus, isOpenPage: boolean, by: 'person' | 'assistant'): 'reload' | 'ask' | 'list-only' {
  if (by !== 'assistant' || !isOpenPage) return 'list-only';
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
