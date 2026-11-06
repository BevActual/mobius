import { useEffect, useState } from 'react';
import type { DownloadEntry } from '@mobius/shared';

export function useDownloads(): DownloadEntry[] {
  const [entries, setEntries] = useState<DownloadEntry[]>([]);
  useEffect(() => {
    let live = true;
    const off = window.mobius.downloads.onState((next) => live && setEntries(next));
    void window.mobius.downloads.get().then((initial) => live && setEntries(initial));
    return () => {
      live = false;
      off();
    };
  }, []);
  return entries;
}
