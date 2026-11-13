import { createPortal } from 'react-dom';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { NotesSidebar, newItemIn, type SidebarWords } from './NotesSidebar';
import { EmptyState } from './EmptyState';
import { KEPT_EVENT, keepTurn, keptTurns, turnId } from './ReviewStrip';
import { changedIds, componentOf, contrast, copyOf, detach, freshId, makeComponent, moveLayer, nextFramePlace, withOverride, parseDesign, resolveColor, writeDesign, type Align, type DesignDoc, type DesignFrame, type DesignNode, type NodeType } from './design-format';
import type { NotesState } from './useNotes';
import { onCommand } from './commands';
import { useUndo } from './useUndo';
import { ReviewActions, WhyThis } from './ReviewBar';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';
import { alignBoxes, around, boxFrom, boxesTouching, distributeBoxes, HANDLES, resizeBox, snapBox, zoomOnto, type AlignHow, type Guide, type Handle } from './design-view';
import { EXPORT_ALBUM, exportFrame } from './design-export';
import './design.css';

export const DESIGN_WORDS: SidebarWords = { app: 'Design', group: 'folder', groups: 'Folders', item: 'design', items: 'designs', about: 'Designs are kept as JSON files in your workspace, frames and their layers, so the agent can read and change them too.', defaultGroup: 'Designs' };

export function DesignSidebar(props: { designs: NotesState; pin: ReactNode; changed?: ReadonlySet<string>; starts?: readonly import('./SideNew').Start[]; onStart?: (prompt: string) => void }) {
  const { designs, ...rest } = props;
  return <NotesSidebar notes={designs} words={DESIGN_WORDS} {...rest} />;
}

/** A layer that a click or a box on the canvas can pick: not hidden, not locked. */
const canPick = (n: DesignNode) => !n.hidden && !n.locked;

function findNode(doc: DesignDoc, id: string | null): { frame: DesignFrame; node: DesignNode | null } | null {
  for (const frame of doc.frames) {
    if (frame.id === id) return { frame, node: null };
    const node = frame.children.find((c) => c.id === id);
    if (node) return { frame, node };
  }
  return null;
}

/** What Mobius changed in the open design in its last turn: kept, or the design as it was before. */
function useDesignReview(review: { conversation: string } | null | undefined, file: string | null, version: unknown) {
  const [kept, setKept] = useState(false);
  const [before, setBefore] = useState<DesignDoc | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    const check = async () => {
      if (!review) { setKept(false); return; }
      const last = await window.mobius.changes?.lastTurn(review.conversation).catch(() => null);
      const id = last && 'checkpoint' in last ? turnId(review.conversation, last.checkpoint) : null;
      if (live) setKept(id !== null && keptTurns('design').includes(id));
    };
    void check();
    window.addEventListener(KEPT_EVENT, check);
    return () => { live = false; window.removeEventListener(KEPT_EVENT, check); };
  }, [review?.conversation, file, version]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let live = true;
    if (!review || kept || !file) { setBefore(undefined); return; }
    void window.mobius.changes.before(review.conversation, file).then((was) => {
      if (!live || !was || !was.ok) return;
      const parsed = was.text === null ? null : parseDesign(was.text);
      setBefore(parsed === null ? null : 'doc' in parsed ? parsed.doc : undefined);
    }).catch(() => {});
    return () => { live = false; };
  }, [review?.conversation, kept, file, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const keep = async () => {
    if (!review) return;
    const last = await window.mobius.changes?.lastTurn(review.conversation).catch(() => null);
    const id = last && 'checkpoint' in last ? turnId(review.conversation, last.checkpoint) : null;
    if (id) keepTurn(id, 'design');
    setKept(true);
  };
  const discard = async () => {
    if (!review || !file) return;
    await window.mobius.changes.undoFile(review.conversation, file).catch(() => null);
  };
  return { before, keep, discard };
}

function Field({ label, value, onChange, min, step = 1, wide }: { label: string; value: number; onChange: (n: number) => void; min?: number; step?: number; wide?: boolean }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const done = () => { const n = Number(text); if (Number.isFinite(n) && text.trim() !== '') onChange(min !== undefined ? Math.max(min, n) : n); else setText(String(value)); };
  return (
    <label className="design-field" data-wide={wide || undefined}>
      <span>{label}</span>
      <input aria-label={label} inputMode="decimal" value={text} step={step} onChange={(e) => setText(e.target.value)} onBlur={done} onKeyDown={(e) => { if (e.key === 'Enter') { done(); (e.target as HTMLInputElement).blur(); } }} />
    </label>
  );
}

function ColorField({ label, value, doc, onChange, bare }: { label: string; value: string; doc: DesignDoc; onChange: (c: string) => void; bare?: boolean }) {
  const shown = resolveColor(value, doc.styles);
  const plain = /^#[0-9a-f]{6}/i.test(shown) ? shown.slice(0, 7) : '#000000';
  return (
    <div className="design-color">
      {!bare && <span className="design-color-label">{label}</span>}
      <input type="color" aria-label={`${label} colour`} value={plain} onChange={(e) => onChange(e.target.value)} />
      <select aria-label={`${label} style`} value={value.startsWith('style:') ? value : ''} onChange={(e) => onChange(e.target.value || plain)}>
        <option value="">{value === 'transparent' ? 'None' : value.startsWith('style:') ? plain : value}</option>
        {doc.styles.map((s) => <option key={s.name} value={`style:${s.name}`}>{s.name}</option>)}
      </select>
    </div>
  );
}

type Tool = 'move' | 'frame' | 'rect' | 'ellipse' | 'text';
const TOOL_KEYS: Record<string, Tool> = { v: 'move', f: 'frame', a: 'frame', r: 'rect', o: 'ellipse', t: 'text' };
const TOOL_NAME: Record<Exclude<Tool, 'move'>, string> = { frame: 'a frame', rect: 'a rectangle', ellipse: 'an ellipse', text: 'a text box' };

type Drag =
  | { kind: 'pan'; startX: number; startY: number; panX: number; panY: number }
  | { kind: 'move'; ids: string[]; startX: number; startY: number; dx: number; dy: number; guides: Guide[]; frame: string | null; moved: boolean }
  | { kind: 'resize'; id: string; handle: Handle; startX: number; startY: number; dx: number; dy: number; keep: boolean }
  | { kind: 'draw'; tool: Exclude<Tool, 'move'>; frame: string | null; x0: number; y0: number; x1: number; y1: number }
  | { kind: 'pick'; frame: string | null; x0: number; y0: number; x1: number; y1: number; add: string[]; moved: boolean };

const ICON = {
  move: 'M5 3l10 6.5-4.5 1L13 16l-2 1-2.5-5.5L5 15z',
  frame: 'M6 3v14M14 3v14M3 6h14M3 14h14',
  rect: 'M4 5h12v10H4z',
  ellipse: 'M10 4.5c3.6 0 6.5 2.5 6.5 5.5s-2.9 5.5-6.5 5.5S3.5 13 3.5 10 6.4 4.5 10 4.5z',
  text: 'M5 5h10M10 5v11M8 16h4',
  alignLeft: 'M4 3v14M7 6h9M7 11h5', alignCenter: 'M10 3v14M5 6h10M7 12h6', alignRight: 'M16 3v14M4 6h9M8 11h5',
  alignTop: 'M3 4h14M6 7v9M11 7v5', alignMiddle: 'M3 10h14M6 5v10M12 7v6', alignBottom: 'M3 16h14M6 4v9M11 8v5',
  spreadX: 'M3 4v12M17 4v12M8 7h4v6H8z', spreadY: 'M4 3h12M4 17h12M7 8h6v4H7z',
  shown: 'M2.5 10s2.8-5 7.5-5 7.5 5 7.5 5-2.8 5-7.5 5-7.5-5-7.5-5zM10 12.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4z',
  hidden: 'M2.5 10s2.8-5 7.5-5 7.5 5 7.5 5-2.8 5-7.5 5-7.5-5-7.5-5zM3.5 3.5l13 13',
  locked: 'M5.5 9h9v7.5h-9zM7.5 9V6.5a2.5 2.5 0 0 1 5 0V9',
  unlocked: 'M5.5 9h9v7.5h-9zM7.5 9V6.5a2.5 2.5 0 0 1 4.9-.7',
  component: 'M10 2.5 13.5 6 10 9.5 6.5 6zM10 10.5l3.5 3.5-3.5 3.5-3.5-3.5zM2.5 10 6 6.5 9.5 10 6 13.5zM10.5 10 14 6.5l3.5 3.5-3.5 3.5z',
  instance: 'M10 3l7 7-7 7-7-7z',
  front: 'M6 3h8v6H6zM4 12h12M4 15h12', forward: 'M10 15V5M6 9l4-4 4 4', backward: 'M10 5v10M6 11l4 4 4-4', back: 'M4 5h12M4 8h12M6 11h8v6H6z',
} as const;
const Icon = ({ d }: { d: string }) => <svg viewBox="0 0 20 20" aria-hidden="true"><path d={d} /></svg>;
const KIND: Record<NodeType, string> = { text: 'Text', ellipse: 'Ellipse', rect: 'Rectangle', instance: 'Copy' };

/**
 * One design, as Sketch and Figma work: frames on a canvas, layers drawn with a tool (V, F, R, O, T) or added from the
 * toolbar, picked with a click, Shift-click or a box, moved with smart guides, sized from any edge, lined up from the
 * inspector, copied and duplicated, text typed on the canvas, and Mobius's changes dashed to keep or discard.
 */
export function DesignEditor({ designs, review }: { designs: NotesState; review?: { conversation: string } | null }) {
  const parsed = useMemo(() => (designs.page ? parseDesign(designs.text) : null), [designs.page, designs.text]);
  const doc = parsed && 'doc' in parsed ? parsed.doc : null;
  const [selected, setSelected] = useState<string[]>([]);
  const [tool, setTool] = useState<Tool>('move');
  const [zoom, setZoom] = useState(0.5);
  const [pan, setPan] = useState({ x: 40, y: 40 });
  const [drag, setDrag] = useState<Drag | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const lastPress = useRef<{ id: string; t: number; x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [space, setSpace] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  /** The last export: which frame, and where it went or why it did not. */
  const [exported, setExported] = useState<{ frame: string; text: string; bad?: boolean } | null>(null);
  const [exportScale, setExportScale] = useState(2);
  /** A layer being dragged in the layer list, and where it would land. */
  const [moving, setMoving] = useState<{ id: string; target?: string; place?: 'above' | 'below' } | null>(null);
  const copied = useRef<{ frame: string; nodes: DesignNode[] } | null>(null);
  const view = useRef<HTMLDivElement>(null);
  const file = designs.page ? `designs/${designs.page.path}` : null;
  const { before, keep, discard } = useDesignReview(review, file, designs.page?.base);
  const changed = useMemo(() => (doc && before !== undefined ? changedIds(before, doc) : new Set<string>()), [doc, before]);
  const one = selected.length === 1 ? selected[0]! : null;

  const history = useUndo(designs.page?.path ?? null, designs.text, designs.edit);
  const change = useCallback((fn: (d: DesignDoc) => void) => {
    if (!doc) return;
    const next = structuredClone(doc);
    fn(next);
    const text = writeDesign(next);
    history.record(designs.text, text);
    designs.edit(text);
  }, [doc, designs, history]);
  const historyNow = useRef(history);
  historyNow.current = history;
  useEffect(() => {
    const offUndo = onCommand('undo', () => void historyNow.current.undo());
    const offRedo = onCommand('redo', () => void historyNow.current.redo());
    return () => { offUndo(); offRedo(); };
  }, []);

  /** Shows a box of the canvas in the middle of the view. */
  const showBox = useCallback((box: { x: number; y: number; w: number; h: number }, most: number) => {
    if (!view.current) return;
    const { width, height } = view.current.getBoundingClientRect();
    const next = zoomOnto(box, width, height, 50, most);
    setZoom(next.zoom);
    setPan(next.pan);
  }, []);
  const fit = useCallback(() => {
    if (!doc || doc.frames.length === 0) return;
    showBox(around(doc.frames)!, 2);
  }, [doc, showBox]);
  /** Shift+2: the picked frames and layers fill the view (a layer's place is inside its frame). */
  const zoomToSelection = useCallback(() => {
    if (!doc) return;
    const boxes = selected.map((id) => findNode(doc, id)).filter((a) => a !== null).map((a) => (a.node ? { x: a.frame.x + a.node.x, y: a.frame.y + a.node.y, w: a.node.w, h: a.node.h } : a.frame));
    const box = around(boxes);
    if (box) showBox(box, 4); else fit();
  }, [doc, selected, showBox, fit]);
  const zoomTo = useCallback((z: number) => {
    const el = view.current;
    const next = Math.max(0.05, Math.min(8, Math.round(z * 100) / 100));
    if (!el) { setZoom(next); return; }
    const { width, height } = el.getBoundingClientRect();
    setPan((p) => ({ x: width / 2 - ((width / 2 - p.x) * next) / zoom, y: height / 2 - ((height / 2 - p.y) * next) / zoom }));
    setZoom(next);
  }, [zoom]);
  const fitted = useRef<string | null>(null);
  // A new frame from the toolbar can land off screen: the view fits again once it is there.
  const fitNext = useRef(false);
  useLayoutEffect(() => {
    if (doc && designs.page && fitted.current !== designs.page.path) { fitted.current = designs.page.path; setSelected([]); setTool('move'); fit(); }
    else if (doc && fitNext.current) { fitNext.current = false; fit(); }
  }, [doc, designs.page, fit]);

  /** A point on the screen as a place on the canvas. */
  const toWorld = (clientX: number, clientY: number) => {
    const r = view.current?.getBoundingClientRect();
    return { x: (clientX - (r?.left ?? 0) - pan.x) / zoom, y: (clientY - (r?.top ?? 0) - pan.y) / zoom };
  };
  const frameAt = (d: DesignDoc, x: number, y: number) => [...d.frames].reverse().find((f) => x >= f.x && x <= f.x + f.w && y >= f.y && y <= f.y + f.h) ?? null;

  // Pointer moves are followed live and written once, when the pointer is let go.
  useEffect(() => {
    if (!drag || !doc) return;
    const move = (e: PointerEvent) => {
      if (drag.kind === 'pan') { setPan({ x: drag.panX + e.clientX - drag.startX, y: drag.panY + e.clientY - drag.startY }); return; }
      if (drag.kind === 'move') {
        let dx = Math.round((e.clientX - drag.startX) / zoom), dy = Math.round((e.clientY - drag.startY) / zoom);
        let guides: Guide[] = [];
        const moving = drag.ids.map((id) => findNode(doc, id)).filter((a): a is { frame: DesignFrame; node: DesignNode | null } => a !== null);
        const box = around(moving.map((a) => a.node ?? a.frame));
        if (box && !e.altKey) {
          const others = drag.frame
            ? [{ x: 0, y: 0, w: moving[0]!.frame.w, h: moving[0]!.frame.h }, ...moving[0]!.frame.children.filter((c) => !drag.ids.includes(c.id))]
            : doc.frames.filter((f) => !drag.ids.includes(f.id));
          const snap = snapBox({ ...box, x: box.x + dx, y: box.y + dy }, others, 6 / zoom);
          dx += Math.round(snap.dx); dy += Math.round(snap.dy); guides = snap.guides;
        }
        setDrag({ ...drag, dx, dy, guides, moved: drag.moved || Math.abs(e.clientX - drag.startX) + Math.abs(e.clientY - drag.startY) > 2 });
        return;
      }
      if (drag.kind === 'resize') { setDrag({ ...drag, dx: Math.round((e.clientX - drag.startX) / zoom), dy: Math.round((e.clientY - drag.startY) / zoom), keep: e.shiftKey }); return; }
      const p = toWorld(e.clientX, e.clientY);
      if (drag.kind === 'draw') setDrag({ ...drag, x1: p.x, y1: p.y });
      else setDrag({ ...drag, x1: p.x, y1: p.y, moved: true });
    };
    const up = () => {
      setDrag(null);
      if (drag.kind === 'move' && drag.moved && (drag.dx || drag.dy)) {
        change((d) => { for (const id of drag.ids) { const a = findNode(d, id); const t = a?.node ?? a?.frame; if (t) { t.x += drag.dx; t.y += drag.dy; } } });
      } else if (drag.kind === 'resize' && (drag.dx || drag.dy)) {
        change((d) => { const a = findNode(d, drag.id); const t = a?.node ?? a?.frame; if (t) Object.assign(t, resizeBox(t, drag.handle, drag.dx, drag.dy, drag.keep)); });
      } else if (drag.kind === 'draw') {
        draw(drag);
      } else if (drag.kind === 'pick') {
        const box = boxFrom(drag.x0, drag.y0, drag.x1, drag.y1);
        if (!drag.moved) { setSelected(drag.frame ? [drag.frame] : drag.add); return; }
        const f = drag.frame ? doc.frames.find((x) => x.id === drag.frame) : null;
        const hits = f ? boxesTouching(f.children.filter(canPick), { ...box, x: box.x - f.x, y: box.y - f.y }).map((n) => n.id) : boxesTouching(doc.frames, box).map((x) => x.id);
        setSelected([...new Set([...drag.add, ...hits])]);
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, [drag, zoom, change, doc]); // eslint-disable-line react-hooks/exhaustive-deps

  /** A layer (or frame) drawn with a tool; a click without a drag makes one of the usual size there. */
  const draw = (d: Extract<Drag, { kind: 'draw' }>) => {
    let box = boxFrom(d.x0, d.y0, d.x1, d.y1);
    const tiny = box.w < 4 && box.h < 4;
    change((doc2) => {
      if (d.tool === 'frame') {
        const id = freshId(doc2, 'f');
        if (tiny) box = { x: d.x0, y: d.y0, w: 393, h: 852 };
        doc2.frames.push({ id, name: `Frame ${doc2.frames.length + 1}`, x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.w), h: Math.round(box.h), fill: '#ffffff', radius: 0, stroke: 'transparent', strokeWidth: 0, children: [] });
        setSelected([id]);
        return;
      }
      const f = doc2.frames.find((x) => x.id === d.frame);
      if (!f) return;
      const id = freshId(doc2, 'n');
      const w = tiny ? (d.tool === 'text' ? 200 : 100) : box.w, h = tiny ? (d.tool === 'text' ? 32 : 100) : box.h;
      const node: DesignNode = { id, type: d.tool, name: KIND[d.tool], x: Math.round(box.x - f.x), y: Math.round(box.y - f.y), w: Math.round(w), h: Math.round(h), fill: d.tool === 'text' ? 'transparent' : '#d9d9de', radius: 0, opacity: 1, text: d.tool === 'text' ? 'Text' : '', size: 20, weight: 400, color: '#1d1d1f', align: 'left', stroke: 'transparent', strokeWidth: 0 };
      f.children.push(node);
      setSelected([id]);
      if (d.tool === 'text') setEditing(id);
    });
    setTool('move');
  };

  /** From the toolbar: put one in the middle of the frame picked (or the first), as before. */
  const add = (type: NodeType | 'frame') => change((d) => {
    if (type === 'frame') {
      const id = freshId(d, 'f');
      d.frames.push({ id, name: `Frame ${d.frames.length + 1}`, ...nextFramePlace(d), w: 393, h: 852, fill: '#ffffff', radius: 0, stroke: 'transparent', strokeWidth: 0, children: [] });
      setSelected([id]);
      fitNext.current = true;
      return;
    }
    const at = findNode(d, one) ?? (d.frames[0] ? { frame: d.frames[0], node: null } : null);
    if (!at) return;
    const id = freshId(d, 'n');
    const w = type === 'text' ? 200 : 120, h = type === 'text' ? 32 : 120;
    at.frame.children.push({ id, type, name: KIND[type], x: Math.round((at.frame.w - w) / 2), y: Math.round((at.frame.h - h) / 2), w, h, fill: type === 'text' ? 'transparent' : '#d9d9de', radius: 0, opacity: 1, text: type === 'text' ? 'Text' : '', size: 20, weight: 400, color: '#1d1d1f', align: 'left', stroke: 'transparent', strokeWidth: 0 });
    setSelected([id]);
  });
  const remove = useCallback(() => change((d) => {
    // Copies of a component being deleted stay as they look, as plain layers.
    for (const f of d.frames) if (f.component && selected.includes(f.id)) for (const g of d.frames) for (const c of [...g.children]) if (c.type === 'instance' && c.of === f.id && !selected.includes(c.id)) detach(d, c.id);
    d.frames = d.frames.filter((f) => !selected.includes(f.id));
    for (const f of d.frames) f.children = f.children.filter((c) => !selected.includes(c.id));
    setSelected([]);
  }), [change, selected]);
  const nudge = useCallback((dx: number, dy: number) => change((d) => { for (const id of selected) { const at = findNode(d, id); const t = at?.node ?? at?.frame; if (t) { t.x += dx; t.y += dy; } } }), [change, selected]);
  /** Layers copied into the frame they came from (or the one picked), each a little down and right. */
  const pasteNodes = useCallback((from: { frame: string; nodes: DesignNode[] }, offset: number) => change((d) => {
    const target = findNode(d, one)?.frame ?? d.frames.find((f) => f.id === from.frame) ?? d.frames[0];
    if (!target) return;
    const ids: string[] = [];
    for (const n of from.nodes) {
      const id = freshId(d, 'n');
      target.children.push({ ...structuredClone(n), id, name: n.name, x: n.x + offset, y: n.y + offset });
      ids.push(id);
    }
    setSelected(ids);
  }), [change, one]);
  const pickedNodes = (d: DesignDoc) => selected.map((id) => findNode(d, id)).filter((a): a is { frame: DesignFrame; node: DesignNode } => a?.node != null);
  const duplicate = useCallback(() => {
    if (!doc) return;
    const nodes = pickedNodes(doc);
    if (nodes.length > 0) { pasteNodes({ frame: nodes[0]!.frame.id, nodes: nodes.map((a) => a.node) }, 16); return; }
    change((d) => {
      const ids: string[] = [];
      for (const id of selected) {
        const f = d.frames.find((x) => x.id === id);
        if (!f) continue;
        const copy = structuredClone(f);
        copy.id = freshId(d, 'f');
        copy.name = `${f.name} copy`;
        Object.assign(copy, nextFramePlace(d));
        copy.children = copy.children.map((c) => ({ ...c, id: `${copy.id}-${c.id}` }));
        d.frames.push(copy);
        ids.push(copy.id);
      }
      setSelected(ids);
    });
  }, [doc, selected, change, pasteNodes]); // eslint-disable-line react-hooks/exhaustive-deps
  const arrange = (by: 1 | -1 | 'front' | 'back') => change((d) => {
    for (const a of pickedNodes(d)) {
      const list = a.frame.children;
      const i = list.indexOf(a.node);
      list.splice(i, 1);
      const to = by === 'front' ? list.length : by === 'back' ? 0 : Math.max(0, Math.min(list.length, i + by));
      list.splice(to, 0, a.node);
    }
  });
  const copyPicked = () => {
    const nodes = doc ? pickedNodes(doc) : [];
    if (nodes.length) copied.current = { frame: nodes[0]!.frame.id, nodes: structuredClone(nodes.map((a) => a.node)) };
    return nodes.length > 0;
  };
  /** Hide or lock the picked layers; if every one already is, show or unlock them all. */
  const toggle = (flag: 'hidden' | 'locked', ids = selected) => change((d) => {
    const nodes = ids.map((id) => findNode(d, id)?.node).filter((n): n is DesignNode => n != null);
    const on = !nodes.every((n) => n[flag]);
    for (const n of nodes) { if (on) n[flag] = true; else delete n[flag]; }
  });
  const dropLayer = () => {
    const m = moving;
    setMoving(null);
    if (!m?.target || !m.place || m.target === m.id) return;
    change((d) => { moveLayer(d, m.id, m.target!, m.place!); });
  };
  const line = (how: AlignHow) => change((d) => {
    const nodes = pickedNodes(d);
    if (nodes.length === 1) { const [a] = nodes; Object.assign(a!.node, alignBoxes([a!.node], how, { x: 0, y: 0, w: a!.frame.w, h: a!.frame.h })[0]); return; }
    const places = alignBoxes(nodes.map((a) => a.node), how);
    nodes.forEach((a, i) => Object.assign(a.node, places[i]));
  });
  const spread = (axis: 'x' | 'y') => change((d) => {
    const nodes = pickedNodes(d);
    const places = distributeBoxes(nodes.map((a) => a.node), axis);
    nodes.forEach((a, i) => Object.assign(a.node, places[i]));
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (!t?.closest('.design-page') && t !== document.body) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (mod && (key === 'z' || key === 'y')) { e.preventDefault(); if (key === 'y' || e.shiftKey) history.redo(); else history.undo(); return; }
      if (mod && key === 'a' && doc) { e.preventDefault(); const f = findNode(doc, selected[0] ?? null)?.frame ?? doc.frames[0]; setSelected(f ? f.children.filter(canPick).map((c) => c.id) : []); return; }
      if (mod && e.altKey && key === 'k') { e.preventDefault(); createComponent(); return; }
      if (mod && e.shiftKey && (key === 'h' || key === 'l')) { e.preventDefault(); toggle(key === 'h' ? 'hidden' : 'locked'); return; }
      if (mod && key === 'd') { e.preventDefault(); duplicate(); return; }
      if (mod && key === 'c') { if (copyPicked()) e.preventDefault(); return; }
      if (mod && key === 'x') { if (copyPicked()) { e.preventDefault(); remove(); } return; }
      if (mod && key === 'v' && copied.current) { e.preventDefault(); pasteNodes(copied.current, 16); return; }
      if (mod && (e.key === ']' || e.key === '[')) { e.preventDefault(); arrange(e.key === ']' ? (e.altKey ? 'front' : 1) : (e.altKey ? 'back' : -1)); return; }
      if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); zoomTo(zoom * 1.25); return; }
      if (mod && e.key === '-') { e.preventDefault(); zoomTo(zoom * 0.8); return; }
      if (e.shiftKey && e.code === 'Digit1') { e.preventDefault(); fit(); return; }
      if (e.shiftKey && e.code === 'Digit2') { e.preventDefault(); zoomToSelection(); return; }
      if (e.shiftKey && e.code === 'Digit0') { e.preventDefault(); zoomTo(1); return; }
      if (e.key === ' ' && !e.repeat) { setSpace(true); e.preventDefault(); return; }
      if (!mod && !e.altKey && TOOL_KEYS[key] && !e.shiftKey) { e.preventDefault(); setTool(TOOL_KEYS[key]!); return; }
      if (e.key === 'Escape') { if (tool !== 'move') setTool('move'); else setSelected([]); return; }
      if (selected.length === 0) return;
      const step = e.shiftKey ? 10 : 1;
      if (e.key === 'Enter' && one && doc && findNode(doc, one)?.node?.type === 'text') { e.preventDefault(); setEditing(one); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); nudge(-step, 0); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); nudge(step, 0); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); nudge(0, -step); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); nudge(0, step); }
    };
    const onUp = (e: KeyboardEvent) => { if (e.key === ' ') setSpace(false); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onUp);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onUp); };
  }); // eslint-disable-line react-hooks/exhaustive-deps

  if (!designs.page) return <section className="design-page empty" aria-label="Design"><EmptyState app="design" label="No design open" title={designs.notebooks.some((n) => n.pages.length) ? 'No design open' : 'No designs yet'} line="Choose one on the left, or start a new one." action={{ label: 'New design', run: () => newItemIn(designs, null, DESIGN_WORDS.defaultGroup) }} /></section>;
  if (!doc) {
    return (
      <section className="design-page empty" aria-label="Design">
        <p className="note-empty">This design could not be read ({parsed && 'error' in parsed ? parsed.error : 'unknown'}). Fix the file, or put back what Mobius changed.</p>
      </section>
    );
  }

  const at = findNode(doc, one);
  const picked = pickedNodes(doc);
  const setNode = (fn: (n: DesignNode) => void) => change((d) => { const n = findNode(d, one)?.node; if (n) fn(n); });
  const setFrame = (fn: (f: DesignFrame) => void) => change((d) => { const f = findNode(d, one)?.frame; if (f) fn(f); });
  const textContrast = at?.node?.type === 'text' ? contrast(resolveColor(at.node.color, doc.styles), resolveColor(at.frame.fill, doc.styles)) : null;
  const showReview = changed.size > 0;
  const isPicked = (id: string) => selected.includes(id);
  /** Where a frame or layer is drawn right now, with any move or resize under way. */
  const live = (t: { id: string; x: number; y: number; w: number; h: number }) => {
    if (drag?.kind === 'move' && drag.ids.includes(t.id)) return { x: t.x + drag.dx, y: t.y + drag.dy, w: t.w, h: t.h };
    if (drag?.kind === 'resize' && drag.id === t.id) return resizeBox(t, drag.handle, drag.dx, drag.dy, drag.keep);
    return { x: t.x, y: t.y, w: t.w, h: t.h };
  };
  const nodeStyle = (n: DesignNode): CSSProperties => {
    const p = live(n);
    return {
      left: p.x, top: p.y, width: p.w, height: p.h, opacity: n.opacity,
      background: n.fill === 'transparent' ? undefined : resolveColor(n.fill, doc.styles),
      borderRadius: n.type === 'ellipse' ? '50%' : n.radius,
      ...(n.type !== 'text' ? strokeStyle(n, doc) : {}),
      ...(n.type === 'text' ? { color: resolveColor(n.color, doc.styles), fontSize: n.size, fontWeight: n.weight, textAlign: n.align, lineHeight: 1.25 } : {}),
    };
  };
  const pick = (id: string, shift: boolean) => setSelected((was) => (shift ? (was.includes(id) ? was.filter((x) => x !== id) : [...was.filter((x) => findNode(doc, x)?.node != null === (findNode(doc, id)?.node != null)), id]) : [id]));
  const startMove = (e: ReactPointerEvent, id: string, frame: string | null) => {
    if (e.button !== 0 || tool !== 'move' || space) return;
    e.stopPropagation();
    // A second press on a text layer soon after the first starts typing on it. This is counted here rather than left
    // to a double-click event, which a slow page can lose between the two presses.
    const last = lastPress.current;
    lastPress.current = { id, t: e.timeStamp, x: e.clientX, y: e.clientY };
    if (last && last.id === id && e.timeStamp - last.t < 450 && Math.abs(e.clientX - last.x) + Math.abs(e.clientY - last.y) < 6 && findNode(doc, id)?.node?.type === 'text') {
      lastPress.current = null;
      setSelected([id]);
      // Opened once the press is over, so the focus the press moves does not close the field straight away.
      window.addEventListener('pointerup', () => setEditing(id), { once: true });
      return;
    }
    const ids = selected.includes(id) && !e.shiftKey ? selected : e.shiftKey ? (selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]) : [id];
    if (!selected.includes(id) || e.shiftKey) pick(id, e.shiftKey);
    if (e.shiftKey && selected.includes(id)) return;
    setDrag({ kind: 'move', ids: ids.filter((x) => (findNode(doc, x)?.node != null) === (frame !== null)), startX: e.clientX, startY: e.clientY, dx: 0, dy: 0, guides: [], frame, moved: false });
  };
  const onCanvasDown = (e: ReactPointerEvent) => {
    view.current?.focus();
    if (e.button === 1 || (e.button === 0 && space)) { e.preventDefault(); setDrag({ kind: 'pan', startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y }); return; }
    if (e.button !== 0) return;
    const p = toWorld(e.clientX, e.clientY);
    const f = frameAt(doc, p.x, p.y);
    if (tool !== 'move') {
      if (tool !== 'frame' && !f) return;
      setDrag({ kind: 'draw', tool, frame: f?.id ?? null, x0: p.x, y0: p.y, x1: p.x, y1: p.y });
      return;
    }
    // On a frame's empty part a drag picks its layers with a box; on the canvas it picks frames. A click picks the frame, or nothing.
    setDrag({ kind: 'pick', frame: f?.id ?? null, x0: p.x, y0: p.y, x1: p.x, y1: p.y, add: e.shiftKey ? selected : [], moved: false });
  };
  const handleBox = (t: { id: string; x: number; y: number; w: number; h: number }, inFrame: boolean) => {
    const q = live(t);
    return inFrame ? { left: q.x, top: q.y, width: q.w, height: q.h } : { left: 0, top: 0, width: q.w, height: q.h };
  };
  const pickBox = drag?.kind === 'pick' && drag.moved ? boxFrom(drag.x0, drag.y0, drag.x1, drag.y1) : drag?.kind === 'draw' ? boxFrom(drag.x0, drag.y0, drag.x1, drag.y1) : null;
  const editingNode = editing ? findNode(doc, editing) : null;
  /** A right-click picks what is under the pointer (unless it is already picked) and opens its menu there. */
  const openMenu = (e: React.MouseEvent, id: string | null) => {
    e.preventDefault();
    e.stopPropagation();
    if (id === null) setSelected([]);
    else if (!selected.includes(id)) setSelected([id]);
    setMenu({ x: e.clientX, y: e.clientY });
  };
  /** Draws the frame and saves it as a PNG in Photo's Design exports album. */
  const exportPng = async (id: string) => {
    const f = doc.frames.find((x) => x.id === id);
    if (!f) return;
    setExported({ frame: id, text: 'Exporting…' });
    const done = await exportFrame(doc, f, exportScale).catch((e: unknown) => ({ error: e instanceof Error ? e.message : 'The picture could not be saved.' }));
    setExported('error' in done ? { frame: id, text: done.error, bad: true } : { frame: id, text: `Saved to Photo › ${EXPORT_ALBUM} as ${done.path.slice(EXPORT_ALBUM.length + 1)}` });
  };
  /** Ctrl+Alt+K: the picked layers become a component, with a copy left where they were. */
  const createComponent = () => {
    const nodes = picked.filter((a) => a.node.type !== 'instance');
    if (nodes.length === 0) return;
    // Named after its biggest layer: a button's background, a card's panel.
    const name = [...nodes].sort((x, y) => y.node.w * y.node.h - x.node.w * x.node.h)[0]!.node.name;
    let made: { component: string; copy: string } | null = null;
    change((d) => { made = makeComponent(d, nodes[0]!.frame.id, nodes.filter((a) => a.frame.id === nodes[0]!.frame.id).map((a) => a.node.id), name); });
    if (made) setSelected([(made as { copy: string }).copy]);
  };
  /** A new copy of a component in the middle of the first frame that is not a component. */
  const insertCopy = (componentId: string) => {
    let id: string | null = null;
    change((d) => {
      const main = d.frames.find((f) => f.id === componentId);
      const into = d.frames.find((f) => !f.component);
      if (!main || !into) return;
      const copy = copyOf(d, main, (into.w - main.w) / 2, (into.h - main.h) / 2);
      into.children.push(copy);
      id = copy.id;
    });
    if (id) setSelected([id]);
  };
  const goToComponent = (copyId: string) => {
    const n = findNode(doc, copyId)?.node;
    const main = n && componentOf(doc, n);
    if (!main) return;
    setSelected([main.id]);
    showBox(main, 2);
  };
  const detachCopy = (copyId: string) => {
    let ids: string[] = [];
    change((d) => { ids = detach(d, copyId); });
    setSelected(ids);
  };
  const menuItems = (): ContextMenuItem[] => {
    const paste: ContextMenuItem = { action: 'paste', keys: 'Ctrl+V', disabled: !copied.current, run: () => { if (copied.current) pasteNodes(copied.current, 16); } };
    if (selected.length === 0) return [paste, { label: 'Zoom to fit', keys: 'Shift+1', separated: true, run: fit }];
    const zoomIn: ContextMenuItem = { label: 'Zoom to selection', keys: 'Shift+2', separated: true, run: zoomToSelection };
    const rename: ContextMenuItem = { action: 'rename', label: 'Rename…', disabled: !one, run: () => { if (one) setRenaming(one); } };
    if (picked.length === 0) {
      const exportOne: ContextMenuItem = { label: 'Export as PNG', separated: true, disabled: !one, run: () => { if (one) void exportPng(one); } };
      const frame = one ? doc.frames.find((f) => f.id === one) : null;
      const asComponent: ContextMenuItem = frame?.component
        ? { label: 'Insert a copy', separated: true, disabled: !doc.frames.some((f) => !f.component), run: () => insertCopy(frame.id) }
        : { label: 'Make into component', separated: true, disabled: !frame, run: () => { if (frame) setFrame((f) => { f.component = true; }); } };
      return [paste, { action: 'duplicate', keys: 'Ctrl+D', run: duplicate }, rename, asComponent, exportOne, zoomIn, { action: 'delete', label: selected.length > 1 ? 'Delete frames' : 'Delete frame', keys: 'Delete', danger: true, separated: true, run: remove }];
    }
    const allHidden = picked.every((a) => a.node.hidden), allLocked = picked.every((a) => a.node.locked);
    return [
      { action: 'cut', keys: 'Ctrl+X', run: () => { if (copyPicked()) remove(); } },
      { action: 'copy', keys: 'Ctrl+C', run: () => void copyPicked() },
      paste,
      { action: 'duplicate', keys: 'Ctrl+D', run: duplicate },
      rename,
      { label: 'Bring to front', keys: 'Ctrl+Alt+]', separated: true, run: () => arrange('front') },
      { label: 'Send to back', keys: 'Ctrl+Alt+[', run: () => arrange('back') },
      one && at?.node?.type === 'instance'
        ? { label: 'Go to main component', separated: true, disabled: !componentOf(doc, at.node), run: () => goToComponent(one) }
        : { label: 'Create component', keys: 'Ctrl+Alt+K', separated: true, disabled: !picked.some((a) => a.node.type !== 'instance'), run: createComponent },
      ...(one && at?.node?.type === 'instance' ? [{ label: 'Detach', disabled: !componentOf(doc, at.node), run: () => detachCopy(one) }] : []),
      { label: allHidden ? 'Show' : 'Hide', keys: 'Ctrl+Shift+H', separated: true, run: () => toggle('hidden') },
      { label: allLocked ? 'Unlock' : 'Lock', keys: 'Ctrl+Shift+L', run: () => toggle('locked') },
      zoomIn,
      { action: 'delete', label: picked.length > 1 ? 'Delete layers' : 'Delete layer', keys: 'Delete', danger: true, separated: true, run: remove },
    ];
  };

  return (
    <section className="design-page" aria-label="Design">
      <div className="design-bar" role="toolbar" aria-label="Design tools">
        <div className="design-tools">
          <button type="button" className="design-tool" aria-pressed={tool === 'move'} aria-label="Move" title="Move (V)" onClick={() => setTool('move')}><Icon d={ICON.move} /></button>
          <span className="design-tools-sep" aria-hidden="true" />
          <button type="button" className="design-tool" aria-pressed={tool === 'frame'} aria-label="Frame" title="Frame (F): click to add one, or press F and drag on the canvas" onClick={() => add('frame')}><Icon d={ICON.frame} /></button>
          <button type="button" className="design-tool" aria-pressed={tool === 'rect'} aria-label="Rectangle" title="Rectangle (R): click to add one, or press R and drag" disabled={doc.frames.length === 0} onClick={() => add('rect')}><Icon d={ICON.rect} /></button>
          <button type="button" className="design-tool" aria-pressed={tool === 'ellipse'} aria-label="Ellipse" title="Ellipse (O): click to add one, or press O and drag" disabled={doc.frames.length === 0} onClick={() => add('ellipse')}><Icon d={ICON.ellipse} /></button>
          <button type="button" className="design-tool" aria-pressed={tool === 'text'} aria-label="Text" title="Text (T): click to add one, or press T and drag" disabled={doc.frames.length === 0} onClick={() => add('text')}><Icon d={ICON.text} /></button>
        </div>
        {tool !== 'move' && <span className="design-tool-hint" role="status">Drag on {tool === 'frame' ? 'the canvas' : 'a frame'} to draw {TOOL_NAME[tool]} · Esc to stop</span>}
        <span className="design-bar-gap" />
        <div className="design-zoombox">
          <button type="button" className="strip-btn" aria-label="Zoom out" title="Zoom out (Ctrl+−)" onClick={() => zoomTo(zoom * 0.8)}><Icon d="M5 10h10" /></button>
          <button type="button" className="design-zoom" aria-label="Zoom" title="Actual size (Shift+0)" onClick={() => zoomTo(1)}>{Math.round(zoom * 100)}%</button>
          <button type="button" className="strip-btn" aria-label="Zoom in" title="Zoom in (Ctrl+=)" onClick={() => zoomTo(zoom * 1.25)}><Icon d="M5 10h10M10 5v10" /></button>
        </div>
        <button type="button" className="btn" title="Fit everything (Shift+1)" onClick={fit}>Fit</button>
      </div>
      <div className="design-body">
        <nav className="design-layers" aria-label="Layers">
          <div className="design-panel-title">Layers</div>
          <ul role="tree" aria-label="Frames and layers" aria-multiselectable>
            {doc.frames.map((f) => (
              <li key={f.id} role="treeitem" aria-selected={isPicked(f.id)} aria-expanded data-drop={moving?.target === f.id || undefined} onDragOver={(e) => { if (!moving) return; e.preventDefault(); if (moving.target !== f.id) setMoving({ id: moving.id, target: f.id, place: 'above' }); }} onDrop={(e) => { e.preventDefault(); dropLayer(); }}>
                {renaming === f.id ? <RenameField name={f.name} onDone={(name) => { setRenaming(null); if (name && name !== f.name) change((d) => { const x = d.frames.find((y) => y.id === f.id); if (x) x.name = name; }); }} /> : (
                  <button type="button" className="design-layer" data-frame aria-current={isPicked(f.id) || undefined} data-changed={changed.has(f.id) || undefined} onClick={(e) => pick(f.id, e.shiftKey)} onDoubleClick={() => setRenaming(f.id)} onContextMenu={(e) => openMenu(e, f.id)}>
                    <span className="design-layer-kind" aria-hidden="true" data-component={f.component || undefined}><Icon d={f.component ? ICON.component : ICON.frame} /></span>{f.name}
                  </button>
                )}
                <ul role="group">
                  {[...f.children].reverse().map((n) => (
                    <li key={n.id} role="treeitem" aria-selected={isPicked(n.id)} data-drop={moving?.target === n.id ? moving.place : undefined}
                      draggable={renaming !== n.id} onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', n.name); setMoving({ id: n.id }); }} onDragEnd={() => setMoving(null)}
                      onDragOver={(e) => { if (!moving) return; e.preventDefault(); e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); const place = e.clientY < r.top + r.height / 2 ? 'above' : 'below'; if (moving.target !== n.id || moving.place !== place) setMoving({ id: moving.id, target: n.id, place }); }}
                      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); dropLayer(); }}>
                      {renaming === n.id ? <RenameField name={n.name} onDone={(name) => { setRenaming(null); if (name && name !== n.name) change((d) => { const x = findNode(d, n.id)?.node; if (x) x.name = name; }); }} /> : (
                        <div className="design-layer-row" aria-current={isPicked(n.id) || undefined} data-hidden={n.hidden || undefined}>
                          <button type="button" className="design-layer" aria-current={isPicked(n.id) || undefined} data-changed={changed.has(n.id) || undefined} onClick={(e) => pick(n.id, e.shiftKey)} onDoubleClick={() => setRenaming(n.id)} onContextMenu={(e) => openMenu(e, n.id)}>
                            <span className="design-layer-kind" aria-hidden="true" data-component={n.type === 'instance' || undefined}><Icon d={ICON[n.type]} /></span><span className="design-layer-name">{n.name}</span>
                          </button>
                          <button type="button" className="design-layer-flag" data-on={n.locked || undefined} aria-label={`${n.locked ? 'Unlock' : 'Lock'} ${n.name}`} title={n.locked ? 'Unlock (Ctrl+Shift+L)' : 'Lock (Ctrl+Shift+L)'} onClick={() => toggle('locked', [n.id])}><Icon d={n.locked ? ICON.locked : ICON.unlocked} /></button>
                          <button type="button" className="design-layer-flag" data-on={n.hidden || undefined} aria-label={`${n.hidden ? 'Show' : 'Hide'} ${n.name}`} title={n.hidden ? 'Show (Ctrl+Shift+H)' : 'Hide (Ctrl+Shift+H)'} onClick={() => toggle('hidden', [n.id])}><Icon d={n.hidden ? ICON.hidden : ICON.shown} /></button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </nav>
        <div
          className="design-view"
          ref={view}
          role="application"
          aria-label="Canvas"
          tabIndex={0}
          data-tool={tool}
          data-panning={space || drag?.kind === 'pan' || undefined}
          onPointerDown={onCanvasDown}
          onContextMenu={(e) => { const p = toWorld(e.clientX, e.clientY); openMenu(e, frameAt(doc, p.x, p.y)?.id ?? null); }}
          onWheel={(e) => {
            if (e.ctrlKey || e.metaKey) {
              const rect = e.currentTarget.getBoundingClientRect();
              const z = Math.max(0.05, Math.min(8, zoom * (e.deltaY < 0 ? 1.1 : 0.9)));
              const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
              setPan({ x: cx - ((cx - pan.x) * z) / zoom, y: cy - ((cy - pan.y) * z) / zoom });
              setZoom(Math.round(z * 100) / 100);
            } else setPan((p) => ({ x: p.x - (e.shiftKey ? e.deltaY : e.deltaX), y: p.y - (e.shiftKey ? 0 : e.deltaY) }));
          }}
        >
          <div className="design-world" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, ['--z' as string]: zoom }}>
            {doc.frames.map((f) => {
              const p = live(f);
              const inThis = one !== null && at?.frame.id === f.id;
              return (
                <div key={f.id} className="design-frame" data-selected={isPicked(f.id) || undefined} data-proposed={changed.has(f.id) || undefined} aria-label={`Frame ${f.name}`} style={{ left: p.x, top: p.y, width: p.w, height: p.h, background: resolveColor(f.fill, doc.styles), borderRadius: f.radius }}>
                  <span className="design-frame-name" style={{ fontSize: 12 / zoom, top: -18 / zoom }} onPointerDown={(e) => startMove(e, f.id, null)} onDoubleClick={() => setRenaming(f.id)} onContextMenu={(e) => openMenu(e, f.id)}>{f.name}</span>
                  <div className="design-clip" style={{ borderRadius: f.radius }}>
                    {f.children.filter((n) => !n.hidden).map((n) => (
                      <div key={n.id} className="design-node" data-type={n.type} data-locked={n.locked || undefined} data-selected={isPicked(n.id) || undefined} data-proposed={changed.has(n.id) || undefined} data-editing={editing === n.id || undefined} aria-label={`${KIND[n.type]} ${n.name}`} style={nodeStyle(n)} onPointerDown={(e) => startMove(e, n.id, f.id)} onContextMenu={(e) => openMenu(e, n.id)} onDoubleClick={() => { if (n.type === 'text' && editing !== n.id) setEditing(n.id); }}>
                        {n.type === 'text' && editing !== n.id ? n.text : null}
                        {n.type === 'instance' && <CopyView copy={n} main={componentOf(doc, n)} styleOf={nodeStyle} doc={doc} />}
                      </div>
                    ))}
                    {editingNode?.node && editingNode.frame.id === f.id && (
                      <TextOnCanvas key={editingNode.node.id} node={editingNode.node} style={nodeStyle(editingNode.node)} onDone={(text) => { const id = editing; setEditing(null); if (text !== null && id) change((d) => { const n = findNode(d, id)?.node; if (n) n.text = text; }); }} />
                    )}
                  </div>
                  {f.strokeWidth > 0 && f.stroke !== 'transparent' && <div className="design-frame-stroke" aria-hidden="true" style={{ borderRadius: f.radius, ...strokeStyle(f, doc) }} />}
                  {drag?.kind === 'move' && drag.frame === f.id && drag.guides.map((g, i) => <span key={i} className="design-guide" data-axis={g.axis} style={g.axis === 'x' ? { left: g.at, top: g.from, height: g.to - g.from } : { top: g.at, left: g.from, width: g.to - g.from }} />)}
                  {selected.filter((id) => f.children.some((c) => c.id === id)).length > 1 && f.children.filter((c) => isPicked(c.id)).map((c) => <div key={c.id} className="design-handles" data-many style={handleBox(c, true)} />)}
                  {((inThis && at?.node) || one === f.id) && (() => {
                    const t = at!.node ?? at!.frame;
                    const q = live(t);
                    return (
                      <div className="design-handles" style={handleBox(t, at!.node !== null)}>
                        {HANDLES.filter((h) => handleShown(h, q.w * zoom, q.h * zoom)).map((h) => <span key={h} className="design-handle" data-handle={h} onPointerDown={(e) => { if (e.button !== 0) return; e.stopPropagation(); setDrag({ kind: 'resize', id: t.id, handle: h, startX: e.clientX, startY: e.clientY, dx: 0, dy: 0, keep: e.shiftKey }); }} aria-hidden="true" />)}
                        {drag && (drag.kind === 'move' || drag.kind === 'resize') && <span className="design-size">{drag.kind === 'move' ? `${q.x}, ${q.y}` : `${q.w} × ${q.h}`}</span>}
                      </div>
                    );
                  })()}
                </div>
              );
            })}
            {drag?.kind === 'move' && drag.frame === null && drag.guides.map((g, i) => <span key={i} className="design-guide" data-axis={g.axis} style={g.axis === 'x' ? { left: g.at, top: g.from, height: g.to - g.from } : { top: g.at, left: g.from, width: g.to - g.from }} />)}
            {pickBox && <div className="design-pick" data-draw={drag?.kind === 'draw' ? drag.tool : undefined} style={{ left: pickBox.x, top: pickBox.y, width: pickBox.w, height: pickBox.h }} />}
          </div>
          {showReview && (
            <div className="design-review" role="group" aria-label="Mobius's change" onPointerDown={(e) => e.stopPropagation()}>
              <span className="review-dot" aria-hidden="true" />
              <span>{changed.size === 1 ? 'Mobius changed one layer here, dashed.' : `Mobius changed ${changed.size} layers here, dashed.`}{review && <WhyThis conversation={review.conversation} />}</span>
              <ReviewActions onKeep={keep} onDiscard={discard} />
            </div>
          )}
        </div>
        <aside className="design-inspector" aria-label="Inspector">
          {selected.length === 0 && (
            <>
              <div className="design-panel-title">Colour styles</div>
              {doc.styles.length === 0 && <p className="design-hint">None yet. A style is a named colour layers can use, so changing it changes them all.</p>}
              <ul className="design-styles" aria-label="Colour styles">
                {doc.styles.map((s, i) => (
                  <li key={i}>
                    <input type="color" aria-label={`${s.name} colour`} value={/^#[0-9a-f]{6}/i.test(s.color) ? s.color.slice(0, 7) : '#000000'} onChange={(e) => change((d) => { d.styles[i]!.color = e.target.value; })} />
                    <span>{s.name}</span>
                    <code>{s.color}</code>
                  </li>
                ))}
              </ul>
              <button type="button" className="btn" onClick={() => change((d) => { let n = d.styles.length + 1; while (d.styles.some((s) => s.name === `Colour ${n}`)) n++; d.styles.push({ name: `Colour ${n}`, color: '#5856d6' }); })}>Add style</button>
            </>
          )}
          {selected.length > 1 && (
            <>
              <div className="design-panel-title">{picked.length > 0 ? `${picked.length} layers` : `${selected.length} frames`}</div>
              {picked.length > 1 && <AlignBar onAlign={line} onSpread={picked.length > 2 ? spread : undefined} />}
              {picked.some((a) => a.node.type !== 'instance') && <button type="button" className="btn" title="Create component (Ctrl+Alt+K)" onClick={createComponent}>Create component</button>}
              <button type="button" className="btn danger" onClick={remove}>{picked.length > 0 ? 'Delete layers' : 'Delete frames'}</button>
            </>
          )}
          {one && at && !at.node && (
            <>
              <div className="design-panel-title">Frame</div>
              <label className="design-text"><span>Name</span><input aria-label="Name" value={at.frame.name} maxLength={80} onChange={(e) => setFrame((f) => { f.name = e.target.value; })} /></label>
              <Section title="Position">
                <div className="design-grid">
                  <Field label="X" value={at.frame.x} onChange={(v) => setFrame((f) => { f.x = v; })} />
                  <Field label="Y" value={at.frame.y} onChange={(v) => setFrame((f) => { f.y = v; })} />
                  <Field label="W" value={at.frame.w} min={1} onChange={(v) => setFrame((f) => { f.w = v; })} />
                  <Field label="H" value={at.frame.h} min={1} onChange={(v) => setFrame((f) => { f.h = v; })} />
                  <Field label="Radius" value={at.frame.radius} min={0} onChange={(v) => setFrame((f) => { f.radius = v; })} wide />
                </div>
                <div className="design-presets" role="group" aria-label="Size">
                  {[['iPhone', 393, 852], ['iPad', 820, 1180], ['Mac', 1440, 900], ['Square', 1080, 1080]].map(([label, w, h]) => (
                    <button key={label} type="button" aria-pressed={at.frame.w === w && at.frame.h === h} onClick={() => setFrame((f) => { f.w = w as number; f.h = h as number; })}>{label}</button>
                  ))}
                </div>
              </Section>
              <Section title="Fill"><ColorField label="Fill" bare value={at.frame.fill} doc={doc} onChange={(c) => setFrame((f) => { f.fill = c; })} /></Section>
              <BorderSection item={at.frame} doc={doc} onChange={(stroke, width) => setFrame((f) => { f.stroke = stroke; f.strokeWidth = width; })} />
              <Section title="Component">
                {at.frame.component ? (
                  <>
                    <p className="design-hint">{(() => { const n = doc.frames.reduce((k, f) => k + f.children.filter((c) => c.type === 'instance' && c.of === at.frame.id).length, 0); return n === 0 ? 'No copies yet. Changes here show in every copy.' : n === 1 ? 'One copy. Changes here show in it too.' : `${n} copies. Changes here show in all of them.`; })()}</p>
                    <div className="design-row">
                      <button type="button" className="btn" disabled={!doc.frames.some((f) => !f.component)} onClick={() => insertCopy(at.frame.id)}>Insert a copy</button>
                      <button type="button" className="btn" onClick={() => setFrame((f) => { delete f.component; })}>Not a component</button>
                    </div>
                  </>
                ) : <button type="button" className="btn" onClick={() => setFrame((f) => { f.component = true; })}>Make into component</button>}
              </Section>
              <Section title="Export">
                <div className="design-export">
                  <div className="design-segment" role="radiogroup" aria-label="Export size">
                    {[1, 2, 3].map((x) => <button key={x} type="button" role="radio" aria-checked={exportScale === x} onClick={() => setExportScale(x)}>{x}×</button>)}
                  </div>
                  <button type="button" className="btn" onClick={() => void exportPng(at.frame.id)}>Export PNG</button>
                </div>
                {exported?.frame === at.frame.id && <p className="design-hint" role="status" data-bad={exported.bad || undefined}>{exported.text}</p>}
              </Section>
              <button type="button" className="btn danger" onClick={remove}>Delete frame</button>
            </>
          )}
          {one && at?.node && (
            <>
              <div className="design-panel-title">{at.node.type === 'instance' ? `Copy of ${componentOf(doc, at.node)?.name ?? 'a missing component'}` : KIND[at.node.type]}</div>
              <AlignBar onAlign={line} />
              <label className="design-text"><span>Name</span><input aria-label="Name" value={at.node.name} maxLength={80} onChange={(e) => setNode((n) => { n.name = e.target.value; })} /></label>
              <Section title="Position">
                <div className="design-grid">
                  <Field label="X" value={at.node.x} onChange={(v) => setNode((n) => { n.x = v; })} />
                  <Field label="Y" value={at.node.y} onChange={(v) => setNode((n) => { n.y = v; })} />
                  <Field label="W" value={at.node.w} min={1} onChange={(v) => setNode((n) => { n.w = v; })} />
                  <Field label="H" value={at.node.h} min={1} onChange={(v) => setNode((n) => { n.h = v; })} />
                  {at.node.type === 'rect' && <Field label="Radius" value={at.node.radius} min={0} onChange={(v) => setNode((n) => { n.radius = v; })} />}
                  <Field label="Opacity" value={Math.round(at.node.opacity * 100)} min={0} onChange={(v) => setNode((n) => { n.opacity = Math.min(100, v) / 100; })} />
                </div>
              </Section>
              {at.node.type === 'instance' && <CopySection copy={at.node} main={componentOf(doc, at.node)} doc={doc} onOverride={(id, o) => setNode((n) => { const next = { ...(n.overrides ?? {}) }; if (o) next[id] = { ...next[id], ...o }; else delete next[id]; n.overrides = next; })} onReset={() => setNode((n) => { n.overrides = {}; })} onGo={() => goToComponent(at.node!.id)} onDetach={() => detachCopy(at.node!.id)} />}
              {at.node.type === 'text' && (
                <Section title="Text">
                  <label className="design-text"><span>Text</span><textarea aria-label="Text" value={at.node.text} rows={3} maxLength={2000} onChange={(e) => setNode((n) => { n.text = e.target.value; })} /></label>
                  <div className="design-grid">
                    <Field label="Size" value={at.node.size} min={4} onChange={(v) => setNode((n) => { n.size = v; })} />
                    <label className="design-field" data-wide><span>Weight</span>
                      <select aria-label="Weight" value={at.node.weight} onChange={(e) => setNode((n) => { n.weight = Number(e.target.value); })}>
                        {[[300, 'Light'], [400, 'Regular'], [500, 'Medium'], [600, 'Semibold'], [700, 'Bold'], [800, 'Heavy']].map(([w, name]) => <option key={w} value={w}>{name}</option>)}
                        {![300, 400, 500, 600, 700, 800].includes(at.node.weight) && <option value={at.node.weight}>{at.node.weight}</option>}
                      </select>
                    </label>
                  </div>
                  <div className="design-segment" role="radiogroup" aria-label="Align">
                    {(['left', 'center', 'right'] as Align[]).map((a) => (
                      <button key={a} type="button" role="radio" aria-checked={at.node!.align === a} aria-label={a === 'center' ? 'Centre' : a === 'left' ? 'Left' : 'Right'} onClick={() => setNode((n) => { n.align = a; })}>
                        <Icon d={a === 'left' ? 'M3 5h14M3 9h9M3 13h14M3 17h9' : a === 'center' ? 'M3 5h14M5.5 9h9M3 13h14M5.5 17h9' : 'M3 5h14M8 9h9M3 13h14M8 17h9'} />
                      </button>
                    ))}
                  </div>
                  <ColorField label="Colour" value={at.node.color} doc={doc} onChange={(c) => setNode((n) => { n.color = c; })} />
                  {textContrast !== null && <p className="design-hint" data-bad={textContrast < 4.5 || undefined}>Contrast with the frame {textContrast}:1 · {textContrast >= 4.5 ? 'passes AA' : 'below AA (4.5:1)'}</p>}
                </Section>
              )}
              {at.node.type !== 'instance' && <Section title="Fill"><ColorField label="Fill" bare value={at.node.fill} doc={doc} onChange={(c) => setNode((n) => { n.fill = c; })} /></Section>}
              {at.node.type !== 'text' && at.node.type !== 'instance' && <BorderSection item={at.node} doc={doc} onChange={(stroke, width) => setNode((n) => { n.stroke = stroke; n.strokeWidth = width; })} />}
              <Section title="Arrange">
                <div className="design-align design-arrange" role="group" aria-label="Arrange">
                  {([['front', 'Bring to front (Ctrl+Alt+])', ICON.front], [1, 'Bring forward (Ctrl+])', ICON.forward], [-1, 'Send backward (Ctrl+[)', ICON.backward], ['back', 'Send to back (Ctrl+Alt+[)', ICON.back]] as const).map(([by, label, d]) => (
                    <button key={String(by)} type="button" aria-label={label.replace(/ \(.*/, '')} title={label} onClick={() => arrange(by)}><Icon d={d} /></button>
                  ))}
                </div>
              </Section>
              {at.node.type !== 'instance' && <button type="button" className="btn" title="Create component (Ctrl+Alt+K)" onClick={createComponent}>Create component</button>}
              <button type="button" className="btn danger" onClick={remove}>Delete layer</button>
            </>
          )}
        </aside>
      </div>
      {menu && createPortal(<ContextMenu x={menu.x} y={menu.y} label={one && at ? (at.node?.name ?? at.frame.name) : selected.length ? `${selected.length} selected` : 'Canvas'} items={menuItems()} onClose={() => setMenu(null)} />, document.body)}
    </section>
  );
}

/** A border drawn inside the edge, as Figma's inside stroke: an outline pulled in by its own width, so it follows the corners. */
function strokeStyle(t: { stroke: string; strokeWidth: number }, doc: DesignDoc): CSSProperties {
  if (t.strokeWidth <= 0 || t.stroke === 'transparent') return {};
  return { outline: `${t.strokeWidth}px solid ${resolveColor(t.stroke, doc.styles)}`, outlineOffset: -t.strokeWidth };
}

/** Border: none until it is added; then its colour and width, and a way to take it off again. */
function BorderSection({ item, doc, onChange }: { item: { stroke: string; strokeWidth: number }; doc: DesignDoc; onChange: (stroke: string, width: number) => void }) {
  const on = item.strokeWidth > 0 && item.stroke !== 'transparent';
  return (
    <section className="design-section" aria-label="Border">
      <div className="design-section-head">
        <div className="design-section-title">Border</div>
        <button type="button" className="design-section-add" aria-label={on ? 'Remove border' : 'Add border'} title={on ? 'Remove border' : 'Add border'} onClick={() => (on ? onChange('transparent', 0) : onChange('#1d1d1f', 1))}><Icon d={on ? 'M5 10h10' : 'M5 10h10M10 5v10'} /></button>
      </div>
      {on && (
        <div className="design-border">
          <ColorField label="Border" bare value={item.stroke} doc={doc} onChange={(c) => onChange(c, item.strokeWidth)} />
          <Field label="Width" value={item.strokeWidth} min={0} onChange={(v) => onChange(v > 0 ? item.stroke : 'transparent', v)} />
        </div>
      )}
    </section>
  );
}

/**
 * A copy of a component on the canvas: the component's layers as they are now, scaled to the copy's box, with the
 * copy's own text and colours. A copy whose component was removed says so.
 */
function CopyView({ copy, main, styleOf, doc }: { copy: DesignNode; main: DesignFrame | null; styleOf: (n: DesignNode) => CSSProperties; doc: DesignDoc }) {
  if (!main) return <span className="design-copy-missing">Missing component</span>;
  return (
    <div className="design-copy" aria-hidden="true" style={{ width: main.w, height: main.h, transform: `scale(${copy.w / (main.w || 1)}, ${copy.h / (main.h || 1)})`, background: main.fill === 'transparent' ? undefined : resolveColor(main.fill, doc.styles), borderRadius: main.radius }}>
      {main.children.filter((c) => !c.hidden && c.type !== 'instance').map((c) => {
        const shown = withOverride(c, copy);
        return <div key={c.id} className="design-node" data-type={c.type} style={{ ...styleOf(shown), left: c.x, top: c.y, width: c.w, height: c.h }}>{c.type === 'text' ? shown.text : null}</div>;
      })}
    </div>
  );
}

/** A copy's own text and colours, layer by layer, and the way back to its component. */
function CopySection({ copy, main, doc, onOverride, onReset, onGo, onDetach }: { copy: DesignNode; main: DesignFrame | null; doc: DesignDoc; onOverride: (id: string, o: { text?: string; fill?: string; color?: string } | null) => void; onReset: () => void; onGo: () => void; onDetach: () => void }) {
  if (!main) return <Section title="Component"><p className="design-hint" data-bad>Its component is gone.</p></Section>;
  const changedHere = Object.keys(copy.overrides ?? {}).length > 0;
  return (
    <Section title="Content">
      {main.children.filter((c) => c.type === 'text').map((c) => (
        <label key={c.id} className="design-text"><span>{c.name}</span><textarea aria-label={`${c.name} text`} rows={1} maxLength={2000} value={withOverride(c, copy).text} onChange={(e) => onOverride(c.id, e.target.value === c.text ? null : { text: e.target.value })} /></label>
      ))}
      {main.children.filter((c) => c.type === 'rect' || c.type === 'ellipse').map((c) => (
        <ColorField key={c.id} label={c.name} value={withOverride(c, copy).fill} doc={doc} onChange={(col) => onOverride(c.id, { fill: col })} />
      ))}
      <div className="design-row">
        <button type="button" className="btn" title="Select the component this is a copy of" onClick={onGo}>Go to main</button>
        <button type="button" className="btn" onClick={onDetach}>Detach</button>
      </div>
      {changedHere && <button type="button" className="btn" onClick={onReset}>Reset to component</button>}
    </Section>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="design-section" aria-label={title}><div className="design-section-title">{title}</div>{children}</section>;
}

/** Line layers up: to the frame for one, to each other for several, and equal gaps for three or more. */
function AlignBar({ onAlign, onSpread }: { onAlign: (how: AlignHow) => void; onSpread?: ((axis: 'x' | 'y') => void) | undefined }) {
  const items: [AlignHow, string, string][] = [['left', 'Align left', ICON.alignLeft], ['center', 'Align centres', ICON.alignCenter], ['right', 'Align right', ICON.alignRight], ['top', 'Align tops', ICON.alignTop], ['middle', 'Align middles', ICON.alignMiddle], ['bottom', 'Align bottoms', ICON.alignBottom]];
  return (
    <div className="design-align" role="group" aria-label="Align">
      {items.map(([how, label, d]) => <button key={how} type="button" aria-label={label} title={label} onClick={() => onAlign(how)}><Icon d={d} /></button>)}
      {onSpread && <button type="button" aria-label="Space evenly across" title="Space evenly across" onClick={() => onSpread('x')}><Icon d={ICON.spreadX} /></button>}
      {onSpread && <button type="button" aria-label="Space evenly down" title="Space evenly down" onClick={() => onSpread('y')}><Icon d={ICON.spreadY} /></button>}
    </div>
  );
}

/** A layer's or frame's new name, typed in the layer list (double-click). */
function RenameField({ name, onDone }: { name: string; onDone: (name: string | null) => void }) {
  const [text, setText] = useState(name);
  return <input className="design-rename" aria-label="Layer name" autoFocus value={text} maxLength={80} onFocus={(e) => e.target.select()} onChange={(e) => setText(e.target.value)} onBlur={() => onDone(text.trim() || null)} onKeyDown={(e) => { if (e.key === 'Enter') onDone(text.trim() || null); if (e.key === 'Escape') onDone(null); }} />;
}

/**
 * Whether a handle is drawn for a layer this big on screen. On a small layer the middle handles would sit over the
 * layer itself and catch the press meant for it, so, as in Figma, only the corners stay.
 */
function handleShown(h: string, w: number, height: number): boolean {
  if (h === 'n' || h === 's') return w >= 40 && height >= 24;
  if (h === 'e' || h === 'w') return height >= 40 && w >= 24;
  return true;
}

/** Text typed straight on the canvas (double-click a text layer, or Enter): Escape or a click away keeps it. */
function TextOnCanvas({ node, style, onDone }: { node: DesignNode; style: CSSProperties; onDone: (text: string | null) => void }) {
  const [text, setText] = useState(node.text);
  const done = useRef(false);
  const finish = (value: string | null) => { if (done.current) return; done.current = true; onDone(value); };
  return (
    <textarea
      className="design-node design-typing"
      aria-label={`Text of ${node.name}`}
      autoFocus
      value={text}
      style={{ ...style, background: 'transparent', minHeight: style.height }}
      onFocus={(e) => e.target.select()}
      onPointerDown={(e) => e.stopPropagation()}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => finish(text)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); finish(text); }
      }}
    />
  );
}
