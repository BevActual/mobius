import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Button, CONTENT_COLORS, Dot, FilterBar, Menu, PreviewStrip, SidebarSearch, type TagPicks } from './ui';
import { CATEGORIES, collect, LIBRARY, previewShape, search, TAG_GROUPS, type Collections, type LibraryCategory, type LibraryItem } from './studio-library';
import { previewSound } from './studio-engine';
import { SAMPLE_DRAG, sampleName } from './StudioSample';

/** Collections' seven colours, as in Live; keys 1 to 7 put the chosen item in one. */
const COLLECTION_COLORS = CONTENT_COLORS.slice(0, 7);
/** Key names as the song's key is written (song-format's KEYS). */
const ROOTS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
/** What a row is, shown in grey when several kinds are listed together (as Live's icons do under All). */
const KIND: Record<LibraryItem['category'], string> = { sounds: 'Sound', drums: 'Kit', instruments: 'Instrument', effects: 'Effect' };
/** Collections by name: the first is Favourites, as in Live; the rest go by their colour. */
const collectionName = (i: number) => (i === 0 ? 'Favourites' : `${COLLECTION_COLORS[i]![0]!.toUpperCase()}${COLLECTION_COLORS[i]!.slice(1)}`);
const STORE = 'mobius.music.collections';
const PLACE = 'mobius.music.browser-place';
const PREVIEW = 'mobius.music.preview';

function load<T>(key: string, empty: T): T {
  try { const v = window.localStorage.getItem(key); return v ? (JSON.parse(v) as T) : empty; } catch { return empty; }
}
function keep(key: string, value: unknown) {
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* not kept */ }
}

/** A short phrase in the song's key on the item's sound: the root, the fifth and the octave (a kit plays a beat). */
function audition(item: LibraryItem, key: string, db: number) {
  if (!item.instrument) return;
  const gain = Math.min(1, 0.8 * 10 ** (db / 20));
  const root = 48 + Math.max(0, ROOTS.indexOf(key.split(' ')[0] ?? 'C'));
  const notes = item.instrument === 'drums' ? [36, 42, 38, 42] : item.instrument === 'bass' ? [root - 12, root - 5, root] : [root, root + 7, root + 12];
  notes.forEach((p, i) => window.setTimeout(() => previewSound({ instrument: item.instrument!, sound: item.sound, kit: item.kit }, p, gain, item.instrument === 'pad' ? 0.6 : 0.3), i * 180));
}

/** Where the Browser is: a Library category, a collection (by its key, 1 to 7), or the Songs place. */
type Place = LibraryCategory | `c${number}` | 'songs' | 'samples';

/**
 * Music's Browser, after Live 12's (docs/reference/music-parity.md, "The Library panel"; Live 12 manual, Working with
 * the Browser): search on top, then the sidebar (Collections, Library, Places) beside the results (tag filters, then
 * Name and Type), and the preview strip with Similar sounds at the foot. Songs is a Place, holding the songs list.
 * Enter or a double-click puts the chosen item on the chosen track (a sound replaces its sound, an effect is added), or
 * on a new track when the kinds don't match.
 */
export function StudioLibrary({ songKey, target, onUse, songs, songPath = '', onUseSample }: {
  songKey: string;
  /** The open song's page, whose Samples folder the Samples place lists. */
  songPath?: string;
  /** A sample put on the chosen track (Enter or a double-click); it can also be dragged onto a sampler, pad or audio track. */
  onUseSample?: (file: string) => void;
  /** The chosen track, named for the tooltips; null when the song has none. */
  target: { name: string; drums: boolean } | null;
  onUse: (item: LibraryItem) => void;
  /** The songs list, shown when the Songs place is chosen. */
  songs?: ReactNode;
}) {
  const [place, setPlace] = useState<Place>(() => load<Place>(PLACE, 'all'));
  const category: LibraryCategory | `c${number}` = place === 'songs' || place === 'samples' ? 'all' : place;
  // The song's own samples (its Samples folder, takes included), asked of the engine when the place opens.
  const [samples, setSamples] = useState<string[] | null>(null);
  const [sampleAt, setSampleAt] = useState<string | null>(null);
  useEffect(() => {
    if (place !== 'samples') return;
    let live = true;
    setSamples(null);
    const m = typeof window === 'undefined' ? undefined : window.mobius?.music;
    if (!songPath || !m?.samples) { setSamples([]); return; }
    void m.samples(songPath).then((r) => { if (live) setSamples(r.ok ? r.files : []); }, () => { if (live) setSamples([]); });
    return () => { live = false; };
  }, [place, songPath]);
  const shownSamples = (samples ?? []).filter((f) => !query.trim() || f.toLowerCase().includes(query.trim().toLowerCase()));
  const [query, setQuery] = useState('');
  const [picks, setPicks] = useState<TagPicks>({});
  const [collections, setCollections] = useState<Collections>(() => load(STORE, {}));
  const [chosen, setChosen] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ on: boolean; raw: boolean; db: number }>(() => load(PREVIEW, { on: true, raw: false, db: -6 }));
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => keep(STORE, collections), [collections]);
  useEffect(() => keep(PREVIEW, preview), [preview]);
  useEffect(() => keep(PLACE, place), [place]);

  const inCollection = category.startsWith('c') ? Number(category.slice(1)) : 0;
  const results = useMemo(() => {
    const found = search(LIBRARY, inCollection ? 'all' : (category as LibraryCategory), query, picks);
    return inCollection ? found.filter((it) => collections[it.id]?.includes(inCollection)) : found;
  }, [category, inCollection, query, picks, collections]);
  const item = results.find((it) => it.id === chosen) ?? null;
  const shape = useMemo(() => (item ? previewShape(item) : null), [item]);
  const seconds = shape ? Math.max(1, Math.round(shape.seconds)) : 0;
  const counts = useMemo(() => COLLECTION_COLORS.map((_, i) => Object.values(collections).filter((ks) => ks.includes(i + 1)).length), [collections]);

  const choose = (it: LibraryItem, play: boolean) => {
    setChosen(it.id);
    if (play) audition(it, songKey, preview.db);
    afterFocus(it.id);
  };
  const afterFocus = (id: string) => window.requestAnimationFrame(() => list.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`)?.focus());
  /** Similar sounds, as in Live 12: the same kind with the same tags, the chosen one first. */
  const similar = (it: LibraryItem) => {
    setPlace(it.category);
    setQuery('');
    setPicks(Object.fromEntries(Object.entries(it.tags).filter(([, t]) => t.length > 0)));
    afterFocus(it.id);
  };

  const onKey = (e: KeyboardEvent<HTMLLIElement>, it: LibraryItem) => {
    const at = results.findIndex((r) => r.id === it.id);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = results[Math.max(0, Math.min(results.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (next) choose(next, preview.on);
    } else if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); audition(it, songKey, preview.db); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); audition(it, songKey, preview.db); }
    else if (e.key === 'Enter') { e.preventDefault(); onUse(it); }
    else if (/^[0-7]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); e.stopPropagation(); setCollections((c) => collect(c, it.id, Number(e.key))); }
    else if (e.key === 'Escape') { e.preventDefault(); setQuery(''); setPicks({}); }
  };

  const row = (id: Place, label: ReactNode, name: string, count?: number) => (
    <li key={id}><button type="button" className="studio-browser-place" aria-current={place === id || undefined} aria-label={name} onClick={() => setPlace(id)}>
      {label}{count ? <span className="studio-browser-count">{count}</span> : null}
    </button></li>
  );
  const useTitle = (it: LibraryItem) => (it.effect ? (target ? `Add to ${target.name}` : 'Add a track first') : target && (it.instrument === 'drums') === target.drums ? `Put on ${target.name}` : 'Add as a new track');
  return (
    <div className="studio-library" role="region" aria-label="Library"
      onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); if (place === 'songs') setPlace('all'); e.currentTarget.querySelector<HTMLInputElement>('.studio-library-search input, .studio-library-search')?.focus(); } }}>
      <div className="studio-library-head">
        <span className="studio-library-search"><SidebarSearch label="Search the library" value={query} onChange={(q) => { setQuery(q); if (place === 'songs' && q) setPlace('all'); }} /></span>
        {/* Raw and the preview volume live here, so the preview strip stays one line. */}
        <Menu label="Browser options" entries={[
          { label: 'Raw (its own tempo, once)', checked: preview.raw, run: () => setPreview((p) => ({ ...p, raw: !p.raw })) },
          ...[0, -6, -12, -18].map((db, i) => ({ label: `Preview volume ${db === 0 ? '0' : `−${-db}`} dB`, checked: preview.db === db, separated: i === 0, run: () => setPreview((p) => ({ ...p, db })) })),
        ]} trigger={<button type="button" className="ui-icon-button studio-browser-more" aria-label="Browser options" title="Browser options: Raw, preview volume"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8h.01M8 8h.01M12.5 8h.01" /></svg></button>} />
      </div>
      <div className="studio-browser-cols">
        <nav className="studio-browser-side" aria-label="Places">
          <p className="studio-browser-title">Collections</p>
          <ul>{COLLECTION_COLORS.map((c, i) => row(`c${i + 1}`, <><Dot color={c} /><span>{collectionName(i)}</span></>, `${collectionName(i)} (collection ${i + 1})`, counts[i]))}</ul>
          <p className="studio-browser-title">Library</p>
          <ul>{CATEGORIES.map((c) => row(c.id, <span>{c.name}</span>, c.name))}</ul>
          <p className="studio-browser-title">Places</p>
          <ul>
            {songs && row('songs', <span>Songs</span>, 'Songs')}
            {row('samples', <span>Samples</span>, 'Samples in this song')}
          </ul>
        </nav>
        {place === 'samples' ? (
          <div className="studio-browser-main">
            <div className="studio-library-cols" aria-hidden="true"><span>Name</span><span>Folder</span></div>
            <ul className="studio-library-results" role="listbox" aria-label="Samples">
              {samples === null && <li className="side-empty" role="presentation">Looking…</li>}
              {samples !== null && shownSamples.length === 0 && <li className="side-empty" role="presentation">{songPath ? 'No samples in this song yet. Drop a WAV on a sampler or pad, or record a take.' : 'Open a song to see its samples.'}</li>}
              {shownSamples.map((f, i) => (
                <li key={f} data-id={f} role="option" aria-selected={f === sampleAt} tabIndex={f === (sampleAt ?? shownSamples[0]) || (!sampleAt && i === 0) ? 0 : -1} draggable
                  className="studio-library-row" title={`${target ? `Put on ${target.name}` : 'Add as a new Sampler track'} (Enter), or drag onto a sampler, pad or audio track`}
                  onDragStart={(e) => { e.dataTransfer.setData(SAMPLE_DRAG, f); e.dataTransfer.effectAllowed = 'copy'; }}
                  onClick={() => setSampleAt(f)} onDoubleClick={() => onUseSample?.(f)}
                  onKeyDown={(e) => {
                    const at = shownSamples.indexOf(f);
                    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const next = shownSamples[Math.max(0, Math.min(shownSamples.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))]; if (next) { setSampleAt(next); window.requestAnimationFrame(() => (e.currentTarget.parentElement?.querySelector<HTMLElement>(`[data-id="${CSS.escape(next)}"]`))?.focus()); } }
                    else if (e.key === 'Enter') { e.preventDefault(); onUseSample?.(f); }
                  }}>
                  <span className="studio-library-name">{sampleName(f)}</span>
                  <span className="studio-library-dots" />
                  <span className="studio-library-kind">{f.split('/').slice(1, -1).join('/') || 'Samples'}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : place === 'songs' && songs ? <div className="studio-browser-songs">{songs}</div> : (
          <div className="studio-browser-main">
            <FilterBar groups={TAG_GROUPS.map((g) => ({ id: g.id, name: g.name, tags: g.tags }))} value={picks} onChange={setPicks} onClear={() => setQuery('')} />
            <div className="studio-library-cols" aria-hidden="true"><span>Name</span><span>Type</span></div>
            <ul ref={list} className="studio-library-results" role="listbox" aria-label="Results">
              {results.length === 0 && <li className="side-empty" role="presentation">Nothing matches.</li>}
              {results.map((it) => (
                <li key={it.id} data-id={it.id} role="option" aria-selected={it.id === chosen} tabIndex={it.id === (item?.id ?? results[0]?.id) ? 0 : -1}
                  className="studio-library-row" title={`${useTitle(it)} (Enter). 1 to 7 put it in a collection, 0 clears.`}
                  onClick={() => choose(it, preview.on)} onDoubleClick={() => onUse(it)} onKeyDown={(e) => onKey(e, it)}>
                  <span className="studio-library-name">{it.name}</span>
                  <span className="studio-library-dots">{(collections[it.id] ?? []).slice(0, 3).map((k) => <Dot key={k} color={COLLECTION_COLORS[k - 1]!} />)}</span>
                  <span className="studio-library-kind">{KIND[it.category]}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <div className="studio-browser-foot">
        <PreviewStrip compact on={preview.on} onToggle={(on) => setPreview((p) => ({ ...p, on }))} raw={preview.raw} onRaw={(raw) => setPreview((p) => ({ ...p, raw }))}
          name={item?.name} {...(shape ? { peaks: shape.peaks, time: `0:${String(seconds).padStart(2, '0')}` } : {})} volume={preview.db} onVolume={(db) => setPreview((p) => ({ ...p, db }))} />
        <Button disabled={!item || item.category === 'effects'} title={item ? `Sounds like ${item.name}: the same kind, with the same tags` : 'Choose a sound first'} onClick={() => { if (item) similar(item); }}>Similar sounds</Button>
      </div>
    </div>
  );
}
