import { Reorder, motion } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Activity } from './activity';
import type { AppId } from './apps';
import type { Favourite } from '@mobius/shared';

/** One icon per app, shared by the rail and the app hub. */
export const APP_ICONS: Record<string, ReactNode> = {
  agent: <><path d="M10 3.5l1.4 3.6 3.6 1.4-3.6 1.4L10 13.5 8.6 9.9 5 8.5l3.6-1.4z" /><path d="M15 12.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z" /></>,
  search: <><circle cx="9" cy="9" r="5" /><path d="m13 13 3.5 3.5" /></>,
  browser: <><circle cx="10" cy="10" r="7" /><path d="m12.8 7.2-1.6 4-4 1.6 1.6-4z" /></>,
  notes: <><path d="M5.5 3h6l3 3v11h-9z" /><path d="M11.5 3v3h3M7.5 10h5M7.5 13h4" /></>,
  tasks: <><rect x="3.5" y="4" width="5" height="5" rx="1" /><path d="m4.8 6.5 1 1 1.6-2M11 6.5h5.5M11 13.5h5.5" /><rect x="3.5" y="11" width="5" height="5" rx="1" /></>,
  code: <><path d="m7 6-4 4 4 4M13 6l4 4-4 4M11 4.5l-2 11" /></>,
  documents: <><path d="M5.5 3h6l3 3v11h-9z" /><path d="M11.5 3v3h3M7.5 9.5h5M7.5 12h5M7.5 14.5h3" /></>,
  canvas: <><rect x="3.5" y="3.5" width="13" height="13" rx="2" /><path d="M6.5 13 9 9.5l2 2.5 1.5-1.8L14 13" /><circle cx="7.5" cy="7.5" r="1" /></>,
  review: <><path d="M4 10a6 6 0 1 0 12 0 6 6 0 0 0-12 0" /><path d="m7.5 10 1.8 1.8 3.4-3.6" /></>,
};

/** The apps, always one click away, in the order people reach for them. */
export const RAIL_APPS: { id: AppId; name: string }[] = [
  { id: 'agent', name: 'Agent' },
  { id: 'search', name: 'Search' },
  { id: 'browser', name: 'Browser' },
  { id: 'notes', name: 'Notes' },
  { id: 'tasks', name: 'Tasks' },
];

interface Props {
  /** The open profile's name, when it is not Personal. */
  profile?: string;
  onProfiles?: () => void;
  app: AppId;
  /** The full sidebar: apps by name, the open app's own list under them. Otherwise a narrow rail of icons. */
  expanded: boolean;
  onToggle: () => void;
  /** The New button: what is worth starting in the app you are in. */
  create: { label: string; run: () => void };
  /** Small numbers beside an app's name in the full sidebar (open tabs, tasks due today). */
  counts: Partial<Record<AppId, number>>;
  children?: ReactNode;
  onOpen: (id: AppId) => void;
  /** What the agent is doing now: the app it is working in shows it, live. */
  activity: Activity | null;
  /** Apps the agent changed while you were somewhere else. */
  changed: ReadonlySet<AppId>;
  needsYou: number;
  onLauncher: () => void;
  onSettings: () => void;
  settingsOpen: boolean;
  /** The apps to list, in order (the person's choice). */
  apps?: readonly AppId[];
  /** Change which apps are listed and their order. */
  onApps?: (apps: AppId[]) => void;
  /** Open the settings where the list is chosen. */
  onEditApps?: () => void;
  /** Notes and task lists pinned under the apps, in the full sidebar. */
  favourites?: readonly Favourite[];
  onOpenFavourite?: (favourite: Favourite) => void;
  onUnpin?: (favourite: Favourite) => void;
  /** Pinned items in a new order, after a drag or Alt+Up/Down. */
  onReorderFavourites?: (next: Favourite[]) => void;
  /** The pinned item showing now, as `kind:id`. */
  currentFavourite?: string | null;
}

/**
 * The app rail: one column that ties the apps together. The highlight slides to the app you are in, the app the agent
 * is working in glows while it works, and an app it changed while you were elsewhere carries a dot until you look.
 */
export function Rail({ app, expanded, onToggle, create, counts, children, onOpen, activity, changed, needsYou, onLauncher, onSettings, settingsOpen, apps, onApps, onEditApps, favourites = [], onOpenFavourite, onUnpin, onReorderFavourites, currentFavourite, profile, onProfiles }: Props) {
  // While an app is dragged the order lives here; it is saved once, when it is let go.
  const [dragOrder, setDragOrder] = useState<AppId[] | null>(null);
  const dragged = useRef(false);
  const latestDrag = useRef<AppId[] | null>(null);
  latestDrag.current = dragOrder;
  const chosen = dragOrder ?? apps;
  // Pinned items being dragged: shown in their new order, saved when the drag ends.
  const [pinDrag, setPinDrag] = useState<Favourite[] | null>(null);
  const pinDragged = useRef(false);
  const latestPinDrag = useRef<Favourite[] | null>(null);
  latestPinDrag.current = pinDrag;
  const pinOrder: Favourite[] = pinDrag ?? [...favourites];
  const listed = chosen ? RAIL_APPS.filter((a) => chosen.includes(a.id)).sort((a, b) => chosen.indexOf(a.id) - chosen.indexOf(b.id)) : RAIL_APPS;
  const order = listed.map((a) => a.id);
  // Right-click an app (or Shift+F10) to move or hide it: HIG asks that people can shape the sidebar.
  const [menu, setMenu] = useState<{ id: AppId; x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return undefined;
    menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const away = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenu(null); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenu(null); };
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('pointerdown', away, true); window.removeEventListener('keydown', key); };
  }, [menu]);
  const move = (id: AppId, by: -1 | 1) => {
    const at = order.indexOf(id);
    const to = at + by;
    if (to < 0 || to >= order.length) return;
    const next = [...order];
    [next[at], next[to]] = [next[to]!, next[at]!];
    onApps?.(next);
  };
  return (
    <nav className="rail" aria-label="Apps" data-expanded={expanded || undefined}>
      <div className="rail-top">
        <button type="button" className="rail-btn rail-toggle" aria-label={expanded ? 'Collapse sidebar' : 'Expand sidebar'} aria-expanded={expanded} title={expanded ? 'Collapse sidebar' : 'Expand sidebar'} onClick={onToggle}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="4" width="14" height="12" rx="2" /><path d="M8 4v12" /></svg>
        </button>
        <button type="button" className="rail-btn rail-create" aria-label="Create" title={create.label} onClick={create.run}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4.5v11M4.5 10h11" /></svg>
          {expanded && <span className="rail-label" aria-hidden="true">{create.label}</span>}
        </button>
      </div>
      <Reorder.Group as="ul" axis="y" role="list" className="rail-apps" values={order} onReorder={(next: AppId[]) => { if (onApps) setDragOrder(next); }}>
        {listed.map(({ id, name }) => {
          const here = app === id && !settingsOpen;
          const working = activity !== null && (activity.app === id || (id === 'agent' && activity.app === null && app !== 'agent'));
          const waiting = id === 'agent' ? needsYou : 0;
          return (
            <Reorder.Item as="li" key={id} value={id} drag={onApps ? 'y' : false} dragListener={Boolean(onApps)}
              onDragStart={() => { dragged.current = true; }}
              onDragEnd={() => { const next = latestDrag.current; if (next) onApps?.(next); setDragOrder(null); window.setTimeout(() => { dragged.current = false; }, 0); }}>
              <button
                type="button"
                className="rail-btn"
                aria-label={name}
                aria-current={here ? 'page' : undefined}
                data-working={working || undefined}
                data-changed={(changed.has(id) && !here) || undefined}
                title={name}
                onClick={() => { if (!dragged.current) onOpen(id); }}
                onKeyDown={onApps ? (event) => {
                  // Alt+Up and Alt+Down move the focused app; focus stays with it.
                  if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
                  event.preventDefault();
                  move(id, event.key === 'ArrowUp' ? -1 : 1);
                  const button = event.currentTarget;
                  requestAnimationFrame(() => button.focus());
                } : undefined}
                aria-keyshortcuts={onApps ? 'Alt+ArrowUp Alt+ArrowDown' : undefined}
                onContextMenu={onApps ? (event) => { event.preventDefault(); const r = event.currentTarget.getBoundingClientRect(); setMenu({ id, x: event.clientX || r.right, y: event.clientY || r.top }); } : undefined}
              >
                {here && <motion.span className="rail-here" layoutId="rail-here" transition={{ type: 'spring', stiffness: 520, damping: 40 }} />}
                <svg viewBox="0 0 20 20" aria-hidden="true" data-app={id}>{APP_ICONS[id]}</svg>
                {expanded && <span className="rail-label" aria-hidden="true">{name}</span>}
                {waiting > 0 && <span className="rail-badge" role="status" aria-label={`${waiting} waiting for you`}>{waiting}</span>}
                {expanded && waiting === 0 && (counts[id] ?? 0) > 0 && <span className="rail-count" aria-hidden="true">{counts[id]}</span>}
              </button>
            </Reorder.Item>
          );
        })}
      </Reorder.Group>
      {menu && (
        <div ref={menuRef} className="rail-menu" role="menu" aria-label={`${RAIL_APPS.find((a) => a.id === menu.id)?.name ?? ''} in the sidebar`} style={{ left: menu.x, top: menu.y }}>
          <button type="button" role="menuitem" className="popmenu-item" disabled={order.indexOf(menu.id) === 0} onClick={() => { move(menu.id, -1); setMenu(null); }}>Move up</button>
          <button type="button" role="menuitem" className="popmenu-item" disabled={order.indexOf(menu.id) === order.length - 1} onClick={() => { move(menu.id, 1); setMenu(null); }}>Move down</button>
          <button type="button" role="menuitem" className="popmenu-item" disabled={order.length === 1} onClick={() => { onApps?.(order.filter((id) => id !== menu.id)); setMenu(null); }}>Hide from sidebar</button>
          {onEditApps && <button type="button" role="menuitem" className="popmenu-item" onClick={() => { setMenu(null); onEditApps(); }}>Edit sidebar…</button>}
        </div>
      )}
      {expanded && favourites.length > 0 && (
        <section className="rail-pinned" aria-label="Pinned">
          <h2 className="rail-pinned-title">Pinned</h2>
          <Reorder.Group as="ul" axis="y" role="list" values={pinOrder} onReorder={(next: Favourite[]) => { if (onReorderFavourites) setPinDrag(next); }}>
            {pinOrder.map((fav, at) => {
              const app = fav.kind === 'note' ? 'notes' : fav.kind === 'list' ? 'tasks' : 'browser';
              return (
                <Reorder.Item as="li" key={`${fav.kind}:${fav.id}`} value={fav} className="rail-pin" drag={onReorderFavourites ? 'y' : false} dragListener={Boolean(onReorderFavourites)}
                  onDragStart={() => { pinDragged.current = true; }}
                  onDragEnd={() => { const next = latestPinDrag.current; if (next) onReorderFavourites?.(next); setPinDrag(null); window.setTimeout(() => { pinDragged.current = false; }, 0); }}>
                  <button type="button" className="rail-pin-open" aria-current={currentFavourite === `${fav.kind}:${fav.id}` ? 'page' : undefined} title={fav.kind === 'page' ? `${fav.title}\n${fav.id}` : fav.title}
                    aria-keyshortcuts={onReorderFavourites ? 'Alt+ArrowUp Alt+ArrowDown' : undefined}
                    onClick={() => { if (!pinDragged.current) onOpenFavourite?.(fav); }}
                    onKeyDown={onReorderFavourites ? (event) => {
                      if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
                      event.preventDefault();
                      const to = at + (event.key === 'ArrowUp' ? -1 : 1);
                      if (to < 0 || to >= favourites.length) return;
                      const next = [...favourites];
                      next.splice(to, 0, next.splice(at, 1)[0]!);
                      onReorderFavourites(next);
                      const button = event.currentTarget;
                      requestAnimationFrame(() => button.focus());
                    } : undefined}>
                    <svg viewBox="0 0 20 20" aria-hidden="true" data-app={app}>{APP_ICONS[app]}</svg>
                    <span className="rail-pin-name">{fav.title}</span>
                  </button>
                  {onUnpin && <button type="button" className="rail-pin-remove" aria-label={`Unpin ${fav.title}`} title="Unpin" onClick={() => onUnpin(fav)}>
                    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 6 8 8M14 6l-8 8" /></svg>
                  </button>}
                </Reorder.Item>
              );
            })}
          </Reorder.Group>
        </section>
      )}
      {expanded && children && <div className="rail-app">{children}</div>}
      <div className="rail-end">
        {profile && onProfiles && (
          <button type="button" className="rail-btn rail-profile" aria-label={`Profile: ${profile}. Change profile`} title={`Profile: ${profile}`} onClick={onProfiles}>
            <span className="rail-profile-badge" aria-hidden="true">{profile.slice(0, 1).toUpperCase()}</span>
            {expanded && <span className="rail-label" aria-hidden="true">{profile}</span>}
          </button>
        )}
        <button type="button" className="rail-btn" data-app-library aria-haspopup="dialog" aria-label={`Applications. Current: ${RAIL_APPS.find((a) => a.id === app)?.name ?? app}`} title="All apps and commands (Ctrl+K)" onClick={onLauncher}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="6" cy="6" r="1.4" /><circle cx="14" cy="6" r="1.4" /><circle cx="6" cy="14" r="1.4" /><circle cx="14" cy="14" r="1.4" /></svg>
          {expanded && <span className="rail-label" aria-hidden="true">All apps</span>}
        </button>
        <button type="button" className="rail-btn" aria-label="Settings" aria-current={settingsOpen ? 'page' : undefined} title="Settings (Ctrl+,)" onClick={onSettings}>
          {settingsOpen && <motion.span className="rail-here" layoutId="rail-here" transition={{ type: 'spring', stiffness: 520, damping: 40 }} />}
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 6h8M15 6h1M4 14h1M8 14h8" /><circle cx="13.5" cy="6" r="1.8" /><circle cx="6.5" cy="14" r="1.8" /></svg>
          {expanded && <span className="rail-label" aria-hidden="true">Settings</span>}
        </button>
      </div>
    </nav>
  );
}
