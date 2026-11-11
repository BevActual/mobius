import { RowMark } from './RowMark';
import { EmptyState } from './EmptyState';
import { useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { CellChange } from '@mobius/shared';
import { onCommand } from './commands';
import { KEPT_EVENT, keepTurn, keptTurns, turnId } from './ReviewStrip';
import { cellName, changedCells, closeFormula, hasFooter, columnName, FUNCTIONS, fillSeries, inRange, isError, isNumeric, jump, numberIn, parseCsv, pasted, quickTarget, rangeName, rangeOf, rangeSize, refsIn, selectionStats, shiftFormula, sortedRows, statNumber, toTsv, typingFunction, wantsRef, type Range } from './sheets-view';
import './sheets.css';
import type { SheetsState } from './useSheets';
import { ReviewActions, WhyThis } from './ReviewBar';
import { SideNew, type Start } from './SideNew';
import { FromMobius } from './FromMobius';

const NEW_WORKBOOK = 'mobius-sheets-new-workbook';
/** Whether a sidebar is shown to ask for the name; with the sidebar hidden, the workbook is made as "Workbook". */
let namers = 0;

/** The workbooks, each with its sheets. */
export function SheetsSidebar({ sheets, pin, changed, starts, onStart }: { sheets: SheetsState; pin?: ReactNode; changed?: ReadonlySet<string>; starts?: readonly Start[]; onStart?: (prompt: string) => void }) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  // Every New workbook asks for its name here, with "Workbook" chosen so typing replaces it.
  const startNaming = () => { setName('Workbook'); setNaming(true); };
  // A workbook Mobius changed in its last turn opens when none is, once, so a visit after asking lands on it.
  const offered = useRef(false);
  useEffect(() => {
    if (offered.current || here || !changed?.size) return;
    const book = sheets.workbooks.find((w) => changed.has(w.name));
    if (!book) return;
    offered.current = true;
    sheets.openIfIdle(book.name, book.sheets[0] ?? 'Sheet 1');
  }, [changed, sheets.workbooks]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const go = () => startNaming(); namers++; window.addEventListener(NEW_WORKBOOK, go); return () => { namers--; window.removeEventListener(NEW_WORKBOOK, go); }; }, []);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (await sheets.createWorkbook(name.trim() || 'Workbook')) { setNaming(false); setName(''); }
  };
  const here = sheets.data;
  // Search matches a workbook's name or the name of one of its sheets.
  const q = query.trim().toLowerCase();
  const shownBooks = q ? sheets.workbooks.filter((w) => w.name.toLowerCase().includes(q) || w.sheets.some((s) => s.toLowerCase().includes(q))) : sheets.workbooks;
  return (
    <aside className="side sheets-side" aria-label="Sheets sidebar">
      <div className="side-head">
        <span className="side-title" title="Workbooks are kept as CSV files in your workspace, one for each sheet, so any spreadsheet app can open them.">Workbooks</span>
        <span className="side-actions">
          {pin}
        </span>
      </div>
      {naming && (
        <form className="notes-name" onSubmit={(e) => void submit(e)}>
          <input autoFocus onFocus={(e) => e.currentTarget.select()} aria-label="Workbook name" placeholder="Workbook name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setNaming(false); }} />
          <button type="submit" className="btn primary">Create</button>
        </form>
      )}
      <SideNew item="workbook" onNew={startNaming} {...(starts ? { starts } : {})} {...(onStart ? { onStart } : {})} />
      <input className="side-search" type="search" aria-label="Search sheets" placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} />
      <nav className="task-lists" aria-label="Workbooks">
        {sheets.workbooks.length === 0 && !naming && <p className="side-empty">No workbooks yet.</p>}
        {query.trim() && shownBooks.length === 0 && <p className="side-empty">No workbooks match.</p>}
        <ul role="list">
          {shownBooks.map((w) => (
            <li key={w.name}>
              <button type="button" className="list-row" data-proposed={changed?.has(w.name) || undefined} aria-current={here?.workbook === w.name ? 'page' : undefined} onClick={() => void sheets.open(w.name, here?.workbook === w.name ? here.sheet : w.sheets[0] ?? 'Sheet 1')}>
                <span className="list-name">{w.name}</span>
                <RowMark changed={changed?.has(w.name) === true} changedTitle="Changed by Mobius in its last turn" />
                {!changed?.has(w.name) && <span className="list-count">{w.sheets.length > 1 ? w.sheets.length : ''}</span>}
              </button>
            </li>
          ))}
        </ul>
        <FromMobius items={sheets.workbooks.filter((w) => changed?.has(w.name)).map((w) => ({ key: w.name, name: w.name, current: here?.workbook === w.name, onOpen: () => void sheets.open(w.name, w.sheets[0] ?? 'Sheet 1') }))} />
      </nav>
    </aside>
  );
}

type Pos = { r: number; c: number };
type Change = CellChange;
/** One step to undo: cells as they were and became, or a row or column put in or taken out (with what it held). */
type Step = { kind: 'cells'; before: Change[]; after: Change[] } | { kind: 'shift'; what: 'row' | 'column'; at: number; insert: boolean; held: Change[] };
/** A cell being typed in, in the cell itself or in the formula bar, and where the caret is. */
type Edit = { at: Pos; text: string; where: 'cell' | 'bar'; caret: number };

const ROW_H = 24;
const HEAD_H = 22;
const COL_W = 104;
/** The widest a column grows to fit its words by itself. */
const FIT_MAX = 260;
const REF_COLORS = ['#0a84ff', '#ff9f0a', '#30d158', '#bf5af2', '#ff375f', '#64d2ff'];
const keep = (e: { preventDefault: () => void }) => e.preventDefault();

/** Per sheet, kept on this device: column widths, and whether the first row is a header. */
const WIDTHS_KEY = 'mobius.sheets.widths';
const HEADER_KEY = 'mobius.sheets.header';
function readKept<T>(key: string): Record<string, T> {
  try { const v: unknown = JSON.parse(window.localStorage.getItem(key) ?? '{}'); return typeof v === 'object' && v !== null ? v as Record<string, T> : {}; } catch { return {}; }
}
function writeKept<T>(key: string, place: string, value: T | undefined) {
  try {
    const all = readKept<T>(key);
    if (value === undefined) delete all[place]; else all[place] = value;
    window.localStorage.setItem(key, JSON.stringify(all));
  } catch { /* Not kept. */ }
}
/** A first row of words over rows with numbers reads as a header, until the person says otherwise. */
function looksLikeHeader(values: readonly (readonly string[])[]): boolean {
  const first = values[0] ?? [];
  if (!first.some((v) => v !== '') || !first.every((v) => v === '' || numberIn(v) === null)) return false;
  const rest = values.slice(1).filter((row) => row.some((v) => v !== ''));
  if (rest.some((row) => row.some((v) => numberIn(v) !== null))) return true;
  // A table of words: a first row of two or more short labels over at least two rows reads as a header too.
  const labels = first.filter((v) => v !== '');
  return labels.length >= 2 && labels.every((v) => v.length <= 24) && rest.length >= 2;
}
/** Each column's width to fit what is in it, between the usual width and a wide one; worked out once per sheet as read. */
const fits = new WeakMap<object, { header: boolean; widths: number[] }>();
function fittedWidths(values: readonly (readonly string[])[], header: boolean): number[] {
  const kept = fits.get(values);
  if (kept && kept.header === header) return kept.widths;
  const rows = values.slice(0, 400);
  const cols = Math.max(0, ...rows.map((r) => r.length));
  const widths = Array.from({ length: cols }, (_, c) => Math.round(Math.min(FIT_MAX, Math.max(COL_W, ...rows.map((r, i) => textWidth(r[c] ?? '', header && i === 0) + 18)))));
  fits.set(values, { header, widths });
  return widths;
}
let measurer: CanvasRenderingContext2D | null = null;
function textWidth(text: string, bold = false): number {
  measurer ??= document.createElement('canvas').getContext('2d');
  if (!measurer) return text.length * 7;
  measurer.font = `${bold ? 600 : 400} 13px -apple-system, "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif`;
  return measurer.measureText(text).width;
}

/** The innermost function the caret sits in the brackets of, for the hint under the formula. */
function functionAround(text: string, caret: number): (typeof FUNCTIONS)[number] | null {
  let depth = 0;
  for (let i = caret - 1; i >= 0; i--) {
    const ch = text[i];
    if (ch === ')') depth++;
    else if (ch === '(') {
      if (depth === 0) {
        const m = /([A-Za-z]+)$/.exec(text.slice(0, i));
        return m ? FUNCTIONS.find((f) => f.name === m[1]!.toUpperCase()) ?? null : null;
      }
      depth--;
    }
  }
  return null;
}

/** A menu from a toolbar button, drawn above everything. */
function ToolMenu({ label, button, title, children, wide }: { label: string; button: ReactNode; title: string; children: (close: () => void) => ReactNode; wide?: boolean }) {
  const [open, setOpen] = useState(false);
  const at = useRef<HTMLButtonElement>(null);
  const r = open ? at.current?.getBoundingClientRect() : undefined;
  const width = wide ? 240 : 200;
  return (
    <>
      <button ref={at} type="button" className="sheet-tool" aria-label={label} title={title} aria-haspopup="menu" aria-expanded={open} onMouseDown={keep} onClick={() => setOpen((o) => !o)}>{button}</button>
      {open && r && createPortal(
        <>
          <div className="sheet-scrim" onMouseDown={() => setOpen(false)} />
          <div className="sheet-menu" role="menu" aria-label={label} style={{ top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)), minWidth: width }} onKeyDown={(e) => { if (e.key === 'Escape') { setOpen(false); at.current?.focus(); } }}>
            {children(() => setOpen(false))}
          </div>
        </>,
        document.body,
      )}
    </>
  );
}

function Item({ onPick, children, keys, disabled, danger, checked }: { onPick: () => void; children: ReactNode; keys?: string; disabled?: boolean; danger?: boolean; checked?: boolean }) {
  return (
    <button type="button" role={checked === undefined ? 'menuitem' : 'menuitemcheckbox'} aria-checked={checked} className="sheet-menu-item" data-danger={danger || undefined} disabled={disabled} onMouseDown={keep} onClick={onPick}>
      <span className="sheet-menu-check" aria-hidden="true">{checked ? '✓' : ''}</span>
      <span className="sheet-menu-label">{children}</span>
      {keys && <kbd>{keys}</kbd>}
    </button>
  );
}
const Sep = () => <div className="sheet-menu-sep" role="separator" />;

const Icon = ({ d }: { d: string }) => <svg viewBox="0 0 20 20" aria-hidden="true"><path d={d} /></svg>;
const ICONS = {
  undo: 'M7.5 5.5 4 9l3.5 3.5M4.5 9H12a4 4 0 0 1 0 8h-2',
  redo: 'M12.5 5.5 16 9l-3.5 3.5M15.5 9H8a4 4 0 0 0 0 8h2',
  sum: 'M14.5 4.5h-9l5 5.5-5 5.5h9',
  table: 'M3.5 4.5h13v11h-13zM3.5 8.5h13M3.5 12h13M8 4.5v11',
  sort: 'M6 4v12M3.5 13.5 6 16l2.5-2.5M11 6h6M11 10h4.5M11 14h3',
  header: 'M3.5 4.5h13v11h-13zM3.5 8h13',
};

/** The open sheet: a grid of cells, the formula bar above it, and its sheets as tabs below. */
export function SheetGrid({ sheets, review }: { sheets: SheetsState; review?: { conversation: string } | null }) {
  const data = sheets.data;
  const [anchor, setAnchor] = useState<Pos>({ r: 0, c: 0 });
  const [focus, setFocus] = useState<Pos>({ r: 0, c: 0 });
  const [edit, setEdit] = useState<Edit | null>(null);
  // The reference a click while typing a formula put in, so a drag or another click replaces it.
  const [pick, setPick] = useState<{ start: number; end: number; from: Pos } | null>(null);
  const [fillTo, setFillTo] = useState<Pos | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [suggest, setSuggest] = useState(0);
  const [, setTick] = useState(0);
  const drag = useRef<'select' | 'ref' | 'fill' | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const cellInput = useRef<HTMLInputElement>(null);
  const barInput = useRef<HTMLInputElement>(null);
  const caretTo = useRef<number | null>(null);
  const clip = useRef<{ tsv: string; cells: string[][]; at: Pos } | null>(null);
  const history = useRef(new Map<string, { undo: Step[]; redo: Step[] }>());
  const place = data ? `${data.workbook}/${data.sheet}` : '';
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [header, setHeader] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    setWidths(readKept<Record<string, number>>(WIDTHS_KEY)[place] ?? {});
    setHeader(readKept<boolean>(HEADER_KEY)[place]);
  }, [place]);

  const raw = (r: number, c: number) => data?.cells[r]?.[c] ?? '';
  const shown = (r: number, c: number) => data?.values[r]?.[c] ?? '';
  const sel = rangeOf(anchor, focus);
  const select = (a: Pos, b: Pos = a) => { setAnchor(a); setFocus(b); };
  useEffect(() => { select({ r: 0, c: 0 }); setEdit(null); setPick(null); }, [data?.workbook, data?.sheet]);
  useEffect(() => { if (edit?.where === 'cell') cellInput.current?.focus(); }, [edit?.where, edit?.at.r, edit?.at.c]); // eslint-disable-line react-hooks/exhaustive-deps
  // After a reference or a function is put in, the caret goes after it.
  useLayoutEffect(() => {
    if (caretTo.current === null) return;
    const input = edit?.where === 'bar' ? barInput.current : cellInput.current;
    input?.setSelectionRange(caretTo.current, caretTo.current);
    caretTo.current = null;
  });
  // The cell that moves stays in view.
  useEffect(() => { grid.current?.querySelector<HTMLElement>(`[data-cell="${focus.r}:${focus.c}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [focus]);
  useEffect(() => {
    const up = () => {
      if (drag.current === 'fill') finishFill();
      drag.current = null;
    };
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  });

  // What the agent's last turn changed in this sheet, marked until kept or discarded.
  const [changed, setChanged] = useState<Set<string>>(new Set());
  const [kept, setKept] = useState(false);
  const file = data ? `sheets/${data.workbook}/${data.sheet}.csv` : null;
  useEffect(() => {
    let live = true;
    const check = async () => {
      if (!review) { setKept(false); return; }
      const last = await window.mobius.changes?.lastTurn(review.conversation).catch(() => null);
      const id = last && 'checkpoint' in last ? turnId(review.conversation, last.checkpoint) : null;
      if (live) setKept(id !== null && keptTurns().includes(id));
    };
    void check();
    window.addEventListener(KEPT_EVENT, check);
    return () => { live = false; window.removeEventListener(KEPT_EVENT, check); };
    // Checked again when the sheet changes: a new turn's change is not kept yet.
  }, [review?.conversation, file, data?.version]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let live = true;
    if (!review || kept || !file || !data) { setChanged(new Set()); return; }
    void window.mobius.changes.before(review.conversation, file).then((was) => {
      if (!live) return;
      setChanged(was && was.ok && was.text !== null ? changedCells(parseCsv(was.text), data.cells) : new Set(data.cells.flatMap((row, r) => row.map((t, c) => (t ? `${r}:${c}` : '')).filter(Boolean))));
    }).catch(() => {});
    return () => { live = false; };
  }, [review?.conversation, kept, file, data?.version]); // eslint-disable-line react-hooks/exhaustive-deps
  const keepAll = async () => {
    if (!review) return;
    const last = await window.mobius.changes?.lastTurn(review.conversation).catch(() => null);
    const id = last && 'checkpoint' in last ? turnId(review.conversation, last.checkpoint) : null;
    if (id) keepTurn(id);
    setKept(true);
  };
  const discardAll = async () => {
    if (!review || !file) return;
    await window.mobius.changes.undoFile(review.conversation, file).catch(() => null);
    setChanged(new Set());
    await sheets.reload();
  };

  // Undo from the app's menus as well as the keys.
  useEffect(() => onCommand('undo', () => { if (!edit && data) void undo(); }));
  useEffect(() => onCommand('redo', () => { if (!edit && data) void redo(); }));

  if (!data) {
    return (
      <section className="sheet-page empty" aria-label="Sheet">
        <EmptyState app="sheets" label="No workbook open" title={sheets.workbooks.length ? 'No workbook open' : 'No workbooks yet'} line="Choose one on the left, or start a new one." action={{ label: 'New workbook', run: () => { if (namers > 0) window.dispatchEvent(new Event(NEW_WORKBOOK)); else void sheets.createWorkbook('Workbook'); } }} />
      </section>
    );
  }

  const used = { rows: data.cells.length, cols: Math.max(0, ...data.cells.map((r) => r.length)) };
  const width = Math.min(52, Math.max(10, used.cols + 3, focus.c + 2, fillTo ? fillTo.c + 2 : 0));
  const height = Math.max(40, used.rows + 20, focus.r + 10, fillTo ? fillTo.r + 5 : 0);
  const headerOn = header ?? looksLikeHeader(data.values);
  // A column the person has not sized fits its words, so names and labels are not cut short.
  const fitted = fittedWidths(data.values, headerOn);
  const colWidth = (c: number) => widths[c] ?? fitted[c] ?? COL_W;
  const steps = history.current.get(place) ?? { undo: [], redo: [] };
  history.current.set(place, steps);

  // ---------- Changing cells, with undo ----------
  const apply = async (changes: Change[], record = true) => {
    const real = changes.filter((ch) => ch.text !== raw(ch.row, ch.col));
    if (real.length === 0) return;
    if (record) {
      steps.undo.push({ kind: 'cells', before: real.map((ch) => ({ ...ch, text: raw(ch.row, ch.col) })), after: real });
      steps.redo = [];
      setTick((t) => t + 1);
    }
    await sheets.set(real);
  };
  const shiftAt = async (what: 'row' | 'column', at: number, insert: boolean, record = true) => {
    const held: Change[] = [];
    if (!insert) {
      if (what === 'row') (data.cells[at] ?? []).forEach((text, col) => { if (text) held.push({ row: at, col, text }); });
      else data.cells.forEach((row, r) => { const text = row[at] ?? ''; if (text) held.push({ row: r, col: at, text }); });
    }
    if (record) { steps.undo.push({ kind: 'shift', what, at, insert, held }); steps.redo = []; setTick((t) => t + 1); }
    await sheets.shift(what, at, insert);
  };
  const run = async (step: Step, back: boolean) => {
    if (step.kind === 'cells') { await sheets.set(back ? step.before : step.after); return; }
    const insert = back ? !step.insert : step.insert;
    await sheets.shift(step.what, step.at, insert);
    if (insert && step.held.length) await sheets.set(step.held);
  };
  async function undo() {
    const step = steps.undo.pop();
    if (!step) return;
    steps.redo.push(step);
    setTick((t) => t + 1);
    await run(step, true);
  }
  async function redo() {
    const step = steps.redo.pop();
    if (!step) return;
    steps.undo.push(step);
    setTick((t) => t + 1);
    await run(step, false);
  }

  // ---------- Typing ----------
  const startEdit = (text: string, where: 'cell' | 'bar' = 'cell') => {
    setEdit({ at: focus, text, where, caret: text.length });
    setPick(null);
    setSuggest(0);
    if (focus.r !== anchor.r || focus.c !== anchor.c) setAnchor(focus);
  };
  const commit = (then: Pos | null) => {
    if (!edit) return;
    const { at, text } = edit;
    setEdit(null);
    setPick(null);
    void apply([{ row: at.r, col: at.c, text: closeFormula(text) }]);
    if (then) select(then);
    grid.current?.focus();
  };
  const cancel = () => { setEdit(null); setPick(null); grid.current?.focus(); };
  const typed = (text: string, caret: number) => { setEdit((e) => (e ? { ...e, text, caret } : e)); setPick(null); setSuggest(0); };
  const fnTyping = edit ? typingFunction(edit.text, edit.caret) : null;
  const fnMatches = fnTyping ? FUNCTIONS.filter((f) => f.name.startsWith(fnTyping.word.toUpperCase())) : [];
  const fnHint = edit && !fnMatches.length ? functionAround(edit.text, edit.caret) : null;
  const putFunction = (name: string) => {
    if (!edit || !fnTyping) return;
    const text = `${edit.text.slice(0, fnTyping.start)}${name}(${edit.text.slice(edit.caret)}`;
    const caret = fnTyping.start + name.length + 1;
    caretTo.current = caret;
    setEdit({ ...edit, text, caret });
    setSuggest(0);
  };
  const putRef = (from: Pos, to: Pos) => {
    if (!edit) return;
    const name = rangeName(rangeOf(from, to));
    const start = pick ? pick.start : edit.caret;
    const end = pick ? pick.end : edit.caret;
    const text = edit.text.slice(0, start) + name + edit.text.slice(end);
    caretTo.current = start + name.length;
    setEdit({ ...edit, text, caret: start + name.length });
    setPick({ start, end: start + name.length, from });
  };
  const canPick = () => edit !== null && (wantsRef(edit.text, edit.caret) || (pick !== null && edit.caret === pick.end));
  const onEditorKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (fnMatches.length) {
      if (e.key === 'ArrowDown') { setSuggest((i) => (i + 1) % fnMatches.length); e.preventDefault(); return; }
      if (e.key === 'ArrowUp') { setSuggest((i) => (i - 1 + fnMatches.length) % fnMatches.length); e.preventDefault(); return; }
      if (e.key === 'Tab' || (e.key === 'Enter' && fnTyping && fnTyping.word.length > 0 && fnMatches.length > 0 && fnMatches[0]!.name !== fnTyping.word.toUpperCase())) { putFunction(fnMatches[suggest % fnMatches.length]!.name); e.preventDefault(); return; }
    }
    if (!edit) return;
    if (e.key === 'Enter') { commit({ r: Math.max(0, edit.at.r + (e.shiftKey ? -1 : 1)), c: edit.at.c }); e.preventDefault(); } else if (e.key === 'Tab') { commit({ r: edit.at.r, c: Math.max(0, edit.at.c + (e.shiftKey ? -1 : 1)) }); e.preventDefault(); } else if (e.key === 'Escape') { cancel(); e.preventDefault(); }
  };
  const caretOf = (el: HTMLInputElement) => el.selectionStart ?? el.value.length;

  // ---------- Selecting, filling and clipboard ----------
  const valuesIn = (g: Range) => {
    const out: string[] = [];
    for (let r = g.r0; r <= g.r1; r++) for (let c = g.c0; c <= g.c1; c++) out.push(shown(r, c));
    return out;
  };
  const block = (g: Range, of: (r: number, c: number) => string) => Array.from({ length: g.r1 - g.r0 + 1 }, (_, i) => Array.from({ length: g.c1 - g.c0 + 1 }, (_, j) => of(g.r0 + i, g.c0 + j)));
  const clearRange = (g: Range) => {
    const out: Change[] = [];
    for (let r = g.r0; r <= g.r1; r++) for (let c = g.c0; c <= g.c1; c++) if (raw(r, c)) out.push({ row: r, col: c, text: '' });
    void apply(out);
  };
  const copyRange = (g: Range, e?: ClipboardEvent<HTMLDivElement>) => {
    const values = block(g, shown);
    const tsv = toTsv(values);
    clip.current = { tsv, cells: block(g, raw), at: { r: g.r0, c: g.c0 } };
    if (e) {
      e.clipboardData.setData('text/plain', tsv);
      const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
      e.clipboardData.setData('text/html', `<table>${values.map((row) => `<tr>${row.map((v) => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</table>`);
      e.preventDefault();
    } else void navigator.clipboard?.writeText(tsv).catch(() => {});
  };
  const pasteText = (text: string) => {
    const at = { r: sel.r0, c: sel.c0 };
    const mine = clip.current && clip.current.tsv === text.replace(/\r\n?/g, '\n').replace(/\n$/, '') ? clip.current : null;
    let changes: Change[];
    if (mine) changes = mine.cells.flatMap((row, i) => row.map((t, j) => ({ row: at.r + i, col: at.c + j, text: shiftFormula(t, at.r - mine.at.r, at.c - mine.at.c) })));
    else changes = pasted(text, at.r, at.c);
    // One value pasted over a block fills the block.
    if (changes.length === 1 && rangeSize(sel) > 1) {
      const one = changes[0]!;
      changes = [];
      for (let r = sel.r0; r <= sel.r1; r++) for (let c = sel.c0; c <= sel.c1; c++) changes.push({ row: r, col: c, text: shiftFormula(one.text, r - at.r, c - at.c) });
    }
    void apply(changes);
    const last = changes.reduce((m, ch) => ({ r: Math.max(m.r, ch.row), c: Math.max(m.c, ch.col) }), at);
    select(at, last);
  };
  /** Ctrl+D and Ctrl+R: the first row (or column) of the block copied over the rest, references moving along. */
  const fillOver = (along: 'down' | 'right') => {
    const g = along === 'down' && sel.r0 === sel.r1 ? { ...sel, r0: Math.max(0, sel.r0 - 1) } : along === 'right' && sel.c0 === sel.c1 ? { ...sel, c0: Math.max(0, sel.c0 - 1) } : sel;
    const out: Change[] = [];
    for (let r = g.r0; r <= g.r1; r++) {
      for (let c = g.c0; c <= g.c1; c++) {
        if (along === 'down' && r > g.r0) out.push({ row: r, col: c, text: shiftFormula(raw(g.r0, c), r - g.r0, 0) });
        if (along === 'right' && c > g.c0) out.push({ row: r, col: c, text: shiftFormula(raw(r, g.c0), 0, c - g.c0) });
      }
    }
    void apply(out);
  };
  const fillReach = (p: Pos): Pos | null => {
    const down = p.r - sel.r1;
    const right = p.c - sel.c1;
    if (down <= 0 && right <= 0) return null;
    return down >= right ? { r: p.r, c: sel.c1 } : { r: sel.r1, c: p.c };
  };
  function finishFill() {
    const to = fillTo;
    setFillTo(null);
    if (!to) return;
    const out: Change[] = [];
    if (to.r > sel.r1) {
      for (let c = sel.c0; c <= sel.c1; c++) {
        const seed = Array.from({ length: sel.r1 - sel.r0 + 1 }, (_, i) => raw(sel.r0 + i, c));
        fillSeries(seed, to.r - sel.r1, 'down').forEach((text, i) => out.push({ row: sel.r1 + 1 + i, col: c, text }));
      }
    } else {
      for (let r = sel.r0; r <= sel.r1; r++) {
        const seed = Array.from({ length: sel.c1 - sel.c0 + 1 }, (_, i) => raw(r, sel.c0 + i));
        fillSeries(seed, to.c - sel.c1, 'right').forEach((text, i) => out.push({ row: r, col: sel.c1 + 1 + i, text }));
      }
    }
    void apply(out);
    setFocus(to.r > sel.r1 ? { r: to.r, c: sel.c1 } : { r: sel.r1, c: to.c });
  }
  const dataEnd = () => ({ r: Math.max(0, used.rows - 1), c: Math.max(0, used.cols - 1) });
  const sortBy = (col: number, ascending: boolean) => {
    const r0 = headerOn ? 1 : 0;
    const r1 = Math.max(r0, used.rows - (hasFooter(data.cells) ? 2 : 1));
    // A block of rows picked sorts just those; otherwise every row under the header.
    const rows = rangeSize(sel) > 1 && sel.r1 > sel.r0 ? { r0: Math.max(sel.r0, r0), r1: sel.r1 } : { r0, r1 };
    void apply(sortedRows(data.cells, data.values, rows.r0, rows.r1, col, ascending));
  };
  const quick = (fn: string) => {
    const t = quickTarget(data.cells, data.values, sel);
    if (!t) return;
    void apply([{ row: t.at.r, col: t.at.c, text: `=${fn}(${rangeName(t.over)})` }]);
    select(t.at);
  };
  const setHeaderRow = (on: boolean) => { setHeader(on); writeKept(HEADER_KEY, place, on); };
  const setWidth = (c: number, w: number | undefined) => {
    setWidths((cur) => {
      const next = { ...cur };
      if (w === undefined) delete next[c]; else next[c] = Math.round(Math.max(44, Math.min(640, w)));
      writeKept(WIDTHS_KEY, place, next);
      return next;
    });
  };
  const fitColumn = (c: number) => {
    let w = textWidth(columnName(c)) + 24;
    for (let r = 0; r < used.rows; r++) w = Math.max(w, textWidth(shown(r, c), headerOn && r === 0) + 18);
    setWidth(c, w);
  };
  const resizeFrom = (c: number, e: ReactPointerEvent<HTMLSpanElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const x0 = e.clientX;
    const w0 = colWidth(c);
    const move = (ev: PointerEvent) => setWidth(c, w0 + ev.clientX - x0);
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onGridKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const mod = e.ctrlKey || e.metaKey;
    // Keys typed before the cell's editor has focus still go into it.
    if (edit) {
      if (e.target !== cellInput.current && e.target !== barInput.current && e.key.length === 1 && !mod) { setEdit((v) => (v ? { ...v, text: v.text + e.key, caret: v.text.length + 1 } : v)); e.preventDefault(); }
      return;
    }
    const k = e.key;
    const arrows: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    const go = (p: Pos) => { const q = { r: Math.max(0, Math.min(height + 200, p.r)), c: Math.max(0, Math.min(51, p.c)) }; if (e.shiftKey) setFocus(q); else select(q); };
    if (arrows[k]) {
      const [dr, dc] = arrows[k]!;
      go(mod ? jump(data.cells, focus.r, focus.c, dr, dc, Math.max(height, used.rows + 1), width - 1) : { r: focus.r + dr, c: focus.c + dc });
    } else if (k === 'Tab') { select({ r: focus.r, c: Math.max(0, focus.c + (e.shiftKey ? -1 : 1)) }); } else if (k === 'Home') { go(mod ? { r: 0, c: 0 } : { r: focus.r, c: 0 }); } else if (k === 'End') { go(mod ? dataEnd() : { r: focus.r, c: Math.max(0, (data.cells[focus.r]?.length ?? 1) - 1) }); } else if (k === 'PageDown' || k === 'PageUp') { go({ r: focus.r + (k === 'PageDown' ? 20 : -20), c: focus.c }); } else if (k === 'Enter' || k === 'F2') { startEdit(raw(focus.r, focus.c)); } else if (k === 'Delete' || k === 'Backspace') { clearRange(sel); } else if (k === 'Escape') { select(focus); } else if (mod && k.toLowerCase() === 'a') { select({ r: 0, c: 0 }, dataEnd()); } else if (mod && k.toLowerCase() === 'z') { void (e.shiftKey ? redo() : undo()); } else if (mod && k.toLowerCase() === 'y') { void redo(); } else if (mod && k.toLowerCase() === 'd') { fillOver('down'); } else if (mod && k.toLowerCase() === 'r') { fillOver('right'); } else if (e.shiftKey && k === ' ') { select({ r: sel.r0, c: 0 }, { r: sel.r1, c: Math.max(width - 1, used.cols - 1) }); } else if (mod && k === ' ') { select({ r: 0, c: sel.c0 }, { r: Math.max(used.rows - 1, height - 1), c: sel.c1 }); } else if (k.length === 1 && !mod && !e.altKey) {
      // Typing over a cell starts a new value, as in any spreadsheet.
      startEdit(k);
    } else return;
    e.preventDefault();
  };

  const formula = edit ? edit.text : raw(focus.r, focus.c);
  const refs = edit ? refsIn(edit.text) : [];
  const showReview = review && !kept && changed.size > 0;
  const stats = rangeSize(sel) > 1 ? selectionStats(valuesIn(sel)) : null;
  const fillRange = fillTo ? rangeOf({ r: sel.r0, c: sel.c0 }, fillTo) : null;
  const edges = (g: Range, r: number, c: number, color: string, w = 2) => (!inRange(g, r, c) ? [] : [
    r === g.r0 ? `inset 0 ${w}px 0 0 ${color}` : '', r === g.r1 ? `inset 0 -${w}px 0 0 ${color}` : '',
    c === g.c0 ? `inset ${w}px 0 0 0 ${color}` : '', c === g.c1 ? `inset -${w}px 0 0 0 ${color}` : '',
  ].filter(Boolean));
  const popupAt = (edit?.where === 'bar' ? barInput.current : cellInput.current)?.getBoundingClientRect();
  const multi = rangeSize(sel) > 1;
  const rowsWord = sel.r1 > sel.r0 ? `${sel.r1 - sel.r0 + 1} rows` : 'row';
  const colsWord = sel.c1 > sel.c0 ? `${sel.c1 - sel.c0 + 1} columns` : 'column';

  const tableMenu = (close: () => void) => (
    <>
      <Item onPick={() => { close(); void shiftAt('row', sel.r0, true); }}>Add row above</Item>
      <Item onPick={() => { close(); void shiftAt('row', sel.r1 + 1, true); }}>Add row below</Item>
      <Item onPick={() => { close(); void shiftAt('column', sel.c0, true); }}>Add column before</Item>
      <Item onPick={() => { close(); void shiftAt('column', sel.c1 + 1, true); }}>Add column after</Item>
      <Sep />
      <Item danger onPick={() => { close(); void (async () => { for (let r = sel.r1; r >= sel.r0; r--) await shiftAt('row', r, false); })(); }}>{`Delete ${rowsWord}`}</Item>
      <Item danger onPick={() => { close(); void (async () => { for (let c = sel.c1; c >= sel.c0; c--) await shiftAt('column', c, false); })(); }}>{`Delete ${colsWord}`}</Item>
      <Sep />
      <Item checked={headerOn} onPick={() => { close(); setHeaderRow(!headerOn); }}>Header row</Item>
      <Item onPick={() => { close(); fitColumn(focus.c); }}>Fit column to its contents</Item>
    </>
  );
  const sortMenu = (close: () => void) => (
    <>
      <Item onPick={() => { close(); sortBy(focus.c, true); }}>{`Sort by ${columnName(focus.c)}, A to Z`}</Item>
      <Item onPick={() => { close(); sortBy(focus.c, false); }}>{`Sort by ${columnName(focus.c)}, Z to A`}</Item>
    </>
  );
  const sumMenu = (close: () => void) => (
    <>
      {['SUM', 'AVERAGE', 'MIN', 'MAX', 'COUNT'].map((fn) => <Item key={fn} disabled={!quickTarget(data.cells, data.values, sel)} onPick={() => { close(); quick(fn); }}>{({ SUM: 'Sum', AVERAGE: 'Average', MIN: 'Minimum', MAX: 'Maximum', COUNT: 'Count' } as Record<string, string>)[fn]}</Item>)}
    </>
  );

  return (
    <section className="sheet-page" aria-label={`Sheet: ${data.sheet}`}>
      <div className="sheet-toolbar" role="toolbar" aria-label="Sheet">
        <span className="sheet-tool-group">
          <button type="button" className="sheet-tool" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={steps.undo.length === 0} onMouseDown={keep} onClick={() => void undo()}><Icon d={ICONS.undo} /></button>
          <button type="button" className="sheet-tool" aria-label="Redo" title="Redo (Ctrl+Y)" disabled={steps.redo.length === 0} onMouseDown={keep} onClick={() => void redo()}><Icon d={ICONS.redo} /></button>
        </span>
        <span className="sheet-address" aria-label="Selected cell">{rangeName(sel)}</span>
        <span className="sheet-fx" aria-hidden="true">ƒx</span>
        <input
          ref={barInput}
          className="sheet-formula"
          aria-label="Cell contents"
          value={formula}
          placeholder="Type a value, or = for a formula"
          spellCheck={false}
          onFocus={(e) => { if (!edit) { setEdit({ at: focus, text: raw(focus.r, focus.c), where: 'bar', caret: e.currentTarget.value.length }); setAnchor(focus); } else if (edit.where !== 'bar') setEdit({ ...edit, where: 'bar' }); }}
          onChange={(e) => typed(e.target.value, caretOf(e.target))}
          onSelect={(e) => { const caret = caretOf(e.currentTarget); setEdit((v) => (v && v.caret !== caret ? { ...v, caret } : v)); }}
          onKeyDown={onEditorKey}
          onBlur={(e) => { if (edit?.where === 'bar' && e.relatedTarget !== cellInput.current) commit(null); }}
        />
        <span className="sheet-tool-group">
          <ToolMenu label="Quick formula" title="Sum, average and more of the cells picked" button={<Icon d={ICONS.sum} />}>{sumMenu}</ToolMenu>
          <ToolMenu label="Table" title="Add or delete rows and columns" button={<><Icon d={ICONS.table} /><span>Table</span></>}>{tableMenu}</ToolMenu>
          <ToolMenu label="Sort" title="Sort the rows" button={<><Icon d={ICONS.sort} /><span>Sort</span></>}>{sortMenu}</ToolMenu>
        </span>
      </div>
      {showReview && (
        <div className="note-review sheet-review" role="status">
          <span className="review-dot" aria-hidden="true" />
          <span className="note-review-text">{`Mobius changed ${changed.size === 1 ? 'one cell' : `${changed.size} cells`} here in its last turn, marked below.`}{review && <WhyThis conversation={review.conversation} />}</span>
          <ReviewActions onKeep={keepAll} onDiscard={discardAll} discardTitle="Put this sheet back as it was before that turn" keepTitle="Keep what Mobius changed in that turn" />
        </div>
      )}
      {sheets.message && <p className="tasks-message" role="alert">{sheets.message}</p>}
      <div
        className="sheet-scroll"
        ref={grid}
        tabIndex={0}
        role="grid"
        aria-label={data.sheet}
        aria-rowcount={height}
        aria-colcount={width}
        aria-multiselectable="true"
        data-header={headerOn || undefined}
        onKeyDown={onGridKey}
        onCopy={(e) => { if (!edit) copyRange(sel, e); }}
        onCut={(e) => { if (!edit) { copyRange(sel, e); clearRange(sel); } }}
        onPaste={(e) => {
          if (edit) return;
          const text = e.clipboardData.getData('text/plain');
          if (text) { e.preventDefault(); pasteText(text); }
        }}
        onContextMenu={(e) => { if (edit) return; e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }); }}
      >
        <table className="sheet-table" style={{ width: 44 + Array.from({ length: width }, (_, c) => colWidth(c)).reduce((a, b) => a + b, 0) }}>
          <thead>
            <tr>
              <th className="sheet-corner" aria-label="Select all" onMouseDown={(e) => { e.preventDefault(); grid.current?.focus(); select({ r: 0, c: 0 }, dataEnd()); }} />
              {Array.from({ length: width }, (_, c) => (
                <th
                  key={c}
                  scope="col"
                  style={{ width: colWidth(c) }}
                  data-on={(c >= sel.c0 && c <= sel.c1) || undefined}
                  onMouseDown={(e) => { if (e.button !== 0) return; e.preventDefault(); grid.current?.focus(); const end = Math.max(used.rows - 1, height - 1); if (e.shiftKey) { setAnchor({ r: 0, c: anchor.c }); setFocus({ r: end, c }); } else select({ r: 0, c }, { r: end, c }); }}
                >
                  {columnName(c)}
                  <span className="sheet-col-resize" role="separator" aria-orientation="vertical" aria-label={`Width of column ${columnName(c)}`} onPointerDown={(e) => resizeFrom(c, e)} onDoubleClick={() => fitColumn(c)} onMouseDown={(e) => e.stopPropagation()} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: height }, (_, r) => (
              <tr key={r} className={headerOn && r === 0 ? 'sheet-header-row' : undefined}>
                <th
                  scope="row"
                  data-on={(r >= sel.r0 && r <= sel.r1) || undefined}
                  onMouseDown={(e) => { if (e.button !== 0) return; e.preventDefault(); grid.current?.focus(); const end = Math.max(width - 1, used.cols - 1); if (e.shiftKey) { setAnchor({ r: anchor.r, c: 0 }); setFocus({ r, c: end }); } else select({ r, c: 0 }, { r, c: end }); }}
                >{r + 1}</th>
                {Array.from({ length: width }, (_, c) => {
                  const here = edit && edit.at.r === r && edit.at.c === c && edit.where === 'cell';
                  const isFocus = r === focus.r && c === focus.c;
                  const inSel = inRange(sel, r, c);
                  const value = shown(r, c);
                  const key = `${r}:${c}`;
                  const shadows: string[] = [];
                  if (!edit) shadows.push(...edges(sel, r, c, 'var(--accent)'));
                  else if (edit.at.r === r && edit.at.c === c) shadows.push(...edges({ r0: r, c0: c, r1: r, c1: c }, r, c, 'var(--accent)'));
                  refs.forEach((g, i) => { if (inRange(g, r, c)) shadows.push(...edges(g, r, c, REF_COLORS[i % REF_COLORS.length]!, 2)); });
                  if (fillRange && inRange(fillRange, r, c)) shadows.push(...edges(fillRange, r, c, 'color-mix(in srgb, var(--accent) 70%, transparent)', 1.5));
                  if (showReview && changed.has(key)) shadows.push('inset 0 0 0 1.5px color-mix(in srgb, var(--accent) 55%, transparent)');
                  const refAt = refs.findIndex((g) => inRange(g, r, c));
                  return (
                    <td
                      key={c}
                      role="gridcell"
                      aria-label={cellName(r, c)}
                      data-comment-id={cellName(r, c)}
                      aria-selected={inSel}
                      data-focus={(isFocus && !edit) || undefined}
                      data-in={(inSel && multi && !isFocus && !edit) || undefined}
                      data-ref={refAt >= 0 ? refAt % REF_COLORS.length : undefined}
                      data-cell={key}
                      data-num={isNumeric(value) || undefined}
                      data-error={isError(value) || undefined}
                      data-formula={raw(r, c).startsWith('=') || undefined}
                      data-changed={showReview && changed.has(key) ? true : undefined}
                      data-fresh={sheets.fresh.has(key) || undefined}
                      title={raw(r, c).startsWith('=') ? raw(r, c) : undefined}
                      style={shadows.length ? { boxShadow: shadows.join(', ') } : undefined}
                      onMouseDown={(e) => {
                        if (e.button !== 0) { if (!inSel && !edit) select({ r, c }); return; }
                        if (edit && canPick()) { e.preventDefault(); drag.current = 'ref'; putRef({ r, c }, { r, c }); return; }
                        if (edit && !here) { commit(null); select({ r, c }); drag.current = 'select'; return; }
                        if (here) return;
                        if (e.shiftKey) setFocus({ r, c }); else select({ r, c });
                        drag.current = 'select';
                      }}
                      onMouseEnter={(e) => {
                        if (e.buttons !== 1) return;
                        if (drag.current === 'select') setFocus({ r, c });
                        else if (drag.current === 'ref' && pick) putRef(pick.from, { r, c });
                        else if (drag.current === 'fill') setFillTo(fillReach({ r, c }));
                      }}
                      onDoubleClick={() => { if (!edit) { select({ r, c }); setEdit({ at: { r, c }, text: raw(r, c), where: 'cell', caret: raw(r, c).length }); } }}
                    >
                      {here
                        ? <input ref={cellInput} className="sheet-cell-input" style={{ width: Math.max(colWidth(c), textWidth(edit.text) + 24) }} aria-label={`Edit ${cellName(r, c)}`} value={edit.text} spellCheck={false} onChange={(e) => typed(e.target.value, caretOf(e.target))} onSelect={(e) => { const caret = caretOf(e.currentTarget); setEdit((v) => (v && v.caret !== caret ? { ...v, caret } : v)); }} onKeyDown={onEditorKey} onBlur={(e) => { if (e.relatedTarget !== barInput.current) commit(null); }} />
                        : value}
                      {!edit && r === sel.r1 && c === sel.c1 && (
                        <span className="sheet-fill" aria-hidden="true" title="Drag to fill" onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); drag.current = 'fill'; setFillTo(null); }} />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && popupAt && (fnMatches.length > 0 || fnHint) && createPortal(
        <div className="sheet-suggest" style={{ top: popupAt.bottom + 4, left: Math.min(popupAt.left, window.innerWidth - 300) }} onMouseDown={keep}>
          {fnMatches.length > 0
            ? (
              <ul role="listbox" aria-label="Functions">
                {fnMatches.map((f, i) => (
                  <li key={f.name} role="option" aria-selected={i === suggest % fnMatches.length} onMouseDown={(e) => { e.preventDefault(); putFunction(f.name); }}>
                    <b>{f.name}</b><span>{f.about}</span>
                  </li>
                ))}
              </ul>
            )
            : fnHint && <p className="sheet-hint" role="note"><b>{fnHint.name}</b>({fnHint.args}) <span>{fnHint.about}</span></p>}
        </div>,
        document.body,
      )}
      {menu && createPortal(
        <>
          <div className="sheet-scrim" onMouseDown={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }} />
          <div className="sheet-menu" role="menu" aria-label="Cells" style={{ top: Math.min(menu.y, window.innerHeight - 380), left: Math.min(menu.x, window.innerWidth - 230), minWidth: 220 }} onKeyDown={(e) => { if (e.key === 'Escape') { setMenu(null); grid.current?.focus(); } }}>
            <Item keys="Ctrl+X" onPick={() => { setMenu(null); grid.current?.focus(); document.execCommand('cut'); }}>Cut</Item>
            <Item keys="Ctrl+C" onPick={() => { setMenu(null); grid.current?.focus(); document.execCommand('copy'); }}>Copy</Item>
            <Item keys="Ctrl+V" onPick={() => { setMenu(null); grid.current?.focus(); void navigator.clipboard?.readText().then((t) => { if (t) pasteText(t); }).catch(() => {}); }}>Paste</Item>
            <Item keys="Delete" onPick={() => { setMenu(null); clearRange(sel); }}>Clear</Item>
            <Sep />
            {tableMenu(() => setMenu(null))}
            <Sep />
            {sortMenu(() => setMenu(null))}
          </div>
        </>,
        document.body,
      )}
      <SheetTabs sheets={sheets} status={stats && (stats.numbers > 0
        ? <><span>Sum <b>{statNumber(stats.sum)}</b></span><span>Average <b>{statNumber(stats.average)}</b></span><span>Min <b>{statNumber(stats.min)}</b></span><span>Max <b>{statNumber(stats.max)}</b></span><span>Count <b>{stats.count}</b></span></>
        : <span>Count <b>{stats.count}</b></span>)}
      />
    </section>
  );
}

function SheetTabs({ sheets, status }: { sheets: SheetsState; status: ReactNode }) {
  const data = sheets.data!;
  const [renaming, setRenaming] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="sheet-foot">
      <div className="sheet-tabs" role="tablist" aria-label="Sheets">
        {data.sheets.map((s) => (renaming === s ? (
          <form key={s} onSubmit={(e) => { e.preventDefault(); setRenaming(null); if (name.trim() && name.trim() !== s) void sheets.renameSheet(s, name.trim()); }}>
            <input autoFocus className="sheet-tab-name" aria-label="Sheet name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} onBlur={() => setRenaming(null)} onKeyDown={(e) => { if (e.key === 'Escape') setRenaming(null); }} />
          </form>
        ) : (
          <button key={s} type="button" role="tab" aria-selected={s === data.sheet} className="sheet-tab" title="Double-click to rename" onClick={() => void sheets.open(data.workbook, s)} onDoubleClick={() => { setRenaming(s); setName(s); }}>{s}</button>
        )))}
        <button type="button" className="sheet-tab-add" aria-label="New sheet" title="New sheet" onClick={() => void sheets.addSheet(`Sheet ${data.sheets.length + 1}`)}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 5v10M5 10h10" /></svg>
        </button>
        {data.sheets.length > 1 && (confirm
          ? <button type="button" className="sheet-tab-delete" data-sure onClick={() => { setConfirm(false); void sheets.removeSheet(data.sheet); }} onBlur={() => setConfirm(false)}>Delete {data.sheet}</button>
          : <button type="button" className="sheet-tab-delete" onClick={() => setConfirm(true)}>Delete sheet…</button>)}
      </div>
      {status && <div className="sheet-status" role="status" aria-label="Selection">{status}</div>}
    </div>
  );
}
