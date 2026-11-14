import { systemLocale } from './dates';
/** Column letters as spreadsheets name them: A..Z, AA..AZ, and on. */
export function columnName(col: number): string {
  let n = col;
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}
export const cellName = (row: number, col: number) => `${columnName(col)}${row + 1}`;

/** The same CSV the files are kept in (RFC 4180), for comparing a sheet with how it was before a turn. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const t = text.replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!;
    if (quoted) {
      if (c === '"' && t[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c;
      continue;
    }
    if (c === '"' && cell === '') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; } else if (c !== '\r') cell += c;
  }
  if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row); }
  return rows;
}

const at = (grid: readonly (readonly string[])[], r: number, c: number) => grid[r]?.[c] ?? '';

/** The cells that differ between two versions of a sheet, as "row:col". */
export function changedCells(before: readonly (readonly string[])[], after: readonly (readonly string[])[]): Set<string> {
  const out = new Set<string>();
  const rows = Math.max(before.length, after.length);
  for (let r = 0; r < rows; r++) {
    const cols = Math.max(before[r]?.length ?? 0, after[r]?.length ?? 0);
    for (let c = 0; c < cols; c++) if (at(before, r, c) !== at(after, r, c)) out.add(`${r}:${c}`);
  }
  return out;
}

/** A shown value that is a number (so it lines up on the right), as spreadsheets do. */
export const isNumeric = (shown: string) => /^-?[$€£¥]?\d[\d,]*(\.\d+)?%?$|^-?\d+(\.\d+)?e[+-]?\d+$/i.test(shown.trim());
export const isError = (shown: string) => /^#(DIV\/0!|VALUE!|REF!|NAME\?|NUM!|CYCLE!)$/.test(shown);

/** Text pasted from another spreadsheet (tab between cells, line breaks between rows) as cell changes from `row`,`col`. */
export function pasted(text: string, row: number, col: number): { row: number; col: number; text: string }[] {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n');
  return lines.flatMap((line, r) => line.split('\t').map((cell, c) => ({ row: row + r, col: col + c, text: cell })));
}

/** The sheet as a table the agent can read, for a suggestion that attaches it: values, with formulas noted. */
export function sheetContext(sheet: { workbook: string; sheet: string; cells: string[][]; values: string[][] }): string {
  const lines = [`# ${sheet.workbook} › ${sheet.sheet}`];
  sheet.cells.forEach((row, r) => row.forEach((raw, c) => {
    if (!raw) return;
    const value = sheet.values[r]?.[c] ?? '';
    lines.push(raw.startsWith('=') ? `${cellName(r, c)}: ${value} (${raw})` : `${cellName(r, c)}: ${value}`);
  }));
  return lines.join('\n');
}

/** A block of cells, top-left to bottom-right, whichever way it was dragged. */
export interface Range { r0: number; c0: number; r1: number; c1: number }
export const rangeOf = (a: { r: number; c: number }, b: { r: number; c: number }): Range => ({ r0: Math.min(a.r, b.r), c0: Math.min(a.c, b.c), r1: Math.max(a.r, b.r), c1: Math.max(a.c, b.c) });
export const inRange = (g: Range, r: number, c: number) => r >= g.r0 && r <= g.r1 && c >= g.c0 && c <= g.c1;
export const rangeName = (g: Range) => (g.r0 === g.r1 && g.c0 === g.c1 ? cellName(g.r0, g.c0) : `${cellName(g.r0, g.c0)}:${cellName(g.r1, g.c1)}`);
export const rangeSize = (g: Range) => (g.r1 - g.r0 + 1) * (g.c1 - g.c0 + 1);

/** Column letters back to a number: A is 0. */
export function columnIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Each cell reference in a formula outside quoted text, with where it sits; `Sheet!A1` and `A1:B3` included. */
const REF = /((?:'[^']+'|[A-Za-z_][\w ]*?)!)?(\$?)([A-Za-z]{1,3})(\$?)(\d+)(?::(\$?)([A-Za-z]{1,3})(\$?)(\d+))?/g;
function eachRef(formula: string, fn: (m: RegExpExecArray) => void) {
  // Quoted strings are left alone: split on them and look only at the parts between.
  let quoted = false;
  let start = 0;
  const parts: { at: number; text: string }[] = [];
  for (let i = 0; i <= formula.length; i++) {
    if (i === formula.length || formula[i] === '"') {
      if (!quoted) parts.push({ at: start, text: formula.slice(start, i) });
      quoted = !quoted;
      start = i + 1;
    }
  }
  for (const part of parts) {
    REF.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = REF.exec(part.text))) {
      const before = part.text[m.index - 1];
      const after = part.text[m.index + m[0].length];
      // A function name (SUM() or a longer word is not a reference.
      if ((before && /[\w.$]/.test(before)) || (after && /[\w(]/.test(after))) continue;
      const found = Object.assign([...m], { index: m.index + part.at, input: formula, groups: undefined }) as unknown as RegExpExecArray;
      fn(found);
    }
  }
}

/** The ranges a formula points at on its own sheet, in the order written, for colouring them while it is edited. */
export function refsIn(formula: string): Range[] {
  if (!formula.startsWith('=')) return [];
  const out: Range[] = [];
  eachRef(formula, (m) => {
    if (m[1]) return;
    const a = { r: Number(m[5]) - 1, c: columnIndex(m[3]!) };
    const b = m[7] ? { r: Number(m[9]) - 1, c: columnIndex(m[7]) } : a;
    out.push(rangeOf(a, b));
  });
  return out;
}

/** A formula as it reads once copied `dr` rows and `dc` columns away: relative references move, $ ones stay. */
export function shiftFormula(text: string, dr: number, dc: number, onlyRow?: number): string {
  if (!text.startsWith('=') || (dr === 0 && dc === 0)) return text;
  let out = '';
  let last = 0;
  eachRef(text, (m) => {
    // A row moved as a record (a sort) takes along only what points into that same row; the rest stays put.
    if (onlyRow !== undefined && (m[1] || Number(m[5]) !== onlyRow + 1 || (m[9] && Number(m[9]) !== onlyRow + 1))) return;
    const one = (colAbs: string, col: string, rowAbs: string, row: string) => {
      const c = colAbs ? columnIndex(col) : columnIndex(col) + dc;
      const r = rowAbs ? Number(row) : Number(row) + dr;
      if (c < 0 || r < 1) return null;
      return `${colAbs}${columnName(c)}${rowAbs}${r}`;
    };
    const a = one(m[2]!, m[3]!, m[4]!, m[5]!);
    const b = m[7] ? one(m[6]!, m[7], m[8]!, m[9]!) : '';
    out += text.slice(last, m.index) + (a === null || b === null ? '#REF!' : `${m[1] ?? ''}${a}${b ? `:${b}` : ''}`);
    last = m.index + m[0].length;
  });
  return out + text.slice(last);
}

/** A number as a cell shows it (`$1,200`, `12%`), or null. */
export function numberIn(shown: string): number | null {
  const t = shown.trim();
  if (!isNumeric(t)) return null;
  const pct = t.endsWith('%');
  const n = Number(t.replace(/[$€£¥,%]/g, ''));
  return Number.isFinite(n) ? (pct ? n / 100 : n) : null;
}

/** What the status bar says about the selected cells, as Numbers does: the sum, average, smallest and largest of the numbers. */
export function selectionStats(values: readonly string[]): { count: number; numbers: number; sum: number; average: number; min: number; max: number } {
  const nums = values.map(numberIn).filter((n): n is number => n !== null);
  const sum = nums.reduce((a, b) => a + b, 0);
  return { count: values.filter((v) => v !== '').length, numbers: nums.length, sum, average: nums.length ? sum / nums.length : 0, min: nums.length ? Math.min(...nums) : 0, max: nums.length ? Math.max(...nums) : 0 };
}

/** A number for the status bar: grouped the way this computer writes numbers, with at most two decimals. */
export const statNumber = (n: number) => n.toLocaleString(systemLocale(), { maximumFractionDigits: 2 });

/** What the Mobius panel's Glance says about a selection of more than one cell: the sum, average and count of its
 * numbers, or only how many cells hold something when none of them is a number. */
export function selectionGlance(stats: ReturnType<typeof selectionStats>): { label: string; value: string }[] {
  const count = { label: 'Count', value: String(stats.count) };
  return stats.numbers > 0
    ? [{ label: 'Sum', value: statNumber(stats.sum) }, { label: 'Average', value: statNumber(stats.average) }, count]
    : [count];
}

/** How a column shows its numbers. Automatic shows them as worked out or typed; the file keeps them plain either way. */
export type NumberFormat = 'auto' | 'number' | 'currency' | 'percent';
export const NUMBER_FORMATS: readonly { id: NumberFormat; label: string; example: string }[] = [
  { id: 'auto', label: 'Automatic', example: '1234.5' },
  { id: 'number', label: 'Number', example: '1,234.50' },
  { id: 'currency', label: 'Currency', example: '$1,234.50' },
  { id: 'percent', label: 'Percentage', example: '12%' },
];

/** The currency of the computer's region, for the Currency format; dollars where the region is not known. */
export function localCurrency(locale: string | undefined): string {
  const region = (() => { try { return new Intl.Locale(locale ?? navigator.language).maximize().region; } catch { return undefined; } })();
  const euro = ['AT', 'BE', 'CY', 'DE', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PT', 'SI', 'SK'];
  const byRegion: Record<string, string> = { US: 'USD', GB: 'GBP', CA: 'CAD', AU: 'AUD', NZ: 'NZD', JP: 'JPY', IN: 'INR', CH: 'CHF', SE: 'SEK', NO: 'NOK', DK: 'DKK', CN: 'CNY', KR: 'KRW', BR: 'BRL', MX: 'MXN', ZA: 'ZAR', SG: 'SGD', HK: 'HKD' };
  return region ? (euro.includes(region) ? 'EUR' : byRegion[region] ?? 'USD') : 'USD';
}

/** What a cell shows in a column with this format. Words, errors and empty cells are shown as they are. */
export function formatted(shown: string, format: NumberFormat | undefined, locale: string | undefined = systemLocale()): string {
  if (!format || format === 'auto') return shown;
  const n = numberIn(shown);
  if (n === null) return shown;
  try {
    if (format === 'percent') return n.toLocaleString(locale, { style: 'percent', maximumFractionDigits: 2 });
    if (format === 'currency') return n.toLocaleString(locale, { style: 'currency', currency: localCurrency(locale) });
    return n.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  } catch { return shown; }
}

/** Column formats after a column is put in (`insert`) or taken out at `at`: the ones after it move along. */
export function shiftFormats(formats: Readonly<Record<number, NumberFormat>>, at: number, insert: boolean): Record<number, NumberFormat> {
  const out: Record<number, NumberFormat> = {};
  for (const [k, f] of Object.entries(formats)) {
    const c = Number(k);
    if (c < at) out[c] = f;
    else if (insert) out[c + 1] = f;
    else if (c > at) out[c - 1] = f;
  }
  return out;
}

/**
 * The cells a fill puts beyond `seed` (as typed), `count` more along the way: two or more numbers keep their step,
 * text ending in a number counts on ("Week 1", "Week 2"), formulas move their references, anything else repeats.
 */
export function fillSeries(seed: readonly string[], count: number, along: 'down' | 'right'): string[] {
  const out: string[] = [];
  const nums = seed.map((s) => (s.startsWith('=') ? null : numberIn(s)));
  const allNums = seed.length >= 2 && nums.every((n) => n !== null) && seed.every((s) => !/[$€£¥%,]/.test(s));
  const step = allNums ? (nums[nums.length - 1]! - nums[0]!) / (seed.length - 1) : 0;
  const counted = seed.length === 1 ? /^(.*?)(\d+)$/.exec(seed[0]!) : null;
  for (let i = 0; i < count; i++) {
    const k = seed.length + i;
    if (allNums) { out.push(String(Number((nums[0]! + step * k).toFixed(10)))); continue; }
    const from = seed[k % seed.length]!;
    if (from.startsWith('=')) {
      const moved = k - (k % seed.length);
      out.push(along === 'down' ? shiftFormula(from, moved, 0) : shiftFormula(from, 0, moved));
    } else if (counted && !/^-?\d+$/.test(seed[0]!)) out.push(`${counted[1]}${Number(counted[2]) + k}`);
    else out.push(from);
  }
  return out;
}

/** Cells as text for the clipboard: tabs between cells, a line for each row, as other spreadsheets paste. */
export const toTsv = (rows: readonly (readonly string[])[]) => rows.map((r) => r.join('\t')).join('\n');

/** The rows `r0`..`r1` sorted by column `by`: numbers before text, empty cells last; formulas move with their row. */
export function sortedRows(cells: readonly (readonly string[])[], values: readonly (readonly string[])[], r0: number, r1: number, by: number, ascending: boolean): { row: number; col: number; text: string }[] {
  const width = Math.max(0, ...cells.slice(r0, r1 + 1).map((r) => r.length));
  const rows = Array.from({ length: r1 - r0 + 1 }, (_, i) => r0 + i);
  const key = (r: number) => values[r]?.[by] ?? '';
  const order = [...rows].sort((a, b) => {
    const x = key(a);
    const y = key(b);
    if (x === '' || y === '') return x === y ? a - b : x === '' ? 1 : -1;
    const nx = numberIn(x);
    const ny = numberIn(y);
    const d = nx !== null && ny !== null ? nx - ny : nx !== null ? -1 : ny !== null ? 1 : x.localeCompare(y, undefined, { numeric: true, sensitivity: 'base' });
    return (ascending ? d : -d) || a - b;
  });
  const out: { row: number; col: number; text: string }[] = [];
  order.forEach((from, i) => {
    const to = r0 + i;
    for (let c = 0; c < width; c++) {
      const text = shiftFormula(cells[from]?.[c] ?? '', to - from, 0, from);
      if (text !== (cells[to]?.[c] ?? '')) out.push({ row: to, col: c, text });
    }
  });
  return out;
}

/** The functions formulas can use, with how to call them, for the list shown while one is typed. */
export const FUNCTIONS: readonly { name: string; args: string; about: string }[] = [
  { name: 'SUM', args: 'numbers…', about: 'Adds up the numbers.' },
  { name: 'AVERAGE', args: 'numbers…', about: 'The average of the numbers.' },
  { name: 'MIN', args: 'numbers…', about: 'The smallest number.' },
  { name: 'MAX', args: 'numbers…', about: 'The largest number.' },
  { name: 'COUNT', args: 'values…', about: 'How many cells hold numbers.' },
  { name: 'COUNTA', args: 'values…', about: 'How many cells are not empty.' },
  { name: 'COUNTIF', args: 'range, test', about: 'How many cells pass a test, like ">100".' },
  { name: 'ROUND', args: 'number, places', about: 'Rounds to so many decimal places.' },
  { name: 'ROUNDUP', args: 'number, places', about: 'Rounds up, away from zero.' },
  { name: 'ROUNDDOWN', args: 'number, places', about: 'Rounds down, toward zero.' },
  { name: 'ABS', args: 'number', about: 'The number without its sign.' },
  { name: 'IF', args: 'test, then, else', about: 'One value when the test holds, another when not.' },
  { name: 'OR', args: 'tests…', about: 'True when any test holds.' },
  { name: 'NOT', args: 'test', about: 'The opposite of the test.' },
  { name: 'CONCATENATE', args: 'texts…', about: 'Joins text together.' },
  { name: 'LEN', args: 'text', about: 'How many characters.' },
  { name: 'TRIM', args: 'text', about: 'Takes extra spaces out.' },
  { name: 'UPPER', args: 'text', about: 'In capitals.' },
  { name: 'LOWER', args: 'text', about: 'In small letters.' },
];

/** The function name being typed just before the caret in a formula, if any ("=SU" gives "SU"). */
export function typingFunction(text: string, caret: number): { start: number; word: string } | null {
  if (!text.startsWith('=')) return null;
  const m = /[A-Za-z]+$/.exec(text.slice(0, caret));
  if (!m) return null;
  const before = text[m.index - 1];
  if (before !== undefined && !/[=(,+\-*/^&<>: ]/.test(before)) return null;
  if (/[\w(]/.test(text[caret] ?? '')) return null;
  return { start: m.index, word: m[0] };
}

/** Whether a click on a cell now would put its reference into the formula: right after =, an operator, ( or a comma. */
export const wantsRef = (text: string, caret: number) => text.startsWith('=') && /[=(,+\-*/^&<>:]\s*$/.test(text.slice(0, caret));

/** Where Ctrl+arrow lands from (`r`,`c`): the edge of the block of filled cells, or the next filled cell past a gap. */
export function jump(cells: readonly (readonly string[])[], r: number, c: number, dr: number, dc: number, maxR: number, maxC: number): { r: number; c: number } {
  const filled = (y: number, x: number) => (cells[y]?.[x] ?? '') !== '';
  const inside = (y: number, x: number) => y >= 0 && x >= 0 && y <= maxR && x <= maxC;
  let y = r;
  let x = c;
  if (filled(y, x) && inside(y + dr, x + dc) && filled(y + dr, x + dc)) {
    while (inside(y + dr, x + dc) && filled(y + dr, x + dc)) { y += dr; x += dc; }
    return { r: y, c: x };
  }
  y += dr; x += dc;
  while (inside(y, x) && !filled(y, x)) { y += dr; x += dc; }
  if (!inside(y, x)) return { r: Math.max(0, Math.min(maxR, y - dr)), c: Math.max(0, Math.min(maxC, x - dc)) };
  return { r: y, c: x };
}

/** The cells a quick formula (Σ) works over, and where its answer goes: below a column of numbers, or after a row. */
export function quickTarget(cells: readonly (readonly string[])[], values: readonly (readonly string[])[], sel: Range): { over: Range; at: { r: number; c: number } } | null {
  const num = (r: number, c: number) => numberIn(values[r]?.[c] ?? '') !== null;
  if (sel.r0 !== sel.r1 || sel.c0 !== sel.c1) {
    if (sel.c0 === sel.c1 || sel.r1 - sel.r0 >= sel.c1 - sel.c0) {
      let r = sel.r1 + 1;
      while ((cells[r]?.[sel.c0] ?? '') !== '') r++;
      return { over: { ...sel, c1: sel.c0 }, at: { r, c: sel.c0 } };
    }
    let c = sel.c1 + 1;
    while ((cells[sel.r0]?.[c] ?? '') !== '') c++;
    return { over: { ...sel, r1: sel.r0 }, at: { r: sel.r0, c } };
  }
  // One cell: the numbers just above it, or else just left of it.
  const { r0: r, c0: c } = sel;
  let top = r;
  while (top > 0 && num(top - 1, c)) top--;
  if (top < r) return { over: { r0: top, c0: c, r1: r - 1, c1: c }, at: { r, c } };
  let left = c;
  while (left > 0 && num(r, left - 1)) left--;
  if (left < c) return { over: { r0: r, c0: left, r1: r, c1: c - 1 }, at: { r, c } };
  return null;
}

/** A formula finished as spreadsheets finish one on Enter: an open quote and open brackets closed. */
export function closeFormula(text: string): string {
  if (!text.startsWith('=')) return text;
  let depth = 0;
  let quoted = false;
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === '(') depth++;
    else if (!quoted && ch === ')') depth = Math.max(0, depth - 1);
  }
  return text + (quoted ? '"' : '') + ')'.repeat(depth);
}

/** Whether the last used row is a footer (a total worked out over the rows above), which a sort leaves where it is. */
export function hasFooter(cells: readonly (readonly string[])[]): boolean {
  const last = cells[cells.length - 1] ?? [];
  return cells.length > 2 && last.some((t) => t.startsWith('=') && /[A-Za-z]+\d+:[A-Za-z]+\d+/.test(t));
}

/**
 * Every cell that holds the words looked for, row by row as a person reads: what the cell shows, or the formula behind
 * it, matched without regard to case.
 */
export function findCells(cells: readonly (readonly string[])[], values: readonly (readonly string[])[], query: string): { r: number; c: number }[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: { r: number; c: number }[] = [];
  const rows = Math.max(cells.length, values.length);
  for (let r = 0; r < rows; r++) {
    const cols = Math.max(cells[r]?.length ?? 0, values[r]?.length ?? 0);
    for (let c = 0; c < cols; c++) {
      const shown = (values[r]?.[c] ?? '').toLowerCase();
      const raw = (cells[r]?.[c] ?? '').toLowerCase();
      if (shown.includes(q) || (raw.startsWith('=') && raw.includes(q))) out.push({ r, c });
    }
  }
  return out;
}

/** A range written as A1:C7 (or one cell), or null when it is not one. */
export function parseRange(text: string): Range | null {
  const m = /^\s*\$?([A-Za-z]{1,3})\$?(\d+)(?::\$?([A-Za-z]{1,3})\$?(\d+))?\s*$/.exec(text);
  if (!m) return null;
  const a = { r: Number(m[2]) - 1, c: columnIndex(m[1]!) };
  const b = m[3] ? { r: Number(m[4]) - 1, c: columnIndex(m[3]) } : a;
  return a.r < 0 || b.r < 0 ? null : rangeOf(a, b);
}

/**
 * A sheet chart's numbers, read from the sheet's shown values: the range's first column names the categories and its
 * first row the series, as sheets.write describes. Null when the range holds no numbers to draw.
 */
export function chartData(range: string, values: readonly (readonly string[])[]): { categories: string[]; series: { name: string; values: (number | null)[] }[] } | null {
  const g = parseRange(range);
  if (!g || g.r1 <= g.r0 || g.c1 <= g.c0) return null;
  const at = (r: number, c: number) => values[r]?.[c] ?? '';
  const categories: string[] = [];
  for (let r = g.r0 + 1; r <= g.r1; r++) categories.push(at(r, g.c0));
  const series: { name: string; values: (number | null)[] }[] = [];
  for (let c = g.c0 + 1; c <= g.c1; c++) {
    const nums: (number | null)[] = [];
    for (let r = g.r0 + 1; r <= g.r1; r++) nums.push(numberIn(at(r, c)));
    series.push({ name: at(g.r0, c) || columnName(c), values: nums });
  }
  return series.some((s) => s.values.some((v) => v !== null)) ? { categories, series } : null;
}
