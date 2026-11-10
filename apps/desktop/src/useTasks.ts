import { useCallback, useEffect, useRef, useState } from 'react';
import { isNotesFailure, type TaskAt, type TaskChange, type TaskItem, type TaskList, type TaskListInfo } from '@mobius/shared';
import { SMART_VIEWS, type SmartView } from './tasks-view';

export type TasksView = { kind: 'list'; name: string } | { kind: 'smart'; id: SmartView };
const FRESH_MS = 4000;
const UNDO_MS = 8000;
const key = (list: string, text: string) => `${list}\u0000${text}`;

/** The view last open, so Tasks opens on it again (after a restart too). Per device; Today when there is none. */
const VIEW_KEY = 'mobius.tasks.view';
const TODAY: TasksView = { kind: 'smart', id: 'today' };
function rememberedView(): TasksView {
  try {
    const v: unknown = JSON.parse(window.localStorage.getItem(VIEW_KEY) ?? 'null');
    if (typeof v === 'object' && v !== null) {
      const { kind, name, id } = v as Record<string, unknown>;
      if (kind === 'list' && typeof name === 'string' && name.length > 0 && name.length <= 200) return { kind, name };
      if (kind === 'smart' && SMART_VIEWS.some((s) => s.id === id)) return { kind, id: id as SmartView };
    }
  } catch { /* Nothing kept. */ }
  return TODAY;
}

/** A task the person picked to look at in the inspector: found again by its words, since lines move. */
export interface Picked { list: string; text: string }
/** What was just deleted, for Undo: a task (with its notes and subtasks) or a whole list. */
export type Deleted = { kind: 'task'; list: string; text: string; line: number; block: string } | { kind: 'list'; list: string; text: string };

/** The Tasks app's state: every list and its tasks, the view that is open, and changes that show at once. */
export function useTasks() {
  const api = window.mobius.tasks;
  const [lists, setLists] = useState<TaskListInfo[]>([]);
  const [all, setAll] = useState<Record<string, TaskItem[]>>({});
  const [view, setViewState] = useState<TasksView>(rememberedView);
  useEffect(() => { try { window.localStorage.setItem(VIEW_KEY, JSON.stringify(view)); } catch { /* Not kept. */ } }, [view]);
  const [message, setMessage] = useState('');
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Picked | null>(null);
  const [deleted, setDeleted] = useState<Deleted | null>(null);
  // Tasks the agent just added or changed, marked for a moment so its work is visible without moving focus.
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const live = useRef(all);
  live.current = all;
  /** Mobius's starts: the sidebar hands over how to fill the message box, for the page's own starts. */
  const ask = useRef<((prompt: string) => void) | null>(null);

  const setView = useCallback((next: TasksView) => { setViewState(next); setQuery(''); setPicked(null); }, []);

  const refresh = useCallback(async (): Promise<Record<string, TaskItem[]>> => {
    const got = await api?.lists();
    if (!got || isNotesFailure(got)) return live.current;
    const next: Record<string, TaskItem[]> = {};
    await Promise.all(got.map(async (l) => {
      const one = await api!.read(l.name);
      next[l.name] = isNotesFailure(one) ? [] : one.tasks;
    }));
    setLists(got);
    setAll(next);
    return next;
  }, [api]);

  useEffect(() => {
    // A remembered list that is gone (deleted, renamed) opens Today instead.
    void refresh().then((got) => setViewState((v) => (v.kind === 'list' && !(v.name in got) ? TODAY : v)));
    return api?.onChanged((change) => {
      const before = live.current;
      void refresh().then((after) => {
        if (change.by === 'person' || change.by === 'undo') return;
        const sig = (t: TaskItem) => `${t.text}|${t.done}|${t.due}|${t.flagged ?? false}|${t.notes ?? ''}`;
        const old = new Set(Object.entries(before).flatMap(([l, ts]) => ts.map((t) => key(l, sig(t)))));
        const marked = Object.entries(after).flatMap(([l, ts]) => ts.filter((t) => !old.has(key(l, sig(t)))).map((t) => key(l, t.text)));
        if (marked.length === 0) return;
        setFresh(new Set(marked));
        window.setTimeout(() => setFresh(new Set()), FRESH_MS);
      });
    });
  }, [api, refresh]);

  // The lists are ordinary files another editor may change: read them again when a view opens or the window comes back.
  useEffect(() => { void refresh(); }, [view, refresh]);
  useEffect(() => {
    const again = () => { if (document.visibilityState === 'visible') void refresh(); };
    window.addEventListener('focus', again);
    document.addEventListener('visibilitychange', again);
    return () => { window.removeEventListener('focus', again); document.removeEventListener('visibilitychange', again); };
  }, [refresh]);
  // Undo is offered for a few seconds.
  useEffect(() => {
    if (!deleted) return undefined;
    const t = window.setTimeout(() => setDeleted(null), UNDO_MS);
    return () => window.clearTimeout(t);
  }, [deleted]);

  /** Apply what the window got back for one list, or say what went wrong and reload. */
  const settle = useCallback(async (result: TaskList | { ok: false; message: string; conflict?: boolean } | undefined) => {
    if (!result) return false;
    if (isNotesFailure(result)) {
      setMessage(result.conflict ? '' : result.message);
      await refresh();
      return false;
    }
    setMessage('');
    setAll((cur) => ({ ...cur, [result.list]: result.tasks }));
    const open = result.tasks.filter((t) => !t.done).length;
    setLists((cur) => cur.map((l) => (l.name === result.list ? { ...l, open, done: result.tasks.length - open } : l)));
    return true;
  }, [refresh]);

  const add = useCallback(async (list: string, text: string, due: string | null, options?: { flagged?: boolean; under?: TaskAt }) => {
    if (!(list in live.current)) await refresh();
    return settle(await api?.add(list, text, due, options));
  }, [api, settle, refresh]);

  const change = useCallback(async (list: string, task: TaskItem, what: TaskChange) => {
    // Shown at once; the reply (or a reload, if it was refused) settles it.
    setAll((cur) => ({ ...cur, [list]: (cur[list] ?? []).map((t) => (t.line === task.line ? { ...t, ...what, due: what.due === undefined ? t.due : what.due } : t)) }));
    if (what.text !== undefined) setPicked((p) => (p && p.list === list && p.text === task.text ? { list, text: what.text!.trim() } : p));
    return settle(await api?.update(list, task.line, task.text, what));
  }, [api, settle]);

  const remove = useCallback(async (list: string, task: TaskItem) => {
    setAll((cur) => ({ ...cur, [list]: (cur[list] ?? []).filter((t) => t.line !== task.line && t.parent !== task.line) }));
    setPicked((p) => (p && p.list === list && p.text === task.text ? null : p));
    const result = await api?.remove(list, task.line, task.text);
    const ok = await settle(result);
    if (ok && result && !isNotesFailure(result) && result.removed) setDeleted({ kind: 'task', list, text: task.text, line: result.removed.line, block: result.removed.text });
    return ok;
  }, [api, settle]);

  const undoDelete = useCallback(async () => {
    const d = deleted;
    if (!d) return false;
    setDeleted(null);
    if (d.kind === 'task') return api?.restore ? settle(await api.restore(d.list, d.line, d.block)) : false;
    const back = await api?.restoreList?.(d.list, d.text);
    if (!back || isNotesFailure(back)) { if (back) setMessage(back.message); return false; }
    await refresh();
    setViewState({ kind: 'list', name: back.name });
    return true;
  }, [api, deleted, settle, refresh]);

  /** Move a task (with its subtasks) to the end of `to`, or before a task there. */
  const move = useCallback(async (list: string, task: TaskItem, to: string, before?: TaskItem) => {
    if (!api?.move || (before && before.line === task.line && list === to)) return false;
    const ok = await settle(await api.move(list, task.line, task.text, to, before ? { line: before.line, expect: before.text } : undefined));
    if (ok) {
      await refresh();
      setPicked((p) => (p && p.list === list && p.text === task.text ? { list: to, text: task.text } : p));
    }
    return ok;
  }, [api, settle, refresh]);

  const clearDone = useCallback(async (list: string) => settle(await api?.clearDone(list)), [api, settle]);

  const createList = useCallback(async (name: string) => {
    const made = await api?.createList(name);
    if (!made || isNotesFailure(made)) { if (made) setMessage(made.message); return null; }
    await refresh();
    setView({ kind: 'list', name: made.name });
    return made.name;
  }, [api, refresh, setView]);

  const renameList = useCallback(async (list: string, to: string) => {
    const done = await api?.renameList?.(list, to);
    if (!done || isNotesFailure(done)) { if (done) setMessage(done.message); return null; }
    setMessage('');
    await refresh();
    setViewState((v) => (v.kind === 'list' && v.name === list ? { kind: 'list', name: done.name } : v));
    return done.name;
  }, [api, refresh]);

  const deleteList = useCallback(async (list: string) => {
    const done = await api?.deleteList?.(list);
    if (!done || isNotesFailure(done)) { if (done) setMessage(done.message); return false; }
    setMessage('');
    if (done.text !== undefined) setDeleted({ kind: 'list', list, text: done.text });
    await refresh();
    setViewState((v) => (v.kind === 'list' && v.name === list ? TODAY : v));
    return true;
  }, [api, refresh]);

  const isFresh = useCallback((list: string, task: TaskItem) => fresh.has(key(list, task.text)), [fresh]);
  /** The picked task as it is now, if it is still there. */
  const pickedTask = picked ? (all[picked.list] ?? []).find((t) => t.text === picked.text) ?? null : null;

  return {
    available: api !== undefined, lists, all, view, setView, message, query, setQuery, picked: pickedTask ? { list: picked!.list, task: pickedTask } : null, pick: setPicked,
    deleted, undoDelete, dismissDeleted: () => setDeleted(null), ask,
    add, change, remove, move, clearDone, createList, renameList, deleteList, isFresh, refresh,
  };
}

export type TasksState = ReturnType<typeof useTasks>;
