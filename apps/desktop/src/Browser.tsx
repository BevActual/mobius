import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type DragEvent, type FormEvent, type ReactNode, type RefObject } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { BookmarkEntry, BrowserTabState, DownloadEntry, HistoryEntry } from '@mobius/shared';
import { createPortal } from 'react-dom';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';
import { DownloadsButton } from './DownloadsList';
import { FindBar } from './FindBar';
import { MobiusMark } from './MobiusMark';
import { quick } from './motion';
import { SelectionMenu, type ClipPage, type WebSelectionAction } from './SelectionMenu';
import { StartPage } from './StartPage';
import { addressParts, dropPlan, historyByDay, hostOf, nextTabId, sidebarMatch, stepZoom, suggestionsFor, tileLetter, type Suggestion } from './browser-view';
import { addFolder, addSpace, CLEAR_AFTER, favouriteTab, foldersIn, putInFolder, removeFolder, renameFolder, toggleFolder, type Folder, inSpace, isFavourite, MAX_FAVOURITES, moveTab, readSpaces, removeSpace, renameSpace, siteHue, staleTabs, syncSpaces, tabToShow, toggleFavourite, type SpacesState } from './browser-spaces';
import { AppSidebar, Confirm, IconButton, KeyCaps, Menu, PointMenu, SidebarRow, SidebarSection, ToolbarControls, type MenuEntry } from './ui';
import { timeLabel } from './dates';
import { SurfaceSlot } from './SurfaceSlot';
import { TOOL_ICONS } from './ui/ToolIcons';
import './browser.css';
import { afterPaint } from './ui/frame';

/**
 * The Browser app's own UI: the list of tabs, the controls above the page (back, forward, reload, the address bar),
 * and the page itself, which is Mobius's start page for a new tab and otherwise the native page's slot. The shell
 * keeps the native page glued to that slot (SurfaceSlot and the window's bounds code); this file only draws.
 */

const TAB_DRIVER = { reading: 'Mobius reading', mobius: 'Mobius', yours: 'Yours' } as const;
const TAB_DRIVER_TITLE = { reading: 'Mobius is reading this tab', mobius: 'Mobius is using this tab', yours: 'You took over this tab from Mobius' } as const;

/** One tab's row: a click shows it, a middle click closes it, a right click opens its menu, and it can be dragged. */
function TabRow({ tab, onMenu, drag, onShow, reading = false }: { tab: BrowserTabState; onMenu: (tab: BrowserTabState, x: number, y: number) => void; drag: TabDrag; onShow?: () => void; reading?: boolean }) {
  const still = useReducedMotion() ?? false;
  const sound = (tab.audible === true || tab.muted === true) && typeof window.mobius.browser.mute === 'function';
  return (
    <motion.li
      layout="position"
      // A new tab grows into the list and a closed one folds away; under Reduce Motion they only fade.
      // The row always ends at its full height: Reduce Motion can be learned after the row started growing (the first
      // read of it may come late), and an end without a height would leave the row stopped part way, a few pixels tall.
      initial={still ? { opacity: 0 } : { opacity: 0, height: 0, overflow: 'hidden' }}
      animate={{ opacity: 1, height: 'auto', transitionEnd: { overflow: 'visible' }, ...(still ? { transition: { height: { duration: 0 } } } : {}) }}
      exit={still ? { opacity: 0, transition: quick } : { opacity: 0, height: 0, overflow: 'hidden', transition: { ...quick, duration: 0.18 } }}
      className="tab"
      aria-current={tab.active && !reading ? 'page' : undefined}
      data-pinned={tab.pinned ? 'true' : undefined}
      data-sound={sound || undefined}
      data-split={splitNow !== null && (splitNow.first === tab.id || splitNow.second === tab.id) ? 'true' : undefined}
      data-drop={drag.over?.id === tab.id ? (drag.over.after ? 'after' : 'before') : undefined}
      data-dragging={drag.dragging === tab.id || undefined}
      draggable={drag.enabled}
      onDragStartCapture={(e) => drag.start(e, tab.id)}
      onDragOver={(e) => drag.overTab(e, tab.id)}
      onDrop={(e) => drag.drop(e)}
      onDragEndCapture={drag.end}
      onContextMenu={(e) => { e.preventDefault(); onMenu(tab, e.clientX, e.clientY); }}
      onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); window.mobius.browser.close(tab.id); } }}
    >
      <button type="button" className="tab-main" title={tab.url ? `${tab.title}\n${tab.url}` : tab.title} onClick={() => { window.mobius.browser.activate(tab.id); onShow?.(); }}>
        <SiteChip url={tab.url} icon={tab.icon} />
        <span className="tab-title">{tab.title}</span>
        {tab.driver && (
          // A small mark, not a word, so the title keeps its room: Mobius's mark only while Mobius reads or uses the tab; once you
          // took it over it is a plain row again (the words stay for screen readers).
          <span className="tab-driver" data-driver={tab.driver} title={TAB_DRIVER_TITLE[tab.driver]}>
            {tab.driver !== 'yours' && <MobiusMark size={14} turning={tab.driver === 'mobius'} />}
            <span className="sr-only">{TAB_DRIVER[tab.driver]}</span>
          </span>
        )}
        {tab.loading && <span className="tab-loading" aria-label="Loading" />}
      </button>
      <span className="tab-actions">
        {sound && (
          // The speaker, as Chrome's and Arc's: shown while the tab plays sound or is muted, kept clear of the row's other
          // buttons; a click (or Enter on it) mutes or unmutes the tab.
          <button type="button" className="tab-close tab-sound" data-muted={tab.muted || undefined} aria-label={`${tab.muted ? 'Unmute' : 'Mute'} ${tab.title}`} title={tab.muted ? 'Unmute tab' : 'Mute tab'} onClick={() => window.mobius.browser.mute?.(tab.id, !tab.muted)}>
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 6h2.5L9 3v10L5.5 10H3z" />{tab.muted ? <path d="m11 6 3 4m0-4-3 4" /> : <path d="M11 5.5a3.5 3.5 0 0 1 0 5M12.5 3.5a6 6 0 0 1 0 9" />}</svg>
          </button>
        )}
        {window.mobius.browser.pin && (
          <button type="button" className="tab-close tab-pin" aria-label={`${tab.pinned ? 'Unpin' : 'Pin'} ${tab.title}`} aria-pressed={tab.pinned === true} title={tab.pinned ? 'Unpin tab' : 'Pin tab'} onClick={() => window.mobius.browser.pin?.(tab.id, !tab.pinned)}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 3h6l-1 5 3 3H5l3-3-1-5ZM10 11v6" /></svg>
          </button>
        )}
        {window.mobius.browser.duplicate && (
          <button type="button" className="tab-close" aria-label={`Duplicate ${tab.title}`} title="Duplicate tab" onClick={() => void window.mobius.browser.duplicate?.(tab.id)}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 7h9v9H7zM4 13V4h9" /></svg>
          </button>
        )}
        <button type="button" className="tab-close tab-x" aria-label={`Close ${tab.title}`} title="Close tab (Ctrl+W)" onClick={() => window.mobius.browser.close(tab.id)}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 6 8 8M14 6l-8 8" /></svg>
        </button>
      </span>
    </motion.li>
  );
}

interface TabDrag {
  enabled: boolean;
  dragging: string | null;
  over: { id: string; after: boolean } | null;
  start: (e: DragEvent, id: string) => void;
  overTab: (e: DragEvent, id: string) => void;
  drop: (e: DragEvent) => void;
  end: () => void;
}

/** Dragging tabs to put them in another order, or across the line to pin or unpin them. */
function useTabDrag(tabs: readonly BrowserTabState[]): TabDrag {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<{ id: string; after: boolean } | null>(null);
  const enabled = typeof window.mobius.browser.moveTab === 'function';
  return {
    enabled,
    dragging,
    over,
    start: (e, id) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/x-mobius-tab', id); setDragging(id); },
    overTab: (e, id) => {
      if (!dragging) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const r = e.currentTarget.getBoundingClientRect();
      const after = e.clientY > r.top + r.height / 2;
      if (over?.id !== id || over.after !== after) setOver({ id, after });
    },
    drop: (e) => {
      e.preventDefault();
      const plan = dragging && over ? dropPlan(tabs, dragging, over.id, over.after) : null;
      const moving = tabs.find((t) => t.id === dragging);
      if (plan && moving) {
        if ((moving.pinned === true) !== plan.pinned) window.mobius.browser.pin?.(moving.id, plan.pinned);
        window.mobius.browser.moveTab?.(moving.id, plan.index);
      }
      setDragging(null);
      setOver(null);
    },
    end: () => { setDragging(null); setOver(null); },
  };
}

/**
 * A tab's right-click menu, the shared one. It is kept inside the sidebar, since the page is drawn over everything beside
 * it, so it opens from a point that leaves room for it there.
 */
function TabMenu({ tab, x, y, tabs, spaces: sp, pinnedPages, onPinPage, onNewFolder, onClose }: { tab: BrowserTabState; x: number; y: number; tabs: readonly BrowserTabState[]; spaces: SpacesState; pinnedPages: ReadonlySet<string>; onPinPage: (tab: BrowserTabState) => void; onNewFolder: (tab: BrowserTabState) => void; onClose: () => void }) {
  const side = document.querySelector('.side')?.getBoundingClientRect();
  const left = side ? Math.max(side.left + 4, Math.min(x, side.right - TAB_MENU_W - 4)) : x;
  const others = tabs.filter((t) => t.id !== tab.id && !t.pinned);
  const below = tabs.slice(tabs.findIndex((t) => t.id === tab.id) + 1).filter((t) => !t.pinned);
  const web = /^https?:/i.test(tab.url);
  const api = window.mobius.browser;
  // Plain words, no icons: in a menu every item has an icon or none does.
  const items: ContextMenuItem[] = [
    ...(api.pin ? [{ label: tab.pinned ? 'Unpin tab' : 'Pin tab', run: () => { if (tab.pinned) setSpaces((s) => putInFolder(s, tab.id, null)); api.pin?.(tab.id, !tab.pinned); } }] : []),
    // Folders of pinned tabs, as Arc's: a tab put in one is pinned.
    ...(api.pin ? folderItems(tab, sp, onNewFolder) : []),
    ...(api.mute ? [{ label: tab.muted ? 'Unmute tab' : 'Mute tab', run: () => api.mute?.(tab.id, !tab.muted) }] : []),
    ...(api.duplicate ? [{ label: 'Duplicate tab', run: () => void api.duplicate?.(tab.id) }] : []),
    { label: 'Reload', keys: tab.active ? 'Ctrl+R' : undefined, run: () => api.reload(tab.id), disabled: !tab.url },
    ...(api.reopenClosed ? [{ label: 'Reopen closed tab', keys: 'Ctrl+Shift+T', run: () => void api.reopenClosed?.() }] : []),
    { label: 'Copy link', run: () => void navigator.clipboard?.writeText(tab.url).catch(() => {}), disabled: !web, separated: true },
    { label: 'Bookmark…', keys: tab.active ? 'Ctrl+D' : undefined, run: () => { api.activate(tab.id); void window.mobius.bookmarks.toggle(); }, disabled: !web || !tab.active },
    // Kept with the page's other ways to keep it, rather than as a second pin beside the address.
    { label: pinnedPages.has(tab.url) ? 'Unpin page' : 'Pin page', run: () => onPinPage(tab), disabled: !web },
    // Favourites, kept across spaces, as Arc's: a tile above Pinned.
    { label: isFavourite(sp, tab.url) ? 'Remove from favourites' : 'Add to favourites', run: () => setSpaces((s) => toggleFavourite(s, { url: tab.url, title: tab.title })), disabled: !web || (!isFavourite(sp, tab.url) && sp.favourites.length >= MAX_FAVOURITES) },
    ...sp.spaces.filter((s) => s.id !== (sp.tabSpace[tab.id] ?? sp.current)).map((s, i) => ({ label: `Move to ${s.name}`, separated: i === 0, run: () => { setSpaces((st) => moveTab(st, tab.id, s.id)); } })),
    // Split view, as Arc's: this tab beside the one showing (or, on the one showing, end the split).
    ...(api.showBeside && window.mobius.surface.setBesideBounds ? [splitItem(tab, tabs)] : []),
    { label: 'Close tab', keys: tab.active ? 'Ctrl+W' : undefined, run: () => api.close(tab.id), separated: true },
    { label: 'Close tabs below', run: () => below.forEach((t) => api.close(t.id)), disabled: below.length === 0 },
    { label: 'Close other tabs', run: () => others.forEach((t) => api.close(t.id)), disabled: others.length === 0 },
  ];
  return createPortal(<ContextMenu x={left} y={y} label={tab.title} items={items} onClose={onClose} />, document.body);
}
/** The tab menu's folder items: put it in a folder of this space (pinning it), take it out, or start a folder with it. */
function folderItems(tab: BrowserTabState, sp: SpacesState, onNewFolder: (tab: BrowserTabState) => void): ContextMenuItem[] {
  const api = window.mobius.browser;
  const current = tab.pinned ? sp.tabFolder?.[tab.id] : undefined;
  const put = (f: Folder) => { if (!tab.pinned) api.pin?.(tab.id, true); setSpaces((s) => putInFolder(s, tab.id, f.id)); };
  return [
    ...foldersIn(sp, sp.tabSpace[tab.id] ?? sp.current).filter((f) => f.id !== current).map((f) => ({ label: `Add to ${f.name}`, run: () => put(f) })),
    ...(current ? [{ label: 'Remove from folder', run: () => setSpaces((s) => putInFolder(s, tab.id, null)) }] : []),
    { label: 'New folder with tab', run: () => onNewFolder(tab) },
  ];
}
/** The tab menu's split view item: end it on a tab in the split, else open this tab beside the one showing. */
function splitItem(tab: BrowserTabState, tabs: readonly BrowserTabState[]): ContextMenuItem {
  const api = window.mobius.browser;
  const inSplit = splitNow !== null && (splitNow.first === tab.id || splitNow.second === tab.id);
  if (inSplit) return { label: 'End split view', keys: 'Ctrl+Shift+=', separated: true, run: () => api.showBeside?.(null) };
  const showing = tabs.find((t) => t.active);
  return { label: 'Open in split view', separated: true, disabled: tab.active || !showing, run: () => api.showBeside?.(tab.id) };
}
/** The split as the shell last said, for menus and keys outside React's state. */
let splitNow: { first: string; second: string } | null = null;

/** About as wide as the tab menu draws, to keep it clear of the page. */
const TAB_MENU_W = 210;

/**
 * Page zoom kept per site, as Chrome's: a site zoomed in once opens at that size in every tab and after a restart. The
 * shell keeps a tab's zoom as it goes; this sets it when a tab shows a site with another size.
 */
const ZOOM_KEY = 'mobius.browser.zoom';
let siteZoom: Record<string, number> = (() => { try { const v = JSON.parse(localStorage.getItem(ZOOM_KEY) ?? '{}') as unknown; return v && typeof v === 'object' ? (v as Record<string, number>) : {}; } catch { return {}; } })();
const zoomListeners = new Set<() => void>();
function setSiteZoom(url: string, z: number) {
  const host = /^https?:/i.test(url) ? hostOf(url) : '';
  if (!host) return;
  const next = { ...siteZoom };
  if (Math.abs(z - 1) < 0.001) delete next[host]; else next[host] = z;
  siteZoom = next;
  try { localStorage.setItem(ZOOM_KEY, JSON.stringify(next)); } catch { /* for this window */ }
  zoomListeners.forEach((l) => l());
}
const useSiteZoomMap = () => useSyncExternalStore((l) => { zoomListeners.add(l); return () => { zoomListeners.delete(l); }; }, () => siteZoom, () => siteZoom);
const zoomFor = (url: string) => (/^https?:/i.test(url) ? siteZoom[hostOf(url)] ?? 1 : 1);
/** Each tab at its site's zoom; a zoom the page made itself (Ctrl+wheel) becomes the site's. */
function useSiteZoom(tabs: readonly BrowserTabState[]) {
  const map = useSiteZoomMap();
  const applied = useRef(new Map<string, { host: string; zoom: number; pending: boolean }>());
  useEffect(() => {
    const api = window.mobius.browser;
    if (!api.setZoom) return;
    for (const t of tabs) {
      if (t.zoom === undefined || !/^https?:/i.test(t.url)) continue;
      const host = hostOf(t.url);
      const want = map[host] ?? 1;
      const prev = applied.current.get(t.id);
      const same = (a: number, b: number) => Math.abs(a - b) < 0.001;
      if (prev?.pending && prev.host === host && !same(t.zoom, prev.zoom)) continue;
      if (prev && prev.host === host && !prev.pending && !same(t.zoom, prev.zoom) && !same(t.zoom, want)) { applied.current.set(t.id, { host, zoom: t.zoom, pending: false }); setSiteZoom(t.url, t.zoom); continue; }
      if (!same(t.zoom, want)) { api.setZoom(t.id, want); applied.current.set(t.id, { host, zoom: want, pending: true }); }
      else applied.current.set(t.id, { host, zoom: t.zoom, pending: false });
    }
  }, [tabs, map]);
}

/** The spaces, favourites and Today's clock, kept for the window (and across restarts) and shared by the tabs panel and the keys. */
const SPACES_KEY = 'mobius.browser.spaces';
let spaces: SpacesState = readSpaces((() => { try { return localStorage.getItem(SPACES_KEY); } catch { return null; } })());
const spaceListeners = new Set<() => void>();
function setSpaces(next: SpacesState | ((s: SpacesState) => SpacesState)) {
  const value = typeof next === 'function' ? next(spaces) : next;
  if (value === spaces) return;
  spaces = value;
  try { localStorage.setItem(SPACES_KEY, JSON.stringify(value)); } catch { /* kept for this window only */ }
  spaceListeners.forEach((l) => l());
}
const subscribeSpaces = (l: () => void) => { spaceListeners.add(l); return () => { spaceListeners.delete(l); }; };
export const useSpaces = () => useSyncExternalStore(subscribeSpaces, () => spaces, () => spaces);

/**
 * Recently closed tabs, as Chrome's History › Recently closed and Arc's Archived Tabs: each web tab that leaves the
 * list, newest first, kept across restarts (the last 25). `cleared` marks one Today closed by itself.
 */
export interface ClosedTab { url: string; title: string; closed: number; cleared?: boolean }
const CLOSED_KEY = 'mobius.browser.closed';
const CLOSED_MAX = 25;
let closedTabs: ClosedTab[] = (() => { try { const v = JSON.parse(localStorage.getItem(CLOSED_KEY) ?? '[]') as unknown; return Array.isArray(v) ? (v as ClosedTab[]).slice(0, CLOSED_MAX) : []; } catch { return []; } })();
const closedListeners = new Set<() => void>();
function setClosed(next: ClosedTab[]) {
  closedTabs = next.slice(0, CLOSED_MAX);
  try { localStorage.setItem(CLOSED_KEY, JSON.stringify(closedTabs)); } catch { /* kept for this window only */ }
  closedListeners.forEach((l) => l());
}
const useClosedTabs = () => useSyncExternalStore((l) => { closedListeners.add(l); return () => { closedListeners.delete(l); }; }, () => closedTabs, () => closedTabs);
/** Tabs Today is closing by itself: remembered so their row in Recently closed says so. */
const clearing = new Set<string>();

/** Keeps spaces in step with the tabs, and closes Today tabs left unseen too long (checked now and every ten minutes). */
function useSpacesSync(tabs: readonly BrowserTabState[]) {
  // Again when a tab goes in or out of a folder, so its address is kept for a restart.
  const inFolders = useSpaces().tabFolder;
  useEffect(() => { setSpaces((s) => syncSpaces(s, tabs, Date.now())); }, [tabs, inFolders]);
  const latest = useRef(tabs);
  // A web tab that has left the list since last time is remembered under Recently closed.
  useEffect(() => {
    const gone = latest.current.filter((t) => /^https?:/.test(t.url) && !tabs.some((n) => n.id === t.id));
    if (gone.length > 0) {
      const now = Date.now();
      const added = gone.map((t): ClosedTab => ({ url: t.url, title: t.title, closed: now, ...(clearing.has(t.id) ? { cleared: true } : {}) }));
      gone.forEach((t) => clearing.delete(t.id));
      setClosed([...added, ...closedTabs.filter((c) => !added.some((a) => a.url === c.url))]);
    }
    latest.current = tabs;
  }, [tabs]);
  useEffect(() => {
    const sweep = () => staleTabs(spaces, latest.current, Date.now()).forEach((id) => { clearing.add(id); window.mobius.browser.close(id); });
    sweep();
    const timer = window.setInterval(sweep, 10 * 60_000);
    return () => window.clearInterval(timer);
  }, []);
}

/** Goes to a space: shows the tab seen last there, or opens a new tab in it. */
function goToSpace(id: string, tabs: readonly BrowserTabState[], onNewTab: () => void) {
  setSpaces((s) => ({ ...s, current: id }));
  const show = tabToShow(spaces, tabs, id);
  if (show) window.mobius.browser.activate(show); else onNewTab();
}

/** Goes to the space after (1) or before (-1) the current one, going round: Browser › Next space and Previous space. */
export function stepSpace(step: 1 | -1, tabs: readonly BrowserTabState[], onNewTab: () => void) {
  const at = spaces.spaces.findIndex((s) => s.id === spaces.current);
  const to = spaces.spaces[(at + step + spaces.spaces.length) % spaces.spaces.length];
  if (to && to.id !== spaces.current) goToSpace(to.id, tabs, onNewTab);
}

/** A site's letter on a chip in its colour (one of a few muted hues), or its own icon when it has one. */
function SiteChip({ url, icon, big = false }: { url: string; icon?: string | null; big?: boolean }) {
  const site = hostOf(url);
  if (icon) return <img className="tab-icon" src={icon} alt="" width={16} height={16} draggable={false} />;
  return <span className={big ? 'tab-icon placeholder site-chip big' : 'tab-icon placeholder site-chip'} data-hue={url ? siteHue(site) : undefined} aria-hidden="true">{url ? tileLetter(site) : ''}</span>;
}

/**
 * The tabs panel, after Arc's sidebar (resources.arc.net: Spaces, Favorites, Pinned Tabs, Today): the space's name as
 * its head, Search tabs, favourites as tiles, Pinned, Today (cleared by itself, or with Clear), New tab, From Mobius;
 * at its foot Ask about this page, then the spaces, one letter each, and downloads. Drag to reorder or across to pin, and
 * every tab has a right-click menu.
 */
export interface ReadLater { path: string; title: string; site?: string; /** Finished (in the Archive): shown only when searching. */ done?: boolean }

/**
 * A folder of pinned tabs, as Arc's Folders (resources.arc.net, "Folders"): a row that opens and closes in place, kept
 * per space. Closed, it still shows the tab you are on, as Arc's does. Its tabs keep their pinned order.
 */
function FolderRow({ folder, tabs, row, renaming, onRenamed, onMenu }: { folder: Folder; tabs: readonly BrowserTabState[]; row: (tab: BrowserTabState) => ReactNode; renaming: boolean; onRenamed: (name: string) => void; onMenu: (x: number, y: number) => void }) {
  const shown = folder.open ? tabs : tabs.filter((t) => t.active);
  return (
    <li className="tab-folder" data-open={folder.open || undefined}>
      <div className="tab folder-head" onContextMenu={(e) => { e.preventDefault(); onMenu(e.clientX, e.clientY); }}>
        {renaming ? (
          <input className="folder-rename" aria-label="Folder name" defaultValue={folder.name} autoFocus onFocus={(e) => e.target.select()}
            onBlur={(e) => onRenamed(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } else if (e.key === 'Escape') { e.preventDefault(); e.currentTarget.value = folder.name; e.currentTarget.blur(); } }} />
        ) : (
          <button type="button" className="tab-main" aria-label={folder.name} aria-expanded={folder.open} onClick={() => setSpaces((s) => toggleFolder(s, folder.id))}>
            <svg className="folder-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 4.5h4l1.5 1.5h5.5v6.5h-11z" /></svg>
            <span className="tab-title">{folder.name}</span>
            <span className="folder-count" aria-hidden="true">{tabs.length}</span>
            <svg className="folder-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m6 4 4 4-4 4" /></svg>
          </button>
        )}
      </div>
      {shown.length > 0 && (
        <ul className="tabs folder-tabs" role="list" aria-label={`${folder.name} tabs`}>
          <AnimatePresence initial={false}>{shown.map(row)}</AnimatePresence>
        </ul>
      )}
    </li>
  );
}

export function BrowserSidebar({ tabs, onNewTab, onAsk, downloads, pinnedPages, onPinPage, onOpenBookmark, readLater = [], reading = null, onRead, onShowTab, split = null }: {
  tabs: readonly BrowserTabState[]; pin?: ReactNode; onNewTab: () => void; onAsk?: () => void; downloads: DownloadEntry[]; pinnedPages: ReadonlySet<string>; onPinPage: (tab: BrowserTabState) => void; onOpenBookmark: (url: string) => void;
  /** Read later (Safari's Reading List): articles kept in reader mode, newest first. */
  readLater?: readonly ReadLater[];
  /** The article open in reader mode, if any: it shows as the current row, and no tab does. */
  reading?: string | null;
  onRead?: (item: ReadLater) => void;
  /** A tab was chosen: back from reader mode to the page. */
  onShowTab?: () => void;
  /** The two tabs showing side by side, if any (Arc's Split View). */
  split?: { first: string; second: string } | null;
}) {
  splitNow = split;
  useSpacesSync(tabs);
  useSiteZoom(tabs);
  const sp = useSpaces();
  const [menu, setMenu] = useState<{ tab: BrowserTabState; x: number; y: number } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const [query, setQuery] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [folderMenu, setFolderMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const bookmarks = useBookmarks();
  const mine = inSpace(sp, tabs);
  const drag = useTabDrag(mine);
  const matches = (title: string, url: string) => sidebarMatch(query, title, url);
  // Tabs Mobius is reading or using for its work; "From Mobius" can narrow the list to them.
  const fromMobius = mine.filter((t) => t.driver === 'reading' || t.driver === 'mobius');
  const [mobiusOnly, setMobiusOnly] = useState(false);
  const only = mobiusOnly && fromMobius.length > 0;
  const searching = query.trim() !== '';
  // A search looks through every space's tabs, as Arc's does.
  const shown = (t: BrowserTabState) => matches(t.title, t.url) && (!only || t.driver === 'reading' || t.driver === 'mobius');
  const pool = searching ? tabs : mine;
  const pinned = pool.filter((t) => t.pinned && shown(t));
  const open = pool.filter((t) => !t.pinned && shown(t));
  const saved = bookmarks.filter((b) => matches(b.title, b.url)).slice(0, 20);
  // A search also finds pages visited before, as Arc's and Chrome's do: the latest visit of each, after the bookmarks.
  const visited = useHistory(searching);
  const pastPages = searching ? historyByDay(visited.entries, new Date(), query).flatMap((d) => d.entries).filter((e, i, all) => all.findIndex((x) => x.url === e.url) === i && !saved.some((b) => b.url === e.url) && !tabs.some((t) => t.url === e.url)).slice(0, 8) : [];
  // Folders of pinned tabs, as Arc's; a search shows the tabs without them.
  const folders = searching ? [] : foldersIn(sp);
  const folderOf = (t: BrowserTabState) => (t.pinned ? folders.find((f) => f.id === sp.tabFolder?.[t.id]) : undefined);
  const loose = pinned.filter((t) => !folderOf(t));
  // A new folder is named first, in place.
  const newFolder = (tab?: BrowserTabState) => {
    if (tab && !tab.pinned) window.mobius.browser.pin?.(tab.id, true);
    setSpaces((s) => addFolder(s, '', tab ? [tab.id] : []));
    setRenamingFolder(spaces.folders?.at(-1)?.id ?? null);
  };
  const row = (tab: BrowserTabState) => <TabRow key={tab.id} tab={tab} drag={drag} reading={reading !== null} onShow={onShowTab} onMenu={(t, x, y) => setMenu({ tab: t, x, y })} />;
  const later = readLater.filter((a) => (searching || !a.done || a.path === reading) && matches(a.title, a.site ?? '')).slice(0, searching ? 20 : 12);
  const menuTab = menu ? tabs.find((t) => t.id === menu.tab.id) : undefined;
  const space = sp.spaces.find((s) => s.id === sp.current) ?? sp.spaces[0]!;
  const clearToday = () => mine.filter((t) => !t.pinned && !t.active && !t.driver).forEach((t) => window.mobius.browser.close(t.id));
  // A new space is named first (its name field takes the keys), then opens on a new tab.
  const newSpace = () => { setSpaces((s) => addSpace(s, '')); setRenaming(true); };
  const renamed = (name: string) => {
    setSpaces((s) => renameSpace(s, space.id, name));
    setRenaming(false);
    if (inSpace(spaces, tabs).length === 0) onNewTab();
  };
  // Ctrl+Shift+A finds a tab, as in Chrome; Ctrl+Alt+Left and Right go to the space before or after, as Arc's keys.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !(e.ctrlKey || e.metaKey)) return;
      if (e.shiftKey && !e.altKey && e.code === 'KeyA') { e.preventDefault(); setShowHistory(false); afterPaint(() => search.current?.focus()); return; }
      // Ctrl+H: History in the panel, as in Chrome and Edge; again goes back to the tabs.
      if (!e.shiftKey && !e.altKey && e.code === 'KeyH') { e.preventDefault(); setShowHistory((on) => !on); return; }
      if (e.altKey && !e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        if ((e.target as Element | null)?.closest?.('input, textarea, [contenteditable="true"]')) return;
        e.preventDefault();
        stepSpace(e.key === 'ArrowLeft' ? -1 : 1, tabs, onNewTab);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tabs, onNewTab]);
  const spaceEntries: MenuEntry[] = [
    ...sp.spaces.map((s, i) => ({ label: s.name, checked: s.id === sp.current, run: () => goToSpace(s.id, tabs, onNewTab), })),
    { label: 'New space', separated: true, run: newSpace },
    { label: 'Rename space…', run: () => setRenaming(true) },
    { label: 'Delete space', disabled: sp.spaces.length < 2, run: () => { const to = sp.spaces.find((s) => s.id !== space.id)!; setSpaces((s) => removeSpace(s, space.id)); goToSpace(to.id, tabs, onNewTab); } },
  ];
  const optionEntries: MenuEntry[] = [{ label: 'History', keys: 'Ctrl+H', run: () => setShowHistory(true) }, ...(window.mobius.browser.pin ? [{ label: 'New folder', run: () => newFolder() }] : []), ...CLEAR_AFTER.map((c) => ({ label: c.ms === null ? 'Never clear Today' : `Clear Today after ${c.label.toLowerCase()}`, checked: sp.clearAfter === c.ms, separated: c === CLEAR_AFTER[0], run: () => setSpaces((s) => ({ ...s, clearAfter: c.ms })) }))];
  // Back from History, the keyboard is on the tab showing.
  const closeHistory = () => { setShowHistory(false); afterPaint(() => document.querySelector<HTMLElement>('.tab[aria-current="page"] .tab-main, .tab .tab-main')?.focus()); };
  if (showHistory) return <AppSidebar label="Tabs"><HistoryList tabs={tabs} onClose={closeHistory} /></AppSidebar>;
  return (
    <AppSidebar label="Tabs">
      <div className="browser-side">
        <div className="space-head">
          {renaming ? (
            <input className="space-rename" aria-label="Space name" defaultValue={space.name} autoFocus onFocus={(e) => e.target.select()}
              onBlur={(e) => renamed(e.target.value)}
              onKeyDown={(e) => {
                // Kept from going on: the new tab's address takes focus next, and would take this Enter as its own.
                if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } else if (e.key === 'Escape') { e.preventDefault(); e.currentTarget.value = space.name; e.currentTarget.blur(); }
              }} />
          ) : (
            <Menu label="Spaces" entries={spaceEntries} trigger={<button type="button" className="space-name" title="Spaces (Ctrl+Alt+Left, Ctrl+Alt+Right)">{space.name}<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m5 7 3 3 3-3" /></svg></button>} />
          )}
          <span className="space-options">
            <Menu label="Tabs options" align="end" entries={optionEntries} trigger={<IconButton label="Tabs options" icon={<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 8h.01M8 8h.01M12 8h.01" /></svg>} />} />
          </span>
        </div>
        <label className="space-search">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M7 2.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zM10.3 10.3 13.5 13.5" /></svg>
          <input ref={search} type="search" aria-label="Search tabs and bookmarks" title="Search tabs and bookmarks (Ctrl+Shift+A)" placeholder="Search tabs" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape' && query) { e.preventDefault(); setQuery(''); } }} />
          {/* The keys are said in the field's title; the caps are only seen. */}
          {!query && <span aria-hidden="true"><KeyCaps keys="Ctrl+Shift+A" /></span>}
        </label>
        {!searching && sp.favourites.length > 0 && (
          <ul className="favourites" role="list" aria-label="Favourites">
            {sp.favourites.map((f) => {
              const openTab = favouriteTab(sp, tabs, f.url);
              const showing = openTab !== null && tabs.find((t) => t.id === openTab)?.active === true;
              return (
                <li key={f.url}>
                  <button type="button" className="favourite" aria-current={showing ? 'page' : undefined} title={`${f.title || hostOf(f.url)}\n${f.url}`}
                    onClick={() => { if (openTab) window.mobius.browser.activate(openTab); else void window.mobius.browser.open(f.url); }}
                    onContextMenu={(e) => { e.preventDefault(); setSpaces((s) => toggleFavourite(s, f)); }}>
                    <SiteChip url={f.url} big />
                    <span className="sr-only">{f.title || hostOf(f.url)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <div className="tab-lists" onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) drag.end(); }}>
          {(pinned.length > 0 || folders.length > 0) && (
            <section className="ui-side-section">
              <div className="side-head"><span className="side-title">Pinned</span></div>
              {folders.length > 0 && (
                <ul className="tab-folders" role="list" aria-label="Folders">
                  {folders.map((f) => (
                    <FolderRow key={f.id} folder={f} tabs={pinned.filter((t) => folderOf(t) === f)} row={row} renaming={renamingFolder === f.id}
                      onRenamed={(name) => { setSpaces((s) => (name.trim() ? renameFolder(s, f.id, name) : s)); setRenamingFolder(null); }}
                      onMenu={(x, y) => setFolderMenu({ id: f.id, x, y })} />
                  ))}
                </ul>
              )}
              {loose.length > 0 && (
                <ul className="tabs tabs-pinned" role="list" aria-label="Pinned tabs">
                  <AnimatePresence initial={false}>{loose.map(row)}</AnimatePresence>
                </ul>
              )}
            </section>
          )}
          <section className="ui-side-section">
            <div className="side-head">
              <span className="side-title">{searching ? 'Tabs' : 'Today'}</span>
              {!searching && open.some((t) => !t.active && !t.driver) && (
                <button type="button" className="today-clear" title={sp.clearAfter === null ? 'Close the tabs in Today' : `Close the tabs in Today (they clear by themselves after ${CLEAR_AFTER.find((c) => c.ms === sp.clearAfter)?.label.toLowerCase() ?? 'a while'} unseen)`} onClick={clearToday}>Clear</button>
              )}
            </div>
            <ul className="tabs" role="list" aria-label="Open tabs">
              <AnimatePresence initial={false}>{open.map(row)}</AnimatePresence>
            </ul>
            {searching && open.length === 0 && pinned.length === 0 && saved.length === 0 && pastPages.length === 0 && <p className="tabs-empty">Nothing matches.</p>}
            {!searching && (
              <button type="button" className="tab-new" title="New tab (Ctrl+T)" onClick={onNewTab}>
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>
                <span>New tab</span>
                <KeyCaps keys="Ctrl+T" />
              </button>
            )}
          </section>
          {onRead && (later.length > 0 || reading !== null) && (
            // Read later, as Safari's Reading List: an article opens in reader mode, in place of the page.
            <section className="ui-side-section read-later">
              <div className="side-head"><span className="side-title">Read later</span></div>
              <ul className="tabs" role="list" aria-label="Read later">
                {later.map((a) => (
                  <li key={a.path} className="tab" aria-current={reading === a.path ? 'page' : undefined}>
                    <button type="button" className="tab-main" title={a.site ? `${a.title}\n${a.site}` : a.title} onClick={() => onRead(a)}>
                      <span className="tab-icon read-later-icon" aria-hidden="true">{TOOL_ICONS.reader}</span>
                      <span className="tab-title">{a.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {searching && saved.length > 0 && (
            <SidebarSection title="Bookmarks">
              {saved.map((b) => (
                <SidebarRow key={b.url} label={b.title || hostOf(b.url)} title={b.url} onSelect={() => onOpenBookmark(b.url)} icon={<SiteChip url={b.url} />} />
              ))}
            </SidebarSection>
          )}
          {pastPages.length > 0 && (
            <SidebarSection title="History">
              {pastPages.map((e) => (
                <SidebarRow key={e.url} label={e.title || hostOf(e.url)} title={e.url} onSelect={() => visit(e.url, tabs)} icon={<SiteChip url={e.url} />} />
              ))}
            </SidebarSection>
          )}
          {fromMobius.length > 0 && (
            // The tabs Mobius opened for its work, as one row: pressed, Today shows only those.
            <section className="ui-side-section from-mobius">
              <div className="side-head"><span className="side-title">From Mobius</span></div>
              <button type="button" className="from-mobius-filter" aria-pressed={mobiusOnly} aria-label={`Opened for research: ${fromMobius.length} tabs`} title={mobiusOnly ? 'Show every tab again' : 'Show only the tabs Mobius opened'} onClick={() => setMobiusOnly((on) => !on)}>
                <span className="from-mobius-mark" aria-hidden="true"><MobiusMark size={14} /></span>
                <span className="from-mobius-label">{mobiusOnly ? 'Showing only these' : 'Opened for research'}</span>
                <span className="from-mobius-count">{fromMobius.length}</span>
              </button>
            </section>
          )}
        </div>
        <div className="tabs-foot">
          {onAsk && (
            <button type="button" className="ask-page" title="Ask Mobius about this page" onClick={onAsk}>
              <MobiusMark size={14} />
              <span>Ask about this page</span>
            </button>
          )}
          <div className="spaces-bar">
            <div className="spaces" role="group" aria-label="Spaces">
              {sp.spaces.map((s) => (
                <button key={s.id} type="button" className="space-letter" aria-pressed={s.id === sp.current} aria-label={s.name} title={s.name} onClick={() => { if (s.id !== sp.current) goToSpace(s.id, tabs, onNewTab); }}>
                  {tileLetter(s.name)}
                </button>
              ))}
              <button type="button" className="space-letter space-add" aria-label="New space" title="New space" onClick={newSpace}>
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 4v8M4 8h8" /></svg>
              </button>
            </div>
            <DownloadsButton entries={downloads} />
          </div>
        </div>
        {menu && menuTab && <TabMenu tab={menuTab} x={menu.x} y={menu.y} tabs={mine} spaces={sp} pinnedPages={pinnedPages} onPinPage={onPinPage} onNewFolder={newFolder} onClose={closeMenu} />}
        {folderMenu && createPortal(
          <ContextMenu x={folderMenu.x} y={folderMenu.y} label="Folder" onClose={() => setFolderMenu(null)} items={[
            { label: 'Rename folder…', run: () => setRenamingFolder(folderMenu.id) },
            { label: 'Delete folder', run: () => setSpaces((s) => removeFolder(s, folderMenu.id)) },
          ]} />, document.body)}
      </div>
    </AppSidebar>
  );
}

/** The saved pages, newest first, kept up to date while the sidebar shows. */
/** Browsing history (newest first), read again whenever it changes. Off when history is turned off in Settings. */
function useHistory(active: boolean): { enabled: boolean; entries: HistoryEntry[] } {
  const [view, setView] = useState<{ enabled: boolean; entries: HistoryEntry[] }>({ enabled: true, entries: [] });
  useEffect(() => {
    if (!active) return undefined;
    let live = true;
    const load = () => void window.mobius.history.get('').then((h) => { if (live) setView({ enabled: h.enabled, entries: h.entries }); }).catch(() => {});
    load();
    const off = window.mobius.history.onChanged(load);
    return () => { live = false; off(); };
  }, [active]);
  return view;
}

/** Goes to a page: in the tab showing a web page, as clicking History does in Chrome and Safari, else in a new tab. */
function visit(url: string, tabs: readonly BrowserTabState[], newTab = false) {
  const here = tabs.find((t) => t.active);
  if (!newTab && here) void window.mobius.browser.navigate(here.id, url); else void window.mobius.browser.open(url);
}

/**
 * History, in the tabs panel in place of the tabs (Ctrl+H, as in Chrome and Edge; Escape or Tabs goes back): a search,
 * then the pages visited under Today, Yesterday and each earlier day. A click goes there in the tab open, a middle-click
 * opens a new tab; right-click to copy the address or remove the page; Clear history asks first.
 */
function HistoryList({ tabs, onClose }: { tabs: readonly BrowserTabState[]; onClose: () => void }) {
  const history = useHistory(true);
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState<{ entry: HistoryEntry; x: number; y: number } | null>(null);
  const [clearing, setClearing] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => { field.current?.focus(); }, []);
  const days = historyByDay(history.entries, new Date(), query);
  const closed = useClosedTabs().filter((c) => sidebarMatch(query, c.title, c.url) && !tabs.some((t) => t.url === c.url)).slice(0, query ? 25 : 10);
  return (
    <div className="browser-side browser-history" onKeyDown={(e) => { if (e.key === 'Escape' && !menu && !clearing) { e.preventDefault(); if (query) setQuery(''); else onClose(); } }}>
      <div className="space-head">
        <button type="button" className="space-name history-back" aria-label="History, back to tabs" title="Back to tabs (Escape)" onClick={onClose}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m10 4-4 4 4 4" /></svg>History
        </button>
      </div>
      <label className="space-search">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M7 2.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zM10.3 10.3 13.5 13.5" /></svg>
        <input ref={field} type="search" aria-label="Search history" placeholder="Search history" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <div className="tab-lists">
        {!history.enabled && history.entries.length === 0 && <p className="tabs-empty">History is off. Turn it on in Settings › Browser.</p>}
        {closed.length > 0 && (
          <section className="ui-side-section">
            <div className="side-head"><span className="side-title">Recently closed</span></div>
            <ul className="tabs" role="list" aria-label="Recently closed">
              {closed.map((c) => (
                <li key={`${c.url}|${c.closed}`} className="tab">
                  <button type="button" className="tab-main history-row" title={`Open again: ${c.title || hostOf(c.url)}\n${c.url}`}
                    onClick={() => { setClosed(closedTabs.filter((x) => x !== c)); void window.mobius.browser.open(c.url); }}>
                    <SiteChip url={c.url} />
                    <span className="tab-title">{c.title || hostOf(c.url)}</span>
                    <span className="history-when">{c.cleared ? 'Cleared by Today' : timeLabel(c.closed)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {history.enabled && days.length === 0 && closed.length === 0 && <p className="tabs-empty">{query ? 'Nothing matches.' : 'No pages visited yet.'}</p>}
        {days.map((d) => (
          <section key={d.label} className="ui-side-section">
            <div className="side-head"><span className="side-title">{d.label}</span></div>
            <ul className="tabs" role="list" aria-label={`Visited ${d.label === 'Today' || d.label === 'Yesterday' ? d.label.toLowerCase() : `on ${d.label}`}`}>
              {d.entries.map((e) => (
                <li key={`${e.url}|${e.visited}`} className="tab">
                  <button type="button" className="tab-main history-row" title={`${e.title || hostOf(e.url)}\n${e.url}`}
                    onClick={() => visit(e.url, tabs)} onAuxClick={(ev) => { if (ev.button === 1) { ev.preventDefault(); visit(e.url, tabs, true); } }}
                    onContextMenu={(ev) => { ev.preventDefault(); setMenu({ entry: e, x: ev.clientX, y: ev.clientY }); }}
                    onKeyDown={(ev) => { if (ev.key === 'Delete') { ev.preventDefault(); window.mobius.history.remove(e.url); } }}>
                    <SiteChip url={e.url} />
                    <span className="tab-title">{e.title || hostOf(e.url)}</span>
                    <span className="history-when">{timeLabel(e.visited)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      {(history.entries.length > 0 || closed.length > 0) && (
        <div className="tabs-foot history-foot">
          <button type="button" className="today-clear" onClick={() => setClearing(true)}>Clear history…</button>
        </div>
      )}
      {menu && <PointMenu x={menu.x} y={menu.y} label={menu.entry.title || hostOf(menu.entry.url)} onClose={() => setMenu(null)} entries={[
        { label: 'Open', run: () => visit(menu.entry.url, tabs) },
        { label: 'Open in new tab', run: () => visit(menu.entry.url, tabs, true) },
        { label: 'Copy address', run: () => void navigator.clipboard?.writeText(menu.entry.url).catch(() => undefined) },
        { label: 'Remove from history', keys: 'Delete', danger: true, separated: true, run: () => window.mobius.history.remove(menu.entry.url) },
      ]} />}
      <Confirm open={clearing} title="Clear all browsing history?" description="Every page you visited, and the list of recently closed tabs, is forgotten on this computer. Open tabs, bookmarks and Read later stay." action="Clear history"
        onCancel={() => setClearing(false)} onConfirm={() => { setClearing(false); window.mobius.history.clear(); setClosed([]); }} />
    </div>
  );
}

function useBookmarks(): BookmarkEntry[] {
  const [list, setList] = useState<BookmarkEntry[]>([]);
  useEffect(() => {
    let live = true;
    const load = () => void window.mobius.bookmarks.get('').then((b) => { if (live) setList(b); }).catch(() => {});
    load();
    const off = window.mobius.bookmarks.onChanged(load);
    return () => { live = false; off(); };
  }, []);
  return list;
}

/** A page that may read as an article: web, and somewhere down a site rather than its home or a search. */
export function isArticleLike(url: string): boolean {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return false;
    const path = u.pathname.replace(/\/+$/, '');
    if (!path || /\/(search|results)$/i.test(path)) return false;
    return path.split('/').filter(Boolean).some((part) => part.length >= 6 || /\d{4}/.test(part));
  } catch { return false; }
}

export interface BrowserChromeProps {
  active: BrowserTabState | undefined;
  saved: boolean;
  selectionMenu: boolean;
  setSelectionMenu: (update: boolean | ((open: boolean) => boolean)) => void;
  /** A picture of the page covers it, so the selection menu can sit over it. */
  selectionReady: boolean;
  onSelection: (action: WebSelectionAction) => void;
  clipTo: string;
  clipPages: ClipPage[];
  onClipTo: (path: string) => void;
  address: RefObject<HTMLInputElement | null>;
  draft: string | null;
  setDraft: (draft: string | null) => void;
  notice: string;
  setNotice: (notice: string) => void;
  onSubmit: (event: FormEvent) => void;
  /** Whether the address bar's suggestions are showing: the page is covered by a picture of it meanwhile, since the
   * native page is drawn over everything below the toolbar. */
  onSuggesting: (open: boolean) => void;
  findOpen: boolean;
  finding: number;
  onCloseFind: () => void;
  /** Read: keeps the page in Read later and shows it in reader mode, as Safari's Reader button. */
  onRead?: () => void;
  /** In reader mode now: the Reader button shows pressed, and goes back to the page. */
  reading?: boolean;
  /** The address to show instead of the tab's: the article's own while reading. */
  shownUrl?: string | null;
}

/**
 * The Browser's own keys, as in every browser: Alt+Left and Alt+Right go back and forward, Ctrl+R reloads (instead of
 * reloading Mobius itself), Ctrl+Shift+T reopens the tab closed last, Ctrl+D bookmarks the page and Ctrl+Tab (or
 * Ctrl+Page Down) and Ctrl+Shift+Tab (or Ctrl+Page Up) step through the tabs. Only while the Browser shows.
 */
function useBrowserKeys(active: BrowserTabState | undefined, say: (notice: string) => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat) return;
      const mod = e.ctrlKey || e.metaKey;
      const editing = (e.target as Element | null)?.closest?.('input, textarea, select, [contenteditable="true"]');
      const api = window.mobius.browser;
      if (e.altKey && !mod && !e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        if (editing || !active) return;
        e.preventDefault();
        if (e.key === 'ArrowLeft') { if (active.canGoBack) api.back(active.id); } else if (active.canGoForward) api.forward(active.id);
      } else if (mod && !e.altKey && !e.shiftKey && e.code === 'KeyR') {
        e.preventDefault();
        if (active?.url) api.reload(active.id);
      } else if (mod && e.shiftKey && !e.altKey && e.code === 'KeyC' && !editing) {
        // Ctrl+Shift+C copies the page's address, as Arc's Copy URL does, and says so.
        if (!active || !/^https?:/.test(active.url)) return;
        e.preventDefault();
        void navigator.clipboard?.writeText(active.url).then(() => say('Copied the link')).catch(() => say('The link could not be copied'));
      } else if (mod && e.shiftKey && !e.altKey && e.code === 'Equal' && api.showBeside && window.mobius.surface.setBesideBounds) {
        // Ctrl+Shift+= splits the page with the tab seen last, as Arc's Add Split View; again ends it.
        e.preventDefault();
        void api.getState().then((s) => {
          if (s?.split) { api.showBeside?.(null); return; }
          const other = besideFor(s?.tabs ?? [], s?.tabs.find((t) => t.active));
          if (other) api.showBeside?.(other.id); else say('Open another tab to split with');
        });
      } else if (mod && !e.shiftKey && !e.altKey && (e.code === 'Equal' || e.code === 'Minus' || e.code === 'Digit0' || e.code === 'NumpadAdd' || e.code === 'NumpadSubtract' || e.code === 'Numpad0') && api.setZoom) {
        // Ctrl+= and Ctrl+- zoom the page through Chrome's steps, Ctrl+0 goes back to 100%; kept for the site.
        if (!active || !/^https?:/.test(active.url)) return;
        e.preventDefault();
        const z = e.code === 'Equal' || e.code === 'NumpadAdd' ? stepZoom(active.zoom ?? zoomFor(active.url), 1) : e.code === 'Minus' || e.code === 'NumpadSubtract' ? stepZoom(active.zoom ?? zoomFor(active.url), -1) : 1;
        setSiteZoom(active.url, z);
        say(`Zoom ${Math.round(z * 100)}%`);
      } else if (mod && e.shiftKey && !e.altKey && e.code === 'KeyT') {
        e.preventDefault();
        void api.reopenClosed?.();
      } else if (mod && !e.altKey && !e.shiftKey && e.code === 'KeyD') {
        e.preventDefault();
        if (active && /^https?:/.test(active.url)) void window.mobius.bookmarks.toggle();
      } else if (e.ctrlKey && !e.altKey && !e.metaKey && (e.key === 'Tab' || ((e.key === 'PageDown' || e.key === 'PageUp') && !e.shiftKey))) {
        e.preventDefault();
        const step = e.key === 'PageUp' || (e.key === 'Tab' && e.shiftKey) ? -1 : 1;
        void api.getState().then((s) => {
          const id = nextTabId(inSpace(spaces, s?.tabs ?? []), step);
          if (id) api.activate(id);
        }).catch(() => {});
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);
}

/** Back, forward, reload, bookmark, the selection menu and the address bar, with Find under them. */
export function BrowserChrome({ onRead, reading = false, shownUrl = null, active, saved, selectionMenu, setSelectionMenu, selectionReady, onSelection, clipTo, clipPages, onClipTo, address, draft, setDraft, notice, setNotice, onSubmit, onSuggesting, findOpen, finding, onCloseFind }: BrowserChromeProps) {
  useBrowserKeys(active, setNotice);
  // In the toolbar's middle, as the frame has every app's own controls (ui/AppFrame).
  return (
  <ToolbarControls label="Browser">
  <div className="strip-middle browser-chrome">
        <div className="cap-group">
          <button type="button" className="strip-btn" aria-label="Back" title="Back (Alt+Left)" disabled={!active?.canGoBack} onClick={() => active && window.mobius.browser.back(active.id)}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M12 4 6 10l6 6" /></svg>
          </button>
          <button type="button" className="strip-btn" aria-label="Forward" title="Forward (Alt+Right)" disabled={!active?.canGoForward} onClick={() => active && window.mobius.browser.forward(active.id)}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m8 4 6 6-6 6" /></svg>
          </button>
          <button type="button" className="strip-btn" aria-label="Reload" title="Reload (Ctrl+R)" disabled={!active} onClick={() => active && window.mobius.browser.reload(active.id)}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M16 10a6 6 0 1 1-1.8-4.3M16 3v4h-4" /></svg>
          </button>
        </div>
        <AddressBar active={active} shownUrl={shownUrl} address={address} draft={draft} setDraft={setDraft} setNotice={setNotice} onSubmit={onSubmit} onSuggesting={onSuggesting}
          star={(
            // The star inside the address's end, as Chrome and Arc keep it.
            <button type="button" className="strip-btn address-star" aria-pressed={saved} aria-label={saved ? 'Remove bookmark' : 'Bookmark this page'} title={saved ? 'Remove bookmark (Ctrl+D)' : 'Bookmark this page (Ctrl+D)'} disabled={!active || !/^https?:/.test(active.url)} onClick={() => void window.mobius.bookmarks.toggle()}>
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3l2.1 4.4 4.9.6-3.6 3.4.9 4.8L10 13.8 5.7 16.2l.9-4.8L3 8l4.9-.6z" /></svg>
            </button>
          )} />
        <div className="cap-group" role="group" aria-label="This page">
          {/* Read, before the star, on pages that look like an article (a page down a site, not its home page). */}
          {onRead && active && (reading || isArticleLike(active.url)) && (
            <button type="button" className="strip-btn" aria-pressed={reading} aria-label={reading ? 'Back to the page' : 'Read in reader mode'} title={reading ? 'Back to the page' : 'Reader mode: just the words, kept in Read later'} onClick={onRead}>
              {TOOL_ICONS.reader}
            </button>
          )}
        </div>
        {/* Selected text… is in ⋯ (the Browser menu); its menu drops from the end of the address. */}
        <div className="selection-menu-wrap">
          {selectionMenu && selectionReady && (
            <SelectionMenu onClose={() => setSelectionMenu(false)} onChoose={onSelection} clipTo={clipTo} pages={clipPages} onClipTo={onClipTo} />
          )}
        </div>
        {notice && <span className="notice" role="status">{notice}</span>}
        {findOpen && active && <FindBar key={active.id} tabId={active.id} focusToken={finding} onClose={onCloseFind} />}
      </div>
  </ToolbarControls>
  );
}

const SUGGESTION_ICON = {
  tab: 'M3 5h14v10H3zM3 8h14',
  bookmark: 'M10 3l2.1 4.4 4.9.6-3.6 3.4.9 4.8L10 13.8 5.7 16.2l.9-4.8L3 8l4.9-.6z',
  history: 'M10 4a6 6 0 1 1-6 6M10 7v3l2 2',
} as const;

/**
 * The address bar, as Safari's: at rest it shows a lock and the site's name; once clicked it holds the whole address to
 * edit, and suggests open tabs, bookmarks and pages from history as you type. A suggestion is only taken when it is
 * picked with the arrows or the pointer; otherwise Enter goes, or asks, as before.
 */
function AddressBar({ active, shownUrl, address, draft, setDraft, setNotice, onSubmit, onSuggesting, star }: Pick<BrowserChromeProps, 'active' | 'address' | 'draft' | 'setDraft' | 'setNotice' | 'onSubmit' | 'onSuggesting'> & { star?: ReactNode; shownUrl?: string | null }) {
  // While reading, the address is the article's own, never the tab's behind it.
  const url = shownUrl ?? active?.url ?? '';
  const [list, setList] = useState<Suggestion[]>([]);
  const [lit, setLit] = useState(-1);
  const known = useRef<{ tabs: BrowserTabState[]; bookmarks: BookmarkEntry[]; history: HistoryEntry[] }>({ tabs: [], bookmarks: [], history: [] });
  const editing = draft !== null;
  const parts = !editing && url ? addressParts(url) : null;

  const learn = () => {
    void window.mobius.browser.getState().then((s) => { known.current.tabs = s?.tabs ?? []; }).catch(() => {});
    void window.mobius.bookmarks.get('').then((b) => { known.current.bookmarks = b; }).catch(() => {});
    void window.mobius.history.get('').then((h) => { known.current.history = h.enabled ? h.entries.slice(0, 500) : []; }).catch(() => {});
  };
  const suggest = (text: string) => {
    const { tabs, bookmarks, history } = known.current;
    setList(text !== url ? suggestionsFor(text, tabs, bookmarks, history) : []);
    setLit(-1);
  };
  const done = () => { setList([]); setLit(-1); setDraft(null); address.current?.blur(); };
  const pick = (s: Suggestion) => {
    if (s.kind === 'tab') window.mobius.browser.activate(s.id);
    else if (active) void window.mobius.browser.navigate(active.id, s.url);
    else void window.mobius.browser.open(s.url);
    done();
  };

  const showing = list.length > 0;
  useEffect(() => { onSuggesting(showing); }, [showing, onSuggesting]);
  useEffect(() => () => onSuggesting(false), [onSuggesting]);

  return (
    <form className="address" onSubmit={(e) => { if (lit >= 0 && list[lit]) { e.preventDefault(); pick(list[lit]!); return; } setList([]); onSubmit(e); }} data-editing={editing || undefined} data-loading={active?.loading || undefined}>
      <input
        ref={address}
        type="text"
        aria-label="Address or question"
        placeholder="Search, enter an address, or ask"
        spellCheck={false}
        autoComplete="off"
        aria-autocomplete="list"
        aria-controls={list.length > 0 ? 'address-suggestions' : undefined}
        aria-activedescendant={lit >= 0 ? `address-suggestion-${lit}` : undefined}
        value={draft ?? url}
        onChange={(event) => { setDraft(event.target.value); setNotice(''); suggest(event.target.value); }}
        // From the moment it is focused the text is the person's draft: a page finishing loading meanwhile cannot change it under their typing.
        onFocus={(event) => { learn(); setDraft(event.target.value); event.target.select(); }}
        onBlur={() => { setList([]); setLit(-1); setDraft(null); }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && list.length > 0) { event.preventDefault(); setLit((i) => (i + 1) % list.length); }
          else if (event.key === 'ArrowUp' && list.length > 0) { event.preventDefault(); setLit((i) => (i <= 0 ? list.length - 1 : i - 1)); }
          else if (event.key === 'Escape') {
            event.preventDefault();
            if (list.length > 0) { setList([]); setLit(-1); }
            else if (draft !== null && draft !== url) { setDraft(url); afterPaint(() => address.current?.select()); }
            else done();
          }
        }}
      />
      {parts && (
        <span className="address-rest" aria-hidden="true">
          {parts.secure && <svg viewBox="0 0 20 20"><path d="M6 9V7a4 4 0 0 1 8 0v2M5 9h10v8H5z" /></svg>}
          <span className="address-host">{parts.host}</span>
          {parts.path && <span className="address-path">/ {parts.path}</span>}
        </span>
      )}
      {!editing && active?.zoom !== undefined && Math.abs(active.zoom - 1) > 0.001 && (
        // The zoom, as Chrome's: shown only when the page is not at 100%; a click goes back to it.
        <button type="button" className="address-zoom" aria-label={`Zoom ${Math.round(active.zoom * 100)}%, reset to 100%`} title="Reset zoom (Ctrl+0)" onClick={() => setSiteZoom(active.url, 1)}>{Math.round(active.zoom * 100)}%</button>
      )}
      {!editing && star}
      {active?.loading && <span className="address-progress" role="status" aria-label="Loading" />}
      {list.length > 0 && (
        <ul className="address-suggestions" id="address-suggestions" role="listbox" aria-label="Suggestions">
          {list.map((s, i) => (
            <li key={`${s.kind}:${s.url}`} id={`address-suggestion-${i}`} role="option" aria-selected={i === lit} className="address-suggestion" onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setLit(i)} onClick={() => pick(s)}>
              <svg viewBox="0 0 20 20" aria-hidden="true" data-kind={s.kind}><path d={SUGGESTION_ICON[s.kind]} /></svg>
              <span className="address-suggestion-text">
                <span className="address-suggestion-title">{s.title}</span>
                <span className="address-suggestion-url">{s.kind === 'tab' ? `Switch to tab · ${hostOf(s.url)}` : s.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}

/** Split view's share of the page panel for the first page, kept across restarts. */
const SPLIT_KEY = 'mobius.browser.split';
const readRatio = (): number => { try { const v = Number(localStorage.getItem(SPLIT_KEY)); return v >= 0.2 && v <= 0.8 ? v : 0.5; } catch { return 0.5; } };

/**
 * Split view, as Arc's: two pages side by side in the page panel, each in its own slot, with a divider to drag (or
 * arrow keys on it) and, above each, its title and End split. The page clicked last is the active tab (the address
 * bar's); the places stay put. Ends when either page closes or a tab outside the split is chosen.
 */
function SplitPage({ split, tabs, hidden }: { split: { first: string; second: string }; tabs: readonly BrowserTabState[]; hidden: boolean }) {
  const [ratio, setRatio] = useState(readRatio);
  const box = useRef<HTMLDivElement>(null);
  const keep = (r: number) => { const v = Math.min(0.8, Math.max(0.2, r)); setRatio(v); try { localStorage.setItem(SPLIT_KEY, String(v)); } catch { /* for this window */ } };
  const drag = (e: React.PointerEvent) => {
    const el = box.current;
    if (!el) return;
    e.preventDefault();
    const { left, width } = el.getBoundingClientRect();
    const move = (ev: PointerEvent) => keep((ev.clientX - left) / width);
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const head = (id: string) => {
    const tab = tabs.find((t) => t.id === id);
    return (
      <div className="browser-split-head" data-active={tab?.active || undefined}>
        <button type="button" className="browser-split-title" title={tab?.url} aria-current={tab?.active ? 'page' : undefined} onClick={() => window.mobius.browser.activate(id)}>
          <SiteChip url={tab?.url ?? ''} icon={tab?.icon ?? null} /><span className="browser-split-name">{tab?.title || 'New tab'}</span>
        </button>
        <button type="button" className="browser-split-end" aria-label={`End split view, keep ${tab?.title || 'this page'}`} title="End split view (Ctrl+Shift+=)" onClick={() => { window.mobius.browser.activate(id); window.mobius.browser.showBeside?.(null); }}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>
        </button>
      </div>
    );
  };
  return (
    <div ref={box} className="browser-split-page" style={{ '--split': `${ratio * 100}%` } as React.CSSProperties}>
      <div className="browser-split-half" data-place="first">{head(split.first)}<div className="browser-split-body"><SurfaceSlot hidden={hidden} /></div></div>
      <div className="browser-split-divider" role="separator" aria-orientation="vertical" aria-label="Resize split view" aria-valuemin={20} aria-valuemax={80} aria-valuenow={Math.round(ratio * 100)} tabIndex={0}
        onPointerDown={drag} onDoubleClick={() => keep(0.5)}
        onKeyDown={(e) => {
          const to = e.key === 'ArrowLeft' ? ratio - 0.05 : e.key === 'ArrowRight' ? ratio + 0.05 : e.key === 'Home' ? 0.2 : e.key === 'End' ? 0.8 : null;
          if (to !== null) { e.preventDefault(); keep(to); }
        }} />
      <div className="browser-split-half" data-place="second">{head(split.second)}<div className="browser-split-body"><SurfaceSlot hidden={hidden} beside /></div></div>
    </div>
  );
}

/** A new tab shows Mobius's own start page; otherwise the native page sits in its slot (two, side by side, in split view). */
export function BrowserPage({ onStartPage, hidden, onOpen, onRead, split = null, tabs = [] }: { onStartPage: boolean; hidden: boolean; onOpen: (url: string) => void; onRead: (path: string, title: string) => void; split?: { first: string; second: string } | null; tabs?: readonly BrowserTabState[] }) {
  if (split && window.mobius.surface.setBesideBounds) return <SplitPage split={split} tabs={tabs} hidden={hidden} />;
  return (
    <>
      {onStartPage && <StartPage onOpen={onOpen} onRead={onRead} />}
      <SurfaceSlot hidden={hidden} />
    </>
  );
}

/** The tab to put beside the active one: the one seen last before it in this space, else the next. */
function besideFor(tabs: readonly BrowserTabState[], active: BrowserTabState | undefined): BrowserTabState | undefined {
  const mine = inSpace(spaces, tabs).filter((t) => t.id !== active?.id && /^https?:/.test(t.url));
  return mine.sort((a, b) => (spaces.seen?.[b.id] ?? 0) - (spaces.seen?.[a.id] ?? 0))[0];
}
