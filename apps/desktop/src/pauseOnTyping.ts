import { useEffect, useRef } from 'react';
import type { Activity } from './activity';

/** Whether a key press writes into an editable field: a character, Backspace, Delete or Enter, without a shortcut key. */
export function writes(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'isComposing'>, target: EventTarget | null): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  if (!(event.isComposing || event.key.length === 1 || ['Backspace', 'Delete', 'Enter'].includes(event.key))) return false;
  const el = target as (HTMLElement & { readOnly?: boolean; disabled?: boolean; type?: string }) | null;
  if (!el || typeof el.closest !== 'function') return false;
  if (el.isContentEditable) return true;
  if (el.tagName === 'TEXTAREA') return !el.readOnly && !el.disabled;
  if (el.tagName === 'INPUT') return !el.readOnly && !el.disabled && !['checkbox', 'radio', 'button', 'submit', 'range', 'color', 'file'].includes(el.type ?? '');
  return false;
}

/**
 * Whether typing now should pause Mobius: it is working (not waiting, not paused) in the app on screen, `where` being
 * the app its turn last worked in.
 */
export const pausesOnTyping = (activity: Activity | null, where: string | null, app: string): boolean =>
  activity !== null && !activity.needsYou && !activity.paused && (activity.app ?? where) === app;

/**
 * Starting to type in the app Mobius is working in pauses it at once (it takes over), so the two never write over each
 * other; the keystroke itself goes through. Resume, on the working pill or in the panel, carries on.
 */
export function usePauseOnTyping(stage: () => HTMLElement | null, activity: Activity | null, where: string | null, app: string, pause: () => Promise<string | null>, said: (text: string) => void): void {
  const now = useRef({ activity, where, app, pause, said });
  now.current = { activity, where, app, pause, said };
  const asked = useRef(false);
  useEffect(() => { if (!activity || activity.paused) asked.current = false; }, [activity]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const { activity: a, where: at, app: shown } = now.current;
      if (asked.current || !pausesOnTyping(a, at, shown) || !writes(event, event.target)) return;
      const root = stage();
      if (!root || !(event.target instanceof Node) || !root.contains(event.target)) return;
      asked.current = true;
      void now.current.pause().then((problem) => { if (problem) asked.current = false; else now.current.said('Paused Mobius while you type. Resume carries on.'); });
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [stage]);
}
