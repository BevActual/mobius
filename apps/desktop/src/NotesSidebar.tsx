import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { NoteHit } from '@mobius/shared';
import type { NotesState } from './useNotes';

/** Notebooks and their pages, newest first, with search. Creating asks for a name inline, never in a dialog. */
/** `changed`: pages the agent's last turn changed, marked until it is undone or another turn ends. */
export function NotesSidebar({ notes, pin, changed }: { notes: NotesState; pin: ReactNode; changed?: ReadonlySet<string> }) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<NoteHit[] | null>(null);
  const [naming, setNaming] = useState(false);
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
    const made = await notes.createNotebook(name.trim() || 'Notebook');
    if (made) { setNaming(false); setName(''); await notes.createPage(made); }
  };
  const toggle = (nb: string) => setClosed((s) => { const n = new Set(s); if (n.has(nb)) n.delete(nb); else n.add(nb); return n; });

  return (
    <aside className="side notes-side" aria-label="Notes sidebar">
      <div className="side-head">
        <span className="side-title">Notebooks</span>
        <span className="side-actions">
          {pin}
          <button type="button" className="strip-btn" aria-label="New notebook" title="New notebook" onClick={() => setNaming(true)}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 3h9a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5zM8 3v14" /><path d="M11 8v4M9 10h4" /></svg>
          </button>
          <button type="button" className="strip-btn" aria-label="New page" title="New page" disabled={!openNotebook} onClick={() => openNotebook && void notes.createPage(openNotebook)}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg>
          </button>
        </span>
      </div>
      <input className="side-search" type="search" aria-label="Search notes" placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} />
      {naming && (
        <form className="notes-name" onSubmit={(e) => void submit(e)}>
          <input autoFocus aria-label="Notebook name" placeholder="Notebook name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setNaming(false); }} />
          <button type="submit" className="btn primary">Create</button>
        </form>
      )}
      {hits !== null ? (
        <ul className="notes-list" role="list" aria-label="Search results">
          {hits.length === 0 && <li className="side-empty">No pages match.</li>}
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
        <div className="notes-list" role="tree" aria-label="Notebooks">
          {notes.notebooks.length === 0 && !naming && (
            <div className="side-empty notes-empty">
              <p>Pages are kept as Markdown files in your workspace, so the agent can read and edit them too.</p>
              <button type="button" className="btn primary" onClick={() => setNaming(true)}>New notebook</button>
            </div>
          )}
          {notes.notebooks.map((nb) => (
            <div key={nb.name} role="treeitem" aria-expanded={!closed.has(nb.name)} aria-label={nb.name} className="notebook">
              <div className="notebook-head">
                <button type="button" className="notebook-toggle" onClick={() => toggle(nb.name)}>
                  <svg className="chev" viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 3 7.5 6 4.5 9" /></svg>
                  <span>{nb.name}</span>
                </button>
                <button type="button" className="strip-btn notebook-add" aria-label={`New page in ${nb.name}`} title="New page" onClick={() => void notes.createPage(nb.name)}>
                  <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 5v10M5 10h10" /></svg>
                </button>
              </div>
              {!closed.has(nb.name) && (
                <ul role="group">
                  {nb.pages.length === 0 && <li className="side-empty">No pages yet.</li>}
                  {nb.pages.map((pg) => (
                    <li key={pg.path} className="note-item">
                      <button type="button" className="note-row" aria-current={notes.page?.path === pg.path ? 'page' : undefined} onClick={() => void notes.open(pg.path, pg.title)}>
                        <span className="note-title">{pg.title}</span>
                        {changed?.has(pg.path) && <span className="changed-mark" role="img" aria-label="Changed by the agent" title="Changed by the agent in its last turn" />}
                      </button>
                      {confirming === pg.path ? (
                        <button type="button" className="note-delete confirm" aria-label={`Confirm delete ${pg.title}`} onClick={() => { setConfirming(null); void notes.remove(pg.path); }} onBlur={() => setConfirming(null)}>Delete</button>
                      ) : (
                        <button type="button" className="note-delete" aria-label={`Delete ${pg.title}`} title="Delete page" onClick={() => setConfirming(pg.path)}>
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
