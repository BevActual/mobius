import type { DbCell, DbResult } from '@mobius/shared';

/**
 * The preview's Database: two databases kept in memory for as long as the preview is open, so the app can be used and
 * looked at without the Rust core. It understands the statements the app writes itself (a page of rows, sorted and
 * filtered; a count; a table's columns; a rename; a drop; changing a cell, adding, deleting and putting back a row), and a
 * plain SELECT * of a table. Anything else is refused.
 */
interface Table { columns: { name: string; type: string; notnull?: boolean; pk?: boolean }[]; rows: DbCell[][]; ids?: number[] }

const SUPPLIERS = ['Veltro', 'Ardent Cells', 'Harlow Steel', 'Pike Fasteners', 'Lumen Glass'];
const PARTS: [string, string, number][] = [
  ['Battery pack 72 kWh', 'Veltro', 8420], ['Cell module', 'Ardent Cells', 610], ['Cooling plate', 'Veltro', 145.5], ['Front subframe', 'Harlow Steel', 980],
  ['Rear subframe', 'Harlow Steel', 1040], ['Door hinge set', 'Pike Fasteners', 38.2], ['Windscreen', 'Lumen Glass', 412], ['Side glass, left', 'Lumen Glass', 96],
  ['Side glass, right', 'Lumen Glass', 96], ['M8 flange bolt (100)', 'Pike Fasteners', 21.75], ['Busbar kit', 'Ardent Cells', 233], ['Torque arm', 'Harlow Steel', 187],
  ['Charge port', 'Veltro', 158], ['Sunroof panel', 'Lumen Glass', 640], ['Seat rail', 'Harlow Steel', 74.9], ['Wiring loom', 'Veltro', 1290],
];
const day = (offset: number): string => { const d = new Date(); d.setDate(d.getDate() + offset); return d.toISOString().slice(0, 10); };

const DBS: Record<string, Record<string, Table>> = {
  'Kestrel P2': {
    parts: {
      columns: [{ name: 'id', type: 'INTEGER', pk: true }, { name: 'Part', type: 'TEXT', notnull: true }, { name: 'Supplier', type: 'TEXT' }, { name: 'Qty', type: 'INTEGER' }, { name: 'Unit price', type: 'REAL' }, { name: 'Due', type: 'TEXT' }, { name: 'Status', type: 'TEXT' }],
      rows: Array.from({ length: 124 }, (_, i) => {
        const [part, supplier, price] = PARTS[i % PARTS.length]!;
        const batch = Math.floor(i / PARTS.length);
        return [i + 1, batch ? `${part} (lot ${batch + 1})` : part, supplier, ((i * 7) % 23) + 1, price, day((i * 3) % 40 - 6), i % 9 === 0 ? null : ['Ordered', 'In transit', 'Received', 'Ordered'][i % 4]!];
      }),
    },
    suppliers: {
      columns: [{ name: 'Name', type: 'TEXT', notnull: true, pk: true }, { name: 'Contact', type: 'TEXT' }, { name: 'Lead days', type: 'INTEGER' }, { name: 'Rating', type: 'REAL' }],
      rows: SUPPLIERS.map((s, i) => [s, `${['dana', 'sam', 'priya', 'lee', 'ana'][i]}@${s.toLowerCase().replace(/\W+/g, '')}.example`, [12, 30, 9, 4, 21][i]!, [4.6, 4.1, 4.8, 3.9, 4.4][i]!]),
    },
    builds: {
      columns: [{ name: 'Week', type: 'TEXT' }, { name: 'Vehicles', type: 'INTEGER' }, { name: 'Notes', type: 'TEXT' }],
      rows: [[day(-14), 2, 'First fit'], [day(-7), 3, null], [day(0), 4, 'Build week'], [day(7), 4, null]],
    },
  },
  Household: {
    bills: { columns: [{ name: 'Bill', type: 'TEXT' }, { name: 'Amount', type: 'REAL' }, { name: 'Due', type: 'TEXT' }], rows: [['Power', 84.2, day(5)], ['Water', 31, day(12)], ['Internet', 45, day(19)]] },
  },
};

const ok = (columns: string[], rows: DbCell[][], changed = 0): DbResult => ({ ok: true, columns, rows, changed, truncated: false, ms: 1 });
const fail = (message: string): DbResult => ({ ok: false, message });
const unquote = (s: string) => s.replace(/^"|"$/g, '').replace(/""/g, '"');
const text = (v: DbCell) => (v === null ? '' : String(v)).toLowerCase();
let listeners: ((change: { name: string | null; by: 'person' }) => void)[] = [];

/** Each row's rowid, given once and kept as rows come and go. */
const ids = (t: Table): number[] => (t.ids ??= t.rows.map((_, i) => i + 1));
let lastId = 0;
/** One SQL value: NULL, a number, or text in single quotes. */
function literal(src: string): DbCell {
  const t = src.trim();
  if (/^null$/i.test(t)) return null;
  if (t.startsWith("'")) return t.slice(1, -1).replace(/''/g, "'");
  return Number(t);
}
/** A list of values, split at the commas outside quotes. */
function literals(src: string): DbCell[] {
  const out: string[] = [];
  let cur = '', quoted = false;
  for (const ch of src) {
    if (ch === "'") quoted = !quoted;
    if (ch === ',' && !quoted) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map(literal);
}

function query(name: string, raw: string): DbResult {
  const db = DBS[name];
  if (!db) return fail('no such database');
  const sql = raw.trim().replace(/;$/, '');
  const top = /^SELECT max\(rowid\) FROM ("(?:[^"]|"")+")$/i.exec(sql);
  if (top) { const t = db[unquote(top[1]!)]; return t ? ok(['max(rowid)'], [[Math.max(0, ...ids(t)) || null]]) : fail('no such table'); }
  let e = /^UPDATE ("(?:[^"]|"")+") SET ("(?:[^"]|"")+") = (.+) WHERE rowid = (\d+)$/i.exec(sql);
  if (e) {
    const t = db[unquote(e[1]!)]; if (!t) return fail('no such table');
    const col = t.columns.findIndex((c) => c.name === unquote(e![2]!)); const at = ids(t).indexOf(Number(e[4]));
    if (col < 0) return fail('no such column'); if (at >= 0) t.rows[at]![col] = literal(e[3]!);
    return ok([], [], at >= 0 ? 1 : 0);
  }
  e = /^DELETE FROM ("(?:[^"]|"")+") WHERE rowid = (\d+)$/i.exec(sql);
  if (e) { const t = db[unquote(e[1]!)]; if (!t) return fail('no such table'); const at = ids(t).indexOf(Number(e[2])); if (at >= 0) { t.rows.splice(at, 1); ids(t).splice(at, 1); } return ok([], [], at >= 0 ? 1 : 0); }
  e = /^INSERT INTO ("(?:[^"]|"")+") DEFAULT VALUES$/i.exec(sql);
  if (e) {
    const t = db[unquote(e[1]!)]; if (!t) return fail('no such table');
    const bad = t.columns.find((c) => c.notnull && !c.pk); if (bad) return fail(`NOT NULL constraint failed: ${unquote(e[1]!)}.${bad.name}`);
    lastId = Math.max(0, ...ids(t)) + 1;
    t.rows.push(t.columns.map((c) => (c.pk && c.type === 'INTEGER' ? lastId : null))); ids(t).push(lastId);
    return ok([], [], 1);
  }
  e = /^INSERT INTO ("(?:[^"]|"")+") \(((?!rowid)"[^)]+)\) VALUES \((.+)\)$/i.exec(sql);
  if (e) {
    const t = db[unquote(e[1]!)]; if (!t) return fail('no such table');
    const names = e[2]!.split(/,\s*/).map(unquote); const values = literals(e[3]!);
    lastId = Math.max(0, ...ids(t)) + 1;
    t.rows.push(t.columns.map((c) => { const at = names.indexOf(c.name); return at >= 0 ? values[at]! : c.pk && c.type === 'INTEGER' ? lastId : null; })); ids(t).push(lastId);
    return ok([], [], 1);
  }
  e = /^INSERT INTO ("(?:[^"]|"")+") \(rowid, (.+?)\) VALUES \((.+)\)$/i.exec(sql);
  if (e) {
    const t = db[unquote(e[1]!)]; if (!t) return fail('no such table');
    const [id, ...values] = literals(e[3]!);
    const at = ids(t).findIndex((x) => x > Number(id)); const place = at < 0 ? t.rows.length : at;
    t.rows.splice(place, 0, values); ids(t).splice(place, 0, Number(id));
    return ok([], [], 1);
  }
  let m = /^ALTER TABLE ("(?:[^"]|"")+") RENAME TO ("(?:[^"]|"")+")$/i.exec(sql);
  if (m) { const [from, to] = [unquote(m[1]!), unquote(m[2]!)]; if (!db[from]) return fail(`no such table: ${from}`); db[to] = db[from]!; delete db[from]; return ok([], [], 0); }
  m = /^DROP TABLE ("(?:[^"]|"")+")$/i.exec(sql);
  if (m) { const t = unquote(m[1]!); if (!db[t]) return fail(`no such table: ${t}`); delete db[t]; return ok([], [], 0); }
  m = /pragma_table_info\('((?:[^']|'')+)'\)/i.exec(sql);
  if (m) { const t = db[m[1]!.replace(/''/g, "'")]; return t ? ok(['name', 'type', 'notnull', 'dflt_value', 'pk'], t.columns.map((c) => [c.name, c.type, c.notnull ? 1 : 0, null, c.pk ? 1 : 0])) : fail('no such table'); }
  m = /FROM sqlite_master WHERE type = 'table' AND name = '((?:[^']|'')+)'/i.exec(sql);
  if (m) {
    const n = m[1]!.replace(/''/g, "'");
    const t = db[n];
    return t ? ok(['sql'], [[`CREATE TABLE "${n}" (\n${t.columns.map((c) => `  "${c.name}" ${c.type}${c.pk ? ' PRIMARY KEY' : ''}${c.notnull ? ' NOT NULL' : ''}`).join(',\n')}\n)`]]) : ok(['sql'], []);
  }
  m = /^SELECT (?:rowid AS "__mobius_rowid", )?(\*|count\(\*\)) FROM ("(?:[^"]|"")+")(?: WHERE .*?, '((?:[^']|'')*)'\) > 0.*?)?(?: ORDER BY ("(?:[^"]|"")+") (ASC|DESC))?(?: LIMIT (\d+))?(?: OFFSET (\d+))?$/i.exec(sql);
  if (!m) return fail('The preview runs only simple statements, such as SELECT * FROM "parts" LIMIT 100. The app runs any.');
  const t = db[unquote(m[2]!)];
  if (!t) return fail(`no such table: ${unquote(m[2]!)}`);
  const words = m[3]?.replace(/''/g, "'");
  const withId = /^SELECT rowid AS/i.test(sql);
  let rows = t.rows.map((r, i) => (withId ? [ids(t)[i]!, ...r] : r)).filter((r) => !words || r.slice(withId ? 1 : 0).some((v) => text(v).includes(words)));
  if (m[1] !== '*') return ok(['count(*)'], [[rows.length]]);
  if (m[4]) {
    const at = t.columns.findIndex((c) => c.name === unquote(m![4]!)) + (withId ? 1 : 0);
    const sign = m[5]!.toUpperCase() === 'DESC' ? -1 : 1;
    rows.sort((a, b) => { const [x, y] = [a[at] ?? null, b[at] ?? null]; return x === y ? 0 : x === null ? -sign : y === null ? sign : (x < y ? -1 : 1) * sign; });
  }
  const offset = Number(m[7] ?? 0);
  rows = rows.slice(offset, m[6] ? offset + Number(m[6]) : undefined);
  return ok([...(withId ? ['__mobius_rowid'] : []), ...t.columns.map((c) => c.name)], rows);
}

const info = () => Object.entries(DBS).map(([name, tables]) => ({ name, modified: Date.now(), tables: Object.entries(tables).map(([t, x]) => ({ name: t, columns: x.columns.map((c) => ({ name: c.name, type: c.type })), rows: x.rows.length })) }));

export const PREVIEW_DATABASES: Record<string, (...args: never[]) => unknown> = {
  'databases.list': () => info(),
  'databases.query': ((name: string, sql: string) => query(name, sql)) as never,
  'databases.create': ((name: string) => { if (DBS[name]) return { ok: false, message: 'there is already a database by that name' }; DBS[name] = {}; return { ok: true, name }; }) as never,
  'databases.remove': ((name: string) => { delete DBS[name]; return { ok: true }; }) as never,
  'databases.onChanged': ((listener: (typeof listeners)[number]) => { listeners.push(listener); return () => { listeners = listeners.filter((l) => l !== listener); }; }) as never,
};
