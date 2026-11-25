import type { NotePage } from '@mobius/shared';

/** How a notebook's notes are listed, as Apple Notes' Sort Notes By: newest edit first (the default), newest made
 *  first, or by title A to Z. Pinned notes come first whichever it is. */
export type NoteSort = 'edited' | 'created' | 'title';
export const NOTE_SORTS: readonly { id: NoteSort; label: string }[] = [
  { id: 'edited', label: 'Date edited' },
  { id: 'created', label: 'Date created' },
  { id: 'title', label: 'Title' },
];

export const NOTE_SORT_KEY = 'mobius.notes.sort';
export function noteSort(): NoteSort {
  try {
    const kept = window.localStorage.getItem(NOTE_SORT_KEY);
    return NOTE_SORTS.some((s) => s.id === kept) ? (kept as NoteSort) : 'edited';
  } catch { return 'edited'; }
}
export function setNoteSort(by: NoteSort): void {
  try { window.localStorage.setItem(NOTE_SORT_KEY, by); } catch { /* kept for this visit only */ }
}

/** When a page was made, or last changed where that is not known. */
export const createdOf = (page: NotePage): number => page.created || page.modified;

const byTitle = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
/** A title as it is sorted: a leading "The" is passed over, as in a library. */
export const sortTitle = (title: string): string => title.replace(/^the\s+/i, '').trim() || title;

/** The pages in the order `by` says, pinned ones first; ties keep the newest edit first. */
export function sortPages<T extends NotePage>(pages: readonly T[], by: NoteSort, pinned?: ReadonlySet<string>): T[] {
  const key = (p: T) => (by === 'created' ? createdOf(p) : p.modified);
  return [...pages].sort((a, b) => {
    const pin = Number(pinned?.has(b.path) ?? false) - Number(pinned?.has(a.path) ?? false);
    if (pin) return pin;
    if (by === 'title') return byTitle.compare(sortTitle(a.title), sortTitle(b.title)) || b.modified - a.modified;
    return key(b) - key(a) || byTitle.compare(a.title, b.title);
  });
}
