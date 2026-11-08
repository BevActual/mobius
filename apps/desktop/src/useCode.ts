import { useCallback, useEffect, useRef, useState } from 'react';
import { isNotesFailure, type CodeEntry, type CodeFile, type CodeGit, type CodeTestRun } from '@mobius/shared';
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

export interface CodeTests { command: string | null; suggested: string | null; running: boolean; last: CodeTestRun | null; by: 'person' | 'assistant' | null }
const NO_TESTS: CodeTests = { command: null, suggested: null, running: false, last: null, by: null };

/** The Code app's state: projects, the open project's files, the open file as typed, and its tests. */
export function useCode() {
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
  const live = useRef({ project, open, draft });
  live.current = { project, open, draft };
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
    const got = await api.read(name, path);
    if (isNotesFailure(got)) { setMessage(got.message); return false; }
    setOpen(got);
    setDraft(got.text ?? '');
    setMessage('');
    setExpanded((was) => new Set([...was, ...parentsOf(path)]));
    keep({ project: name, path });
    return true;
  }, [api]);

  const openProject = useCallback(async (name: string, path: string | null = null) => {
    setProject(name);
    setOpen(null);
    setDraft('');
    setTests(NO_TESTS);
    setExpanded(new Set());
    keep({ project: name, path });
    await Promise.all([loadTree(name), loadTests(name)]);
    if (path) await openFile(path, name);
  }, [loadTree, loadTests, openFile]);

  useEffect(() => {
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
    return () => { offChanged?.(); offTests?.(); };
  }, [api]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const toggle = useCallback((folder: string) => setExpanded((was) => { const next = new Set(was); if (next.has(folder)) next.delete(folder); else next.add(folder); return next; }), []);

  return {
    available: api !== undefined, projects, project, entries, open, draft, setDraft, dirty, message, setMessage, expanded, toggle, tests,
    git, commit, push, refresh, openProject, openFile, save, write, reload, createProject, createFile, removeFile, setTestCommand, runTests,
  };
}
export type CodeState = ReturnType<typeof useCode>;
