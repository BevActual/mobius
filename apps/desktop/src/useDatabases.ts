import { useCallback, useEffect, useRef, useState } from 'react';
import { isNotesFailure, type DbCell, type DbInfo, type DbResult } from '@mobius/shared';
import { browseQuery, countQuery, databaseNameFor, dropTableSql, FIRST_BROWSE, isReading, quoteIdent, queryHistory, rememberQuery, renameTableSql, tableNameFor, tableQuery, toCsv, type Browse } from './db-view';

const LAST_KEY = 'mobius.database.last';
const remembered = (): string | null => { try { return window.localStorage.getItem(LAST_KEY); } catch { return null; } };
const keep = (name: string | null) => { try { if (name) window.localStorage.setItem(LAST_KEY, name); else window.localStorage.removeItem(LAST_KEY); } catch { /* Not kept. */ } };

/** What the page shows for the open database: a table's rows, its columns, or a statement of the person's own. */
export type DbView = 'data' | 'structure' | 'sql';

/** The Database app's state: the databases, the open one and its table, the statement typed for it, and what it gave. */
export function useDatabases(active = true) {
  const api = window.mobius.databases;
  const [list, setList] = useState<DbInfo[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [table, setTable] = useState<string | null>(null);
  const [view, setView] = useState<DbView>('data');
  const [browse, setBrowseState] = useState<Browse>(FIRST_BROWSE);
  /** The Data view's page of rows, and how many rows its filter keeps. */
  const [rows, setRows] = useState<DbResult | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [sql, setSql] = useState('');
  const [result, setResult] = useState<DbResult | null>(null);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  /** The statement that gave `result`, run again when the database changes elsewhere. */
  const shown = useRef<string | null>(null);
  const live = useRef({ open, sql, table, browse, list });
  live.current = { open, sql, table, browse, list };

  const refresh = useCallback(async () => {
    const got = await api?.list().catch(() => []);
    setList(got ?? []);
    return got ?? [];
  }, [api]);

  /** Read the Data view's page again: after a change, a sort, a filter or a new page. */
  const look = useCallback(async (name = live.current.open, t = live.current.table, b = live.current.browse, known = live.current.list) => {
    if (!api || !name || !t) { setRows(null); setTotal(null); return; }
    const columns = known.find((d) => d.name === name)?.tables.find((x) => x.name === t)?.columns.map((c) => c.name) ?? [];
    const [page, count] = await Promise.all([api.query(name, browseQuery(t, columns, b)), api.query(name, countQuery(t, columns, b.filter))]);
    // Only what is still open is shown: a slower answer for a table left behind is dropped.
    if (live.current.open !== name || live.current.table !== t) return;
    setRows(page);
    setTotal(count.ok && typeof count.rows[0]?.[0] === 'number' ? count.rows[0][0] : null);
  }, [api]);

  const setBrowse = useCallback((change: Partial<Browse>) => {
    const next = { ...live.current.browse, page: 0, ...change };
    setBrowseState(next);
    live.current.browse = next;
    void look(undefined, undefined, next);
  }, [look]);

  const run = useCallback(async (statement?: string, name = live.current.open) => {
    const text = (statement ?? live.current.sql).trim();
    if (!api || !name || !text) return;
    setRunning(true);
    const got = await api.query(name, text);
    setRunning(false);
    setResult(got);
    if (got.ok) {
      setHistory(rememberQuery(name, text));
      shown.current = isReading(text) ? text : null;
      if (!isReading(text)) void refresh().then((known) => look(name, undefined, undefined, known));
    }
  }, [api, refresh, look]);

  /** Open a database, at the given table or its first, showing that table's rows. */
  const choose = useCallback(async (name: string, which?: string) => {
    setOpen(name);
    keep(name);
    setMessage('');
    setHistory(queryHistory(name));
    const known = await refresh();
    const info = known.find((d) => d.name === name);
    const first = which ?? info?.tables[0]?.name ?? null;
    setTable(first);
    setView(first ? 'data' : 'sql');
    setBrowseState(FIRST_BROWSE);
    setSql(first ? tableQuery(first) : '');
    setResult(null);
    shown.current = null;
    live.current = { ...live.current, open: name, table: first, browse: FIRST_BROWSE, list: known };
    await look(name, first, FIRST_BROWSE, known);
  }, [refresh, look]);

  /** Show another view; the Data view reads its rows again, as SQL may have changed them. */
  const show = useCallback((next: DbView) => {
    setView(next);
    if (next === 'data') void look();
  }, [look]);

  useEffect(() => {
    // Nothing is read until the app is first opened (Abilities: apps load when they are used).
    if (!active) return undefined;
    void refresh().then((got) => {
      if (live.current.open) return;
      const last = remembered();
      const found = got.find((d) => d.name === last) ?? got[0];
      if (found) void choose(found.name);
    });
    return api?.onChanged((change) => {
      const now = live.current.open;
      const here = now !== null && (change.name === null || change.name === now);
      void refresh().then((known) => {
        // Changed by Mobius or another program: what is shown is read again.
        if (!here || change.by === 'person') return;
        void look(now, undefined, undefined, known);
        if (shown.current) void run(shown.current, now);
      });
    });
  }, [active, api]); // eslint-disable-line react-hooks/exhaustive-deps

  const create = useCallback(async (typed: string) => {
    const name = databaseNameFor(typed);
    if (!api || !name) { setMessage('Give the database a name.'); return null; }
    const made = await api.create(name);
    if (isNotesFailure(made)) { setMessage(made.message); return null; }
    await choose(made.name);
    return made.name;
  }, [api, choose]);

  const remove = useCallback(async (name: string) => {
    const done = await api?.remove(name);
    if (done && isNotesFailure(done)) { setMessage(done.message); return; }
    if (live.current.open === name) { setOpen(null); setTable(null); keep(null); setResult(null); setRows(null); setSql(''); live.current.open = null; }
    const rest = await refresh();
    if (live.current.open === null && rest[0]) await choose(rest[0].name);
  }, [api, refresh, choose]);

  /** A statement the app writes for the person, such as a rename: its mistake is shown, and the list read again. */
  const change = useCallback(async (name: string, statement: string) => {
    if (!api) return false;
    const got = await api.query(name, statement);
    if (!got.ok) { setMessage(got.message); return false; }
    setMessage('');
    return true;
  }, [api]);

  const renameTable = useCallback(async (name: string, from: string, typed: string) => {
    const to = typed.trim();
    if (!to || to === from) return true;
    if (!(await change(name, renameTableSql(from, to)))) return false;
    if (live.current.open === name && live.current.table === from) await choose(name, to);
    else await refresh();
    return true;
  }, [change, choose, refresh]);

  const dropTable = useCallback(async (name: string, t: string) => {
    if (!(await change(name, dropTableSql(t)))) return;
    if (live.current.open === name && live.current.table === t) await choose(name);
    else await refresh();
  }, [change, choose, refresh]);

  /** Every row of a table as CSV, read a thousand at a time (the most one query gives). */
  const tableCsv = useCallback(async (name: string, t: string): Promise<string | null> => {
    if (!api) return null;
    let columns: string[] = [];
    const all: DbCell[][] = [];
    for (let offset = 0; ; offset += 1000) {
      const got = await api.query(name, `SELECT * FROM ${quoteIdent(t)} LIMIT 1000 OFFSET ${offset}`);
      if (!got.ok) { setMessage(got.message); return null; }
      columns = got.columns;
      all.push(...got.rows);
      if (got.rows.length < 1000 || offset >= 1_000_000) break;
    }
    return toCsv(columns, all);
  }, [api]);

  /** A CSV file as a new table in the open database, or in a new one called Data when there is none. */
  const importFile = useCallback(async (file: File) => {
    if (!api) return;
    if (file.size > 30 * 1024 * 1024) { setMessage('That file is over 30 MB.'); return; }
    let name = live.current.open;
    if (!name) {
      const made = await api.create('Data');
      name = isNotesFailure(made) ? (list.find((d) => d.name === 'Data') ? 'Data' : null) : made.name;
      if (!name) { setMessage('A database could not be made for it.'); return; }
    }
    const info = (await refresh()).find((d) => d.name === name);
    let t = tableNameFor(file.name);
    for (let n = 2; info?.tables.some((x) => x.name.toLowerCase() === t.toLowerCase()); n++) t = `${tableNameFor(file.name)}_${n}`;
    const done = await api.importCsv(name, t, await file.text());
    if (isNotesFailure(done)) { setMessage(`It could not be imported: ${done.message}.`); return; }
    await choose(name, done.table);
  }, [api, list, refresh, choose]);

  return {
    available: api !== undefined, list, open, table, view, show, browse, setBrowse, rows, total, sql, setSql, result, running, message, setMessage, history,
    run, choose, create, remove, renameTable, dropTable, tableCsv, importFile, refresh,
  };
}
export type DatabasesState = ReturnType<typeof useDatabases>;
