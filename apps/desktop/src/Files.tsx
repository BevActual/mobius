import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { FileEntry } from '@mobius/shared';
import { describeChange, KEPT_EVENT, keepTurn, keptTurns, turnId } from './ReviewStrip';
import { ReviewActions, WhyThis } from './ReviewBar';

/** Where Files is looking: a folder of the workspace, or what Mobius made. */
export type FilesPlace = { kind: 'folder'; path: string } | { kind: 'made' };

/** The Files app: the whole workspace as a drive, and what Mobius made, dashed until it is kept. */
export function useFiles(conversation: string, busy: boolean) {
  const [place, setPlace] = useState<FilesPlace>({ kind: 'folder', path: '' });
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [made, setMade] = useState<{ files: string[]; turn: string | null }>({ files: [], turn: null });
  const folder = place.kind === 'folder' ? place.path : '';
  const list = useCallback(async () => {
    const result = await window.mobius.files?.list(folder).catch(() => null);
    if (!result) { setEntries([]); setProblem(window.mobius.files ? 'That folder could not be read.' : null); return; }
    if ('error' in result) { setEntries([]); setProblem(result.error); return; }
    setEntries(result.entries); setProblem(null);
  }, [folder]);
  const loadMade = useCallback(async () => {
    const result = await window.mobius.changes?.lastTurn(conversation).catch(() => null);
    const turn = result && 'files' in result ? turnId(conversation, result.checkpoint) : null;
    setMade(result && 'files' in result && !(turn && keptTurns().includes(turn)) ? { files: result.files, turn } : { files: [], turn: null });
  }, [conversation]);
  useEffect(() => { void list(); }, [list]);
  useEffect(() => { if (!busy) { void loadMade(); void list(); } }, [busy, loadMade, list]);
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
  return { place, setPlace, entries, problem, made, conversation, keep, discard, available: window.mobius.files !== undefined };
}
export type FilesState = ReturnType<typeof useFiles>;

const ICON: Record<'folder' | 'file', ReactNode> = {
  folder: <path d="M3.5 6.5a1.5 1.5 0 0 1 1.5-1.5h3l1.5 1.5h5.5a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5z" />,
  file: <><path d="M6 3.5h5.5l3 3v10H6z" /><path d="M11.5 3.5v3h3" /></>,
};

/** Files' sidebar: the drive, and Made by Mobius with how many things wait. */
export function FilesSidebar({ files, pin }: { files: FilesState; pin?: ReactNode }) {
  const row = (label: string, current: boolean, count: number | null, onClick: () => void) => (
    <li>
      <button type="button" className="list-row" aria-current={current ? 'page' : undefined} onClick={onClick}>
        <span className="list-name">{label}</span>
        {count !== null && count > 0 && <span className="list-count">{count}</span>}
      </button>
    </li>
  );
  return (
    <aside className="side files-side" aria-label="Files sidebar">
      <div className="side-head">
        <span className="side-title">Files</span>
        <span className="side-actions">{pin}</span>
      </div>
      <nav className="task-lists" aria-label="Files">
        <ul role="list">
          {row('Workspace', files.place.kind === 'folder', null, () => files.setPlace({ kind: 'folder', path: '' }))}
          {row('Made by Mobius', files.place.kind === 'made', files.made.files.length, () => files.setPlace({ kind: 'made' }))}
        </ul>
      </nav>
    </aside>
  );
}

const size = (bytes: number | undefined) => (bytes === undefined ? '' : bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

/** The open folder of the drive, or Made by Mobius. Files open in their own app. */
export function FilesPage({ files, onOpenFile }: { files: FilesState; onOpenFile: (path: string) => void }) {
  if (!files.available) return <section className="skills-page empty" aria-label="Files"><p className="note-empty">Files are not available here.</p></section>;
  const proposed = new Set(files.made.files);
  if (files.place.kind === 'made') {
    return (
      <section className="skills-page files-page" aria-label="Made by Mobius">
        <h1 className="ext-title">Made by Mobius</h1>
        {files.made.files.length === 0 ? <p className="note-empty">Nothing is waiting. What Mobius makes shows here until you keep it.</p> : (
          <>
            <div className="files-review" role="group" aria-label="Mobius's change">
              <span>{files.made.files.length === 1 ? 'One file from Mobius' : `${files.made.files.length} files from Mobius`}<WhyThis conversation={files.conversation} /></span>
              <ReviewActions onKeep={files.keep} onDiscard={files.discard} />
            </div>
            <ul className="clist" role="list" aria-label="Made by Mobius">
              {files.made.files.map((path) => {
                const what = describeChange(path);
                return (
                  <li key={path}>
                    <button type="button" className="clist-item files-row" data-proposed aria-label={`${what.name}, from Mobius`} onClick={() => onOpenFile(path)}>
                      <svg viewBox="0 0 20 20" aria-hidden="true">{ICON.file}</svg>
                      <span className="ext-name">{what.name}</span>
                      <span className="ext-state">{what.kind} · {path.split('/').slice(0, -1).join('/')}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>
    );
  }
  const here = files.place.path;
  const parts = here ? here.split('/') : [];
  const join = (name: string) => (here ? `${here}/${name}` : name);
  return (
    <section className="skills-page files-page" aria-label="Files">
      <nav className="files-crumbs" aria-label="Folder">
        <button type="button" className="review-btn" aria-current={parts.length === 0 ? 'page' : undefined} onClick={() => files.setPlace({ kind: 'folder', path: '' })}>Workspace</button>
        {parts.map((p, i) => (
          <span key={i}>
            <span aria-hidden="true"> › </span>
            <button type="button" className="review-btn" aria-current={i === parts.length - 1 ? 'page' : undefined} onClick={() => files.setPlace({ kind: 'folder', path: parts.slice(0, i + 1).join('/') })}>{p}</button>
          </span>
        ))}
      </nav>
      {files.problem && <p className="field-error" role="alert">{files.problem}</p>}
      {!files.problem && files.entries.length === 0 && <p className="note-empty">This folder is empty.</p>}
      <ul className="clist" role="list" aria-label="Files in this folder">
        {files.entries.map((e) => {
          const path = join(e.name);
          // A file from Mobius is dashed until kept; a folder only says how many such files it holds, so a drive
          // where Mobius made a little everywhere does not turn every row dashed.
          const held = e.type === 'folder' ? files.made.files.filter((f) => f.startsWith(`${path}/`)).length : 0;
          const mine = e.type === 'file' ? proposed.has(path) : held > 0;
          return (
            <li key={e.name}>
              <button type="button" className="clist-item files-row" data-proposed={(mine && e.type === 'file') || undefined} aria-label={mine ? `${e.name}, from Mobius` : e.name}
                onClick={() => (e.type === 'folder' ? files.setPlace({ kind: 'folder', path }) : onOpenFile(path))}>
                <svg viewBox="0 0 20 20" aria-hidden="true">{ICON[e.type]}</svg>
                <span className="ext-name">{e.name}</span>
                <span className="ext-state">{e.type === 'folder' ? (held > 0 ? `Folder · ${held} from Mobius` : 'Folder') : size(e.bytes)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
