import type { DbCell } from '@mobius/shared';

/** A table or column name as SQL: in double quotes, any inside doubled. */
export const quoteIdent = (name: string): string => `"${name.replace(/"/g, '""')}"`;

/** The query a table opens with: its first rows. */
export const tableQuery = (table: string): string => `SELECT * FROM ${quoteIdent(table)} LIMIT 100;`;

/** A cell as shown: nothing for NULL (marked apart), numbers as they are, text on one line. */
export function showCell(v: DbCell): string {
  if (v === null) return 'NULL';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6);
  return v.length > 300 ? `${v.slice(0, 300)}…` : v;
}

/** The rows as CSV, to copy or keep elsewhere. */
export function toCsv(columns: string[], rows: DbCell[][]): string {
  const field = (v: DbCell) => {
    const s = v === null ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.map(field).join(','), ...rows.map((r) => r.map(field).join(','))].join('\n');
}

/** A sheet's worked-out values as CSV for a table: the rows and columns that hold something, the first row as names. */
export function sheetToCsv(values: string[][]): string {
  const rows = values.map((r) => r.map((v) => v ?? ''));
  let height = rows.length;
  while (height > 0 && rows[height - 1]!.every((v) => v.trim() === '')) height--;
  const width = Math.max(0, ...rows.slice(0, height).map((r) => { let w = r.length; while (w > 0 && r[w - 1]!.trim() === '') w--; return w; }));
  return toCsv(rows[0]?.slice(0, width).map((v, i) => v || `column_${i + 1}`) ?? [], rows.slice(1, height).map((r) => Array.from({ length: width }, (_, i) => r[i] ?? '')));
}

/** A table name from a file's name: without its extension, only the letters, digits and gaps a name needs. */
export function tableNameFor(file: string): string {
  const base = file.replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N} _-]+/gu, ' ').trim().replace(/\s+/g, '_').slice(0, 60);
  return base || 'imported';
}

/** A database name from what was typed: letters, digits, spaces, dashes and underscores. */
export function databaseNameFor(typed: string): string {
  return typed.replace(/[^\p{L}\p{N} _-]+/gu, '').replace(/\s+/g, ' ').trim().replace(/^-+/, '').slice(0, 60);
}

/** Whether a statement only reads, by its first word: such statements are safe to run again on their own. */
export const isReading = (sql: string): boolean => /^\s*(select|with|pragma\s+table_info|explain)\b/i.test(sql.replace(/^\s*--.*$/gm, ''));

/** The last statements run in a database, newest first, kept per device. */
const historyKey = (db: string) => `mobius.database.history.${db}`;
export function queryHistory(db: string): string[] {
  try {
    const v: unknown = JSON.parse(window.localStorage.getItem(historyKey(db)) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 20) : [];
  } catch { return []; }
}
export function rememberQuery(db: string, sql: string): string[] {
  const next = [sql.trim(), ...queryHistory(db).filter((q) => q !== sql.trim())].slice(0, 20);
  try { window.localStorage.setItem(historyKey(db), JSON.stringify(next)); } catch { /* Not kept. */ }
  return next;
}

/** Text as an SQL string: in single quotes, any inside doubled. */
export const sqlString = (text: string): string => `'${text.replace(/'/g, "''")}'`;

/** How the Data view shows a table: sorted by a column or not, filtered by words in any column, and which page. */
export interface Browse { sort: { column: string; desc: boolean } | null; filter: string; page: number }
export const FIRST_BROWSE: Browse = { sort: null, filter: '', page: 0 };
/** Rows on each page of the Data view. */
export const PAGE_ROWS = 100;

/** The rows where any column holds the words, ignoring case; nothing when there are no words. */
function whereFilter(columns: readonly string[], filter: string): string {
  const words = filter.trim().toLowerCase();
  if (!words || columns.length === 0) return '';
  return ` WHERE ${columns.map((c) => `instr(lower(CAST(${quoteIdent(c)} AS TEXT)), ${sqlString(words)}) > 0`).join(' OR ')}`;
}

/** The statement for one page of the Data view. */
export function browseQuery(table: string, columns: readonly string[], b: Browse, withRowid = false): string {
  const order = b.sort ? ` ORDER BY ${quoteIdent(b.sort.column)} ${b.sort.desc ? 'DESC' : 'ASC'}` : '';
  return `SELECT ${withRowid ? `rowid AS ${quoteIdent(ROWID)}, ` : ''}* FROM ${quoteIdent(table)}${whereFilter(columns, b.filter)}${order} LIMIT ${PAGE_ROWS} OFFSET ${b.page * PAGE_ROWS}`;
}

/** The hidden first column of the Data view's rows when they can be changed: each row's rowid, to say which row. */
export const ROWID = '__mobius_rowid';

/** A value as SQL: NULL, a number as it is, or text in quotes. */
export const sqlLiteral = (v: DbCell): string => (v === null ? 'NULL' : typeof v === 'number' ? String(v) : sqlString(v));

/** What was typed into a cell, as the value to keep: a number in a column of numbers, nothing when a number column is emptied, else the text. */
export function typedValue(text: string, type: string): DbCell {
  if (!/int|real|floa|doub|num|dec/i.test(type)) return text;
  const t = text.trim();
  if (t === '') return null;
  const n = Number(t.replace(/,/g, ''));
  return Number.isFinite(n) && /^[-+]?[\d,]*\.?\d+(e[-+]?\d+)?$/i.test(t) ? n : text;
}

/** A cell as it is typed into: NULL as nothing, numbers in full. */
export const editText = (v: DbCell): string => (v === null ? '' : String(v));

export const updateCellSql = (table: string, column: string, rowid: number, v: DbCell): string => `UPDATE ${quoteIdent(table)} SET ${quoteIdent(column)} = ${sqlLiteral(v)} WHERE rowid = ${rowid}`;
export const deleteRowSql = (table: string, rowid: number): string => `DELETE FROM ${quoteIdent(table)} WHERE rowid = ${rowid}`;
/** A new row: defaults everywhere, except a column that needs a value and has no default, which starts empty (or 0). */
export function addRowSql(table: string, needed: readonly { name: string; type: string }[] = []): string {
  if (needed.length === 0) return `INSERT INTO ${quoteIdent(table)} DEFAULT VALUES`;
  const blank = (type: string) => (/int|real|floa|doub|num|dec/i.test(type) ? '0' : "''");
  return `INSERT INTO ${quoteIdent(table)} (${needed.map((c) => quoteIdent(c.name)).join(', ')}) VALUES (${needed.map((c) => blank(c.type)).join(', ')})`;
}
/** A deleted row put back as it was, at its rowid. */
export const restoreRowSql = (table: string, rowid: number, columns: readonly string[], values: readonly DbCell[]): string =>
  `INSERT INTO ${quoteIdent(table)} (rowid, ${columns.map(quoteIdent).join(', ')}) VALUES (${rowid}, ${values.map(sqlLiteral).join(', ')})`;

/** How many rows the Data view's filter keeps. */
export const countQuery = (table: string, columns: readonly string[], filter: string): string => `SELECT count(*) FROM ${quoteIdent(table)}${whereFilter(columns, filter)}`;

/** A click on a column's heading: sort up by it, then down, then not at all. */
export function nextSort(now: Browse['sort'], column: string): Browse['sort'] {
  if (now?.column !== column) return { column, desc: false };
  return now.desc ? null : { column, desc: true };
}

/** The line under the Data view: which rows of how many are shown. */
export function pageLine(page: number, shown: number, total: number | null, filtered: boolean): string {
  const of = total === null ? '' : ` of ${total.toLocaleString()}`;
  if (shown === 0) return filtered ? 'No rows match' : 'No rows yet';
  const first = page * PAGE_ROWS + 1;
  const what = total === 1 ? 'row' : 'rows';
  return shown === total ? `${shown.toLocaleString()} ${what}${filtered ? (shown === 1 ? ' matches' : ' match') : ''}` : `${first.toLocaleString()}–${(first + shown - 1).toLocaleString()}${of} ${what}`;
}

export const renameTableSql = (from: string, to: string): string => `ALTER TABLE ${quoteIdent(from)} RENAME TO ${quoteIdent(to)}`;
export const dropTableSql = (table: string): string => `DROP TABLE ${quoteIdent(table)}`;
/** A table's columns as SQLite keeps them: name, type, whether a value is needed, the default, and the key. */
export const structureQuery = (table: string): string => `SELECT name, type, "notnull", dflt_value, pk FROM pragma_table_info(${sqlString(table)})`;
/** The statement that made the table. */
export const createdQuery = (table: string): string => `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ${sqlString(table)}`;

/** The decimals a column of numbers is shown with: as many as its most precise value needs, at most 6; 0 when all are whole. */
export function columnDecimals(rows: readonly DbCell[][], col: number): number {
  let most = 0;
  for (const r of rows) {
    const v = r[col];
    if (typeof v !== 'number' || Number.isInteger(v)) continue;
    const s = String(Math.round(v * 1e6) / 1e6);
    most = Math.max(most, s.includes('.') ? s.length - s.indexOf('.') - 1 : 0);
  }
  return Math.min(most, 6);
}

/** A cell as shown in a column: numbers in a column with decimals all carry the same number of them, in the region's format. */
export function showCellIn(v: DbCell, decimals: number): string {
  if (typeof v === 'number' && decimals > 0) return v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return showCell(v);
}
