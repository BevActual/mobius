import { createdOf, sortPages, type NoteSort } from './note-sort';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { onCommand } from './commands';
import type { DeletedNote, NoteHit, NotePage } from '@mobius/shared';
import { hasTag, onShowTag, tagCounts } from './note-tags';
import { relativeTime } from './relative-time';
import { dayLabel, timeLabel, weekdayLabel } from './dates';
import type { NotesState } from './useNotes';
import { SideNew, type Start } from './SideNew';
import { FromMobius } from './FromMobius';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';
import { AppSidebar, SidebarRow, SidebarSection, SidebarSearch } from './ui';
import { afterPaint } from './ui/frame';

/** Notebooks and their pages, newest first, with search. Creating asks for a name inline, never in a dialog. */
/** `changed`: pages the agent's last turn changed, marked until it is undone or another turn ends. */
/** The words for Notes; Docs passes its own, since it keeps documents in folders the same way. */
export interface SidebarWords { app: string; group: string; groups: string; item: string; items: string; about: string; /** Made when something is created before any group exists. */ defaultGroup?: string }
/** How many of a notebook's pages are drawn at first, and how many more each time the list is scrolled near its end.
 *  A notebook of thousands of pages then opens as fast as a short one (docs/developers/speed.md). */
export const FIRST_ROWS = 100;
const MORE_ROWS = 200;
/** What the first frame of a visit draws: more than a tall window shows. The rest of FIRST_ROWS follows a frame
 *  later, so opening Notes on a long notebook draws one screenful before the page shows, not a hundred rows. */
const FIRST_FRAME_ROWS = 30;

/** The end of a list drawn in part: when it scrolls into view, more rows are drawn. */
function MoreRows({ onMore }: { onMore: () => void }) {
  const end = useRef<HTMLLIElement>(null);
  useEffect(() => {
    const el = end.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const seen = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) onMore(); }, { rootMargin: '400px 0px' });
    seen.observe(el);
    return () => seen.disconnect();
  }, [onMore]);
  return <li ref={end} className="side-more" aria-hidden="true" />;
}

/** A new page in `group`, or the first folder, or a folder made with the default name when there is none. */
export function newItemIn(notes: NotesState, group: string | null | undefined, fallback?: string): void {
  const into = group || notes.notebooks[0]?.name;
  if (into) void notes.createPage(into);
  else if (fallback) void notes.createNotebook(fallback).then((made) => { if (made) void notes.createPage(made); });
}
/** The list panel's name for each app that uses this list, as the panel's header names it (App.tsx OWN_LIST). */
const LIST_NAME: Record<string, string> = { Notes: 'Notebooks', Slides: 'Decks', Design: 'Designs', Canvas: 'Boards', Music: 'Songs', Research: 'Reports', Views: 'Dashboards' };

export const NOTES_WORDS: SidebarWords = { app: 'Notes', group: 'notebook', groups: 'Notebooks', item: 'note', items: 'notes', about: 'Pages are kept as Markdown files in your workspace, so the agent can read and edit them too.', defaultGroup: 'Notes' };
const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);
/** How long something stays in the Trash before it goes for good (30 days, as moves.rs keeps it). */
export function trashLeft(deletedMs: number, now: number): string {
  const days = Math.ceil((deletedMs + 30 * 86_400_000 - now) / 86_400_000);
  return days <= 1 ? 'Goes today' : `${days} days left`;
}

/**
 * `tags`: the sidebar has a Tags section (Notes): every `#tag` in the pages, and choosing one lists the pages with it.
 * Pages pinned to the sidebar are listed first, under Pinned. Each page shows how it starts and when it was edited.
 */
/** A note's date in the list, as Mail shows a message's: the time today, the weekday this week, the day before that. */
export function listDate(ms: number, now: number): string {
  const d = new Date(ms);
  if (d.toDateString() === new Date(now).toDateString()) return timeLabel(d);
  if (now - ms < 6 * 86_400_000 && ms <= now) return weekdayLabel(d);
  return dayLabel(d, { now: new Date(now) });
}

export function NotesSidebar({ notes, pin, changed, pinned, onPin, words = NOTES_WORDS, starts, onStart, tags: withTags = false, synced, sort = 'edited' }: { sort?: NoteSort; synced?: (folder: string) => ReactNode; notes: NotesState; pin: ReactNode; changed?: ReadonlySet<string>; pinned?: ReadonlySet<string>; onPin?: (path: string, title: string) => void; words?: SidebarWords; starts?: readonly Start[]; onStart?: (prompt: string) => void; tags?: boolean }) {
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState<string | null>(null);
  useEffect(() => (withTags ? onShowTag((t) => { setQuery(''); setTag(t); }) : undefined), [withTags]);
  const allPages = useMemo(() => notes.notebooks.flatMap((nb) => nb.pages.map((pg) => ({ ...pg, notebook: nb.name }))), [notes.notebooks]);
  // A page Mobius changed in its last turn opens when none is, once, so a visit after asking lands on it.
  const offered = useRef(false);
  useEffect(() => {
    if (offered.current || notes.page || !changed?.size) return;
    const made = allPages.filter((pg) => changed.has(pg.path)).sort((a, b) => b.modified - a.modified)[0];
    if (!made) return;
    offered.current = true;
    notes.openIfIdle(made.path, made.title);
  }, [changed, allPages]); // eslint-disable-line react-hooks/exhaustive-deps
  const tagList = useMemo(() => (withTags ? tagCounts(allPages) : []), [withTags, allPages]);
  const pinnedPages = useMemo(() => sortPages(allPages.filter((pg) => pinned?.has(pg.path)), sort), [allPages, pinned, sort]);
  // Each notebook's notes in the order chosen in View (Sort notes by …), pinned ones first.
  const sorted = useMemo(() => new Map(notes.notebooks.map((nb) => [nb.name, sort === 'edited' && !pinned?.size ? nb.pages : sortPages(nb.pages, sort, pinned)])), [notes.notebooks, sort, pinned]);
  const pagesOf = (nb: { name: string; pages: NotePage[] }) => sorted.get(nb.name) ?? nb.pages;
  const tagged = useMemo(() => (tag ? allPages.filter((pg) => hasTag(pg.tags, tag)).sort((a, b) => b.modified - a.modified) : []), [tag, allPages]);
  // "Edited 5 min ago" counts on, so the rows are read again each minute.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(t); }, []);
  useEffect(() => setNow(Date.now()), [notes.notebooks]);
  // The Trash starts folded, and stays as the person left it while it empties and fills again.
  const [trashOpen, setTrashOpen] = useState(false);
  const [closedSections, setClosedSections] = useState<Set<string>>(new Set());
  const toggleSection = (name: string) => setClosedSections((s) => { const n = new Set(s); if (n.has(name)) n.delete(name); else n.add(name); return n; });
  const [hits, setHits] = useState<NoteHit[] | null>(null);
  const [naming, setNaming] = useState(false);
  // The menus' New notebook opens the same naming field.
  useEffect(() => onCommand(words === NOTES_WORDS ? 'new-notebook' : 'new-folder', () => setNaming(true)), [words]);
  const [name, setName] = useState('');
  const [confirming, setConfirming] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; page: NotePage } | null>(null);
  // A notebook's own menu (Rename, Move to Trash), the notebook being renamed, and one thing in the Trash's menu.
  const [bookMenu, setBookMenu] = useState<{ x: number; y: number; name: string } | null>(null);
  const [renaming, setRenaming] = useState<{ from: string; to: string } | null>(null);
  const [trashMenu, setTrashMenu] = useState<{ x: number; y: number; item: DeletedNote } | null>(null);
  const [emptying, setEmptying] = useState(false);
  const atFocus = () => { const r = (document.activeElement as HTMLElement | null)?.getBoundingClientRect(); return { x: r ? r.left + 24 : 80, y: r ? r.bottom : 80 }; };
  const rename = async (event: FormEvent) => {
    event.preventDefault();
    if (!renaming || !notes.renameNotebook) return;
    const to = renaming.to.trim();
    if (!to || to === renaming.from || (await notes.renameNotebook(renaming.from, to))) setRenaming(null);
  };
  const bookActions = notes.renameNotebook !== undefined || notes.trashNotebook !== undefined;
  const openNotebook = notes.page?.path.split('/')[0] ?? notes.notebooks[0]?.name;
  // Long notebooks are drawn in part, and more as the list is scrolled; the open page is always drawn.
  const [rows, setRows] = useState(FIRST_FRAME_ROWS);
  const more = useCallback(() => setRows((n) => n + MORE_ROWS), []);
  // Two frames on: the first shows the page with a screenful of rows, the next fills in the rest of the first hundred.
  useEffect(() => {
    let cancel = afterPaint(() => { cancel = afterPaint(() => setRows((n) => Math.max(n, FIRST_ROWS))); });
    return () => cancel();
  }, []);
  const drawn = (pages: NotePage[]) => {
    const open = notes.page ? pages.findIndex((pg) => pg.path === notes.page?.path) : -1;
    return pages.slice(0, Math.max(rows, open + 1));
  };

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


  /** One page in the list: its title, then when it was edited and how it starts; Pin on hover. `where` names its notebook. */
  const pageRow = (pg: NotePage, where?: string, key = pg.path) => {
    // Listed by when they were made, a row shows that date; otherwise its last edit.
    const made = sort === 'created';
    const date = made ? createdOf(pg) : pg.modified;
    const when = relativeTime(date, Math.max(now, date));
    // The title with its date at the end (as Mail dates a message: "9:02" today, "Tue", "3 Nov"). Notes adds one grey
    // line of how it starts, so every note is one height; other apps (Design, Canvas, Research) are one line unless
    // there is a notebook or a start to show.
    const notesRow = words === NOTES_WORDS;
    const second = [where, pg.preview].filter(Boolean).join(' · ');
    return (
      <SidebarRow key={key} label={pg.title} sub={notesRow ? (second || '\u00a0') : second || undefined}
        title={when ? `${made ? 'Created' : 'Edited'} ${when}` : undefined}
        tipAt={notesRow && date > 0 ? 'end' : undefined}
        current={notes.page?.path === pg.path} proposed={changed?.has(pg.path) === true}
        onSelect={() => void notes.open(pg.path, pg.title)}
        onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, page: pg }); }}
        trail={<>
          {date > 0 && <span className="note-side-when" aria-hidden="true">{listDate(date, now)}</span>}
          {onPin && <button type="button" className="note-delete note-pin" aria-pressed={pinned?.has(pg.path) ?? false} aria-label={pinned?.has(pg.path) ? `Unpin ${pg.title}` : `Pin ${pg.title}`} title={pinned?.has(pg.path) ? 'Unpin' : 'Pin'} onClick={() => onPin(pg.path, pg.title)}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 3h6M8 3v6l-3 4h10l-3-4V3M10 13v4" /></svg>
          </button>}
          {/* Delete is in the row's menu, not on hover; choosing it asks once more, here in the row. It goes away when
              focus moves to something else, not when the closing menu leaves focus nowhere. */}
          {confirming === pg.path && (
            <button type="button" autoFocus className="note-delete confirm" aria-label={`Confirm delete ${pg.title}`} onClick={() => { setConfirming(null); void notes.remove(pg.path); }} onBlur={(e) => { const to = e.relatedTarget as Node | null; if (to && !e.currentTarget.parentElement?.contains(to)) setConfirming(null); }} onKeyDown={(e) => { if (e.key === 'Escape') setConfirming(null); }}>Delete</button>
          )}
        </>} />
    );
  };
  /** A folding section of the list (Pinned, Tags, a notebook); folded ones stay folded while the app is open. */
  const fold = (name: string) => ({ foldable: true, open: !closedSections.has(name), onToggle: () => toggleSection(name) });
  // The button that attaches or floats the list sits beside the first section's name, as in every app.
  const first = pinnedPages.length > 0 ? 'Pinned' : notes.notebooks[0]?.name;
  const lead = (name: string) => (name === first ? pin : null);

  return (
    <AppSidebar label={LIST_NAME[words.app] ?? words.groups} className="notes-side" data-app={words === NOTES_WORDS ? 'notes' : undefined}>
      {/* New first, then Search, then the places: one order in every app. New goes in the folder that is open (or the first). */}
      {(openNotebook || words.defaultGroup) && (
        <SideNew item={words.item} onNew={newItem} title={openNotebook ? `New ${words.item} in ${openNotebook}` : `New ${words.item}`} {...(starts ? { starts } : {})} {...(onStart ? { onStart } : {})} />
      )}
      <SidebarSearch label={`Search ${words.app.toLowerCase()}`} value={query} onChange={setQuery} />
      {naming && (
        <form className="notes-name" onSubmit={(e) => void submit(e)}>
          <input autoFocus aria-label={`${cap(words.group)} name`} placeholder={`${cap(words.group)} name`} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setNaming(false); }} />
          <button type="submit" className="btn primary">Create</button>
        </form>
      )}
      {tag !== null && hits === null ? (
        <SidebarSection title={`#${tag}`} action={
          <button type="button" className="strip-btn notes-tag-clear" aria-label={`Show every ${words.item}`} title={`Show every ${words.item}`} onClick={() => setTag(null)}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 6l8 8M14 6l-8 8" /></svg>
          </button>
        }>
          {tagged.length === 0 && <li className="side-empty">No {words.items} have this tag now.</li>}
          {tagged.map((pg) => pageRow(pg, pg.notebook, `tag:${pg.path}`))}
        </SidebarSection>
      ) : hits !== null ? (
        <SidebarSection title="Results">
          {hits.length === 0 && <li className="side-empty">No {words.items} match.</li>}
          {hits.map((hit) => (
            <SidebarRow key={hit.path} label={hit.title} sub={`${hit.notebook}${hit.line ? ` — ${hit.line}` : ''}`} current={notes.page?.path === hit.path} onSelect={() => void notes.open(hit.path, hit.title)} />
          ))}
        </SidebarSection>
      ) : (
        <>
          {!notes.loaded && notes.available && (
            <ul className="notes-loading" aria-label={`Reading ${words.items}`}><li /><li /><li /></ul>
          )}
          {(notes.loaded || !notes.available) && notes.notebooks.length === 0 && !naming && (
            <div className="side-empty notes-empty">
              <p>No {words.items} yet.</p>
            </div>
          )}
          {pinnedPages.length > 0 && (
            <SidebarSection title="Pinned" action={lead('Pinned')} {...fold('Pinned')}>
              {pinnedPages.map((pg) => pageRow(pg, pg.notebook, `pin:${pg.path}`))}
            </SidebarSection>
          )}
          {notes.notebooks.map((nb) => (
            <SidebarSection key={nb.name} title={nb.name} {...fold(`notebook:${nb.name}`)} action={<>
              {synced?.(nb.name)}
              {lead(nb.name)}
              {bookActions && (
                <button type="button" className="strip-btn" aria-label={`${cap(words.group)} options for ${nb.name}`} title={`${cap(words.group)} options`} aria-haspopup="menu" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setBookMenu({ x: r.left, y: r.bottom, name: nb.name }); }}>
                  <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 10h.01M10 10h.01M15 10h.01" /></svg>
                </button>
              )}
              <button type="button" className="strip-btn" aria-label={`New ${words.item} in ${nb.name}`} title={`New ${words.item}`} onClick={() => void notes.createPage(nb.name)}>
                <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 5v10M5 10h10" /></svg>
              </button>
            </>}>
              {renaming?.from === nb.name && (
                <li className="notes-rename">
                  <form className="notes-name" onSubmit={(e) => void rename(e)}>
                    <input autoFocus aria-label={`New name for ${nb.name}`} value={renaming.to} maxLength={80} onFocus={(e) => e.currentTarget.select()} onChange={(e) => setRenaming({ from: nb.name, to: e.target.value })} onKeyDown={(e) => { if (e.key === 'Escape') setRenaming(null); }} />
                    <button type="submit" className="btn">Rename</button>
                  </form>
                </li>
              )}
              {nb.pages.length === 0 && <li className="side-empty">No {words.items} yet.</li>}
              {drawn(pagesOf(nb)).map((pg) => pageRow(pg))}
              {rows >= FIRST_ROWS && nb.pages.length > drawn(pagesOf(nb)).length && <MoreRows onMore={more} />}
            </SidebarSection>
          ))}
          {/* Design, Canvas and Research: New folder waits until there is something to put in one. Notes keeps New
              notebook, where making a notebook first is a common start. */}
          {!naming && (words === NOTES_WORDS || notes.notebooks.some((nb) => nb.pages.length > 0)) && (
            // An action, not a folder: muted, with + in the leading slot, so it never reads as a folder called New folder.
            <button type="button" className="side-new-row notes-new-group" title={`New ${words.group}`} onClick={() => setNaming(true)}>
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4.5v11M4.5 10h11" /></svg>
              <span>New {words.group}</span>
            </button>
          )}
          {tagList.length > 0 && (
            <SidebarSection title="Tags" {...fold('Tags')}>
              {tagList.map((t) => (
                <SidebarRow key={t.tag} label={`#${t.tag}`} count={t.count} title={t.count === 1 ? `1 ${words.item}` : `${t.count} ${words.items}`} onSelect={() => { setQuery(''); setTag(t.tag); }} />
              ))}
            </SidebarSection>
          )}
          {notes.trashed.length > 0 && (
            <SidebarSection title="Trash" foldable open={trashOpen} onToggle={setTrashOpen} action={emptying ? (
              <button type="button" autoFocus className="note-delete confirm" aria-label="Confirm empty Trash" onClick={() => { setEmptying(false); void notes.forget(null); }} onBlur={() => setEmptying(false)} onKeyDown={(e) => { if (e.key === 'Escape') setEmptying(false); }}>Empty</button>
            ) : (
              <button type="button" className="strip-btn" aria-label="Empty Trash" title="Empty Trash" onClick={() => setEmptying(true)}>
                <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4.5 6h11M8 6V4.5h4V6M6 6l.8 10h6.4L14 6" /></svg>
              </button>
            )}>
              {notes.trashed.map((item) => (
                <SidebarRow key={item.id} label={item.title}
                  sub={`${item.kind === 'notebook' ? `${cap(words.group)}, ${item.pages === 1 ? `1 ${words.item}` : `${item.pages ?? 0} ${words.items}`}` : `From ${item.from.split('/')[0]}`} · ${trashLeft(item.deletedMs, now)}`}
                  onSelect={() => setTrashMenu({ ...atFocus(), item })}
                  onContextMenu={(e) => { e.preventDefault(); setTrashMenu({ x: e.clientX, y: e.clientY, item }); }} />
              ))}
            </SidebarSection>
          )}
          <FromMobius items={notes.notebooks.flatMap((nb) => nb.pages.filter((pg) => changed?.has(pg.path)).map((pg) => ({ key: pg.path, name: pg.title, where: nb.name, current: notes.page?.path === pg.path, onOpen: () => void notes.open(pg.path, pg.title) })))} />
        </>
      )}
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} label={menu.page.title} onClose={() => setMenu(null)} items={([
          { action: 'open', run: () => void notes.open(menu.page.path, menu.page.title) },
          ...(onPin ? [{ action: pinned?.has(menu.page.path) ? 'unpin' : 'pin', run: () => onPin(menu.page.path, menu.page.title) }] : []),
          ...(notes.move ? notes.notebooks.filter((nb) => nb.name !== menu.page.path.split('/')[0]).map((nb, i) => ({ action: 'move', label: `Move to ${nb.name}`, separated: i === 0, run: () => void notes.move?.(menu.page.path, nb.name) })) : []),
          notes.trash
            ? { action: 'delete', label: 'Move to Trash', danger: true, run: () => void notes.trash?.(menu.page.path) }
            : { action: 'delete', label: `Delete ${words.item}…`, danger: true, run: () => setConfirming(menu.page.path) },
        ] as ContextMenuItem[])} />
      )}
      {bookMenu && (
        <ContextMenu x={bookMenu.x} y={bookMenu.y} label={bookMenu.name} onClose={() => setBookMenu(null)} items={([
          ...(notes.renameNotebook ? [{ action: 'rename', label: 'Rename', run: () => setRenaming({ from: bookMenu.name, to: bookMenu.name }) }] : []),
          ...(notes.trashNotebook ? [{ action: 'delete', label: 'Move to Trash', danger: true, run: () => void notes.trashNotebook?.(bookMenu.name) }] : []),
        ] as ContextMenuItem[])} />
      )}
      {trashMenu && (
        <ContextMenu x={trashMenu.x} y={trashMenu.y} label={trashMenu.item.title} onClose={() => setTrashMenu(null)} items={([
          { action: 'undo', label: 'Put back', run: () => void notes.restore(trashMenu.item.id) },
          { action: 'delete', label: 'Delete forever', danger: true, run: () => void notes.forget(trashMenu.item.id) },
        ] as ContextMenuItem[])} />
      )}
    </AppSidebar>
  );
}
