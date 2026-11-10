import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { KEPT_EVENT, keepTurn, keptTurns, turnId } from './ReviewStrip';
import { cellName, changedCells, columnName, isError, isNumeric, parseCsv, pasted } from './sheets-view';
import type { SheetsState } from './useSheets';
import { ReviewActions, WhyThis } from './ReviewBar';
import { SideNew, type Start } from './SideNew';

/** The workbooks, each with its sheets. */
export function SheetsSidebar({ sheets, pin, changed, starts, onStart }: { sheets: SheetsState; pin?: ReactNode; changed?: ReadonlySet<string>; starts?: readonly Start[]; onStart?: (prompt: string) => void }) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (await sheets.createWorkbook(name.trim() || 'Workbook')) { setNaming(false); setName(''); }
  };
  const here = sheets.data;
  return (
    <aside className="side sheets-side" aria-label="Sheets sidebar">
      <div className="side-head">
        <span className="side-title">Workbooks</span>
        <span className="side-actions">
          {pin}
        </span>
      </div>
      {naming && (
        <form className="notes-name" onSubmit={(e) => void submit(e)}>
          <input autoFocus aria-label="Workbook name" placeholder="Workbook name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setNaming(false); }} />
          <button type="submit" className="btn primary">Create</button>
        </form>
      )}
      <nav className="task-lists" aria-label="Workbooks">
        <SideNew item="workbook" onNew={() => setNaming(true)} {...(starts ? { starts } : {})} {...(onStart ? { onStart } : {})} />
        {sheets.workbooks.length === 0 && !naming && (
          <div className="side-empty notes-empty">
            <p>Workbooks are kept as CSV files in your workspace, one for each sheet, so any spreadsheet app can open them.</p>
          </div>
        )}
        <ul role="list">
          {sheets.workbooks.map((w) => (
            <li key={w.name}>
              <button type="button" className="list-row" data-proposed={changed?.has(w.name) || undefined} aria-current={here?.workbook === w.name ? 'page' : undefined} onClick={() => void sheets.open(w.name, here?.workbook === w.name ? here.sheet : w.sheets[0] ?? 'Sheet 1')}>
                <span className="list-name">{w.name}</span>
                {changed?.has(w.name) && <span className="changed-mark" role="img" aria-label="Changed by the agent" title="Changed by the agent in its last turn" />}
                <span className="list-count">{w.sheets.length > 1 ? w.sheets.length : ''}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}

type Pos = { r: number; c: number };

/** The open sheet: a grid of cells, the formula bar above it, and its sheets as tabs below. */
export function SheetGrid({ sheets, review }: { sheets: SheetsState; review?: { conversation: string } | null }) {
  const data = sheets.data;
  const [sel, setSel] = useState<Pos>({ r: 0, c: 0 });
  const [editing, setEditing] = useState<string | null>(null);
  const [bar, setBar] = useState<string | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const editor = useRef<HTMLInputElement>(null);
  const raw = (r: number, c: number) => data?.cells[r]?.[c] ?? '';
  const shown = (r: number, c: number) => data?.values[r]?.[c] ?? '';
  useEffect(() => { setSel({ r: 0, c: 0 }); setEditing(null); setBar(null); }, [data?.workbook, data?.sheet]);
  useEffect(() => { if (editing !== null) editor.current?.focus(); }, [editing !== null]); // eslint-disable-line react-hooks/exhaustive-deps
  // The selected cell stays in view as it moves.
  useEffect(() => { grid.current?.querySelector<HTMLElement>(`[data-cell="${sel.r}:${sel.c}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [sel]);

  // What the agent's last turn changed in this sheet, marked dashed until kept or discarded.
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

  if (!data) {
    return (
      <section className="sheet-page empty" aria-label="Sheet">
        <p className="note-empty">{sheets.workbooks.length ? 'Choose a workbook.' : 'Make a workbook to start.'}</p>
      </section>
    );
  }
  const width = Math.min(52, Math.max(10, ...data.cells.map((r) => r.length + 3)));
  const height = Math.max(40, data.cells.length + 20);
  const move = (dr: number, dc: number) => setSel((s) => ({ r: Math.max(0, s.r + dr), c: Math.max(0, Math.min(width - 1, s.c + dc)) }));
  const commit = (text: string, then: Pos | null) => {
    const before = raw(sel.r, sel.c);
    if (text !== before) void sheets.set([{ row: sel.r, col: sel.c, text }]);
    setEditing(null);
    setBar(null);
    if (then) setSel(then);
    grid.current?.focus();
  };
  const onGridKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const mod = e.ctrlKey || e.metaKey;
    // Keys typed before the cell's editor has focus still go into it.
    if (editing !== null) {
      if (e.target !== editor.current && e.key.length === 1 && !mod) { setEditing((v) => (v ?? '') + e.key); e.preventDefault(); }
      return;
    }
    if (e.key === 'ArrowUp') { move(-1, 0); e.preventDefault(); } else if (e.key === 'ArrowDown') { move(1, 0); e.preventDefault(); } else if (e.key === 'ArrowLeft') { move(0, -1); e.preventDefault(); } else if (e.key === 'ArrowRight') { move(0, 1); e.preventDefault(); } else if (e.key === 'Tab') { move(0, e.shiftKey ? -1 : 1); e.preventDefault(); } else if (e.key === 'Enter' || e.key === 'F2') { setEditing(raw(sel.r, sel.c)); e.preventDefault(); } else if (e.key === 'Delete' || e.key === 'Backspace') { if (raw(sel.r, sel.c)) void sheets.set([{ row: sel.r, col: sel.c, text: '' }]); e.preventDefault(); } else if (mod && e.key.toLowerCase() === 'c') {
      void navigator.clipboard?.writeText(shown(sel.r, sel.c)).catch(() => {});
      e.preventDefault();
    } else if (e.key.length === 1 && !mod && !e.altKey) {
      // Typing over a cell starts a new value, as in any spreadsheet.
      setEditing(e.key);
      e.preventDefault();
    }
  };
  const onEditorKey = (e: KeyboardEvent<HTMLInputElement>, text: string) => {
    if (e.key === 'Enter') { commit(text, { r: sel.r + (e.shiftKey ? -1 : 1) < 0 ? 0 : sel.r + (e.shiftKey ? -1 : 1), c: sel.c }); e.preventDefault(); } else if (e.key === 'Tab') { commit(text, { r: sel.r, c: Math.max(0, sel.c + (e.shiftKey ? -1 : 1)) }); e.preventDefault(); } else if (e.key === 'Escape') { setEditing(null); setBar(null); grid.current?.focus(); e.preventDefault(); }
  };
  const formula = bar ?? editing ?? raw(sel.r, sel.c);
  const showReview = review && !kept && changed.size > 0;
  return (
    <section className="sheet-page" aria-label={`Sheet: ${data.sheet}`}>
      <div className="sheet-toolbar" role="toolbar" aria-label="Sheet">
        <span className="sheet-address" aria-label="Selected cell">{cellName(sel.r, sel.c)}</span>
        <input
          className="sheet-formula"
          aria-label="Cell contents"
          value={formula}
          placeholder="Type a value, or = for a formula"
          onFocus={() => setBar(raw(sel.r, sel.c))}
          onChange={(e) => setBar(e.target.value)}
          onKeyDown={(e) => onEditorKey(e, e.currentTarget.value)}
          onBlur={(e) => { if (bar !== null) commit(e.currentTarget.value, null); }}
        />
        <span className="doc-tool-sep" />
        <button type="button" className="doc-tool text" title="Put a row in above this one" onClick={() => void sheets.shift('row', sel.r, true)}>+ Row</button>
        <button type="button" className="doc-tool text" title="Put a column in left of this one" onClick={() => void sheets.shift('column', sel.c, true)}>+ Column</button>
        <button type="button" className="doc-tool text" title="Take this row out" onClick={() => void sheets.shift('row', sel.r, false)}>− Row</button>
        <button type="button" className="doc-tool text" title="Take this column out" onClick={() => void sheets.shift('column', sel.c, false)}>− Column</button>
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
        onKeyDown={onGridKey}
        onPaste={(e) => {
          if (editing !== null) return;
          const text = e.clipboardData.getData('text/plain');
          if (text) { e.preventDefault(); void sheets.set(pasted(text, sel.r, sel.c)); }
        }}
      >
        <table className="sheet-table">
          <thead>
            <tr>
              <th className="sheet-corner" aria-hidden="true" />
              {Array.from({ length: width }, (_, c) => <th key={c} scope="col" data-on={c === sel.c || undefined}>{columnName(c)}</th>)}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: height }, (_, r) => (
              <tr key={r}>
                <th scope="row" data-on={r === sel.r || undefined}>{r + 1}</th>
                {Array.from({ length: width }, (_, c) => {
                  const on = r === sel.r && c === sel.c;
                  const value = shown(r, c);
                  const key = `${r}:${c}`;
                  return (
                    <td
                      key={c}
                      role="gridcell"
                      aria-label={cellName(r, c)}
                      aria-selected={on}
                      data-cell={key}
                      data-num={isNumeric(value) || undefined}
                      data-error={isError(value) || undefined}
                      data-formula={raw(r, c).startsWith('=') || undefined}
                      data-changed={showReview && changed.has(key) ? true : undefined}
                      data-fresh={sheets.fresh.has(key) || undefined}
                      title={raw(r, c).startsWith('=') ? raw(r, c) : undefined}
                      onMouseDown={() => { if (editing !== null && !on) commit(editing, { r, c }); else setSel({ r, c }); }}
                      onDoubleClick={() => { setSel({ r, c }); setEditing(raw(r, c)); }}
                    >
                      {on && editing !== null
                        ? <input ref={editor} className="sheet-cell-input" aria-label={`Edit ${cellName(r, c)}`} value={editing} onChange={(e) => setEditing(e.target.value)} onKeyDown={(e) => onEditorKey(e, e.currentTarget.value)} onBlur={(e) => commit(e.currentTarget.value, null)} />
                        : value}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <SheetTabs sheets={sheets} />
    </section>
  );
}

function SheetTabs({ sheets }: { sheets: SheetsState }) {
  const data = sheets.data!;
  const [renaming, setRenaming] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="sheet-tabs" role="tablist" aria-label="Sheets">
      {data.sheets.map((s) => (renaming === s ? (
        <form key={s} onSubmit={(e) => { e.preventDefault(); setRenaming(null); if (name.trim() && name.trim() !== s) void sheets.renameSheet(s, name.trim()); }}>
          <input autoFocus className="sheet-tab-name" aria-label="Sheet name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} onBlur={() => setRenaming(null)} onKeyDown={(e) => { if (e.key === 'Escape') setRenaming(null); }} />
        </form>
      ) : (
        <button key={s} type="button" role="tab" aria-selected={s === data.sheet} className="sheet-tab" title="Double-click to rename" onClick={() => void sheets.open(data.workbook, s)} onDoubleClick={() => { setRenaming(s); setName(s); }}>{s}</button>
      )))}
      <button type="button" className="strip-btn" aria-label="New sheet" title="New sheet" onClick={() => void sheets.addSheet(`Sheet ${data.sheets.length + 1}`)}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 5v10M5 10h10" /></svg>
      </button>
      <span className="spacer" />
      {data.sheets.length > 1 && (confirm
        ? <button type="button" className="btn cal-delete" onClick={() => { setConfirm(false); void sheets.removeSheet(data.sheet); }} onBlur={() => setConfirm(false)}>Delete {data.sheet}</button>
        : <button type="button" className="doc-tool text" onClick={() => setConfirm(true)}>Delete sheet…</button>)}
    </div>
  );
}
