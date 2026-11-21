import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { CONTENT_COLORS, Dot, FilterBar, PreviewStrip, Select, SidebarSearch, type TagPicks } from './ui';
import { CATEGORIES, collect, LIBRARY, search, TAG_GROUPS, type Collections, type LibraryCategory, type LibraryItem } from './studio-library';
import { previewNote } from './studio-audio';

/** Collections' seven colours, as in Live; keys 1 to 7 put the chosen item in one. */
const COLLECTION_COLORS = CONTENT_COLORS.slice(0, 7);
/** Key names as the song's key is written (song-format's KEYS). */
const ROOTS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const STORE = 'mobius.music.collections';
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
  notes.forEach((p, i) => window.setTimeout(() => previewNote(item.instrument!, p, gain, item.instrument === 'pad' ? 0.6 : 0.3, item.sound, item.kit), i * 180));
}

/**
 * Music's Library panel, after Live 12's Browser: a category (the sidebar, folded into a select at this width),
 * search, tag filters, the results, and the preview strip at the foot. Enter or a double-click puts the chosen item on
 * the chosen track (a sound replaces its sound, an effect is added), or on a new track when the kinds don't match.
 */
export function StudioLibrary({ songKey, target, onUse }: {
  songKey: string;
  /** The chosen track, named for the tooltips; null when the song has none. */
  target: { name: string; drums: boolean } | null;
  onUse: (item: LibraryItem) => void;
}) {
  const [category, setCategory] = useState<LibraryCategory | `c${number}`>('all');
  const [query, setQuery] = useState('');
  const [picks, setPicks] = useState<TagPicks>({});
  const [collections, setCollections] = useState<Collections>(() => load(STORE, {}));
  const [chosen, setChosen] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ on: boolean; raw: boolean; db: number }>(() => load(PREVIEW, { on: true, raw: false, db: -6 }));
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => keep(STORE, collections), [collections]);
  useEffect(() => keep(PREVIEW, preview), [preview]);

  const inCollection = category.startsWith('c') ? Number(category.slice(1)) : 0;
  const results = useMemo(() => {
    const found = search(LIBRARY, inCollection ? 'all' : (category as LibraryCategory), query, picks);
    return inCollection ? found.filter((it) => collections[it.id]?.includes(inCollection)) : found;
  }, [category, inCollection, query, picks, collections]);
  const item = results.find((it) => it.id === chosen) ?? null;

  const choose = (it: LibraryItem, play: boolean) => {
    setChosen(it.id);
    if (play) audition(it, songKey, preview.db);
    afterFocus(it.id);
  };
  const afterFocus = (id: string) => window.requestAnimationFrame(() => list.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`)?.focus());

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

  const choices = [
    ...CATEGORIES.map((c) => ({ value: c.id as string, label: c.name })),
    ...COLLECTION_COLORS.map((c, i) => ({ value: `c${i + 1}`, label: `Collection ${i + 1} (${c[0]!.toUpperCase()}${c.slice(1)})` })),
  ];
  const useTitle = (it: LibraryItem) => (it.effect ? (target ? `Add to ${target.name}` : 'Add a track first') : target && (it.instrument === 'drums') === target.drums ? `Put on ${target.name}` : 'Add as a new track');
  return (
    <div className="studio-library" role="region" aria-label="Library"
      onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); setCategory('all'); e.currentTarget.querySelector<HTMLInputElement>('input[type="search"], input')?.focus(); } }}>
      <div className="studio-library-head">
        <Select label="Show" hideLabel value={category} choices={choices} onChange={(v) => setCategory(v as LibraryCategory)} />
        <SidebarSearch label="Search the library" value={query} onChange={setQuery} />
        <FilterBar groups={TAG_GROUPS.map((g) => ({ id: g.id, name: g.name, tags: g.tags }))} value={picks} onChange={setPicks} onClear={() => setQuery('')} />
      </div>
      <ul ref={list} className="studio-library-results" role="listbox" aria-label="Results">
        {results.length === 0 && <li className="side-empty" role="presentation">Nothing matches.</li>}
        {results.map((it) => (
          <li key={it.id} data-id={it.id} role="option" aria-selected={it.id === chosen} tabIndex={it.id === (item?.id ?? results[0]?.id) ? 0 : -1}
            className="studio-library-row" title={`${useTitle(it)} (Enter). 1 to 7 put it in a collection, 0 clears.`}
            onClick={() => choose(it, preview.on)} onDoubleClick={() => onUse(it)} onKeyDown={(e) => onKey(e, it)}>
            <span className="studio-library-name">{it.name}</span>
            <span className="studio-library-dots">{(collections[it.id] ?? []).slice(0, 3).map((k) => <Dot key={k} color={COLLECTION_COLORS[k - 1]!} />)}</span>
          </li>
        ))}
      </ul>
      <PreviewStrip on={preview.on} onToggle={(on) => setPreview((p) => ({ ...p, on }))} raw={preview.raw} onRaw={(raw) => setPreview((p) => ({ ...p, raw }))}
        name={item?.name} volume={preview.db} onVolume={(db) => setPreview((p) => ({ ...p, db }))} />
    </div>
  );
}
