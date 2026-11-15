import { useCallback, useEffect, useState } from 'react';
import type { DriveAccount, DriveFailure, SyncPair } from '@mobius/shared';
import { Button, Confirm, Dialog, Select, TextField } from './ui';
import { canPair, syncLine, type SyncLine } from './sync-view';

const failed = (r: unknown): r is DriveFailure => !!r && typeof r === 'object' && (r as { ok?: unknown }).ok === false;
const nameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1);

/** Two-way sync of workspace folders with drive folders: the pairs, their status as it changes, and the person's answers. */
export function useSync(accounts: readonly DriveAccount[]) {
  const api = window.mobius.drives;
  const [pairs, setPairs] = useState<SyncPair[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await api?.syncPairs?.().catch(() => null);
    setPairs(Array.isArray(r) ? r : []);
  }, [api]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => api?.onSync?.((c) => setPairs((all) => all.map((p) => (p.id === c.pair ? { ...p, status: c.status } : p)))), [api]);
  // "Trying again in 2 minutes" moves on once a minute, not every second.
  const [now, setNow] = useState(() => Date.now());
  const waiting = pairs.some((p) => p.status.retryAt !== null);
  useEffect(() => {
    if (!waiting) return undefined;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, [waiting]);
  const driveName = (id: string) => accounts.find((a) => a.id === id)?.name ?? 'the drive';
  const act = async (done: Promise<{ ok: true } | DriveFailure> | undefined): Promise<boolean> => {
    const r = await done?.catch(() => null);
    void load();
    if (!r) { setNotice('That could not be done here.'); return false; }
    if (failed(r)) { setNotice(r.message); return false; }
    setNotice(null);
    return true;
  };
  const add = async (folder: string, drive: string, remote: string): Promise<string | null> => {
    const r = await api?.syncAdd?.(folder, drive, remote).catch(() => null);
    if (!r) return 'Syncing is not available here.';
    if (failed(r)) return r.message;
    await load();
    return null;
  };
  const signIn = async (drive: string, password: string): Promise<string | null> => {
    const r = await api?.signIn?.(drive, password).catch(() => null);
    if (!r) return 'Signing in is not available here.';
    if (failed(r)) return r.message;
    await load();
    return null;
  };
  return {
    available: typeof api?.syncPairs === 'function',
    canSignIn: typeof api?.signIn === 'function',
    pairs, notice, dismissNotice: () => setNotice(null), driveName, canPair: (folder: string) => canPair(pairs, folder),
    line: (p: SyncPair): SyncLine => syncLine(p.status, driveName(p.drive), p.paused, now),
    add, signIn,
    remove: (p: SyncPair) => act(api?.syncRemove?.(p.id)),
    pause: (p: SyncPair, paused: boolean) => act(api?.syncPause?.(p.id, paused)),
    syncNow: (p: SyncPair) => act(api?.syncNow?.(p.id)),
    allowDeletes: (p: SyncPair) => act(api?.syncAllowDeletes?.(p.id)),
    keepThem: (p: SyncPair) => act(api?.syncKeepThem?.(p.id)),
    resolve: (p: SyncPair, path: string, keep: 'mine' | 'theirs') => act(api?.syncResolve?.(p.id, path, keep)),
  };
}
export type SyncState = ReturnType<typeof useSync>;

/**
 * The sync glyph: two arcs, in muted ink (indigo is Mobius's, never sync's). It turns slowly while syncing, and a
 * problem adds an amber or red dot rather than colouring it.
 */
export function SyncGlyph({ line, drive }: { line: SyncLine; drive: string }) {
  return (
    <span className="sync-glyph" role="img" aria-label={`Synced with ${drive}: ${line.text}`} title={`Synced with ${drive}: ${line.text}`} data-tone={line.tone}>
      <svg viewBox="0 0 20 20" aria-hidden="true" data-busy={line.tone === 'busy' || undefined}>
        <path d="M15.5 8.5A5.5 5.5 0 0 0 5.4 6.6M4.5 11.5a5.5 5.5 0 0 0 10.1 1.9" />
        <path d="M5 3.8v3h3M15 16.2v-3h-3" />
      </svg>
      {(line.tone === 'warn' || line.tone === 'error') && <span className="sync-dot" aria-hidden="true" />}
    </span>
  );
}

/** The toolbar's grey line for a synced folder: the glyph, the one most urgent state, and its fix one click away. */
export function SyncSub({ sync, pair, onSignIn }: { sync: SyncState; pair: SyncPair; onSignIn: () => void }) {
  const line = sync.line(pair);
  const drive = sync.driveName(pair.drive);
  return (
    <span className="sync-sub" role="status" data-tone={line.tone}>
      <SyncGlyph line={line} drive={drive} />
      {line.action === 'signIn' && sync.canSignIn ? <button type="button" className="review-btn sync-link" onClick={onSignIn}>{line.text}</button>
        : <span>{line.text}</span>}
    </span>
  );
}

/** Each conflict, in amber above the list: the file changed here and on the drive. Compare, or use one side. */
export function SyncConflicts({ sync, pair, onCompare }: { sync: SyncState; pair: SyncPair; onCompare: (path: string) => void }) {
  const drive = sync.driveName(pair.drive);
  if (pair.status.conflicts.length === 0) return null;
  return (
    <div className="sync-conflicts" role="group" aria-label="Sync conflicts">
      {pair.status.conflicts.map((c) => (
        <div key={c.path} className="sync-conflict" role="group" aria-label={`${nameOf(c.path)} conflict`}>
          <span className="ui-dot" data-tone="amber" aria-hidden="true" />
          <span className="sync-conflict-text">“{nameOf(c.path)}” changed here and on {drive}</span>
          <Button kind="quiet" onClick={() => onCompare(c.path)}>Compare</Button>
          <Button kind="quiet" onClick={() => void sync.resolve(pair, c.path, 'mine')}>Use mine</Button>
          <Button kind="quiet" onClick={() => void sync.resolve(pair, c.path, 'theirs')}>{`Use ${drive}’s`}</Button>
        </div>
      ))}
    </div>
  );
}

/** Deletes wait for a yes: "Delete 40 files on Cloud?", the first names, then Put them back or Delete. */
export function SyncDeletes({ sync, pair, folderName, onClose }: { sync: SyncState; pair: SyncPair; folderName: string; onClose: () => void }) {
  const ask = pair.status.ask;
  if (!ask) return null;
  const drive = sync.driveName(pair.drive);
  const names = [...ask.onDrive, ...ask.here];
  const n = names.length;
  const what = n === 1 ? '1 file' : `${n} files`;
  const where = ask.onDrive.length > 0 && ask.here.length === 0 ? ` on ${drive}` : ask.here.length > 0 && ask.onDrive.length === 0 ? ` in ${folderName}` : '';
  const shown = names.slice(0, 5).map(nameOf).join(', ');
  return (
    <Confirm open title={`Delete ${what}${where}?`} action={`Delete ${what}`} cancelLabel="Put them back"
      description={<>{ask.onDrive.length > 0 && ask.here.length === 0 ? `They were deleted in ${folderName}. ` : ask.here.length > 0 && ask.onDrive.length === 0 ? `They were deleted on ${drive}. ` : ''}{shown}{n > 5 ? `, and ${n - 5} more` : ''}.</>}
      onCancel={() => { onClose(); void sync.keepThem(pair); }} onConfirm={() => { onClose(); void sync.allowDeletes(pair); }} />
  );
}

/** Sync with a drive: which drive and which folder on it. Off until the person starts it here. */
export function PairDialog({ sync, accounts, folder, folderName, onClose }: { sync: SyncState; accounts: readonly DriveAccount[]; folder: string; folderName: string; onClose: () => void }) {
  const [drive, setDrive] = useState(accounts[0]?.id ?? '');
  const [remote, setRemote] = useState(folderName);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const start = async () => {
    if (!drive) { setError('Add a drive first, under Drives in the sidebar.'); return; }
    if (!remote.trim()) { setError('Name the folder on the drive.'); return; }
    setStarting(true); setError(null);
    const problem = await sync.add(folder, drive, remote.trim().replace(/^\/+|\/+$/g, ''));
    setStarting(false);
    if (problem) setError(problem); else onClose();
  };
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }} title={`Sync ${folderName} with a drive`}
      description="Changes go both ways. Nothing is deleted on either side without asking."
      actions={<><Button onClick={onClose}>Cancel</Button><Button kind="primary" disabled={starting} onClick={() => void start()}>{starting ? 'Starting…' : 'Start syncing'}</Button></>}>
      <form className="sync-form" aria-label="Sync with a drive" onSubmit={(e) => { e.preventDefault(); void start(); }}>
        <Select label="Drive" value={drive} choices={accounts.map((a) => ({ value: a.id, label: a.name }))} onChange={setDrive} />
        <TextField label="Folder on the drive" value={remote} onChange={setRemote} spellCheck={false} unit="made if missing" />
        {error && <p className="field-error" role="alert">{error}</p>}
      </form>
    </Dialog>
  );
}

/** Sign in to a drive again: a new app password, checked before it is kept. */
export function SignInDialog({ sync, drive, onClose }: { sync: SyncState; drive: string; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const go = async () => {
    setChecking(true); setError(null);
    const problem = await sync.signIn(drive, password);
    setChecking(false);
    if (problem) setError(problem); else onClose();
  };
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }} title={`Sign in to ${sync.driveName(drive)} again`}
      description="The server stopped accepting the app password. Make a new one in its security settings."
      actions={<><Button onClick={onClose}>Cancel</Button><Button kind="primary" disabled={checking || !password} onClick={() => void go()}>{checking ? 'Checking…' : 'Sign in'}</Button></>}>
      <form className="sync-form" aria-label="Sign in again" onSubmit={(e) => { e.preventDefault(); void go(); }}>
        <TextField label="App password" type="password" value={password} onChange={setPassword} autoFocus autoComplete="current-password" />
        {error && <p className="field-error" role="alert">{error}</p>}
      </form>
    </Dialog>
  );
}
