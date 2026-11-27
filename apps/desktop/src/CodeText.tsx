import { type MutableRefObject, type MouseEvent as ReactMouseEvent, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { IS_MAC, fileScore, findAll, findPattern, indentLines, langName, newLine, replacement, toggleComment, typePair, type FindOptions } from './code-edit';
import { changeMarks, codeOutline, colourLines, lineDiff, type ChangeMark, type Lang } from './code-view';
import {
  History, addCursorV, addNextMatch, applyChanges, foldRegions, foldsHiding, mapPos, matchBracket, replaceSpans, stickyScopes, visibleRows, colAt, copyLines, cursor, deleteBy, deleteLines, docOf, editEach, end, home, insertText, lineEnd, lineOf, lineStarts,
  moveH, moveLines, moveV, normalize, selFrom, selTo, selectAll, selectLine, single, visualCol, wordAt, type DocState, type Step,
} from './code-doc';
import type { CodeCompletion, CodeProblem } from '@mobius/shared';
import { fitting, offsetOf, spansOf, type LanguageState } from './code-lsp';
import type { CodeState, TestResult } from './useCode';
import { testsIn, type TestMark } from './code-run';

const LINE = 20;
const PAD_TOP = 8;
const PAD_LEFT = 8;
const PAD_BOTTOM = 40;
/** Lines drawn past each edge of the view, so a quick scroll never shows a gap. */
const OVERSCAN = 30;
const TAB = 2;
const NO_PROBLEMS: CodeProblem[] = [];
/** How long the pointer rests on a word before what the language server says about it shows. */
const HOVER_DELAY = 450;
const COMPLETE_DELAY = 120;
const wordStartBefore = (t: string, at: number): number => { let a = at; while (a > 0 && /[\p{L}\p{N}_$]/u.test(t[a - 1]!)) a -= 1; return a; };
const KIND_MARK: Record<string, string> = { method: 'm', function: 'f', constructor: 'c', field: 'p', variable: 'v', class: 'C', interface: 'I', module: 'M', property: 'p', enum: 'E', keyword: 'k', snippet: 's', constant: 'K', struct: 'S', type: 'T', file: 'F', folder: 'F' };

/** Hover text from a language server: its code blocks coloured as code, the rest as written. */
function HoverText({ text, lang }: { text: string; lang: Lang }) {
  const parts: React.ReactNode[] = [];
  const re = /```[^\n]*\n([\s\S]*?)```/g;
  let at = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const before = text.slice(at, m.index).trim();
    if (before) parts.push(<p key={`t${at}`}>{before}</p>);
    const lines = m[1]!.replace(/\n$/, '').split('\n');
    const toks = colourLines(lines, lang);
    parts.push(<pre key={`c${m.index}`} className="ed-hover-code">{lines.map((_, i) => <div key={i}>{(toks[i] ?? []).map((t, k) => <span key={k} className={`tok-${t.k}`}>{t.t}</span>)}</div>)}</pre>);
    at = m.index + m[0].length;
  }
  const rest = text.slice(at).trim();
  if (rest) parts.push(<p key="rest">{rest}</p>);
  return <>{parts}</>;
}

export type BarMode = 'find' | 'replace' | 'line';

interface FindProps {
  mode: BarMode;
  text: string;
  onClose: () => void;
  onFind: (query: string, opts: FindOptions, at: number) => void;
  onLine: (line: number) => void;
  onReplace: (query: string, opts: FindOptions, withText: string, at: number) => void;
  onReplaceAll: (query: string, opts: FindOptions, withText: string) => void;
  onSelectAll: (query: string, opts: FindOptions) => void;
}

const Glyph = ({ d }: { d: string }) => <svg viewBox="0 0 20 20" aria-hidden="true"><path d={d} /></svg>;

/**
 * Find (Ctrl+F), find and replace (Ctrl+H) or go to a line (Ctrl+G), in a bar above the text, as VS Code's: match
 * case, whole word and regular expression toggles; Enter steps through the matches, Alt+Enter selects them all as
 * cursors; Replace changes the current match and steps on, Replace all changes them all as one undo step.
 */
export function EditorBar({ mode, text, onClose, onFind, onLine, onReplace, onReplaceAll, onSelectAll }: FindProps) {
  const [query, setQuery] = useState('');
  const [withText, setWithText] = useState('');
  const [replacing, setReplacing] = useState(mode === 'replace');
  const [opts, setOpts] = useState<FindOptions>({ matchCase: false, word: false, regex: false });
  const [at, setAt] = useState(0);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => { field.current?.focus(); field.current?.select(); }, [mode]);
  const finding = mode !== 'line';
  const count = useMemo(() => (finding ? findAll(text, query, opts).length : 0), [finding, text, query, opts]);
  const bad = finding && opts.regex && query !== '' && findPattern(query, opts) === null;
  useEffect(() => { if (finding) onFind(query, opts, count === 0 ? 0 : Math.min(at, count - 1)); }, [query, opts, at, count, finding]); // eslint-disable-line react-hooks/exhaustive-deps
  const lines = useMemo(() => lineStarts(text).length, [text]);
  if (mode === 'line') {
    return (
      <form className="code-bar" role="search" aria-label="Go to line" onSubmit={(e) => { e.preventDefault(); const n = Number.parseInt(query, 10); if (n > 0) onLine(Math.min(n, lines)); }}>
        <input ref={field} aria-label="Line number" inputMode="numeric" placeholder={`Line, 1 to ${lines}`} value={query} onChange={(e) => setQuery(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } }} />
        <button type="submit" className="btn" title="Go (Enter)">Go</button>
        <button type="button" className="strip-btn" aria-label="Close" title="Close (Esc)" onClick={onClose}><Glyph d="m6 6 8 8M14 6l-8 8" /></button>
      </form>
    );
  }
  const step = (by: number) => { if (count > 0) setAt((i) => (i + by + count) % count); };
  const toggle = (key: keyof FindOptions) => { setOpts((o) => ({ ...o, [key]: !o[key] })); setAt(0); };
  const current = count === 0 ? 0 : Math.min(at, count - 1);
  const keys = (e: React.KeyboardEvent<HTMLInputElement>, replace: boolean) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (e.key === 'Enter' && e.altKey && !replace) { e.preventDefault(); if (count > 0) onSelectAll(query, opts); return; }
    if (e.key === 'Enter' && replace && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (count > 0) onReplaceAll(query, opts, withText); return; }
    if (e.key === 'Enter' && replace) { e.preventDefault(); if (count > 0) onReplace(query, opts, withText, current); return; }
    if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1); }
  };
  return (
    <div className="code-bar code-find" role="search" aria-label="Find in file" data-replacing={replacing || undefined}>
      <button type="button" className="strip-btn code-find-more" aria-expanded={replacing} aria-label={replacing ? 'Hide replace' : 'Show replace'} title={replacing ? 'Hide replace' : 'Replace (Ctrl+H)'} onClick={() => setReplacing((r) => !r)}><Glyph d={replacing ? 'm6 8 4 4 4-4' : 'm8 6 4 4-4 4'} /></button>
      <div className="code-find-rows">
        <div className="code-find-row">
          <input ref={field} aria-label="Find in file" aria-invalid={bad || undefined} placeholder="Find" value={query} spellCheck={false} onChange={(e) => { setQuery(e.target.value); setAt(0); }} onKeyDown={(e) => keys(e, false)} />
          <button type="button" className="code-bar-case" aria-pressed={!!opts.matchCase} aria-label="Match case" title="Match case" onClick={() => toggle('matchCase')}>Aa</button>
          <button type="button" className="code-bar-case" aria-pressed={!!opts.word} aria-label="Whole word" title="Whole word" onClick={() => toggle('word')}><u>ab</u></button>
          <button type="button" className="code-bar-case" aria-pressed={!!opts.regex} aria-label="Regular expression" title="Regular expression" onClick={() => toggle('regex')}>.*</button>
          <span className="code-bar-count" aria-live="polite">{bad ? 'Not a pattern' : query ? (count === 0 ? 'No matches' : `${current + 1} of ${count}`) : ''}</span>
          <button type="button" className="strip-btn" aria-label="Previous match" title="Previous match (Shift+Enter)" disabled={count === 0} onClick={() => step(-1)}><Glyph d="m5 12 5-5 5 5" /></button>
          <button type="button" className="strip-btn" aria-label="Next match" title="Next match (Enter)" disabled={count === 0} onClick={() => step(1)}><Glyph d="m5 8 5 5 5-5" /></button>
          <button type="button" className="strip-btn" aria-label="Select all matches" title="Select all matches (Alt+Enter)" disabled={count === 0} onClick={() => onSelectAll(query, opts)}><Glyph d="M4 6h12M4 10h12M4 14h12" /></button>
          <button type="button" className="strip-btn" aria-label="Close find" title="Close (Esc)" onClick={onClose}><Glyph d="m6 6 8 8M14 6l-8 8" /></button>
        </div>
        {replacing && (
          <div className="code-find-row">
            <input aria-label="Replace with" placeholder="Replace" value={withText} spellCheck={false} onChange={(e) => setWithText(e.target.value)} onKeyDown={(e) => keys(e, true)} autoFocus={mode === 'replace' && query !== ''} />
            <button type="button" className="btn" title="Replace (Enter)" disabled={count === 0} onClick={() => onReplace(query, opts, withText, current)}>Replace</button>
            <button type="button" className="btn" title={`Replace all (${IS_MAC ? '⌘⏎' : 'Ctrl+Enter'})`} disabled={count === 0} onClick={() => onReplaceAll(query, opts, withText)}>Replace all</button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Go to a symbol in the file (Ctrl+Shift+O): what the file defines, narrowed as you type; Enter goes to it. */
function SymbolPicker({ text, lang, onGo, onClose }: { text: string; lang: Lang; onGo: (line: number) => void; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [lit, setLit] = useState(0);
  const all = useMemo(() => codeOutline(text, lang), [text, lang]);
  const found = useMemo(() => (query ? all.map((e) => ({ e, score: fileScore(query, e.name) })).filter((r): r is { e: typeof all[number]; score: number } => r.score !== null).sort((a, b) => b.score - a.score).map((r) => r.e) : all).slice(0, 200), [all, query]);
  const choose = (i: number) => { const e = found[i]; if (e) onGo(e.line); onClose(); };
  return (
    <div className="code-quick-wrap" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="code-quick" role="dialog" aria-label="Go to a symbol">
        <input
          autoFocus
          aria-label="Symbol to go to"
          placeholder="Go to a function, class or heading"
          value={query}
          spellCheck={false}
          role="combobox"
          aria-expanded
          aria-controls="code-symbol-list"
          aria-activedescendant={found[lit] ? `code-symbol-${lit}` : undefined}
          onChange={(e) => { setQuery(e.target.value); setLit(0); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setLit((i) => Math.min(found.length - 1, i + 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setLit((i) => Math.max(0, i - 1)); }
            else if (e.key === 'Enter') { e.preventDefault(); choose(lit); }
            else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
          }}
        />
        <ul id="code-symbol-list" role="listbox" aria-label="Symbols">
          {found.map((e, i) => (
            <li key={`${e.line}-${e.name}`} id={`code-symbol-${i}`} role="option" aria-selected={i === lit} onMouseEnter={() => setLit(i)} onMouseDown={(ev) => ev.preventDefault()} onClick={() => choose(i)} style={{ paddingLeft: `calc(var(--sp-3) + ${e.depth * 12}px)` }}>
              <span className="code-quick-name">{e.name}</span>
              <span className="code-quick-where">{e.kind} · line {e.line}</span>
            </li>
          ))}
          {found.length === 0 && <li className="code-quick-none" role="presentation">{all.length === 0 ? 'This file defines nothing Mobius can list.' : `Nothing matches “${query}”.`}</li>}
        </ul>
      </div>
    </div>
  );
}

/** The span where two texts differ, for input the editor did not make itself (a word chosen in an input method, a fill). */
function diffSpan(before: string, after: string): { from: number; to: number; insert: string } | null {
  if (before === after) return null;
  let a = 0;
  while (a < before.length && a < after.length && before[a] === after[a]) a += 1;
  let b = 0;
  while (b < before.length - a && b < after.length - a && before[before.length - 1 - b] === after[after.length - 1 - b]) b += 1;
  return { from: a, to: before.length - b, insert: after.slice(a, after.length - b) };
}

/**
 * The Code editor: it draws its own text, cursors and selections, so it can have many cursors at once and stays quick
 * in long files (only the lines in view are drawn). Keys go to a hidden text field that holds the whole text, so
 * input methods, screen readers and the clipboard work as in any text field; every change is made by the editor
 * itself, at every cursor, and kept for its own undo. Keys follow VS Code: Ctrl+D adds the next match, Alt+click
 * and Ctrl+Alt+Up or Down add cursors, Alt+Up or Down move lines, Shift+Alt+Up or Down copy them, Ctrl+Shift+K
 * deletes them, Ctrl+L selects a line, Esc goes back to one cursor.
 */
export function CodeText({ code, lang, bar, setBar, jump, lsp, onShowProblems, base, runner }: { /** Run buttons beside the file's tests. */ runner?: { results: ReadonlyMap<string, TestResult>; running: boolean; keyOf: (mark: TestMark) => string; run: (mark: TestMark) => void; label: (mark: TestMark) => string }; code: CodeState; lang: Lang; bar: BarMode | null; setBar: (bar: BarMode | null) => void; /** Set to Go to line, for the Outline panel. */ jump?: MutableRefObject<((line: number) => void) | null>; /** Language smarts, when the project has them. */ lsp?: LanguageState; onShowProblems?: () => void; /** The file as the last commit has it, for the change marks; undefined when there is none. */ base?: string }) {
  const path = code.open?.path ?? '';
  const doc = useRef<DocState>(docOf(code.draft));
  const history = useRef(new History());
  const goals = useRef<number[] | null>(null);
  const shownPath = useRef(path);
  const folds = useRef<Set<number>>(new Set());
  const [, setVersion] = useState(0);
  const redraw = () => setVersion((v) => v + 1);
  // Another file, or the text changed outside the editor (Revert, a change kept from Mobius): start from it.
  if (shownPath.current !== path) {
    shownPath.current = path;
    doc.current = docOf(code.draft);
    history.current.clear();
    folds.current = new Set();
  } else if (doc.current.text !== code.draft) {
    // Changed outside the editor (Revert, a change kept from Mobius, a reload): kept as a step of its own, so undo
    // stays exact and can take it back too, with the cursors moved along with it.
    const was = doc.current;
    const span = diffSpan(was.text, code.draft);
    if (span) {
      const changes = [span];
      const n = normalize(was.sels.map((s) => ({ anchor: mapPos(s.anchor, changes), head: mapPos(s.head, changes) })), was.primary);
      const step = { state: { text: code.draft, sels: n.sels, primary: n.primary }, changes };
      history.current.seal();
      history.current.record(was, step, 'outside');
      history.current.seal();
      if (folds.current.size > 0) folds.current = new Set([...folds.current].map((p) => mapPos(p, changes, false)));
      doc.current = step.state;
    }
  }
  const state = doc.current;
  const text = state.text;

  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const measure = useRef<HTMLSpanElement>(null);
  const composing = useRef(false);
  const [view, setView] = useState({ top: 0, left: 0, height: 600, width: 800 });
  const [cw, setCw] = useState(8);
  const [focused, setFocused] = useState(false);
  const [found, setFound] = useState<{ marks: [number, number][]; at: number }>({ marks: [], at: 0 });
  useEffect(() => { setFound({ marks: [], at: 0 }); }, [path]);
  // Language smarts: completions, what the pointer rests on, a rename being typed, and a passing note.
  const [complete, setComplete] = useState<{ items: CodeCompletion[]; line: number; min: number; index: number } | null>(null);
  const [hover, setHover] = useState<{ at: number; text: string; problems: CodeProblem[] } | null>(null);
  const [rename, setRename] = useState<{ from: number; to: number } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const hoverTimer = useRef<number | undefined>(undefined);
  const completeTimer = useRef<number | undefined>(undefined);
  const completeAsk = useRef(0);
  useEffect(() => { setComplete(null); setHover(null); setRename(null); setNote(null); }, [path]);
  useEffect(() => () => { window.clearTimeout(hoverTimer.current); window.clearTimeout(completeTimer.current); }, []);
  const fileProblems = lsp?.problems.get(path) ?? NO_PROBLEMS;
  // Change marks against the last commit, worked out a moment behind the typing; one open shows what was there.
  const [peek, setPeek] = useState<number | null>(null);
  useEffect(() => { setPeek(null); }, [path]);
  const smart = lsp?.status.kind === 'server';

  const lines = useMemo(() => text.split('\n'), [text]);
  const settled = useDeferredValue(text);
  const changes = useMemo<ChangeMark[]>(() => (base === undefined || settled.length > 2_000_000 ? [] : changeMarks(lineDiff(base, settled))), [base, settled]);
  const starts = useMemo(() => lineStarts(text), [text]);
  // Folding: closed regions kept as the places their first lines start, so they move with changes above them.
  const [foldsVersion, setFoldsVersion] = useState(0);
  const [symbols, setSymbols] = useState(false);
  const regions = useMemo(() => foldRegions(lines, TAB), [lines]);
  const testMarks = useMemo(() => (runner ? new Map(testsIn(text, lang, path).map((m) => [m.line, m])) : new Map<number, TestMark>()), [runner !== undefined, text, lang, path]); // eslint-disable-line react-hooks/exhaustive-deps
  const foldedLines = useMemo(() => {
    const out = new Set<number>();
    for (const p of folds.current) {
      if (p > text.length) continue;
      const l = lineOf(starts, p);
      if (starts[l] === p && regions.has(l)) out.add(l);
    }
    return out;
  }, [starts, regions, foldsVersion, text.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const { rows, rowOf } = useMemo(() => visibleRows(lines.length, regions, foldedLines), [lines.length, regions, foldedLines]);
  const geo = useRef({ rows, rowOf, regions, foldedLines, starts });
  geo.current = { rows, rowOf, regions, foldedLines, starts };
  const yOf = (line: number) => PAD_TOP + Math.max(0, rowOf[line] ?? line) * LINE;
  const shown = (line: number) => (rowOf[line] ?? -1) >= 0;
  const setFolds = (next: Set<number>) => { folds.current = next; setFoldsVersion((v) => v + 1); };
  /** Opens the folds that hide `line`, so a cursor sent there is seen. */
  const openAround = (line: number) => {
    const g = geo.current;
    const hiding = foldsHiding(line, g.regions, g.foldedLines);
    if (hiding.length === 0) return;
    const next = new Set(folds.current);
    for (const l of hiding) next.delete(g.starts[l]!);
    setFolds(next);
  };
  /** Ctrl+Shift+[ closes the innermost open region around a line, Ctrl+Shift+] opens the innermost closed one. */
  const foldAt = (line: number, close: boolean) => {
    const g = geo.current;
    const around = [...g.regions].filter(([a, b]) => a <= line && line <= b).sort((x, y) => y[0] - x[0]);
    const pick = close ? around.find(([a]) => !g.foldedLines.has(a)) : around.find(([a]) => g.foldedLines.has(a));
    if (!pick) return;
    const next = new Set(folds.current);
    if (close) next.add(g.starts[pick[0]]!); else next.delete(g.starts[pick[0]]!);
    setFolds(next);
    // A cursor inside a region just closed goes to the end of its first line, as in VS Code.
    if (close) {
      const st = g.starts;
      const moved = doc.current.sels.map((s) => {
        const l = lineOf(st, s.head);
        return l > pick[0] && l <= pick[1] ? cursor(lineEnd(doc.current.text, st, pick[0])) : s;
      });
      const n = normalize(moved, doc.current.primary);
      doc.current = { ...doc.current, sels: n.sels, primary: n.primary };
      redraw();
    }
  };
  const stepLine = (line: number, by: number): number => {
    const g = geo.current;
    let l = line;
    while (l > 0 && (g.rowOf[l] ?? 0) < 0) l -= 1;
    const t = (g.rowOf[l] ?? 0) + by;
    if (t < 0) return -1;
    if (t >= g.rows.length) return g.rowOf.length;
    return g.rows[t]!;
  };
  const widest = useMemo(() => lines.reduce((m, l) => Math.max(m, l.includes('\t') ? visualCol(l, l.length, TAB) : l.length), 0), [lines]);

  // The width of one character, measured in the editor's own font, and the size of the view.
  useLayoutEffect(() => {
    const el = scroller.current;
    const m = measure.current;
    if (!el || !m) return;
    const size = () => {
      const w = m.getBoundingClientRect().width / 20;
      if (w > 0) setCw(w);
      setView((v) => ({ ...v, height: el.clientHeight, width: el.clientWidth }));
    };
    size();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(size);
    ro.observe(el);
    ro.observe(m);
    return () => ro.disconnect();
  }, []);

  const firstRow = Math.max(0, Math.floor((view.top - PAD_TOP) / LINE) - OVERSCAN);
  const lastRow = Math.max(0, Math.min(rows.length - 1, Math.ceil((view.top + view.height) / LINE) + OVERSCAN));
  const first = rows[firstRow] ?? 0;
  const last = rows[lastRow] ?? 0;
  const tokens = useMemo(() => colourLines(lines.slice(0, last + 1), lang), [lines, last, lang]);

  const primary = state.sels[state.primary] ?? state.sels[0]!;
  const caretLine = lineOf(starts, primary.head);
  const caretCol = primary.head - starts[caretLine]!;
  const xOf = (line: number, col: number) => PAD_LEFT + visualCol(lines[line] ?? '', col, TAB) * cw;
  // The completions that fit what is typed since the list was asked for; none once the cursor leaves that word.
  const choices: CodeCompletion[] = complete && state.sels.length === 1 && primary.anchor === primary.head && caretLine === complete.line && primary.head >= complete.min
    ? fitting(complete.items, text.slice(wordStartBefore(text, primary.head), primary.head)).slice(0, 60)
    : [];

  // The hidden field holds the whole text with the primary selection, for input methods and screen readers.
  useLayoutEffect(() => {
    const el = input.current;
    if (!el || composing.current) return;
    if (el.value !== text) el.value = text;
    const s = primary;
    if (el.selectionStart !== selFrom(s) || el.selectionEnd !== selTo(s)) el.setSelectionRange(selFrom(s), selTo(s), s.head < s.anchor ? 'backward' : 'forward');
  });

  /** Scrolls so the primary cursor is in view, with a little room around it; `middle` puts its line a third of the way down. */
  const reveal = (middle = false) => {
    const el = scroller.current;
    if (!el) return;
    const s = doc.current.sels[doc.current.primary]!;
    const st = lineStarts(doc.current.text);
    const line = lineOf(st, s.head);
    const top = PAD_TOP + Math.max(0, geo.current.rowOf[line] ?? line) * LINE;
    if (middle) { if (top < el.scrollTop + LINE || top > el.scrollTop + el.clientHeight - 3 * LINE) el.scrollTop = Math.max(0, top - el.clientHeight / 3); }
    else if (top < el.scrollTop) el.scrollTop = top - PAD_TOP;
    else if (top + LINE > el.scrollTop + el.clientHeight) el.scrollTop = top + LINE - el.clientHeight + PAD_TOP;
    const lineText = doc.current.text.slice(st[line], lineEnd(doc.current.text, st, line));
    const x = PAD_LEFT + visualCol(lineText, s.head - st[line]!, TAB) * cw;
    if (x < el.scrollLeft + PAD_LEFT) el.scrollLeft = Math.max(0, x - 4 * cw);
    else if (x > el.scrollLeft + el.clientWidth - 4 * cw) el.scrollLeft = x - el.clientWidth + 4 * cw;
  };

  /** Makes a change: kept for undo, written to the file's draft, the cursor kept in view. */
  const apply = (step: Step | null, kind: string) => {
    if (!step || step.changes.length === 0) return;
    history.current.record(doc.current, step, kind);
    if (folds.current.size > 0) folds.current = new Set([...folds.current].map((p) => mapPos(p, step.changes, false)));
    doc.current = step.state;
    openAround(lineOf(lineStarts(step.state.text), step.state.sels[step.state.primary]!.head));
    goals.current = null;
    code.setDraft(step.state.text);
    redraw();
    requestAnimationFrame(() => reveal());
  };
  /** Moves the cursors (no change to the text). */
  const place = (next: DocState, keepGoals = false) => {
    history.current.seal();
    if (!keepGoals) goals.current = null;
    doc.current = next;
    openAround(lineOf(geo.current.starts, next.sels[next.primary]!.head));
    redraw();
    requestAnimationFrame(() => reveal());
  };
  const putBack = (next: DocState | null) => {
    if (!next) return;
    doc.current = next;
    goals.current = null;
    code.setDraft(next.text);
    redraw();
    requestAnimationFrame(() => reveal());
  };

  const typed = (ch: string) => {
    const s = doc.current;
    setHover(null);
    if (smart && ch.length === 1) {
      // A dot starts a new list: the one for the word before it goes at once, so it never shows for a moment.
      if (ch === '.') { completeAsk.current += 1; setComplete(null); laterComplete('.'); }
      else if (/[\p{L}_$]/u.test(ch) && !complete) laterComplete();
      else if (!/[\p{L}\p{N}_$]/u.test(ch)) { completeAsk.current += 1; setComplete(null); }
    }
    if (ch.length === 1) apply(editEach(s, (sel, t) => typePair(t, selFrom(sel), selTo(sel), ch) ?? { from: selFrom(sel), to: selTo(sel), insert: ch, select: [selFrom(sel) + 1, selFrom(sel) + 1] }), 'type');
    else apply(insertText(s, ch), 'type');
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (composing.current || e.nativeEvent.isComposing) return;
    const mod = IS_MAC ? e.metaKey : e.ctrlKey;
    const wordMod = IS_MAC ? e.altKey : e.ctrlKey;
    const key = e.key;
    const lower = key.toLowerCase();
    const s = doc.current;
    const handled = () => { e.preventDefault(); e.stopPropagation(); };
    if (note) setNote(null);
    if (hover && key !== 'Shift' && key !== 'Control' && key !== 'Alt' && key !== 'Meta') setHover(null);
    // The completion list, while it shows, takes the arrows, Enter, Tab and Esc.
    if (choices.length > 0 && complete) {
      if (key === 'ArrowDown' || key === 'ArrowUp') { handled(); setComplete({ ...complete, index: (Math.min(complete.index, choices.length - 1) + (key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length }); return; }
      if ((key === 'Enter' || key === 'Tab') && !mod && !e.shiftKey && !e.altKey) { handled(); acceptCompletion(choices[Math.min(complete.index, choices.length - 1)]!); return; }
      if (key === 'Escape') { handled(); completeAsk.current += 1; setComplete(null); return; }
      if (key.length > 1 && key !== 'Backspace' && key !== 'Shift') { completeAsk.current += 1; setComplete(null); }
    }
    if (e.ctrlKey && !e.altKey && !e.shiftKey && (key === ' ' || e.code === 'Space')) { handled(); void askComplete(); return; }
    if (key === 'F12' && !mod && !e.altKey && !e.shiftKey) { handled(); void goDefinition(primary.head); return; }
    if (key === 'F2' && !mod && !e.altKey && !e.shiftKey) { handled(); startRename(); return; }
    if (key === 'F5' && e.altKey && !mod) { handled(); nextChange(e.shiftKey ? -1 : 1); return; }
    if (peek !== null && key === 'Escape') { handled(); setPeek(null); return; }
    if (key === 'F8' && !mod && !e.altKey) { handled(); nextProblem(e.shiftKey ? -1 : 1); return; }
    if (e.shiftKey && e.altKey && !mod && e.code === 'KeyF') { handled(); void format(); return; }
    if (mod && !e.altKey && lower === 's') { handled(); void (lsp ? lsp.save() : code.save()); return; }
    if (mod && !e.altKey && !e.shiftKey && lower === 'f') { handled(); setBar('find'); return; }
    if (mod && !e.altKey && !e.shiftKey && lower === 'g') { handled(); setBar('line'); return; }
    if (mod && !e.altKey && !e.shiftKey && lower === 'h') { handled(); setBar('replace'); return; }
    if (mod && e.shiftKey && !e.altKey && lower === 'o') { handled(); setSymbols(true); return; }
    if (mod && e.shiftKey && !e.altKey && (e.code === 'BracketLeft' || e.code === 'BracketRight')) { handled(); foldAt(lineOf(geo.current.starts, primary.head), e.code === 'BracketLeft'); return; }
    if (mod && !e.altKey && ((lower === 'z' && e.shiftKey) || (lower === 'y' && !IS_MAC))) { handled(); putBack(history.current.redo(s)); return; }
    if (mod && !e.altKey && lower === 'z') { handled(); putBack(history.current.undo(s)); return; }
    if (mod && !e.altKey && !e.shiftKey && lower === 'a') { handled(); place(selectAll(s)); return; }
    if (mod && !e.altKey && !e.shiftKey && lower === 'd') { handled(); place(addNextMatch(s)); return; }
    if (mod && !e.altKey && !e.shiftKey && lower === 'l') { handled(); place(selectLine(s)); return; }
    if (mod && e.shiftKey && !e.altKey && lower === 'k') { handled(); apply(deleteLines(s), 'lines'); return; }
    if (mod && !e.altKey && (key === '/' || e.code === 'Slash')) { handled(); apply(editEach(s, (sel, t) => toggleComment(t, selFrom(sel), selTo(sel), lang)), 'comment'); return; }
    if (mod && !e.altKey && (key === ']' || key === '[')) { handled(); apply(editEach(s, (sel, t) => indentLines(t, selFrom(sel), selTo(sel), key === '[')), 'indent'); return; }
    if (key === 'Escape' && s.sels.length > 1) { handled(); place(single(s)); return; }
    if (key === 'Tab' && !mod && !e.altKey) {
      handled();
      if (e.shiftKey || s.sels.some((x) => x.anchor !== x.head)) apply(editEach(s, (sel, t) => indentLines(t, selFrom(sel), selTo(sel), e.shiftKey)), 'indent');
      else apply(insertText(s, ' '.repeat(TAB)), 'type');
      return;
    }
    if (key === 'Enter' && !mod && !e.altKey) { handled(); apply(editEach(s, (sel, t) => newLine(t, selFrom(sel), selTo(sel))), 'enter'); return; }
    if (key === 'Backspace' || key === 'Delete') {
      handled();
      // ⌘⌫ on a Mac deletes back to the start of the line.
      if (IS_MAC && e.metaKey && key === 'Backspace') {
        apply(editEach(s, (sel, t) => {
          if (sel.anchor !== sel.head) return { from: selFrom(sel), to: selTo(sel), insert: '', select: [selFrom(sel), selFrom(sel)] };
          const ls = t.lastIndexOf('\n', sel.head - 1) + 1;
          return ls === sel.head ? null : { from: ls, to: sel.head, insert: '', select: [ls, ls] };
        }), 'delete');
        return;
      }
      apply(deleteBy(s, key === 'Backspace' ? -1 : 1, wordMod), 'delete');
      return;
    }
    const vertical = key === 'ArrowUp' || key === 'ArrowDown';
    const by: 1 | -1 = key === 'ArrowUp' || key === 'ArrowLeft' || key === 'PageUp' ? -1 : 1;
    if (vertical && e.altKey && !mod && e.shiftKey) { handled(); apply(copyLines(s, by), 'lines'); return; }
    if (vertical && e.altKey && !mod) { handled(); apply(moveLines(s, by), 'lines'); return; }
    if (vertical && ((IS_MAC && e.altKey && e.metaKey) || (!IS_MAC && e.ctrlKey && e.altKey))) { handled(); place(addCursorV(s, by, TAB)); return; }
    if (vertical && IS_MAC && e.metaKey) { handled(); place(by < 0 ? { ...s, sels: [e.shiftKey ? { anchor: primary.anchor, head: 0 } : cursor(0)], primary: 0 } : { ...s, sels: [e.shiftKey ? { anchor: primary.anchor, head: s.text.length } : cursor(s.text.length)], primary: 0 }); return; }
    if (vertical && !mod) {
      handled();
      const moved = moveV(s, by, e.shiftKey, goals.current ?? s.sels.map(() => null) as (number | null)[], TAB, stepLine);
      place(moved.state, true);
      goals.current = moved.goals;
      return;
    }
    if (key === 'PageUp' || key === 'PageDown') {
      handled();
      const page = Math.max(1, Math.floor((scroller.current?.clientHeight ?? 400) / LINE) - 1);
      const moved = moveV(s, by * page, e.shiftKey, goals.current ?? s.sels.map(() => null) as (number | null)[], TAB, stepLine);
      if (scroller.current) scroller.current.scrollTop += by * page * LINE;
      place(moved.state, true);
      goals.current = moved.goals;
      return;
    }
    if ((key === 'ArrowLeft' || key === 'ArrowRight') && IS_MAC && e.metaKey) { handled(); place(key === 'ArrowLeft' ? home(s, e.shiftKey) : end(s, e.shiftKey)); return; }
    if (key === 'ArrowLeft' || key === 'ArrowRight') { handled(); place(moveH(s, by, e.shiftKey, wordMod)); return; }
    if ((key === 'Home' || key === 'End') && mod) { handled(); const at = key === 'Home' ? 0 : s.text.length; place({ ...s, sels: [e.shiftKey ? { anchor: primary.anchor, head: at } : cursor(at)], primary: 0 }); return; }
    if (key === 'Home') { handled(); place(home(s, e.shiftKey)); return; }
    if (key === 'End') { handled(); place(end(s, e.shiftKey)); return; }
    // Everything else (letters, numbers, symbols) arrives as input below.
  };

  // Typed characters arrive as input; the editor puts them in itself, at every cursor. Words from an input method,
  // dictation or a fill land in the field first and are read back from it.
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    const before = (e: InputEvent) => {
      if (e.isComposing || composing.current) return;
      if (e.inputType === 'insertText' && e.data) { e.preventDefault(); typed(e.data); }
      else if (e.inputType === 'insertLineBreak' || e.inputType === 'insertParagraph') { e.preventDefault(); apply(editEach(doc.current, (sel, t) => newLine(t, selFrom(sel), selTo(sel))), 'enter'); }
      else if (e.inputType === 'historyUndo') { e.preventDefault(); putBack(history.current.undo(doc.current)); }
      else if (e.inputType === 'historyRedo') { e.preventDefault(); putBack(history.current.redo(doc.current)); }
    };
    const readBack = () => {
      if (composing.current) return;
      const span = diffSpan(doc.current.text, el.value);
      if (!span) return;
      const at = span.from + span.insert.length;
      apply({ state: { text: el.value, sels: [cursor(at)], primary: 0 }, changes: [span] }, 'type');
    };
    const start = () => { composing.current = true; };
    const done = () => { composing.current = false; readBack(); };
    const paste = (e: ClipboardEvent) => {
      const t = e.clipboardData?.getData('text/plain');
      if (t === undefined) return;
      e.preventDefault();
      apply(insertText(doc.current, t), 'paste');
    };
    const copy = (e: ClipboardEvent, cut: boolean) => {
      const s = doc.current;
      const empty = s.sels.every((x) => x.anchor === x.head);
      const st = lineStarts(s.text);
      // Nothing selected copies the whole line, as in VS Code.
      const parts = s.sels.map((x) => (empty ? `${s.text.slice(st[lineOf(st, x.head)], lineEnd(s.text, st, lineOf(st, x.head)))}\n` : s.text.slice(selFrom(x), selTo(x))));
      e.clipboardData?.setData('text/plain', empty ? parts.join('') : parts.join('\n'));
      e.preventDefault();
      if (cut) apply(empty ? deleteLines(s) : deleteBy(s, -1, false, false), 'cut');
    };
    const onCopy = (e: ClipboardEvent) => copy(e, false);
    const onCut = (e: ClipboardEvent) => copy(e, true);
    el.addEventListener('beforeinput', before);
    el.addEventListener('input', readBack);
    el.addEventListener('compositionstart', start);
    el.addEventListener('compositionend', done);
    el.addEventListener('paste', paste);
    el.addEventListener('copy', onCopy);
    el.addEventListener('cut', onCut);
    return () => {
      el.removeEventListener('beforeinput', before);
      el.removeEventListener('input', readBack);
      el.removeEventListener('compositionstart', start);
      el.removeEventListener('compositionend', done);
      el.removeEventListener('paste', paste);
      el.removeEventListener('copy', onCopy);
      el.removeEventListener('cut', onCut);
    };
  });

  // —— The pointer ——
  const posAt = (clientX: number, clientY: number): number => {
    const el = content.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    const st = lineStarts(doc.current.text);
    const g = geo.current;
    const row = Math.max(0, Math.min(g.rows.length - 1, Math.floor((clientY - r.top - PAD_TOP) / LINE)));
    const line = Math.min(st.length - 1, g.rows[row] ?? 0);
    const lineText = doc.current.text.slice(st[line], lineEnd(doc.current.text, st, line));
    return st[line]! + colAt(lineText, (clientX - r.left - PAD_LEFT) / cw, TAB);
  };
  const onMouseDown = (e: ReactMouseEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('.ed-hover, .ed-complete, .ed-rename, .ed-peek')) return;
    e.preventDefault();
    window.clearTimeout(hoverTimer.current);
    setHover(null);
    if (complete) { completeAsk.current += 1; setComplete(null); }
    // Ctrl+click (⌘-click on a Mac) goes to where the word is defined, as in VS Code.
    if ((IS_MAC ? e.metaKey : e.ctrlKey) && !e.altKey && !e.shiftKey && smart) { input.current?.focus({ preventScroll: true }); const at = posAt(e.clientX, e.clientY); place({ ...doc.current, sels: [cursor(at)], primary: 0 }); void goDefinition(at); return; }
    const more = (e.target as HTMLElement).closest<HTMLElement>('.ed-fold-more');
    if (more) { foldAt(Number(more.dataset.line), false); return; }
    input.current?.focus({ preventScroll: true });
    const at = posAt(e.clientX, e.clientY);
    const s = doc.current;
    const t = s.text;
    let anchorSpan: [number, number] = [at, at];
    if (e.detail === 2) anchorSpan = wordAt(t, at);
    else if (e.detail >= 3) { const st = lineStarts(t); const l = lineOf(st, at); anchorSpan = [st[l]!, st[l + 1] ?? t.length]; }
    const adding = e.altKey && !e.shiftKey;
    const base = adding ? s.sels : [];
    const startAnchor = e.shiftKey && !adding ? primary.anchor : anchorSpan[0];
    const set = (head: number) => {
      const fwd = head >= anchorSpan[0];
      const sel = e.shiftKey && !adding ? { anchor: startAnchor, head } : fwd ? { anchor: anchorSpan[0], head: Math.max(head, anchorSpan[1]) } : { anchor: anchorSpan[1], head };
      const n = normalize([...base, sel], base.length);
      place({ ...doc.current, sels: n.sels, primary: n.primary });
    };
    set(e.detail >= 2 ? anchorSpan[1] : at);
    const move = (m: MouseEvent) => set(posAt(m.clientX, m.clientY));
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  // —— Find and Go to line ——
  const onFind = (query: string, opts: FindOptions, at: number) => {
    const marks = findAll(doc.current.text, query, opts);
    setFound({ marks, at });
    const hit = marks[at];
    if (hit) { doc.current = { ...doc.current, sels: [{ anchor: hit[0], head: hit[1] }], primary: 0 }; redraw(); requestAnimationFrame(() => reveal(true)); }
  };
  const onReplace = (query: string, opts: FindOptions, withText: string, at: number) => {
    const s = doc.current;
    const marks = findAll(s.text, query, opts);
    const hit = marks[at];
    if (!hit) return;
    apply(replaceSpans(s, [hit], [replacement(s.text, hit, query, withText, opts)]), 'replace');
    // The match after it is next: its place shifted by what was put in.
    const next = findAll(doc.current.text, query, opts);
    const from = hit[0] + replacement(s.text, hit, query, withText, opts).length;
    const i = Math.max(0, next.findIndex(([a]) => a >= from));
    setFound({ marks: next, at: i });
    const n = next[i];
    if (n) { doc.current = { ...doc.current, sels: [{ anchor: n[0], head: n[1] }], primary: 0 }; redraw(); requestAnimationFrame(() => reveal(true)); }
  };
  const onReplaceAll = (query: string, opts: FindOptions, withText: string) => {
    const s = doc.current;
    const marks = findAll(s.text, query, opts, 100_000);
    if (marks.length === 0) return;
    apply(replaceSpans(s, marks, marks.map((m) => replacement(s.text, m, query, withText, opts))), 'replace');
    setFound({ marks: [], at: 0 });
  };
  const onSelectAll = (query: string, opts: FindOptions) => {
    const marks = findAll(doc.current.text, query, opts);
    if (marks.length === 0) return;
    setBar(null);
    setFound({ marks: [], at: 0 });
    place({ ...doc.current, sels: marks.map(([a, b]) => ({ anchor: a, head: b })), primary: marks.length - 1 });
    input.current?.focus({ preventScroll: true });
  };
  const closeBar = () => {
    setBar(null);
    setFound({ marks: [], at: 0 });
    requestAnimationFrame(() => input.current?.focus({ preventScroll: true }));
  };
  const goLine = (line: number) => {
    const st = lineStarts(doc.current.text);
    const at = st[Math.max(0, Math.min(line - 1, st.length - 1))]!;
    setBar(null);
    history.current.seal();
    doc.current = { ...doc.current, sels: [cursor(at)], primary: 0 };
    openAround(lineOf(st, at));
    redraw();
    input.current?.focus({ preventScroll: true });
    requestAnimationFrame(() => reveal(true));
  };
  if (jump) jump.current = goLine;

  // —— Language smarts ——
  // A place sent from elsewhere (go to definition, the Problems panel): the cursor goes there once its file is open.
  useEffect(() => {
    const p = lsp?.takePending(path);
    if (!p) return;
    const st = lineStarts(doc.current.text);
    const at = offsetOf(st, doc.current.text.length, p.line, p.character);
    history.current.seal();
    doc.current = { ...doc.current, sels: [cursor(at)], primary: 0 };
    openAround(lineOf(st, at));
    redraw();
    input.current?.focus({ preventScroll: true });
    requestAnimationFrame(() => reveal(true));
  }, [path, lsp?.pendingVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  const placeOf = (at: number): [number, number] => {
    const st = lineStarts(doc.current.text);
    const l = lineOf(st, at);
    return [l, at - st[l]!];
  };
  const problemsAt = (at: number): CodeProblem[] => {
    const st = lineStarts(doc.current.text);
    const n = doc.current.text.length;
    return fileProblems.filter((p) => {
      const a = offsetOf(st, n, p.line, p.character);
      const b = offsetOf(st, n, p.endLine, p.endCharacter);
      return a <= at && at <= Math.max(b, a + 1);
    });
  };
  const askComplete = async (trigger?: string) => {
    window.clearTimeout(completeTimer.current);
    if (!lsp || !smart) return;
    const s = doc.current;
    if (s.sels.length !== 1 || s.sels[0]!.anchor !== s.sels[0]!.head) return;
    const at = s.sels[0]!.head;
    const [line, character] = placeOf(at);
    const n = ++completeAsk.current;
    const answer = await lsp.ask('complete', line, character, trigger);
    if (n !== completeAsk.current) return;
    if (!answer.ok || !answer.items?.length) { setComplete(null); return; }
    setComplete({ items: answer.items, line, min: wordStartBefore(s.text, at), index: 0 });
  };
  const laterComplete = (trigger?: string) => {
    window.clearTimeout(completeTimer.current);
    completeTimer.current = window.setTimeout(() => void askComplete(trigger), COMPLETE_DELAY);
  };
  const acceptCompletion = (item: CodeCompletion) => {
    const s = doc.current;
    const head = s.sels[s.primary]!.head;
    const st = lineStarts(s.text);
    const given = item.from ? offsetOf(st, s.text.length, item.from.line, item.from.character) : wordStartBefore(s.text, head);
    const from = Math.min(given, head);
    const changes = [{ from, to: head, insert: item.insert }];
    const at = from + (item.caret ?? item.insert.length);
    completeAsk.current += 1;
    setComplete(null);
    apply({ state: { text: applyChanges(s.text, changes), sels: [cursor(at)], primary: 0 }, changes }, 'complete');
  };
  const goDefinition = async (at: number) => {
    if (!lsp || !smart) return;
    const [line, character] = placeOf(at);
    const answer = await lsp.ask('definition', line, character);
    const place = answer.ok ? answer.places?.[0] : undefined;
    if (!place) { setNote(answer.ok ? 'No definition found' : answer.message ?? 'No definition found'); return; }
    if (place.path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(place.path)) { setNote(`Defined outside this project, in ${place.path.split(/[\\/]/).pop()}`); return; }
    void lsp.goTo(place);
  };
  const startRename = () => {
    const s = doc.current;
    const [a, b] = wordAt(s.text, s.sels[s.primary]!.head);
    if (a === b || !smart) return;
    setHover(null);
    setComplete(null);
    setRename({ from: a, to: b });
  };
  const doRename = async (value: string) => {
    const r = rename;
    setRename(null);
    input.current?.focus({ preventScroll: true });
    const name = value.trim();
    if (!lsp || !r || !name || name === doc.current.text.slice(r.from, r.to)) return;
    const [line, character] = placeOf(r.from);
    const answer = await lsp.ask('rename', line, character, name);
    if (!answer.ok) { setNote(answer.message ?? 'This cannot be renamed'); return; }
    const files = (answer.files ?? []).filter((f) => f.edits.length > 0);
    const here = files.filter((f) => f.path === path).flatMap((f) => f.edits);
    if (here.length > 0) {
      const s = doc.current;
      const spans = spansOf(s.text, lineStarts(s.text), here);
      apply(replaceSpans(s, spans.map((x) => [x.from, x.to]), spans.map((x) => x.insert)), 'rename');
    }
    await lsp.applyElsewhere(files.filter((f) => f.path !== path));
    setNote(files.length > 1 ? `Renamed in ${files.length} files` : 'Renamed');
  };
  const format = async () => {
    if (!lsp || !smart) return;
    const answer = await lsp.ask('format', 0, 0);
    if (!answer.ok) { setNote(answer.message ?? 'This file cannot be formatted'); return; }
    const s = doc.current;
    const spans = spansOf(s.text, lineStarts(s.text), answer.edits ?? []);
    if (spans.length === 0) { setNote('Already formatted'); return; }
    apply(replaceSpans(s, spans.map((x) => [x.from, x.to]), spans.map((x) => x.insert)), 'format');
  };
  /** F8 and Shift+F8: the next problem in this file, its message shown where it is. */
  const nextProblem = (dir: 1 | -1) => {
    const s = doc.current;
    const st = lineStarts(s.text);
    const at = [...new Set(fileProblems.map((p) => offsetOf(st, s.text.length, p.line, p.character)))].sort((a, b) => a - b);
    if (at.length === 0) { setNote('No problems in this file'); return; }
    const h = s.sels[s.primary]!.head;
    const t = dir > 0 ? at.find((o) => o > h) ?? at[0]! : [...at].reverse().find((o) => o < h) ?? at[at.length - 1]!;
    place({ ...s, sels: [cursor(t)], primary: 0 });
    setHover({ at: t, text: '', problems: problemsAt(t) });
  };
  /** Puts one change back as the last commit had it, as a step of its own. */
  const revertChange = (m: ChangeMark) => {
    const s = doc.current;
    const t = s.text;
    const st = lineStarts(t);
    setPeek(null);
    input.current?.focus({ preventScroll: true });
    let from: number;
    let to: number;
    let insert: string;
    if (m.kind === 'delete' && m.atEnd) {
      from = to = t.length;
      const nl = t.endsWith('\n');
      insert = `${nl || t === '' ? '' : '\n'}${m.removed.join('\n')}${nl ? '\n' : ''}`;
    } else if (m.kind === 'delete') {
      from = to = st[Math.min(m.first, st.length - 1)]!;
      insert = m.removed.map((l) => `${l}\n`).join('');
    } else {
      from = st[m.first] ?? t.length;
      to = m.last + 1 < st.length ? st[m.last + 1]! : t.length;
      insert = m.removed.map((l) => `${l}\n`).join('');
      if (to === t.length && !t.endsWith('\n')) insert = insert.replace(/\n$/, '');
      if (m.removed.length === 0 && to === t.length && from > 0 && !t.endsWith('\n')) from -= 1;
    }
    apply(replaceSpans(s, [[from, to]], [insert]), 'revert');
  };
  /** Alt+F5 and Shift+Alt+F5: the next change since the last commit, shown with what was there. */
  const nextChange = (dir: 1 | -1) => {
    if (changes.length === 0) { setNote('No changes since the last commit'); return; }
    const line = lineOf(lineStarts(doc.current.text), doc.current.sels[doc.current.primary]!.head);
    const i = dir > 0 ? changes.findIndex((c) => c.first > line) : changes.map((c) => c.last < line).lastIndexOf(true);
    const k = i >= 0 ? i : dir > 0 ? 0 : changes.length - 1;
    const st = lineStarts(doc.current.text);
    place({ ...doc.current, sels: [cursor(st[Math.min(changes[k]!.first, st.length - 1)]!)], primary: 0 });
    setPeek(k);
  };
  const showHover = async (at: number) => {
    const s = doc.current;
    const [a, b] = wordAt(s.text, at);
    const here = problemsAt(at);
    if (a === b && here.length === 0) { setHover(null); return; }
    let said = '';
    if (smart && a !== b && lsp) {
      const [line, character] = placeOf(at);
      const answer = await lsp.ask('hover', line, character);
      if (answer.ok) said = answer.text ?? '';
    }
    if (!said && here.length === 0) { setHover(null); return; }
    setHover({ at: a < b ? a : at, text: said, problems: here });
  };
  const onMouseMove = (e: ReactMouseEvent) => {
    if (e.buttons || !lsp) return;
    if ((e.target as HTMLElement).closest('.ed-hover, .ed-complete, .ed-rename')) { window.clearTimeout(hoverTimer.current); return; }
    window.clearTimeout(hoverTimer.current);
    const { clientX, clientY } = e;
    hoverTimer.current = window.setTimeout(() => void showHover(posAt(clientX, clientY)), HOVER_DELAY);
  };

  // —— Drawing ——
  // The lines in view, top to bottom (folded lines left out).
  const inView: number[] = rows.slice(firstRow, lastRow + 1);
  const visible: React.ReactNode[] = [];
  const selRects: React.ReactNode[] = [];
  const cursors: React.ReactNode[] = [];
  const multi = state.sels.length > 1;
  const lineDiv = (i: number) => (
    <>
      {(tokens[i] ?? []).map((t, k) => <span key={k} className={`tok-${t.k}`}>{t.t}</span>)}
      {foldedLines.has(i) && <span className="ed-fold-more" data-line={i} title="Folded lines: click to open (Ctrl+Shift+])">⋯</span>}
    </>
  );
  for (const i of inView) {
    visible.push(
      <div key={i} className="ed-line" style={{ top: yOf(i) }} data-current={(i === caretLine && primary.anchor === primary.head && !multi) || undefined}>
        {lineDiv(i)}
      </div>,
    );
  }
  state.sels.forEach((s, n) => {
    const a = selFrom(s);
    const b = selTo(s);
    if (a !== b) {
      const la = Math.max(lineOf(starts, a), first);
      const lb = Math.min(lineOf(starts, b), last);
      for (let l = la; l <= lb; l += 1) {
        if (!shown(l)) continue;
        const ls = starts[l]!;
        const le = lineEnd(text, starts, l);
        const x1 = xOf(l, Math.max(a, ls) - ls);
        const past = b > le;
        const x2 = xOf(l, Math.min(b, le) - ls) + (past ? cw / 2 : 0);
        if (x2 > x1) selRects.push(<div key={`${n}-${l}`} className="ed-sel" style={{ top: yOf(l), left: x1, width: x2 - x1 }} />);
      }
    }
    const hl = lineOf(starts, s.head);
    if (hl >= first && hl <= last && shown(hl)) cursors.push(<div key={`c${n}`} className="ed-cursor" style={{ top: yOf(hl), left: xOf(hl, s.head - starts[hl]!) }} />);
  });
  const marks = found.marks.slice(0, 5000).map(([a, b], i) => {
    const l = lineOf(starts, a);
    if (l < first || l > last || !shown(l)) return null;
    const x1 = xOf(l, a - starts[l]!);
    return <span key={a} className="code-found" data-current={i === found.at || undefined} style={{ top: yOf(l), left: x1, width: Math.max(cw / 2, xOf(l, Math.min(b, lineEnd(text, starts, l)) - starts[l]!) - x1) }} />;
  });
  // Problems from the language server, underlined where they are.
  const squiggles: React.ReactNode[] = [];
  for (const [n, p] of fileProblems.slice(0, 2000).entries()) {
    for (let l = Math.max(p.line, first); l <= Math.min(p.endLine, last); l += 1) {
      if (!shown(l) || l >= lines.length) continue;
      const len = (lines[l] ?? '').length;
      const a = l === p.line ? Math.min(p.character, len) : 0;
      const b = l === p.endLine ? Math.min(p.endCharacter, len) : len;
      const x1 = xOf(l, a);
      const w = Math.max(cw, xOf(l, b) - x1);
      squiggles.push(<span key={`p${n}-${l}`} className="ed-problem" data-severity={p.severity} style={{ top: yOf(l), left: x1, width: w }} />);
    }
  }
  // What the pointer rests on, the completion list and a rename being typed: placed at their words.
  let hoverBox: React.ReactNode = null;
  const changeBars: React.ReactNode[] = [];
  changes.forEach((m, k) => {
    if (m.last < first || m.first > last) return;
    const a = Math.max(m.first, first);
    let b = Math.min(m.last, last);
    while (b > a && !shown(b)) b -= 1;
    if (!shown(a) && !shown(b)) return;
    const what = m.kind === 'add' ? 'added' : m.kind === 'change' ? 'changed' : 'deleted';
    const label = m.kind === 'delete' ? `${m.removed.length} line${m.removed.length === 1 ? '' : 's'} deleted here since the last commit` : `Lines ${m.first + 1} to ${m.last + 1} ${what} since the last commit`;
    changeBars.push(
      <button key={`m${k}`} type="button" tabIndex={-1} className="ed-change" data-kind={m.kind} aria-label={label} title={label} style={{ top: yOf(a), height: m.kind === 'delete' ? undefined : yOf(b) - yOf(a) + LINE }} onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setPeek(peek === k ? null : k); }} />,
    );
  });
  let peekBox: React.ReactNode = null;
  const peeked = peek !== null ? changes[peek] : undefined;
  if (peeked && shown(Math.min(peeked.last, lines.length - 1))) {
    const l = Math.min(peeked.last, lines.length - 1);
    peekBox = (
      <div className="ed-peek" role="dialog" aria-label="Change since the last commit" style={{ top: yOf(l) + LINE + 2 }}>
        <div className="ed-peek-head">
          <span>{peeked.kind === 'add' ? 'Added since the last commit' : peeked.kind === 'delete' ? 'Deleted since the last commit' : 'Changed since the last commit'}</span>
          <button type="button" className="btn" onMouseDown={(e) => e.preventDefault()} onClick={() => revertChange(peeked)}>Revert this change</button>
          <button type="button" className="ed-peek-close" aria-label="Close" onMouseDown={(e) => e.preventDefault()} onClick={() => { setPeek(null); input.current?.focus({ preventScroll: true }); }}>×</button>
        </div>
        {peeked.removed.length > 0 && (
          <pre className="ed-peek-was" aria-label="What was there">{colourLines(peeked.removed, lang).map((toks, i) => <div key={i}>{toks.map((t, k) => <span key={k} className={`tok-${t.k}`}>{t.t}</span>)}{peeked.removed[i] === '' ? '\u200b' : null}</div>)}</pre>
        )}
      </div>
    );
  }
  if (hover && (hover.text || hover.problems.length > 0)) {
    const l = lineOf(starts, Math.min(hover.at, text.length));
    if (shown(l)) {
      const below = yOf(l) - view.top < 140;
      hoverBox = (
        <div className="ed-hover" role="status" data-below={below || undefined} style={{ top: below ? yOf(l) + LINE + 2 : yOf(l) - 2, left: Math.max(view.left + 4, xOf(l, hover.at - starts[l]!)) }}>
          {hover.problems.map((p, i) => (
            <p key={i} className="ed-hover-problem" data-severity={p.severity}><span className="ed-hover-mark" aria-hidden="true" />{p.message}{p.source ? <span className="ed-hover-source"> {p.source}{p.code != null ? `(${p.code})` : ''}</span> : null}</p>
          ))}
          {hover.text && <HoverText text={hover.text} lang={lang} />}
        </div>
      );
    }
  }
  let completeBox: React.ReactNode = null;
  if (choices.length > 0 && complete) {
    const at = Math.min(complete.index, choices.length - 1);
    const from = wordStartBefore(text, primary.head);
    const chosen = choices[at]!;
    completeBox = (
      <div className="ed-complete" style={{ top: yOf(caretLine) + LINE + 2, left: xOf(caretLine, from - starts[caretLine]!) - 22 }}>
        <ul id="ed-complete-list" role="listbox" aria-label="Completions">
          {choices.map((c, i) => (
            <li
              key={`${c.label}-${i}`}
              id={`ed-complete-${i}`}
              role="option"
              aria-selected={i === at}
              ref={i === at ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined}
              onMouseDown={(e) => { e.preventDefault(); acceptCompletion(c); }}
            >
              <span className="ed-complete-kind" data-kind={c.kind} aria-hidden="true">{KIND_MARK[c.kind] ?? '·'}</span>
              <span className="ed-complete-label">{c.label}</span>
              {i === at && c.detail && <span className="ed-complete-detail">{c.detail}</span>}
            </li>
          ))}
        </ul>
        {chosen.documentation && <div className="ed-complete-doc">{chosen.documentation}</div>}
      </div>
    );
  }
  let renameBox: React.ReactNode = null;
  if (rename) {
    const l = lineOf(starts, rename.from);
    renameBox = (
      <input
        className="ed-rename"
        aria-label="New name"
        autoFocus
        defaultValue={text.slice(rename.from, rename.to)}
        spellCheck={false}
        style={{ top: yOf(l) + LINE + 2, left: xOf(l, rename.from - starts[l]!) }}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') { e.preventDefault(); void doRename(e.currentTarget.value); }
          if (e.key === 'Escape') { e.preventDefault(); setRename(null); input.current?.focus({ preventScroll: true }); }
        }}
        onBlur={() => setRename(null)}
      />
    );
  }
  // The bracket at the cursor and its partner, boxed; and, with nothing selected, the other uses of the word under the cursor.
  const boxes: React.ReactNode[] = [];
  if (primary.anchor === primary.head && !multi) {
    const pair = matchBracket(text, primary.head);
    for (const p of pair ?? []) {
      const l = lineOf(starts, p);
      if (l >= first && l <= last && shown(l)) boxes.push(<span key={`b${p}`} className="ed-bracket" style={{ top: yOf(l), left: xOf(l, p - starts[l]!), width: cw }} />);
    }
    const [wa, wb] = wordAt(text, primary.head);
    const word = text.slice(wa, wb);
    if (word.length > 1 && !/^\d/.test(word)) {
      const from = starts[first]!;
      const to = lineEnd(text, starts, last);
      for (const [a, b] of findAll(text.slice(from, to), word, { matchCase: true, word: true }, 400)) {
        const l = lineOf(starts, from + a);
        if (shown(l)) boxes.push(<span key={`w${from + a}`} className="ed-same-word" data-here={from + a === wa || undefined} style={{ top: yOf(l), left: xOf(l, from + a - starts[l]!), width: (b - a) * cw }} />);
      }
    }
  }
  // Indent guides: a faint line at each indent stop of the lines in view (blank lines take the indent around them).
  const guides: React.ReactNode[] = [];
  {
    const depth = (l: number): number => {
      const t = lines[l] ?? '';
      if (t.trim() === '') return -1;
      return Math.floor(visualCol(t, /^[ \t]*/.exec(t)![0].length, TAB) / TAB);
    };
    const depths = inView.map(depth);
    for (let k = 0; k < depths.length; k += 1) {
      if (depths[k] !== -1) continue;
      let up = k - 1;
      while (up >= 0 && depths[up] === -1) up -= 1;
      let down = k + 1;
      while (down < depths.length && depths[down] === -1) down += 1;
      depths[k] = Math.min(up >= 0 ? depths[up]! : 0, down < depths.length ? depths[down]! : 0);
    }
    depths.forEach((d, k) => {
      for (let g = 1; g < d; g += 1) guides.push(<span key={`g${inView[k]}-${g}`} className="ed-guide" style={{ top: yOf(inView[k]!), left: PAD_LEFT + g * TAB * cw }} />);
    });
  }
  // Sticky scroll: the lines that open the scopes the top of the view is in stay at the top, as in VS Code.
  const topRow = Math.max(0, Math.floor((view.top - PAD_TOP) / LINE));
  let sticky = view.top > PAD_TOP ? stickyScopes(rows[topRow] ?? 0, regions) : [];
  if (sticky.length > 0) sticky = stickyScopes(rows[Math.min(rows.length - 1, topRow + sticky.length)] ?? 0, regions);
  const gutterWidth = `${String(lines.length).length + (testMarks.size > 0 ? 6 : 4)}ch`;
  const height = PAD_TOP + rows.length * LINE + PAD_BOTTOM;
  const width = PAD_LEFT + widest * cw + 6 * cw;
  const picked = state.sels.reduce((n, s) => n + selTo(s) - selFrom(s), 0);

  return (
    <div className="code-editor">
      {bar && <EditorBar key={bar} mode={bar} text={text} onClose={closeBar} onFind={onFind} onLine={goLine} onReplace={onReplace} onReplaceAll={onReplaceAll} onSelectAll={onSelectAll} />}
      {symbols && <SymbolPicker text={text} lang={lang} onGo={goLine} onClose={() => { setSymbols(false); requestAnimationFrame(() => input.current?.focus({ preventScroll: true })); }} />}
      <div className="ed" data-focused={focused || undefined}>
        <div className="ed-gutter" style={{ width: gutterWidth }}>
          <div style={{ height, transform: `translateY(${-view.top}px)` }}>
            {changeBars}
            {inView.map((i) => (
              <span key={i} className="ed-n" style={{ top: yOf(i) }} data-current={i === caretLine || undefined}>
                <span aria-hidden="true">{i + 1}</span>
                {runner && testMarks.has(i) && (() => {
                  const m = testMarks.get(i)!;
                  const result = runner.results.get(runner.keyOf(m));
                  const label = runner.label(m);
                  return (
                    <button type="button" tabIndex={-1} className="ed-run" data-result={result} aria-label={label} title={label} disabled={runner.running} onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }} onClick={() => runner.run(m)}>
                      <svg viewBox="0 0 20 20" aria-hidden="true">{result === 'passed' ? <path d="m5 10.5 3.2 3L15 6.5" /> : result === 'failed' ? <path d="m6 6 8 8m0-8-8 8" /> : result === 'running' ? <circle cx="10" cy="10" r="5" /> : <path d="M7 5.5v9l7.5-4.5z" />}</svg>
                    </button>
                  );
                })()}
                {regions.has(i) && (
                  <button
                    type="button"
                    tabIndex={-1}
                    className="ed-fold"
                    data-folded={foldedLines.has(i) || undefined}
                    aria-label={foldedLines.has(i) ? `Open lines ${i + 2} to ${(regions.get(i) ?? i) + 1}` : `Fold lines ${i + 2} to ${(regions.get(i) ?? i) + 1}`}
                    onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); foldAt(i, !foldedLines.has(i)); }}
                  >
                    <svg viewBox="0 0 20 20" aria-hidden="true"><path d={foldedLines.has(i) ? 'm8 6 4 4-4 4' : 'm6 8 4 4 4-4'} /></svg>
                  </button>
                )}
              </span>
            ))}
          </div>
          {sticky.length > 0 && (
            <div className="ed-gutter-sticky" aria-hidden="true">
              {sticky.map((l, k) => <span key={l} className="ed-n" style={{ top: k * LINE }}>{l + 1}</span>)}
            </div>
          )}
        </div>
        <div className="ed-scroll" ref={scroller} onScroll={(e) => { const t = e.currentTarget; setView((v) => ({ ...v, top: t.scrollTop, left: t.scrollLeft })); }}>
          {sticky.length > 0 && (
            <div className="ed-sticky" style={{ width: view.width }} aria-hidden="true">
              {sticky.map((l, k) => (
                <div key={l} className="ed-sticky-line" style={{ top: k * LINE }} onMouseDown={(e) => { e.preventDefault(); goLine(l + 1); }}>
                  {(tokens[l] ?? []).map((t, n) => <span key={n} className={`tok-${t.k}`}>{t.t}</span>)}
                </div>
              ))}
            </div>
          )}
          <div className="ed-content" ref={content} style={{ height, width }} onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseLeave={() => { window.clearTimeout(hoverTimer.current); setHover(null); }}>
            <span className="ed-measure" ref={measure} aria-hidden="true">{'M'.repeat(20)}</span>
            {guides}
            {marks}
            {selRects}
            {boxes}
            {visible}
            {squiggles}
            {focused && cursors}
            {hoverBox}
            {completeBox}
            {renameBox}
            {peekBox}
            <textarea
              ref={input}
              className="ed-input"
              style={{ top: yOf(caretLine), left: xOf(caretLine, caretCol) }}
              aria-label={`Contents of ${path || 'the file'}`}
              aria-multiline="true"
              aria-autocomplete={smart ? 'list' : undefined}
              aria-expanded={smart ? choices.length > 0 : undefined}
              aria-controls={choices.length > 0 ? 'ed-complete-list' : undefined}
              aria-activedescendant={choices.length > 0 && complete ? `ed-complete-${Math.min(complete.index, choices.length - 1)}` : undefined}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              autoComplete="off"
              wrap="off"
              defaultValue={text}
              onKeyDown={onKey}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
            />
          </div>
        </div>
      </div>
      <footer className="code-status" aria-label="Where the cursor is">
        <span>Ln {caretLine + 1}, Col {caretCol + 1}{picked > 0 ? ` (${picked} selected)` : ''}{multi ? ` · ${state.sels.length} cursors` : ''}</span>
        {note && <span role="status" className="code-status-note">{note}</span>}
        {lsp?.status.kind === 'server' && (
          <button type="button" className="code-status-btn" aria-label={`Problems: ${lsp.counts.errors} errors, ${lsp.counts.warnings} warnings`} title="Problems (F8 goes to the next one in this file)" onClick={onShowProblems}>
            <span className="code-status-err" aria-hidden="true" />{lsp.counts.errors}
            <span className="code-status-warn" aria-hidden="true" />{lsp.counts.warnings}
          </button>
        )}
        {lsp?.status.kind === 'server' && (
          <button type="button" className="code-status-btn" aria-pressed={lsp.formatOnSave} title="Format this file each time it is saved (Shift+Alt+F formats now)" onClick={() => lsp.setFormatOnSave(!lsp.formatOnSave)}>Format on save</button>
        )}
        {lsp?.status.kind === 'failed' && (
          <span className="code-status-missing" title={`${lsp.status.program} would not start: ${lsp.status.message}`}>
            {lsp.status.language} server would not start
            <button type="button" className="code-status-btn" onClick={() => void lsp.retry()}>Retry</button>
          </span>
        )}
        {lsp?.status.kind === 'missing' && (
          <span className="code-status-missing" title={lsp.status.program ? `Install ${lsp.status.program} on this computer (or in this project) for completions, problems and go to definition in ${lsp.status.language}.` : undefined}>No {lsp.status.language} server</span>
        )}
        <span title={lsp?.status.kind === 'server' ? `Language smarts from ${lsp.status.server}` : undefined}>{langName(path)}</span>
        <span>Spaces: {TAB}</span>
      </footer>
    </div>
  );
}
