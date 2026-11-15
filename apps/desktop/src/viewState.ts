/**
 * The window's own view state (hidden calendars, the last sheet open, kept turns, pane widths) lives in the web view's
 * storage, which is one per computer, not one per profile. So each profile's is filed away under its set of data when
 * another opens, and brought back when it opens again. A demo reset is a new set of data: it opens as seeded, with
 * nothing hidden and nothing left from the last visit or from another profile.
 */

const PREFIX = 'mobius.';
/** Which set of data the view state in place belongs to. */
const SPACE_KEY = 'mobius.space';
/** Where a set of data's view state waits while another is open. */
const SHELF = 'mobius@';
/** Shelves kept: each demo reset leaves one that is never opened again, so the oldest go. */
const SHELVES = 8;

/** Puts the view state of `space` in place, filing away what was there; nothing changes when it is already in place. */
export function settleViewState(storage: Storage, space: string): void {
  const before = storage.getItem(SPACE_KEY);
  if (before === space) return;
  const live: Record<string, string> = {};
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key && key.startsWith(PREFIX) && key !== SPACE_KEY) live[key] = storage.getItem(key) ?? '';
  }
  // What was there before profiles kept their own is the profile it was used with: it stays with the first one opened.
  if (before === null) { storage.setItem(SPACE_KEY, space); return; }
  try { storage.setItem(`${SHELF}${before}`, JSON.stringify({ at: Date.now(), state: live })); } catch { /* Too big to keep: it starts afresh next time. */ }
  for (const key of Object.keys(live)) storage.removeItem(key);
  const kept = storage.getItem(`${SHELF}${space}`);
  storage.removeItem(`${SHELF}${space}`);
  if (kept) {
    try {
      const state = (JSON.parse(kept) as { state?: unknown }).state;
      if (state && typeof state === 'object') {
        for (const [key, value] of Object.entries(state as Record<string, unknown>)) if (key.startsWith(PREFIX) && typeof value === 'string') storage.setItem(key, value);
      }
    } catch { /* A shelf that cannot be read starts afresh. */ }
  }
  storage.setItem(SPACE_KEY, space);
  trimShelves(storage);
}

function trimShelves(storage: Storage): void {
  const shelves: { key: string; at: number }[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.startsWith(SHELF)) continue;
    let at = 0;
    try { const v = (JSON.parse(storage.getItem(key) ?? '{}') as { at?: unknown }).at; if (typeof v === 'number') at = v; } catch { /* Oldest. */ }
    shelves.push({ key, at });
  }
  shelves.sort((a, b) => b.at - a.at);
  for (const { key } of shelves.slice(SHELVES)) storage.removeItem(key);
}

/** Settles the view state for the set of data the shell says is open; the little window and the preview leave it. */
export function settleOpenViewState(): void {
  const space = (window as unknown as { __MOBIUS_SYSTEM__?: { space?: unknown } }).__MOBIUS_SYSTEM__?.space;
  if (typeof space !== 'string' || space === '') return;
  try { settleViewState(window.localStorage, space); } catch { /* No storage: nothing to keep apart. */ }
}
