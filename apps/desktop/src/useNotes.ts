import { useCallback, useEffect, useRef, useState } from 'react';
import { isNotesFailure, type NoteHit, type Notebook } from '@mobius/shared';
import { onPageChanged, type SaveStatus } from './notes-state';

const SAVE_DELAY_MS = 500;

/** The page last open, so Notes (or Docs) opens on it again (after a restart too). Per device; nothing breaks without it. */
const lastKey = (kind: NotesKind) => `mobius.${kind}.last`;

export interface OpenPage { path: string; title: string; base: number | null }

/**
 * The Notes app's state: the notebooks, the open page and its text, and saving as the person types. Docs keeps its
 * documents the same way, in folders, so it uses this too (`kind` 'docs').
 */
export type NotesKind = 'notes' | 'docs' | 'slides' | 'designs' | 'songs' | 'boards';
export function useNotes(kind: NotesKind = 'notes') {
  const api = window.mobius[kind];
  const remembered = useCallback((): string | null => { try { return window.localStorage.getItem(lastKey(kind)); } catch { return null; } }, [kind]);
  const remember = useCallback((path: string | null) => {
    try { if (path) window.localStorage.setItem(lastKey(kind), path); else window.localStorage.removeItem(lastKey(kind)); } catch { /* Not kept. */ }
  }, [kind]);
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [page, setPage] = useState<OpenPage | null>(null);
  const [text, setText] = useState('');
  const [status, setStatus] = useState<SaveStatus>('saved');
  const [message, setMessage] = useState('');
  // The latest values, for the save timer and the change listener (which outlive a render).
  const live = useRef({ page, text, status });
  live.current = { page, text, status };
  const timer = useRef<number | undefined>(undefined);

  const refresh = useCallback(async () => {
    const list = await api?.list();
    if (list && !isNotesFailure(list)) setNotebooks(list);
    return list && !isNotesFailure(list) ? list : null;
  }, [api]);

  const save = useCallback(async (force = false): Promise<boolean> => {
    window.clearTimeout(timer.current);
    const { page: p, text: sent } = live.current;
    if (!api || !p) return true;
    setStatus('saving');
    const result = await api.save(p.path, sent, force ? null : p.base);
    if (isNotesFailure(result)) {
      setStatus(result.conflict ? 'conflict' : 'error');
      setMessage(result.conflict ? '' : result.message);
      return false;
    }
    setPage((cur) => (cur && cur.path === p.path ? { ...cur, base: result.modified } : cur));
    // Typing went on while saving: keep it marked as edited, the next timer saves it.
    setStatus(live.current.text === sent ? 'saved' : 'unsaved');
    return true;
  }, [api]);

  const load = useCallback(async (path: string, title = '') => {
    if (!api) return;
    const got = await api.read(path);
    if (isNotesFailure(got)) { setMessage(got.message); return; }
    setPage({ path, title, base: got.modified });
    setText(got.content);
    setStatus('saved');
    setMessage('');
    remember(path);
  }, [api, remember]);

  const open = useCallback(async (path: string, title = '') => {
    const { page: p, status: s } = live.current;
    if (p?.path === path) return;
    if (p && s !== 'saved' && s !== 'conflict' && !(await save())) return;
    await load(path, title);
  }, [load, save]);

  const edit = useCallback((next: string) => {
    setText(next);
    if (live.current.status === 'conflict') return; // nothing is saved until the person chooses
    setStatus('unsaved');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void save(), SAVE_DELAY_MS);
  }, [save]);

  /** After a conflict: keep the person's text (overwrite) or take the version on disk. */
  const resolve = useCallback(async (keepMine: boolean) => {
    const p = live.current.page;
    if (!p) return;
    if (keepMine) await save(true);
    else await load(p.path, p.title);
  }, [load, save]);

  const createNotebook = useCallback(async (name: string) => {
    const made = await api?.createNotebook(name);
    if (!made || isNotesFailure(made)) { if (made) setMessage(made.message); return null; }
    await refresh();
    return made.name;
  }, [api, refresh]);

  const createPage = useCallback(async (notebook: string, title = 'Untitled') => {
    if (live.current.page && live.current.status === 'unsaved') await save();
    const made = await api?.createPage(notebook, title);
    if (!made || isNotesFailure(made)) { if (made) setMessage(made.message); return; }
    await refresh();
    remember(made.path);
    setPage({ path: made.path, title, base: made.modified });
    setText(made.content);
    setStatus('saved');
  }, [api, refresh, save, remember]);

  const remove = useCallback(async (path: string) => {
    const done = await api?.remove(path);
    if (done && isNotesFailure(done)) { setMessage(done.message); return; }
    if (live.current.page?.path === path) { setPage(null); setText(''); setStatus('saved'); }
    if (remembered() === path) remember(null);
    await refresh();
  }, [api, refresh, remembered, remember]);

  const search = useCallback(async (query: string): Promise<NoteHit[]> => {
    const hits = await api?.search(query);
    return hits && !isNotesFailure(hits) ? hits : [];
  }, [api]);

  useEffect(() => {
    // The first list opens the page that was open last, if it is still there and nothing else was opened meanwhile.
    void refresh().then((list) => {
      const last = remembered();
      const found = last ? list?.flatMap((nb) => nb.pages).find((pg) => pg.path === last) : undefined;
      if (found && !live.current.page) void load(found.path, found.title);
    });
    return api?.onChanged((change) => {
      void refresh();
      const { page: p, status: s } = live.current;
      const action = onPageChanged(s, p !== null && change.path === p.path, change.by);
      if (action === 'reload' && p) void load(p.path, p.title);
      if (action === 'ask') setStatus('conflict');
    });
  }, [api, refresh, load, remembered]);

  // Nothing typed is lost when the window goes away.
  useEffect(() => () => { if (live.current.status === 'unsaved') void save(); }, [save]);

  return { available: api !== undefined, notebooks, page, text, status, message, open, edit, resolve, createNotebook, createPage, remove, search };
}

export type NotesState = ReturnType<typeof useNotes>;
