import {
  createContext, forwardRef, useCallback, useContext, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState,
  type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode, type Ref,
} from 'react';
import type { ContentColor } from './Bits';
import { IconButton } from './Button';
import { levelPosition } from './Pro';

/**
 * A patch canvas: boxes (a device's parts) joined by cables, as in Music's Workbench. The app keeps the data: where
 * each box sits (`x`, `y` in canvas units, 1 to a pixel at 100%) and which cables run where; the canvas draws them and
 * reports what people do (move, connect, disconnect, remove, select).
 *
 * - A box lists its `inputs` on its left edge and its `outputs` on its right. Its body is `children` (knobs and the
 *   like). A `<Port>` placed inside the body, beside the knob it drives, is a setting a cable can reach: a cable
 *   `to: { box, param }` ends on it.
 * - Ports have a kind (audio, note, control) and, by default, a cable only joins an output to an input of the same
 *   kind on another box. Pass `canConnect` to decide otherwise.
 * - Mouse: drag a box by its head; drag from a port to another (or click one, then the other) to make a cable; click
 *   a cable to choose it. The wheel scrolls, Ctrl+wheel zooms, and Space+drag, a middle drag or a drag on empty canvas
 *   pans. Fit puts everything in view.
 * - Keys: Tab goes from box to box; the arrows go from port to port in a box; Enter on a port starts a cable and
 *   Enter on another ends it; Escape cancels. Delete removes the chosen box or cable, or a focused port's cables.
 *   Alt+arrows nudge a box one grid step (Shift for four).
 * - `levels` feeds each cable its level (`levels.current.set(cableId, db)`) without a re-render; a louder cable is
 *   drawn thicker. A cable takes its source box's colour, or ink. `proposed` boxes and cables are dashed indigo.
 * - `readOnly` shows the patch: choosing and Tab still work, nothing moves or connects.
 */

export type PortKind = 'audio' | 'note' | 'control';
export interface PortSpec { id: string; label: string; kind: PortKind }
export interface PatchBox {
  id: string;
  x: number;
  y: number;
  title: string;
  color?: ContentColor;
  inputs?: readonly PortSpec[];
  outputs?: readonly PortSpec[];
  /** Mobius added it and it waits for Keep. */
  proposed?: boolean;
  /** The box's body. Put a `<Port>` beside a control to let a cable reach it. */
  children?: ReactNode;
}
export interface PortEnd { box: string; port: string }
export interface ParamEnd { box: string; param: string }
export interface PatchCable { id: string; from: PortEnd; to: PortEnd | ParamEnd; proposed?: boolean }
/** One end of a cable as `canConnect` sees it. */
export interface PortInfo { box: string; id: string; kind: PortKind; side: 'in' | 'out'; param: boolean }
export type PatchSelection = { kind: 'box' | 'cable'; id: string } | null;
/** Feed for cable levels: `set(cableId, db)` as often as audio gives it. */
export interface PatchLevels { set: (cable: string, db: number) => void; reset: () => void }

export interface PatchCanvasProps {
  label: string;
  boxes: readonly PatchBox[];
  cables: readonly PatchCable[];
  selected?: PatchSelection;
  onSelect?: (selection: PatchSelection) => void;
  /** While a box is dragged or nudged, at grid steps. */
  onMove?: (box: string, x: number, y: number) => void;
  /** Once a drag or a nudge is done (for undo). */
  onMoveCommit?: (box: string, x: number, y: number) => void;
  onConnect?: (from: PortEnd, to: PortEnd | ParamEnd) => void;
  onDisconnect?: (cable: string) => void;
  onRemove?: (box: string) => void;
  canConnect?: (from: PortInfo, to: PortInfo) => boolean;
  levels?: Ref<PatchLevels>;
  /** Shows the patch only: no moves, cables or removing. */
  readOnly?: boolean;
  /** Grid step in canvas units; boxes snap to it. */
  grid?: number;
  className?: string;
}

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2;
const FIT_PAD = 24;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const keyOf = (box: string, port: string) => `${box}\u001f${port}`;
const bottomKey = (box: string) => `\u001e${box}`;
const endPort = (end: PortEnd | ParamEnd) => ('port' in end ? end.port : end.param);
const snap = (v: number, grid: number) => Math.round(v / grid) * grid;
const useIsoLayout = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * The cable's curve from an output at (x1, y1) to an input at (x2, y2): it leaves rightward and arrives from the left.
 * A cable that runs back (its input is left of its output) loops under the boxes instead, along `below` when given.
 */
export function cablePath(x1: number, y1: number, x2: number, y2: number, below?: number): string {
  if (below !== undefined && x2 < x1 + 24) {
    const r = 24;
    const y = Math.max(below, y1 + r, y2 + r);
    return `M${x1} ${y1}C${x1 + r} ${y1} ${x1 + r} ${y} ${x1} ${y}L${x2} ${y}C${x2 - r} ${y} ${x2 - r} ${y2} ${x2} ${y2}`;
  }
  const bend = Math.max(40, Math.abs(x2 - x1) / 2);
  return `M${x1} ${y1}C${x1 + bend} ${y1} ${x2 - bend} ${y2} ${x2} ${y2}`;
}

/** The default rule: an output to an input of the same kind, on another box. */
export const defaultCanConnect = (from: PortInfo, to: PortInfo): boolean =>
  from.side === 'out' && to.side === 'in' && from.box !== to.box && from.kind === to.kind;

/**
 * Places boxes left to right in signal order: a box's column is the longest run of cables that leads to it, and boxes
 * in a column keep their given order, stacked and centred on the tallest column. For a first placement; keep x and y
 * afterwards. `height` estimates a box's height (by default from its port count).
 */
export function layoutFlow(
  boxes: readonly Pick<PatchBox, 'id' | 'inputs' | 'outputs'>[],
  cables: readonly { from: { box: string }; to: { box: string } }[],
  { column = 224, gap = 24, grid = 8, height }: { column?: number; gap?: number; grid?: number; height?: (box: Pick<PatchBox, 'id' | 'inputs' | 'outputs'>) => number } = {},
): Record<string, { x: number; y: number }> {
  const depth = new Map(boxes.map((b) => [b.id, 0]));
  // A feedback cable (an echo's repeats going back) would push everything after it to the right, so drop the cables
  // that close a loop first: a depth-first walk from the boxes nothing feeds, in the given order, marks them.
  const ids = new Set(boxes.map((b) => b.id));
  const out = new Map<string, number[]>();
  const fed = new Set<string>();
  cables.forEach((c, i) => {
    if (c.from.box === c.to.box || !ids.has(c.from.box) || !ids.has(c.to.box)) return;
    (out.get(c.from.box) ?? out.set(c.from.box, []).get(c.from.box)!).push(i);
    fed.add(c.to.box);
  });
  const back = new Set<number>();
  const state = new Map<string, 1 | 2>(); // 1 on the walk, 2 done
  const walk = (id: string) => {
    state.set(id, 1);
    for (const i of out.get(id) ?? []) {
      const to = cables[i]!.to.box;
      const seen = state.get(to);
      if (seen === 1) back.add(i);
      else if (!seen) walk(to);
    }
    state.set(id, 2);
  };
  for (const b of boxes) if (!fed.has(b.id) && !state.has(b.id)) walk(b.id);
  for (const b of boxes) if (!state.has(b.id)) walk(b.id); // A loop nothing feeds starts at its first box.
  // Longest path over what is left, which has no loops.
  for (let round = 0; round < boxes.length; round++) {
    let changed = false;
    cables.forEach((c, i) => {
      if (back.has(i)) return;
      const from = depth.get(c.from.box);
      const to = depth.get(c.to.box);
      if (from === undefined || to === undefined || c.from.box === c.to.box) return;
      if (from + 1 > to) { depth.set(c.to.box, from + 1); changed = true; }
    });
    if (!changed) break;
  }
  const tall = height ?? ((b) => 40 + Math.max(b.inputs?.length ?? 0, b.outputs?.length ?? 0, 1) * 24);
  const columns: (typeof boxes[number])[][] = [];
  for (const b of boxes) (columns[depth.get(b.id)!] ??= []).push(b);
  const heights = columns.map((col) => (col ?? []).reduce((sum, b, i) => sum + tall(b) + (i ? gap : 0), 0));
  const tallest = Math.max(0, ...heights);
  const placed: Record<string, { x: number; y: number }> = {};
  columns.forEach((col, i) => {
    let y = (tallest - heights[i]!) / 2;
    for (const b of col ?? []) {
      placed[b.id] = { x: snap(i * column, grid), y: snap(y, grid) };
      y += tall(b) + gap;
    }
  });
  return placed;
}

interface Draft { from: string; at?: { x: number; y: number }; pointer: boolean }
interface PortEntry { el: HTMLElement; info: PortInfo; label: string }
interface PatchCtx {
  register: (key: string, entry: PortEntry | null) => void;
  draft: Draft | null;
  canEnd: (info: PortInfo) => boolean;
  linked: ReadonlySet<string>;
  readOnly: boolean;
  startDraft: (key: string, e?: PointerEvent<HTMLElement>) => void;
  finish: (key: string) => void;
  cancel: () => void;
  disconnectAt: (key: string) => void;
  title: (box: string) => string;
}
const PatchContext = createContext<PatchCtx | null>(null);
const BoxContext = createContext<string | null>(null);

/**
 * A port. The canvas draws each box's `inputs` and `outputs` itself; place a `<Port>` in a box's body for a setting a
 * cable can reach (a control port beside its knob), and a cable `to: { box, param: id }` ends on it.
 */
export function Port({ id, label, kind = 'control', side = 'in', edge = false, named = false }: {
  id: string;
  label: string;
  kind?: PortKind;
  side?: 'in' | 'out';
  /** Drawn by the canvas on the box's edge (an input or output, not a setting). */
  edge?: boolean;
  /** Show the label beside the dot. */
  named?: boolean;
}) {
  const ctx = useContext(PatchContext);
  const box = useContext(BoxContext);
  const ref = useRef<HTMLSpanElement>(null);
  const key = box === null ? id : keyOf(box, id);
  const info = useMemo<PortInfo>(() => ({ box: box ?? '', id, kind, side, param: !edge }), [box, id, kind, side, edge]);
  useIsoLayout(() => {
    if (!ctx || !ref.current) return undefined;
    ctx.register(key, { el: ref.current, info, label });
    return () => ctx.register(key, null);
  }, [ctx?.register, key, info, label]); // eslint-disable-line react-hooks/exhaustive-deps
  const draft = ctx?.draft;
  const source = draft?.from === key;
  const target = !!draft && !source ? ctx!.canEnd(info) : undefined;
  const name = `${ctx && box ? `${ctx.title(box)} ` : ''}${label} ${edge ? (side === 'in' ? 'input' : 'output') : 'setting'}`;
  const down = (e: PointerEvent<HTMLSpanElement>) => {
    if (!ctx || ctx.readOnly || e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.focus();
    if (draft && !draft.pointer) { if (source) ctx.cancel(); else if (target) ctx.finish(key); return; }
    ctx.startDraft(key, e);
  };
  const keyDown = (e: KeyboardEvent<HTMLSpanElement>) => {
    if (!ctx) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      if (ctx.readOnly) return;
      if (!draft) ctx.startDraft(key);
      else if (source) ctx.cancel();
      else if (target) ctx.finish(key);
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && !ctx.readOnly) {
      e.preventDefault();
      e.stopPropagation();
      ctx.disconnectAt(key);
    }
  };
  return (
    <span
      ref={ref}
      className="ui-port"
      role="button"
      tabIndex={-1}
      aria-label={name}
      aria-pressed={source || undefined}
      aria-disabled={target === false || undefined}
      title={label}
      data-port-key={key}
      data-kind={kind}
      data-side={side}
      data-edge={edge || undefined}
      data-linked={ctx?.linked.has(key) || undefined}
      data-source={source || undefined}
      data-target={target === undefined ? undefined : String(target)}
      onPointerDown={down}
      onKeyDown={keyDown}
    >
      <span className="ui-port-dot" aria-hidden="true" />
      {named && <span className="ui-port-label" aria-hidden="true">{label}</span>}
    </span>
  );
}

const ZOOM_OUT = <svg viewBox="0 0 20 20"><path d="M5 10h10" /></svg>;
const ZOOM_IN = <svg viewBox="0 0 20 20"><path d="M5 10h10M10 5v10" /></svg>;
const FIT = <svg viewBox="0 0 20 20"><path d="M4 8V4h4M12 4h4v4M16 12v4h-4M8 16H4v-4" /></svg>;

export const PatchCanvas = forwardRef<HTMLDivElement, PatchCanvasProps>(function PatchCanvas({
  label, boxes, cables, selected = null, onSelect, onMove, onMoveCommit, onConnect, onDisconnect, onRemove, canConnect = defaultCanConnect,
  levels, readOnly = false, grid = 8, className,
}, outer) {
  const root = useRef<HTMLDivElement>(null);
  const view = useRef<HTMLDivElement>(null);
  const world = useRef<HTMLDivElement>(null);
  useImperativeHandle(outer, () => root.current!, []);
  const [camera, setCamera] = useState({ x: 0, y: 0, k: 1 });
  const cam = useRef(camera);
  cam.current = camera;
  const [draft, setDraft] = useState<Draft | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [anchors, setAnchors] = useState<Record<string, { x: number; y: number }>>({});
  const ports = useRef(new Map<string, PortEntry>());
  const [, setPortsVersion] = useState(0);
  const [status, setStatus] = useState('');
  const space = useRef(false);
  const fitted = useRef(false);

  const titles = useMemo(() => new Map(boxes.map((b) => [b.id, b.title])), [boxes]);
  const title = useCallback((id: string) => titles.get(id) ?? id, [titles]);
  const colors = useMemo(() => new Map(boxes.map((b) => [b.id, b.color])), [boxes]);
  const linked = useMemo(() => {
    const set = new Set<string>();
    for (const c of cables) { set.add(keyOf(c.from.box, c.from.port)); set.add(keyOf(c.to.box, endPort(c.to))); }
    return set;
  }, [cables]);

  const register = useCallback((key: string, entry: PortEntry | null) => {
    if (entry) ports.current.set(key, entry); else ports.current.delete(key);
    setPortsVersion((v) => v + 1);
  }, []);

  /** Port centres in canvas units, measured from the DOM (they don't change with pan or zoom). */
  const measure = useCallback(() => {
    const w = world.current;
    if (!w) return;
    const origin = w.getBoundingClientRect();
    const k = cam.current.k;
    const next: Record<string, { x: number; y: number }> = {};
    ports.current.forEach(({ el }, key) => {
      const dot = (el.querySelector('.ui-port-dot') as HTMLElement | null) ?? el;
      const r = dot.getBoundingClientRect();
      next[key] = { x: Math.round(((r.left + r.width / 2 - origin.left) / k) * 2) / 2, y: Math.round(((r.top + r.height / 2 - origin.top) / k) * 2) / 2 };
    });
    // Each box's bottom, for the cables that loop back under it.
    w.querySelectorAll<HTMLElement>('.ui-patch-box[data-box]').forEach((el) => { next[bottomKey(el.dataset.box!)] = { x: el.offsetLeft + el.offsetWidth / 2, y: el.offsetTop + el.offsetHeight }; });
    setAnchors((was) => {
      const keys = Object.keys(next);
      if (keys.length === Object.keys(was).length && keys.every((key) => was[key]?.x === next[key]!.x && was[key]?.y === next[key]!.y)) return was;
      return next;
    });
  }, []);
  useIsoLayout(measure);
  useEffect(() => {
    const w = world.current;
    if (!w || typeof ResizeObserver === 'undefined') return undefined;
    const sizes = new ResizeObserver(() => measure());
    w.querySelectorAll('.ui-patch-box').forEach((el) => sizes.observe(el));
    return () => sizes.disconnect();
  }, [boxes, measure]);

  const fit = useCallback(() => {
    const v = view.current;
    const w = world.current;
    if (!v || !w) return;
    const els = [...w.querySelectorAll<HTMLElement>('.ui-patch-box')];
    if (!els.length || !v.clientWidth) return;
    const minX = Math.min(...els.map((el) => el.offsetLeft));
    const minY = Math.min(...els.map((el) => el.offsetTop));
    const maxX = Math.max(...els.map((el) => el.offsetLeft + el.offsetWidth));
    const maxY = Math.max(...els.map((el) => el.offsetTop + el.offsetHeight));
    const k = clamp(Math.min((v.clientWidth - FIT_PAD * 2) / Math.max(1, maxX - minX), (v.clientHeight - FIT_PAD * 2) / Math.max(1, maxY - minY)), MIN_ZOOM, 1);
    setCamera({ k, x: (v.clientWidth - (maxX - minX) * k) / 2 - minX * k, y: (v.clientHeight - (maxY - minY) * k) / 2 - minY * k });
  }, []);
  useEffect(() => {
    if (fitted.current || !boxes.length) return;
    fitted.current = true;
    fit();
  }, [boxes.length, fit]);

  const zoomAt = useCallback((k: number, px?: number, py?: number) => {
    const v = view.current;
    setCamera((c) => {
      const next = clamp(k, MIN_ZOOM, MAX_ZOOM);
      const ax = px ?? (v ? v.clientWidth / 2 : 0);
      const ay = py ?? (v ? v.clientHeight / 2 : 0);
      return { k: next, x: ax - ((ax - c.x) / c.k) * next, y: ay - ((ay - c.y) / c.k) * next };
    });
  }, []);

  // The wheel scrolls; Ctrl (or a pinch) zooms where the pointer is. Not passive, so the page doesn't scroll too.
  useEffect(() => {
    const v = view.current;
    if (!v) return undefined;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const box = v.getBoundingClientRect();
        zoomAt(cam.current.k * Math.exp(-e.deltaY * 0.002), e.clientX - box.left, e.clientY - box.top);
      } else {
        const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
        const dy = e.shiftKey && !e.deltaX ? 0 : e.deltaY;
        setCamera((c) => ({ ...c, x: c.x - dx, y: c.y - dy }));
      }
    };
    v.addEventListener('wheel', wheel, { passive: false });
    return () => v.removeEventListener('wheel', wheel);
  }, [zoomAt]);

  // Space held over the canvas turns a drag into a pan.
  useEffect(() => {
    const down = (e: globalThis.KeyboardEvent) => {
      if (e.key !== ' ' || e.repeat || !root.current?.matches(':hover')) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('input, textarea, select, [contenteditable="true"], .ui-port')) return;
      space.current = true;
      root.current.dataset.panning = 'ready';
      if (t && root.current.contains(t)) e.preventDefault();
    };
    const up = (e: globalThis.KeyboardEvent) => {
      if (e.key !== ' ') return;
      space.current = false;
      if (root.current) delete root.current.dataset.panning;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  const toCanvas = (clientX: number, clientY: number) => {
    const w = world.current!.getBoundingClientRect();
    return { x: (clientX - w.left) / cam.current.k, y: (clientY - w.top) / cam.current.k };
  };

  const infoOf = (key: string) => ports.current.get(key)?.info;
  const canEnd = useCallback((to: PortInfo) => {
    const d = draftRef.current;
    const from = d ? ports.current.get(d.from)?.info : undefined;
    if (!from) return false;
    const [a, b] = from.side === 'out' ? [from, to] : [to, from];
    if (a.side !== 'out' || b.side !== 'in') return false;
    if (cables.some((c) => c.from.box === a.box && c.from.port === a.id && c.to.box === b.box && endPort(c.to) === b.id)) return false;
    return canConnect(a, b);
  }, [cables, canConnect]);

  const cancel = useCallback(() => { setDraft(null); setStatus('Cable cancelled'); }, []);
  const finish = useCallback((key: string) => {
    const d = draftRef.current;
    const from = d ? ports.current.get(d.from)?.info : undefined;
    const to = ports.current.get(key)?.info;
    setDraft(null);
    if (!from || !to || !canEnd(to)) return;
    const [a, b] = from.side === 'out' ? [from, to] : [to, from];
    onConnect?.({ box: a.box, port: a.id }, b.param ? { box: b.box, param: b.id } : { box: b.box, port: b.id });
    setStatus(`Connected ${title(a.box)} ${ports.current.get(keyOf(a.box, a.id))?.label ?? a.id} to ${title(b.box)} ${ports.current.get(keyOf(b.box, b.id))?.label ?? b.id}`);
  }, [canEnd, onConnect, title]);

  const startDraft = useCallback((key: string, e?: PointerEvent<HTMLElement>) => {
    const entry = ports.current.get(key);
    if (!entry) return;
    const pointer = !!e;
    setDraft({ from: key, pointer });
    setStatus(`Cable from ${title(entry.info.box)} ${entry.label}. Choose ${entry.info.side === 'out' ? 'an input' : 'an output'} and press Enter, or Escape to cancel`);
    if (!e) return;
    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;
    const move = (ev: globalThis.PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 4) return;
      moved = true;
      setDraft((d) => (d ? { ...d, at: toCanvas(ev.clientX, ev.clientY) } : d));
    };
    const up = (ev: globalThis.PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (!moved) { setDraft((d) => (d ? { ...d, pointer: false } : d)); return; } // A click: the next click ends it.
      const hit = (document.elementFromPoint?.(ev.clientX, ev.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-port-key]');
      const target = hit?.dataset.portKey;
      const info = target ? infoOf(target) : undefined;
      if (target && info && target !== key && canEnd(info)) finish(target);
      else setDraft(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }, [title, canEnd, finish]); // eslint-disable-line react-hooks/exhaustive-deps

  const disconnectAt = useCallback((key: string) => {
    const gone = cables.filter((c) => keyOf(c.from.box, c.from.port) === key || keyOf(c.to.box, endPort(c.to)) === key);
    gone.forEach((c) => onDisconnect?.(c.id));
    if (gone.length) setStatus(gone.length === 1 ? 'Cable removed' : `${gone.length} cables removed`);
  }, [cables, onDisconnect]);

  const ctx = useMemo<PatchCtx>(() => ({ register, draft, canEnd, linked, readOnly, startDraft, finish, cancel, disconnectAt, title }),
    [register, draft, canEnd, linked, readOnly, startDraft, finish, cancel, disconnectAt, title]);

  // Levels go straight to the cables, so feeding them 30 times a second re-renders nothing.
  useImperativeHandle(levels, () => ({
    set: (cable, db) => {
      root.current?.querySelector<SVGPathElement>(`path.ui-cable[data-cable="${CSS.escape(cable)}"]`)?.style.setProperty('--level', String(levelPosition(db, -60, 0)));
    },
    reset: () => root.current?.querySelectorAll<SVGPathElement>('path.ui-cable').forEach((p) => p.style.removeProperty('--level')),
  }), []);

  // Moving a box by its head.
  const grab = (b: PatchBox) => (e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0 || space.current) return;
    if ((e.target as HTMLElement).closest('button, input, select, [role="slider"], .ui-port')) return;
    onSelect?.({ kind: 'box', id: b.id });
    if (readOnly) return;
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture?.(e.pointerId);
    const start = { x: e.clientX, y: e.clientY };
    let at = { x: b.x, y: b.y };
    let moved = false;
    const move = (ev: globalThis.PointerEvent) => {
      const next = { x: snap(b.x + (ev.clientX - start.x) / cam.current.k, grid), y: snap(b.y + (ev.clientY - start.y) / cam.current.k, grid) };
      if (next.x === at.x && next.y === at.y) return;
      at = next;
      moved = true;
      onMove?.(b.id, at.x, at.y);
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      if (moved) onMoveCommit?.(b.id, at.x, at.y);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  const boxKeys = (b: PatchBox) => (e: KeyboardEvent<HTMLDivElement>) => {
    const own = e.currentTarget;
    const portsHere = [...own.querySelectorAll<HTMLElement>('.ui-port')];
    const at = portsHere.indexOf(document.activeElement as HTMLElement);
    const arrow = e.key.startsWith('Arrow');
    if (arrow && e.altKey) {
      if (readOnly) return;
      e.preventDefault();
      const step = grid * (e.shiftKey ? 4 : 1);
      const x = b.x + (e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0);
      const y = b.y + (e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0);
      onMove?.(b.id, x, y);
      onMoveCommit?.(b.id, x, y);
      return;
    }
    if (arrow) {
      if ((e.target as HTMLElement).closest('[role="slider"], input, select') && e.target !== own) return;
      if (!portsHere.length) return;
      e.preventDefault();
      const forward = e.key === 'ArrowDown' || e.key === 'ArrowRight';
      const next = at < 0 ? (forward ? 0 : portsHere.length - 1) : clamp(at + (forward ? 1 : -1), 0, portsHere.length - 1);
      portsHere[next]!.focus();
      return;
    }
    if (e.key === 'Escape') {
      if (draftRef.current) { e.preventDefault(); cancel(); return; }
      if (at >= 0) { e.preventDefault(); own.focus(); }
      return;
    }
    if (e.target !== own) return;
    if (e.key === 'Enter') { e.preventDefault(); onSelect?.({ kind: 'box', id: b.id }); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && !readOnly && onRemove) { e.preventDefault(); onRemove(b.id); setStatus(`Removed ${b.title}`); }
  };

  const rootKeys = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' && draftRef.current) { e.preventDefault(); cancel(); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selected?.kind === 'cable' && !readOnly && e.target === view.current) {
      e.preventDefault();
      onDisconnect?.(selected.id);
      setStatus('Cable removed');
    }
  };

  // Panning: a drag on empty canvas, a middle drag anywhere, or any drag with Space held.
  const panDown = (e: PointerEvent<HTMLDivElement>) => {
    const onEmpty = e.target === view.current || e.target === world.current || (e.target as Element).classList?.contains('ui-patch-wires');
    if (!(e.button === 1 || (e.button === 0 && (space.current || onEmpty)))) return;
    e.preventDefault();
    const v = view.current!;
    v.focus({ preventScroll: true });
    v.setPointerCapture?.(e.pointerId);
    const start = { x: e.clientX, y: e.clientY, cx: cam.current.x, cy: cam.current.y };
    let moved = false;
    root.current!.dataset.panning = 'on';
    const move = (ev: globalThis.PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 3) return;
      moved = true;
      setCamera((c) => ({ ...c, x: start.cx + ev.clientX - start.x, y: start.cy + ev.clientY - start.y }));
    };
    const up = () => {
      v.removeEventListener('pointermove', move);
      v.removeEventListener('pointerup', up);
      v.removeEventListener('pointercancel', up);
      if (root.current) { if (space.current) root.current.dataset.panning = 'ready'; else delete root.current.dataset.panning; }
      if (!moved && onEmpty && e.button === 0) { if (draftRef.current) cancel(); else onSelect?.(null); }
    };
    v.addEventListener('pointermove', move);
    v.addEventListener('pointerup', up);
    v.addEventListener('pointercancel', up);
  };

  const wire = (c: PatchCable) => {
    const a = anchors[keyOf(c.from.box, c.from.port)];
    const b = anchors[keyOf(c.to.box, endPort(c.to))];
    if (!a || !b) return null;
    // A cable running back loops under its own boxes and every box between its ends.
    const under = b.x < a.x + 24
      ? Math.max(a.y, b.y, ...boxes.map((x) => anchors[bottomKey(x.id)]).filter((m, i) => m && (boxes[i]!.id === c.from.box || boxes[i]!.id === c.to.box || (m.x > b.x && m.x < a.x))).map((m) => m!.y)) + 16
      : undefined;
    const d = cablePath(a.x, a.y, b.x, b.y, under);
    const chosen = selected?.kind === 'cable' && selected.id === c.id;
    return (
      <g key={c.id} data-selected={chosen || undefined}>
        <path className="ui-cable-hit" d={d} onPointerDown={(e) => { if (e.button === 0 && !space.current) { e.stopPropagation(); onSelect?.({ kind: 'cable', id: c.id }); view.current?.focus({ preventScroll: true }); } }} />
        <path className="ui-cable" d={d} data-cable={c.id} data-color={colors.get(c.from.box)} data-proposed={c.proposed || undefined} />
      </g>
    );
  };

  const draftFrom = draft ? anchors[draft.from] : undefined;
  const draftSide = draft ? ports.current.get(draft.from)?.info.side : undefined;
  const gridPx = grid * camera.k;

  return (
    <PatchContext.Provider value={ctx}>
      <div
        ref={root}
        className={className ? `ui-patch ${className}` : 'ui-patch'}
        role="group"
        aria-label={label}
        aria-roledescription="patch"
        data-readonly={readOnly || undefined}
        data-drafting={draft ? 'true' : undefined}
        onKeyDown={rootKeys}
      >
        <div
          ref={view}
          className="ui-patch-view"
          tabIndex={-1}
          onPointerDown={panDown}
          style={{ ['--grid-step' as string]: `${gridPx * 2}px`, ['--grid-x' as string]: `${camera.x}px`, ['--grid-y' as string]: `${camera.y}px` } as CSSProperties}
        >
          <div ref={world} className="ui-patch-world" style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.k})` }}>
            <svg className="ui-patch-wires" aria-hidden="true">
              {cables.filter((c) => 'port' in c.to).map(wire)}
              {draftFrom && draft?.at && (
                <path
                  className="ui-cable"
                  data-draft="true"
                  d={draftSide === 'out' ? cablePath(draftFrom.x, draftFrom.y, draft.at.x, draft.at.y) : cablePath(draft.at.x, draft.at.y, draftFrom.x, draftFrom.y)}
                />
              )}
            </svg>
            {boxes.map((b) => {
              const named = (list?: readonly PortSpec[]) => (list?.length ?? 0) > 1;
              const chosen = selected?.kind === 'box' && selected.id === b.id;
              return (
                <BoxContext.Provider key={b.id} value={b.id}>
                  <div
                    className="ui-patch-box"
                    data-box={b.id}
                    role="group"
                    tabIndex={0}
                    aria-label={b.title}
                    aria-current={chosen || undefined}
                    data-color={b.color}
                    data-selected={chosen || undefined}
                    data-proposed={b.proposed || undefined}
                    style={{ left: b.x, top: b.y }}
                    onKeyDown={boxKeys(b)}
                    onPointerDownCapture={() => { if (!chosen && !space.current) onSelect?.({ kind: 'box', id: b.id }); }}
                  >
                    <div className="ui-patch-head" onPointerDown={grab(b)}>
                      <span className="ui-patch-title">{b.title}</span>
                    </div>
                    <div className="ui-patch-body">
                      <div className="ui-patch-ports" data-side="in">
                        {b.inputs?.map((p) => <Port key={p.id} id={p.id} label={p.label} kind={p.kind} side="in" edge named={named(b.inputs)} />)}
                      </div>
                      {b.children !== undefined && <div className="ui-patch-content">{b.children}</div>}
                      <div className="ui-patch-ports" data-side="out">
                        {b.outputs?.map((p) => <Port key={p.id} id={p.id} label={p.label} kind={p.kind} side="out" edge named={named(b.outputs)} />)}
                      </div>
                    </div>
                  </div>
                </BoxContext.Provider>
              );
            })}
            {/* A cable to a setting ends inside its box, so it is drawn over the boxes to reach the setting's port. */}
            <svg className="ui-patch-wires" data-layer="over" aria-hidden="true">{cables.filter((c) => !('port' in c.to)).map(wire)}</svg>
          </div>
        </div>
        <div className="ui-patch-zoom">
          <IconButton label="Zoom out" icon={ZOOM_OUT} onClick={() => zoomAt(camera.k / 1.25)} disabled={camera.k <= MIN_ZOOM} />
          <button type="button" className="ui-patch-scale" title="Back to 100%" onClick={() => zoomAt(1)}>{Math.round(camera.k * 100)}%</button>
          <IconButton label="Zoom in" icon={ZOOM_IN} onClick={() => zoomAt(camera.k * 1.25)} disabled={camera.k >= MAX_ZOOM} />
          <IconButton label="Fit" icon={FIT} onClick={fit} />
        </div>
        <span className="ui-patch-status" role="status">{status}</span>
      </div>
    </PatchContext.Provider>
  );
});
