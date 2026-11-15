import type { SyncPair, SyncStatus } from '@mobius/shared';

/** How the sync line reads: fine, working, something to look at, or something broken. */
export type SyncTone = 'ok' | 'busy' | 'warn' | 'error';
/** One line for a synced folder: the most urgent of its states, and the one fix it offers, if any. */
export interface SyncLine { text: string; tone: SyncTone; action?: 'signIn' | 'deletes' }

const files = (n: number) => (n === 1 ? '1 file' : `${n} files`);

/** "in 2 minutes", rounded up to the minute so it changes once a minute, never every second. */
export function retryWords(at: number | null, now: number): string {
  if (at === null) return '';
  const minutes = Math.ceil((at - now) / 60_000);
  return minutes <= 1 ? ', trying again in a minute' : `, trying again in ${minutes} minutes`;
}

/** The sync line, most urgent first: sign-in, deletes to answer, conflicts, offline, errors, paused, Keep, progress. */
export function syncLine(s: SyncStatus, drive: string, paused: boolean, now: number): SyncLine {
  if (s.state === 'signIn') return { text: `Sign in to ${drive} again`, tone: 'error', action: 'signIn' };
  if (s.ask) {
    const n = s.ask.onDrive.length + s.ask.here.length;
    return { text: n === 1 ? '1 delete waits for your answer' : `${n} deletes wait for your answer`, tone: 'warn', action: 'deletes' };
  }
  if (s.conflicts.length > 0) return { text: s.conflicts.length === 1 ? '1 conflict' : `${s.conflicts.length} conflicts`, tone: 'warn' };
  if (s.state === 'offline') return { text: `Offline${retryWords(s.retryAt, now)}`, tone: 'warn' };
  if (s.error) return { text: s.error, tone: 'error' };
  if (paused || s.state === 'paused') return { text: 'Paused', tone: 'ok' };
  if (s.held.length > 0) return { text: `${s.held.length} wait for Keep`, tone: 'ok' };
  if (s.state === 'syncing') return { text: s.total > 0 ? `Syncing ${Math.min(s.done + 1, s.total)} of ${s.total}` : 'Syncing', tone: 'busy' };
  if (s.tooBig.length > 0) return { text: `${files(s.tooBig.length)} too big to sync`, tone: 'warn' };
  return { text: 'Up to date', tone: 'ok' };
}

/** The pair a workspace path is synced by: its own folder or one it is inside. */
export function pairFor(pairs: readonly SyncPair[], path: string): SyncPair | null {
  return pairs.find((p) => path === p.folder || path.startsWith(`${p.folder}/`)) ?? null;
}

/** A folder can be paired when it is not inside, and does not hold, a folder already synced. */
export function canPair(pairs: readonly SyncPair[], folder: string): boolean {
  return folder !== '' && !pairs.some((p) => folder === p.folder || folder.startsWith(`${p.folder}/`) || p.folder.startsWith(`${folder}/`));
}

/** Where a conflict copy sits beside the file, by name: "Plan (conflict from Cloud).md" beside "Plan.md". */
export function conflictStem(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}
