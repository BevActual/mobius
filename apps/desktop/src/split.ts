import type { AppId } from './apps';

/** Where split view puts its divider, as a share of the work area. Kept within reach of both panes. */
export const MIN_SHARE = 0.25;
export const MAX_SHARE = 0.75;
export const clampShare = (share: number): number => Math.min(MAX_SHARE, Math.max(MIN_SHARE, share));

const SHARE_KEY = 'mobius.split.share';
export function loadShare(): number {
  try {
    const saved = Number(window.localStorage.getItem(SHARE_KEY));
    return Number.isFinite(saved) && saved > 0 ? clampShare(saved) : 0.5;
  } catch {
    return 0.5;
  }
}
export function saveShare(share: number): void {
  try { window.localStorage.setItem(SHARE_KEY, String(share)); } catch { /* Not kept: the next window starts even. */ }
}

/** The two apps a split view showed, kept so the next start opens the same pair. Only real apps that can share a window. */
const PANES_KEY = 'mobius.split.panes';
const PAIRABLE: readonly AppId[] = ['browser', 'agent', 'search', 'notes', 'tasks'];
export function loadPanes(): readonly [AppId, AppId | null] {
  try {
    const saved: unknown = JSON.parse(window.localStorage.getItem(PANES_KEY) ?? 'null');
    if (Array.isArray(saved) && saved.length === 2 && saved[0] !== saved[1] && saved.every((id) => PAIRABLE.includes(id as AppId))) return [saved[0] as AppId, saved[1] as AppId];
  } catch { /* Nothing kept: one app. */ }
  return ['browser', null];
}
/** Kept only while split; one app clears it, so a single app always starts as before. */
export function savePanes(panes: readonly [AppId, AppId | null]): void {
  try {
    if (panes[1] === null) window.localStorage.removeItem(PANES_KEY);
    else window.localStorage.setItem(PANES_KEY, JSON.stringify(panes));
  } catch { /* Not kept. */ }
}

/** The second app to show when split view opens: the browser beside anything else, notes beside the browser. */
export const companionFor = (app: AppId): AppId => (app === 'browser' ? 'notes' : 'browser');
