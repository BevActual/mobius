import { useEffect, useState } from 'react';
import type { BookmarkEntry } from '@mobius/shared';

/** The saved pages, kept current. */
export function useBookmarks(): BookmarkEntry[] {
  const [entries, setEntries] = useState<BookmarkEntry[]>([]);
  useEffect(() => {
    let live = true;
    const load = () => void window.mobius.bookmarks.get('').then((next) => live && setEntries(next));
    load();
    const off = window.mobius.bookmarks.onChanged(load);
    return () => {
      live = false;
      off();
    };
  }, []);
  return entries;
}
