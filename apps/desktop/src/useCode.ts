import { useCallback, useEffect, useRef, useState } from 'react';
import { isNotesFailure, type CodeEntry, type CodeFile, type CodeGit, type CodeProcess, type CodeTestRun } from '@mobius/shared';
import { parentsOf } from './code-view';

const LAST_KEY = 'mobius.code.last';
type Place = { project: string; path: string | null };
function remembered(): Place | null {
  try {
    const v: unknown = JSON.parse(window.localStorage.getItem(LAST_KEY) ?? 'null');
    if (typeof v === 'object' && v !== null && typeof (v as Place).project === 'string') return { project: (v as Place).project, path: typeof (v as Place).path === 'string' ? (v as Place).path : null };
  } catch { /* Nothing kept. */ }
  return null;
}
const keep = (place: Place) => { try { window.localStorage.setItem(LAST_KEY, JSON.stringify(place)); } catch { /* Not kept. */ } };

const RECENT_KEY = 'mobius.code.recent';
const RECENT_MAX = 8;
/** The files opened lately in each project, newest first, for the screen shown when no file is open. */
function recentFiles(): Record<string, string[]> {
  try {
    const v: unknown = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? '{}');
    if (typeof v === 'object' && v !== null) return Object.fromEntries(Object.entries(v).filter(([, list]) => Array.isArray(list)).map(([k, list]) => [k, (list as unknown[]).filter((p): p is string => typeof p === 'string').slice(0, RECENT_MAX)]));
  } catch { /* Nothing kept. */ }
  return {};
}

export interface CodeTests { command: string | null; suggested: string | null; running: boolean; last: CodeTestRun | null; by: 'person' | 'assistant' | null }
const NO_TESTS: CodeTests = { command: null, suggested: null, running: false, last: null, by: null };

/** The Code app's state: projects, the open project's files, the open file as typed, and its tests. */
export function useCode(active = true) {
  const api = window.mobius.code;
  const [projects, setProjects] = useState<{ name: string }[]>([]);
  const [project, setProject] = useState<string | null>(null);
  const [entries, setEntries] = useState<CodeEntry[]>([]);
  const [open, setOpen] = useState<CodeFile | null>(null);
  const [draft, setDraft] = useState('');
  const [message, setMessage] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [tests, setTests] = useState<CodeTests>(NO_TESTS);
  const [git, setGit] = useState<CodeGit>({ repo: false });
  const [processes, setProcesses] = useState<CodeProcess[]>([]);
  /** Commands run in this project, newest last: the person's from the console, and Mobius's when allowed. */
  const [consoleRuns, setConsoleRuns] = useState<{ command: string; result: CodeTestRun | null; by: 'person' | 'assistant' }[]>([]);
  /** The files open as tabs, in order; the open one is among them. */
  const [tabs, setTabs] = useState<string[]>([]);
  const [recentByProject, setRecentByProject] = useState<Record<string, string[]>>(recentFiles);
  const noteRecent = (name: string, path: string) => setRecentByProject((was) => {
    const next = { ...was, [name]: [path, ...(was[name] ?? []).filter((p) => p !== path)].slice(0, RECENT_MAX) };
    try { window.localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* Not kept. */ }
    return next;
  });
  /** What was typed in a tab that is not showing and not saved yet, with the version of the file it was typed over. */
  const stash = useRef(new Map<string, { draft: string; base: number }>());
  const [stashed, setStashed] = useState<ReadonlySet<string>>(new Set());
  const live = useRef({ project, open, draft, tabs });
  live.current = { project, open, draft, tabs };
  const restash = () => setStashed(new Set(stash.current.keys()));
  const dirty = open !== null && open.text !== null && draft !== open.text;

  const refresh = useCallback(async () => {
    const list = await api?.projects();
    const ok = list && !isNotesFailure(list) ? list : [];
    setProjects(ok);
    return ok;
  }, [api]);

  const loadTree = useCallback(async (name: string) => {
    const [tree, state] = await Promise.all([api?.tree(name), api?.git(name)]);
    if (tree && !isNotesFailure(tree)) setEntries(tree.entries);
    setGit(state && !isNotesFailure(state) ? state : { repo: false });
  }, [api]);

  const loadTests = useCallback(async (name: string) => {
    const t = await api?.testCommand(name);
    setTests((was) => (t && !isNotesFailure(t) ? { ...NO_TESTS, last: was.last, command: t.command, suggested: t.suggested } : NO_TESTS));
  }, [api]);

  const openFile = useCallback(async (path: string, name = live.current.project) => {
    if (!api || !name) return false;
    const was = live.current;
    const got = await api.read(name, path);
    if (isNotesFailure(got)) { setMessage(got.message); return false; }
    // Moving to another tab keeps what was typed in this one, unsaved, for coming back to.
    if (was.open && was.open.path !== path && was.project === name && was.open.text !== null && was.draft !== was.open.text) stash.current.set(was.open.path, { draft: was.draft, base: was.open.modified });
    const kept = stash.current.get(path);
    stash.current.delete(path);
    restash();
    setOpen(got);
    setDraft(kept && kept.base === got.modified && got.text !== null ? kept.draft : got.text ?? '');
    setTabs((list) => {
      if (list.includes(path)) return list;
      const at = was.open ? list.indexOf(was.open.path) : -1;
      return at < 0 ? [...list, path] : [...list.slice(0, at + 1), path, ...list.slice(at + 1)];
    });
    setMessage('');
    setExpanded((was) => new Set([...was, ...parentsOf(path)]));
    keep({ project: name, path });
    noteRecent(name, path);
    return true;
  }, [api]);

  const openProject = useCallback(async (name: string, path: string | null = null) => {
    setProject(name);
    setOpen(null);
    setDraft('');
    setTabs([]);
    stash.current.clear();
    restash();
    setTests(NO_TESTS);
    setConsoleRuns([]);
    setExpanded(new Set());
    keep({ project: name, path });
    await Promise.all([loadTree(name), loadTests(name)]);
    if (path) await openFile(path, name);
  }, [loadTree, loadTests, openFile]);

  useEffect(() => {
    // Nothing is read until the app is first opened (Abilities: apps load when they are used).
    if (!active) return undefined;
    void refresh().then((list) => {
      if (live.current.project) return;
      const last = remembered();
      const found = last && list.find((p) => p.name === last.project);
      if (found && last) void openProject(last.project, last.path);
      else if (list[0]) void openProject(list[0].name);
    });
    const offChanged = api?.onChanged((change) => {
      void refresh();
      const now = live.current;
      if (!now.project || (change.project && change.project !== now.project)) return;
      void loadTree(now.project);
      if (now.open && (change.path === null || change.path === now.open.path)) {
        // Someone else changed the open file. If nothing is typed here, show theirs; if something is, the save says so.
        if (now.open.text === null || now.draft === now.open.text) void openFile(now.open.path, now.project);
      }
    });
    const offTests = api?.onTests((event) => {
      if (event.project !== live.current.project) return;
      setTests((was) => ({ ...was, running: event.running, last: event.result ?? was.last, by: event.by, command: event.command ?? was.command }));
    });
    const offConsole = api?.onConsole((event) => {
      if (event.project !== live.current.project || event.by === 'person') return;
      setConsoleRuns((was) => [...was, { command: event.command, result: event.result, by: event.by }].slice(-20));
    });
    return () => { offChanged?.(); offTests?.(); offConsole?.(); };
  }, [active, api]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useCallback(async () => {
    const now = live.current;
    if (!api || !now.project || !now.open || now.open.text === null) return false;
    const done = await api.save(now.project, now.open.path, now.draft, now.open.modified);
    if (isNotesFailure(done)) {
      setMessage(done.conflict ? 'This file changed since you opened it. Copy what you typed, then open it again.' : done.message);
      return false;
    }
    setOpen({ ...now.open, text: now.draft, modified: done.modified });
    setMessage('');
    return true;
  }, [api]);

  /** Writes the text as the file, as when one change of the agent's is put back. */
  const write = useCallback(async (text: string) => {
    const now = live.current;
    if (!api || !now.project || !now.open) return false;
    const done = await api.save(now.project, now.open.path, text, now.open.modified);
    if (isNotesFailure(done)) { setMessage(done.message); return false; }
    setOpen({ ...now.open, text, modified: done.modified });
    setDraft(text);
    return true;
  }, [api]);

  const reload = useCallback(async () => {
    const now = live.current;
    if (now.project) await loadTree(now.project);
    if (now.project && now.open) await openFile(now.open.path, now.project);
  }, [loadTree, openFile]);

  const createProject = useCallback(async (name: string) => {
    const made = await api?.createProject(name);
    if (!made || isNotesFailure(made)) { if (made) setMessage(made.message); return null; }
    await refresh();
    await openProject(made.name, 'README.md');
    return made.name;
  }, [api, refresh, openProject]);

  const createFile = useCallback(async (path: string) => {
    const now = live.current;
    if (!api || !now.project) return false;
    const made = await api.createFile(now.project, path.trim().replace(/^\/+/, ''));
    if (isNotesFailure(made)) { setMessage(made.message); return false; }
    await loadTree(now.project);
    return openFile(made.path, now.project);
  }, [api, loadTree, openFile]);

  const removeFile = useCallback(async (path: string) => {
    const now = live.current;
    if (!api || !now.project) return;
    const done = await api.removeFile(now.project, path);
    if (isNotesFailure(done)) { setMessage(done.message); return; }
    if (now.open?.path === path) { setOpen(null); setDraft(''); }
    setTabs((list) => list.filter((p) => p !== path));
    stash.current.delete(path);
    restash();
    await loadTree(now.project);
  }, [api, loadTree]);

  const setTestCommand = useCallback(async (command: string) => {
    const now = live.current;
    if (!api || !now.project) return false;
    const done = await api.setTestCommand(now.project, command);
    if (isNotesFailure(done)) { setMessage(done.message); return false; }
    await loadTests(now.project);
    return true;
  }, [api, loadTests]);

  const runTests = useCallback(async () => {
    const now = live.current;
    if (!api || !now.project) return;
    setTests((was) => ({ ...was, running: true, by: 'person' }));
    const result = await api.runTests(now.project);
    if (isNotesFailure(result)) { setMessage(result.message); setTests((was) => ({ ...was, running: false })); return; }
    setTests((was) => ({ ...was, running: false, last: result, by: 'person' }));
  }, [api]);

  const runCommand = useCallback(async (command: string) => {
    const now = live.current;
    if (!api || !now.project || !command.trim()) return;
    setConsoleRuns((was) => [...was, { command, result: null, by: 'person' as const }].slice(-20));
    const result = await api.runCommand(now.project, command);
    const done = isNotesFailure(result) ? { ok: true as const, passed: false, code: null, output: result.message, seconds: 0, timedOut: false } : result;
    setConsoleRuns((was) => { const next = [...was]; const at = next.map((r) => r.result === null && r.command === command).lastIndexOf(true); if (at >= 0) next[at] = { command, result: done, by: 'person' }; return next; });
    await loadTree(now.project);
  }, [api, loadTree]);

  const loadProcesses = useCallback(async () => {
    const now = live.current;
    if (!api || !now.project) { setProcesses([]); return; }
    setProcesses(await api.processes(now.project).catch(() => []));
  }, [api]);
  // While something runs, what it prints is read again every second.
  const anyRunning = processes.some((p) => p.running);
  useEffect(() => {
    void loadProcesses();
    const off = api?.onProcesses(() => void loadProcesses());
    const timer = anyRunning ? window.setInterval(() => void loadProcesses(), 1000) : undefined;
    return () => { off?.(); window.clearInterval(timer); };
  }, [api, project, anyRunning, loadProcesses]);
  const startProcess = useCallback(async (command: string) => {
    const now = live.current;
    if (!api || !now.project) return;
    const done = await api.start(now.project, command);
    if (isNotesFailure(done)) setMessage(done.message);
    await loadProcesses();
  }, [api, loadProcesses]);
  const stopProcess = useCallback(async (id: number) => {
    await api?.stopProcess(id);
    await loadProcesses();
  }, [api, loadProcesses]);

  const commit = useCallback(async (message: string) => {
    const now = live.current;
    if (!api || !now.project) return false;
    const done = await api.commit(now.project, message);
    if (isNotesFailure(done)) { setMessage(done.message); return false; }
    setMessage('');
    await loadTree(now.project);
    return true;
  }, [api, loadTree]);
  const push = useCallback(async () => {
    const now = live.current;
    if (!api || !now.project) return;
    const done = await api.push(now.project);
    setMessage(isNotesFailure(done) ? done.message : '');
    await loadTree(now.project);
  }, [api, loadTree]);

  /** Close a tab, dropping what was typed in it; the tab beside it opens when it was the one showing. */
  const closeTab = useCallback(async (path: string) => {
    const now = live.current;
    const at = now.tabs.indexOf(path);
    const rest = now.tabs.filter((p) => p !== path);
    stash.current.delete(path);
    restash();
    setTabs(rest);
    if (now.open?.path !== path) return;
    const next = rest[Math.min(at, rest.length - 1)];
    if (next && now.project) {
      // Opening the next one must not keep this tab's draft.
      live.current = { ...now, open: null, tabs: rest };
      await openFile(next, now.project);
    } else { setOpen(null); setDraft(''); }
  }, [openFile]);
  /** Whether a file has typing not saved yet, in the tab showing or one behind it. */
  const unsaved = useCallback((path: string) => stashed.has(path) || (open?.path === path && open.text !== null && draft !== open.text), [stashed, open, draft]);

  // Recent files that are still in the project, so a deleted one is not offered.
  const recent = (project ? recentByProject[project] ?? [] : []).filter((p) => entries.some((e) => !e.folder && e.path === p));

  const toggle = useCallback((folder: string) => setExpanded((was) => { const next = new Set(was); if (next.has(folder)) next.delete(folder); else next.add(folder); return next; }), []);

  return {
    available: api !== undefined, projects, project, recent, entries, open, draft, setDraft, dirty, tabs, closeTab, unsaved, message, setMessage, expanded, toggle, tests,
    git, commit, push, consoleRuns, runCommand, processes, startProcess, stopProcess, refresh, openProject, openFile, save, write, reload, createProject, createFile, removeFile, setTestCommand, runTests,
  };
}
export type CodeState = ReturnType<typeof useCode>;
