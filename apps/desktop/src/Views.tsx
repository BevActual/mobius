import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';
import { EmptyState } from './EmptyState';
import { NotesSidebar, newItemIn, type SidebarWords } from './NotesSidebar';
import { ReviewActions, WhyThis } from './ReviewBar';
import { APP_ICONS } from './Rail';
import type { NotesState } from './useNotes';
import { useFileReview } from './useFileReview';
import { tileContent, tileSummary, type TileTarget, type ViewSources } from './views-data';
import {
  CALENDAR_SHOW, TASKS_SHOW, TILE_KINDS, addTile, changeTile, changedTiles, moveTile, parseView, removeTile, removedTiles, starterView, tileKind,
  tileTitle, writeView, type Tile, type TileKind, type View,
} from './views-format';
import './views.css';

export const VIEWS_WORDS: SidebarWords = { app: 'Views', group: 'folder', groups: 'Folders', item: 'view', items: 'views', about: 'Views are dashboards of live tiles from your other apps, kept as JSON files in your workspace, so Mobius can make and change them too.', defaultGroup: 'Views' };

export function ViewsSidebar(props: { views: NotesState; pin: ReactNode; changed?: ReadonlySet<string>; starts?: readonly import('./SideNew').Start[]; onStart?: (prompt: string) => void }) {
  const { views, ...rest } = props;
  return <NotesSidebar notes={views} words={VIEWS_WORDS} {...rest} />;
}

/** A new view in the open view's folder, or the first, or a folder made for it. */
export const newView = (views: NotesState) => newItemIn(views, views.page?.path.split('/')[0], VIEWS_WORDS.defaultGroup);

/** What the change bar says about Mobius's change to a view. */
export function viewReviewText(changed: number, removed: number): string {
  const n = (k: number) => (k === 1 ? 'one tile' : `${k} tiles`);
  if (!removed) return `Mobius changed ${n(changed)} here, dashed.`;
  if (!changed) return `Mobius took away ${n(removed)} here.`;
  return `Mobius changed ${n(changed)} here, dashed, and took away ${removed === 1 ? 'one' : removed}.`;
}

const AppIcon = ({ app }: { app: string }) => (
  <svg viewBox="0 0 20 20" aria-hidden="true" className="view-tile-icon" style={{ background: `var(--app-${app})` }}>{APP_ICONS[app]}</svg>
);

/** Mobius's schedules, for the Next tile, kept current. */
function useSchedules(): ViewSources['schedules'] {
  const [list, setList] = useState<ViewSources['schedules']>([]);
  useEffect(() => {
    const api = window.mobius.schedules;
    if (!api) return undefined;
    let live = true;
    const load = () => void api.list().then((l) => { if (live) setList(l); }).catch(() => undefined);
    load();
    const off = api.onChange(load);
    return () => { live = false; off(); };
  }, []);
  return list;
}

interface Props {
  views: NotesState;
  /** The other apps' state, as the window has it; the schedules are read here. */
  apps: Omit<ViewSources, 'schedules'>;
  review?: { conversation: string } | null;
  onOpen: (target: TileTarget) => void;
  now?: Date;
}

/** One view: its tiles in a grid, each live from its app. Edit rearranges them; Mobius's changes come dashed. */
export function ViewPage({ views, apps, review, onOpen, now: fixedNow }: Props) {
  const schedules = useSchedules();
  const sources: ViewSources = { ...apps, schedules };
  const parsed = useMemo(() => (views.page ? parseView(views.text) : null), [views.page, views.text]);
  const view = parsed && 'view' in parsed ? parsed.view : null;
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; tile: Tile } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [removed, setRemoved] = useState<{ tile: Tile; at: number; path: string } | null>(null);
  const [tick, setTick] = useState(0);
  const addButton = useRef<HTMLButtonElement>(null);
  // The tiles say "today" and "left today": they read the clock again each minute.
  useEffect(() => { const id = window.setInterval(() => setTick((n) => n + 1), 60_000); return () => window.clearInterval(id); }, []);
  const now = useMemo(() => fixedNow ?? new Date(), [fixedNow, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setEditing(false); setAdding(false); setRemoved(null); }, [views.page?.path]);

  const file = views.page ? `views/${views.page.path}` : null;
  const { before, keep, discard } = useFileReview(review, file, views.page?.base);
  const beforeView = useMemo(() => {
    if (before === undefined) return undefined;
    if (before === null) return null;
    const p = parseView(before);
    return 'view' in p ? p.view : undefined;
  }, [before]);
  const proposed = useMemo(() => (view && beforeView !== undefined ? changedTiles(beforeView, view) : new Set<string>()), [view, beforeView]);
  const gone = useMemo(() => (view && beforeView !== undefined ? removedTiles(beforeView, view) : []), [view, beforeView]);

  if (!views.page) {
    const none = views.notebooks.every((nb) => nb.pages.length === 0);
    return (
      <section className="views-page" aria-label="Views">
        <EmptyState app="views" title={none ? 'No views yet' : 'No view open'} line={none ? 'A view is a dashboard of live tiles from your apps: tasks, calendar, mail, notes and what Mobius is doing.' : 'Choose a view on the left, or make a new one.'} action={{ label: 'New view', run: () => newView(views) }} />
      </section>
    );
  }
  if (!view) {
    return (
      <section className="views-page" aria-label={views.page.title}>
        <EmptyState app="views" title="This view can’t be shown" line={parsed && 'error' in parsed ? parsed.error : undefined} />
      </section>
    );
  }

  const save = (next: View) => views.edit(writeView(next));
  const add = (kind: TileKind) => { save(addTile(view, kind)); setAdding(false); };
  const remove = (tile: Tile) => { save(removeTile(view, tile.id)); setRemoved({ tile, at: view.tiles.findIndex((t) => t.id === tile.id), path: views.page!.path }); };
  const undoRemove = () => {
    if (!removed || removed.path !== views.page?.path || view.tiles.some((t) => t.id === removed.tile.id)) { setRemoved(null); return; }
    const tiles = [...view.tiles];
    tiles.splice(Math.min(removed.at, tiles.length), 0, removed.tile);
    save({ ...view, tiles });
    setRemoved(null);
  };
  const move = (tile: Tile, by: number) => save(moveTile(view, tile.id, view.tiles.findIndex((t) => t.id === tile.id) + by));

  const menuItems = (tile: Tile): ContextMenuItem[] => {
    const at = view.tiles.findIndex((t) => t.id === tile.id);
    const items: ContextMenuItem[] = [
      { action: 'open', label: `Open in ${tileKind(tile.kind).name === 'Next' ? 'Settings' : tileKind(tile.kind).name}`, run: () => onOpen(tileContent(tile, sources, now).target) },
      { label: tile.size === 'wide' ? 'Make small' : 'Make wide', run: () => save(changeTile(view, tile.id, { size: tile.size === 'wide' ? 'small' : 'wide' })), separated: true },
    ];
    if (tile.kind === 'tasks') for (const s of TASKS_SHOW) items.push({ label: `Show ${s.name}`, disabled: (tile.show ?? 'today') === s.id, run: () => save(changeTile(view, tile.id, { show: s.id })) });
    if (tile.kind === 'calendar') for (const s of CALENDAR_SHOW) items.push({ label: `Show ${s.name}`, disabled: (tile.show ?? 'today') === s.id, run: () => save(changeTile(view, tile.id, { show: s.id })) });
    items.push(
      { label: 'Move earlier', keys: 'Alt+←', disabled: at <= 0, run: () => move(tile, -1), separated: true },
      { label: 'Move later', keys: 'Alt+→', disabled: at >= view.tiles.length - 1, run: () => move(tile, 1) },
      { action: 'delete', label: 'Remove tile', danger: true, run: () => remove(tile) },
    );
    return items;
  };

  const anyChange = proposed.size > 0 || gone.length > 0;
  return (
    <section className="views-page" aria-label={views.page.title} data-editing={editing || undefined}>
      <div className="views-bar" role="toolbar" aria-label="View">
        <span className="views-bar-gap" />
        <div className="views-add">
          <button ref={addButton} type="button" className="btn" aria-haspopup="menu" aria-expanded={adding} onClick={() => setAdding((a) => !a)}>Add tile</button>
          {adding && (
            <ContextMenu
              x={Math.max(8, (addButton.current?.getBoundingClientRect().right ?? 0) - 200)}
              y={(addButton.current?.getBoundingClientRect().bottom ?? 0) + 4}
              label="Add tile"
              items={TILE_KINDS.map((k) => ({ label: k.name === 'Next' ? 'Next on a schedule' : k.name, run: () => add(k.kind) }))}
              onClose={() => setAdding(false)}
            />
          )}
        </div>
        {view.tiles.length > 0 && <button type="button" className={editing ? 'btn primary' : 'btn'} aria-pressed={editing} onClick={() => setEditing((e) => !e)}>{editing ? 'Done' : 'Edit'}</button>}
      </div>
      {views.message && <p className="views-message" role="alert">{views.message}</p>}
      <div className="views-scroll">
      {view.tiles.length === 0 ? (
        <div className="views-empty">
          <EmptyState app="views" title="This view is empty" line="Add tiles from your apps, or start with the usual ones." action={{ label: 'Add the usual tiles', run: () => save(starterView()) }} />
        </div>
      ) : (
        <ul className="views-grid" role="list" aria-label="Tiles">
          {view.tiles.map((tile, index) => {
            const content = tileContent(tile, sources, now);
            const title = tileTitle(tile);
            return (
              <li
                key={tile.id}
                className="view-tile"
                data-size={tile.size}
                data-kind={tile.kind}
                data-proposed={proposed.has(tile.id) || undefined}
                data-dragging={dragging === tile.id || undefined}
                aria-label={tileSummary(title, content)}
                draggable={editing}
                onDragStart={(e) => { setDragging(tile.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', tile.id); }}
                onDragEnd={() => setDragging(null)}
                onDragOver={(e) => { if (dragging && dragging !== tile.id) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } }}
                onDrop={(e) => { e.preventDefault(); if (dragging && dragging !== tile.id) save(moveTile(view, dragging, index)); setDragging(null); }}
                onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, tile }); }}
                onKeyDown={(e) => {
                  if (!e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
                  e.preventDefault();
                  move(tile, e.key === 'ArrowLeft' ? -1 : 1);
                }}
              >
                <header className="view-tile-head">
                  <button type="button" className="view-tile-name" onClick={() => onOpen(content.target)} title={`Open ${tileKind(tile.kind).name === 'Next' ? 'Settings › Schedules' : tileKind(tile.kind).name}`}>
                    <AppIcon app={content.app} />
                    <span>{title}</span>
                  </button>
                  {editing ? (
                    <button type="button" className="view-tile-remove" aria-label={`Remove ${title}`} onClick={() => remove(tile)}>
                      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 10h8" /></svg>
                    </button>
                  ) : (
                    <button type="button" className="view-tile-more" aria-label={`More for ${title}`} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.left, y: r.bottom + 4, tile }); }}>
                      <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="5" cy="10" r="1.3" /><circle cx="10" cy="10" r="1.3" /><circle cx="15" cy="10" r="1.3" /></svg>
                    </button>
                  )}
                </header>
                {content.count && (
                  <p className="view-tile-count"><span className="view-tile-number">{content.count.value}</span> <span>{content.count.label}</span></p>
                )}
                {content.rows.length > 0 ? (
                  <ul className="view-tile-rows" role="list">
                    {content.rows.map((row) => (
                      <li key={row.key}>
                        <button type="button" className="view-tile-row" data-tone={row.tone} disabled={editing} onClick={() => onOpen(row.target)}>
                          <span className="view-tile-text">{row.text}</span>
                          {row.detail && <span className="view-tile-detail">{row.detail}</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : content.empty ? (
                  <p className="view-tile-empty">{content.empty}</p>
                ) : null}
                {content.more > 0 && <button type="button" className="view-tile-all" disabled={editing} onClick={() => onOpen(content.target)}>{content.more} more</button>}
              </li>
            );
          })}
        </ul>
      )}
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} label={tileTitle(menu.tile)} items={menuItems(menu.tile)} onClose={() => setMenu(null)} />}
      {removed && removed.path === views.page.path && (
        <div className="views-undo" role="status">
          <span>Removed {tileTitle(removed.tile)}</span>
          <button type="button" className="btn" onClick={undoRemove}>Undo</button>
          <button type="button" className="views-undo-x" aria-label="Dismiss" onClick={() => setRemoved(null)}>×</button>
        </div>
      )}
      {anyChange && (
        <div className="design-review views-review" role="group" aria-label="Mobius's change">
          <span className="review-dot" aria-hidden="true" />
          <span>{viewReviewText(proposed.size, gone.length)}{review && <WhyThis conversation={review.conversation} />}</span>
          <ReviewActions onKeep={keep} onDiscard={discard} />
        </div>
      )}
    </section>
  );
}
