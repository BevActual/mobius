import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { NoteHit, NotePage } from '@mobius/shared';
import { onCommand } from './commands';
import { relativeTime } from './relative-time';
import type { NotesState } from './useNotes';
import { SideNew, type Start } from './SideNew';
import { FromMobius } from './FromMobius';
import { newItemIn } from './NotesSidebar';
import { AppSidebar, PointMenu, SidebarRow, SidebarSection, SidebarSearch, type MenuEntry } from './ui';

/** How many documents Recent lists: the ones worked on last, wherever they are kept. */
const RECENT = 5;

const PageIcon = () => (
  <svg className="doc-side-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M6 3.5h5.5L15 7v9.5H6z" /><path d="M11.5 3.5V7H15" /></svg>
);

/**
 * Docs' sidebar, on the shared frame (ui/AppSidebar): New, Search, Recent, then each folder with its documents, then
 * From Mobius. A row says when the document was edited and how it starts in its tooltip; its menu opens or deletes it,
 * and Delete asks once more in a second menu at the same place.
 */
export function DocsSidebar({ docs, pin, changed, starts, onStart }: {
  docs: NotesState;
  /** The button that attaches or floats the list, shown beside the first section's name. */
  pin: ReactNode;
  /** Documents Mobius's last turn changed, marked until the turn is kept or undone. */
  changed?: ReadonlySet<string>;
  starts?: readonly Start[];
  onStart?: (prompt: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<NoteHit[] | null>(null);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [menu, setMenu] = useState<{ x: number; y: number; page: NotePage; confirm?: boolean } | null>(null);
  useEffect(() => onCommand('new-folder', () => setNaming(true)), []);

  const all = useMemo(() => docs.notebooks.flatMap((nb) => nb.pages.map((pg) => ({ ...pg, folder: nb.name }))), [docs.notebooks]);
  const recent = useMemo(() => [...all].sort((a, b) => b.modified - a.modified).slice(0, RECENT), [all]);
  const openFolder = docs.page?.path.split('/')[0] ?? docs.notebooks[0]?.name;

  // A document Mobius changed in its last turn opens when none is, once, so a visit after asking lands on it.
  const offered = useRef(false);
  useEffect(() => {
    if (offered.current || docs.page || !changed?.size) return;
    const made = all.filter((pg) => changed.has(pg.path)).sort((a, b) => b.modified - a.modified)[0];
    if (!made) return;
    offered.current = true;
    docs.openIfIdle(made.path, made.title);
  }, [changed, all]); // eslint-disable-line react-hooks/exhaustive-deps

  // "Edited 5 min ago" counts on, so the tooltips are read again each minute.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(t); }, []);
  useEffect(() => setNow(Date.now()), [docs.notebooks]);

  useEffect(() => {
    if (!query.trim()) { setHits(null); return; }
    let live = true;
    const t = window.setTimeout(() => void docs.search(query).then((h) => { if (live) setHits(h); }), 150);
    return () => { live = false; window.clearTimeout(t); };
  }, [query, docs.search, docs.notebooks]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const made = await docs.createNotebook(name.trim() || 'Folder');
    if (made) { setNaming(false); setName(''); await docs.createPage(made); }
  };

  const row = (pg: NotePage, where?: string, key = pg.path) => {
    const when = relativeTime(pg.modified, Math.max(now, pg.modified));
    return (
      <SidebarRow key={key} icon={<PageIcon />} label={pg.title} current={docs.page?.path === pg.path} proposed={changed?.has(pg.path) === true}
        title={[where, when && `Edited ${when}`, pg.preview].filter(Boolean).join(' · ')}
        onSelect={() => void docs.open(pg.path, pg.title)}
        onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, page: pg }); }} />
    );
  };

  const menuEntries = (m: NonNullable<typeof menu>): MenuEntry[] => m.confirm
    ? [
      { label: `Delete “${m.page.title}”`, danger: true, run: () => void docs.remove(m.page.path) },
      { label: 'Cancel', run: () => undefined },
    ]
    : [
      { label: 'Open', run: () => void docs.open(m.page.path, m.page.title) },
      // Delete asks once more, in a menu at the same place, so a slip of the mouse deletes nothing.
      { label: 'Delete document…', danger: true, separated: true, run: () => setMenu({ ...m, confirm: true }) },
    ];

  return (
    <AppSidebar label="Docs sidebar">
      {(openFolder || docs.notebooks.length === 0) && (
        <SideNew item="document" onNew={() => newItemIn(docs, openFolder, 'Documents')} title={openFolder ? `New document in ${openFolder}` : 'New document'}
          {...(starts ? { starts } : {})} {...(onStart ? { onStart } : {})} />
      )}
      <SidebarSearch label="Search docs" value={query} onChange={setQuery} />
      {naming && (
        <form className="notes-name" onSubmit={(e) => void submit(e)}>
          <input autoFocus aria-label="Folder name" placeholder="Folder name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setNaming(false); }} />
          <button type="submit" className="btn primary">Create</button>
        </form>
      )}
      {hits !== null ? (
        <SidebarSection title="Results">
          {hits.length === 0 && <li className="side-empty">No documents match.</li>}
          {hits.map((hit) => (
            <SidebarRow key={hit.path} icon={<PageIcon />} label={hit.title} current={docs.page?.path === hit.path}
              title={`${hit.notebook}${hit.line ? ` — ${hit.line}` : ''}`} onSelect={() => void docs.open(hit.path, hit.title)} />
          ))}
        </SidebarSection>
      ) : (
        <>
          {docs.notebooks.length === 0 && !naming && (
            <div className="side-empty notes-empty">
              <p>No documents yet.</p>
            </div>
          )}
          {/* Recent only when it adds something: more documents than it lists, or more than one folder. */}
          {recent.length > 0 && (docs.notebooks.length > 1 || all.length > RECENT) && (
            <SidebarSection title="Recent" action={pin}>
              {recent.map((pg) => row(pg, pg.folder, `recent:${pg.path}`))}
            </SidebarSection>
          )}
          {docs.notebooks.map((nb) => (
            <SidebarSection key={nb.name} title={nb.name} action={
              <button type="button" className="strip-btn" aria-label={`New document in ${nb.name}`} title="New document" onClick={() => void docs.createPage(nb.name)}>
                <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 5v10M5 10h10" /></svg>
              </button>
            }>
              {nb.pages.length === 0 && <li className="side-empty">No documents yet.</li>}
              {nb.pages.map((pg) => row(pg))}
            </SidebarSection>
          ))}
          {!naming && (
            <button type="button" className="side-new-row doc-side-folder" onClick={() => setNaming(true)}>
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 6.5a1 1 0 0 1 1-1h3.5l1.5 1.5h6a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z" /><path d="M10 9v4M8 11h4" /></svg>
              <span>New folder</span>
            </button>
          )}
          <FromMobius items={all.filter((pg) => changed?.has(pg.path)).map((pg) => ({ key: pg.path, name: pg.title, where: pg.folder, current: docs.page?.path === pg.path, onOpen: () => void docs.open(pg.path, pg.title) }))} />
        </>
      )}
      {menu && <PointMenu key={menu.confirm ? 'confirm' : 'menu'} x={menu.x} y={menu.y} label={menu.confirm ? `Delete ${menu.page.title}?` : menu.page.title} entries={menuEntries(menu)}
        onClose={() => setMenu((m) => (m === menu ? null : m))} />}
    </AppSidebar>
  );
}
