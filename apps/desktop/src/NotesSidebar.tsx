import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { onCommand } from './commands';
import type { NoteHit, NotePage } from '@mobius/shared';
import { hasTag, onShowTag, tagCounts } from './note-tags';
import { relativeTime } from './relative-time';
import type { NotesState } from './useNotes';
import { SideNew, type Start } from './SideNew';
import { FromMobius } from './FromMobius';
import { RowMark } from './RowMark';

/** Notebooks and their pages, newest first, with search. Creating asks for a name inline, never in a dialog. */
/** `changed`: pages the agent's last turn changed, marked until it is undone or another turn ends. */
/** The words for Notes; Docs passes its own, since it keeps documents in folders the same way. */
export interface SidebarWords { app: string; group: string; groups: string; item: string; items: string; about: string; /** Made when something is created before any group exists. */ defaultGroup?: string }
/** A new page in `group`, or the first folder, or a folder made with the default name when there is none. */
export function newItemIn(notes: NotesState, group: string | null | undefined, fallback?: string): void {
  const into = group || notes.notebooks[0]?.name;
  if (into) void notes.createPage(into);
  else if (fallback) void notes.createNotebook(fallback).then((made) => { if (made) void notes.createPage(made); });
}
export const NOTES_WORDS: SidebarWords = { app: 'Notes', group: 'notebook', groups: 'Notebooks', item: 'page', items: 'pages', about: 'Pages are kept as Markdown files in your workspace, so the agent can read and edit them too.' };
const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

/**
 * `tags`: the sidebar has a Tags section (Notes): every `#tag` in the pages, and choosing one lists the pages with it.
 * Pages pinned to the sidebar are listed first, under Pinned. Each page shows how it starts and when it was edited.
 */
export function NotesSidebar({ notes, pin, changed, pinned, onPin, words = NOTES_WORDS, starts, onStart, tags: withTags = false }: { notes: NotesState; pin: ReactNode; changed?: ReadonlySet<string>; pinned?: ReadonlySet<string>; onPin?: (path: string, title: string) => void; words?: SidebarWords; starts?: readonly Start[]; onStart?: (prompt: string) => void; tags?: boolean }) {
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState<string | null>(null);
  useEffect(() => (withTags ? onShowTag((t) => { setQuery(''); setTag(t); }) : undefined), [withTags]);
  const allPages = useMemo(() => notes.notebooks.flatMap((nb) => nb.pages.map((pg) => ({ ...pg, notebook: nb.name }))), [notes.notebooks]);
  const tagList = useMemo(() => (withTags ? tagCounts(allPages) : []), [withTags, allPages]);
  const pinnedPages = useMemo(() => allPages.filter((pg) => pinned?.has(pg.path)), [allPages, pinned]);
  const tagged = useMemo(() => (tag ? allPages.filter((pg) => hasTag(pg.tags, tag)).sort((a, b) => b.modified - a.modified) : []), [tag, allPages]);
  // "Edited 5 min ago" counts on, so the rows are read again each minute.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(t); }, []);
  useEffect(() => setNow(Date.now()), [notes.notebooks]);
  const [closedSections, setClosedSections] = useState<Set<string>>(new Set());
  const toggleSection = (name: string) => setClosedSections((s) => { const n = new Set(s); if (n.has(name)) n.delete(name); else n.add(name); return n; });
  const [hits, setHits] = useState<NoteHit[] | null>(null);
  const [naming, setNaming] = useState(false);
  // The menus' New notebook opens the same naming field.
  useEffect(() => onCommand(words === NOTES_WORDS ? 'new-notebook' : 'new-folder', () => setNaming(true)), [words]);
  const [name, setName] = useState('');
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState<string | null>(null);
  const openNotebook = notes.page?.path.split('/')[0] ?? notes.notebooks[0]?.name;

  useEffect(() => {
    if (!query.trim()) { setHits(null); return; }
    let live = true;
    const t = window.setTimeout(() => void notes.search(query).then((h) => { if (live) setHits(h); }), 150);
    return () => { live = false; window.clearTimeout(t); };
  }, [query, notes.search, notes.notebooks]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const made = await notes.createNotebook(name.trim() || cap(words.group));
    if (made) { setNaming(false); setName(''); await notes.createPage(made); }
  };
  const newItem = () => newItemIn(notes, openNotebook, words.defaultGroup);
  const toggle = (nb: string) => setClosed((s) => { const n = new Set(s); if (n.has(nb)) n.delete(nb); else n.add(nb); return n; });


  /** One page in the list: its title, how it starts and when it was edited; pin and delete on hover. `where` names its notebook. */
  const pageRow = (pg: NotePage, where?: string, key = pg.path) => {
    const when = relativeTime(pg.modified, Math.max(now, pg.modified));
    const sub = [where, when, pg.preview].filter(Boolean).join(' · ');
    const subId = `note-sub-${key.replace(/[^\w-]/g, '_')}`;
    return (
      <li key={key} className="note-item">
        <button type="button" className="note-row" data-proposed={changed?.has(pg.path) || undefined} aria-current={notes.page?.path === pg.path ? 'page' : undefined} aria-label={pg.title} aria-describedby={sub ? subId : undefined} onClick={() => void notes.open(pg.path, pg.title)}>
          <span className="note-lines">
            <span className="note-title">{pg.title}</span>
            {sub && <span className="note-sub" id={subId}>{sub}</span>}
          </span>
          <RowMark changed={changed?.has(pg.path) === true} />
        </button>
        {onPin && <button type="button" className="note-delete note-pin" aria-pressed={pinned?.has(pg.path) ?? false} aria-label={pinned?.has(pg.path) ? `Unpin ${pg.title}` : `Pin ${pg.title} to the sidebar`} title={pinned?.has(pg.path) ? 'Unpin' : 'Pin to the top of the list and the sidebar'} onClick={() => onPin(pg.path, pg.title)}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 3h6M8 3v6l-3 4h10l-3-4V3M10 13v4" /></svg>
        </button>}
        {confirming === pg.path ? (
          <button type="button" className="note-delete confirm" aria-label={`Confirm delete ${pg.title}`} onClick={() => { setConfirming(null); void notes.remove(pg.path); }} onBlur={() => setConfirming(null)}>Delete</button>
        ) : (
          <button type="button" className="note-delete" aria-label={`Delete ${pg.title}`} title={`Delete ${words.item}`} onClick={() => setConfirming(pg.path)}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 6h10M8 6V4h4v2M6.5 6l.7 10h5.6l.7-10" /></svg>
          </button>
        )}
      </li>
    );
  };
  /** A folding section of the list (Pinned, Tags), with its rows. */
  const section = (name: string, rows: ReactNode) => (
    <div role="treeitem" aria-expanded={!closedSections.has(name)} aria-label={name} className="notebook notes-section">
      <div className="notebook-head">
        <button type="button" className="notebook-toggle" onClick={() => toggleSection(name)}>
          <svg className="chev" viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 3 7.5 6 4.5 9" /></svg>
          <span>{name}</span>
        </button>
      </div>
      {!closedSections.has(name) && <ul role="group">{rows}</ul>}
    </div>
  );

  return (
    <aside className="side notes-side" aria-label={`${words.app} sidebar`}>
      <div className="side-head">
        <span className="side-title" title={words.about}>{words.groups}</span>
        <span className="side-actions">
          {pin}
          <button type="button" className="strip-btn" aria-label={`New ${words.group}`} title={`New ${words.group}`} onClick={() => setNaming(true)}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 3h9a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5zM8 3v14" /><path d="M11 8v4M9 10h4" /></svg>
          </button>
        </span>
      </div>
      {/* New first, then Search, then the folders: one order in every app. New goes in the folder that is open (or the first). */}
      {(openNotebook || words.defaultGroup) && (
        <SideNew item={words.item} onNew={newItem} title={openNotebook ? `New ${words.item} in ${openNotebook}` : `New ${words.item}`} {...(starts ? { starts } : {})} {...(onStart ? { onStart } : {})} />
      )}
      <input className="side-search" type="search" aria-label={`Search ${words.app.toLowerCase()}`} placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} />
      {naming && (
        <form className="notes-name" onSubmit={(e) => void submit(e)}>
          <input autoFocus aria-label={`${cap(words.group)} name`} placeholder={`${cap(words.group)} name`} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setNaming(false); }} />
          <button type="submit" className="btn primary">Create</button>
        </form>
      )}
      {tag !== null && hits === null ? (
        <div className="notes-list" role="region" aria-label={`Tagged ${tag}`}>
          <div className="notes-tag-head">
            <span className="note-meta-tag">#{tag}</span>
            <span className="note-sub">{tagged.length === 1 ? `1 ${words.item}` : `${tagged.length} ${words.items}`}</span>
            <button type="button" className="strip-btn notes-tag-clear" aria-label="Show every page" title="Show every page" onClick={() => setTag(null)}>
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 6l8 8M14 6l-8 8" /></svg>
            </button>
          </div>
          <ul role="list" aria-label={`Pages tagged ${tag}`}>
            {tagged.length === 0 && <li className="side-empty">No {words.items} have this tag now.</li>}
            {tagged.map((pg) => pageRow(pg, pg.notebook, `tag:${pg.path}`))}
          </ul>
        </div>
      ) : hits !== null ? (
        <ul className="notes-list" role="list" aria-label="Search results">
          {hits.length === 0 && <li className="side-empty">No {words.items} match.</li>}
          {hits.map((hit) => (
            <li key={hit.path}>
              <button type="button" className="note-row" aria-current={notes.page?.path === hit.path ? 'page' : undefined} onClick={() => void notes.open(hit.path, hit.title)}>
                <span className="note-title">{hit.title}</span>
                <span className="note-sub">{hit.notebook}{hit.line ? ` — ${hit.line}` : ''}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="notes-list" role="tree" aria-label={words.groups}>
          {notes.notebooks.length === 0 && !naming && (
            <div className="side-empty notes-empty">
              <p>No {words.items} yet.</p>
              <button type="button" className="btn primary" onClick={() => setNaming(true)}>New {words.group}</button>
            </div>
          )}
          {pinnedPages.length > 0 && section('Pinned', pinnedPages.map((pg) => pageRow(pg, pg.notebook, `pin:${pg.path}`)))}
          {notes.notebooks.map((nb) => (
            <div key={nb.name} role="treeitem" aria-expanded={!closed.has(nb.name)} aria-label={nb.name} className="notebook">
              <div className="notebook-head">
                <button type="button" className="notebook-toggle" onClick={() => toggle(nb.name)}>
                  <svg className="chev" viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 3 7.5 6 4.5 9" /></svg>
                  <span>{nb.name}</span>
                </button>
                <button type="button" className="strip-btn notebook-add" aria-label={`New ${words.item} in ${nb.name}`} title={`New ${words.item}`} onClick={() => void notes.createPage(nb.name)}>
                  <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 5v10M5 10h10" /></svg>
                </button>
              </div>
              {!closed.has(nb.name) && (
                <ul role="group">
                  {nb.pages.length === 0 && <li className="side-empty">No {words.items} yet.</li>}
                  {nb.pages.map((pg) => pageRow(pg))}
                </ul>
              )}
            </div>
          ))}
          {tagList.length > 0 && section('Tags', tagList.map((t) => (
            <li key={t.tag} className="note-item">
              <button type="button" className="note-row notes-tag-row" aria-label={`#${t.tag}, ${t.count === 1 ? `1 ${words.item}` : `${t.count} ${words.items}`}`} onClick={() => { setQuery(''); setTag(t.tag); }}>
                <span className="note-title">#{t.tag}</span>
                <span className="note-count" aria-hidden="true">{t.count}</span>
              </button>
            </li>
          )))}
          <FromMobius items={notes.notebooks.flatMap((nb) => nb.pages.filter((pg) => changed?.has(pg.path)).map((pg) => ({ key: pg.path, name: pg.title, where: nb.name, current: notes.page?.path === pg.path, onOpen: () => void notes.open(pg.path, pg.title) })))} />
        </div>
      )}
    </aside>
  );
}
