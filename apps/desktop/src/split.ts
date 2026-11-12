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

/** The app (or the two apps of a split view) showing when Mobius closed, so the next start opens where you were. */
const PANES_KEY = 'mobius.split.panes';
const PAIRABLE: readonly AppId[] = ['browser', 'agent', 'search', 'mail', 'notes', 'docs', 'sheets', 'slides', 'tasks', 'calendar'];
export function loadPanes(): readonly [AppId, AppId | null] {
  try {
    const saved: unknown = JSON.parse(window.localStorage.getItem(PANES_KEY) ?? 'null');
    const known = (id: unknown): id is AppId => PAIRABLE.includes(id as AppId);
    if (Array.isArray(saved) && saved.length === 2 && known(saved[0])) {
      if (saved[1] === null) return [saved[0], null];
      if (known(saved[1]) && saved[1] !== saved[0]) return [saved[0], saved[1]];
    }
  } catch { /* Nothing kept: the browser, as on a first start. */ }
  return ['browser', null];
}
export function savePanes(panes: readonly [AppId, AppId | null]): void {
  try { window.localStorage.setItem(PANES_KEY, JSON.stringify(panes)); } catch { /* Not kept. */ }
}

/** The second app to show when split view opens: the browser beside anything else, notes beside the browser. */
export const companionFor = (app: AppId): AppId => (app === 'browser' ? 'notes' : 'browser');

/**
 * Follow along in split view: with the conversation in one pane, the other shows what Mobius just worked on (the list
 * it added to, the document it wrote), as each step finishes. Only apps that pair in a split; the newest step wins.
 */
export function followPane(panes: readonly [AppId, AppId | null], target: { app: string } | null): { pane: 0 | 1; app: AppId } | null {
  if (!target || panes[1] === null) return null;
  const chat = panes[0] === 'agent' ? 0 : panes[1] === 'agent' ? 1 : null;
  if (chat === null || !PAIRABLE.includes(target.app as AppId) || target.app === 'agent') return null;
  return { pane: chat === 0 ? 1 : 0, app: target.app as AppId };
}
