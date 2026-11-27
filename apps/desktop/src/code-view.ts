/** Pure helpers for the Code app: what a file's language is, colouring a line, and lines changed between two texts. */

export type Lang = 'ts' | 'rust' | 'py' | 'go' | 'c' | 'json' | 'css' | 'html' | 'md' | 'sh' | 'plain';

export function langOf(path: string): Lang {
  const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase() ?? '';
  if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts'].includes(ext)) return 'ts';
  if (ext === 'rs') return 'rust';
  if (ext === 'py') return 'py';
  if (ext === 'go') return 'go';
  if (['c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'hh', 'java', 'cs', 'kt', 'kts', 'swift', 'dart', 'scala', 'php'].includes(ext)) return 'c';
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
  c: ['auto', 'break', 'case', 'catch', 'class', 'const', 'continue', 'default', 'delete', 'do', 'else', 'enum', 'extends', 'extern', 'false', 'final', 'finally', 'for', 'fun', 'func', 'goto', 'if', 'implements', 'import', 'include', 'define', 'inline', 'interface', 'internal', 'let', 'namespace', 'new', 'null', 'nullptr', 'override', 'package', 'private', 'protected', 'public', 'return', 'sizeof', 'static', 'struct', 'super', 'switch', 'template', 'this', 'throw', 'throws', 'true', 'try', 'typedef', 'typename', 'union', 'using', 'val', 'var', 'virtual', 'void', 'volatile', 'when', 'while', 'async', 'await', 'guard', 'self', 'nil', 'echo', 'function'],
  json: ['true', 'false', 'null'],
  css: [],
  html: [],
  md: [],
  sh: ['if', 'then', 'else', 'fi', 'for', 'do', 'done', 'case', 'esac', 'export', 'true', 'false'],
  plain: [],
};
const TYPES = new Set(['char', 'double', 'long', 'short', 'unsigned', 'signed', 'size_t', 'Int', 'Double', 'Bool', 'Integer', 'Object', 'List', 'Map', 'string', 'number', 'boolean', 'any', 'unknown', 'never', 'Array', 'Promise', 'Record', 'i32', 'i64', 'u8', 'u32', 'u64', 'usize', 'f64', 'bool', 'str', 'String', 'Vec', 'Option', 'Result', 'int', 'float', 'list', 'dict']);
const LINE_COMMENT: Record<Lang, string | null> = { ts: '//', rust: '//', go: '//', c: '//', py: '#', sh: '#', json: null, css: null, html: null, md: null, plain: null };

/**
 * What is still open at the end of a line and carries on into the next: a block comment (named by its closer),
 * or a string that spans lines (a template string's backquote, Go's raw string, Python's triple quotes). Null when
 * nothing is.
 */
export type Open = '*/' | '-->' | '`' | '"""' | "'''" | null;

const BLOCK_COMMENT: Partial<Record<Lang, [string, '*/' | '-->']>> = { ts: ['/*', '*/'], rust: ['/*', '*/'], go: ['/*', '*/'], c: ['/*', '*/'], css: ['/*', '*/'], html: ['<!--', '-->'] };
/** Strings that may run over several lines, by language. */
const LONG_STRINGS: Partial<Record<Lang, ('`' | '"""' | "'''")[]>> = { ts: ['`'], go: ['`'], py: ['"""', "'''"] };

/**
 * Colours one line, the way an editor would at a glance: keywords, types, called names, strings, numbers and
 * comments. `open` is what the line before left open, so a comment or string that runs over several lines is coloured
 * all the way through; the answer says what this line leaves open in turn.
 */
export function colourLine(line: string, lang: Lang, open: Open = null): { tokens: Token[]; open: Open } {
  if (lang === 'plain' || lang === 'md') return { tokens: [{ t: line, k: lang === 'md' && /^\s*#/.test(line) ? 'kw' : 'plain' }], open: null };
  const out: Token[] = [];
  const push = (t: string, k: TokenKind) => {
    if (t === '') return;
    const last = out[out.length - 1];
    if (last && last.k === k) last.t += t; else out.push({ t, k });
  };
  let i = 0;
  // Carried on from the line before: colour up to where it closes, or the whole line.
  if (open) {
    const kind: TokenKind = open === '*/' || open === '-->' ? 'com' : 'str';
    const end = open === '`' ? closingQuote(line, 0, '`') : line.indexOf(open);
    if (end < 0) { push(line, kind); return { tokens: out, open }; }
    const stop = open === '`' ? end + 1 : end + open.length;
    push(line.slice(0, stop), kind);
    i = stop;
  }
  const keywords = new Set(KEYWORDS[lang]);
  const comment = LINE_COMMENT[lang];
  const block = BLOCK_COMMENT[lang];
  const long = LONG_STRINGS[lang] ?? [];
  while (i < line.length) {
    const rest = line.slice(i);
    if (comment && rest.startsWith(comment)) { push(rest, 'com'); break; }
    if (block && rest.startsWith(block[0])) {
      const end = rest.indexOf(block[1], block[0].length);
      if (end < 0) { push(rest, 'com'); return { tokens: out, open: block[1] }; }
      const t = rest.slice(0, end + block[1].length);
      push(t, 'com'); i += t.length; continue;
    }
    const triple = long.find((q) => q.length === 3 && rest.startsWith(q));
    if (triple) {
      const end = rest.indexOf(triple, 3);
      if (end < 0) { push(rest, 'str'); return { tokens: out, open: triple }; }
      const t = rest.slice(0, end + 3);
      push(t, 'str'); i += t.length; continue;
    }
    const c = line[i]!;
    if (c === '"' || c === "'" || c === '`') {
      const j = c === '`' ? closingQuote(line, i + 1, '`') : closingQuote(line, i + 1, c);
      if (j < 0) {
        push(rest, 'str');
        return { tokens: out, open: c === '`' && long.includes('`') ? '`' : null };
      }
      const t = line.slice(i, j + 1);
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
  return { tokens: out, open: null };
}

/** Where the quote `q` closes on the line, from `from`, stepping over escapes; -1 when it does not. */
function closingQuote(line: string, from: number, q: string): number {
  for (let j = from; j < line.length; j += line[j] === '\\' ? 2 : 1) if (line[j] === q) return j;
  return -1;
}

/** One line coloured on its own, as if nothing were left open before it. */
export function highlight(line: string, lang: Lang): Token[] {
  return colourLine(line, lang, null).tokens;
}

/** Lines already coloured, by language, what was open before and their text, so typing recolours only what changed. */
const coloured = new Map<string, { tokens: Token[]; open: Open }>();
const COLOURED_MAX = 50_000;

/**
 * Every line of a text coloured, each knowing what the lines before it left open. Lines seen before come from a
 * store, so a key press in a long file only colours the line it changed (and any after it whose start changed).
 */
export function colourLines(lines: readonly string[], lang: Lang): Token[][] {
  if (coloured.size > COLOURED_MAX) coloured.clear();
  const out: Token[][] = [];
  let open: Open = null;
  for (const line of lines) {
    const key = `${lang}\u0001${open ?? ''}\u0001${line}`;
    let got = coloured.get(key);
    if (!got) { got = colourLine(line, lang, open); coloured.set(key, got); }
    out.push(got.tokens);
    open = got.open;
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

/**
 * The editor's change marks against the last commit, as VS Code draws them in the gutter: lines added, lines
 * changed, and a place where lines were deleted. Lines are from 0 in the new text; `removed` is what was there.
 */
export interface ChangeMark { kind: 'add' | 'change' | 'delete'; first: number; last: number; removed: string[]; /** Deleted lines that were after the last line. */ atEnd?: boolean }
export function changeMarks(rows: readonly DiffRow[]): ChangeMark[] {
  const marks: ChangeMark[] = [];
  for (const [s, e] of changeGroups(rows)) {
    const part = rows.slice(s, e + 1);
    const removed = part.filter((r) => r.kind === 'del').map((r) => r.text);
    const added = part.filter((r) => r.kind === 'add');
    if (added.length === 0) {
      // Deleted lines are marked on the line after them (or the last line, at the end of the file).
      const after = rows.slice(e + 1).find((r) => r.n !== null)?.n;
      const at = after ?? rows.filter((r) => r.n !== null).at(-1)?.n ?? 1;
      marks.push({ kind: 'delete', first: at - 1, last: at - 1, removed, ...(after === undefined ? { atEnd: true } : {}) });
    } else {
      marks.push({ kind: removed.length === 0 ? 'add' : 'change', first: added[0]!.n! - 1, last: added[added.length - 1]!.n! - 1, removed });
    }
  }
  return marks;
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

/** One entry in a file's Outline: a function, class, type or heading, and the line it starts on. */
export interface OutlineEntry { name: string; kind: string; line: number; depth: number }

const OUTLINE_RULES: Partial<Record<Lang, [RegExp, string][]>> = {
  ts: [
    [/^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\*?\s+([A-Za-z_$][\w$]*)/, 'function'],
    [/^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, 'class'],
    [/^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/, 'interface'],
    [/^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*(?:<[^=]*>)?\s*=/, 'type'],
    [/^\s*(?:export\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/, 'enum'],
    [/^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s+)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]+)?=>/, 'function'],
  ],
  py: [[/^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/, 'function'], [/^\s*class\s+([A-Za-z_]\w*)/, 'class']],
  rust: [
    [/^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+([A-Za-z_]\w*)/, 'function'],
    [/^\s*(?:pub(?:\([^)]*\))?\s+)?struct\s+([A-Za-z_]\w*)/, 'struct'],
    [/^\s*(?:pub(?:\([^)]*\))?\s+)?enum\s+([A-Za-z_]\w*)/, 'enum'],
    [/^\s*(?:pub(?:\([^)]*\))?\s+)?trait\s+([A-Za-z_]\w*)/, 'trait'],
    [/^\s*impl(?:<[^>]*>)?\s+([A-Za-z_][\w:<>, ]*?)\s*(?:\{|where|$)/, 'impl'],
  ],
  go: [[/^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/, 'function'], [/^type\s+([A-Za-z_]\w*)/, 'type']],
  sh: [[/^\s*(?:function\s+)?([A-Za-z_][\w-]*)\s*\(\)\s*\{?/, 'function']],
};

/** What a file holds, for the Outline panel: headings in Markdown, top-level and nested definitions elsewhere. */
export function codeOutline(text: string, lang: Lang, limit = 400): OutlineEntry[] {
  const out: OutlineEntry[] = [];
  const lines = text.split('\n');
  if (lang === 'md') {
    let fence = false;
    lines.forEach((l, i) => {
      if (/^\s*(```|~~~)/.test(l)) fence = !fence;
      const m = !fence && /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(l);
      if (m && out.length < limit) out.push({ name: m[2]!, kind: 'heading', line: i + 1, depth: m[1]!.length - 1 });
    });
    return out;
  }
  const rules = OUTLINE_RULES[lang];
  if (!rules) return out;
  for (let i = 0; i < lines.length && out.length < limit; i++) {
    const l = lines[i]!;
    if (/^\s*(\/\/|#(?!\[)|\*|\/\*)/.test(l) && lang !== 'sh') continue;
    if (lang === 'sh' && /^\s*#/.test(l)) continue;
    for (const [re, kind] of rules) {
      const m = re.exec(l);
      if (m) { out.push({ name: m[1]!.trim(), kind, line: i + 1, depth: Math.min(3, Math.floor((l.match(/^\s*/)![0].replace(/\t/g, '    ').length) / (lang === 'py' || lang === 'rust' ? 4 : 2))) }); break; }
    }
  }
  return out;
}
