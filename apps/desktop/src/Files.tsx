import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { FileEntry, FilesActionResult } from '@mobius/shared';
import { describeChange, KEPT_EVENT, keepTurn, keptTurns, turnId } from './ReviewStrip';
import { ReviewActions, WhyThis } from './ReviewBar';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';
import { APP_ICONS } from './Rail';
import { appOf } from './review-view';
import { appName, type AppId } from './apps';
import { fileKind, sortEntries, type FilesSort } from './files-view';
import { relativeTime } from './relative-time';
import './files.css';

/** Where Files is looking: a folder of the workspace, or what Mobius made. */
export type FilesPlace = { kind: 'folder'; path: string } | { kind: 'made' };

const samePlace = (a: FilesPlace, b: FilesPlace) => a.kind === b.kind && (a.kind === 'made' || a.path === (b as { path: string }).path);

/** The Files app: the whole workspace as a drive, and what Mobius made, dashed until it is kept. */
export function useFiles(conversation: string, busy: boolean) {
  // Back and Forward, as in Finder: every place visited, and where in that list Files is now.
  const [trail, setTrail] = useState<{ places: FilesPlace[]; at: number }>({ places: [{ kind: 'folder', path: '' }], at: 0 });
  const place = trail.places[trail.at]!;
  const setPlace = useCallback((next: FilesPlace) => {
    setTrail((t) => (samePlace(t.places[t.at]!, next) ? t : { places: [...t.places.slice(0, t.at + 1), next], at: t.at + 1 }));
  }, []);
  const back = useCallback(() => setTrail((t) => (t.at > 0 ? { ...t, at: t.at - 1 } : t)), []);
  const forward = useCallback(() => setTrail((t) => (t.at < t.places.length - 1 ? { ...t, at: t.at + 1 } : t)), []);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [roots, setRoots] = useState<FileEntry[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [made, setMade] = useState<{ files: string[]; turn: string | null }>({ files: [], turn: null });
  const [sort, setSort] = useState<FilesSort>({ by: 'name', down: false });
  const [query, setQuery] = useState('');
  const folder = place.kind === 'folder' ? place.path : '';
  const list = useCallback(async () => {
    const result = await window.mobius.files?.list(folder).catch(() => null);
    if (!result) { setEntries([]); setProblem(window.mobius.files ? 'That folder could not be read.' : null); return; }
    if ('error' in result) { setEntries([]); setProblem(result.error); return; }
    setEntries(result.entries); setProblem(null);
    if (folder === '') setRoots(result.entries.filter((e) => e.type === 'folder'));
  }, [folder]);
  // The sidebar's folders are the workspace's top level, wherever Files is looking.
  const listRoots = useCallback(async () => {
    const result = await window.mobius.files?.list('').catch(() => null);
    if (result && 'entries' in result) setRoots(result.entries.filter((e) => e.type === 'folder'));
  }, []);
  const loadMade = useCallback(async () => {
    const result = await window.mobius.changes?.lastTurn(conversation).catch(() => null);
    const turn = result && 'files' in result ? turnId(conversation, result.checkpoint) : null;
    setMade(result && 'files' in result && !(turn && keptTurns().includes(turn)) ? { files: result.files, turn } : { files: [], turn: null });
  }, [conversation]);
  useEffect(() => { void list(); setQuery(''); }, [list]);
  useEffect(() => { if (!busy) { void loadMade(); void list(); void listRoots(); } }, [busy, loadMade, list, listRoots]);
  useEffect(() => {
    const again = () => void loadMade();
    window.addEventListener(KEPT_EVENT, again);
    return () => window.removeEventListener(KEPT_EVENT, again);
  }, [loadMade]);
  const keep = () => { if (made.turn) keepTurn(made.turn); else window.dispatchEvent(new CustomEvent(KEPT_EVENT)); };
  const discard = async () => {
    for (const path of made.files) await window.mobius.changes?.undoFile(conversation, path).catch(() => undefined);
    keep();
    void list();
  };
  // The person's own changes: each re-lists, and says what went wrong in the bar instead of failing quietly.
  const [notice, setNotice] = useState<string | null>(null);
  const [trashed, setTrashed] = useState<{ held: string; path: string } | null>(null);
  const after = async (done: Promise<FilesActionResult> | undefined): Promise<string | null> => {
    const result = await done?.catch(() => null);
    void list(); void listRoots();
    if (!result) { setNotice('That could not be done here.'); return null; }
    if (!result.ok) { setNotice(`${result.error.charAt(0).toUpperCase()}${result.error.slice(1)}.`); return null; }
    setNotice(null);
    return result.path;
  };
  const newFolder = async (): Promise<string | null> => {
    const taken = new Set(entries.map((e) => e.name.toLowerCase()));
    let name = 'New folder';
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `New folder ${n}`;
    return after(window.mobius.files?.newFolder?.(folder, name));
  };
  const rename = (path: string, name: string) => after(window.mobius.files?.rename?.(path, name));
  const trash = async (path: string) => {
    const held = await after(window.mobius.files?.trash?.(path));
    setTrashed(held ? { held, path } : null);
  };
  const putBack = async () => {
    if (!trashed) return;
    const back = await after(window.mobius.files?.putBack?.(trashed.held, trashed.path));
    if (back) setTrashed(null);
  };
  const show = (path: string) => void window.mobius.files?.show?.(path);
  const can = { change: typeof window.mobius.files?.rename === 'function', show: typeof window.mobius.files?.show === 'function' };
  return {
    place, setPlace, back, forward, canBack: trail.at > 0, canForward: trail.at < trail.places.length - 1,
    entries, roots, problem, made, conversation, keep, discard, sort, setSort, query, setQuery,
    newFolder, rename, trash, putBack, show, trashed, dismissTrashed: () => setTrashed(null), notice, dismissNotice: () => setNotice(null), can,
    available: window.mobius.files !== undefined,
  };
}
export type FilesState = ReturnType<typeof useFiles>;

const GLYPH = {
  folder: <path d="M3.5 6.5a1.5 1.5 0 0 1 1.5-1.5h3l1.5 1.5h5.5a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5z" />,
  file: <><path d="M6 3.5h5.5l3 3v10H6z" /><path d="M11.5 3.5v3h3" /></>,
  workspace: <><rect x="3.5" y="4.5" width="13" height="11" rx="2" /><path d="M3.5 11.5h13M7 13.5h.01" /></>,
  made: <><path d="M10 3.5 11.6 8.4 16.5 10l-4.9 1.6L10 16.5l-1.6-4.9L3.5 10l4.9-1.6z" strokeDasharray="2 1.6" /></>,
  back: <path d="M12 4.5 6.5 10l5.5 5.5" />,
  newFolder: <><path d="M3.5 6.5a1.5 1.5 0 0 1 1.5-1.5h3l1.5 1.5h5.5a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5z" /><path d="M10 8.5v5M7.5 11h5" /></>,
  forward: <path d="m8 4.5 5.5 5.5L8 15.5" />,
};

/** A row's icon: the app that opens it, in its colour; a folder in Finder blue; anything else plain. */
function FileIcon({ path, type, size = 'row' }: { path: string; type: FileEntry['type']; size?: 'row' | 'side' }) {
  const app: AppId | null = appOf(path);
  // An app's own folder (notes/) wears that app's icon; a folder inside it is a folder.
  const top = !path.includes('/');
  if (type === 'folder' && !(top && app)) return <svg className="files-icon" data-size={size} data-glyph="folder" viewBox="0 0 20 20" aria-hidden="true">{GLYPH.folder}</svg>;
  if (app && APP_ICONS[app]) return <svg className="files-icon" data-size={size} data-app={app} viewBox="0 0 20 20" aria-hidden="true">{APP_ICONS[app]}</svg>;
  return <svg className="files-icon" data-size={size} data-glyph="file" viewBox="0 0 20 20" aria-hidden="true">{GLYPH.file}</svg>;
}

/** Files' sidebar: the drive, Made by Mobius with how many things wait, and the workspace's folders. */
export function FilesSidebar({ files, pin }: { files: FilesState; pin?: ReactNode }) {
  const here = files.place.kind === 'folder' ? files.place.path : null;
  const row = (label: string, icon: ReactNode, current: boolean, count: number | null, onClick: () => void) => (
    <li key={label}>
      <button type="button" className="list-row files-place" aria-current={current ? 'page' : undefined} onClick={onClick}>
        {icon}
        <span className="list-name">{label}</span>
        {count !== null && count > 0 && <span className="list-count">{count}</span>}
      </button>
    </li>
  );
  const folderName = (name: string) => { const app = appOf(name); return app && !name.includes('/') ? appName(app) : name; };
  return (
    <aside className="side files-side" aria-label="Files sidebar">
      <div className="side-head">
        <span className="side-title">Files</span>
        <span className="side-actions">{pin}</span>
      </div>
      <nav className="task-lists" aria-label="Files">
        <ul role="list">
          {row('Workspace', <svg className="files-icon" data-size="side" data-glyph="place" viewBox="0 0 20 20" aria-hidden="true">{GLYPH.workspace}</svg>, here === '', null, () => files.setPlace({ kind: 'folder', path: '' }))}
          {row('Made by Mobius', <svg className="files-icon" data-size="side" data-glyph="made" viewBox="0 0 20 20" aria-hidden="true">{GLYPH.made}</svg>, files.place.kind === 'made', files.made.files.length, () => files.setPlace({ kind: 'made' }))}
        </ul>
        {files.roots.length > 0 && (
          <>
            <h2 className="files-side-heading">Folders</h2>
            <ul role="list" aria-label="Folders">
              {files.roots.map((r) => row(folderName(r.name), <FileIcon path={r.name} type="folder" size="side" />, here !== null && (here === r.name || here.startsWith(`${r.name}/`)), null, () => files.setPlace({ kind: 'folder', path: r.name })))}
            </ul>
          </>
        )}
      </nav>
    </aside>
  );
}

/** Explorer on Windows and Linux file managers alike say Explorer-ish words; Finder on a Mac. */
const SHOW_IN = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform) ? 'Show in Finder' : 'Show in Explorer';

const size = (bytes: number | undefined) => (bytes === undefined ? '' : bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

/** Back and Forward, the place's name, and (in a folder) the filter: the bar at the top of Files. */
function FilesBar({ files, title, filter, onNewFolder }: { files: FilesState; title: string; filter: boolean; onNewFolder?: (() => void) | undefined }) {
  return (
    <header className="files-bar">
      <div className="files-nav" role="group" aria-label="Go">
        <button type="button" className="strip-btn" aria-label="Back" title="Back (Alt+Left)" disabled={!files.canBack} onClick={files.back}><svg viewBox="0 0 20 20" aria-hidden="true">{GLYPH.back}</svg></button>
        <button type="button" className="strip-btn" aria-label="Forward" title="Forward (Alt+Right)" disabled={!files.canForward} onClick={files.forward}><svg viewBox="0 0 20 20" aria-hidden="true">{GLYPH.forward}</svg></button>
      </div>
      <h1 className="files-title">{title}</h1>
      {onNewFolder && <button type="button" className="strip-btn files-tool" aria-label="New folder" title="New folder (Ctrl+Shift+N)" onClick={onNewFolder}><svg viewBox="0 0 20 20" aria-hidden="true">{GLYPH.newFolder}</svg></button>}
      {filter && (
        <input className="side-search files-filter" type="search" aria-label="Filter this folder" placeholder="Filter" value={files.query}
          onChange={(e) => files.setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') files.setQuery(''); }} />
      )}
    </header>
  );
}

/** The open folder of the drive, or Made by Mobius. Click selects, double-click or Enter opens: files open in their own app. */
export function FilesPage({ files, onOpenFile, onAsk }: { files: FilesState; onOpenFile: (path: string) => void; onAsk?: ((prompt: string) => void) | undefined }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ path: string; type: FileEntry['type']; x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const here = files.place.kind === 'folder' ? files.place.path : '';
  useEffect(() => { setSelected(null); setRenaming(null); }, [files.place]);
  // Alt+Left and Alt+Right go Back and Forward, as in Explorer and a browser.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'N' || e.key === 'n') && files.place.kind === 'folder' && files.can.change) { e.preventDefault(); void startNewFolder(); return; }
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      // Typing keeps Alt+arrows for moving by word.
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); files.back(); }
      if (e.key === 'ArrowRight') { e.preventDefault(); files.forward(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  const rows = useMemo(() => {
    const q = files.query.trim().toLowerCase();
    const join = (name: string) => (here ? `${here}/${name}` : name);
    return sortEntries(files.entries.filter((e) => !q || e.name.toLowerCase().includes(q)), files.sort, here).map((e) => ({ ...e, path: join(e.name) }));
  }, [files.entries, files.query, files.sort, here]);
  if (!files.available) return <section className="skills-page empty" aria-label="Files"><p className="note-empty">Files are not available here.</p></section>;
  const proposed = new Set(files.made.files);
  const open = (path: string, type: FileEntry['type']) => (type === 'folder' ? files.setPlace({ kind: 'folder', path }) : onOpenFile(path));
  // An app's own folder (notes/, docs/...) holds that app: it can be opened, never renamed or thrown away from here.
  const fixed = (path: string) => !path.includes('/') && appOf(path) !== null;
  const changeable = (path: string) => files.can.change && !fixed(path);
  const trash = (path: string) => { setSelected(null); void files.trash(path); };
  const menuItems = (path: string, type: FileEntry['type']): ContextMenuItem[] => [
    { action: 'open', run: () => open(path, type) },
    ...(changeable(path) ? [{ action: 'rename' as const, keys: 'F2', run: () => setRenaming(path) }] : []),
    { action: 'copy', label: 'Copy path', run: () => void navigator.clipboard?.writeText(path).catch(() => undefined) },
    ...(files.can.show ? [{ action: 'reveal' as const, label: SHOW_IN, run: () => files.show(path) }] : []),
    ...(onAsk ? [{ label: 'Ask Mobius about this', separated: true, run: () => onAsk(type === 'folder' ? `What is in the folder ${path}/?` : `Tell me about ${path}.`) }] : []),
    ...(changeable(path) ? [{ action: 'delete' as const, label: 'Move to Trash', keys: 'Del', danger: true, separated: true, run: () => trash(path) }] : []),
  ];
  const startNewFolder = async () => {
    const path = await files.newFolder();
    if (path) { setSelected(path); setRenaming(path); }
  };
  const finishRename = async (path: string, name: string) => {
    setRenaming(null);
    if (!name.trim() || name.trim() === path.split('/').pop()) return;
    const to = await files.rename(path, name.trim());
    if (to) setSelected(to);
  };
  const nameCell = (path: string, label: string) => (renaming === path ? (
    <input className="files-rename" autoFocus aria-label={`New name for ${label}`} defaultValue={label}
      onFocus={(e) => { const dot = label.lastIndexOf('.'); e.currentTarget.setSelectionRange(0, dot > 0 ? dot : label.length); }}
      onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') void finishRename(path, e.currentTarget.value); if (e.key === 'Escape') setRenaming(null); }}
      onBlur={(e) => void finishRename(path, e.currentTarget.value)} />
  ) : <span className="files-label">{label}</span>);
  const bars = (
    <>
      {files.notice && <p className="field-error files-notice" role="alert">{files.notice} <button type="button" className="review-btn" onClick={files.dismissNotice}>OK</button></p>}
      {files.trashed && (
        <div className="files-trashed" role="status">
          <span>Moved “{files.trashed.path.split('/').pop()}” to the Trash.</span>
          <button type="button" className="review-btn" onClick={() => void files.putBack()}>Undo</button>
          <button type="button" className="review-btn" aria-label="Dismiss" onClick={files.dismissTrashed}>✕</button>
        </div>
      )}
    </>
  );
  // Portalled to the page body: the stage's column rule would otherwise stretch the menu to the list's width.
  const fileMenu = menu && createPortal(
    <ContextMenu x={menu.x} y={menu.y} label={menu.path.split('/').pop() ?? menu.path} items={menuItems(menu.path, menu.type)} onClose={() => setMenu(null)} />,
    document.body,
  );

  if (files.place.kind === 'made') {
    return (
      <section className="skills-page files-page" aria-label="Made by Mobius">
        <FilesBar files={files} title="Made by Mobius" filter={false} />
        {bars}
        {files.made.files.length === 0 ? (
          <div className="files-empty"><svg className="files-icon" data-size="hero" data-glyph="made" viewBox="0 0 20 20" aria-hidden="true">{GLYPH.made}</svg><p className="note-empty">Nothing is waiting. What Mobius makes shows here until you keep it.</p></div>
        ) : (
          <>
            <div className="files-review" role="group" aria-label="Mobius's change">
              <span>{files.made.files.length === 1 ? 'One file from Mobius' : `${files.made.files.length} files from Mobius`}<WhyThis conversation={files.conversation} /></span>
              <ReviewActions onKeep={files.keep} onDiscard={files.discard} />
            </div>
            <div className="files-table" role="listbox" aria-label="Made by Mobius">
              {files.made.files.map((path) => {
                const what = describeChange(path);
                return (
                  <div key={path} role="option" tabIndex={-1} aria-selected={selected === path} className="files-row" data-proposed aria-label={`${what.name}, from Mobius`}
                    onClick={() => setSelected(path)} onDoubleClick={() => onOpenFile(path)} onKeyDown={(e) => { if (e.key === 'Enter') onOpenFile(path); }}
                    onContextMenu={(e) => { e.preventDefault(); setSelected(path); setMenu({ path, type: 'file', x: e.clientX, y: e.clientY }); }}>
                    <span className="files-cell files-name"><FileIcon path={path} type="file" /><span className="files-label">{what.name}</span></span>
                    <span className="files-cell files-kind">{what.kind}</span>
                    <span className="files-cell files-where">{path.split('/').slice(0, -1).join('/')}</span>
                  </div>
                );
              })}
            </div>
          </>
        )}
        {fileMenu}
      </section>
    );
  }

  const parts = here ? here.split('/') : [];
  const title = parts.length === 0 ? 'Workspace' : (parts.length === 1 && appOf(parts[0]!) ? appName(appOf(parts[0]!)!) : parts[parts.length - 1]!);
  const sortBy = (by: FilesSort['by']) => files.setSort(files.sort.by === by ? { by, down: !files.sort.down } : { by, down: false });
  const head = (by: FilesSort['by'], label: string) => (
    <button type="button" role="columnheader" className="files-col" data-col={by} aria-sort={files.sort.by === by ? (files.sort.down ? 'descending' : 'ascending') : 'none'} onClick={() => sortBy(by)}>
      {label}{files.sort.by === by && <span className="files-sort" aria-hidden="true">{files.sort.down ? '▾' : '▴'}</span>}
    </button>
  );
  const move = (step: number) => {
    if (rows.length === 0) return;
    const at = rows.findIndex((r) => r.path === selected);
    const next = rows[Math.max(0, Math.min(rows.length - 1, at < 0 ? 0 : at + step))]!;
    setSelected(next.path);
    listRef.current?.querySelector<HTMLElement>(`[data-path="${CSS.escape(next.path)}"]`)?.focus();
  };
  const onListKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Home') { e.preventDefault(); move(-rows.length); }
    else if (e.key === 'End') { e.preventDefault(); move(rows.length); }
    else if (e.key === 'Enter') { const r = rows.find((x) => x.path === selected); if (r) { e.preventDefault(); open(r.path, r.type); } }
    else if (e.key === 'F2' && selected && changeable(selected)) { e.preventDefault(); setRenaming(selected); }
    else if (e.key === 'Delete' && selected && changeable(selected)) { e.preventDefault(); trash(selected); }
    else if (e.key === 'Backspace' && parts.length > 0) { e.preventDefault(); files.setPlace({ kind: 'folder', path: parts.slice(0, -1).join('/') }); }
  };
  return (
    <section className="skills-page files-page" aria-label="Files">
      <FilesBar files={files} title={title} filter onNewFolder={files.can.change ? () => void startNewFolder() : undefined} />
      {bars}
      {parts.length > 0 && <nav className="files-crumbs" aria-label="Folder">
        <button type="button" className="review-btn" aria-current={parts.length === 0 ? 'page' : undefined} onClick={() => files.setPlace({ kind: 'folder', path: '' })}>Workspace</button>
        {parts.map((p, i) => (
          <span key={i}>
            <span aria-hidden="true"> › </span>
            <button type="button" className="review-btn" aria-current={i === parts.length - 1 ? 'page' : undefined} onClick={() => files.setPlace({ kind: 'folder', path: parts.slice(0, i + 1).join('/') })}>{p}</button>
          </span>
        ))}
      </nav>}
      {files.problem && <p className="field-error" role="alert">{files.problem}</p>}
      {!files.problem && files.entries.length === 0 && (
        <div className="files-empty"><svg className="files-icon" data-size="hero" data-glyph="folder" viewBox="0 0 20 20" aria-hidden="true">{GLYPH.folder}</svg><p className="note-empty">This folder is empty.</p></div>
      )}
      {!files.problem && files.entries.length > 0 && (
        <div className="files-table" role="grid" aria-label="Files in this folder" aria-rowcount={rows.length + 1}>
          <div className="files-head" role="row">{head('name', 'Name')}{head('modified', 'Date Modified')}{head('kind', 'Kind')}{head('size', 'Size')}</div>
          <div ref={listRef} role="rowgroup" onKeyDown={onListKey}>
            {rows.length === 0 && <p className="note-empty files-none">Nothing here matches “{files.query}”.</p>}
            {rows.map((e) => {
              // A file from Mobius is dashed until kept; a folder only says how many such files it holds, so a drive
              // where Mobius made a little everywhere does not turn every row dashed.
              const held = e.type === 'folder' ? files.made.files.filter((f) => f.startsWith(`${e.path}/`)).length : 0;
              const mine = e.type === 'file' ? proposed.has(e.path) : held > 0;
              return (
                <div key={e.name} role="row" tabIndex={selected === e.path || (!selected && e === rows[0]) ? 0 : -1} data-path={e.path} aria-selected={selected === e.path}
                  className="files-row" data-proposed={(mine && e.type === 'file') || undefined} aria-label={mine ? `${e.name}, from Mobius` : e.name}
                  onClick={() => setSelected(e.path)} onDoubleClick={() => open(e.path, e.type)}
                  onContextMenu={(ev) => { ev.preventDefault(); setSelected(e.path); setMenu({ path: e.path, type: e.type, x: ev.clientX, y: ev.clientY }); }}>
                  <span role="gridcell" className="files-cell files-name"><FileIcon path={e.path} type={e.type} />{nameCell(e.path, e.name)}</span>
                  <span role="gridcell" className="files-cell files-date">{e.modified ? relativeTime(e.modified, Date.now()) : '—'}</span>
                  <span role="gridcell" className="files-cell files-kind">{fileKind(e.path, e.type)}{held > 0 && <span className="files-held"> · {held} from Mobius</span>}</span>
                  <span role="gridcell" className="files-cell files-size">{e.type === 'folder' ? '—' : size(e.bytes)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {fileMenu}
    </section>
  );
}
