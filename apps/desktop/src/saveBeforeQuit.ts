/**
 * What must be written before Mobius quits: each editor that saves a moment after typing registers how to save now,
 * and quitting (the tray's Quit, or the installer replacing Mobius) waits for all of them.
 */
const savers = new Set<() => Promise<unknown>>();

/** Registers a way to save now; gives back the call that removes it. */
export function saveBeforeQuit(saveNow: () => Promise<unknown>): () => void {
  savers.add(saveNow);
  return () => { savers.delete(saveNow); };
}

/** Saves everything waiting to be written. A save that fails doesn't stop the others. */
export async function saveAll(): Promise<void> {
  await Promise.allSettled([...savers].map((save) => save()));
}

/**
 * Typing not yet written, saved now: before the person hands a task back to Mobius, so what they typed while they had
 * control is on disk inside their stretch of the turn, and never counted as Mobius's change.
 */
const typed = new Set<() => Promise<unknown>>();
export function saveTypedOnHandBack(saveNow: () => Promise<unknown>): () => void {
  typed.add(saveNow);
  return () => { typed.delete(saveNow); };
}
export async function saveTyped(): Promise<void> {
  await Promise.allSettled([...typed].map((save) => save()));
}
