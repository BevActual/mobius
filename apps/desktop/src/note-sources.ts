import type { Notebook, NotePage } from '@mobius/shared';

/** A note a fact was taken from, named in its source as `Notes · <title>` or `Notes · <notebook> · <title>`. */
export interface NoteSource { notebook: string; page: NotePage }

const same = (a: string, b: string) => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();

/**
 * The note a claim's source names, found among the notebooks by title (the notebook too, when it is named). When two
 * notes share the title, the one changed last: it is the one the search put first. Null for any other source.
 */
export function noteForSource(source: string, notebooks: readonly Notebook[]): NoteSource | null {
  const parts = source.split('·').map((p) => p.trim());
  if (parts.length < 2 || !same(parts[0] ?? '', 'Notes')) return null;
  const title = parts.at(-1) ?? '';
  const inNotebook = parts.length > 2 ? parts.slice(1, -1).join(' · ') : null;
  if (!title) return null;
  let best: NoteSource | null = null;
  for (const nb of notebooks) {
    if (inNotebook !== null && !same(nb.name, inNotebook)) continue;
    for (const page of nb.pages) {
      if (same(page.title, title) && (!best || page.modified > best.page.modified)) best = { notebook: nb.name, page };
    }
  }
  return best;
}
