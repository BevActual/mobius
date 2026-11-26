import type { BrowserTabState } from '@mobius/shared';

/**
 * Spaces, favourites and Today for the Browser's tabs panel, after Arc (resources.arc.net: "Spaces", "Favorites",
 * "Pinned Tabs", "Archived Tabs"). Each space keeps its own Pinned and Today; favourites are kept across spaces; a
 * tab left in Today unseen for a while is closed, as Arc archives unpinned tabs after 12 hours by default (it stays in
 * History and Ctrl+Shift+T brings it back). Tabs themselves live in the shell; this only says which space each belongs to.
 */

export interface Space { id: string; name: string }
export interface Favourite { url: string; title: string }
/** A folder of pinned tabs in one space, as Arc's Folders: opens and closes in place. */
export interface Folder { id: string; name: string; space: string; open: boolean }
export interface SpacesState {
  spaces: Space[];
  current: string;
  /** Tab id → space id. A tab first seen goes to the space showing then. */
  tabSpace: Record<string, string>;
  /** Tab id → when it was last the tab shown, for clearing Today. */
  seen: Record<string, number>;
  favourites: Favourite[];
  /** Space id → the tab shown last there. */
  last?: Record<string, string>;
  /** How long a Today tab may go unseen before it is closed; null: never. */
  clearAfter: number | null;
  /** Folders of pinned tabs, in the order made. */
  folders?: Folder[];
  /** Tab id → folder id, for pinned tabs kept in a folder. */
  tabFolder?: Record<string, string>;
  /** Tab id → its address when last seen, for each tab in a folder: tabs come back with new ids after a restart. */
  folderUrl?: Record<string, string>;
  /** Air Traffic Control, as Arc's: a site whose links open in a new tab go to this space. */
  routes?: Route[];
}
export interface Route { host: string; space: string }

const HOUR = 3_600_000;
export const CLEAR_AFTER = [
  { label: '12 hours', ms: 12 * HOUR },
  { label: 'A day', ms: 24 * HOUR },
  { label: 'A week', ms: 7 * 24 * HOUR },
  { label: 'Never', ms: null },
] as const;
export const MAX_FAVOURITES = 8;

export const initialSpaces = (): SpacesState => ({ spaces: [{ id: 's1', name: 'Personal' }], current: 's1', tabSpace: {}, seen: {}, favourites: [], clearAfter: 12 * HOUR });

/** What was saved, made whole: anything missing or broken falls back to the start. */
export function readSpaces(raw: string | null): SpacesState {
  const start = initialSpaces();
  if (!raw) return start;
  try {
    const v = JSON.parse(raw) as Partial<SpacesState>;
    const spaces = Array.isArray(v.spaces) && v.spaces.length > 0 ? v.spaces.filter((s) => s && typeof s.id === 'string' && typeof s.name === 'string') : start.spaces;
    const current = spaces.some((s) => s.id === v.current) ? v.current! : spaces[0]!.id;
    return {
      spaces,
      current,
      tabSpace: v.tabSpace && typeof v.tabSpace === 'object' ? v.tabSpace : {},
      seen: v.seen && typeof v.seen === 'object' ? v.seen : {},
      ...(v.last && typeof v.last === 'object' ? { last: v.last } : {}),
      favourites: Array.isArray(v.favourites) ? v.favourites.filter((f) => f && typeof f.url === 'string').slice(0, MAX_FAVOURITES) : [],
      clearAfter: v.clearAfter === null || typeof v.clearAfter === 'number' ? v.clearAfter : start.clearAfter,
      ...(Array.isArray(v.folders) ? { folders: v.folders.filter((f) => f && typeof f.id === 'string' && typeof f.name === 'string').map((f) => ({ ...f, space: spaces.some((sp) => sp.id === f.space) ? f.space : current, open: f.open !== false })) } : {}),
      ...(v.tabFolder && typeof v.tabFolder === 'object' ? { tabFolder: v.tabFolder } : {}),
      ...(v.folderUrl && typeof v.folderUrl === 'object' ? { folderUrl: v.folderUrl } : {}),
      ...(Array.isArray(v.routes) ? { routes: v.routes.filter((r) => r && typeof r.host === 'string' && spaces.some((sp) => sp.id === r.space)) } : {}),
    };
  } catch { return start; }
}

/**
 * Brought up to date with the shell's tabs: new tabs join the current space, closed ones are forgotten, the shown tab
 * is marked seen now, and when the shown tab is in another space (picked from the address bar, say) that space shows.
 */
export function syncSpaces(s: SpacesState, tabs: readonly BrowserTabState[], now: number): SpacesState {
  const ids = new Set(tabs.map((t) => t.id));
  const known = new Set(s.spaces.map((sp) => sp.id));
  const tabSpace: Record<string, string> = {};
  const seen: Record<string, number> = {};
  for (const t of tabs) {
    const sp = s.tabSpace[t.id];
    // A tab first seen already on a site with a route (a link opened from another app or page) goes to that space.
    const routed = sp === undefined ? routeFor(s, t.url) : null;
    tabSpace[t.id] = sp && known.has(sp) ? sp : routed ?? s.current;
    seen[t.id] = t.active ? now : (s.seen[t.id] ?? now);
  }
  const active = tabs.find((t) => t.active);
  const current = active ? tabSpace[active.id]! : s.current;
  const last = active && s.last?.[current] !== active.id ? { ...s.last, [current]: active.id } : s.last;
  const { tabFolder: keptFolder, folderUrl } = syncFolders(s, tabs);
  const same = last === s.last && current === s.current && keptFolder === s.tabFolder && folderUrl === s.folderUrl && Object.keys(s.tabSpace).length === ids.size && tabs.every((t) => s.tabSpace[t.id] === tabSpace[t.id] && s.seen[t.id] === seen[t.id]);
  return same ? s : { ...s, current, tabSpace, seen, ...(last ? { last } : {}), ...(keptFolder ? { tabFolder: keptFolder } : {}), ...(folderUrl ? { folderUrl } : {}) };
}

/**
 * Folder places brought up to date: a tab that is gone gives its place to a pinned tab come back at its address (the
 * shell restores pinned tabs with new ids after a restart), else it leaves its folder (an unpinned one is taken out
 * where it is unpinned). Each folder tab's address is kept for next time. Nothing is dropped while there are no tabs yet.
 */
function syncFolders(s: SpacesState, tabs: readonly BrowserTabState[]): Pick<SpacesState, 'tabFolder' | 'folderUrl'> {
  const was = s.tabFolder;
  if (!was || tabs.length === 0) return { tabFolder: was, folderUrl: s.folderUrl };
  const ids = new Set(tabs.map((t) => t.id));
  const next: Record<string, string> = {};
  const lost: { folder: string; url: string }[] = [];
  for (const [id, folder] of Object.entries(was)) {
    if (ids.has(id)) next[id] = folder;
    else if (s.folderUrl?.[id]) lost.push({ folder, url: s.folderUrl[id]! });
  }
  for (const t of tabs) {
    if (!t.pinned || next[t.id]) continue;
    const i = lost.findIndex((l) => l.url === t.url);
    if (i >= 0) { next[t.id] = lost[i]!.folder; lost.splice(i, 1); }
  }
  const urls: Record<string, string> = {};
  for (const t of tabs) if (next[t.id]) urls[t.id] = t.url;
  const sameMap = (a: Record<string, string> | undefined, b: Record<string, string>) => !!a && Object.keys(a).length === Object.keys(b).length && Object.entries(b).every(([k, v]) => a[k] === v);
  return { tabFolder: sameMap(was, next) ? was : next, folderUrl: sameMap(s.folderUrl, urls) ? s.folderUrl : urls };
}

export const inSpace = (s: SpacesState, tabs: readonly BrowserTabState[], space = s.current) => tabs.filter((t) => (s.tabSpace[t.id] ?? s.current) === space);

/** The Today tabs left unseen longer than `clearAfter`: never pinned, never the one shown, never one Mobius is using. */
export function staleTabs(s: SpacesState, tabs: readonly BrowserTabState[], now: number): string[] {
  if (s.clearAfter === null) return [];
  return tabs.filter((t) => !t.pinned && !t.active && !t.driver && now - (s.seen[t.id] ?? now) > s.clearAfter!).map((t) => t.id);
}

/** The tab to show on going to a space: the one seen last there, or none (a new tab is opened). */
export function tabToShow(s: SpacesState, tabs: readonly BrowserTabState[], space: string): string | null {
  const mine = inSpace(s, tabs, space);
  const last = s.last?.[space];
  if (last && mine.some((t) => t.id === last)) return last;
  return mine.reduce<BrowserTabState | null>((best, t) => (!best || (s.seen[t.id] ?? 0) > (s.seen[best.id] ?? 0) ? t : best), null)?.id ?? null;
}

let made = 0;
export function addSpace(s: SpacesState, name: string): SpacesState {
  const id = `s${Date.now().toString(36)}${(made++).toString(36)}`;
  return { ...s, spaces: [...s.spaces, { id, name: name.trim() || `Space ${s.spaces.length + 1}` }], current: id };
}
export const renameSpace = (s: SpacesState, id: string, name: string): SpacesState => ({ ...s, spaces: s.spaces.map((sp) => (sp.id === id && name.trim() ? { ...sp, name: name.trim() } : sp)) });
/** A space removed; its tabs move to the first space left. The last space stays. */
export function removeSpace(s: SpacesState, id: string): SpacesState {
  const spaces = s.spaces.filter((sp) => sp.id !== id);
  if (spaces.length === 0 || spaces.length === s.spaces.length) return s;
  const to = spaces[0]!.id;
  const tabSpace = Object.fromEntries(Object.entries(s.tabSpace).map(([t, sp]) => [t, sp === id ? to : sp]));
  const folders = s.folders?.map((f) => (f.space === id ? { ...f, space: to } : f));
  const routes = s.routes?.filter((r) => r.space !== id);
  return { ...s, spaces, tabSpace, current: s.current === id ? to : s.current, ...(folders ? { folders } : {}), ...(routes ? { routes } : {}) };
}
export const moveTab = (s: SpacesState, tabId: string, space: string): SpacesState => ({ ...s, tabSpace: { ...s.tabSpace, [tabId]: space } });

/** A web address's site, without www. */
export function siteOf(url: string): string {
  try { const u = new URL(url); return /^https?:$/.test(u.protocol) ? u.hostname.replace(/^www\./, '') : ''; } catch { return ''; }
}
/** The space a site's links are sent to, if any: the route for the site or a site it is part of (mail.example.com under example.com). */
export function routeFor(s: SpacesState, url: string): string | null {
  const host = siteOf(url);
  if (!host) return null;
  const hit = (s.routes ?? []).filter((r) => host === r.host || host.endsWith(`.${r.host}`)).sort((a, b) => b.host.length - a.host.length)[0];
  return hit && s.spaces.some((sp) => sp.id === hit.space) ? hit.space : null;
}
/** A site's links sent to a space from now on (one space per site). */
export function addRoute(s: SpacesState, url: string, space: string): SpacesState {
  const host = siteOf(url);
  if (!host) return s;
  return { ...s, routes: [...(s.routes ?? []).filter((r) => r.host !== host), { host, space }] };
}
export const removeRoute = (s: SpacesState, host: string): SpacesState => ({ ...s, routes: (s.routes ?? []).filter((r) => r.host !== host) });

/** The folders of a space, in the order made. */
export const foldersIn = (s: SpacesState, space = s.current) => (s.folders ?? []).filter((f) => f.space === space);
/** A new folder in the current space, open, holding `tabIds` (pinned tabs; the caller pins any that are not). */
export function addFolder(s: SpacesState, name: string, tabIds: readonly string[] = []): SpacesState {
  const id = `f${Date.now().toString(36)}${(made++).toString(36)}`;
  const folder: Folder = { id, name: name.trim() || 'New folder', space: s.current, open: true };
  return { ...s, folders: [...(s.folders ?? []), folder], tabFolder: { ...s.tabFolder, ...Object.fromEntries(tabIds.map((t) => [t, id])) } };
}
export const renameFolder = (s: SpacesState, id: string, name: string): SpacesState => (name.trim() ? { ...s, folders: (s.folders ?? []).map((f) => (f.id === id ? { ...f, name: name.trim() } : f)) } : s);
export const toggleFolder = (s: SpacesState, id: string, open?: boolean): SpacesState => ({ ...s, folders: (s.folders ?? []).map((f) => (f.id === id ? { ...f, open: open ?? !f.open } : f)) });
/** A folder removed; its tabs stay pinned, out of any folder. */
export function removeFolder(s: SpacesState, id: string): SpacesState {
  return { ...s, folders: (s.folders ?? []).filter((f) => f.id !== id), tabFolder: Object.fromEntries(Object.entries(s.tabFolder ?? {}).filter(([, f]) => f !== id)) };
}
/** A tab put in a folder, or taken out of its folder (null). */
export function putInFolder(s: SpacesState, tabId: string, folder: string | null): SpacesState {
  const tabFolder = { ...s.tabFolder };
  if (folder === null) delete tabFolder[tabId]; else tabFolder[tabId] = folder;
  return { ...s, tabFolder };
}

const bare = (url: string) => url.replace(/^https?:\/\/(www\.)?/, '').replace(/[#?].*$/, '').replace(/\/$/, '');
export const isFavourite = (s: SpacesState, url: string) => s.favourites.some((f) => bare(f.url) === bare(url));
export function toggleFavourite(s: SpacesState, fav: Favourite): SpacesState {
  if (isFavourite(s, fav.url)) return { ...s, favourites: s.favourites.filter((f) => bare(f.url) !== bare(fav.url)) };
  if (s.favourites.length >= MAX_FAVOURITES) return s;
  return { ...s, favourites: [...s.favourites, fav] };
}
/** The open tab a favourite is showing in, if any: one on the same site and path, in the current space first. */
export function favouriteTab(s: SpacesState, tabs: readonly BrowserTabState[], url: string): string | null {
  const hit = (t: BrowserTabState) => bare(t.url) === bare(url) || bare(t.url).startsWith(`${bare(url)}/`);
  return (inSpace(s, tabs).find(hit) ?? tabs.find(hit))?.id ?? null;
}

/** A site's chip colour, one of a few muted hues, the same for a site everywhere. */
export function siteHue(host: string): number {
  let h = 0;
  for (const c of host) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 6;
}
