import { useCallback, useEffect, useRef, useState } from 'react';
import { isNotesFailure, type CodeProcess, type CodeTestRun } from '@mobius/shared';
import { cdTarget, isClear } from './terminal-view';

export interface TerminalEntry { id: number; cwd: string; command: string; result: CodeTestRun | null; note?: string }

const CWD_KEY = 'mobius.terminal.cwd';
const HISTORY_KEY = 'mobius.terminal.history';
const read = <T,>(key: string, fallback: T, ok: (v: unknown) => v is T): T => { try { const v: unknown = JSON.parse(window.localStorage.getItem(key) ?? 'null'); return ok(v) ? v : fallback; } catch { return fallback; } };
const write = (key: string, v: unknown) => { try { window.localStorage.setItem(key, JSON.stringify(v)); } catch { /* Not kept. */ } };
const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

/** The Terminal app's state: the folder, what was run there and what it printed, and commands that keep running. */
export function useTerminal() {
  const api = window.mobius.terminal;
  const [cwd, setCwd] = useState<string>(() => read(CWD_KEY, '', (v): v is string => typeof v === 'string'));
  const [entries, setEntries] = useState<TerminalEntry[]>([]);
  const [history, setHistory] = useState<string[]>(() => read(HISTORY_KEY, [], isStrings));
  const [places, setPlaces] = useState<{ cwd: string; name: string; within?: string }[]>([]);
  const [processes, setProcesses] = useState<CodeProcess[]>([]);
  const next = useRef(1);
  const live = useRef(cwd);
  live.current = cwd;

  const loadPlaces = useCallback(async () => setPlaces((await api?.places().catch(() => [])) ?? []), [api]);
  const loadProcesses = useCallback(async () => setProcesses((await api?.processes().catch(() => [])) ?? []), [api]);
  useEffect(() => {
    void loadPlaces();
    void loadProcesses();
    // The folder kept from last time may have gone.
    void api?.resolve(live.current, '').then((r) => { if (isNotesFailure(r)) setCwd(''); });
  }, [api, loadPlaces, loadProcesses]);
  useEffect(() => write(CWD_KEY, cwd), [cwd]);
  const anyRunning = processes.some((p) => p.running);
  useEffect(() => {
    if (!anyRunning) return undefined;
    const timer = window.setInterval(() => void loadProcesses(), 1000);
    return () => window.clearInterval(timer);
  }, [anyRunning, loadProcesses]);

  const remember = (line: string) => setHistory((was) => { const h = [line, ...was.filter((x) => x !== line)].slice(0, 100); write(HISTORY_KEY, h); return h; });
  const add = (entry: Omit<TerminalEntry, 'id'>) => { const id = next.current++; setEntries((was) => [...was, { ...entry, id }].slice(-200)); return id; };

  const go = useCallback(async (target: string) => {
    const done = await api?.resolve(live.current, target);
    if (!done) return false;
    if (isNotesFailure(done)) return done.message;
    setCwd(done.cwd);
    return true;
  }, [api]);

  /** Runs a line: `cd` and `clear` here, anything else in the folder; with `keep`, as a command that keeps running. */
  const run = useCallback(async (line: string, keep = false) => {
    const command = line.trim();
    if (!api || !command) return;
    remember(command);
    if (isClear(command)) { setEntries([]); return; }
    const target = cdTarget(command);
    const here = live.current;
    if (target !== null) {
      const moved = await go(target);
      add({ cwd: here, command, result: null, note: moved === true ? '' : typeof moved === 'string' ? moved : 'Terminal is not available.' });
      void loadPlaces();
      return;
    }
    if (keep) {
      const started = await api.start(here, command);
      add({ cwd: here, command, result: null, note: isNotesFailure(started) ? started.message : 'Keeps running: see Running on the left.' });
      await loadProcesses();
      return;
    }
    const id = add({ cwd: here, command, result: null });
    const got = await api.run(here, command);
    const result: CodeTestRun = isNotesFailure(got) ? { ok: true, passed: false, code: null, output: got.message, seconds: 0, timedOut: false } : got;
    setEntries((was) => was.map((e) => (e.id === id ? { ...e, result } : e)));
    void loadPlaces();
  }, [api, go, loadPlaces, loadProcesses]); // eslint-disable-line react-hooks/exhaustive-deps

  const stop = useCallback(async (id: number) => { await api?.stop(id); await loadProcesses(); }, [api, loadProcesses]);

  return { available: api !== undefined, cwd, entries, history, places, processes, run, go: async (t: string) => { const r = await go(t); if (r === true) await loadPlaces(); return r; }, stop, clear: () => setEntries([]) };
}
export type TerminalState = ReturnType<typeof useTerminal>;
