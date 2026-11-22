import type { BrowserTabState } from '@mobius/shared';

/**
 * Spaces, favourites and Today for the Browser's tabs panel, after Arc (resources.arc.net: "Spaces", "Favorites",
 * "Pinned Tabs", "Archived Tabs"). Each space keeps its own Pinned and Today; favourites are kept across spaces; a
 * tab left in Today unseen for a while is closed, as Arc archives unpinned tabs after 12 hours by default (it stays in
 * History and Ctrl+Shift+T brings it back). Tabs themselves live in the shell; this only says which space each belongs to.
 */

export interface Space { id: string; name: string }
export interface Favourite { url: string; title: string }
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
}

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
    tabSpace[t.id] = sp && known.has(sp) ? sp : s.current;
    seen[t.id] = t.active ? now : (s.seen[t.id] ?? now);
  }
  const active = tabs.find((t) => t.active);
  const current = active ? tabSpace[active.id]! : s.current;
  const last = active && s.last?.[current] !== active.id ? { ...s.last, [current]: active.id } : s.last;
  const same = last === s.last && current === s.current && Object.keys(s.tabSpace).length === ids.size && tabs.every((t) => s.tabSpace[t.id] === tabSpace[t.id] && s.seen[t.id] === seen[t.id]);
  return same ? s : { ...s, current, tabSpace, seen, ...(last ? { last } : {}) };
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
  return { ...s, spaces, tabSpace, current: s.current === id ? to : s.current };
}
export const moveTab = (s: SpacesState, tabId: string, space: string): SpacesState => ({ ...s, tabSpace: { ...s.tabSpace, [tabId]: space } });

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
