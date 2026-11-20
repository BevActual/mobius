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
