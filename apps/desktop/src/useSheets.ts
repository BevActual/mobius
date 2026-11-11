import { useCallback, useEffect, useRef, useState } from 'react';
import { isNotesFailure, type CellChange, type SheetData, type WorkbookInfo } from '@mobius/shared';
import { changedCells } from './sheets-view';

const LAST_KEY = 'mobius.sheets.last';
const FRESH_MS = 4000;
type Place = { workbook: string; sheet: string };
function remembered(): Place | null {
  try {
    const v: unknown = JSON.parse(window.localStorage.getItem(LAST_KEY) ?? 'null');
    if (typeof v === 'object' && v !== null && typeof (v as Place).workbook === 'string' && typeof (v as Place).sheet === 'string') return v as Place;
  } catch { /* Nothing kept. */ }
  return null;
}

/** The Sheets app's state: the workbooks, the open sheet as typed and worked out, and changes shown at once. */
export function useSheets() {
  const api = window.mobius.sheets;
  const [workbooks, setWorkbooks] = useState<WorkbookInfo[]>([]);
  const [data, setData] = useState<SheetData | null>(null);
  const [message, setMessage] = useState('');
  // Cells the agent just changed, marked for a moment.
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const live = useRef(data);
  live.current = data;

  const refresh = useCallback(async () => {
    const list = await api?.list();
    if (list && !isNotesFailure(list)) setWorkbooks(list);
    return list && !isNotesFailure(list) ? list : [];
  }, [api]);

  // Whether a sheet is being read, so a workbook offered while one is on its way does not take its place.
  const loading = useRef(0);
  const open = useCallback(async (workbook: string, sheet: string) => {
    loading.current++;
    const got = await api?.read(workbook, sheet).finally(() => { loading.current--; });
    if (!got) return false;
    if (isNotesFailure(got)) { setMessage(got.message); return false; }
    live.current = got;
    setData(got);
    setMessage('');
    try { window.localStorage.setItem(LAST_KEY, JSON.stringify({ workbook, sheet })); } catch { /* Not kept. */ }
    return true;
  }, [api]);

  const reload = useCallback(async () => {
    const d = live.current;
    if (d) await open(d.workbook, d.sheet);
  }, [open]);

  useEffect(() => {
    void refresh().then((list) => {
      if (live.current) return;
      const last = remembered();
      const found = last && list.find((w) => w.name === last.workbook && w.sheets.includes(last.sheet));
      if (found && last) void open(last.workbook, last.sheet);
      // With nothing remembered, a lone workbook opens, so a first visit never lands on an empty window.
      else if (list.length === 1) void open(list[0]!.name, list[0]!.sheets[0] ?? 'Sheet 1');
    });
    return api?.onChanged((change) => {
      const listed = refresh();
      // A workbook Mobius made or changed opens when none is open, so it can be seen and reviewed.
      if (change.by === 'assistant' && change.workbook && !live.current) {
        const name = change.workbook;
        void listed.then((list) => {
          const made = list.find((w) => w.name === name);
          if (made && !live.current) void open(made.name, made.sheets[0] ?? 'Sheet 1');
        });
        return;
      }
      const d = live.current;
      if (!d || (change.workbook && change.workbook !== d.workbook)) return;
      const before = d.cells;
      void api.read(d.workbook, d.sheet).then((got) => {
        if (isNotesFailure(got)) { if (change.by !== 'person') void refresh(); return; }
        setData(got);
        if (change.by === 'person' || change.by === 'undo') return;
        const marked = changedCells(before, got.cells);
        if (marked.size === 0) return;
        setFresh(marked);
        window.setTimeout(() => setFresh(new Set()), FRESH_MS);
      });
    });
  }, [api, refresh, open]);

  // Writes go one after another, each with the version the one before it left, so quick typing never trips over itself.
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const inTurn = useCallback(<T,>(job: () => Promise<T>): Promise<T> => {
    const next = chain.current.then(job, job);
    chain.current = next.catch(() => undefined);
    return next;
  }, []);
  const put = useCallback((got: SheetData) => { live.current = got; setData(got); }, []);

  /** Sets cells, shown at once; a sheet that changed elsewhere meanwhile is read again instead. */
  const set = useCallback(async (cells: CellChange[]) => {
    if (!api || !live.current || cells.length === 0) return false;
    setData((cur) => {
      if (!cur) return cur;
      const grid = cur.cells.map((r) => [...r]);
      for (const { row, col, text } of cells) {
        while (grid.length <= row) grid.push([]);
        const r = grid[row]!;
        while (r.length <= col) r.push('');
        r[col] = text;
      }
      return { ...cur, cells: grid };
    });
    return inTurn(async () => {
      const d = live.current;
      if (!d) return false;
      const got = await api.set(d.workbook, d.sheet, cells, d.version);
      if (isNotesFailure(got)) {
        setMessage(got.conflict ? 'This sheet changed somewhere else, so it was read again. Make the change once more.' : got.message);
        await reload();
        return false;
      }
      setMessage('');
      put(got);
      return true;
    });
  }, [api, reload, inTurn, put]);

  const shift = useCallback(async (what: 'row' | 'column', at: number, insert: boolean) => inTurn(async () => {
    const d = live.current;
    if (!api || !d) return false;
    const got = await api.shift(d.workbook, d.sheet, what, at, insert);
    if (isNotesFailure(got)) { setMessage(got.message); return false; }
    put(got);
    return true;
  }), [api, inTurn, put]);

  const createWorkbook = useCallback(async (name: string) => {
    const made = await api?.createWorkbook(name);
    if (!made || isNotesFailure(made)) { if (made) setMessage(made.message); return null; }
    await refresh();
    await open(made.name, made.sheet);
    return made.name;
  }, [api, refresh, open]);

  const addSheet = useCallback(async (name: string) => {
    const d = live.current;
    if (!api || !d) return;
    const made = await api.addSheet(d.workbook, name);
    if (isNotesFailure(made)) { setMessage(made.message); return; }
    await refresh();
    await open(made.workbook, made.sheet);
  }, [api, refresh, open]);

  const renameSheet = useCallback(async (sheet: string, name: string) => {
    const d = live.current;
    if (!api || !d) return;
    const done = await api.renameSheet(d.workbook, sheet, name);
    if (isNotesFailure(done)) { setMessage(done.message); return; }
    await refresh();
    if (d.sheet === sheet) await open(d.workbook, done.sheet); else await reload();
  }, [api, refresh, open, reload]);

  const removeSheet = useCallback(async (sheet: string) => {
    const d = live.current;
    if (!api || !d) return;
    const done = await api.removeSheet(d.workbook, sheet);
    if (isNotesFailure(done)) { setMessage(done.message); return; }
    const list = await refresh();
    const left = list.find((w) => w.name === d.workbook)?.sheets[0];
    if (left) await open(d.workbook, left);
  }, [api, refresh, open]);

  /** Opens a workbook only when none is open or on its way: for one Mobius changed, offered on arrival. */
  const openIfIdle = useCallback((workbook: string, sheet: string) => {
    if (live.current || loading.current > 0) return;
    void open(workbook, sheet);
  }, [open]);

  return { available: api !== undefined, openIfIdle, workbooks, data, message, fresh, open, set, shift, createWorkbook, addSheet, renameSheet, removeSheet, refresh, reload };
}

export type SheetsState = ReturnType<typeof useSheets>;
