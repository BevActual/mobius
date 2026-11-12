import { useEffect, useState } from 'react';
import { isNotesFailure, type BookmarkEntry, type HistoryEntry } from '@mobius/shared';
import { tileHue, tileLetter } from './browser-view';

const host = (url: string): string => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };

/** The sites visited most among the recent history, once each, most visited first. */
export function frequentSites(entries: readonly HistoryEntry[], limit = 8): { url: string; title: string; site: string }[] {
  const by = new Map<string, { url: string; title: string; site: string; count: number; first: number }>();
  entries.forEach((e, i) => {
    if (!/^https?:/i.test(e.url)) return;
    const site = host(e.url);
    const was = by.get(site);
    if (was) was.count += 1;
    else by.set(site, { url: e.url, title: e.title || site, site, count: 1, first: i });
  });
  return [...by.values()].sort((a, b) => b.count - a.count || a.first - b.first).slice(0, limit).map(({ url, title, site }) => ({ url, title, site }));
}

/** What the start page says at the top, by the time of day. */
export const greeting = (hour: number): string => (hour < 5 ? 'Good evening' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening');

function Tile({ url, title, onOpen }: { url: string; title: string; onOpen: (url: string) => void }) {
  const site = host(url);
  return (
    <button type="button" className="start-tile" title={url} onClick={() => onOpen(url)}>
      <span className="start-tile-mark" aria-hidden="true" style={{ ['--hue' as string]: tileHue(site) }}>{tileLetter(site)}</span>
      <span className="start-tile-title">{title || site}</span>
    </button>
  );
}

/**
 * A new tab's page, as Safari's start page and Arc's new tab do: favourites, the sites visited most, and what waits in
 * the reading list. Drawn by Mobius, not the page view, so nothing of it is ever shown to a web page.
 */
export function StartPage({ onOpen, onRead }: { onOpen: (url: string) => void; onRead: (path: string, title: string) => void }) {
  const [favourites, setFavourites] = useState<BookmarkEntry[]>([]);
  const [frequent, setFrequent] = useState<{ url: string; title: string; site: string }[]>([]);
  const [reading, setReading] = useState<{ path: string; title: string }[]>([]);
  useEffect(() => {
    let live = true;
    void window.mobius.bookmarks.get('').then((b) => { if (live) setFavourites(b.slice(0, 8)); }).catch(() => {});
    void window.mobius.history.get('').then((h) => { if (live) setFrequent(h.enabled ? frequentSites(h.entries.slice(0, 300)) : []); }).catch(() => {});
    void window.mobius.reading?.list().then((lists) => {
      if (!live || isNotesFailure(lists)) return;
      setReading(lists.filter((nb) => nb.name !== 'Archive').flatMap((nb) => nb.pages).sort((a, b) => b.modified - a.modified).slice(0, 4).map((p) => ({ path: p.path, title: p.title })));
    }).catch(() => {});
    return () => { live = false; };
  }, []);
  const empty = favourites.length === 0 && frequent.length === 0 && reading.length === 0;
  return (
    <section className="start-page" aria-label="New tab">
      <div className="start-inner">
        <header className="start-head">
          <h1 className="start-greeting">{greeting(new Date().getHours())}</h1>
          <p className="start-hint">Type an address or a question in the bar, or start from here.</p>
        </header>
        {favourites.length > 0 && (
          <section aria-label="Favourites">
            <h2 className="start-heading">Favourites</h2>
            <div className="start-grid">{favourites.map((b) => <Tile key={b.url} url={b.url} title={b.title} onOpen={onOpen} />)}</div>
          </section>
        )}
        {frequent.length > 0 && (
          <section aria-label="Frequently visited">
            <h2 className="start-heading">Frequently visited</h2>
            <div className="start-grid">{frequent.map((f) => <Tile key={f.site} url={f.url} title={f.site} onOpen={onOpen} />)}</div>
          </section>
        )}
        {reading.length > 0 && (
          <section aria-label="Reading list">
            <h2 className="start-heading">Reading list</h2>
            <ul className="start-reading">
              {reading.map((r) => <li key={r.path}><button type="button" onClick={() => onRead(r.path, r.title)}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 4.5h4.5A1.5 1.5 0 0 1 10 6v10a1.5 1.5 0 0 0-1.5-1.5H4zM16 4.5h-4.5A1.5 1.5 0 0 0 10 6v10a1.5 1.5 0 0 1 1.5-1.5H16z" /></svg><span>{r.title}</span></button></li>)}
            </ul>
          </section>
        )}
        {empty && <p className="start-empty">Pages you bookmark and visit often show up here, with what you saved to read.</p>}
      </div>
    </section>
  );
}
