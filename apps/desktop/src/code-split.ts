import { useCallback, useEffect, useRef, useState } from 'react';
import { isNotesFailure, type CodeFile } from '@mobius/shared';
import type { CodeState } from './useCode';

/**
 * The second editor of Code's split view: a file of the same project beside the first, with its own text, cursors,
 * find bar and save. The same file in both shares one text (the first editor's), so typing in either shows in the
 * other; another file keeps its own, read and saved here. Which file it holds is remembered for the project.
 */
const KEY = 'mobius.code.split';

function remembered(project: string): string | null {
  try {
    const all: unknown = JSON.parse(window.localStorage.getItem(KEY) ?? '{}');
    const p = typeof all === 'object' && all !== null ? (all as Record<string, unknown>)[project] : null;
    return typeof p === 'string' ? p : null;
  } catch { return null; }
}
function remember(project: string, path: string | null): void {
  try {
    const all = JSON.parse(window.localStorage.getItem(KEY) ?? '{}') as Record<string, string>;
    if (path) all[project] = path; else delete all[project];
    window.localStorage.setItem(KEY, JSON.stringify(all));
  } catch { /* Not kept. */ }
}

export function useSideFile(code: CodeState) {
  const api = window.mobius.code;
  const project = code.project;
  const [path, setPath] = useState<string | null>(null);
  const [file, setFile] = useState<CodeFile | null>(null);
  const [draft, setDraft] = useState('');
  const [message, setMessage] = useState('');
  const live = useRef({ project, path, file, draft });
  live.current = { project, path, file, draft };
  const shared = path !== null && code.open?.path === path;

  const read = useCallback(async (p: string, keepTyping = false) => {
    const name = live.current.project;
    if (!api || !name) return false;
    const got = await api.read(name, p).catch(() => null);
    if (!got || isNotesFailure(got)) { setMessage(got?.message ?? 'That file could not be opened.'); return false; }
    setFile(got);
    if (!keepTyping) setDraft(got.text ?? '');
    setMessage('');
    return true;
  }, [api]);

  const open = useCallback(async (p: string) => {
    if (!live.current.project) return false;
    setPath(p);
    remember(live.current.project, p);
    return read(p);
  }, [read]);

  const close = useCallback(() => {
    setPath(null); setFile(null); setDraft('');
    if (live.current.project) remember(live.current.project, null);
  }, []);

  // A project opens with the split it had.
  useEffect(() => {
    setPath(null); setFile(null); setDraft(''); setMessage('');
    if (!project) return;
    const p = remembered(project);
    if (p) void open(p);
  }, [project]); // eslint-disable-line react-hooks/exhaustive-deps

  // Changed elsewhere (Mobius, another app, the first editor's save): read again unless something typed here waits.
  useEffect(() => {
    if (!api) return undefined;
    return api.onChanged((change) => {
      const now = live.current;
      if (!now.path || !now.project || (change.project && change.project !== now.project)) return;
      if (change.path !== null && change.path !== now.path) return;
      const typing = now.file?.text != null && now.draft !== now.file.text;
      if (!typing) void read(now.path);
    });
  }, [api, read]);

  const save = useCallback(async (text?: string) => {
    const now = live.current;
    if (!api || !now.project || !now.path || !now.file || now.file.text === null) return false;
    const body = text ?? now.draft;
    const done = await api.save(now.project, now.path, body, now.file.modified);
    if (isNotesFailure(done)) {
      setMessage(done.conflict ? 'This file changed since it was opened here. Copy what you typed, then open it again.' : done.message);
      return false;
    }
    setFile({ ...now.file, text: body, modified: done.modified });
    if (text !== undefined) setDraft(text);
    setMessage('');
    return true;
  }, [api]);

  /** The second editor's view of Code: the first's when it shows the same file, else its own file in it. */
  const state: CodeState | null = path === null ? null : shared ? code : {
    ...code,
    open: file,
    draft,
    setDraft,
    dirty: file !== null && file.text !== null && draft !== file.text,
    save,
    message,
    setMessage,
    // A place found from here (go to definition, a problem) opens in this editor.
    openFile: (p: string) => open(p),
  };

  return { path, shared, state, open, close, message };
}
export type SideFile = ReturnType<typeof useSideFile>;
