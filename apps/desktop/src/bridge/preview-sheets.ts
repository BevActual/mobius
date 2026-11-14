import type { SheetChart } from '@mobius/shared';
import { columnIndex } from '../sheets-view';

/**
 * The preview's Sheets: workbooks kept in memory while the preview is open, with a small formula reader (arithmetic,
 * references and ranges, SUM, AVERAGE, MIN, MAX, COUNT, ROUND), so Sheets can be used without the Rust core.
 */
type Book = { order: string[]; sheets: Record<string, string[][]> };
const csv = (text: string) => text.trim().split('\n').map((l) => l.split(','));

export const PREVIEW_BUDGET_BEFORE = 'Item,Supplier,Qty,Unit cost,Cost\nBattery packs,Veltro,8,6000,=C2*D2\nSled hire,Northfield,1,6500,=C3*D3\nMotor test rig,Brakes & Co,1,1800,=C4*D4\nJigs,In house,4,240,=C5*D5\n';
const BOOKS: Record<string, Book> = {
  'P2 budget': {
    order: ['Sheet 1', 'Timeline'],
    sheets: {
      'Sheet 1': csv(`${PREVIEW_BUDGET_BEFORE}Total,,,,=SUM(E2:E5)`),
      Timeline: csv('Day,What,Who\nMon 23,Packs arrive,Veltro\nTue 24,Chassis on the sled,Sam\nWed 25,Packs fitted,Priya\nThu 26,Motor at full load,Sam\nFri 27,Two running chassis,Everyone'),
    },
  },
  'Sales 2025': { order: ['Sheet 1'], sheets: { 'Sheet 1': csv('Month,Units,Revenue\nJan,132,=B2*45\nFeb,128,=B3*45\nMar,140,=B4*45\nApr,41,=B5*45\nMay,137,=B6*45\nJun,151,=B7*45') } },
  'Offsite budget': { order: ['Budget'], sheets: { Budget: csv('Item,Qty,Unit,Total\nHotel,14,320,=B2*C2\nTerrace venue,1,620,=B3*C3\nLunch,8,40,=B4*C4\nTotal,,,=SUM(D2:D4)') } },
};
let version = 0;
/** The preview's charts, as a workbook's .charts.json holds them. */
const CHARTS: Record<string, SheetChart[]> = { 'Sales 2025': [{ sheet: 'Sheet 1', kind: 'column', range: 'A1:B7', at: 'E1', title: 'Units by month' }] };

type Val = number | string;
class Fail extends Error {}
function evaluate(book: Book, sheet: string, r: number, c: number, seen: Set<string>): Val {
  const raw = book.sheets[sheet]?.[r]?.[c] ?? '';
  if (!raw.startsWith('=')) { const n = Number(raw.replace(/[$,]/g, '')); return raw.trim() !== '' && Number.isFinite(n) ? n : raw; }
  const here = `${sheet}!${r}:${c}`;
  if (seen.has(here)) throw new Fail('#CYCLE!');
  seen.add(here);
  try {
    const src = raw.slice(1);
    let i = 0;
    const ws = () => { while (src[i] === ' ') i++; };
    const ref = (): { sheet: string; r: number; c: number } | null => {
      const m = /^(?:([A-Za-z][\w ]*)!)?\$?([A-Za-z]{1,3})\$?(\d+)/.exec(src.slice(i));
      if (!m || /[\w(]/.test(src[i + m[0].length] ?? '')) return null;
      i += m[0].length;
      return { sheet: m[1] ?? sheet, r: Number(m[3]) - 1, c: columnIndex(m[2]!) };
    };
    const num = (v: Val) => { if (typeof v === 'number') return v; if (v === '') return 0; throw new Fail('#VALUE!'); };
    const list = (): Val[] => {
      const out: Val[] = [];
      ws();
      if (src[i] === ')') { i++; return out; }
      for (;;) {
        ws();
        const at = i;
        const a = ref();
        ws();
        if (a && src[i] === ':') {
          i++;
          const b = ref();
          if (!b) throw new Fail('#REF!');
          for (let y = Math.min(a.r, b.r); y <= Math.max(a.r, b.r); y++) for (let x = Math.min(a.c, b.c); x <= Math.max(a.c, b.c); x++) out.push(evaluate(book, a.sheet, y, x, seen));
        } else { i = at; out.push(expr()); }
        ws();
        if (src[i] === ',') { i++; continue; }
        if (src[i] === ')') { i++; return out; }
        throw new Fail('#VALUE!');
      }
    };
    const atom = (): Val => {
      ws();
      if (src[i] === '(') { i++; const v = expr(); ws(); i++; return v; }
      if (src[i] === '-') { i++; return -num(atom()); }
      const n = /^\d+(\.\d+)?/.exec(src.slice(i));
      if (n) { i += n[0].length; return Number(n[0]); }
      const fn = /^([A-Za-z]+)\(/.exec(src.slice(i));
      if (fn) {
        i += fn[0].length;
        const args = list();
        const nums = args.filter((v): v is number => typeof v === 'number');
        switch (fn[1]!.toUpperCase()) {
          case 'SUM': return nums.reduce((a, b) => a + b, 0);
          case 'AVERAGE': if (!nums.length) throw new Fail('#DIV/0!'); return nums.reduce((a, b) => a + b, 0) / nums.length;
          case 'MIN': return nums.length ? Math.min(...nums) : 0;
          case 'MAX': return nums.length ? Math.max(...nums) : 0;
          case 'COUNT': return nums.length;
          case 'ROUND': { const p = 10 ** num(args[1] ?? 0); return Math.round(num(args[0] ?? 0) * p) / p; }
          default: throw new Fail('#NAME?');
        }
      }
      const a = ref();
      if (a) return evaluate(book, a.sheet, a.r, a.c, seen);
      throw new Fail('#VALUE!');
    };
    const power = (): Val => { let v = atom(); ws(); while (src[i] === '^') { i++; v = num(v) ** num(atom()); ws(); } return v; };
    const term = (): Val => {
      let v = power();
      ws();
      while (src[i] === '*' || src[i] === '/') {
        const op = src[i++];
        const w = num(power());
        if (op === '/' && w === 0) throw new Fail('#DIV/0!');
        v = op === '*' ? num(v) * w : num(v) / w;
        ws();
      }
      return v;
    };
    function expr(): Val {
      let v = term();
      ws();
      while (src[i] === '+' || src[i] === '-') { const op = src[i++]; const w = num(term()); v = op === '+' ? num(v) + w : num(v) - w; ws(); }
      return v;
    }
    const v = expr();
    if (i < src.length) throw new Fail('#VALUE!');
    return v;
  } finally { seen.delete(here); }
}
function shown(book: Book, sheet: string, r: number, c: number): string {
  try { const v = evaluate(book, sheet, r, c, new Set()); return typeof v === 'number' ? String(Number(v.toFixed(10))) : v; } catch (e) { return e instanceof Fail ? e.message : '#VALUE!'; }
}
function read(workbook: string, sheet: string) {
  const book = BOOKS[workbook];
  const cells = book?.sheets[sheet];
  if (!book || !cells) return { ok: false as const, message: `There is no sheet called ${sheet}.` };
  return { workbook, sheet, sheets: [...book.order], cells: cells.map((r) => [...r]), values: cells.map((row, r) => row.map((_, c) => shown(book, sheet, r, c))), version: `v${version}`, charts: (CHARTS[workbook] ?? []).filter((c) => c.sheet === sheet) };
}
const changed = (_workbook: string) => { version++; };
const trim = (rows: string[][]) => {
  for (const row of rows) while (row.length && row[row.length - 1] === '') row.pop();
  while (rows.length && rows[rows.length - 1]!.length === 0) rows.pop();
};

export const PREVIEW_SHEETS: Record<string, (...args: never[]) => unknown> = {
  'sheets.list': () => Object.entries(BOOKS).map(([name, b]) => ({ name, sheets: [...b.order] })),
  'sheets.read': read as never,
  'sheets.set': ((workbook: string, sheet: string, cells: { row: number; col: number; text: string }[]) => {
    const rows = BOOKS[workbook]?.sheets[sheet];
    if (!rows) return read(workbook, sheet);
    for (const { row, col, text } of cells) {
      while (rows.length <= row) rows.push([]);
      const r = rows[row]!;
      while (r.length <= col) r.push('');
      r[col] = text;
    }
    trim(rows);
    changed(workbook);
    return read(workbook, sheet);
  }) as never,
  'sheets.shift': ((workbook: string, sheet: string, what: 'row' | 'column', at: number, insert: boolean) => {
    const rows = BOOKS[workbook]?.sheets[sheet];
    if (!rows) return read(workbook, sheet);
    if (what === 'row') { if (insert) rows.splice(at, 0, []); else rows.splice(at, 1); } else for (const r of rows) { if (insert) { if (r.length > at) r.splice(at, 0, ''); } else r.splice(at, 1); }
    trim(rows);
    changed(workbook);
    return read(workbook, sheet);
  }) as never,
  'sheets.createWorkbook': ((name: string) => { BOOKS[name] = { order: ['Sheet 1'], sheets: { 'Sheet 1': [] } }; changed(name); return { name, sheet: 'Sheet 1' }; }) as never,
  'sheets.addSheet': ((workbook: string, name: string) => { const b = BOOKS[workbook]!; b.order.push(name); b.sheets[name] = []; changed(workbook); return { workbook, sheet: name }; }) as never,
  'sheets.renameSheet': ((workbook: string, sheet: string, name: string) => { const b = BOOKS[workbook]!; b.sheets[name] = b.sheets[sheet]!; delete b.sheets[sheet]; b.order = b.order.map((s) => (s === sheet ? name : s)); changed(workbook); return { workbook, sheet: name }; }) as never,
  'sheets.removeSheet': ((workbook: string, sheet: string) => { const b = BOOKS[workbook]!; delete b.sheets[sheet]; b.order = b.order.filter((s) => s !== sheet); changed(workbook); return { workbook, removed: sheet }; }) as never,
};
