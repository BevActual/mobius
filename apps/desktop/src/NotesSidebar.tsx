import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { onCommand } from './commands';
import type { NoteHit } from '@mobius/shared';
import type { NotesState } from './useNotes';

/** Notebooks and their pages, newest first, with search. Creating asks for a name inline, never in a dialog. */
/** `changed`: pages the agent's last turn changed, marked until it is undone or another turn ends. */
/** The words for Notes; Docs passes its own, since it keeps documents in folders the same way. */
export interface SidebarWords { app: string; group: string; groups: string; item: string; items: string; about: string; /** Made when something is created before any group exists. */ defaultGroup?: string }
export const NOTES_WORDS: SidebarWords = { app: 'Notes', group: 'notebook', groups: 'Notebooks', item: 'page', items: 'pages', about: 'Pages are kept as Markdown files in your workspace, so the agent can read and edit them too.' };
const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

export function NotesSidebar({ notes, pin, changed, pinned, onPin, words = NOTES_WORDS }: { notes: NotesState; pin: ReactNode; changed?: ReadonlySet<string>; pinned?: ReadonlySet<string>; onPin?: (path: string, title: string) => void; words?: SidebarWords }) {
  const [query, setQuery] = useState('');
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
  const newItem = () => {
    if (openNotebook) void notes.createPage(openNotebook);
    else if (words.defaultGroup) void notes.createNotebook(words.defaultGroup).then((made) => { if (made) void notes.createPage(made); });
  };
  const toggle = (nb: string) => setClosed((s) => { const n = new Set(s); if (n.has(nb)) n.delete(nb); else n.add(nb); return n; });

  return (
    <aside className="side notes-side" aria-label={`${words.app} sidebar`}>
      <div className="side-head">
        <span className="side-title">{words.groups}</span>
        <span className="side-actions">
          {pin}
          <button type="button" className="strip-btn" aria-label={`New ${words.group}`} title={`New ${words.group}`} onClick={() => setNaming(true)}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 3h9a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5zM8 3v14" /><path d="M11 8v4M9 10h4" /></svg>
          </button>
        </span>
      </div>
      <input className="side-search" type="search" aria-label={`Search ${words.app.toLowerCase()}`} placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} />
      {naming && (
        <form className="notes-name" onSubmit={(e) => void submit(e)}>
          <input autoFocus aria-label={`${cap(words.group)} name`} placeholder={`${cap(words.group)} name`} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setNaming(false); }} />
          <button type="submit" className="btn primary">Create</button>
        </form>
      )}
      {hits !== null ? (
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
          {/* New, as the list's first row, in the notebook that is open (or the first). */}
          {(openNotebook || words.defaultGroup) && (
            <button type="button" className="side-new-row" aria-label={`New ${words.item}`} title={openNotebook ? `New ${words.item} in ${openNotebook}` : `New ${words.item}`} onClick={newItem}>
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4.5v11M4.5 10h11" /></svg>
              <span>New {words.item}</span>
            </button>
          )}
          {notes.notebooks.length === 0 && !naming && (
            <div className="side-empty notes-empty">
              <p>{words.about}</p>
              <button type="button" className="btn primary" onClick={() => setNaming(true)}>New {words.group}</button>
            </div>
          )}
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
                  {nb.pages.map((pg) => (
                    <li key={pg.path} className="note-item">
                      <button type="button" className="note-row" data-proposed={changed?.has(pg.path) || undefined} aria-current={notes.page?.path === pg.path ? 'page' : undefined} onClick={() => void notes.open(pg.path, pg.title)}>
                        <span className="note-title">{pg.title}</span>
                        {changed?.has(pg.path) && <span className="changed-mark" role="img" aria-label="Changed by the agent" title="Changed by the agent in its last turn" />}
                      </button>
                      {onPin && <button type="button" className="note-delete note-pin" aria-pressed={pinned?.has(pg.path) ?? false} aria-label={pinned?.has(pg.path) ? `Unpin ${pg.title}` : `Pin ${pg.title} to the sidebar`} title={pinned?.has(pg.path) ? 'Unpin from the sidebar' : 'Pin to the sidebar'} onClick={() => onPin(pg.path, pg.title)}>
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
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}
