import { useEffect, useRef, useState } from 'react';
import type { DownloadEntry } from '@mobius/shared';
import { formatBytes, percent } from './settings/models-format';

const TEXT = { done: 'Done', failed: 'Failed', cancelled: 'Cancelled' } as const;

/**
 * Downloads, as Safari keeps them: a button in the sidebar's head that shows how far they have got, opening a popover of
 * them, which opens by itself when a download starts. It drops down inside the sidebar, since anything over the page
 * would be hidden behind it.
 */
export function DownloadsButton({ entries }: { entries: DownloadEntry[] }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const seen = useRef(new Set(entries.map((e) => e.id)));
  // The downloads there were when the button appeared, read once: they stay closed, even when the list given to the
  // button only fills in just after it shows (it is read as the window opens). A download that starts after opens it.
  const known = useRef<Set<string> | null>(null);
  useEffect(() => {
    let live = true;
    void window.mobius.downloads.get().then((list) => { if (live) known.current = new Set([...seen.current, ...list.map((e) => e.id)]); }).catch(() => { if (live) known.current = new Set(seen.current); });
    return () => { live = false; };
  }, []);
  useEffect(() => {
    const fresh = entries.some((e) => !seen.current.has(e.id) && known.current !== null && !known.current.has(e.id));
    seen.current = new Set(entries.map((e) => e.id));
    if (fresh) setOpen(true);
    if (entries.length === 0) setOpen(false);
  }, [entries]);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('pointerdown', away, true); window.removeEventListener('keydown', key); };
  }, [open]);
  if (entries.length === 0) return null;
  const running = entries.filter((e) => e.state === 'downloading');
  const total = running.reduce((n, e) => n + e.total, 0);
  const share = running.length === 0 ? 1 : total > 0 ? running.reduce((n, e) => n + e.received, 0) / total : 0.15;
  return (
    <span className="dl-wrap" ref={wrap}>
      <button type="button" className="strip-btn dl-button" aria-label="Downloads" aria-expanded={open} title="Downloads" data-busy={running.length > 0 || undefined} onClick={() => setOpen((o) => !o)}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3.5v9M6.5 9l3.5 3.5L13.5 9M5 16h10" /></svg>
        {running.length > 0 && (
          <svg className="dl-ring" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8.5" pathLength="100" strokeDasharray={`${Math.round(share * 100)} 100`} /></svg>
        )}
      </button>
      {open && <div className="dl-pop"><DownloadsList entries={entries} /></div>}
    </span>
  );
}

/** What has been downloaded, with Open and Show in folder for each, and Clear for the finished ones. */
export function DownloadsList({ entries }: { entries: DownloadEntry[] }) {
  if (entries.length === 0) return null;
  const busy = entries.some((e) => e.state === 'downloading');
  return (
    <section className="downloads" aria-label="Downloads">
      <div className="dl-head">
        <span className="dl-title">Downloads</span>
        <button type="button" className="dl-clear" disabled={entries.every((e) => e.state === 'downloading')} onClick={() => window.mobius.downloads.clear()}>Clear</button>
      </div>
      <ul className="dl-list" role="list">
        {entries.map((entry) => (
          <li key={entry.id} className="dl-item" data-state={entry.state}>
            <span className="dl-name" title={entry.name}>{entry.name}</span>
            {entry.state === 'downloading' ? (
              <>
                {entry.total > 0 ? <progress aria-label={`Progress of ${entry.name}`} max={100} value={percent(entry.received, entry.total)} /> : <span className="dl-sub">{formatBytes(entry.received)}</span>}
                <button type="button" className="dl-btn" aria-label={`Cancel ${entry.name}`} onClick={() => window.mobius.downloads.cancel(entry.id)}>Cancel</button>
              </>
            ) : (
              <>
                <span className="dl-sub">{TEXT[entry.state]}{entry.state === 'done' && entry.risky ? ' · can run programs' : ''}</span>
                {entry.state === 'done' && (
                  <span className="dl-actions">
                    {!entry.risky && <button type="button" className="dl-btn" aria-label={`Open ${entry.name}`} onClick={() => window.mobius.downloads.open(entry.id)}>Open</button>}
                    <button type="button" className="dl-btn" aria-label={`Show ${entry.name} in folder`} onClick={() => window.mobius.downloads.show(entry.id)}>Show in folder</button>
                  </span>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
      {busy && <span className="sr-only" role="status">Downloading</span>}
    </section>
  );
}
