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

/** The second app to show when split view opens: the browser beside anything else, notes beside the browser. */
export const companionFor = (app: AppId): AppId => (app === 'browser' ? 'notes' : 'browser');
