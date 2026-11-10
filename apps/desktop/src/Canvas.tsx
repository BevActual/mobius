import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { onCommand } from './commands';
import { NotesSidebar, type SidebarWords } from './NotesSidebar';
import { useFileReview } from './useFileReview';
import { useUndo } from './useUndo';
import {
  BOARD_COLORS, COLOR_NAMES, arrowEnds, boardBounds, boundsOf, changedItems, freshItemId, isBoxed, itemsIn, moveItem, parseBoard, placeNew, removeItems, removedItems, thinPoints, writeBoard,
  pasteItems, tidyItems, type Board, type BoardColor, type BoardItem, type Boxed, type Rect, type ShapeKind,
} from './board-format';
import type { NotesState } from './useNotes';
import { ReviewActions } from './ReviewBar';

export const CANVAS_WORDS: SidebarWords = { app: 'Canvas', group: 'folder', groups: 'Folders', item: 'board', items: 'boards', about: 'Boards are kept as JSON files in your workspace, one item per line, so the agent can read and change them too.', defaultGroup: 'Boards' };

export function CanvasSidebar(props: { boards: NotesState; pin: ReactNode; changed?: ReadonlySet<string> }) {
  const { boards, ...rest } = props;
  return <NotesSidebar notes={boards} words={CANVAS_WORDS} {...rest} />;
}

export type Tool = 'select' | 'sticky' | 'shape' | 'text' | 'arrow' | 'pen';
const TOOLS: { id: Tool; label: string; key: string; icon: ReactNode }[] = [
  { id: 'select', label: 'Select', key: 'v', icon: <path d="M5 3l10 6-4.5 1.2L13 15l-2 1-2.4-4.8L5 14z" /> },
  { id: 'sticky', label: 'Sticky note', key: 'n', icon: <><path d="M4 4h12v8l-4 4H4z" /><path d="M12 16v-4h4" /></> },
  { id: 'shape', label: 'Shape', key: 'r', icon: <rect x="3.5" y="5" width="13" height="10" rx="1.5" /> },
  { id: 'text', label: 'Text', key: 't', icon: <path d="M4 5V4h12v1M10 4v12M7.5 16h5" /> },
  { id: 'arrow', label: 'Arrow', key: 'a', icon: <><path d="M4 16 15 5" /><path d="M9 5h6v6" /></> },
  { id: 'pen', label: 'Pen', key: 'p', icon: <><path d="M13.5 3.5l3 3L8 15H5v-3z" /><path d="M11.5 5.5l3 3" /></> },
];
const SHAPES: { id: ShapeKind; label: string }[] = [{ id: 'rect', label: 'Box' }, { id: 'ellipse', label: 'Oval' }, { id: 'diamond', label: 'Diamond' }];
const NAMES: Record<BoardItem['type'], string> = { sticky: 'Sticky', shape: 'Shape', text: 'Text', arrow: 'Arrow', ink: 'Drawing' };

/** Items copied on a board, to paste on this one or another; kept while Mobius is open. */
let clipboard: { items: BoardItem[]; pasted: number } | null = null;

type Gesture =
  | { kind: 'move'; ids: string[]; startX: number; startY: number; dx: number; dy: number }
  | { kind: 'resize'; id: string; startX: number; startY: number; dx: number; dy: number }
  | { kind: 'pan'; startX: number; startY: number; panX: number; panY: number }
  | { kind: 'marquee'; x0: number; y0: number; x1: number; y1: number }
  | { kind: 'link'; from: string; x: number; y: number }
  | { kind: 'ink'; points: [number, number][] };

/** What the change bar says: how many items Mobius changed (dashed) and how many it took away. */
export function reviewText(changed: number, removed: number): string {
  const n = (k: number) => (k === 1 ? 'one item' : `${k} items`);
  if (!removed) return `Mobius changed ${n(changed)} here, dashed.`;
  if (!changed) return `Mobius took away ${n(removed)} here.`;
  return `Mobius changed ${n(changed)} here, dashed, and took away ${removed === 1 ? 'one' : removed}.`;
}

/** One board: stickies, shapes, text, arrows between them and pen lines, on a canvas to pan and zoom. Mobius's changes dashed. */
export function CanvasBoard({ boards, review }: { boards: NotesState; review?: { conversation: string } | null }) {
  const parsed = useMemo(() => (boards.page ? parseBoard(boards.text) : null), [boards.page, boards.text]);
  const board = parsed && 'board' in parsed ? parsed.board : null;
  const [tool, setTool] = useState<Tool>('select');
  const [shape, setShape] = useState<ShapeKind>('rect');
  const [paint, setPaint] = useState<BoardColor>('yellow');
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const view = useRef<HTMLDivElement>(null);
  const file = boards.page ? `boards/${boards.page.path}` : null;
  const { before, keep, discard } = useFileReview(review, file, boards.page?.base);
  const beforeBoard = useMemo(() => {
    if (before === undefined) return undefined;
    if (before === null) return null;
    const p = parseBoard(before);
    return 'board' in p ? p.board : undefined;
  }, [before]);
  const changed = useMemo(() => (board && beforeBoard !== undefined ? changedItems(beforeBoard, board) : new Set<string>()), [board, beforeBoard]);
  const removed = useMemo(() => (board && beforeBoard !== undefined ? removedItems(beforeBoard, board) : []), [board, beforeBoard]);

  const history = useUndo(boards.page?.path ?? null, boards.text, boards.edit);
  const change = useCallback((fn: (b: Board) => void) => {
    if (!board) return;
    const next = structuredClone(board);
    fn(next);
    const text = writeBoard(next);
    history.record(boards.text, text);
    boards.edit(text);
  }, [board, boards, history]);
  // Undo and redo from the keyboard or the Edit menu.
  const historyNow = useRef(history);
  historyNow.current = history;
  useEffect(() => {
    const offUndo = onCommand('undo', () => { if (historyNow.current.undo()) setSelected([]); });
    const offRedo = onCommand('redo', () => { if (historyNow.current.redo()) setSelected([]); });
    return () => { offUndo(); offRedo(); };
  }, []);

  /** A point on the screen as a point on the board. */
  const toBoard = useCallback((clientX: number, clientY: number) => {
    const r = view.current?.getBoundingClientRect();
    return { x: Math.round((clientX - (r?.left ?? 0) - pan.x) / zoom), y: Math.round((clientY - (r?.top ?? 0) - pan.y) / zoom) };
  }, [pan, zoom]);
  const centre = useCallback(() => {
    const r = view.current?.getBoundingClientRect();
    return r ? toBoard(r.left + r.width / 2, r.top + r.height / 2) : { x: 0, y: 0 };
  }, [toBoard]);

  const fit = useCallback(() => {
    if (!board || !view.current) return;
    const { width, height } = view.current.getBoundingClientRect();
    const b = boardBounds(board);
    if (!b) { setZoom(1); setPan({ x: width / 2, y: height / 2 }); return; }
    const z = Math.max(0.1, Math.min(1.5, (width - 120) / (b.w || 1), (height - 120) / (b.h || 1)));
    setZoom(Math.round(z * 100) / 100);
    setPan({ x: (width - b.w * z) / 2 - b.x * z, y: (height - b.h * z) / 2 - b.y * z });
  }, [board]);
  // A board opens fitted to the window.
  const fitted = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (board && boards.page && fitted.current !== boards.page.path) { fitted.current = boards.page.path; setSelected([]); setEditing(null); fit(); }
  }, [board, boards.page, fit]);

  const add = useCallback((type: 'sticky' | 'shape' | 'text', at: { x: number; y: number }) => {
    if (!board) return;
    const size = type === 'sticky' ? { w: 180, h: 180 } : type === 'shape' ? { w: 200, h: 120 } : { w: 320, h: 40 };
    const place = placeNew(board, at, size);
    const id = freshItemId(board, type);
    change((b) => {
      if (type === 'sticky') b.items.push({ id, type, ...place, ...size, color: paint === 'ink' ? 'yellow' : paint, text: '' });
      else if (type === 'shape') b.items.push({ id, type, shape, ...place, ...size, color: paint === 'yellow' ? 'white' : paint === 'ink' ? 'white' : paint, text: '' });
      else b.items.push({ id, type, ...place, ...size, text: 'Text', size: 20 });
    });
    setSelected([id]);
    setEditing(id);
    setTool('select');
  }, [board, change, paint, shape]);

  const moved = useCallback((item: Boxed): Rect => {
    if (gesture?.kind === 'move' && gesture.ids.includes(item.id)) return { x: item.x + gesture.dx, y: item.y + gesture.dy, w: item.w, h: item.h };
    if (gesture?.kind === 'resize' && gesture.id === item.id) return { x: item.x, y: item.y, w: Math.max(24, item.w + gesture.dx), h: Math.max(24, item.h + gesture.dy) };
    return item;
  }, [gesture]);

  // What a gesture does follows the pointer and is written once, when it is let go. Listened for as soon as it starts
  // (a layout effect), so a quick drag is not missed.
  useLayoutEffect(() => {
    if (!gesture) return;
    const onMove = (e: PointerEvent) => {
      if (gesture.kind === 'pan') setPan({ x: gesture.panX + e.clientX - gesture.startX, y: gesture.panY + e.clientY - gesture.startY });
      else if (gesture.kind === 'move' || gesture.kind === 'resize') setGesture({ ...gesture, dx: Math.round((e.clientX - gesture.startX) / zoom), dy: Math.round((e.clientY - gesture.startY) / zoom) });
      else if (gesture.kind === 'marquee') { const p = toBoard(e.clientX, e.clientY); setGesture({ ...gesture, x1: p.x, y1: p.y }); }
      else if (gesture.kind === 'link') { const p = toBoard(e.clientX, e.clientY); setGesture({ ...gesture, x: p.x, y: p.y }); }
      else if (gesture.kind === 'ink') { const p = toBoard(e.clientX, e.clientY); setGesture({ kind: 'ink', points: [...gesture.points, [p.x, p.y]] }); }
    };
    const onUp = (e: PointerEvent) => {
      if (gesture.kind === 'move' && (gesture.dx || gesture.dy)) change((b) => { for (const it of b.items) if (gesture.ids.includes(it.id)) moveItem(it, gesture.dx, gesture.dy); });
      else if (gesture.kind === 'resize' && (gesture.dx || gesture.dy)) change((b) => { const it = b.items.find((x) => x.id === gesture.id); if (it && isBoxed(it)) { it.w = Math.max(24, it.w + gesture.dx); it.h = Math.max(24, it.h + gesture.dy); } });
      else if (gesture.kind === 'marquee') {
        const r = { x: Math.min(gesture.x0, gesture.x1), y: Math.min(gesture.y0, gesture.y1), w: Math.abs(gesture.x1 - gesture.x0), h: Math.abs(gesture.y1 - gesture.y0) };
        if (board && r.w + r.h > 4) setSelected(itemsIn(board, r));
      } else if (gesture.kind === 'link' && board) {
        const target = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-item]')?.dataset.item;
        if (target && target !== gesture.from && board.items.some((x) => x.id === target && isBoxed(x))) {
          const id = freshItemId(board, 'arrow');
          change((b) => { b.items.push({ id, type: 'arrow', from: gesture.from, to: target, text: '' }); });
          setSelected([id]);
          setTool('select');
        }
      } else if (gesture.kind === 'ink' && board && gesture.points.length > 1) {
        const id = freshItemId(board, 'ink');
        const points = thinPoints(gesture.points);
        if (points.length > 1) change((b) => { b.items.push({ id, type: 'ink', color: paint, points }); });
      }
      setGesture(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
  }, [gesture, zoom, change, toBoard, board, paint]);

  const pressItem = (e: ReactPointerEvent, item: BoardItem) => {
    if (e.button !== 0 || editing === item.id) return;
    e.stopPropagation();
    if (tool === 'arrow' && isBoxed(item)) { const p = toBoard(e.clientX, e.clientY); setGesture({ kind: 'link', from: item.id, x: p.x, y: p.y }); return; }
    if (tool === 'pen') return;
    if (tool !== 'select') setTool('select');
    const ids = e.shiftKey ? (selected.includes(item.id) ? selected.filter((x) => x !== item.id) : [...selected, item.id]) : selected.includes(item.id) ? selected : [item.id];
    setSelected(ids);
    if (editing && editing !== item.id) setEditing(null);
    setGesture({ kind: 'move', ids, startX: e.clientX, startY: e.clientY, dx: 0, dy: 0 });
  };
  const pressEmpty = (e: ReactPointerEvent) => {
    if (e.button === 1 || (e.button === 0 && e.altKey)) { e.preventDefault(); setGesture({ kind: 'pan', startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y }); return; }
    if (e.button !== 0) return;
    setEditing(null);
    const p = toBoard(e.clientX, e.clientY);
    if (tool === 'sticky' || tool === 'shape' || tool === 'text') { add(tool, p); return; }
    if (tool === 'pen') { setSelected([]); setGesture({ kind: 'ink', points: [[p.x, p.y]] }); return; }
    setSelected([]);
    if (e.shiftKey) setGesture({ kind: 'marquee', x0: p.x, y0: p.y, x1: p.x, y1: p.y });
    else setGesture({ kind: 'pan', startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y });
  };

  // The Canvas menu's New sticky note puts one in the middle of the view.
  const addLatest = useRef(() => add('sticky', centre()));
  addLatest.current = () => add('sticky', centre());
  useEffect(() => onCommand('new-sticky', () => addLatest.current()), []);

  const remove = useCallback(() => { const ids = new Set(selected); change((b) => removeItems(b, ids)); setSelected([]); }, [change, selected]);
  const nudge = useCallback((dx: number, dy: number) => change((b) => { for (const it of b.items) if (selected.includes(it.id)) moveItem(it, dx, dy); }), [change, selected]);
  const recolour = (c: BoardColor) => {
    setPaint(c);
    if (selected.length) change((b) => { for (const it of b.items) if (selected.includes(it.id) && (it.type === 'sticky' || it.type === 'shape' || it.type === 'ink')) it.color = c; });
  };
  const duplicate = useCallback(() => {
    if (!board || !selected.length) return;
    let copies: string[] = [];
    change((b) => { copies = pasteItems(b, board.items.filter((x) => selected.includes(x.id)), 24, 24); });
    setSelected(copies);
  }, [board, change, selected]);
  const copy = useCallback(() => {
    if (!board || !selected.length) return;
    clipboard = { items: structuredClone(board.items.filter((x) => selected.includes(x.id))), pasted: 0 };
  }, [board, selected]);
  const paste = useCallback(() => {
    if (!clipboard) return;
    const held = clipboard;
    held.pasted += 1;
    let copies: string[] = [];
    change((b) => { copies = pasteItems(b, held.items, 24 * held.pasted, 24 * held.pasted); });
    setSelected(copies);
  }, [change]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (!t?.closest('.canvas-page')) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'y')) {
        e.preventDefault();
        const again = e.key.toLowerCase() === 'y' || e.shiftKey;
        if (again ? history.redo() : history.undo()) setSelected([]);
        return;
      }
      if (mod && e.key.toLowerCase() === 'a' && board) { e.preventDefault(); setSelected(board.items.map((x) => x.id)); return; }
      if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicate(); return; }
      if (mod && e.key.toLowerCase() === 'c' && selected.length) { e.preventDefault(); copy(); return; }
      if (mod && e.key.toLowerCase() === 'x' && selected.length) { e.preventDefault(); copy(); remove(); return; }
      if (mod && e.key.toLowerCase() === 'v' && clipboard) { e.preventDefault(); paste(); return; }
      if (!mod && !e.altKey) {
        const picked = TOOLS.find((x) => x.key === e.key.toLowerCase());
        if (picked) { setTool(picked.id); return; }
      }
      if (e.key === 'Escape') { setSelected([]); setTool('select'); return; }
      if (!selected.length) return;
      const step = e.shiftKey ? 10 : 1;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(); }
      else if (e.key === 'Enter' && selected.length === 1) { e.preventDefault(); setEditing(selected[0]!); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); nudge(-step, 0); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); nudge(step, 0); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); nudge(0, -step); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); nudge(0, step); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, remove, nudge, duplicate, copy, paste, board, history]);

  if (!boards.page) return <section className="canvas-page empty" aria-label="Canvas"><p className="note-empty">Choose a board on the left, or make a new one.</p></section>;
  if (!board) {
    return (
      <section className="canvas-page empty" aria-label="Canvas">
        <p className="note-empty">This board could not be read ({parsed && 'error' in parsed ? parsed.error : 'unknown'}). Fix the file, or put back what Mobius changed.</p>
      </section>
    );
  }

  const one = selected.length === 1 ? board.items.find((x) => x.id === selected[0]) ?? null : null;
  const setText = (id: string, text: string) => change((b) => { const it = b.items.find((x) => x.id === id); if (it && it.type !== 'ink') it.text = text; });
  const boxStyle = (item: Boxed): CSSProperties => {
    const r = moved(item);
    const c = item.type === 'text' ? null : BOARD_COLORS[item.color];
    return { left: r.x, top: r.y, width: r.w, height: r.h, ...(c ? { '--item-fill': c.fill, '--item-edge': c.edge } as CSSProperties : {}), ...(item.type === 'text' ? { fontSize: item.size } : {}) };
  };
  const marquee = gesture?.kind === 'marquee' ? { x: Math.min(gesture.x0, gesture.x1), y: Math.min(gesture.y0, gesture.y1), w: Math.abs(gesture.x1 - gesture.x0), h: Math.abs(gesture.y1 - gesture.y0) } : null;
  const linkFrom = gesture?.kind === 'link' ? board.items.find((x) => x.id === gesture.from) : null;
  const linkStart = linkFrom && isBoxed(linkFrom) ? { x: linkFrom.x + linkFrom.w / 2, y: linkFrom.y + linkFrom.h / 2 } : null;
  const count = board.items.filter((x) => x.type !== 'arrow').length;

  return (
    <section className="canvas-page" aria-label="Canvas" data-tool={tool}>
      <div className="canvas-bar" role="toolbar" aria-label="Canvas tools">
        <div className="canvas-tools" role="radiogroup" aria-label="Tool">
          {TOOLS.map((x) => (
            <button key={x.id} type="button" role="radio" aria-checked={tool === x.id} className="canvas-tool" aria-label={x.label} title={`${x.label} (${x.key.toUpperCase()})`} onClick={() => setTool(x.id)}>
              <svg viewBox="0 0 20 20" aria-hidden="true">{x.icon}</svg>
            </button>
          ))}
        </div>
        {tool === 'shape' && (
          <select className="canvas-shape" aria-label="Shape kind" value={shape} onChange={(e) => setShape(e.target.value as ShapeKind)}>
            {SHAPES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        )}
        <div className="canvas-colours" role="radiogroup" aria-label="Colour">
          {COLOR_NAMES.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={paint === c} className="canvas-swatch" aria-label={c} title={c} style={{ background: BOARD_COLORS[c].fill, borderColor: BOARD_COLORS[c].edge }} onClick={() => recolour(c)} />
          ))}
        </div>
        {one?.type === 'arrow' && (
          <input className="canvas-label" aria-label="Arrow label" placeholder="Label" value={one.text} maxLength={200} onChange={(e) => setText(one.id, e.target.value)} />
        )}
        {one?.type === 'shape' && (
          <select className="canvas-shape" aria-label="Shape kind" value={one.shape} onChange={(e) => change((b) => { const it = b.items.find((x) => x.id === one.id); if (it?.type === 'shape') it.shape = e.target.value as ShapeKind; })}>
            {SHAPES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        )}
        {one?.type === 'text' && (
          <select className="canvas-shape" aria-label="Text size" value={String(one.size)} onChange={(e) => change((b) => { const it = b.items.find((x) => x.id === one.id); if (it?.type === 'text') { it.size = Number(e.target.value); it.h = Math.max(it.h, Math.round(it.size * 1.6)); } })}>
            {[14, 20, 28, 40, 64].map((s) => <option key={s} value={s}>{s === 14 ? 'Small' : s === 20 ? 'Body' : s === 28 ? 'Heading' : s === 40 ? 'Title' : 'Huge'}</option>)}
          </select>
        )}
        <span className="canvas-bar-gap" />
        {selected.length > 0 && <span className="canvas-count" aria-live="polite">{selected.length} selected</span>}
        {board.items.filter((x) => selected.includes(x.id) && isBoxed(x)).length > 1 && <button type="button" className="btn" title="Line them up in a grid" onClick={() => change((b) => tidyItems(b, new Set(selected)))}>Tidy up</button>}
        {selected.length > 0 && <button type="button" className="btn" onClick={remove}>Delete</button>}
        <button type="button" className="strip-btn" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.1, Math.round(z * 80) / 100))}>−</button>
        <span className="design-zoom" aria-label="Zoom">{Math.round(zoom * 100)}%</span>
        <button type="button" className="strip-btn" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(4, Math.round(z * 125) / 100))}>+</button>
        <button type="button" className="btn" onClick={fit}>Fit</button>
      </div>
      <div
        className="canvas-view"
        ref={view}
        role="application"
        aria-label="Board"
        aria-roledescription="whiteboard"
        tabIndex={0}
        onPointerDown={pressEmpty}
        onDoubleClick={(e) => { if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('canvas-world')) add('sticky', toBoard(e.clientX, e.clientY)); }}
        onWheel={(e) => {
          if (e.ctrlKey || e.metaKey) {
            const rect = e.currentTarget.getBoundingClientRect();
            const z = Math.max(0.1, Math.min(4, zoom * (e.deltaY < 0 ? 1.1 : 0.9)));
            const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
            setPan({ x: cx - ((cx - pan.x) * z) / zoom, y: cy - ((cy - pan.y) * z) / zoom });
            setZoom(Math.round(z * 100) / 100);
          } else setPan((p) => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }));
        }}
        style={{ backgroundPosition: `${pan.x}px ${pan.y}px`, backgroundSize: `${24 * zoom}px ${24 * zoom}px` }}
      >
        <div className="canvas-world" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
          <svg className="canvas-lines" aria-hidden="true">
            <defs>
              <marker id="canvas-head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 10 5 0 10z" /></marker>
            </defs>
            {board.items.map((it) => {
              if (it.type === 'ink') {
                const d = it.points.map((p, i) => `${i ? 'L' : 'M'}${p[0] + (gesture?.kind === 'move' && gesture.ids.includes(it.id) ? gesture.dx : 0)} ${p[1] + (gesture?.kind === 'move' && gesture.ids.includes(it.id) ? gesture.dy : 0)}`).join(' ');
                return <path key={it.id} className="canvas-ink" d={d} stroke={BOARD_COLORS[it.color].edge} data-selected={selected.includes(it.id) || undefined} data-proposed={changed.has(it.id) || undefined} />;
              }
              if (it.type !== 'arrow') return null;
              const ends = arrowEnds(board, it, moved);
              if (!ends) return null;
              return <line key={it.id} className="canvas-arrow" {...ends} markerEnd="url(#canvas-head)" data-selected={selected.includes(it.id) || undefined} data-proposed={changed.has(it.id) || undefined} />;
            })}
            {gesture?.kind === 'ink' && <path className="canvas-ink" d={gesture.points.map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${p[1]}`).join(' ')} stroke={BOARD_COLORS[paint].edge} />}
            {linkStart && gesture?.kind === 'link' && <line className="canvas-arrow" data-drawing x1={linkStart.x} y1={linkStart.y} x2={gesture.x} y2={gesture.y} markerEnd="url(#canvas-head)" />}
          </svg>
          {board.items.map((it) => {
            if (it.type === 'ink') {
              const b = boundsOf(it)!;
              const off = gesture?.kind === 'move' && gesture.ids.includes(it.id) ? gesture : { dx: 0, dy: 0 };
              return <div key={it.id} className="canvas-hit" data-item={it.id} aria-label={NAMES.ink} data-selected={selected.includes(it.id) || undefined} style={{ left: b.x - 6 + off.dx, top: b.y - 6 + off.dy, width: b.w + 12, height: b.h + 12 }} onPointerDown={(e) => pressItem(e, it)} />;
            }
            if (it.type === 'arrow') {
              const ends = arrowEnds(board, it, moved);
              if (!ends) return null;
              const mx = (ends.x1 + ends.x2) / 2, my = (ends.y1 + ends.y2) / 2;
              return (
                <button key={it.id} type="button" className="canvas-arrow-label" data-item={it.id} data-empty={!it.text || undefined} data-selected={selected.includes(it.id) || undefined} data-proposed={changed.has(it.id) || undefined} aria-label={`Arrow${it.text ? `: ${it.text}` : ''}`} style={{ left: mx, top: my }} onPointerDown={(e) => pressItem(e, it)}>
                  {it.text}
                </button>
              );
            }
            const isEditing = editing === it.id;
            return (
              <div
                key={it.id}
                className="canvas-item"
                data-item={it.id}
                data-type={it.type}
                data-shape={it.type === 'shape' ? it.shape : undefined}
                data-selected={selected.includes(it.id) || undefined}
                data-proposed={changed.has(it.id) || undefined}
                role="button"
                tabIndex={-1}
                aria-label={`${NAMES[it.type]}: ${it.text || 'empty'}`}
                style={boxStyle(it)}
                onPointerDown={(e) => pressItem(e, it)}
                onDoubleClick={(e) => { e.stopPropagation(); setSelected([it.id]); setEditing(it.id); }}
              >
                {it.type === 'shape' && it.shape === 'diamond' && <svg className="canvas-diamond" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="M50 1 99 50 50 99 1 50z" vectorEffect="non-scaling-stroke" /></svg>}
                {isEditing ? (
                  <textarea
                    className="canvas-edit"
                    aria-label={`${NAMES[it.type]} text`}
                    autoFocus
                    defaultValue={it.text}
                    onFocus={(e) => e.currentTarget.select()}
                    onPointerDown={(e) => e.stopPropagation()}
                    onBlur={(e) => { if (e.currentTarget.value !== it.text) setText(it.id, e.currentTarget.value); setEditing(null); }}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); e.currentTarget.blur(); view.current?.focus(); }
                    }}
                  />
                ) : (
                  <span className="canvas-text">{it.text}</span>
                )}
                {one?.id === it.id && !isEditing && <span className="canvas-handle" aria-hidden="true" style={{ width: 10 / zoom, height: 10 / zoom, right: -6 / zoom, bottom: -6 / zoom }} onPointerDown={(e) => { e.stopPropagation(); setGesture({ kind: 'resize', id: it.id, startX: e.clientX, startY: e.clientY, dx: 0, dy: 0 }); }} />}
              </div>
            );
          })}
          {marquee && <div className="canvas-marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }} />}
        </div>
        {count === 0 && tool === 'select' && (
          <div className="canvas-empty" aria-hidden="true">
            <p>Double-click anywhere to add a sticky note.</p>
            <p>Or ask Mobius to start the board for you.</p>
          </div>
        )}
        {(changed.size > 0 || removed.length > 0) && (
          <div className="design-review canvas-review" role="group" aria-label="Mobius's change" onPointerDown={(e) => e.stopPropagation()}>
            <span className="review-dot" aria-hidden="true" />
            <span>{reviewText(changed.size, removed.length)}</span>
            <ReviewActions onKeep={keep} onDiscard={discard} />
          </div>
        )}
        <div className="canvas-hint" aria-hidden="true">{tool === 'arrow' ? 'Drag from one item to another.' : tool === 'pen' ? 'Draw on the board.' : tool === 'select' ? 'Drag to move around · Shift-drag to select · Double-click to add' : 'Click to place.'}</div>
      </div>
    </section>
  );
}
