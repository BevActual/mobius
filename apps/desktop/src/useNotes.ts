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
/** The kinds that open their newest item when nothing was open before. */
const OPENS_NEWEST: ReadonlySet<NotesKind> = new Set(['docs', 'slides']);
/** The most recently changed page, if any. */
export function newestPage<T extends { modified: number }>(pages: readonly T[]): T | undefined {
  return pages.reduce<T | undefined>((best, pg) => (!best || pg.modified > best.modified ? pg : best), undefined);
}

export type NotesKind = 'notes' | 'docs' | 'slides' | 'designs' | 'songs' | 'boards' | 'research' | 'reading' | 'wiki';
export function useNotes(kind: NotesKind = 'notes', active = true) {
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

  // Whether a page is being read, so an item offered while one is on its way does not take its place.
  const loading = useRef(0);
  const load = useCallback(async (path: string, title = '') => {
    if (!api) return;
    loading.current++;
    const got = await api.read(path).finally(() => { loading.current--; });
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

  /** Makes a page and opens it; `content`, when given, is what it holds instead of the usual start. Gives its path. */
  const createPage = useCallback(async (notebook: string, title = 'Untitled', content?: string): Promise<string | null> => {
    if (live.current.page && live.current.status === 'unsaved') await save();
    const made = await api?.createPage(notebook, title);
    if (!made || isNotesFailure(made)) { if (made) setMessage(made.message); return null; }
    let { content: text, modified } = made;
    if (content !== undefined) {
      const written = await api!.save(made.path, content, made.modified);
      if (!isNotesFailure(written)) { text = content; modified = written.modified; }
    }
    await refresh();
    remember(made.path);
    setPage({ path: made.path, title, base: modified });
    setText(text);
    setStatus('saved');
    return made.path;
  }, [api, refresh, save, remember]);

  const remove = useCallback(async (path: string) => {
    // The open page is closed first, so nothing of it is still in use while it goes: no save of it lands after the
    // delete, and its pictures are no longer shown (on Windows a picture being shown can keep its folder from going).
    if (live.current.page?.path === path) {
      setPage(null); setText(''); setStatus('saved');
      await new Promise((settle) => setTimeout(settle, 0));
    }
    const done = await api?.remove(path);
    if (done && isNotesFailure(done)) { setMessage(done.message); await refresh(); return; }
    if (remembered() === path) remember(null);
    await refresh();
  }, [api, refresh, remembered, remember]);

  const search = useCallback(async (query: string): Promise<NoteHit[]> => {
    const hits = await api?.search(query);
    return hits && !isNotesFailure(hits) ? hits : [];
  }, [api]);

  useEffect(() => {
    // Nothing is read until the app is first opened (Abilities: apps load when they are used).
    if (!active) return undefined;
    // The first list opens the page that was open last, if it is still there and nothing else was opened meanwhile.
    // Docs and Slides open the newest one when none was open, so a first visit never lands on an empty window.
    void refresh().then((list) => {
      const last = remembered();
      const pages = list?.flatMap((nb) => nb.pages) ?? [];
      const found = (last ? pages.find((pg) => pg.path === last) : undefined) ?? (OPENS_NEWEST.has(kind) ? newestPage(pages) : undefined);
      if (found && !live.current.page) void load(found.path, found.title);
    });
    return api?.onChanged((change) => {
      const listed = refresh();
      // Something Mobius made or changed opens when nothing else is open, so it can be seen and reviewed.
      if (change.by === 'assistant' && change.path && !live.current.page) {
        const path = change.path;
        void listed.then((list) => {
          const made = list?.flatMap((nb) => nb.pages).find((pg) => pg.path === path);
          if (made && !live.current.page) void load(made.path, made.title);
        });
        return;
      }
      const { page: p, status: s } = live.current;
      const action = onPageChanged(s, p !== null && change.path === p.path, change.by);
      if (action === 'reload' && p) void load(p.path, p.title);
      if (action === 'ask') setStatus('conflict');
    });
  }, [active, api, refresh, load, remembered, kind]);

  // Nothing typed is lost when the window goes away.
  useEffect(() => () => { if (live.current.status === 'unsaved') void save(); }, [save]);

  /** Opens `path` only when no page is open or on its way: for something Mobius changed, offered on arrival. */
  const openIfIdle = useCallback((path: string, title = '') => {
    if (live.current.page || loading.current > 0) return;
    void load(path, title);
  }, [load]);

  return { kind, openIfIdle, available: api !== undefined, notebooks, page, text, status, message, open, edit, resolve, createNotebook, createPage, remove, search };
}

export type NotesState = ReturnType<typeof useNotes>;
