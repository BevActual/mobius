import { FromMobius } from './FromMobius';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { onCommand } from './commands';
import { KEPT_EVENT, keepTurn, keptTurns, turnId } from './ReviewStrip';
import { isNotesFailure, type DbCell, type DbResult, type WorkbookInfo } from '@mobius/shared';
import { columnDecimals, createdQuery, editText, ROWID, typedValue, nextSort, PAGE_ROWS, pageLine, sheetToCsv, showCellIn, structureQuery, toCsv, type Browse } from './db-view';
import type { DatabasesState, DbView } from './useDatabases';
import { ReviewActions, WhyThis } from './ReviewBar';
import { EmptyState } from './EmptyState';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';
import { ToolbarControls, UndoToast, ViewSwitch } from './ui';
import './database.css';
import { afterPaint } from './ui/frame';

/** The empty page's Import asks the sidebar, which holds the file picker. */
const IMPORT_CSV = 'mobius-database-import-csv';

const DbIcon = () => <svg viewBox="0 0 20 20" aria-hidden="true"><ellipse cx="10" cy="5.5" rx="6" ry="2.5" /><path d="M4 5.5v9c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5v-9M4 10c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5" /></svg>;
const TableIcon = () => <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3.5" y="4.5" width="13" height="11" rx="2" /><path d="M3.5 8.5h13M8.5 8.5v7" /></svg>;
const MoreIcon = () => <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="5" cy="10" r="1.2" /><circle cx="10" cy="10" r="1.2" /><circle cx="15" cy="10" r="1.2" /></svg>;

/** Copy text, and say so on the page for a moment. */
function useCopied(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  return [copied, (text) => { void navigator.clipboard?.writeText(text).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); }); }];
}

/** Asks before something that cannot be undone: deleting a database or a table. */
function Confirm({ label, line, onCancel, onConfirm }: { label: string; line: string; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="db-confirm" role="alertdialog" aria-label={label} onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}>
      <p><b>{label}</b><br />{line}</p>
      <div className="db-confirm-actions">
        <button type="button" className="btn" autoFocus onClick={onCancel}>Cancel</button>
        <button type="button" className="btn danger" onClick={onConfirm}>Delete</button>
      </div>
    </div>
  );
}

type Menu = { x: number; y: number; db: string; table?: string };
type Asking = { db: string; table?: string };

/** The databases, the open one's tables, and making or importing one. */
export function DatabaseSidebar({ db, pin, changed }: { db: DatabasesState; pin: ReactNode; changed?: ReadonlySet<string> }) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [menu, setMenu] = useState<Menu | null>(null);
  const [renaming, setRenaming] = useState<Asking | null>(null);
  const [deleting, setDeleting] = useState<Asking | null>(null);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => { const go = () => file.current?.click(); window.addEventListener(IMPORT_CSV, go); return () => window.removeEventListener(IMPORT_CSV, go); }, []);
  useEffect(() => onCommand('new-database', () => setNaming(true)), []);
  // Import from Sheets: the workbooks and their sheets to choose from.
  const [books, setBooks] = useState<WorkbookInfo[] | null>(null);
  const pickSheet = async () => {
    const got = await window.mobius.sheets?.list();
    setBooks(got && !isNotesFailure(got) ? got : []);
  };
  const importSheet = async (workbook: string, sheet: string) => {
    setBooks(null);
    const got = await window.mobius.sheets?.read(workbook, sheet);
    if (!got || isNotesFailure(got)) { db.setMessage(got ? got.message : 'Sheets is not available.'); return; }
    await db.importFile(new File([sheetToCsv(got.values)], `${sheet}.csv`, { type: 'text/csv' }));
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await db.create(name)) { setNaming(false); setName(''); }
  };
  const copyTable = async (d: string, t: string) => {
    const csv = await db.tableCsv(d, t);
    if (csv !== null) await navigator.clipboard?.writeText(csv);
  };
  const items = (m: Menu): ContextMenuItem[] => m.table
    ? [
        { action: 'open', label: 'Open', keys: 'Enter', run: () => void db.choose(m.db, m.table) },
        { action: 'copy', label: 'Copy as CSV', run: () => void copyTable(m.db, m.table!) },
        { action: 'rename', label: 'Rename…', keys: 'F2', run: () => setRenaming({ db: m.db, table: m.table }) },
        { action: 'delete', label: 'Delete table…', keys: 'Delete', danger: true, separated: true, run: () => setDeleting({ db: m.db, table: m.table }) },
      ]
    : [
        { label: 'Import a CSV file…', run: () => { if (db.open !== m.db) void db.choose(m.db).then(() => file.current?.click()); else file.current?.click(); } },
        { label: 'Delete database…', keys: 'Delete', danger: true, separated: true, run: () => setDeleting({ db: m.db }) },
      ];
  const openMenu = (e: React.MouseEvent, at: Omit<Menu, 'x' | 'y'>, fromButton = false) => {
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    setMenu(fromButton ? { ...at, x: r.left, y: r.bottom + 4 } : { ...at, x: e.clientX, y: e.clientY });
  };
  /** Shift+F10 or the menu key opens a row's menu, as right-click does; F2 renames a table, Delete asks to delete. */
  const menuKey = (e: React.KeyboardEvent, at: Omit<Menu, 'x' | 'y'>) => {
    if (e.key === 'F2' && at.table) { e.preventDefault(); setRenaming({ db: at.db, table: at.table }); return; }
    if (e.key === 'Delete') { e.preventDefault(); setDeleting(at.table ? { db: at.db, table: at.table } : { db: at.db }); return; }
    if (!((e.shiftKey && e.key === 'F10') || e.key === 'ContextMenu')) return;
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    setMenu({ ...at, x: r.left + 12, y: r.bottom + 4 });
  };
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const hit = (text: string) => !q || text.toLowerCase().includes(q);
  const shownDbs = db.list.filter((d) => hit(d.name) || d.tables.some((t) => hit(t.name)));
  const rowsIn = (d: string) => db.list.find((x) => x.name === d)?.tables.reduce((n, t) => n + Math.max(0, t.rows), 0) ?? 0;
  return (
    <aside className="side db-side" aria-label="Database sidebar">
      {db.list.length > 0 && <input className="side-search" type="search" aria-label="Search databases and tables" placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setQuery(''); }} />}
      <div className="side-head">
        <span className="side-title">Databases</span>
        <span className="side-actions">
          {pin}
          <button type="button" className="strip-btn" aria-label="Import a CSV file" title="Import a CSV file as a table" onClick={() => file.current?.click()}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3v9M6.5 8.5 10 12l3.5-3.5M4 14v2.5h12V14" /></svg>
          </button>
          <button type="button" className="strip-btn" aria-label="Import a sheet" title="Import a sheet from Sheets as a table" aria-expanded={books !== null} onClick={() => (books ? setBooks(null) : void pickSheet())}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3.5" y="4" width="13" height="12" rx="2" /><path d="M3.5 8h13M3.5 12h13M8 4v12" /></svg>
          </button>
        </span>
      </div>
      <input ref={file} type="file" accept=".csv,text/csv" hidden aria-label="CSV file" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void db.importFile(f); }} />
      {books !== null && (
        <div className="db-pick" role="group" aria-label="Import a sheet">
          {books.length === 0 && <p className="design-hint">No workbooks in Sheets yet.</p>}
          {books.flatMap((b) => b.sheets.map((s) => (
            <button key={`${b.name}/${s}`} type="button" className="db-table" onClick={() => void importSheet(b.name, s)}>
              <span>{b.name} › {s}</span>
            </button>
          )))}
        </div>
      )}
      {naming && (
        <form className="notes-name" onSubmit={(e) => void submit(e)}>
          <input autoFocus aria-label="Database name" placeholder="Database name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setNaming(false); }} />
          <button type="submit" className="btn primary">Create</button>
        </form>
      )}
      {db.list.length === 0 && !naming && (
        <p className="side-empty">No databases yet.</p>
      )}
      <ul className="db-list" aria-label="Databases">
        {q && shownDbs.length === 0 && <li className="db-none">No matches</li>}
        {shownDbs.map((d) => (
          <li key={d.name} className="db-item">
            <div className="db-line">
              <button type="button" className="note-row db-row" aria-current={db.open === d.name && !db.table ? 'page' : undefined} data-open={db.open === d.name || undefined} data-changed={changed?.has(d.name) || undefined}
                onClick={() => void db.choose(d.name)} onContextMenu={(e) => openMenu(e, { db: d.name })} onKeyDown={(e) => menuKey(e, { db: d.name })}>
                <DbIcon />
                <span className="db-name">{d.name}</span>
              </button>
              <button type="button" className="db-more" aria-label={`More for ${d.name}`} aria-haspopup="menu" aria-expanded={menu?.db === d.name && !menu.table} title="More (Shift+F10)" onClick={(e) => openMenu(e, { db: d.name }, true)}><MoreIcon /></button>
            </div>
            {deleting?.db === d.name && !deleting.table && (
              <Confirm label={`Delete “${d.name}”?`} line={`Its ${d.tables.length === 1 ? 'table' : `${d.tables.length} tables`} and ${rowsIn(d.name).toLocaleString()} ${rowsIn(d.name) === 1 ? 'row' : 'rows'} go too. This can’t be undone.`}
                onCancel={() => setDeleting(null)} onConfirm={() => { setDeleting(null); void db.remove(d.name); }} />
            )}
            {(db.open === d.name || (q && d.tables.some((t) => hit(t.name)))) && (
              <ul className="db-tables" aria-label={`Tables in ${d.name}`}>
                {d.tables.length === 0 && <li className="db-none">No tables yet</li>}
                {d.tables.filter((t) => hit(t.name) || hit(d.name)).map((t) => (
                  <li key={t.name}>
                    {renaming?.db === d.name && renaming.table === t.name ? (
                      <form className="notes-name db-rename" onSubmit={(e) => { e.preventDefault(); const to = String(new FormData(e.currentTarget).get('name') ?? ''); void db.renameTable(d.name, t.name, to).then((ok) => { if (ok) setRenaming(null); }); }}>
                        <input autoFocus name="name" aria-label={`New name for ${t.name}`} defaultValue={t.name} maxLength={60} onFocus={(e) => e.currentTarget.select()} onKeyDown={(e) => { if (e.key === 'Escape') setRenaming(null); }} />
                        <button type="submit" className="btn primary">Rename</button>
                      </form>
                    ) : (
                      <div className="db-line">
                        <button type="button" className="db-table" aria-current={db.table === t.name ? 'page' : undefined} title={t.columns.map((c) => `${c.name} ${c.type}`.trim()).join(', ')}
                          onClick={() => void db.choose(d.name, t.name)} onContextMenu={(e) => openMenu(e, { db: d.name, table: t.name })} onKeyDown={(e) => menuKey(e, { db: d.name, table: t.name })}>
                          <TableIcon />
                          <span className="db-name">{t.name}</span><span className="db-count">{t.rows < 0 ? '' : t.rows.toLocaleString()}</span>
                        </button>
                        <button type="button" className="db-more" aria-label={`More for ${t.name}`} aria-haspopup="menu" aria-expanded={menu?.table === t.name} title="More (Shift+F10)" onClick={(e) => openMenu(e, { db: d.name, table: t.name }, true)}><MoreIcon /></button>
                      </div>
                    )}
                    {deleting?.db === d.name && deleting.table === t.name && (
                      <Confirm label={`Delete the table “${t.name}”?`} line={`Its ${t.rows === 1 ? 'row goes' : `${Math.max(0, t.rows).toLocaleString()} rows go`} too. This can’t be undone.`}
                        onCancel={() => setDeleting(null)} onConfirm={() => { setDeleting(null); void db.dropTable(d.name, t.name); }} />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      {menu && createPortal(<ContextMenu x={menu.x} y={menu.y} label={menu.table ?? menu.db} items={items(menu)} onClose={() => setMenu(null)} />, document.body)}
      <FromMobius items={db.list.filter((d) => changed?.has(d.name)).map((d) => ({ key: d.name, name: d.name, current: db.open === d.name, onOpen: () => void db.choose(d.name) }))} />
    </aside>
  );
}

/** Keep or discard what Mobius changed in a database in its last turn: the whole file goes back. */
function useDbReview(review: { conversation: string } | null | undefined, name: string | null) {
  const [kept, setKept] = useState(false);
  useEffect(() => {
    let live = true;
    const check = async () => {
      if (!review) { setKept(false); return; }
      const last = await window.mobius.changes?.lastTurn(review.conversation).catch(() => null);
      const id = last && 'checkpoint' in last ? turnId(review.conversation, last.checkpoint) : null;
      if (live) setKept(id !== null && keptTurns('database').includes(id));
    };
    void check();
    window.addEventListener(KEPT_EVENT, check);
    return () => { live = false; window.removeEventListener(KEPT_EVENT, check); };
  }, [review?.conversation, name]); // eslint-disable-line react-hooks/exhaustive-deps
  const keep = async () => {
    if (!review) return;
    const last = await window.mobius.changes?.lastTurn(review.conversation).catch(() => null);
    const id = last && 'checkpoint' in last ? turnId(review.conversation, last.checkpoint) : null;
    if (id) keepTurn(id, 'database');
    setKept(true);
  };
  const discard = async () => {
    if (!review || !name) return;
    await window.mobius.changes.undoFile(review.conversation, `databases/${name}.sqlite`).catch(() => null);
  };
  return { show: Boolean(review) && !kept, keep, discard };
}

/** What the Data view's grid needs to change its rows: typing a cell's new value, and a cell's menu. */
type At = { row: number; col: number };
interface GridEdit {
  save: (row: number, col: number, text: string) => Promise<boolean>;
  menu: (e: React.MouseEvent | React.KeyboardEvent, row: number, col: number) => void;
  editing: At | null; setEditing: (at: At | null) => void;
  /** The one cell the grid's Tab stop lands on; the arrow keys move it. */
  active: At; setActive: (at: At) => void;
  onKey: (e: React.KeyboardEvent) => void;
}

/** One cell being typed into: Enter or leaving it keeps the text, Escape puts it back. */
function CellInput({ start, onDone }: { start: string; onDone: (text: string | null, byKey: boolean) => void }) {
  const done = useRef(false);
  const finish = (text: string | null, byKey = false) => { if (!done.current) { done.current = true; onDone(text, byKey); } };
  return (
    <input className="db-cell-input" size={1} autoFocus aria-label="Cell value" defaultValue={start} onFocus={(e) => e.currentTarget.select()}
      onBlur={(e) => finish(e.currentTarget.value)}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); finish(e.currentTarget.value, true); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(null, true); } }} />
  );
}

/** Rows as a table. With `onSort`, a column's heading sorts by it; with `edit`, a double-click changes a cell. */
function Grid({ columns, rows, sort, onSort, edit }: { columns: string[]; rows: DbCell[][]; sort?: Browse['sort']; onSort?: (column: string) => void; edit?: GridEdit }) {
  const decimals = columns.map((_, j) => columnDecimals(rows, j));
  const table = useRef<HTMLTableElement>(null);
  // The active cell takes focus when it moves, and again when typing into it ends, if the grid had it.
  const key = edit ? `${edit.active.row}:${edit.active.col}:${edit.editing ? 1 : 0}` : '';
  useEffect(() => {
    if (!edit || edit.editing || !table.current?.contains(document.activeElement)) return;
    table.current.querySelector<HTMLElement>('td[tabindex="0"]')?.focus();
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="db-grid-wrap">
      <table ref={table} className="db-grid" aria-label="Rows" role={edit ? 'grid' : undefined} data-editable={edit ? true : undefined} onKeyDown={edit?.onKey}>
        <thead>
          <tr>{columns.map((c, i) => {
            const by = sort?.column === c ? (sort.desc ? 'descending' : 'ascending') : undefined;
            return (
              <th key={i} scope="col" aria-sort={onSort ? (by ?? 'none') : undefined}>
                {onSort ? (
                  <button type="button" className="db-sort" title={by === 'ascending' ? `Sort ${c} high to low` : by === 'descending' ? 'Unsorted' : `Sort by ${c}`} onClick={() => onSort(c)}>
                    <span>{c}</span>
                    <svg viewBox="0 0 20 20" aria-hidden="true" data-dir={by}><path d="m6.5 8.5 3.5-3.5 3.5 3.5M6.5 11.5l3.5 3.5 3.5-3.5" /></svg>
                  </button>
                ) : c}
              </th>
            );
          })}</tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>{row.map((v, j) => {
              const typing = edit?.editing?.row === i && edit.editing.col === j;
              const active = edit?.active.row === i && edit.active.col === j;
              return (
                <td key={j} data-kind={v === null ? 'null' : typeof v} data-editing={typing || undefined} data-active={active || undefined} title={typeof v === 'string' && v.length > 40 ? v.slice(0, 2000) : undefined}
                  tabIndex={edit ? (active ? 0 : -1) : undefined}
                  onMouseDown={edit && !typing ? () => edit.setActive({ row: i, col: j }) : undefined}
                  onDoubleClick={edit && !typing ? () => edit.setEditing({ row: i, col: j }) : undefined}
                  onContextMenu={edit ? (e) => { edit.setActive({ row: i, col: j }); edit.menu(e, i, j); } : undefined}>
                  {typing ? <CellInput start={editText(v)} onDone={(text, byKey) => {
                    edit.setEditing(null);
                    // Finished from the keyboard, the cell keeps focus, so the keys go on working in the grid.
                    if (byKey) afterPaint(() => table.current?.querySelector<HTMLElement>('td[tabindex="0"]')?.focus());
                    if (text !== null) void edit.save(i, j, text);
                  }} /> : showCellIn(v, decimals[j] ?? 0)}
                </td>
              );
            })}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type CellMenu = { x: number; y: number; row: number; col: number };

/** A table's rows: filtered, sorted by a column, a page at a time; in a table with rowids, changed in place. */
/** Grey bars the shape of the rows that are coming: loading never shows a spinner. */
function Loading() {
  return (
    <div className="db-loading" aria-label="Loading rows" role="status">
      {[62, 48, 70, 40, 56, 66, 44, 58].map((w, i) => <span key={i} style={{ '--w': `${w}%` } as React.CSSProperties} />)}
    </div>
  );
}

const hasNoFilter = (b: Browse) => b.filter.trim() === '';

function DataView({ db }: { db: DatabasesState }) {
  const [filter, setFilter] = useState(db.browse.filter);
  const [editing, setEditing] = useState<At | null>(null);
  const [active, setActive] = useState<At>({ row: 0, col: 0 });
  const [menu, setMenu] = useState<CellMenu | null>(null);
  useEffect(() => { setFilter(db.browse.filter); setEditing(null); setActive({ row: 0, col: 0 }); }, [db.table]); // eslint-disable-line react-hooks/exhaustive-deps
  // Typing settles for a moment before the rows are read again.
  useEffect(() => {
    if (filter === db.browse.filter) return undefined;
    const t = window.setTimeout(() => db.setBrowse({ filter }), 200);
    return () => window.clearTimeout(t);
  }, [filter]); // eslint-disable-line react-hooks/exhaustive-deps
  const r = db.rows;
  const shown = r?.ok ? r.rows.length : 0;
  const last = db.total !== null ? (db.browse.page + 1) * PAGE_ROWS >= db.total : shown < PAGE_ROWS;
  // In a table that can be changed, each row comes with its rowid first; it is kept, not shown.
  const hasId = db.editable && r?.ok === true && r.columns[0] === ROWID;
  const columns = r?.ok ? (hasId ? r.columns.slice(1) : r.columns) : [];
  const rows = r?.ok ? (hasId ? r.rows.map((x) => x.slice(1)) : r.rows) : [];
  const rowid = (i: number) => (r?.ok && hasId ? Number(r.rows[i]?.[0]) : NaN);
  const types = db.list.find((d) => d.name === db.open)?.tables.find((t) => t.name === db.table)?.columns ?? [];
  const typeOf = (c: string) => types.find((t) => t.name === c)?.type ?? '';
  const save = (i: number, j: number, text: string) => db.setCell(rowid(i), columns[j]!, rows[i]![j] ?? null, typedValue(text, typeOf(columns[j]!)));
  const setNull = (i: number, j: number) => { if (rows[i]?.[j] !== null && rows[i]) void db.setCell(rowid(i), columns[j]!, rows[i]![j] ?? null, null); };
  const removeRow = (i: number) => { if (rows[i]) void db.deleteRow(rowid(i), columns, rows[i]!); };
  /** The grid's keys, as the ARIA grid pattern has them, while no cell is being typed into. */
  const onKey = (e: React.KeyboardEvent) => {
    if (editing || (e.target as HTMLElement).tagName === 'INPUT' || rows.length === 0) return;
    const last = { row: rows.length - 1, col: columns.length - 1 };
    const { row, col } = { row: Math.min(active.row, last.row), col: Math.min(active.col, last.col) };
    const ctrl = e.ctrlKey || e.metaKey;
    const move: Record<string, At | undefined> = {
      ArrowUp: { row: Math.max(0, row - 1), col }, ArrowDown: { row: Math.min(last.row, row + 1), col },
      ArrowLeft: { row, col: Math.max(0, col - 1) }, ArrowRight: { row, col: Math.min(last.col, col + 1) },
      Home: ctrl ? { row: 0, col: 0 } : { row, col: 0 }, End: ctrl ? last : { row, col: last.col },
      PageUp: { row: Math.max(0, row - 10), col }, PageDown: { row: Math.min(last.row, row + 10), col },
    };
    const to = move[e.key];
    if (to) { e.preventDefault(); setActive(to); return; }
    if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); setEditing({ row, col }); }
    else if ((e.shiftKey && e.key === 'F10') || e.key === 'ContextMenu') { e.preventDefault(); const b = (e.target as HTMLElement).getBoundingClientRect(); setMenu({ x: b.left + 8, y: b.bottom, row, col }); }
    else if (e.key === 'Delete' && ctrl) { e.preventDefault(); removeRow(row); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); setNull(row, col); }
    else if (ctrl && e.key.toLowerCase() === 'c') { e.preventDefault(); void navigator.clipboard?.writeText(editText(rows[row]![col] ?? null)); }
    else if (ctrl && e.key.toLowerCase() === 'z' && db.undo) { e.preventDefault(); void db.undoLast(); }
  };
  const edit: GridEdit | undefined = hasId ? {
    save, editing, setEditing, active, setActive, onKey,
    menu: (e, row, col) => { e.preventDefault(); const at = 'clientX' in e ? { x: e.clientX, y: e.clientY } : (() => { const b = e.currentTarget.getBoundingClientRect(); return { x: b.left + 8, y: b.bottom }; })(); setMenu({ ...at, row, col }); },
  } : undefined;
  // Text only, with each item's keys: there is no standard icon for Set to NULL, so none of the items has one.
  const items = (m: CellMenu): ContextMenuItem[] => [
    { label: `Edit ${columns[m.col]}`, keys: 'Enter', run: () => setEditing({ row: m.row, col: m.col }) },
    { label: 'Copy value', keys: 'Ctrl+C', run: () => void navigator.clipboard?.writeText(editText(rows[m.row]![m.col] ?? null)) },
    { label: 'Set to NULL', keys: 'Delete', disabled: rows[m.row]![m.col] === null, run: () => setNull(m.row, m.col) },
    { label: 'Delete row', keys: 'Ctrl+Delete', danger: true, separated: true, run: () => removeRow(m.row) },
  ];
  // A new row opens its first cell for typing once it is on the page.
  const [fresh, setFresh] = useState<number | null>(null);
  useEffect(() => {
    if (fresh === null || !r?.ok || !hasId) return;
    const at = r.rows.findIndex((x) => x[0] === fresh);
    if (at >= 0) { const c = Math.max(0, types.findIndex((x) => !/^id$/i.test(x.name))); setActive({ row: at, col: c }); setEditing({ row: at, col: c }); setFresh(null); }
  }, [r, fresh]); // eslint-disable-line react-hooks/exhaustive-deps
  const undo = db.undo && db.undo.db === db.open && db.undo.table === db.table ? db.undo : null;
  return (
    <>
      <DbTools db={db}>
        <input className="side-search db-filter" type="search" aria-label="Filter rows" placeholder="Filter rows" value={filter} onChange={(e) => setFilter(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setFilter(''); }} />
        {hasId && (
          <button type="button" className="strip-btn db-add" aria-label="Add row" title="Add a row at the end" onClick={() => void db.addRow().then((id) => setFresh(id))}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg>
          </button>
        )}
      </DbTools>
      <div className="db-result" aria-label="Result">
        {r && !r.ok && <p className="db-error" role="alert">{r.message}</p>}
        {!r && <Loading />}
        {r?.ok && <Grid columns={columns} rows={rows} sort={db.browse.sort} onSort={(c) => db.setBrowse({ sort: nextSort(db.browse.sort, c) })} edit={edit} />}
        {r?.ok && shown === 0 && db.browse.page === 0 && (
          <div className="db-empty">
            <p>{db.browse.filter.trim() ? 'No rows match.' : 'No rows yet.'}</p>
            {hasNoFilter(db.browse) && hasId && <button type="button" className="btn" onClick={() => void db.addRow().then((id) => setFresh(id))}>Add row</button>}
          </div>
        )}
        {r?.ok && shown > 0 && (
          <footer className="db-foot">
            <span className="db-foot-line" role="status">
              {pageLine(db.browse.page, shown, db.total, db.browse.filter.trim() !== '')}
              {!hasId && db.editable === false && shown > 0 && ' · This table has no rowids, so change it in SQL.'}
            </span>
            {(db.browse.page > 0 || !last) && (
              <span className="db-pager" role="group" aria-label="Pages">
                <button type="button" className="strip-btn" aria-label="Previous rows" title="Previous rows" disabled={db.browse.page === 0} onClick={() => db.setBrowse({ page: db.browse.page - 1 })}>
                  <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m12 5-5 5 5 5" /></svg>
                </button>
                <button type="button" className="strip-btn" aria-label="Next rows" title="Next rows" disabled={last} onClick={() => db.setBrowse({ page: db.browse.page + 1 })}>
                  <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m8 5 5 5-5 5" /></svg>
                </button>
              </span>
            )}
          </footer>
        )}
      </div>
      {undo && <UndoToast text={undo.label} onUndo={() => void db.undoLast()} onDismiss={() => db.setUndo(null)} />}
      {menu && createPortal(<ContextMenu x={menu.x} y={menu.y} label={`Row ${menu.row + 1}`} items={items(menu)} onClose={() => { setMenu(null); document.querySelector<HTMLElement>('.db-grid td[tabindex="0"]')?.focus(); }} />, document.body)}
    </>
  );
}

/** A table's columns: name, type, whether each needs a value, its default, and the key; and the statement that made it. */
function StructureView({ db }: { db: DatabasesState }) {
  const [cols, setCols] = useState<DbResult | null>(null);
  const [made, setMade] = useState('');
  const [copied, copy] = useCopied();
  const info = db.list.find((d) => d.name === db.open)?.tables.find((t) => t.name === db.table);
  useEffect(() => {
    const api = window.mobius.databases;
    if (!api || !db.open || !db.table) return undefined;
    let live = true;
    void Promise.all([api.query(db.open, structureQuery(db.table)), api.query(db.open, createdQuery(db.table))]).then(([c, m]) => {
      if (!live) return;
      setCols(c);
      setMade(m.ok && typeof m.rows[0]?.[0] === 'string' ? m.rows[0][0] : '');
    });
    return () => { live = false; };
  }, [db.open, db.table, info?.columns.map((c) => `${c.name}:${c.type}`).join()]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="db-structure">
      {!cols && <Loading />}
      {cols && !cols.ok && <p className="db-error" role="alert">{cols.message}</p>}
      {cols?.ok && (
        <table className="db-columns" aria-label="Columns">
          <thead><tr><th scope="col">Column</th><th scope="col">Type</th><th scope="col">Required</th><th scope="col">Default</th><th scope="col">Key</th></tr></thead>
          <tbody>
            {cols.rows.map(([name, type, notnull, dflt, pk]) => (
              <tr key={String(name)}>
                <td className="db-col-name">{String(name)}</td>
                <td><span className="db-type">{String(type || 'Any')}</span></td>
                <td>{notnull ? 'Yes' : ''}</td>
                <td className="db-mono">{dflt === null ? '' : String(dflt)}</td>
                <td>{Number(pk) > 0 ? 'Primary' : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {made && (
        <section className="db-made" aria-label="How the table was made">
          <div className="db-made-head">
            <h3>Made with</h3>
            <button type="button" className="btn" onClick={() => copy(made)}>{copied ? 'Copied' : 'Copy'}</button>
          </div>
          <pre className="db-mono">{made}</pre>
        </section>
      )}
    </div>
  );
}

/** A statement of the person's own, with the earlier ones a menu away, and what it gave. */
function SqlView({ db, placeholder }: { db: DatabasesState; placeholder: string }) {
  const [copied, copy] = useCopied();
  const [earlier, setEarlier] = useState<{ x: number; y: number } | null>(null);
  const r = db.result;
  return (
    <>
      <form className="db-editor" onSubmit={(e) => { e.preventDefault(); void db.run(); }}>
        <textarea
          aria-label="SQL"
          spellCheck={false}
          placeholder={placeholder}
          value={db.sql}
          rows={4}
          onChange={(e) => db.setSql(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void db.run(); } }}
        />
        <div className="db-actions">
          <button type="submit" className="btn primary" title="Run (Ctrl+Enter)" aria-keyshortcuts="Control+Enter" disabled={!db.sql.trim() || db.running}>{db.running ? 'Running…' : 'Run'}</button>
          {db.history.length > 0 && (
            <button type="button" className="btn" aria-haspopup="menu" aria-expanded={earlier !== null} onClick={(e) => { const b = e.currentTarget.getBoundingClientRect(); setEarlier(earlier ? null : { x: b.left, y: b.bottom + 4 }); }}>History</button>
          )}
          {earlier && createPortal(
            <ContextMenu x={earlier.x} y={earlier.y} label="Earlier statements" onClose={() => setEarlier(null)}
              items={db.history.slice(0, 12).map((q) => ({ label: q.replace(/\s+/g, ' ').replace(/^(.{63}).{2,}$/, '$1…'), run: () => db.setSql(q) }))} />,
            document.body,
          )}
          <span className="db-gap" />
          {r?.ok && r.columns.length > 0 && <button type="button" className="btn" onClick={() => copy(toCsv(r.columns, r.rows))}>{copied ? 'Copied' : 'Copy as CSV'}</button>}
        </div>
      </form>
      <div className="db-result" aria-label="Result">
        {!r && <p className="db-status db-hint">Write a statement and press Run. Mobius can write one for you: ask it in words.</p>}
        {r && !r.ok && <p className="db-error" role="alert">{r.message}</p>}
        {r?.ok && r.columns.length === 0 && <p className="db-status" role="status">Done. {r.changed === 1 ? '1 row changed' : `${r.changed} rows changed`}, in {r.ms} ms.</p>}
        {r?.ok && r.columns.length > 0 && (
          <>
            <p className="db-status" role="status">{r.rows.length === 1 ? '1 row' : `${r.rows.length.toLocaleString()} rows`}{r.truncated ? ' (the first ones only)' : ''} · {r.ms} ms</p>
            <Grid columns={r.columns} rows={r.rows} />
          </>
        )}
      </div>
    </>
  );
}

const VIEWS: { id: DbView; name: string }[] = [{ id: 'data', name: 'Data' }, { id: 'structure', name: 'Structure' }, { id: 'sql', name: 'SQL' }];

/** The open table's controls in the toolbar's middle: the view's own tools, then Data, Structure and SQL, last so they stay put. */
function DbTools({ db, children }: { db: DatabasesState; children?: ReactNode }) {
  return (
    <ToolbarControls label="Database">
      {children}
      {children && <span className="db-tools-sep" aria-hidden="true" />}
      <ViewSwitch label="View" views={VIEWS} value={db.view} onChange={db.show} />
    </ToolbarControls>
  );
}

/** The toolbar's title for Database: the open table, or the database when no table is open. */
export const databasePlace = (db: DatabasesState): string | null => (db.open ? db.table ?? db.open : null);

/** The toolbar's grey line: which database the table is in, and how many columns it has. */
export function databaseSub(db: DatabasesState): string | undefined {
  const table = db.list.find((d) => d.name === db.open)?.tables.find((t) => t.name === db.table);
  if (!db.open || !table) return undefined;
  return `${db.open} · ${table.columns.length === 1 ? '1 column' : `${table.columns.length} columns`}`;
}

/** The open database: a table's rows or columns, or a statement to run, and what it gave. */
export function DatabasePage({ db, review }: { db: DatabasesState; review?: { conversation: string } | null }) {
  const { show, keep, discard } = useDbReview(review, db.open);
  if (!db.open) {
    return (
      <section className="db-page empty" aria-label="Database">
        <EmptyState app="database" label="No database open" title={db.list.length ? 'No database open' : 'No databases yet'}
          line={db.list.length ? 'Choose one on the left, or import a CSV file to make a new one.' : 'Import a CSV file to make a table, then query it in SQL, or ask Mobius in words.'}
          action={{ label: 'Import a CSV file', run: () => window.dispatchEvent(new Event(IMPORT_CSV)) }} />
      </section>
    );
  }
  const info = db.list.find((d) => d.name === db.open);
  const table = info?.tables.find((t) => t.name === db.table);
  const view: DbView = table ? db.view : 'sql';
  return (
    <section className="db-page" aria-label="Database">
      {show && (
        <div className="note-review db-review" role="status">
          <span className="review-dot" aria-hidden="true" />
          <span className="note-review-text">Mobius changed this database in its last turn.{review && <WhyThis conversation={review.conversation} />}</span>
          <ReviewActions onKeep={keep} onDiscard={discard} />
        </div>
      )}
      {/* The table's name and its line are the toolbar's title (databasePlace); its views and tools sit in the toolbar's middle. */}
      {table && view !== 'data' && <DbTools db={db} />}
      {db.message && <p className="db-message" role="alert">{db.message}</p>}
      {view === 'data' && <DataView db={db} />}
      {view === 'structure' && <StructureView db={db} />}
      {view === 'sql' && <SqlView db={db} placeholder={info?.tables[0] ? `SELECT * FROM ${info.tables[0].name} LIMIT 100;` : 'CREATE TABLE …'} />}
    </section>
  );
}
