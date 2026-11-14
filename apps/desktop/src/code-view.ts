/** Pure helpers for the Code app: what a file's language is, colouring a line, and lines changed between two texts. */

export type Lang = 'ts' | 'rust' | 'py' | 'go' | 'json' | 'css' | 'html' | 'md' | 'sh' | 'plain';

export function langOf(path: string): Lang {
  const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase() ?? '';
  if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts'].includes(ext)) return 'ts';
  if (ext === 'rs') return 'rust';
  if (ext === 'py') return 'py';
  if (ext === 'go') return 'go';
  if (['json', 'jsonc'].includes(ext)) return 'json';
  if (['css', 'scss'].includes(ext)) return 'css';
  if (['html', 'htm', 'svg', 'xml'].includes(ext)) return 'html';
  if (['md', 'markdown'].includes(ext)) return 'md';
  if (['sh', 'bash', 'zsh', 'toml', 'yaml', 'yml'].includes(ext)) return 'sh';
  return 'plain';
}

/** What a file is called in the editor's badge. */
export type TokenKind = 'kw' | 'type' | 'fn' | 'str' | 'num' | 'com' | 'plain';
export interface Token { t: string; k: TokenKind }

const KEYWORDS: Record<Lang, string[]> = {
  ts: ['import', 'export', 'from', 'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'of', 'in', 'new', 'class', 'extends', 'interface', 'type', 'async', 'await', 'default', 'throw', 'try', 'catch', 'finally', 'switch', 'case', 'break', 'continue', 'true', 'false', 'null', 'undefined', 'this', 'typeof', 'as', 'void'],
  rust: ['fn', 'let', 'mut', 'pub', 'use', 'mod', 'struct', 'enum', 'impl', 'trait', 'for', 'in', 'if', 'else', 'match', 'return', 'while', 'loop', 'break', 'continue', 'const', 'static', 'self', 'Self', 'crate', 'super', 'true', 'false', 'as', 'where', 'async', 'await', 'move', 'ref', 'dyn'],
  py: ['def', 'class', 'import', 'from', 'as', 'return', 'if', 'elif', 'else', 'for', 'while', 'in', 'not', 'and', 'or', 'is', 'None', 'True', 'False', 'with', 'try', 'except', 'finally', 'raise', 'lambda', 'yield', 'pass', 'break', 'continue', 'async', 'await', 'self'],
  go: ['package', 'import', 'func', 'return', 'if', 'else', 'for', 'range', 'var', 'const', 'type', 'struct', 'interface', 'map', 'chan', 'go', 'defer', 'switch', 'case', 'default', 'break', 'continue', 'nil', 'true', 'false'],
  json: ['true', 'false', 'null'],
  css: [],
  html: [],
  md: [],
  sh: ['if', 'then', 'else', 'fi', 'for', 'do', 'done', 'case', 'esac', 'export', 'true', 'false'],
  plain: [],
};
const TYPES = new Set(['string', 'number', 'boolean', 'any', 'unknown', 'never', 'Array', 'Promise', 'Record', 'i32', 'i64', 'u8', 'u32', 'u64', 'usize', 'f64', 'bool', 'str', 'String', 'Vec', 'Option', 'Result', 'int', 'float', 'list', 'dict']);
const LINE_COMMENT: Record<Lang, string | null> = { ts: '//', rust: '//', go: '//', py: '#', sh: '#', json: null, css: null, html: null, md: null, plain: null };

/**
 * Colours one line, the way an editor would at a glance: keywords, types, called names, strings, numbers and
 * comments. A comment or string that runs over several lines is coloured only on its first line; that is enough to
 * read by and keeps each line on its own.
 */
export function highlight(line: string, lang: Lang): Token[] {
  if (lang === 'plain' || lang === 'md') return [{ t: line, k: lang === 'md' && /^\s*#/.test(line) ? 'kw' : 'plain' }];
  const out: Token[] = [];
  const push = (t: string, k: TokenKind) => {
    const last = out[out.length - 1];
    if (last && last.k === k) last.t += t; else out.push({ t, k });
  };
  const keywords = new Set(KEYWORDS[lang]);
  const comment = LINE_COMMENT[lang];
  let i = 0;
  while (i < line.length) {
    const rest = line.slice(i);
    if (comment && rest.startsWith(comment)) { push(rest, 'com'); break; }
    if ((lang === 'ts' || lang === 'rust' || lang === 'go' || lang === 'css') && rest.startsWith('/*')) {
      const end = rest.indexOf('*/', 2);
      const t = end < 0 ? rest : rest.slice(0, end + 2);
      push(t, 'com'); i += t.length; continue;
    }
    if (lang === 'html' && rest.startsWith('<!--')) { const end = rest.indexOf('-->'); const t = end < 0 ? rest : rest.slice(0, end + 3); push(t, 'com'); i += t.length; continue; }
    const c = line[i]!;
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < line.length && line[j] !== c) j += line[j] === '\\' ? 2 : 1;
      const t = line.slice(i, Math.min(j + 1, line.length));
      push(t, 'str'); i += t.length; continue;
    }
    const num = /^(?:0x[0-9a-f_]+|\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?)/i.exec(rest);
    if (num && !/[\w$]/.test(line[i - 1] ?? '')) { push(num[0], 'num'); i += num[0].length; continue; }
    const word = /^[A-Za-z_$][\w$]*/.exec(rest);
    if (word) {
      const w = word[0];
      const after = line.slice(i + w.length);
      const k: TokenKind = lang === 'json' ? (keywords.has(w) ? 'kw' : 'plain') : keywords.has(w) ? 'kw' : TYPES.has(w) || /^[A-Z]/.test(w) ? 'type' : /^\s*\(/.test(after) || (lang === 'rust' && /^!\(/.test(after)) ? 'fn' : 'plain';
      push(w, k); i += w.length; continue;
    }
    push(c, 'plain'); i += 1;
  }
  return out;
}

export interface DiffRow { kind: 'same' | 'del' | 'add'; text: string; /** The line number in the new text; deleted lines have none. */ n: number | null }

/**
 * The lines of `after` against `before`, deleted lines shown above the ones that replace them. A plain longest common
 * subsequence, after setting aside the lines both share at the start and the end; a very large change is shown as all
 * of one replaced by all of the other rather than worked out slowly.
 */
export function lineDiff(before: string, after: string): DiffRow[] {
  const a = before.replace(/\r\n?/g, '\n').split('\n');
  const b = after.replace(/\r\n?/g, '\n').split('\n');
  if (a[a.length - 1] === '' && b[b.length - 1] === '') { a.pop(); b.pop(); }
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length, endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const midA = a.slice(start, endA), midB = b.slice(start, endB);
  const rows: DiffRow[] = [];
  let n = 0;
  const same = (t: string) => rows.push({ kind: 'same', text: t, n: ++n });
  const add = (t: string) => rows.push({ kind: 'add', text: t, n: ++n });
  const del = (t: string) => rows.push({ kind: 'del', text: t, n: null });
  a.slice(0, start).forEach(same);
  if (midA.length * midB.length > 4_000_000) {
    midA.forEach(del); midB.forEach(add);
  } else {
    const w = midB.length + 1;
    const lcs = new Uint32Array((midA.length + 1) * w);
    for (let i = midA.length - 1; i >= 0; i--) for (let j = midB.length - 1; j >= 0; j--) lcs[i * w + j] = midA[i] === midB[j] ? lcs[(i + 1) * w + j + 1]! + 1 : Math.max(lcs[(i + 1) * w + j]!, lcs[i * w + j + 1]!);
    let i = 0, j = 0;
    while (i < midA.length || j < midB.length) {
      if (i < midA.length && j < midB.length && midA[i] === midB[j]) { same(midA[i]!); i++; j++; }
      else if (j >= midB.length || (i < midA.length && lcs[(i + 1) * w + j]! >= lcs[i * w + j + 1]!)) { del(midA[i]!); i++; }
      else { add(midB[j]!); j++; }
    }
  }
  a.slice(endA).forEach(same);
  return rows;
}

/** The groups of changed rows, as [first, last] indexes into the rows, for Keep and Discard beside each. */
export function changeGroups(rows: readonly DiffRow[]): [number, number][] {
  const out: [number, number][] = [];
  rows.forEach((r, i) => {
    if (r.kind === 'same') return;
    const last = out[out.length - 1];
    if (last && last[1] === i - 1) last[1] = i; else out.push([i, i]);
  });
  return out;
}

/** `before` with only the changes in the groups kept applied; the others are put back. */
export function applyGroups(rows: readonly DiffRow[], keep: ReadonlySet<number>, endsWithNewline: boolean): string {
  const groups = changeGroups(rows);
  const lines: string[] = [];
  rows.forEach((r, i) => {
    if (r.kind === 'same') { lines.push(r.text); return; }
    const g = groups.findIndex(([s, e]) => i >= s && i <= e);
    const kept = keep.has(g);
    if ((r.kind === 'add' && kept) || (r.kind === 'del' && !kept)) lines.push(r.text);
  });
  return lines.join('\n') + (endsWithNewline && lines.length > 0 ? '\n' : '');
}

/** How a line of test output reads: passed, failed or just output. */
export function testLineKind(line: string): 'pass' | 'fail' | 'plain' {
  if (/^\s*(✕|✗|×|✘|FAIL\b|not ok\b)|\.\.\. FAILED$|\b(Error|AssertionError|panicked)\b|\b[1-9]\d* fail(ed|ing)?\b/.test(line)) return 'fail';
  if (/^\s*(✓|✔|√|ok\b|PASS\b)|\.\.\. ok$|\b\d+ pass(ed|ing)?\b/.test(line)) return 'pass';
  return 'plain';
}

/** The folders shown open in the tree, from the open file's place: its folders open, others as the person left them. */
export function parentsOf(path: string): string[] {
  const parts = path.split('/');
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'));
}

/** What git says about a changed file, as Xcode's source control marks it: one letter and its meaning. */
export interface GitMark { letter: 'M' | 'A' | 'D' | 'R' | '?' | 'C'; label: string }

/** One of `git status --porcelain` lines' two status letters (trimmed) as a mark: `??` is a file git does not track yet. */
export function gitMark(status: string): GitMark {
  const s = status.trim();
  if (s === '??') return { letter: '?', label: 'Not tracked by git yet' };
  if (/U|AA|DD/.test(s)) return { letter: 'C', label: 'In conflict' };
  const first = s.replace(/\s/g, '')[0] ?? 'M';
  if (first === 'A') return { letter: 'A', label: 'Added' };
  if (first === 'D') return { letter: 'D', label: 'Deleted' };
  if (first === 'R' || first === 'C') return { letter: 'R', label: 'Renamed' };
  return { letter: 'M', label: 'Modified' };
}

/** The changed files by path, a rename under its new name, so the tree can mark each one. */
export function gitMarks(changes: readonly { status: string; path: string }[]): Map<string, GitMark> {
  const marks = new Map<string, GitMark>();
  for (const c of changes) {
    const path = c.path.includes(' -> ') ? c.path.slice(c.path.lastIndexOf(' -> ') + 4) : c.path;
    marks.set(path.replace(/^"|"$/g, ''), gitMark(c.status));
  }
  return marks;
}

/**
 * Code's Glance after a failed test run: the first line that says what failed, the command, and how long it took.
 * Nothing when the last run passed or there was none.
 */
export function testsGlance(last: { passed: boolean; output: string; seconds: number; timedOut: boolean } | null, command: string | null): { label: string; value: string }[] | null {
  if (!last || last.passed) return null;
  const lines = last.output.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  // node --test names the failing test: "not ok 2 - pack temperature" (TAP) or "✖ pack temperature (2.1ms)" (spec).
  const named = lines.map((l) => /^not ok \d+ - (.+?)(?:\s+#.*)?$/.exec(l)?.[1] ?? /^✖\s+(.+?)\s+\([\d.]+m?s\)$/.exec(l)?.[1]).find(Boolean);
  const said = last.timedOut ? 'Took too long' : named ? `${named} fails` : lines.find((l) => /\b(fail(ed|ure)?|error|assert|expected|panicked)\b/i.test(l)) ?? lines.at(-1) ?? 'It failed';
  return [
    { label: 'Failed', value: said.length > 60 ? `${said.slice(0, 59)}…` : said },
    { label: 'Command', value: command ?? '' },
    { label: 'Took', value: `${Math.round(last.seconds * 10) / 10} s` },
  ];
}
