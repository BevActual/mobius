import { Fragment, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { NoteHit, NotePage } from '@mobius/shared';
import { onCommand } from './commands';
import { relativeTime } from './relative-time';
import type { NotesState } from './useNotes';
import { SideNew, type Start } from './SideNew';
import { dayLabel, daysFrom, timeLabel, weekdayLabel } from './dates';
import { useDocOutline } from './docs-outline';
import { newItemIn } from './NotesSidebar';
import { AppSidebar, PointMenu, SidebarRow, SidebarSection, SidebarSearch, type MenuEntry } from './ui';

/** When a document was last edited, as the row's right side says it: a time today, a weekday this week, else a date. */
export function editedLabel(modified: number, now: number): string {
  if (!Number.isFinite(modified) || modified <= 0) return '';
  const days = daysFrom(modified, now);
  if (days === 0) return timeLabel(modified);
  if (days > -7) return weekdayLabel(modified);
  return dayLabel(modified, { now });
}

/**
 * Docs' sidebar, as the timeless mock has it (ui/AppSidebar): New, Search, then each folder as a heading over its
 * documents, each with when it was edited on the right. Under the open document, its headings, indented: choosing one
 * moves the page there. Then From Mobius, the documents its last turn changed. A row's menu opens or deletes it, and
 * Delete asks once more in a second menu at the same place. New folder is in the app's menu (and its command).
 */
export function DocsSidebar({ docs, changed, starts, onStart }: {
  docs: NotesState;
  /** The button that attaches or floats the list; the shell's head has it now, so it is not drawn here. */
  pin?: ReactNode;
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
  const outline = useDocOutline();
  const fromMobius = all.filter((pg) => changed?.has(pg.path));
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

  const row = (pg: NotePage) => {
    const when = relativeTime(pg.modified, Math.max(now, pg.modified));
    const open = docs.page?.path === pg.path;
    const headings = open && outline?.path === pg.path ? outline.items : [];
    return (
      <Fragment key={pg.path}>
        <SidebarRow label={pg.title} current={open} proposed={changed?.has(pg.path) === true}
          title={[when && `Edited ${when}`, pg.preview].filter(Boolean).join(' · ')}
          onSelect={() => void docs.open(pg.path, pg.title)}
          onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, page: pg }); }}
          {...(open ? {} : { trail: <span className="doc-side-when" aria-hidden="true">{editedLabel(pg.modified, now)}</span> })} />
        {headings.length > 0 && (
          <li className="doc-side-outline">
            <ul role="list" aria-label={`Outline of ${pg.title}`}>
              {headings.map((h, i) => (
                <li key={`${i}:${h.text}`}>
                  <button type="button" className="list-row doc-side-heading" data-level={Math.min(h.level, 3)} aria-current={i === outline!.current ? 'location' : undefined}
                    onClick={() => outline!.go(i)}>{h.text || 'Untitled'}</button>
                </li>
              ))}
            </ul>
          </li>
        )}
      </Fragment>
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
            <SidebarRow key={hit.path} label={hit.title} current={docs.page?.path === hit.path}
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
          {docs.notebooks.map((nb) => (
            <SidebarSection key={nb.name} title={nb.name}>
              {nb.pages.length === 0 && <li className="side-empty">No documents yet.</li>}
              {nb.pages.map((pg) => row(pg))}
            </SidebarSection>
          ))}
          {fromMobius.length > 0 && (
            <SidebarSection title="From Mobius">
              {fromMobius.map((pg) => (
                <SidebarRow key={pg.path} label={pg.title} title={`In ${pg.folder}`}
                  onSelect={() => void docs.open(pg.path, pg.title)} trail={<span className="doc-side-review">To review</span>} />
              ))}
            </SidebarSection>
          )}
        </>
      )}
      {menu && <PointMenu key={menu.confirm ? 'confirm' : 'menu'} x={menu.x} y={menu.y} label={menu.confirm ? `Delete ${menu.page.title}?` : menu.page.title} entries={menuEntries(menu)}
        onClose={() => setMenu((m) => (m === menu ? null : m))} />}
    </AppSidebar>
  );
}
