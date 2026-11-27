import type { Edit } from './code-edit';

/**
 * The Code editor's own text and cursors, kept apart from the screen so every move and change can be tested. A text
 * has one or more selections (a cursor is a selection with nothing in it); each change is made at every selection at
 * once, as in VS Code's multiple cursors, and kept as the spans it replaced, so it can be taken back exactly.
 */

/** Where a selection was started (`anchor`) and where its cursor is now (`head`), as places in the text. */
export interface Sel { anchor: number; head: number }

export interface DocState {
  text: string;
  /** In order through the text, never overlapping. */
  sels: Sel[];
  /** Which selection was made last; Esc keeps it, and the find bar and status line follow it. */
  primary: number;
}

/** One span replaced, in the text as it was before the change. */
export interface Change { from: number; to: number; insert: string }

export const selFrom = (s: Sel): number => Math.min(s.anchor, s.head);
export const selTo = (s: Sel): number => Math.max(s.anchor, s.head);
export const cursor = (at: number): Sel => ({ anchor: at, head: at });

export function docOf(text: string, at = 0): DocState {
  const p = Math.max(0, Math.min(at, text.length));
  return { text, sels: [cursor(p)], primary: 0 };
}

/** Selections in order with any that touch or overlap joined, keeping track of the primary one. */
export function normalize(sels: readonly Sel[], primary = sels.length - 1): { sels: Sel[]; primary: number } {
  const tagged = sels.map((s, i) => ({ s, i }));
  tagged.sort((a, b) => selFrom(a.s) - selFrom(b.s) || selTo(a.s) - selTo(b.s));
  const out: { s: Sel; has: boolean }[] = [];
  for (const { s, i } of tagged) {
    const last = out[out.length - 1];
    const empty = s.anchor === s.head;
    if (last && (selFrom(s) < selTo(last.s) || (selFrom(s) === selTo(last.s) && (empty || last.s.anchor === last.s.head)))) {
      const from = Math.min(selFrom(last.s), selFrom(s));
      const to = Math.max(selTo(last.s), selTo(s));
      const forward = last.s.head >= last.s.anchor;
      last.s = forward ? { anchor: from, head: to } : { anchor: to, head: from };
      last.has ||= i === primary;
    } else {
      out.push({ s: { ...s }, has: i === primary });
    }
  }
  const p = out.findIndex((o) => o.has);
  return { sels: out.map((o) => o.s), primary: p < 0 ? out.length - 1 : p };
}

/** Where a place in the text moves to once `changes` (in order, not overlapping) are made. */
export function mapPos(pos: number, changes: readonly Change[], after = true): number {
  let shift = 0;
  for (const c of changes) {
    if (c.to < pos || (c.to === pos && c.from < pos)) shift += c.insert.length - (c.to - c.from);
    else if (c.from <= pos && pos <= c.to) {
      if (c.from === c.to && c.from === pos) return pos + shift + (after ? c.insert.length : 0);
      return c.from + shift + (pos === c.to && after ? c.insert.length : 0);
    } else break;
  }
  return pos + shift;
}

/** The text with `changes` (in order, not overlapping, in the text as it was) made. */
export function applyChanges(text: string, changes: readonly Change[]): string {
  let out = '';
  let at = 0;
  for (const c of changes) {
    out += text.slice(at, c.from) + c.insert;
    at = c.to;
  }
  return out + text.slice(at);
}

/** The changes that put the text back as it was: each new span replaced by what it replaced. */
export function invertChanges(text: string, changes: readonly Change[]): Change[] {
  let shift = 0;
  return changes.map((c) => {
    const from = c.from + shift;
    shift += c.insert.length - (c.to - c.from);
    return { from, to: from + c.insert.length, insert: text.slice(c.from, c.to) };
  });
}

/** Changes in order, with any two that would overlap kept as the first only (two cursors on one span). */
function tidy(changes: Change[]): Change[] {
  const sorted = [...changes].sort((a, b) => a.from - b.from || a.to - b.to);
  const out: Change[] = [];
  for (const c of sorted) {
    const last = out[out.length - 1];
    if (last && c.from < last.to) continue;
    if (last && c.from === last.to && c.from === c.to && last.from === last.to) { last.insert += c.insert; continue; }
    out.push(c);
  }
  return out;
}

/** The result of a change: the new state, and what was replaced (for undo). */
export interface Step { state: DocState; changes: Change[] }

/**
 * Makes one edit at every selection: `edit` is asked for each in turn, with the text as it was, and gives back the
 * span it replaces, the new text, and where that selection ends up (as an offset into the new text it inserted, or
 * a place in the old text when `select` is given). Null leaves that selection as it is.
 */
export function editEach(state: DocState, edit: (s: Sel, text: string) => Edit | null): Step {
  const asked = state.sels.map((s) => edit(s, state.text));
  const changes = tidy(asked.filter((e): e is Edit => e !== null).map((e) => ({ from: e.from, to: e.to, insert: e.insert })));
  const text = applyChanges(state.text, changes);
  // Each selection lands where its edit says, measured from where its own change starts in the new text.
  const sels = state.sels.map((s, i) => {
    const e = asked[i];
    if (!e) return { anchor: mapPos(s.anchor, changes), head: mapPos(s.head, changes) };
    const start = mapPos(e.from, changes, false);
    return { anchor: start + (e.select[0] - e.from), head: start + (e.select[1] - e.from) };
  });
  const n = normalize(sels, state.primary);
  return { state: { text, sels: n.sels, primary: n.primary }, changes };
}

/** Types `insert` at every selection, in place of what it holds; with as many lines as cursors, one line each. */
export function insertText(state: DocState, insert: string): Step {
  const parts = insert.split(/\r?\n/);
  const each = state.sels.length > 1 && parts.length === state.sels.length ? parts : null;
  let i = -1;
  return editEach(state, (s) => {
    i += 1;
    const t = each ? each[i]! : insert.replace(/\r\n/g, '\n');
    const from = selFrom(s);
    return { from, to: selTo(s), insert: t, select: [from + t.length, from + t.length] };
  });
}

const WORD = /[\p{L}\p{N}_$]/u;
const isWord = (ch: string | undefined): boolean => ch !== undefined && WORD.test(ch);

/** Where a word move from `at` lands, as Ctrl+Left and Ctrl+Right do: over spaces, then over a word or a run of marks. */
export function wordStep(text: string, at: number, dir: 1 | -1): number {
  let p = at;
  const peek = () => (dir > 0 ? text[p] : text[p - 1]);
  const inBounds = () => (dir > 0 ? p < text.length : p > 0);
  while (inBounds() && /[ \t]/.test(peek()!)) p += dir;
  if (!inBounds()) return p;
  if (peek() === '\n') return p === at ? p + dir : p;
  const word = isWord(peek());
  while (inBounds() && peek() !== '\n' && !/[ \t]/.test(peek()!) && isWord(peek()) === word) p += dir;
  return p;
}

/** Backspace (or Delete, `dir` 1): what is selected, or else one character (a word with `word`) before the cursor. */
export function deleteBy(state: DocState, dir: 1 | -1, word = false, pairs = true): Step {
  return editEach(state, (s, text) => {
    if (s.anchor !== s.head) return { from: selFrom(s), to: selTo(s), insert: '', select: [selFrom(s), selFrom(s)] };
    const at = s.head;
    if (pairs && dir < 0 && !word && at > 0) {
      const open = text[at - 1]!;
      const close = ({ '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '`': '`' } as Record<string, string>)[open];
      if (close !== undefined && text[at] === close) return { from: at - 1, to: at + 1, insert: '', select: [at - 1, at - 1] };
    }
    const other = word ? wordStep(text, at, dir) : Math.max(0, Math.min(text.length, at + dir));
    if (other === at) return null;
    const from = Math.min(at, other);
    return { from, to: Math.max(at, other), insert: '', select: [from, from] };
  });
}

// —— Lines and columns ——

/** Where each line starts. */
export function lineStarts(text: string): number[] {
  const out = [0];
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) out.push(i + 1);
  return out;
}

/** The line (from 0) a place is on, given `starts`. */
export function lineOf(starts: readonly number[], pos: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= pos) lo = mid; else hi = mid - 1;
  }
  return lo;
}

export const lineEnd = (text: string, starts: readonly number[], line: number): number => (line + 1 < starts.length ? starts[line + 1]! - 1 : text.length);

/** How far across the screen a place in a line is, in character widths, with tabs reaching the next stop. */
export function visualCol(line: string, col: number, tab = 2): number {
  let v = 0;
  for (let i = 0; i < col && i < line.length; i += 1) v = line[i] === '\t' ? v + tab - (v % tab) : v + 1;
  return v;
}

/** The place in a line nearest a distance across the screen, in character widths. */
export function colAt(line: string, v: number, tab = 2): number {
  let x = 0;
  for (let i = 0; i < line.length; i += 1) {
    const w = line[i] === '\t' ? tab - (x % tab) : 1;
    if (v < x + w / 2) return i;
    x += w;
  }
  return line.length;
}

// —— Moving the cursors ——

/** Each selection moved by `fn`; with `extend` its anchor stays, so the move selects. */
export function moveEach(state: DocState, fn: (s: Sel, i: number) => number, extend: boolean): DocState {
  const sels = state.sels.map((s, i) => {
    const head = fn(s, i);
    return extend ? { anchor: s.anchor, head } : cursor(head);
  });
  const n = normalize(sels, state.primary);
  return { ...state, sels: n.sels, primary: n.primary };
}

/** Left or right: a selection collapses to its edge first, as in every text field. */
export function moveH(state: DocState, dir: 1 | -1, extend: boolean, word: boolean): DocState {
  return moveEach(state, (s) => {
    if (!extend && s.anchor !== s.head && !word) return dir < 0 ? selFrom(s) : selTo(s);
    return word ? wordStep(state.text, s.head, dir) : Math.max(0, Math.min(state.text.length, s.head + dir));
  }, extend);
}

/**
 * Up or down `by` lines, keeping to the column each cursor was aiming for (`goals`, in screen columns) even across
 * shorter lines; past the first or last line goes to its start or end.
 */
export function moveV(state: DocState, by: number, extend: boolean, goals: readonly (number | null)[], tab = 2, /** The line `by` lines on from another, skipping folded ones; plain counting when not given. */ stepLine?: (line: number, by: number) => number): { state: DocState; goals: number[] } {
  const { text } = state;
  const starts = lineStarts(text);
  const kept: number[] = [];
  const sels = state.sels.map((s, i) => {
    const line = lineOf(starts, s.head);
    const lineText = text.slice(starts[line], lineEnd(text, starts, line));
    const goal = goals[i] ?? visualCol(lineText, s.head - starts[line]!, tab);
    kept.push(goal);
    const target = stepLine ? stepLine(line, by) : line + by;
    let head: number;
    if (target < 0) head = 0;
    else if (target >= starts.length) head = text.length;
    else {
      const t = text.slice(starts[target], lineEnd(text, starts, target));
      head = starts[target]! + colAt(t, goal, tab);
    }
    if (!extend && s.anchor !== s.head && Math.abs(by) === 1) {
      // As in VS Code: a selection collapses, then moves from the edge it is heading towards.
      const edge = by < 0 ? selFrom(s) : selTo(s);
      if (edge !== s.head) return cursor(head);
    }
    return extend ? { anchor: s.anchor, head } : cursor(head);
  });
  const n = normalize(sels, state.primary);
  return { state: { ...state, sels: n.sels, primary: n.primary }, goals: kept.slice(0, n.sels.length) };
}

/** Home: to the first character that is not a space, or, already there, to the very start of the line. */
export function home(state: DocState, extend: boolean): DocState {
  const starts = lineStarts(state.text);
  return moveEach(state, (s) => {
    const line = lineOf(starts, s.head);
    const start = starts[line]!;
    const indent = /^[ \t]*/.exec(state.text.slice(start, lineEnd(state.text, starts, line)))![0].length;
    return s.head === start + indent ? start : start + indent;
  }, extend);
}

export function end(state: DocState, extend: boolean): DocState {
  const starts = lineStarts(state.text);
  return moveEach(state, (s) => lineEnd(state.text, starts, lineOf(starts, s.head)), extend);
}

/** Just one cursor again: the primary selection's. */
export function single(state: DocState): DocState {
  const s = state.sels[state.primary] ?? state.sels[0]!;
  return { ...state, sels: [s.anchor === s.head || state.sels.length > 1 ? s : cursor(s.head)], primary: 0 };
}

export function selectAll(state: DocState): DocState {
  return { ...state, sels: [{ anchor: 0, head: state.text.length }], primary: 0 };
}

/** Ctrl+L: each selection grows to its whole lines; again, it takes the next line too. */
export function selectLine(state: DocState): DocState {
  const starts = lineStarts(state.text);
  const sels = state.sels.map((s) => {
    const a = lineOf(starts, selFrom(s));
    const b = lineOf(starts, selTo(s) > selFrom(s) && starts.includes(selTo(s)) ? selTo(s) - 1 : selTo(s));
    const whole = selFrom(s) === starts[a] && (selTo(s) === (starts[b + 1] ?? state.text.length));
    const last = whole ? Math.min(b + 1, starts.length - 1) : b;
    return { anchor: starts[a]!, head: starts[last + 1] ?? state.text.length };
  });
  const n = normalize(sels, state.primary);
  return { ...state, sels: n.sels, primary: n.primary };
}

/** The word around a place, as a double click picks it; an empty span where there is none. */
export function wordAt(text: string, at: number): [number, number] {
  let a = at;
  let b = at;
  while (a > 0 && isWord(text[a - 1])) a -= 1;
  while (b < text.length && isWord(text[b])) b += 1;
  return [a, b];
}

/**
 * Ctrl+D: a cursor first selects its word; after that, the next place the selected text appears (wrapping round) is
 * selected too, as a new cursor. Gives back the state unchanged when there is nowhere more.
 */
export function addNextMatch(state: DocState): DocState {
  const p = state.sels[state.primary]!;
  if (p.anchor === p.head) {
    const [a, b] = wordAt(state.text, p.head);
    if (a === b) return state;
    const sels = state.sels.map((s, i) => (i === state.primary ? { anchor: a, head: b } : s));
    const n = normalize(sels, state.primary);
    return { ...state, sels: n.sels, primary: n.primary };
  }
  const needle = state.text.slice(selFrom(p), selTo(p));
  const taken = (at: number) => state.sels.some((s) => selFrom(s) === at && selTo(s) === at + needle.length);
  let at = state.text.indexOf(needle, selTo(p));
  while (at >= 0 && taken(at)) at = state.text.indexOf(needle, at + 1);
  if (at < 0) {
    at = state.text.indexOf(needle);
    while (at >= 0 && taken(at)) at = state.text.indexOf(needle, at + 1);
  }
  if (at < 0) return state;
  const n = normalize([...state.sels, { anchor: at, head: at + needle.length }], state.sels.length);
  return { ...state, sels: n.sels, primary: n.primary };
}

/** Ctrl+Alt+Up or Down: a new cursor on the line above or below the primary one, at the same column. */
export function addCursorV(state: DocState, by: 1 | -1, tab = 2): DocState {
  const p = state.sels[state.primary]!;
  const moved = moveV({ ...state, sels: [cursor(p.head)], primary: 0 }, by, false, [null], tab).state.sels[0]!;
  if (moved.head === p.head) return state;
  const n = normalize([...state.sels, moved], state.sels.length);
  return { ...state, sels: n.sels, primary: n.primary };
}

// —— Whole lines ——

/** The lines (from 0) each selection covers, joined where they touch, in order. */
function lineBlocks(state: DocState, starts: readonly number[]): [number, number][] {
  const blocks: [number, number][] = [];
  for (const s of state.sels) {
    const a = lineOf(starts, selFrom(s));
    // A selection that ends at the start of a line does not take that line.
    const to = selTo(s) > selFrom(s) && starts[lineOf(starts, selTo(s))] === selTo(s) ? selTo(s) - 1 : selTo(s);
    const b = lineOf(starts, to);
    const last = blocks[blocks.length - 1];
    if (last && a <= last[1] + 1) last[1] = Math.max(last[1], b); else blocks.push([a, b]);
  }
  return blocks;
}

/**
 * Alt+Up or Down: the lines each selection covers swap with the line above or below, and the selections go with
 * them. Nothing moves when a block is already at the top or bottom.
 */
export function moveLines(state: DocState, dir: 1 | -1): Step | null {
  const { text } = state;
  const starts = lineStarts(text);
  const blocks = lineBlocks(state, starts);
  if (dir < 0 ? blocks[0]![0] === 0 : blocks[blocks.length - 1]![1] === starts.length - 1) return null;
  const changes: Change[] = [];
  const shifts: { from: number; to: number; by: number }[] = [];
  for (const [a, b] of blocks) {
    const other = dir < 0 ? a - 1 : b + 1;
    const lo = Math.min(a, other);
    const hi = Math.max(b, other);
    const from = starts[lo]!;
    const to = lineEnd(text, starts, hi);
    const block = text.slice(starts[a], lineEnd(text, starts, b));
    const line = text.slice(starts[other], lineEnd(text, starts, other));
    changes.push({ from, to, insert: dir < 0 ? `${block}\n${line}` : `${line}\n${block}` });
    shifts.push({ from: starts[a]!, to: lineEnd(text, starts, b), by: dir < 0 ? -(line.length + 1) : line.length + 1 });
  }
  const tidied = tidy(changes);
  if (tidied.length !== changes.length) return null;
  const next = applyChanges(text, changes);
  const sels = state.sels.map((s) => {
    const shift = shifts.find((x) => selFrom(s) >= x.from && selTo(s) <= x.to + 1)?.by ?? 0;
    return { anchor: s.anchor + shift, head: s.head + shift };
  });
  return { state: { text: next, sels, primary: state.primary }, changes };
}

/** Shift+Alt+Up or Down: the lines each selection covers are copied above or below, and the selections go to the copy below (or stay, going up). */
export function copyLines(state: DocState, dir: 1 | -1): Step {
  const { text } = state;
  const starts = lineStarts(text);
  const blocks = lineBlocks(state, starts);
  const changes: Change[] = blocks.map(([a, b]) => {
    const at = lineEnd(text, starts, b);
    return { from: at, to: at, insert: `\n${text.slice(starts[a], at)}` };
  });
  const next = applyChanges(text, changes);
  const sels = state.sels.map((s) => {
    if (dir < 0) return { anchor: mapPos(s.anchor, changes, false), head: mapPos(s.head, changes, false) };
    const blockIdx = blocks.findIndex(([a, b]) => lineOf(starts, selFrom(s)) >= a && lineOf(starts, selFrom(s)) <= b);
    const [a, b] = blocks[blockIdx]!;
    const by = lineEnd(text, starts, b) - starts[a]! + 1;
    return { anchor: mapPos(s.anchor, changes, false) + by, head: mapPos(s.head, changes, false) + by };
  });
  return { state: { text: next, sels, primary: state.primary }, changes };
}

/** Ctrl+Shift+K: the lines each selection covers are deleted, the cursor going to the line that takes their place. */
export function deleteLines(state: DocState): Step {
  const { text } = state;
  const starts = lineStarts(text);
  const blocks = lineBlocks(state, starts);
  const changes: Change[] = blocks.map(([a, b]) => {
    const last = b === starts.length - 1;
    if (last && a > 0) return { from: starts[a]! - 1, to: text.length, insert: '' };
    return { from: starts[a]!, to: last ? text.length : starts[b + 1]!, insert: '' };
  });
  const next = applyChanges(text, changes);
  const nextStarts = lineStarts(next);
  const sels = changes.map((c) => {
    const at = Math.min(mapPos(c.from, changes, false) + (c.from > 0 && next[mapPos(c.from, changes, false) - 1] !== '\n' && c.to === text.length ? 1 : 0), next.length);
    return cursor(Math.min(at, lineEnd(next, nextStarts, lineOf(nextStarts, at))));
  });
  const n = normalize(sels);
  return { state: { text: next, sels: n.sels, primary: n.primary }, changes };
}

// —— Undo ——

interface Entry { original: string; changes: Change[]; before: { sels: Sel[]; primary: number }; after: { sels: Sel[]; primary: number }; kind: string; time: number }

/**
 * What can be undone and redone, as the spans each change replaced, so a long file is not copied for every key.
 * Typing (or deleting) in one run is one step, as in VS Code: a pause, a move or another kind of change starts the next.
 */
export class History {
  private done: Entry[] = [];
  private undone: Entry[] = [];
  private sealed = true;
  constructor(private readonly max = 500) {}

  /** Keeps a change made to `before`; `kind` 'type' and 'delete' join the step before them when they follow on. */
  record(before: DocState, step: Step, kind: string, now = Date.now()): void {
    if (step.changes.length === 0) return;
    const last = this.done[this.done.length - 1];
    const join = !this.sealed && last !== undefined && last.kind === kind && (kind === 'type' || kind === 'delete') && now - last.time < 1500;
    if (join) {
      // Folded in by keeping both steps' changes as one: undo puts back the earlier text in one go.
      last.changes = composeLater(before.text, last, step.changes);
      last.after = { sels: step.state.sels, primary: step.state.primary };
      last.time = now;
    } else {
      this.done.push({ changes: step.changes, before: { sels: before.sels, primary: before.primary }, after: { sels: step.state.sels, primary: step.state.primary }, kind, time: now, original: before.text });
      if (this.done.length > this.max) this.done.shift();
    }
    this.undone = [];
    this.sealed = false;
  }

  /** The next change starts a new step (after a move or a click). */
  seal(): void { this.sealed = true; }

  undo(state: DocState): DocState | null {
    const e = this.done.pop();
    if (!e) return null;
    this.undone.push(e);
    this.sealed = true;
    const back = invertChanges(e.original, e.changes);
    return { text: applyChanges(state.text, back), sels: e.before.sels, primary: e.before.primary };
  }

  redo(state: DocState): DocState | null {
    const e = this.undone.pop();
    if (!e) return null;
    this.done.push(e);
    this.sealed = true;
    return { text: applyChanges(state.text, e.changes), sels: e.after.sels, primary: e.after.primary };
  }

  clear(): void { this.done = []; this.undone = []; this.sealed = true; }
  get canUndo(): boolean { return this.done.length > 0; }
  get canRedo(): boolean { return this.undone.length > 0; }
}

/**
 * Two steps as one: the first step's changes (on its original text) followed by `later` (on the text after it),
 * given as one span on the original text that covers both, which is simple and exact.
 */
function composeLater(currentBefore: string, first: Entry, later: readonly Change[]): Change[] {
  const { original } = first;
  const mid = currentBefore;
  const after = applyChanges(mid, later);
  // The smallest span where `original` and `after` differ.
  let a = 0;
  while (a < original.length && a < after.length && original[a] === after[a]) a += 1;
  let b = 0;
  while (b < original.length - a && b < after.length - a && original[original.length - 1 - b] === after[after.length - 1 - b]) b += 1;
  return [{ from: a, to: original.length - b, insert: after.slice(a, after.length - b) }];
}

// —— Brackets ——

const OPENERS: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
const CLOSERS: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
/** How far a bracket's partner is looked for, so a key press in a huge file stays quick. */
const BRACKET_REACH = 20_000;

/**
 * The bracket next to a cursor and its partner, as VS Code boxes them: the one just after the cursor first, else the
 * one just before. Brackets of the same kind in between are counted; null when there is none or no partner in reach.
 */
export function matchBracket(text: string, at: number): [number, number] | null {
  for (const p of [at, at - 1]) {
    const ch = text[p];
    if (ch === undefined) continue;
    const close = OPENERS[ch];
    const open = CLOSERS[ch];
    if (close === undefined && open === undefined) continue;
    const dir = close !== undefined ? 1 : -1;
    const same = ch;
    const other = close ?? open!;
    let depth = 0;
    for (let i = p + dir, n = 0; i >= 0 && i < text.length && n < BRACKET_REACH; i += dir, n += 1) {
      const c = text[i];
      if (c === same) depth += 1;
      else if (c === other) {
        if (depth === 0) return dir > 0 ? [p, i] : [i, p];
        depth -= 1;
      }
    }
    return null;
  }
  return null;
}

/** Every match (start, end) with the same changes made as one step: `insert` for each, cursors left after them. */
export function replaceSpans(state: DocState, spans: readonly [number, number][], inserts: readonly string[]): Step {
  const changes = spans.map(([from, to], i) => ({ from, to, insert: inserts[i] ?? '' }));
  const text = applyChanges(state.text, changes);
  const p = state.sels[state.primary]!;
  const sels = [{ anchor: mapPos(p.anchor, changes), head: mapPos(p.head, changes) }];
  return { state: { text, sels, primary: 0 }, changes };
}

// —— Folding ——

/**
 * The regions that can be folded, by indentation as VS Code does for most languages: a line followed by more
 * indented lines starts one, ending at the last of them (blank lines at its end left out), so a closing bracket on a
 * line of its own stays in view. As start line → end line, both from 0.
 */
export function foldRegions(lines: readonly string[], tab = 2): Map<number, number> {
  const out = new Map<number, number>();
  const stack: { line: number; indent: number }[] = [];
  let lastText = -1;
  const close = (indent: number) => {
    while (stack.length > 0 && stack[stack.length - 1]!.indent >= indent) {
      const s = stack.pop()!;
      if (lastText > s.line) out.set(s.line, lastText);
    }
  };
  lines.forEach((l, i) => {
    if (l.trim() === '') return;
    const indent = visualCol(l, /^[ \t]*/.exec(l)![0].length, tab);
    close(indent);
    stack.push({ line: i, indent });
    lastText = i;
  });
  close(-1);
  return out;
}

/** Which lines are shown, in order, with `folded` (start lines) closed; and each line's row on screen, -1 when hidden. */
export function visibleRows(count: number, regions: ReadonlyMap<number, number>, folded: ReadonlySet<number>): { rows: number[]; rowOf: Int32Array } {
  const rows: number[] = [];
  const rowOf = new Int32Array(count).fill(-1);
  for (let i = 0; i < count; i += 1) {
    rowOf[i] = rows.length;
    rows.push(i);
    const end = folded.has(i) ? regions.get(i) : undefined;
    if (end !== undefined) i = end;
  }
  return { rows, rowOf };
}

/** The folded regions (start lines) that hide `line`, so a cursor sent there can open them. */
export function foldsHiding(line: number, regions: ReadonlyMap<number, number>, folded: ReadonlySet<number>): number[] {
  return [...folded].filter((s) => s < line && (regions.get(s) ?? -1) >= line);
}

/**
 * The scopes the top of the view is inside, outermost first, as sticky scroll shows them: each region that starts
 * above `top` and runs past it. At most `max`, keeping the innermost.
 */
export function stickyScopes(top: number, regions: ReadonlyMap<number, number>, max = 5): number[] {
  const out: number[] = [];
  for (const [start, end] of regions) if (start < top && end >= top) out.push(start);
  out.sort((a, b) => a - b);
  return out.slice(-max);
}
