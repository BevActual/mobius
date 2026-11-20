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
