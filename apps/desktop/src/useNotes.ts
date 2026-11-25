import { useCallback, useEffect, useRef, useState } from 'react';
import { isNotesFailure, type DeletedNote, type NoteHit, type Notebook } from '@mobius/shared';
import { liveTitle, onPageChanged, type SaveStatus } from './notes-state';
import { saveBeforeQuit } from './saveBeforeQuit';

const SAVE_DELAY_MS = 500;
/** Said when another page is asked for while the open one waits on Keep mine or Use their version. */
export const CHOOSE_FIRST = 'Choose Keep mine or Use their version first.';

/** The page last open, so Notes (or Docs) opens on it again (after a restart too). Per device; nothing breaks without it. */
const lastKey = (kind: NotesKind) => `mobius.${kind}.last`;

export interface OpenPage { path: string; title: string; base: number | null }

/**
 * The Notes app's state: the notebooks, the open page and its text, and saving as the person types. Docs keeps its
 * documents the same way, in folders, so it uses this too (`kind` 'docs').
 */
/** The kinds that open their newest item when nothing was open before. */
// Music (marked, Music's own): a song opens on arrival too, never "No song open".
const OPENS_NEWEST: ReadonlySet<NotesKind> = new Set(['docs', 'slides', 'songs']);
/** The most recently changed page, if any. */
export function newestPage<T extends { modified: number }>(pages: readonly T[]): T | undefined {
  return pages.reduce<T | undefined>((best, pg) => (!best || pg.modified > best.modified ? pg : best), undefined);
}

export type NotesKind = 'notes' | 'docs' | 'slides' | 'designs' | 'songs' | 'boards' | 'research' | 'reading' | 'wiki' | 'views';
export function useNotes(kind: NotesKind = 'notes', active = true) {
  const api = window.mobius[kind];
  const remembered = useCallback((): string | null => { try { return window.localStorage.getItem(lastKey(kind)); } catch { return null; } }, [kind]);
  const remember = useCallback((path: string | null) => {
    try { if (path) window.localStorage.setItem(lastKey(kind), path); else window.localStorage.removeItem(lastKey(kind)); } catch { /* Not kept. */ }
  }, [kind]);
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  /** The list has been read once: until then an empty list means "not known yet", not "nothing here". */
  const [loaded, setLoaded] = useState(false);
  const [page, setPage] = useState<OpenPage | null>(null);
  const [text, setText] = useState('');
  const [status, setStatus] = useState<SaveStatus>('saved');
  const [message, setMessage] = useState('');
  // The latest values, for the save timer and the change listener (which outlive a render).
  // How many times the open page was read again because Mobius (or an undo) changed it, so a review can be worked out
  // again from what is on screen now.
  const [reloads, setReloads] = useState(0);
  const live = useRef({ page, text, status });
  live.current = { page, text, status };
  const timer = useRef<number | undefined>(undefined);

  // Lists overlap (a change on disk, a delete, a new page each list again); only the newest is shown, so an older
  // answer arriving late cannot bring back a page that was just deleted.
  const listed = useRef(0);
  const refresh = useCallback(async () => {
    const read = ++listed.current;
    const list = await api?.list();
    if (read === listed.current && list && !isNotesFailure(list)) setNotebooks(list);
    if (read === listed.current) setLoaded(true);
    return list && !isNotesFailure(list) ? list : null;
  }, [api]);

  // Saves go one after another, each with the base the one before it left: a second save sent while the first is still
  // on its way would carry the old base and be refused as a conflict, losing the edit (design.spec:223 saw that).
  const saving = useRef<Promise<boolean>>(Promise.resolve(true));
  const saveNow = useCallback(async (force = false): Promise<boolean> => {
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
    // The next save, if one waits, goes with this base before the page has drawn again.
    if (live.current.page?.path === p.path) live.current = { ...live.current, page: { ...live.current.page, base: result.modified } };
    // Typing went on while saving: keep it marked as edited, the next timer saves it.
    setStatus(live.current.text === sent ? 'saved' : 'unsaved');
    // A save that failed before said why in the status line; now that one went through, that is no longer true.
    setMessage('');
    return true;
  }, [api]);
  const save = useCallback((force = false): Promise<boolean> => {
    const next = saving.current.then(() => saveNow(force), () => saveNow(force));
    saving.current = next.catch(() => false);
    return next;
  }, [saveNow]);
  /** Before the window goes: what was typed is written. A save that failed is tried again; text the person has not
   *  yet chosen to keep over a version changed elsewhere is kept as a copy beside it, so neither is lost. */
  const keepBeforeGoing = useCallback(async () => {
    const { page: p, status: s, text: mine } = live.current;
    if (!p || !api) { await saving.current; return; }
    if (s === 'unsaved' || s === 'error') { await save(); return; }
    if (s === 'conflict') {
      const made = await api.createPage(p.path.split('/')[0] ?? '', `${liveTitle(mine, p.title || 'Note')} (your version)`);
      if (!isNotesFailure(made)) await api.save(made.path, mine, made.modified);
      return;
    }
    await saving.current;
  }, [api, save]);
  // Quitting (the tray's Quit, or the installer replacing Mobius) waits for an edit not yet written.
  useEffect(() => saveBeforeQuit(keepBeforeGoing), [keepBeforeGoing]);

  // Whether a page is being read, so an item offered while one is on its way does not take its place.
  const loading = useRef(0);
  // Pages asked for one after another (a quick click on one, then another) can be read in either order: only the
  // newest is shown, so the page open is always the one asked for last.
  const asked = useRef(0);
  const load = useCallback(async (path: string, title = '') => {
    if (!api) return;
    const ask = ++asked.current;
    loading.current++;
    const got = await api.read(path).finally(() => { loading.current--; });
    if (ask !== asked.current) return;
    if (isNotesFailure(got)) { setMessage(got.message); return; }
    // Typing went on in the page being left while this one was read: it is saved before the page goes.
    const before = live.current;
    if (before.page && before.page.path !== path && (before.status === 'unsaved' || before.status === 'saving') && !(await save())) return;
    if (ask !== asked.current) return;
    setPage({ path, title, base: got.modified });
    setText(got.content);
    setStatus('saved');
    setMessage('');
    remember(path);
  }, [api, remember, save]);

  /** Whether the open page can be left: what was typed is saved first. While the person has not yet chosen between
   *  their text and a version changed elsewhere, it cannot: leaving would drop their text without asking. */
  const leave = useCallback(async (): Promise<boolean> => {
    const { page: p, status: s } = live.current;
    if (!p || s === 'saved') return true;
    if (s === 'conflict') { setMessage(CHOOSE_FIRST); return false; }
    return save();
  }, [save]);

  const open = useCallback(async (path: string, title = '') => {
    if (live.current.page?.path === path) return;
    if (!(await leave())) return;
    await load(path, title);
  }, [leave, load]);

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
    if (!(await leave())) return null;
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
  }, [api, refresh, leave, remember]);

  const remove = useCallback(async (path: string) => {
    // The open page is closed first, so nothing of it is still in use while it goes: no save of it lands after the
    // delete, and its pictures are no longer shown (on Windows a picture being shown can keep its folder from going).
    // A caller that has just opened another page (Reader's Done reading opens the archived copy, then removes the
    // original) has its new page rendered first, so only the page really still open is closed.
    await new Promise((settle) => setTimeout(settle, 0));
    if (live.current.page?.path === path) {
      setPage(null); setText(''); setStatus('saved');
      await new Promise((settle) => setTimeout(settle, 0));
    }
    const done = await api?.remove(path);
    if (done && isNotesFailure(done)) { setMessage(done.message); await refresh(); return; }
    if (remembered() === path) remember(null);
    await refresh();
  }, [api, refresh, remembered, remember]);

  // The Trash (Notes only: the other apps keeping pages this way delete for good). Read when the list is, so its
  // section stays true after a delete, a restore, or a change made elsewhere.
  const [trashed, setTrashed] = useState<DeletedNote[]>([]);
  /** What was just moved to the Trash, for the Undo pill ("Moved “Work” and 12 notes to the Trash"). */
  const [justTrashed, setJustTrashed] = useState<{ id: string; text: string } | null>(null);
  useEffect(() => { if (!justTrashed) return undefined; const t = window.setTimeout(() => setJustTrashed(null), 8000); return () => window.clearTimeout(t); }, [justTrashed]);
  const readTrash = useCallback(async () => {
    const got = await api?.deleted?.();
    if (got && !isNotesFailure(got)) setTrashed(got);
  }, [api]);
  /** Closes the open page when `gone` says it is going, so nothing of it is saved or shown while it moves. */
  const closeIf = useCallback(async (gone: (path: string) => boolean): Promise<boolean> => {
    const p = live.current.page;
    if (!p || !gone(p.path)) return false;
    if (!(await leave())) return true;
    setPage(null); setText(''); setStatus('saved');
    await new Promise((settle) => setTimeout(settle, 0));
    return false;
  }, [leave]);
  const failed = useCallback(async (result: unknown): Promise<boolean> => {
    if (!result) return true;
    if (isNotesFailure(result as never)) { setMessage((result as { message: string }).message); await refresh(); return true; }
    return false;
  }, [refresh]);

  /** The page (and its files, comments and versions) into the Trash, kept 30 days. */
  const trash = useCallback(async (path: string) => {
    if (!api?.trash) return;
    if (await closeIf((p) => p === path)) return;
    const title = notebooks.flatMap((nb) => nb.pages).find((pg) => pg.path === path)?.title ?? path.slice(path.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '');
    const done = await api.trash(path);
    if (!done || await failed(done)) return;
    setJustTrashed({ id: (done as { id: string }).id, text: `Moved “${title}” to the Trash` });
    if (remembered() === path) remember(null);
    await Promise.all([refresh(), readTrash()]);
  }, [api, notebooks, closeIf, failed, refresh, readTrash, remembered, remember]);

  /** The whole notebook into the Trash, its pages with it. */
  const trashNotebook = useCallback(async (name: string) => {
    if (!api?.trashNotebook) return;
    if (await closeIf((p) => p.startsWith(`${name}/`))) return;
    const count = notebooks.find((nb) => nb.name === name)?.pages.length ?? 0;
    const done = await api.trashNotebook(name);
    if (!done || await failed(done)) return;
    setJustTrashed({ id: (done as { id: string }).id, text: count ? `Moved “${name}” and ${count === 1 ? '1 note' : `${count} notes`} to the Trash` : `Moved “${name}” to the Trash` });
    if (remembered()?.startsWith(`${name}/`)) remember(null);
    await Promise.all([refresh(), readTrash()]);
  }, [api, notebooks, closeIf, failed, refresh, readTrash, remembered, remember]);

  /** The open page, if it was under `was`, opened again where it now is. */
  const reopenAt = useCallback(async (was: string, now: string) => {
    if (remembered() === was) remember(now);
    const p = live.current.page;
    if (p && p.path === was) await load(now, p.title);
  }, [load, remembered, remember]);

  const renameNotebook = useCallback(async (from: string, to: string): Promise<boolean> => {
    if (!api?.renameNotebook || !to.trim() || to.trim() === from) return false;
    if (!(await leave())) return false;
    const done = await api.renameNotebook(from, to.trim());
    if (!done || await failed(done)) return false;
    const name = (done as { name: string }).name;
    await refresh();
    const p = live.current.page;
    if (p?.path.startsWith(`${from}/`)) await reopenAt(p.path, `${name}/${p.path.slice(from.length + 1)}`);
    const last = remembered();
    if (last?.startsWith(`${from}/`)) remember(`${name}/${last.slice(from.length + 1)}`);
    return true;
  }, [api, leave, failed, refresh, reopenAt, remembered, remember]);

  /** The page into another notebook; links to it from other pages follow it. */
  const move = useCallback(async (path: string, notebook: string) => {
    if (!api?.move || path.split('/')[0] === notebook) return;
    if (live.current.page?.path === path && !(await leave())) return;
    const done = await api.move(path, notebook);
    if (!done || await failed(done)) return;
    await refresh();
    await reopenAt(path, (done as { path: string }).path);
  }, [api, leave, failed, refresh, reopenAt]);

  /** Back where it was; a page put back is opened. */
  const restore = useCallback(async (id: string) => {
    if (!api?.restore) return;
    setJustTrashed((j) => (j?.id === id ? null : j));
    const done = await api.restore(id);
    if (!done || isNotesFailure(done)) { if (done) setMessage(done.message); await Promise.all([refresh(), readTrash()]); return; }
    await Promise.all([refresh(), readTrash()]);
    if (done.kind === 'page' && (await leave())) await load(done.path, done.path.slice(done.path.lastIndexOf('/') + 1).replace(/\.[^.]+$/, ''));
  }, [api, failed, refresh, readTrash, leave, load]);

  /** One thing in the Trash gone for good, or everything in it with null. */
  const forget = useCallback(async (id: string | null) => {
    if (!api?.forget) return;
    const done = await api.forget(id);
    if (done && isNotesFailure(done)) setMessage(done.message);
    await readTrash();
  }, [api, readTrash]);

  const search = useCallback(async (query: string): Promise<NoteHit[]> => {
    const hits = await api?.search(query);
    return hits && !isNotesFailure(hits) ? hits : [];
  }, [api]);

  useEffect(() => {
    // Nothing is read until the app is first opened (Abilities: apps load when they are used).
    if (!active) return undefined;
    // The first list opens the page that was open last, if it is still there and nothing else was opened meanwhile.
    // Docs and Slides open the newest one when none was open, so a first visit never lands on an empty window.
    void readTrash();
    void refresh().then((list) => {
      const last = remembered();
      const pages = list?.flatMap((nb) => nb.pages) ?? [];
      const found = (last ? pages.find((pg) => pg.path === last) : undefined) ?? (OPENS_NEWEST.has(kind) ? newestPage(pages) : undefined);
      if (found && !live.current.page) void load(found.path, found.title);
    });
    return api?.onChanged((change) => {
      const listed = refresh();
      void readTrash();
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
      if (action === 'reload' && p) void load(p.path, p.title).then(() => setReloads((n) => n + 1));
      if (action === 'ask') setStatus('conflict');
    });
  }, [active, api, refresh, readTrash, load, remembered, kind]);

  // Nothing typed is lost when the window goes away.
  useEffect(() => () => { void keepBeforeGoing(); }, [keepBeforeGoing]);

  /** Opens `path` only when no page is open or on its way: for something Mobius changed, offered on arrival. */
  const openIfIdle = useCallback((path: string, title = '') => {
    if (live.current.page || loading.current > 0) return;
    void load(path, title);
  }, [load]);

  return { kind, openIfIdle, available: api !== undefined, loaded, notebooks, page, text, status, message, reloads, open, edit, resolve, createNotebook, createPage, remove, search,
    // Notes' notebooks and Trash; absent (undefined) where the app's pages are not kept that way.
    trashed, justTrashed, clearJustTrashed: () => setJustTrashed(null), trash: api?.trash ? trash : undefined, trashNotebook: api?.trashNotebook ? trashNotebook : undefined,
    renameNotebook: api?.renameNotebook ? renameNotebook : undefined, move: api?.move ? move : undefined, restore, forget };
}

export type NotesState = ReturnType<typeof useNotes>;
