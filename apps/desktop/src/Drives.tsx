import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { DriveAccount, DriveEntry, DriveFailure, FileEntry, NewCloudDrive, NewDrive } from '@mobius/shared';

/** Drives that sign in on the service's own page. */
type CloudKind = 'dropbox' | 'onedrive';
import { Button, Confirm, PointMenu, Segmented, TextField, UndoToast, type MenuEntry, type SidebarRowDrop } from './ui';
import { EmptyState } from './EmptyState';
import { fileKind, sortEntries, type FilesSort } from './files-view';
import { relativeTime } from './relative-time';
import { FileIcon, GLYPH, size } from './file-icons';

/** A folder on one of the person's drives, or the form that adds a drive. */
export type DrivePlace = { kind: 'drive'; drive: string; path: string } | { kind: 'add-drive' };
/** Something from a drive being dragged: into another of its folders it moves; into the workspace it is copied. */
export interface DriveDrag { drive: string; path: string; folder: boolean }

const failed = (r: unknown): r is DriveFailure => !!r && typeof r === 'object' && (r as { ok?: unknown }).ok === false;
const parentOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
const nameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1);
const join = (folder: string, name: string) => (folder ? `${folder}/${name}` : name);
/** Where a drive path may be moved: another folder, never itself, inside itself, or where it already is. */
export const canMoveOnDrive = (path: string, folder: string) => folder !== path && !folder.startsWith(`${path}/`) && parentOf(path) !== folder;

/** What a drive answered, in the person's words. A file changed on the server says so and that nothing was lost. */
export function driveSaying(r: DriveFailure, name?: string): string {
  if (r.conflict) return `${name ? `“${name}”` : 'That file'} changed on the server since Files listed it, so nothing was changed. The list now shows the server's version.`;
  return r.message;
}

/** The person's drives: their accounts, the open drive folder, and copying between a drive and the workspace. */
export function useDrives(place: { kind: string; drive?: string; path?: string }, setPlace: (next: DrivePlace | { kind: 'folder'; path: string }) => void) {
  const api = window.mobius.drives;
  const [accounts, setAccounts] = useState<DriveAccount[]>([]);
  const loadAccounts = useCallback(async () => {
    const r = await api?.list().catch(() => null);
    setAccounts(Array.isArray(r) ? r : []);
  }, [api]);
  useEffect(() => { void loadAccounts(); }, [loadAccounts]);
  const drive = place.kind === 'drive' ? place.drive ?? null : null;
  const folder = place.kind === 'drive' ? place.path ?? '' : '';
  const [entries, setEntries] = useState<DriveEntry[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const list = useCallback(async () => {
    if (!api || !drive) return;
    const r = await api.browse(drive, folder).catch(() => null);
    setLoading(false);
    if (!r) { setEntries([]); setProblem('That drive could not be reached.'); return; }
    if (failed(r)) { setEntries([]); setProblem(r.message); return; }
    setEntries(r); setProblem(null);
  }, [api, drive, folder]);
  useEffect(() => { if (drive) { setLoading(true); setEntries([]); setProblem(null); void list(); } }, [drive, list]);
  // A change on the open drive (from this window or another) lists the folder again.
  useEffect(() => api?.onChanged((c) => { if (c.drive === drive) void list(); }), [api, drive, list]);

  // One line about what just went wrong, and one about what was just copied where.
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const act = async (done: Promise<{ ok: true } | DriveFailure> | undefined, name?: string): Promise<boolean> => {
    const r = await done?.catch(() => null);
    void list();
    if (!r) { setNotice('That could not be done here.'); return false; }
    if (failed(r)) { setNotice(driveSaying(r, name)); return false; }
    setNotice(null);
    return true;
  };
  const add = async (d: NewDrive): Promise<string | null> => {
    const r = await api?.add(d).catch(() => null);
    if (!r) return 'Drives are not available here.';
    if (failed(r)) return r.message;
    await loadAccounts();
    setPlace({ kind: 'drive', drive: r.id, path: '' });
    return null;
  };
  // Dropbox, OneDrive and SharePoint sign in in the browser; the drive arrives once the person allows it there.
  type Cloud = { setUp: boolean; waiting: boolean; problem: string | null };
  const [clouds, setClouds] = useState<Partial<Record<CloudKind, Cloud>>>({});
  const setCloud = (kind: CloudKind, change: (c: Cloud) => Cloud) => setClouds((all) => { const c = all[kind]; return c ? { ...all, [kind]: change(c) } : all; });
  useEffect(() => {
    const status = (kind: CloudKind, ask: (() => Promise<{ setUp: boolean; pending: string | null } | DriveFailure>) | undefined) => {
      void ask?.().then((r) => { if (!failed(r)) setClouds((all) => ({ ...all, [kind]: { setUp: r.setUp, waiting: r.pending !== null, problem: null } })); }).catch(() => {});
    };
    status('dropbox', api?.dropboxStatus);
    status('onedrive', api?.onedriveStatus);
  }, [api]);
  const placeRef = useRef(setPlace);
  placeRef.current = setPlace;
  useEffect(() => api?.onSignIn?.((done) => {
    setCloud(done.kind, (c) => ({ ...c, waiting: false, problem: done.ok ? null : done.message }));
    if (done.ok) { void loadAccounts(); placeRef.current({ kind: 'drive', drive: done.drive.id, path: '' }); }
  }), [api, loadAccounts]);
  /** Starts the sign-in and opens its page; answers why not, or null. */
  const addCloud = async (kind: CloudKind, d: NewCloudDrive): Promise<string | null> => {
    const r = await (kind === 'dropbox' ? api?.addDropbox?.(d) : api?.addOnedrive?.(d))?.catch(() => null);
    if (!r) return 'That is not available here.';
    if (failed(r)) return r.message;
    setCloud(kind, (c) => ({ ...c, waiting: true, problem: null }));
    void window.mobius.browser.open(r.url);
    return null;
  };
  const cancelCloud = (kind: CloudKind) => { void (kind === 'dropbox' ? api?.dropboxCancel?.() : api?.onedriveCancel?.()); setCloud(kind, (c) => ({ ...c, waiting: false })); };
  const remove = async (id: string) => {
    await act(api?.remove(id));
    await loadAccounts();
    if (drive === id) setPlace({ kind: 'folder', path: '' });
  };
  const newFolder = async (): Promise<string | null> => {
    if (!drive) return null;
    const taken = new Set(entries.map((e) => e.name.toLowerCase()));
    let name = 'New folder';
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `New folder ${n}`;
    const path = join(folder, name);
    return (await act(api?.mkdir(drive, path))) ? path : null;
  };
  const rename = async (path: string, name: string): Promise<string | null> => {
    if (!drive) return null;
    const to = join(parentOf(path), name);
    return (await act(api?.move(drive, path, to), nameOf(path))) ? to : null;
  };
  const moveInto = async (path: string, into: string) => {
    if (!drive || !canMoveOnDrive(path, into)) return;
    await act(api?.move(drive, path, join(into, nameOf(path))), nameOf(path));
  };
  /** For good: a drive has no Trash Mobius can reach. A file sends the version Files listed, so a newer one is kept. */
  const del = (e: DriveEntry) => (drive ? act(api?.delete(drive, e.path, e.folder ? null : e.etag), e.name) : Promise.resolve(false));
  const nameOfDrive = (id: string) => accounts.find((a) => a.id === id)?.name ?? 'the drive';
  /** A copy of a drive's file in the workspace folder `into`. Answers its workspace path. */
  const download = async (from: string, path: string, into: string, quiet = false): Promise<string | null> => {
    const r = await api?.download?.(from, path, into).catch(() => null);
    if (!r) { setNotice('That could not be copied here.'); return null; }
    if (failed(r)) { setNotice(driveSaying(r, nameOf(path))); return null; }
    setNotice(null);
    if (!quiet) setCopied(`Copied “${nameOf(path)}” to ${into ? nameOf(into) : 'Workspace'}`);
    return r.path;
  };
  /** A copy of the workspace file `path` in the drive's folder `into`; never over one already there. */
  const upload = async (to: string, path: string, into: string): Promise<boolean> => {
    const r = await api?.upload?.(to, path, into).catch(() => null);
    if (to === drive) void list();
    if (!r) { setNotice('That could not be copied here.'); return false; }
    if (failed(r)) { setNotice(driveSaying(r, nameOf(path))); return false; }
    setNotice(null);
    setCopied(`Copied “${nameOf(path)}” to ${into ? nameOf(into) : nameOfDrive(to)}`);
    return true;
  };
  const [dragging, setDragging] = useState<DriveDrag | null>(null);
  return {
    available: api !== undefined,
    canCopy: typeof api?.download === 'function' && typeof api?.upload === 'function',
    accounts, drive, folder, entries, problem, loading, notice, copied, dragging, setDragging,
    account: accounts.find((a) => a.id === drive) ?? null,
    clouds, addCloud, cancelCloud,
    list, add, remove, newFolder, rename, moveInto, del, download, upload, nameOfDrive,
    dismissNotice: () => setNotice(null), dismissCopied: () => setCopied(null),
  };
}
export type DrivesState = ReturnType<typeof useDrives>;

/** The lines a drive leaves above whichever Files page is open: what went wrong, and what was copied. */
export function DriveBars({ drives }: { drives: DrivesState }) {
  return (
    <>
      {drives.notice && <p className="field-error files-notice" role="alert">{drives.notice} <button type="button" className="review-btn" onClick={drives.dismissNotice}>OK</button></p>}
      {drives.copied && <UndoToast text={drives.copied} onDismiss={drives.dismissCopied} />}
    </>
  );
}

/** Add a drive: a name, the server's address, a user and an app password. A Nextcloud address alone is enough. Or an
 * S3-style bucket (Amazon S3, Cloudflare R2, Backblaze B2, MinIO): its address, bucket and an access key. */
export function AddDrivePage({ drives, tools }: { drives: DrivesState; tools: ReactNode }) {
  const [kind, setKind] = useState<'webdav' | 's3' | CloudKind>('webdav');
  const [link, setLink] = useState('');
  const [name, setName] = useState('');
  const [server, setServer] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [bucket, setBucket] = useState('');
  const [folder, setFolder] = useState('');
  const [region, setRegion] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const s3 = kind === 's3';
  const cloudKind = kind === 'dropbox' || kind === 'onedrive' ? kind : null;
  const cloud = cloudKind ? drives.clouds[cloudKind] : undefined;
  const service = kind === 'dropbox' ? 'Dropbox' : 'Microsoft';
  const submit = async () => {
    if (cloudKind) {
      setError(null);
      const problem = await drives.addCloud(cloudKind, { name: name.trim(), folder: folder.trim(), ...(cloudKind === 'onedrive' && link.trim() ? { link: link.trim() } : {}) });
      if (problem) setError(problem);
      return;
    }
    if (!server.trim()) { setError(s3 ? 'Give the service’s address, such as https://s3.eu-west-2.amazonaws.com.' : 'Give the server’s address, such as https://cloud.example.com.'); return; }
    if (s3 && !bucket.trim()) { setError('Give the bucket’s name.'); return; }
    setChecking(true); setError(null);
    const problem = await drives.add(s3
      ? { kind, name: name.trim(), server: server.trim(), bucket: bucket.trim(), folder: folder.trim(), region: region.trim(), username: username.trim(), password }
      : { name: name.trim(), server: server.trim(), username: username.trim(), password });
    setChecking(false);
    if (problem) setError(problem);
  };
  return (
    <section className="skills-page files-page" aria-label="Add a drive">
      {tools}
      <form className="drive-form" aria-label="New drive" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <Segmented label="Kind of drive" value={kind} onChange={(k) => { setKind(k); setError(null); }} choices={[{ value: 'webdav', label: 'Server (WebDAV)' }, { value: 's3', label: 'Bucket (S3)' }, ...(drives.clouds.dropbox ? [{ value: 'dropbox' as const, label: 'Dropbox' }] : []), ...(drives.clouds.onedrive ? [{ value: 'onedrive' as const, label: 'OneDrive or SharePoint' }] : [])]} />
        {kind === 'dropbox' ? (
          <>
            <p className="drive-lede">A folder in your Dropbox. You sign in on Dropbox’s own page, in the browser; Mobius never sees your password. Files opens it beside the workspace; nothing is copied until you copy it.</p>
            {cloud && !cloud.setUp && <p className="drive-hint" role="note">Dropbox isn’t set up in this build of Mobius yet.</p>}
            <TextField label="Folder in your Dropbox" placeholder="Leave empty for the whole Dropbox" value={folder} onChange={setFolder} autoFocus spellCheck={false} />
            <p className="drive-hint">A folder that isn’t there yet is made. The sign-in is kept in this computer’s secret store, and sent only to Dropbox.</p>
          </>
        ) : kind === 'onedrive' ? (
          <>
            <p className="drive-lede">A folder in your OneDrive, or a SharePoint library your work shares. You sign in on Microsoft’s own page, in the browser; Mobius never sees your password. Files opens it beside the workspace; nothing is copied until you copy it.</p>
            {cloud && !cloud.setUp && <p className="drive-hint" role="note">OneDrive and SharePoint aren’t set up in this build of Mobius yet.</p>}
            <TextField label="SharePoint link" placeholder="Leave empty for your own OneDrive" value={link} onChange={setLink} autoFocus inputMode="url" spellCheck={false} />
            <p className="drive-hint">For SharePoint, open the library or folder in the browser and copy its address, or use Share, Copy link.</p>
            <TextField label="Folder in it" placeholder="Leave empty for all of it" value={folder} onChange={setFolder} spellCheck={false} />
            <p className="drive-hint">A folder that isn’t there yet is made. The sign-in is kept in this computer’s secret store, and sent only to Microsoft.</p>
          </>
        ) : s3 ? (
          <>
            <p className="drive-lede">A bucket in S3-style storage: Amazon S3, Cloudflare R2, Backblaze B2, Wasabi or your own MinIO. Files opens it beside the workspace; nothing is copied until you copy it.</p>
            <TextField label="Service address" placeholder="https://s3.eu-west-2.amazonaws.com" value={server} onChange={setServer} autoFocus inputMode="url" autoComplete="url" spellCheck={false} />
            <TextField label="Bucket" placeholder="my-files" value={bucket} onChange={setBucket} spellCheck={false} />
            <TextField label="Folder in the bucket" placeholder="Leave empty for the whole bucket" value={folder} onChange={setFolder} spellCheck={false} />
            <TextField label="Region" placeholder="Found from the address where it is in it" value={region} onChange={setRegion} spellCheck={false} />
            <TextField label="Access key ID" value={username} onChange={setUsername} autoComplete="username" spellCheck={false} />
            <TextField label="Secret access key" type="password" value={password} onChange={setPassword} autoComplete="current-password" />
            <p className="drive-hint">Make a key that can reach only this bucket. The secret is kept in this computer’s secret store, and sent only to this service.</p>
          </>
        ) : (
          <>
            <p className="drive-lede">A drive is a folder on a server you already use: Nextcloud, ownCloud, a Synology or QNAP, Fastmail Files, or any WebDAV server. Files opens it beside the workspace; nothing is copied until you copy it.</p>
            <TextField label="Server address" placeholder="https://cloud.example.com" value={server} onChange={setServer} autoFocus inputMode="url" autoComplete="url" spellCheck={false} />
            <p className="drive-hint">For Nextcloud and ownCloud the server’s address alone is enough.</p>
            <TextField label="User name" value={username} onChange={setUsername} autoComplete="username" spellCheck={false} />
            <TextField label="App password" type="password" value={password} onChange={setPassword} autoComplete="current-password" />
            <p className="drive-hint">Make one in the server’s security settings. It is kept in this computer’s secret store, and sent only to this server.</p>
          </>
        )}
        <TextField label="Name" placeholder={cloudKind ? 'The folder’s name' : s3 ? 'The bucket’s name' : 'The server’s name'} value={name} onChange={setName} />
        {(error ?? cloud?.problem) && <p className="field-error" role="alert">{error ?? cloud?.problem}</p>}
        <div className="drive-actions">
          {cloudKind && cloud?.waiting
            ? <><span className="drive-hint" role="status">Waiting for {service} in the browser…</span><Button onClick={() => drives.cancelCloud(cloudKind)}>Cancel</Button></>
            : <Button kind="primary" type="submit" disabled={checking || (cloudKind !== null && !cloud?.setUp)}>{cloudKind ? `Sign in to ${service}…` : checking ? 'Checking…' : 'Add drive'}</Button>}
        </div>
      </form>
    </section>
  );
}

const asEntry = (e: DriveEntry): FileEntry => ({ name: e.name, type: e.folder ? 'folder' : 'file', bytes: e.size, ...(e.modified ? { modified: Date.parse(e.modified) } : {}) });

/**
 * A folder on a drive, laid out as the workspace's folders are. Double-click opens a folder, or a copy of a file in its
 * own app. Dragging moves within the drive; dragging to the workspace in the sidebar copies there.
 */
export function DrivePage({ drives, tools, sort, setSort, query, workspaceDrag, onOpenFile, onPlace }: {
  drives: DrivesState;
  tools: (onNewFolder?: () => void) => ReactNode;
  sort: FilesSort;
  setSort: (sort: FilesSort) => void;
  query: string;
  /** A workspace file being dragged: dropped on a folder here, a copy goes there. */
  workspaceDrag: string | null;
  onOpenFile: (path: string) => void;
  onPlace: (place: DrivePlace) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ entry: DriveEntry; x: number; y: number } | null>(null);
  const [confirm, setConfirm] = useState<DriveEntry | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const drive = drives.drive;
  const here = drives.folder;
  useEffect(() => { setSelected(null); setRenaming(null); }, [drive, here]);
  const byPath = useMemo(() => new Map(drives.entries.map((e) => [e.path, e])), [drives.entries]);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const shown = drives.entries.filter((e) => !q || e.name.toLowerCase().includes(q));
    const byName = new Map(shown.map((e) => [e.name, e]));
    return sortEntries(shown.map(asEntry), sort, '').map((e) => byName.get(e.name)!);
  }, [drives.entries, query, sort]);
  if (!drive) return null;
  const account = drives.account;
  const go = (path: string) => onPlace({ kind: 'drive', drive, path });
  /** A file opens as a copy in the workspace's Drives folder, in the app that opens its kind. */
  const openCopy = async (e: DriveEntry) => {
    const into = `Drives/${account?.name ?? 'Drive'}`;
    await window.mobius.files?.newFolder?.('', 'Drives').catch(() => null);
    await window.mobius.files?.newFolder?.('Drives', account?.name ?? 'Drive').catch(() => null);
    const path = await drives.download(drive, e.path, into, true);
    if (path) onOpenFile(path);
  };
  const open = (e: DriveEntry) => (e.folder ? go(e.path) : drives.canCopy ? void openCopy(e) : undefined);
  const startNewFolder = async () => {
    const path = await drives.newFolder();
    if (path) { setSelected(path); setRenaming(path); }
  };
  const finishRename = async (path: string, name: string) => {
    setRenaming(null);
    if (!name.trim() || name.trim() === nameOf(path)) return;
    const to = await drives.rename(path, name.trim());
    if (to) setSelected(to);
  };
  const items = (e: DriveEntry): MenuEntry[] => [
    ...(e.folder || drives.canCopy ? [{ label: e.folder ? 'Open' : 'Open a Copy', keys: 'Enter', run: () => open(e) }] : []),
    { label: 'Rename', keys: 'F2', run: () => setRenaming(e.path) },
    ...(!e.folder && drives.canCopy ? [{ label: 'Copy to Workspace', run: () => void drives.download(drive, e.path, '') }] : []),
    { label: 'Delete…', keys: 'Delete', danger: true, separated: true, run: () => setConfirm(e) },
  ];
  // Drops: a row of this drive moves into the folder; a workspace file is copied into it.
  const drop = (into: string): SidebarRowDrop<HTMLElement> => {
    const ours = drives.dragging && drives.dragging.drive === drive && canMoveOnDrive(drives.dragging.path, into) ? drives.dragging : null;
    const theirs = !ours && workspaceDrag && drives.canCopy ? workspaceDrag : null;
    return {
      'data-drop': ((ours || theirs) && over === into) || undefined,
      onDragOver: (ev) => {
        if (!ours && !theirs) return;
        ev.preventDefault(); ev.dataTransfer.dropEffect = ours ? 'move' : 'copy';
        if (over !== into) setOver(into);
      },
      onDragLeave: (ev) => { if (over === into && !ev.currentTarget.contains(ev.relatedTarget as Node | null)) setOver(null); },
      onDrop: (ev) => {
        ev.preventDefault(); setOver(null);
        drives.setDragging(null);
        if (ours) void drives.moveInto(ours.path, into);
        else if (theirs) void drives.upload(drive, theirs, into);
      },
    };
  };
  const drag = (e: DriveEntry) => ({
    draggable: true,
    onDragStart: (ev: React.DragEvent) => { ev.dataTransfer.setData('text/plain', e.path); ev.dataTransfer.effectAllowed = 'copyMove'; drives.setDragging({ drive, path: e.path, folder: e.folder }); },
    onDragEnd: () => { drives.setDragging(null); setOver(null); },
  });
  const step = (by: number) => {
    if (rows.length === 0) return;
    const at = rows.findIndex((r) => r.path === selected);
    const next = rows[Math.max(0, Math.min(rows.length - 1, at < 0 ? 0 : at + by))]!;
    setSelected(next.path);
    listRef.current?.querySelector<HTMLElement>(`[data-path="${CSS.escape(next.path)}"]`)?.focus();
  };
  const pick = selected ? byPath.get(selected) ?? null : null;
  const onKey = (ev: React.KeyboardEvent) => {
    if (ev.key === 'ArrowDown') { ev.preventDefault(); step(1); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); step(-1); }
    else if (ev.key === 'Enter' && pick) { ev.preventDefault(); open(pick); }
    else if (ev.key === 'F2' && pick) { ev.preventDefault(); setRenaming(pick.path); }
    else if (ev.key === 'Delete' && pick) { ev.preventDefault(); setConfirm(pick); }
    else if (ev.key === 'Backspace' && here) { ev.preventDefault(); go(parentOf(here)); }
  };
  const sortBy = (by: FilesSort['by']) => setSort(sort.by === by ? { by, down: !sort.down } : { by, down: false });
  const head = (by: FilesSort['by'], label: string) => (
    <button type="button" role="columnheader" className="files-col" data-col={by} aria-sort={sort.by === by ? (sort.down ? 'descending' : 'ascending') : 'none'} onClick={() => sortBy(by)}>
      {label}{sort.by === by && <span className="files-sort" aria-hidden="true">{sort.down ? '▾' : '▴'}</span>}
    </button>
  );
  const parts = here ? here.split('/') : [];
  const nameCell = (path: string, label: string) => (renaming === path ? (
    <input className="files-rename" autoFocus aria-label={`New name for ${label}`} defaultValue={label}
      onFocus={(ev) => { const dot = label.lastIndexOf('.'); ev.currentTarget.setSelectionRange(0, dot > 0 ? dot : label.length); }}
      onClick={(ev) => ev.stopPropagation()} onDoubleClick={(ev) => ev.stopPropagation()}
      onKeyDown={(ev) => { ev.stopPropagation(); if (ev.key === 'Enter') void finishRename(path, ev.currentTarget.value); if (ev.key === 'Escape') setRenaming(null); }}
      onBlur={(ev) => void finishRename(path, ev.currentTarget.value)} />
  ) : <span className="files-label">{label}</span>);
  return (
    <section className="skills-page files-page" aria-label={account ? `${account.name} drive` : 'Drive'}>
      {tools(() => void startNewFolder())}
      <DriveBars drives={drives} />
      {drives.problem && <p className="field-error" role="alert">{drives.problem}</p>}
      {!drives.problem && drives.loading && (
        <div className="files-loading" role="status" aria-label="Loading this folder">{['46%', '32%', '58%', '38%', '50%'].map((w) => <span key={w} style={{ '--w': w } as React.CSSProperties} />)}</div>
      )}
      {!drives.problem && !drives.loading && drives.entries.length === 0 && (
        <EmptyState icon={GLYPH.folder} title="This folder is empty" line={drives.canCopy ? 'Drag a file here from the workspace to copy it to the server.' : undefined} action={{ label: 'New folder', run: () => void startNewFolder() }} />
      )}
      {!drives.problem && !drives.loading && drives.entries.length > 0 && (
        <div className="files-table" role="grid" aria-label="Files in this folder" aria-rowcount={rows.length + 1} {...(workspaceDrag ? drop(here) : {})}>
          <div className="files-head" role="row">{head('name', 'Name')}{head('modified', 'Date Modified')}{head('kind', 'Kind')}{head('size', 'Size')}</div>
          <div ref={listRef} role="rowgroup" onKeyDown={onKey}>
            {rows.length === 0 && <p className="note-empty files-none">Nothing here matches “{query}”.</p>}
            {rows.map((e) => (
              <div key={e.path} role="row" tabIndex={selected === e.path || (!selected && e === rows[0]) ? 0 : -1} data-path={e.path} aria-selected={selected === e.path} aria-label={e.name}
                className="files-row" {...(renaming !== e.path ? drag(e) : {})} {...(e.folder ? drop(e.path) : {})}
                data-dragging={(drives.dragging?.drive === drive && drives.dragging.path === e.path) || undefined}
                onClick={() => setSelected(e.path)} onDoubleClick={() => open(e)}
                onContextMenu={(ev) => { ev.preventDefault(); setSelected(e.path); setMenu({ entry: e, x: ev.clientX, y: ev.clientY }); }}>
                <span role="gridcell" className="files-cell files-name"><FileIcon path={`drive/${e.name}`} type={e.folder ? 'folder' : 'file'} />{nameCell(e.path, e.name)}</span>
                <span role="gridcell" className="files-cell files-date">{e.modified ? relativeTime(Date.parse(e.modified), Date.now()) : '—'}</span>
                <span role="gridcell" className="files-cell files-kind">{fileKind(`drive/${e.name}`, e.folder ? 'folder' : 'file')}</span>
                <span role="gridcell" className="files-cell files-size">{e.folder ? '—' : size(e.size)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <nav className="files-crumbs files-path" aria-label="Folder">
        <button type="button" className="review-btn" aria-current={parts.length === 0 ? 'page' : undefined} onClick={() => go('')} {...drop('')}>{account?.name ?? 'Drive'}</button>
        {parts.map((p, i) => (
          <span key={i}>
            <span aria-hidden="true"> › </span>
            <button type="button" className="review-btn" aria-current={i === parts.length - 1 ? 'page' : undefined} onClick={() => go(parts.slice(0, i + 1).join('/'))} {...drop(parts.slice(0, i + 1).join('/'))}>{p}</button>
          </span>
        ))}
      </nav>
      {menu && <PointMenu x={menu.x} y={menu.y} label={menu.entry.name} entries={items(menu.entry)} onClose={() => setMenu(null)} />}
      <Confirm open={confirm !== null} title={`Delete “${confirm?.name ?? ''}” from ${account?.name ?? 'the drive'}?`}
        description={confirm?.folder ? 'The folder and everything in it go from the server.' : 'The file goes from the server.'} permanent action="Delete"
        onCancel={() => setConfirm(null)} onConfirm={() => { const e = confirm; setConfirm(null); setSelected(null); if (e) void drives.del(e); }} />
    </section>
  );
}
