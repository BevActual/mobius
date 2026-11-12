import type { Lang } from './code-view';

/**
 * The Code editor's text changes, kept apart from the screen so they can be tested: where the cursor is, indenting and
 * commenting whole lines, brackets that close themselves, finding in the file, and the quick-open file match. Each
 * change gives back the replaced span and its new text, so the editor can put it in as typing would (and keep undo).
 */
export interface Edit { from: number; to: number; insert: string; select: [number, number] }

/** The line and column (both from 1) of a place in the text. */
export function cursorAt(text: string, at: number): { line: number; col: number } {
  const before = text.slice(0, Math.max(0, Math.min(at, text.length)));
  const lineStart = before.lastIndexOf('\n') + 1;
  return { line: (before.match(/\n/g)?.length ?? 0) + 1, col: before.length - lineStart + 1 };
}

/** Where line `line` (from 1) starts; past the end gives the start of the last line. */
export function lineStart(text: string, line: number): number {
  let at = 0;
  for (let n = 1; n < line; n += 1) {
    const next = text.indexOf('\n', at);
    if (next < 0) break;
    at = next + 1;
  }
  return at;
}

/** The whole lines a selection touches: from the start of its first line to the end of its last. */
function linesOf(text: string, start: number, end: number): { from: number; to: number; lines: string[] } {
  const from = text.lastIndexOf('\n', start - 1) + 1;
  // A selection ending at the very start of a line does not take that line.
  const last = end > start && text[end - 1] === '\n' ? end - 1 : end;
  const stop = text.indexOf('\n', last);
  const to = stop < 0 ? text.length : stop;
  return { from, to, lines: text.slice(from, to).split('\n') };
}

/** Indent (or with `out`, outdent) every line the selection touches by `unit`, keeping the same lines selected. */
export function indentLines(text: string, start: number, end: number, out = false, unit = '  '): Edit {
  const { from, to, lines } = linesOf(text, start, end);
  let firstShift = 0;
  const changed = lines.map((l, i) => {
    if (!out) { if (i === 0) firstShift = unit.length; return l.length === 0 && lines.length > 1 ? l : unit + l; }
    const lead = /^[ \t]*/.exec(l)![0];
    const cut = lead.startsWith('\t') ? 1 : Math.min(lead.length, unit.length);
    if (i === 0) firstShift = -cut;
    return l.slice(cut);
  });
  const insert = changed.join('\n');
  const a = Math.max(from, start + firstShift);
  return { from, to, insert, select: start === end ? [a, a] : [a, from + insert.length + (end - to)] };
}

const COMMENT: Partial<Record<Lang, string>> = { ts: '//', rust: '//', go: '//', py: '#', sh: '#' };

/** Comment out the lines the selection touches, or bring them back when every one is commented. Null where the language has no line comment. */
export function toggleComment(text: string, start: number, end: number, lang: Lang): Edit | null {
  const mark = COMMENT[lang];
  if (!mark) return null;
  const { from, to, lines } = linesOf(text, start, end);
  const filled = lines.filter((l) => l.trim().length > 0);
  if (filled.length === 0) return null;
  const all = filled.every((l) => l.trimStart().startsWith(mark));
  const indent = Math.min(...filled.map((l) => /^[ \t]*/.exec(l)![0].length));
  const changed = lines.map((l) => {
    if (l.trim().length === 0) return l;
    if (all) return l.replace(new RegExp(`^([ \\t]*)${mark.replace(/\//g, '\\/')} ?`), '$1');
    return `${l.slice(0, indent)}${mark} ${l.slice(indent)}`;
  });
  const insert = changed.join('\n');
  const shift = insert.length - (to - from);
  const firstShift = (changed[0]?.length ?? 0) - (lines[0]?.length ?? 0);
  const a = Math.max(from, start + (start - from > indent || !all ? firstShift : 0));
  return { from, to, insert, select: start === end ? [a, a] : [a, end + shift] };
}

const PAIRS: Record<string, string> = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '`': '`' };
const CLOSERS = new Set([')', ']', '}', '"', "'", '`']);

/**
 * What typing `key` does when brackets close themselves: around a selection it wraps it; before a closer it already
 * typed it steps over it; otherwise an opener gets its closer after the cursor. Null leaves the key to the field.
 */
export function typePair(text: string, start: number, end: number, key: string): Edit | null {
  const close = PAIRS[key];
  const next = text[end] ?? '';
  if (start === end && CLOSERS.has(key) && next === key) return { from: start, to: start, insert: '', select: [start + 1, start + 1] };
  if (!close) return null;
  if (start !== end) return { from: start, to: end, insert: `${key}${text.slice(start, end)}${close}`, select: [start + 1, end + 1] };
  const prev = text[start - 1] ?? '';
  // Quotes only pair at the start of a word, so it's and don't type as they are.
  if (key === close && /[\w\\]/.test(prev)) return null;
  if (/\w/.test(next)) return null;
  return { from: start, to: start, insert: key + close, select: [start + 1, start + 1] };
}

/** Backspace between a bracket and its own closer takes both. */
export function deletePair(text: string, start: number, end: number): Edit | null {
  if (start !== end || start === 0) return null;
  const open = text[start - 1]!;
  return PAIRS[open] !== undefined && text[start] === PAIRS[open] ? { from: start - 1, to: start + 1, insert: '', select: [start - 1, start - 1] } : null;
}

/** Enter between brackets opens a block: the cursor on its own indented line and the closer under the opener's line. */
export function newLine(text: string, start: number, end: number, unit = '  '): Edit {
  const ls = text.lastIndexOf('\n', start - 1) + 1;
  const indent = /^[ \t]*/.exec(text.slice(ls, start))![0];
  const open = text[start - 1] ?? '';
  const close = text[end] ?? '';
  if ('([{'.includes(open) && open !== '' && PAIRS[open] === close) {
    const insert = `\n${indent}${unit}\n${indent}`;
    const at = start + 1 + indent.length + unit.length;
    return { from: start, to: end, insert, select: [at, at] };
  }
  const extra = /[([{:]$/.test(text.slice(ls, start).trimEnd()) && open !== '' ? unit : '';
  const insert = `\n${indent}${extra}`;
  return { from: start, to: end, insert, select: [start + insert.length, start + insert.length] };
}

/** Every place `query` is found, as [start, end], ignoring case unless `matchCase`. */
export function findAll(text: string, query: string, matchCase = false, limit = 5000): [number, number][] {
  if (!query) return [];
  const hay = matchCase ? text : text.toLowerCase();
  const needle = matchCase ? query : query.toLowerCase();
  const out: [number, number][] = [];
  for (let at = hay.indexOf(needle); at >= 0 && out.length < limit; at = hay.indexOf(needle, at + needle.length)) out.push([at, at + needle.length]);
  return out;
}

/**
 * How well a file's path answers what was typed in quick open, higher is better, or null when it does not: the letters
 * must come in order; runs of letters, the start of a name or word, and the file's own name count for more.
 */
export function fileScore(query: string, path: string): number | null {
  const q = query.toLowerCase().replace(/\s+/g, '');
  if (!q) return 0;
  const p = path.toLowerCase();
  const nameAt = p.lastIndexOf('/') + 1;
  let score = 0;
  let at = -1;
  let run = 0;
  for (const ch of q) {
    const found = p.indexOf(ch, at + 1);
    if (found < 0) return null;
    run = found === at + 1 ? run + 1 : 0;
    score += 1 + run * 2;
    if (found === nameAt) score += 6;
    else if (found > 0 && /[/._-]/.test(p[found - 1]!)) score += 3;
    if (found >= nameAt) score += 1;
    at = found;
  }
  // Shorter paths win a tie, so `budget` finds src/budget.js before tests/budget.test.js.
  return score - path.length / 100;
}

/** The files that answer the query, best first. */
export function rankFiles(query: string, paths: readonly string[], limit = 40): string[] {
  return paths
    .map((path) => ({ path, score: fileScore(query, path) }))
    .filter((r): r is { path: string; score: number } => r.score !== null)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, limit)
    .map((r) => r.path);
}

/** A file's language as the status bar names it. */
export function langName(path: string): string {
  const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase() ?? '';
  const named: Record<string, string> = { js: 'JavaScript', jsx: 'JavaScript JSX', mjs: 'JavaScript', cjs: 'JavaScript', ts: 'TypeScript', tsx: 'TypeScript JSX', mts: 'TypeScript', cts: 'TypeScript', rs: 'Rust', py: 'Python', go: 'Go', json: 'JSON', jsonc: 'JSON', css: 'CSS', scss: 'SCSS', html: 'HTML', htm: 'HTML', svg: 'SVG', xml: 'XML', md: 'Markdown', markdown: 'Markdown', sh: 'Shell', bash: 'Shell', zsh: 'Shell', toml: 'TOML', yaml: 'YAML', yml: 'YAML' };
  return named[ext] ?? 'Plain text';
}

/** Whether this computer is a Mac, where shortcuts are shown with ⌘; elsewhere they say Ctrl. */
export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** A shortcut as this computer writes it: `⌘P` on a Mac, `Ctrl+P` on Windows and Linux. */
export function keyLabel(key: string, mac = IS_MAC): string {
  return mac ? `⌘${key}` : `Ctrl+${key}`;
}
