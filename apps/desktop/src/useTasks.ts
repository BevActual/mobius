import { useCallback, useEffect, useRef, useState } from 'react';
import { isNotesFailure, type TaskChange, type TaskItem, type TaskList, type TaskListInfo } from '@mobius/shared';
import type { SmartView } from './tasks-view';

export type TasksView = { kind: 'list'; name: string } | { kind: 'smart'; id: SmartView };
const FRESH_MS = 4000;
const key = (list: string, text: string) => `${list}\u0000${text}`;

/** The Tasks app's state: every list and its tasks, the view that is open, and changes that show at once. */
export function useTasks() {
  const api = window.mobius.tasks;
  const [lists, setLists] = useState<TaskListInfo[]>([]);
  const [all, setAll] = useState<Record<string, TaskItem[]>>({});
  const [view, setView] = useState<TasksView>({ kind: 'smart', id: 'today' });
  const [message, setMessage] = useState('');
  // Tasks the agent just added or changed, marked for a moment so its work is visible without moving focus.
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const live = useRef(all);
  live.current = all;

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
    void refresh();
    return api?.onChanged((change) => {
      const before = live.current;
      void refresh().then((after) => {
        if (change.by === 'person') return;
        const old = new Set(Object.entries(before).flatMap(([l, ts]) => ts.map((t) => key(l, `${t.text}|${t.done}|${t.due}`))));
        const marked = Object.entries(after).flatMap(([l, ts]) => ts.filter((t) => !old.has(key(l, `${t.text}|${t.done}|${t.due}`))).map((t) => key(l, t.text)));
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

  const add = useCallback(async (list: string, text: string, due: string | null) => settle(await api?.add(list, text, due)), [api, settle]);

  const change = useCallback(async (list: string, task: TaskItem, what: TaskChange) => {
    // Shown at once; the reply (or a reload, if it was refused) settles it.
    setAll((cur) => ({ ...cur, [list]: (cur[list] ?? []).map((t) => (t.line === task.line ? { ...t, ...what, due: what.due === undefined ? t.due : what.due } : t)) }));
    return settle(await api?.update(list, task.line, task.text, what));
  }, [api, settle]);

  const remove = useCallback(async (list: string, task: TaskItem) => {
    setAll((cur) => ({ ...cur, [list]: (cur[list] ?? []).filter((t) => t.line !== task.line) }));
    return settle(await api?.remove(list, task.line, task.text));
  }, [api, settle]);

  const clearDone = useCallback(async (list: string) => settle(await api?.clearDone(list)), [api, settle]);

  const createList = useCallback(async (name: string) => {
    const made = await api?.createList(name);
    if (!made || isNotesFailure(made)) { if (made) setMessage(made.message); return null; }
    await refresh();
    setView({ kind: 'list', name: made.name });
    return made.name;
  }, [api, refresh]);

  const isFresh = useCallback((list: string, task: TaskItem) => fresh.has(key(list, task.text)), [fresh]);

  return { available: api !== undefined, lists, all, view, setView, message, add, change, remove, clearDone, createList, isFresh, refresh };
}

export type TasksState = ReturnType<typeof useTasks>;
