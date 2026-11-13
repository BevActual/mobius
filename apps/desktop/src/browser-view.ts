import type { BookmarkEntry, BrowserTabState, HistoryEntry } from '@mobius/shared';

/**
 * The Browser's choices, kept apart from the screen so they can be tested: how an address is shown when the bar is not
 * being typed in, what the bar suggests while typing, and where a dragged tab lands.
 */

/** A site's name for showing: the host without `www.`, or the whole text when it is not an address. */
export const hostOf = (url: string): string => { try { return new URL(url).hostname.replace(/^www\./, '') || url; } catch { return url; } };

/** An address as Safari shows it at rest: whether the connection is private, and the site's name alone. */
export function addressParts(url: string): { secure: boolean; host: string } | null {
  if (!url || !/^(https?|file):/i.test(url)) return null;
  try {
    const u = new URL(url);
    if (u.protocol === 'file:') return { secure: false, host: decodeURIComponent(u.pathname.split('/').pop() || 'File') };
    return { secure: u.protocol === 'https:', host: u.hostname.replace(/^www\./, '') };
  } catch {
    return null;
  }
}

/** A steady colour for a site's letter tile, picked from its name so it is the same every time. */
const HUES = [211, 262, 330, 4, 28, 142, 174, 190, 291, 45];
export function tileHue(site: string): number {
  let h = 0;
  for (const ch of site) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return HUES[h % HUES.length]!;
}
/** The letter a site's tile shows. */
export const tileLetter = (site: string): string => (site.replace(/^[^a-z0-9]+/i, '')[0] ?? '?').toUpperCase();

export type Suggestion =
  | { kind: 'tab'; id: string; url: string; title: string }
  | { kind: 'bookmark' | 'history'; url: string; title: string };

/**
 * What the address bar offers for what has been typed: open tabs first (to switch to rather than open twice), then
 * bookmarks, then pages from history, each page once. Matches are on the start of a word of the title or the address.
 */
export function suggestionsFor(text: string, tabs: readonly BrowserTabState[], bookmarks: readonly BookmarkEntry[], history: readonly HistoryEntry[], limit = 6): Suggestion[] {
  const q = text.trim().toLowerCase();
  if (q.length === 0) return [];
  const words = q.split(/\s+/);
  const matches = (title: string, url: string) => {
    const hay = `${title} ${url.replace(/^[a-z]+:\/\/(www\.)?/i, '')}`.toLowerCase();
    return words.every((w) => hay.startsWith(w) || new RegExp(`[^a-z0-9]${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(hay));
  };
  const seen = new Set<string>();
  const out: Suggestion[] = [];
  const add = (s: Suggestion) => {
    const key = s.url.replace(/\/$/, '');
    if (seen.has(key) || out.length >= limit) return;
    seen.add(key);
    out.push(s);
  };
  tabs.filter((t) => !t.active && t.url && matches(t.title, t.url)).forEach((t) => add({ kind: 'tab', id: t.id, url: t.url, title: t.title || hostOf(t.url) }));
  bookmarks.filter((b) => matches(b.title, b.url)).forEach((b) => add({ kind: 'bookmark', url: b.url, title: b.title || hostOf(b.url) }));
  history.filter((h) => matches(h.title, h.url)).forEach((h) => add({ kind: 'history', url: h.url, title: h.title || hostOf(h.url) }));
  return out;
}

/**
 * Where a dragged tab goes when it is let go over another tab, before or after it. Dropping among the pinned tabs pins
 * it and among the others unpins it; `index` is its place in the list once it has been taken out, as `moveTab` wants.
 */
export function dropPlan(tabs: readonly BrowserTabState[], dragId: string, overId: string, after: boolean): { pinned: boolean; index: number } | null {
  if (dragId === overId) return null;
  const dragged = tabs.find((t) => t.id === dragId);
  const over = tabs.find((t) => t.id === overId);
  if (!dragged || !over) return null;
  const pinned = over.pinned === true;
  // The list as it is once the tab is taken out and, if it changes side, put at the start of its new side.
  const rest = tabs.filter((t) => t.id !== dragId);
  const at = rest.findIndex((t) => t.id === overId) + (after ? 1 : 0);
  const was = tabs.findIndex((t) => t.id === dragId);
  const unchanged = (dragged.pinned === true) === pinned && (at === was);
  return unchanged ? null : { pinned, index: at };
}

/** Whether a tab or bookmark matches the sidebar's search: every word in its title or address, any case. */
export function sidebarMatch(query: string, title: string, url: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const text = `${title} ${url.replace(/^https?:\/\/(www\.)?/, '')}`.toLowerCase();
  return words.every((w) => text.includes(w));
}
