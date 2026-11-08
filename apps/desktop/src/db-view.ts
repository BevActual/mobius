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
