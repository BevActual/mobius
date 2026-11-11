import type { KeyPress } from '@mobius/shared';

/**
 * Shortcuts pressed while the window is still reading the person's saved ones. They are kept, then answered with the saved
 * bindings once those are known: a press is never lost, and a key the person moved never reaches its old default.
 */
export interface EarlyPress extends KeyPress { at: number }

/** How long a press made before the shortcuts were ready still counts, and how many are kept. */
export const EARLY_KEEP_MS = 3000;
export const EARLY_KEEP = 5;

/** Only presses that could be a shortcut: with Ctrl, Cmd or Alt. Typing is left alone. */
export function couldBeShortcut(press: KeyPress): boolean {
  return press.ctrl || press.meta || press.alt;
}

export function keepEarly(kept: EarlyPress[], press: KeyPress, at: number): EarlyPress[] {
  if (!couldBeShortcut(press)) return kept;
  return [...kept, { ...press, at }].slice(-EARLY_KEEP);
}

/** The kept presses still worth answering now, oldest first. */
export function stillFresh(kept: EarlyPress[], now: number): KeyPress[] {
  return kept.filter((p) => now - p.at <= EARLY_KEEP_MS).map(({ at: _at, ...press }) => press);
}

/** A key press as the shortcuts read it. */
export function pressOf(event: { code: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }): KeyPress {
  return { code: event.code, ctrl: event.ctrlKey, meta: event.metaKey, alt: event.altKey, shift: event.shiftKey };
}

// From the moment the interface loads, before React has drawn anything, presses that could be shortcuts are kept here.
let kept: EarlyPress[] = [];
let keeping = false;
const keep = (event: KeyboardEvent) => {
  kept = keepEarly(kept, pressOf(event), performance.now());
};

/** Start keeping presses: called once, as the interface loads. */
export function startKeepingEarlyKeys(): void {
  if (keeping) return;
  keeping = true;
  window.addEventListener('keydown', keep, true);
}

/** The shortcuts are known: stop keeping, and hand over the presses still worth answering. */
export function takeEarlyKeys(now: number): KeyPress[] {
  if (keeping) {
    window.removeEventListener('keydown', keep, true);
    keeping = false;
  }
  const fresh = stillFresh(kept, now);
  kept = [];
  return fresh;
}
