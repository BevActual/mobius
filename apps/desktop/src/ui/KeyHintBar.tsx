import { useEffect, useState } from 'react';
import { KeyCaps } from './Tooltip';

/**
 * The key-hint bar (Instrument): a small bar floating at the bottom of a list view with its four or five most useful
 * keys. Shown by default while the keys are new; it hides itself once they have been used a few times, and never
 * shows when Key hints is off in Settings (the shell sets `data-key-hints` on the page).
 */
export interface KeyHint {
  /** The shortcut as shown, such as "E" or "Ctrl+Enter". */
  keys: string;
  /** What it does, in a word or two: "Archive". */
  label: string;
}

/** After this many uses of the bar's keys, it has done its job and stays hidden for that list. */
export const LEARNED_AFTER = 12;
const KEY = 'mobius.keyHints.used.';
const usedOf = (id: string): number => { try { return Number(window.localStorage.getItem(KEY + id)) || 0; } catch { return 0; } };
const keepUsed = (id: string, n: number) => { try { window.localStorage.setItem(KEY + id, String(n)); } catch { /* Not kept. */ } };

/** The last key of a shortcut, as `KeyboardEvent.key` names it ("E" → "e", "Enter" stays). */
export function lastKey(keys: string): string {
  const parts = keys.split('+');
  const last = parts[parts.length - 1] === '' ? '+' : parts[parts.length - 1]!.trim();
  const names: Record<string, string> = { Esc: 'Escape', '←': 'ArrowLeft', '→': 'ArrowRight', '↑': 'ArrowUp', '↓': 'ArrowDown', Space: ' ' };
  const key = names[last] ?? last;
  return key.length === 1 ? key.toLowerCase() : key;
}

const settingOn = () => document.documentElement.dataset.keyHints !== 'off';

export function KeyHintBar({ id, hints, label = 'Keys' }: { id: string; hints: readonly KeyHint[]; label?: string }) {
  const [on, setOn] = useState(settingOn);
  const [used, setUsed] = useState(() => usedOf(id));
  // Settings can turn it off while the list is open.
  useEffect(() => {
    const watch = new MutationObserver(() => setOn(settingOn()));
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-key-hints'] });
    return () => watch.disconnect();
  }, []);
  // Count uses of the bar's keys, typed outside text fields, while the list is open.
  useEffect(() => {
    if (used >= LEARNED_AFTER) return undefined;
    const keys = new Set(hints.map((hint) => lastKey(hint.keys)));
    const press = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      if (!keys.has(key)) return;
      setUsed((n) => { const next = n + 1; keepUsed(id, next); return next; });
    };
    document.addEventListener('keydown', press, true);
    return () => document.removeEventListener('keydown', press, true);
  }, [hints, id, used]);
  if (!on || used >= LEARNED_AFTER || hints.length === 0) return null;
  return (
    <div className="ui-key-hints" role="note" aria-label={label}>
      {hints.slice(0, 5).map((hint) => (
        <span key={hint.keys} className="ui-key-hint"><KeyCaps keys={hint.keys} /><span>{hint.label}</span></span>
      ))}
    </div>
  );
}
