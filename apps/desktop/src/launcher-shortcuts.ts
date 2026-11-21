/**
 * Aliases and keys of your own, for the launcher (docs/design/launcher.md, step 7). Any app, place, command, quicklink
 * or snippet can have a short alias ("m" opens Mail: typed alone, it is the top row) and a key of its own (Ctrl+Alt+M
 * opens Mail from anywhere in Mobius). Kept on this computer.
 */
export type ShortcutTarget = { type: 'app' | 'place' | 'command' | 'quicklink' | 'snippet'; ref: string };
export interface Shortcut { target: ShortcutTarget; label: string; alias?: string; key?: string }

const KEY = 'mobius.launcher.shortcuts';
export const MAX_SHORTCUTS = 100;

export const sameTarget = (a: ShortcutTarget, b: ShortcutTarget) => a.type === b.type && a.ref === b.ref;

/** What a launcher row stands for, when it is something that can be called again later; null for found items, tabs and the like. */
export function targetOf(rowId: string): ShortcutTarget | null {
  const take = (prefix: string, type: ShortcutTarget['type']) => (rowId.startsWith(prefix) && rowId.length > prefix.length ? { type, ref: rowId.slice(prefix.length) } : null);
  if (rowId === 'grid-more' || rowId === 'all-apps') return null;
  // The alias row itself: "alias-app-mail".
  const own = rowId.match(/^alias-(app|place|command|quicklink|snippet)-(.+)$/);
  if (own) return { type: own[1] as ShortcutTarget['type'], ref: own[2]! };
  return take('app-', 'app') ?? take('pin-', 'app') ?? take('grid-', 'app') ?? take('place-', 'place') ?? take('cmd-', 'command') ?? take('ql-', 'quicklink') ?? take('snip-', 'snippet');
}

export function readShortcuts(): Shortcut[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(KEY) ?? '[]') as unknown;
    if (!Array.isArray(v)) return [];
    return v.filter((s): s is Shortcut => !!s && typeof s === 'object' && typeof s.label === 'string' && !!s.target && typeof s.target.type === 'string' && typeof s.target.ref === 'string').slice(0, MAX_SHORTCUTS);
  } catch { return []; }
}
export function writeShortcuts(list: readonly Shortcut[]): void {
  try { window.localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* Not kept. */ }
}

/** An alias is one short word: letters, numbers and a few marks, at most 12. */
export const cleanAlias = (typed: string): string | null => {
  const a = typed.trim().toLowerCase();
  return /^[\p{L}\p{N}._-]{1,12}$/u.test(a) ? a : null;
};

function put(list: readonly Shortcut[], target: ShortcutTarget, label: string, change: Partial<Shortcut>, clash: (s: Shortcut) => Shortcut): Shortcut[] {
  const others = list.filter((s) => !sameTarget(s.target, target)).map(clash);
  const was = list.find((s) => sameTarget(s.target, target));
  const next: Shortcut = { ...was, target, label, ...change };
  return [next, ...others].filter((s) => s.alias || s.key).slice(0, MAX_SHORTCUTS);
}

/** Gives the target this alias, taking it from anything that had it. `null` removes the target's alias. */
export function withAlias(list: readonly Shortcut[], target: ShortcutTarget, label: string, alias: string | null): Shortcut[] {
  return put(list, target, label, { alias: alias ?? undefined }, (s) => (alias && s.alias === alias ? { ...s, alias: undefined } : s));
}
/** Gives the target this key, taking it from anything that had it. `null` removes the target's key. */
export function withKey(list: readonly Shortcut[], target: ShortcutTarget, label: string, key: string | null): Shortcut[] {
  return put(list, target, label, { key: key ?? undefined }, (s) => (key && s.key === key ? { ...s, key: undefined } : s));
}

export const aliasHit = (list: readonly Shortcut[], typed: string): Shortcut | null => {
  const a = typed.trim().toLowerCase();
  return a ? list.find((s) => s.alias === a) ?? null : null;
};
export const shortcutFor = (list: readonly Shortcut[], target: ShortcutTarget | null): Shortcut | undefined => (target ? list.find((s) => sameTarget(s.target, target)) : undefined);

/** Keys Mobius already uses with two modifiers, so they can't be taken. */
const TAKEN = new Set(['Ctrl+Shift+Space', 'Ctrl+Alt+Shift+H', 'Ctrl+Shift+Tab', 'Ctrl+Shift+Z', 'Ctrl+Shift+K', 'Ctrl+Shift+P']);

/**
 * The key pressed, written as it is shown ("Ctrl+Alt+M"), when it can be a key of your own: Ctrl or Alt with at least
 * one more modifier and a letter, number or F-key, so it can't steal typing or an app's own Ctrl+letter. Else null.
 */
export function comboOf(e: { key: string; code?: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }): string | null {
  const mods = [e.ctrlKey || e.metaKey ? 'Ctrl' : '', e.altKey ? 'Alt' : '', e.shiftKey ? 'Shift' : ''].filter(Boolean);
  if (!(e.ctrlKey || e.metaKey || e.altKey) || mods.length < 2) return null;
  // The code names the key itself, so Shift and Alt don't change what it is called ("!" is still 1).
  const fromCode = e.code?.match(/^(?:Key([A-Z])|Digit(\d)|(F\d{1,2}))$/);
  const name = fromCode ? (fromCode[1] ?? fromCode[2] ?? fromCode[3])! : /^([a-z0-9]|F\d{1,2})$/i.test(e.key) ? e.key.toUpperCase() : null;
  if (!name) return null;
  const combo = [...mods, name].join('+');
  return TAKEN.has(combo) ? null : combo;
}

export const keyHit = (list: readonly Shortcut[], combo: string | null): Shortcut | null => (combo ? list.find((s) => s.key === combo) ?? null : null);
