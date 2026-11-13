import { Reorder, motion } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Activity } from './activity';
import { useSideFolds } from './side-fold';
import { appName, isInstalled, type AppId } from './apps';
import { describeCombo, type Favourite } from '@mobius/shared';
import { PointMenu } from './ui';

/** One icon per app, shared by the rail and the app hub. */
export const APP_ICONS: Record<string, ReactNode> = {
  // The Mobius mark (the trefoil), filled: the one icon that is not a line drawing.
  agent: <><path d="M15.34 10.06 L15.64 10.36 L15.91 10.66 L16.13 10.97 L16.32 11.29 L16.48 11.60 L16.59 11.90 L16.67 12.20 L16.71 12.49 L16.73 12.76 L16.71 13.02 L16.66 13.26 L16.59 13.49 L16.49 13.70 L16.36 13.90 L16.21 14.08 L16.03 14.25 L15.82 14.40 L15.59 14.53 L15.32 14.64 L15.04 14.73 L14.72 14.79 L14.38 14.82 L14.02 14.83 L13.64 14.80 L13.25 14.73 L12.85 14.63 L12.44 14.49 L12.02 14.33 L11.61 14.11 L11.19 13.87 L10.78 13.59 L10.39 13.29 L10.00 12.94 L9.63 12.58 L9.28 12.18 L8.95 11.76 L8.64 11.32 L8.37 10.86 L8.12 10.38 L7.89 10.08 L7.56 9.89 L7.19 9.84 L6.82 9.94 L6.52 10.17 L6.33 10.49 L6.28 10.87 L6.38 11.24 L6.68 11.81 L7.02 12.37 L7.39 12.91 L7.79 13.42 L8.22 13.90 L8.67 14.36 L9.14 14.78 L9.64 15.16 L10.15 15.51 L10.67 15.82 L11.21 16.08 L11.76 16.31 L12.31 16.49 L12.86 16.63 L13.40 16.72 L13.94 16.76 L14.47 16.76 L14.99 16.71 L15.50 16.61 L15.98 16.47 L16.44 16.27 L16.87 16.03 L17.26 15.75 L17.61 15.42 L17.92 15.05 L18.18 14.64 L18.39 14.21 L18.54 13.75 L18.62 13.27 L18.66 12.79 L18.64 12.29 L18.56 11.80 L18.43 11.31 L18.25 10.83 L18.02 10.36 L17.74 9.90 L17.42 9.46 L17.06 9.04 L16.65 8.64 L16.33 8.44 L15.96 8.38 L15.59 8.47 L15.28 8.69 L15.09 9.02 L15.03 9.39 L15.12 9.76 Z" fill="currentColor" stroke="none" /><path d="M7.38 5.36 L7.49 4.96 L7.62 4.57 L7.77 4.22 L7.94 3.89 L8.14 3.61 L8.34 3.35 L8.56 3.13 L8.79 2.95 L9.02 2.80 L9.26 2.69 L9.49 2.60 L9.72 2.55 L9.96 2.53 L10.19 2.54 L10.43 2.58 L10.66 2.65 L10.90 2.76 L11.13 2.89 L11.36 3.06 L11.58 3.27 L11.79 3.51 L11.99 3.79 L12.17 4.10 L12.33 4.44 L12.48 4.82 L12.59 5.22 L12.68 5.64 L12.73 6.09 L12.76 6.56 L12.76 7.04 L12.72 7.53 L12.65 8.03 L12.55 8.53 L12.41 9.04 L12.24 9.54 L12.04 10.04 L11.81 10.53 L11.56 10.99 L11.27 11.45 L11.12 11.80 L11.12 12.18 L11.26 12.52 L11.53 12.79 L11.88 12.94 L12.26 12.94 L12.61 12.80 L12.88 12.53 L13.22 11.98 L13.54 11.41 L13.82 10.82 L14.06 10.21 L14.27 9.60 L14.44 8.98 L14.56 8.36 L14.65 7.74 L14.69 7.12 L14.70 6.51 L14.66 5.91 L14.59 5.32 L14.47 4.76 L14.31 4.21 L14.12 3.69 L13.89 3.20 L13.62 2.74 L13.31 2.31 L12.98 1.93 L12.61 1.58 L12.21 1.28 L11.79 1.03 L11.34 0.84 L10.88 0.69 L10.40 0.61 L9.92 0.59 L9.44 0.64 L8.97 0.74 L8.51 0.89 L8.07 1.11 L7.66 1.38 L7.26 1.69 L6.91 2.06 L6.58 2.46 L6.29 2.89 L6.03 3.36 L5.81 3.87 L5.63 4.39 L5.49 4.95 L5.48 5.32 L5.62 5.68 L5.88 5.95 L6.23 6.10 L6.61 6.11 L6.96 5.98 L7.23 5.71 Z" fill="currentColor" stroke="none" /><path d="M7.29 14.59 L6.88 14.71 L6.48 14.78 L6.10 14.82 L5.73 14.83 L5.39 14.81 L5.06 14.76 L4.76 14.68 L4.49 14.57 L4.25 14.44 L4.03 14.30 L3.84 14.14 L3.69 13.96 L3.55 13.76 L3.44 13.56 L3.36 13.33 L3.31 13.09 L3.28 12.84 L3.28 12.57 L3.31 12.29 L3.39 11.99 L3.49 11.69 L3.63 11.38 L3.81 11.06 L4.03 10.75 L4.28 10.44 L4.58 10.14 L4.90 9.86 L5.26 9.58 L5.65 9.32 L6.07 9.09 L6.51 8.88 L6.98 8.68 L7.47 8.52 L7.97 8.39 L8.49 8.28 L9.03 8.21 L9.56 8.17 L10.10 8.16 L10.64 8.18 L11.01 8.13 L11.34 7.94 L11.57 7.64 L11.67 7.28 L11.62 6.91 L11.44 6.57 L11.14 6.34 L10.77 6.24 L10.12 6.22 L9.47 6.23 L8.81 6.28 L8.17 6.38 L7.54 6.50 L6.91 6.66 L6.31 6.86 L5.73 7.10 L5.17 7.37 L4.64 7.67 L4.14 8.00 L3.67 8.36 L3.24 8.74 L2.84 9.15 L2.49 9.57 L2.17 10.02 L1.91 10.49 L1.69 10.96 L1.52 11.45 L1.41 11.94 L1.35 12.43 L1.34 12.93 L1.39 13.41 L1.50 13.88 L1.67 14.34 L1.89 14.76 L2.16 15.16 L2.49 15.52 L2.85 15.84 L3.26 16.11 L3.69 16.34 L4.16 16.52 L4.65 16.65 L5.16 16.73 L5.69 16.77 L6.23 16.76 L6.77 16.69 L7.32 16.59 L7.87 16.44 L8.20 16.26 L8.44 15.96 L8.54 15.60 L8.50 15.22 L8.32 14.89 L8.03 14.66 L7.66 14.55 Z" fill="currentColor" stroke="none" /></>,
  search: <><circle cx="9" cy="9" r="5" /><path d="m13 13 3.5 3.5" /></>,
  browser: <><circle cx="10" cy="10" r="7" /><path d="m12.8 7.2-1.6 4-4 1.6 1.6-4z" /></>,
  notes: <><path d="M5.5 3h6l3 3v11h-9z" /><path d="M11.5 3v3h3M7.5 10h5M7.5 13h4" /></>,
  tasks: <><rect x="3.5" y="4" width="5" height="5" rx="1" /><path d="m4.8 6.5 1 1 1.6-2M11 6.5h5.5M11 13.5h5.5" /><rect x="3.5" y="11" width="5" height="5" rx="1" /></>,
  calendar: <><rect x="3.5" y="4.5" width="13" height="12" rx="2" /><path d="M3.5 8.5h13M7 3v3M13 3v3M7 11.5h2M11 11.5h2M7 14h2" /></>,
  sheets: <><rect x="3.5" y="4" width="13" height="12" rx="2" /><path d="M3.5 8h13M3.5 12h13M8 4v12" /></>,
  mail: <><rect x="3" y="5" width="14" height="10.5" rx="2" /><path d="m3.5 6 6.5 5 6.5-5" /></>,
  slides: <><rect x="3" y="4" width="14" height="9.5" rx="1.5" /><path d="M10 13.5V16M7 16.5h6M8.5 7l3 1.8-3 1.8z" /></>,
  skills: <><path d="M5 4.5h10M5 8.5h10M5 12.5h6" /><path d="m12.5 14.5 1.5 1.5 3-3" /></>,
  video: <><rect x="3" y="5" width="10.5" height="10" rx="2" /><path d="m13.5 8.5 3.5-2v7l-3.5-2" /></>,
  studio: <><path d="M8 15.5V5l8-1.5V14" /><circle cx="6" cy="15.5" r="2" /><circle cx="14" cy="14" r="2" /></>,
  photo: <><rect x="3" y="4.5" width="14" height="11" rx="2" /><path d="m3.5 13.5 4-4 3 3 2-2 4 4" /><circle cx="13" cy="8" r="1.3" /></>,
  design: <><path d="M4 16l1-4 8.5-8.5a2.1 2.1 0 0 1 3 3L8 15z" /><path d="M12 5l3 3M4 16h5" /></>,
  code: <><path d="m7 6-4 4 4 4M13 6l4 4-4 4M11 4.5l-2 11" /></>,
  docs: <><path d="M5.5 3h6l3 3v11h-9z" /><path d="M11.5 3v3h3M7.5 9.5h5M7.5 12h5M7.5 14.5h3" /></>,
  research: <><circle cx="8.5" cy="8.5" r="4.5" /><path d="m12 12 4.5 4.5M6.5 8.5h4M8.5 6.5v4" /></>,
  projects: <><path d="M3.5 6.5h5l1.5 1.5h6.5v7.5h-13z" /><path d="M3.5 6.5v-2h5" /></>,
  wiki: <><path d="M5 4.5h7.5l2.5 2.5v8.5H5z" /><path d="M7.5 8.5h5M7.5 11h5M7.5 13.5h3" /></>,
  reader: <><path d="M10 5.5C8.5 4.3 6.3 4 3.5 4.5v11c2.8-.5 5 0 6.5 1 1.5-1 3.7-1.5 6.5-1v-11c-2.8-.5-5-.2-6.5 1z" /><path d="M10 5.5v11" /></>,
  database: <><ellipse cx="10" cy="5.5" rx="6" ry="2.5" /><path d="M4 5.5v9c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5v-9M4 10c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5" /></>,
  terminal: <><rect x="3" y="4" width="14" height="12" rx="2" /><path d="m6.5 8 2.5 2-2.5 2M10.5 13h3" /></>,
  canvas: <><rect x="3" y="3.5" width="6" height="6" rx="1" /><rect x="11" y="10.5" width="6" height="6" rx="1" /><path d="M9 6.5h3.5a1.5 1.5 0 0 1 1.5 1.5v2.5" /></>,
  review: <><path d="M4 10a6 6 0 1 0 12 0 6 6 0 0 0-12 0" /><path d="m7.5 10 1.8 1.8 3.4-3.6" /></>,
  files: <path d="M3.5 6.5a1.5 1.5 0 0 1 1.5-1.5h3l1.5 1.5h5.5a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5z" />,
  views: <><rect x="3.5" y="3.5" width="13" height="5.5" rx="1.5" /><rect x="3.5" y="11" width="5.5" height="5.5" rx="1.5" /><rect x="11" y="11" width="5.5" height="5.5" rx="1.5" /></>,
};

/** The apps, always one click away, in the order people reach for them. */
export const RAIL_APPS: { id: AppId; name: string }[] = [
  { id: 'agent', name: 'Agent' },
  { id: 'search', name: 'Search' },
  { id: 'browser', name: 'Browser' },
  { id: 'mail', name: 'Mail' },
  { id: 'notes', name: 'Notes' },
  { id: 'docs', name: 'Docs' },
  { id: 'sheets', name: 'Sheets' },
  { id: 'slides', name: 'Slides' },
  { id: 'tasks', name: 'Tasks' },
  { id: 'calendar', name: 'Calendar' },
];

/** One of Mobius's own apps, listed in the switcher under the person's apps. */
export interface OwnApp {
  id: 'bots' | 'activity' | 'extensions' | 'settings';
  name: string;
  /** It is the one showing. */
  current: boolean;
  run: () => void;
}

/** The marks of Mobius's own apps. */
export const OWN_ICONS: Record<OwnApp['id'], ReactNode> = {
  bots: <><rect x="4.5" y="7" width="11" height="8.5" rx="2.5" /><path d="M10 7V4.5M8 11h.01M12 11h.01" /></>,
  activity: <path d="M3 10.5h3l2-5 4 9 2-4h3" />,
  extensions: <path d="M8 4.5h3v2a1.5 1.5 0 0 0 3 0v-2h1.5v4h-2a1.5 1.5 0 0 0 0 3h2v4h-4v-2a1.5 1.5 0 0 0-3 0v2h-4v-11z" />,
  settings: <><path d="M4 6h8M15 6h1M4 14h1M8 14h8" /><circle cx="13.5" cy="6" r="1.8" /><circle cx="6.5" cy="14" r="1.8" /></>,
};

interface Props {
  /** Bots, Activity and Settings: Mobius's own apps, in the switcher. */
  ownApps?: readonly OwnApp[];
  /** The app's own sidebar list starts with its New row, so the sidebar's New button is left out. */
  createInList?: boolean;
  /** The open profile's name, when it is not Personal. */
  profile?: string;
  onProfiles?: () => void;
  app: AppId;
  /**
   * The full sidebar belongs to the open app: its name in the head, New, then its own list. The head is the app
   * switcher: press it and the same column lists the apps instead. Otherwise a narrow rail of icons.
   */
  expanded: boolean;
  onToggle: () => void;
  /** The New button: what is worth starting in the app you are in. */
  /** The open app's New; none where there is nothing to make (Search). */
  create?: { label: string; run: () => void } | undefined;
  /** Small numbers beside an app's name in the full sidebar (open tabs, tasks due today). */
  counts: Partial<Record<AppId, number>>;
  /** The menus, as one button in the head of the full sidebar. */
  menus?: ReactNode;
  /** The open app's own controls (the browser's address and buttons), under its name in the full sidebar. */
  chrome?: ReactNode;
  /** Mobius as the sidebar's third face: the conversation takes the column, the app's name stays in the head. */
  /** The Mobius button: shows and hides Mobius in the right panel, beside the work. */
  mobius?: { shown: boolean; onToggle: () => void } | null;
  children?: ReactNode;
  /** Changes when something outside asks for the app switcher. */
  switcherToken?: number;
  onOpen: (id: AppId) => void;
  /** What the agent is doing now: the app it is working in shows it, live. */
  activity: Activity | null;
  /** Apps the agent changed while you were somewhere else. */
  changed: ReadonlySet<AppId>;
  needsYou: number;
  onLauncher: () => void;
  onSettings: () => void;
  /** The person's shortcuts for All apps and Settings, shown in the tooltips; nothing until they are known. */
  launcherKeys?: string;
  settingsKeys?: string;
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
 * The sidebar: one column that belongs to the app you are in, and turns into the list of apps from its head. The highlight slides to the app you are in, the app the agent
 * is working in glows while it works, and an app it changed while you were elsewhere carries a dot until you look.
 */
export function Rail({ app, expanded, onToggle, create, createInList = false, ownApps, counts, menus, chrome, mobius, children, onOpen, activity, changed, needsYou, onLauncher, onSettings, launcherKeys = '', settingsKeys = '', settingsOpen, apps, onApps, onEditApps, favourites = [], onOpenFavourite, onUnpin, onReorderFavourites, currentFavourite, profile, onProfiles, switcherToken = 0 }: Props) {
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
  // Only the apps added from Abilities (and Home) are listed.
  const listed = (chosen ? RAIL_APPS.filter((a) => chosen.includes(a.id)).sort((a, b) => chosen.indexOf(a.id) - chosen.indexOf(b.id)) : RAIL_APPS).filter((a) => isInstalled(a.id));
  const order = listed.map((a) => a.id);
  // Right-click an app (or Shift+F10) to move or hide it: HIG asks that people can shape the sidebar.
  const [menu, setMenu] = useState<{ id: AppId; x: number; y: number } | null>(null);
  // Whether an app's menu is open, for Escape: it closes the menu first, then the app switcher.
  const menuOpen = useRef(false);
  menuOpen.current = menu !== null;
  const railRef = useRef<HTMLElement>(null);
  useSideFolds(railRef, expanded);
  // After the app changes under a pointer that has not moved, the row now under it is not "hovered": the browser
  // keeps the old hover until the pointer moves, which drew a grey bar on whatever landed there.
  const [still, setStill] = useState(false);
  // Something outside (the Mobius head beside the page) asks for the app switcher.
  useEffect(() => { if (switcherToken) setFace('apps'); }, [switcherToken]);
  useEffect(() => { setStill(true); }, [app]);
  const move = (id: AppId, by: -1 | 1) => {
    const at = order.indexOf(id);
    const to = at + by;
    if (to < 0 || to >= order.length) return;
    const next = [...order];
    [next[at], next[to]] = [next[to]!, next[at]!];
    onApps?.(next);
  };
  // The full sidebar has two faces: the open app's own (New, pinned, its list) and the apps. An app with no list
  // of its own shows the apps under New, so the column is never empty.
  const [face, setFace] = useState<'app' | 'apps'>('app');
  const switching = expanded && face === 'apps';
  // Settings is an app too: its sections take the sidebar while it is open.
  const showOwn = expanded && !switching;
  const showApps = !showOwn || !children;
  useEffect(() => { setFace('app'); }, [app, settingsOpen, expanded]);
  useEffect(() => {
    if (!switching) return undefined;
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && !menuOpen.current) setFace('app'); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [switching]);
  // Bots and Activity are views of the Agent app, but they are apps of their own in the switcher: the head says so.
  const ownHere = settingsOpen ? undefined : ownApps?.find((o) => o.current && o.id !== 'settings');
  const title = settingsOpen ? 'Settings' : ownHere?.name ?? appName(app);
  // Seen from inside one app: is anything happening in another?
  const elsewhereWorking = activity !== null && activity.app !== null && activity.app !== app;
  const elsewhereChanged = [...changed].some((id) => id !== app);
  const toggle = (
    <button type="button" className="rail-btn rail-toggle" aria-label={expanded ? 'Collapse sidebar' : 'Expand sidebar'} aria-expanded={expanded} title={expanded ? 'Collapse sidebar' : 'Expand sidebar'} onClick={onToggle}>
      <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="4" width="14" height="12" rx="2" /><path d="M8 4v12" /></svg>
    </button>
  );
  const allApps = (
    <button type="button" className="rail-btn" data-app-library aria-haspopup="dialog" aria-label={`Applications. Current: ${RAIL_APPS.find((a) => a.id === app)?.name ?? app}`} title={withKeys('All apps and commands', launcherKeys)} onClick={() => { setFace('app'); onLauncher(); }}>
      <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="6" cy="6" r="1.4" /><circle cx="14" cy="6" r="1.4" /><circle cx="6" cy="14" r="1.4" /><circle cx="14" cy="14" r="1.4" /></svg>
      {expanded && <span className="rail-label" aria-hidden="true">All apps</span>}
    </button>
  );
  const createButton = create && (
    <button type="button" className="rail-btn rail-create" aria-label="Create" title={create.label} onClick={create.run}>
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4.5v11M4.5 10h11" /></svg>
      {expanded && <span className="rail-label" aria-hidden="true">{create.label}</span>}
    </button>
  );
  const switcher = (
        <button type="button" className="rail-btn rail-switch" data-app-switcher aria-label={switching ? `Back to ${title}` : `Switch app. Current: ${title}`} aria-expanded={switching} title={switching ? undefined : 'Switch app'}
          data-working={(!switching && elsewhereWorking) || undefined} data-changed={(!switching && elsewhereChanged) || undefined}
          onClick={() => setFace(switching ? 'app' : 'apps')}>
          {switching
            ? <svg viewBox="0 0 20 20" aria-hidden="true" className="rail-switch-grid"><circle cx="6" cy="6" r="1.4" /><circle cx="14" cy="6" r="1.4" /><circle cx="6" cy="14" r="1.4" /><circle cx="14" cy="14" r="1.4" /></svg>
            : settingsOpen
              ? <svg viewBox="0 0 20 20" aria-hidden="true" className="rail-switch-grid"><path d="M4 6h8M15 6h1M4 14h1M8 14h8" /><circle cx="13.5" cy="6" r="1.8" /><circle cx="6.5" cy="14" r="1.8" /></svg>
              : <svg viewBox="0 0 20 20" aria-hidden="true" className="rail-switch-tile" style={{ background: `var(--app-${app})` }}>{ownHere ? OWN_ICONS[ownHere.id] : APP_ICONS[app]}</svg>}
          <span className="rail-label" aria-hidden="true">{switching ? 'Apps' : title}</span>
          {needsYou > 0 && !showApps && <span className="rail-badge" role="status" aria-label={`${needsYou} waiting for you`}>{needsYou}</span>}
          <svg viewBox="0 0 20 20" aria-hidden="true" className="rail-switch-caret"><path d="m7 8.5 3 3 3-3" /></svg>
        </button>
  );
  return (
    <nav ref={railRef} className="rail" aria-label="Apps" data-pointer-still={still || undefined} onPointerMove={still ? () => setStill(false) : undefined} data-expanded={expanded || undefined} data-face={expanded ? (switching ? 'apps' : 'app') : undefined}>
      {expanded ? (
        <>
          <div className="rail-head">
            {switcher}
            {mobius && !switching && (
              <button type="button" className="rail-btn rail-mobius" data-mobius-face aria-pressed={mobius.shown} aria-label={mobius.shown ? 'Hide Mobius' : 'Show Mobius'} title={mobius.shown ? 'Hide Mobius' : 'Ask Mobius, beside the work'} onClick={mobius.onToggle}>
                <svg viewBox="0 0 20 20" aria-hidden="true">{APP_ICONS.agent}</svg>
              </button>
            )}
            {menus}
            {toggle}
          </div>
          {/* The page's controls stay where they were, above Mobius, so the address does not jump when Mobius opens. */}
          {showOwn && chrome && <div className="rail-chrome">{chrome}</div>}
          {showOwn && !createInList && !settingsOpen && <div className="rail-new">{createButton}</div>}
        </>
      ) : (
        <div className="rail-top">
          {toggle}
          {/* Mobius opens from here too: the folded rail grows into its column. */}
          {mobius && (
            <button type="button" className="rail-btn rail-mobius" data-mobius-face aria-pressed={mobius.shown} aria-label="Mobius in the sidebar" title="Ask Mobius here, in the sidebar" onClick={mobius.onToggle}>
              <svg viewBox="0 0 20 20" aria-hidden="true">{APP_ICONS.agent}</svg>
            </button>
          )}
          {menus}
          {createButton}
        </div>
      )}
      {showApps && <Reorder.Group as="ul" axis="y" role="list" className="rail-apps" values={order} onReorder={(next: AppId[]) => { if (onApps) setDragOrder(next); }}>
        {listed.map(({ id, name }) => {
          // The Agent app showing Bots or Activity is that app, not Agent.
          const here = app === id && !settingsOpen && !(id === 'agent' && (ownApps ?? []).some((o) => o.current));
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
                onClick={() => { if (!dragged.current) { setFace('app'); onOpen(id); } }}
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
      </Reorder.Group>}
      {menu && (
        <PointMenu x={menu.x} y={menu.y} label={`${RAIL_APPS.find((a) => a.id === menu.id)?.name ?? ''} in the sidebar`} onClose={() => setMenu(null)} entries={[
          { label: 'Move up', disabled: order.indexOf(menu.id) === 0, run: () => move(menu.id, -1) },
          { label: 'Move down', disabled: order.indexOf(menu.id) === order.length - 1, run: () => move(menu.id, 1) },
          { label: 'Hide from sidebar', disabled: order.length === 1, run: () => onApps?.(order.filter((id) => id !== menu.id)) },
          ...(onEditApps ? [{ label: 'Edit sidebar…', run: onEditApps }] : []),
        ]} />
      )}
      {showOwn && favourites.length > 0 && (
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
      {showOwn && children && <div className="rail-app">{children}</div>}
      {switching && ownApps && ownApps.length > 0 && (
        <section className="rail-own" aria-label="Mobius’s apps">
          <h2 className="rail-pinned-title">Mobius</h2>
          <ul role="list" className="rail-apps">
            {ownApps.map((o) => (
              <li key={o.id}>
                <button type="button" className="rail-btn" aria-label={o.name} aria-current={o.current ? 'page' : undefined} title={o.name} onClick={() => { setFace('app'); o.run(); }}>
                  {o.current && <motion.span className="rail-here" layoutId="rail-here" transition={{ type: 'spring', stiffness: 520, damping: 40 }} />}
                  <svg viewBox="0 0 20 20" aria-hidden="true" data-own={o.id}>{OWN_ICONS[o.id]}</svg>
                  <span className="rail-label" aria-hidden="true">{o.name}</span>
                </button>
              </li>
            ))}
          </ul>
          {allApps}
        </section>
      )}
      <div className="rail-end">
        {profile && onProfiles && (
          <button type="button" className="rail-btn rail-profile" aria-label={`Profile: ${profile}. Change profile`} title={`Profile: ${profile}`} onClick={onProfiles}>
            <span className="rail-profile-badge" aria-hidden="true">{profile.slice(0, 1).toUpperCase()}</span>
            {expanded && <span className="rail-label" aria-hidden="true">{profile}</span>}
          </button>
        )}
        {/* The full sidebar's foot holds only the profile: All apps is at the end of the switcher, Settings among Mobius's
            apps. The folded rail has no switcher, so it keeps both. */}
        {!expanded && allApps}
        {!expanded && <button type="button" className="rail-btn" aria-label="Settings" aria-current={settingsOpen ? 'page' : undefined} title={withKeys('Settings', settingsKeys)} onClick={onSettings}>
          {settingsOpen && <motion.span className="rail-here" layoutId="rail-here" transition={{ type: 'spring', stiffness: 520, damping: 40 }} />}
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 6h8M15 6h1M4 14h1M8 14h8" /><circle cx="13.5" cy="6" r="1.8" /><circle cx="6.5" cy="14" r="1.8" /></svg>
        </button>}
      </div>
    </nav>
  );
}

/** A tooltip with the person's keys for it, as this computer writes them; just the words when there are none. */
function withKeys(text: string, binding: string): string {
  return binding ? `${text} (${describeCombo(binding, window.mobius.platform)})` : text;
}
