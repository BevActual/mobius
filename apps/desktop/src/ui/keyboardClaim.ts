import { useEffect } from 'react';

/**
 * An app taking the keyboard for itself (Music's piano keys): while a claim is held, the shell's bare-key shortcuts
 * (C for comments, the number keys for Mobius's actions, any shortcut set to a bare key) stand down. Shortcuts with
 * Ctrl, Cmd or Alt, and Escape, still work.
 */
let claims = 0;

/** Whether an app holds the keyboard now. */
export const keyboardClaimed = (): boolean => claims > 0;

/** Whether the shell should leave this key to the app holding the keyboard. */
export function shellStandsDown(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>): boolean {
  return claims > 0 && !event.ctrlKey && !event.metaKey && !event.altKey && event.key !== 'Escape';
}

/** Holds the keyboard while `active` is true (and the component is mounted). */
export function useKeyboardClaim(active: boolean): void {
  useEffect(() => {
    if (!active) return undefined;
    claims += 1;
    return () => { claims -= 1; };
  }, [active]);
}

/** For tests: hold or let go of a claim outside React. */
export const claimKeyboardForTests = (on: boolean): void => { claims = Math.max(0, claims + (on ? 1 : -1)); };
