/**
 * Commands you save yourself (docs/design/launcher.md): a question asked about a selection, kept under a name, to run
 * on the next selection as the AI commands do. Kept on this computer.
 */
export interface SavedCommand {
  id: string;
  label: string;
  instruction: string;
}

const KEY = 'mobius.launcher.commands';
export const MAX_SAVED = 30;

export function readSaved(): SavedCommand[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((c): c is SavedCommand => !!c && typeof c.id === 'string' && typeof c.label === 'string' && typeof c.instruction === 'string') : [];
  } catch { return []; }
}

export function writeSaved(list: readonly SavedCommand[]): void {
  try { window.localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* Not kept. */ }
}

/** The name a command gets from what was typed: its first line, at most 40 characters, starting with a capital. */
export function commandName(typed: string): string {
  const line = typed.trim().split('\n')[0]!.replace(/[?.!]+$/, '').trim();
  const cut = line.length > 40 ? `${line.slice(0, 39)}…` : line;
  return cut.replace(/^./, (c) => c.toUpperCase());
}

/** Saved first; the same name again replaces the older one. */
export function withSaved(list: readonly SavedCommand[], typed: string): SavedCommand[] {
  const label = commandName(typed);
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  return [{ id, label, instruction: typed.trim() }, ...list.filter((c) => c.label.toLowerCase() !== label.toLowerCase())].slice(0, MAX_SAVED);
}

export const withoutSaved = (list: readonly SavedCommand[], id: string): SavedCommand[] => list.filter((c) => c.id !== id);

/**
 * Quicklinks and snippets (docs/design/launcher.md), kept on this computer like saved commands.
 * A quicklink is a named address; "{query}" in it takes what is typed after the name: "maps cafe" opens the map search.
 * A snippet is named text; Enter copies it.
 */
export interface Quicklink { id: string; name: string; url: string }
export interface Snippet { id: string; name: string; text: string }

const LINKS_KEY = 'mobius.launcher.quicklinks';
const SNIPPETS_KEY = 'mobius.launcher.snippets';
export const MAX_KEPT = 100;

function readList<T>(key: string, ok: (v: Record<string, unknown>) => boolean): T[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(key) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((c): c is T => !!c && typeof c === 'object' && ok(c as Record<string, unknown>)) : [];
  } catch { return []; }
}
function writeList(key: string, list: readonly unknown[]) {
  try { window.localStorage.setItem(key, JSON.stringify(list)); } catch { /* Not kept. */ }
}
export const readQuicklinks = () => readList<Quicklink>(LINKS_KEY, (c) => typeof c.id === 'string' && typeof c.name === 'string' && typeof c.url === 'string');
export const writeQuicklinks = (list: readonly Quicklink[]) => writeList(LINKS_KEY, list);
export const readSnippets = () => readList<Snippet>(SNIPPETS_KEY, (c) => typeof c.id === 'string' && typeof c.name === 'string' && typeof c.text === 'string');
export const writeSnippets = (list: readonly Snippet[]) => writeList(SNIPPETS_KEY, list);

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
/** Kept newest first; the same name again replaces the older one. */
export function keepNamed<T extends { id: string; name: string }>(list: readonly T[], item: Omit<T, 'id'>): T[] {
  return [{ ...item, id: newId() } as T, ...list.filter((c) => c.name.toLowerCase() !== item.name.toLowerCase())].slice(0, MAX_KEPT);
}

const URLISH = /^(https?:\/\/\S+|[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?)$/i;

/** "quicklink maps https://maps.example/?q={query}" or "snippet sig: Best, Andrew": what typing it would create. */
export function parseCreate(typed: string): { kind: 'quicklink'; name: string; url: string } | { kind: 'snippet'; name: string; text: string } | null {
  const t = typed.trim();
  const link = /^quicklink\s+(.+?)\s+(\S+)$/i.exec(t);
  if (link && URLISH.test(link[2]!)) return { kind: 'quicklink', name: link[1]!.trim(), url: /^https?:\/\//i.test(link[2]!) ? link[2]! : `https://${link[2]!}` };
  const snip = /^snippet\s+([^:]+?)\s*:\s*([\s\S]+)$/i.exec(t);
  if (snip) return { kind: 'snippet', name: snip[1]!.trim(), text: snip[2]!.trim() };
  return null;
}

/** The quicklink that what is typed calls: its name first, then what goes in "{query}". */
export function callQuicklink(links: readonly Quicklink[], typed: string): { link: Quicklink; rest: string; url: string } | null {
  const t = typed.trim().toLowerCase();
  for (const link of links) {
    const name = link.name.toLowerCase();
    if (t !== name && !t.startsWith(`${name} `)) continue;
    const rest = typed.trim().slice(link.name.length).trim();
    if (link.url.includes('{query}')) return { link, rest, url: link.url.split('{query}').join(encodeURIComponent(rest)) };
    return { link, rest: '', url: link.url };
  }
  return null;
}
