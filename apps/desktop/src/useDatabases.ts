import { useCallback, useEffect, useRef, useState } from 'react';
import { isNotesFailure, type DbInfo, type DbResult } from '@mobius/shared';
import { databaseNameFor, isReading, queryHistory, rememberQuery, tableNameFor, tableQuery } from './db-view';

const LAST_KEY = 'mobius.database.last';
const remembered = (): string | null => { try { return window.localStorage.getItem(LAST_KEY); } catch { return null; } };
const keep = (name: string | null) => { try { if (name) window.localStorage.setItem(LAST_KEY, name); else window.localStorage.removeItem(LAST_KEY); } catch { /* Not kept. */ } };

/** The Database app's state: the databases, the open one, the statement typed for it, and what it gave. */
export function useDatabases(active = true) {
  const api = window.mobius.databases;
  const [list, setList] = useState<DbInfo[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [sql, setSql] = useState('');
  const [result, setResult] = useState<DbResult | null>(null);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  /** The statement that gave `result`, run again when the database changes elsewhere. */
  const shown = useRef<string | null>(null);
  const live = useRef({ open, sql });
  live.current = { open, sql };

  const refresh = useCallback(async () => {
    const got = await api?.list().catch(() => []);
    setList(got ?? []);
    return got ?? [];
  }, [api]);

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
      if (!isReading(text)) void refresh();
    }
  }, [api, refresh]);

  const choose = useCallback(async (name: string, table?: string) => {
    setOpen(name);
    keep(name);
    setMessage('');
    setHistory(queryHistory(name));
    const info = (await refresh()).find((d) => d.name === name);
    const first = table ?? info?.tables[0]?.name;
    const start = first ? tableQuery(first) : '';
    setSql(start);
    setResult(null);
    shown.current = null;
    if (start) await run(start, name);
  }, [refresh, run]);

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
      void refresh();
      const now = live.current.open;
      // Changed by Mobius or another program: what is shown is read again.
      if (now && change.by !== 'person' && (change.name === null || change.name === now) && shown.current) void run(shown.current, now);
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
    if (live.current.open === name) { setOpen(null); keep(null); setResult(null); setSql(''); }
    const rest = await refresh();
    if (live.current.open === null && rest[0]) await choose(rest[0].name);
  }, [api, refresh, choose]);

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
    let table = tableNameFor(file.name);
    for (let n = 2; info?.tables.some((t) => t.name.toLowerCase() === table.toLowerCase()); n++) table = `${tableNameFor(file.name)}_${n}`;
    const done = await api.importCsv(name, table, await file.text());
    if (isNotesFailure(done)) { setMessage(`It could not be imported: ${done.message}.`); return; }
    await choose(name, done.table);
  }, [api, list, refresh, choose]);

  return { available: api !== undefined, list, open, sql, setSql, result, running, message, setMessage, history, run, choose, create, remove, importFile, refresh };
}
export type DatabasesState = ReturnType<typeof useDatabases>;
