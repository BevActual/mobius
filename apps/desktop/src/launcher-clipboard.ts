import { useCallback, useEffect, useState } from 'react';
import type { ClipboardEntry } from '@mobius/shared';

/**
 * Clipboard history in the launcher (docs/design/launcher.md): text copied lately, anywhere on the computer. Off until
 * it is turned on in the launcher; kept in memory only (the last 50), by the desktop app.
 */
export interface LauncherClipboard {
  on: boolean;
  entries: readonly ClipboardEntry[];
  setOn: (on: boolean) => void;
  copy: (text: string) => void;
  clear: () => void;
}

const KEY = 'mobius.launcher.clipboard';

/** "clipboard", "clip" or "cb", with words to look for after it: what to show of the history, or null. */
export function clipboardQuery(typed: string): { words: string } | null {
  const m = /^(?:clipboard|clip|cb)(?:\s+(.*))?$/i.exec(typed.trim());
  return m ? { words: (m[1] ?? '').trim() } : null;
}

/** The entries holding all the words, newest first. */
export function findCopied(entries: readonly ClipboardEntry[], words: string): ClipboardEntry[] {
  const parts = words.toLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter((e) => parts.every((p) => e.text.toLowerCase().includes(p)));
}

/** The history and its switch, from the desktop app; undefined where there is none (the browser preview). */
export function useClipboardHistory(): LauncherClipboard | undefined {
  const api = typeof window === 'undefined' ? undefined : window.mobius?.clipboard;
  const [on, setOnState] = useState(() => { try { return window.localStorage.getItem(KEY) === '1'; } catch { return false; } });
  const [entries, setEntries] = useState<ClipboardEntry[]>([]);
  useEffect(() => {
    if (!api) return;
    let live = true;
    void api.watch(on).then(() => (on ? api.history() : [])).then((list) => { if (live) setEntries(Array.isArray(list) ? list : []); }, () => undefined);
    const off = on ? api.onCopied((entry) => setEntries((was) => [entry, ...was.filter((e) => e.text !== entry.text)].slice(0, 50))) : () => {};
    return () => { live = false; off(); };
  }, [api, on]);
  const setOn = useCallback((next: boolean) => {
    try { window.localStorage.setItem(KEY, next ? '1' : '0'); } catch { /* Not kept. */ }
    setOnState(next);
    if (!next) setEntries([]);
  }, []);
  const copy = useCallback((text: string) => { void api?.copy(text); }, [api]);
  const clear = useCallback(() => { void api?.clear().then(() => setEntries([])); }, [api]);
  return api ? { on, entries, setOn, copy, clear } : undefined;
}
