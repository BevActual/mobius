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
