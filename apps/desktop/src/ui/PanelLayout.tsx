import { useSideFolds } from '../side-fold';
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Menu, PointMenu, type MenuEntry } from './Menu';
import { useInspector } from './PanelTabs';
import { afterPaint } from './frame';
import { dockIn, dockLeaves, dockOut } from '../motion';

/**
 * Panels (docs/design/panel-layouts.md: show, hide, resize). A panel is a named, self-contained piece of an app that
 * sits in a dock beside its content: the left dock before it, the right dock after it, or the bottom dock under it
 * (across the content's width only). Mobius is the shell's, at the window's right edge, and never one of these.
 *
 * An app wraps its page in `PanelLayout` and declares its panels. The frame lists them in the toolbar's Panels menu
 * (and View › Panels), with their keys, and keeps what is shown and each dock's size per app, on this device.
 */
export type PanelDock = 'left' | 'right' | 'bottom';
const DOCKS = ['left', 'right', 'bottom'] as const;

export interface PanelSpec {
  id: string;
  name: string;
  /** Where it sits. */
  dock: PanelDock;
  /** Whether it starts shown. Hidden unless said. */
  shown?: boolean;
  /** Its shortcut, as the keys are written elsewhere ("mod+shift+o"). */
  keys?: string;
  /** The dock's size in pixels while this panel is in it, until the person resizes the dock (Slides' notes: shorter
   *  than the default, so the stage keeps its room). Kept within the dock's range. */
  size?: number;
  /** For a panel that is there only while something is open (Tasks' Details): hiding it closes that thing instead,
   *  so it is not kept hidden for the next one. */
  onHide?: () => void;
  /** Changed to show the panel from inside the app (Code's Console when Mobius runs a command there). */
  reveal?: number;
  /** Panels with the same group in one dock share a place there, as tabs in one header (Code's Terminal, Tests and
   *  Problems at the bottom). Each is still shown and hidden on its own; showing one brings its tab to the front. */
  group?: string;
  /** Always there, as System Settings' list of sections is: no Hide button, not in the Panels menu, and the dock's key and a
   *  layout kept from before leave it shown (Settings' sections, without which its pages cannot be reached). */
  fixed?: boolean;
  /** The name screen readers hear, when it must differ from the header's. */
  label?: string;
  /** The least room it works in. A dock holding it keeps at least this size (within the dock's own range). */
  min?: { width?: number; height?: number };
  /** The panel's body. Its own controls go here, never in the header. Lay it out by `usePanelShape()`, not by its dock. */
  render: () => ReactNode;
}

/**
 * The shape of the room a panel has, wherever it is: `narrow` (a thin column), `strip` (short and wide, as the bottom
 * dock is) or `column` (the usual side panel). A panel lays itself out by this, so it stays useful when it is moved,
 * resized or popped out (docs/design/pieces.md, round 0). Its section carries it too, as `data-shape`, for CSS.
 */
export type PanelShape = 'narrow' | 'column' | 'strip';
export function panelShape(width: number, height: number): PanelShape {
  if (width < 220) return 'narrow';
  if (width >= 520 && height <= 380 && width >= height * 1.8) return 'strip';
  return 'column';
}
const ShapeContext = createContext<PanelShape>('column');
/** The shape of the panel this is drawn in (`column` outside a panel). */
export function usePanelShape(): PanelShape {
  return useContext(ShapeContext);
}

/** Each dock's size: the default, and the range a drag keeps to. The bottom dock is at most 70% of the content. */
export const DOCK_SIZE = {
  left: { min: 180, max: 480, initial: 248 },
  right: { min: 280, max: 560, initial: 320 },
  bottom: { min: 120, maxShare: 0.7, initial: 260 },
} as const;

export interface SavedLayout {
  shown: Record<string, boolean>;
  size: Partial<Record<PanelDock, number>>;
  /** The panel in front of each tab group, by group. */
  front?: Record<string, string>;
  /** Panels the person moved to another dock, by id. */
  dock?: Record<string, PanelDock>;
  /** Panels the person popped out to float over the page, by id: where and how big, in pixels from the page's corner. */
  float?: Record<string, FloatRect>;
}

export interface FloatRect { x: number; y: number; width: number; height: number }
/** The least a floating panel may be. */
export const FLOAT_MIN = { width: 220, height: 160 } as const;

const storeKey = (app: string) => `mobius.layout.${app}`;
const EMPTY: SavedLayout = { shown: {}, size: {} };

/** What was kept for an app: anything unreadable counts as nothing kept. */
export function parseLayout(text: string | null): SavedLayout {
  if (!text) return EMPTY;
  try {
    const v = JSON.parse(text) as Partial<SavedLayout>;
    const shown = Object.fromEntries(Object.entries(v.shown ?? {}).filter(([, on]) => typeof on === 'boolean')) as Record<string, boolean>;
    const size: SavedLayout['size'] = {};
    for (const dock of DOCKS) {
      const n = v.size?.[dock];
      if (typeof n === 'number' && Number.isFinite(n)) size[dock] = n;
    }
    const front = Object.fromEntries(Object.entries(v.front ?? {}).filter(([, id]) => typeof id === 'string')) as Record<string, string>;
    const dock = Object.fromEntries(Object.entries(v.dock ?? {}).filter(([, d]) => (DOCKS as readonly unknown[]).includes(d))) as Record<string, PanelDock>;
    const float: Record<string, FloatRect> = {};
    for (const [id, r] of Object.entries(v.float ?? {})) {
      if (r && [r.x, r.y, r.width, r.height].every((n) => typeof n === 'number' && Number.isFinite(n))) float[id] = { x: Math.max(0, r.x), y: Math.max(0, r.y), width: Math.max(FLOAT_MIN.width, r.width), height: Math.max(FLOAT_MIN.height, r.height) };
    }
    return { shown, size, ...(Object.keys(front).length > 0 ? { front } : {}), ...(Object.keys(dock).length > 0 ? { dock } : {}), ...(Object.keys(float).length > 0 ? { float } : {}) };
  } catch {
    return EMPTY;
  }
}

function readLayout(app: string): SavedLayout {
  try { return parseLayout(window.localStorage.getItem(storeKey(app))); } catch { return EMPTY; }
}
function writeLayout(app: string, layout: SavedLayout) {
  try {
    if (DOCKS.every((d) => layout.size[d] === undefined) && Object.keys(layout.shown).length === 0 && Object.keys(layout.front ?? {}).length === 0 && Object.keys(layout.dock ?? {}).length === 0 && Object.keys(layout.float ?? {}).length === 0) window.localStorage.removeItem(storeKey(app));
    else window.localStorage.setItem(storeKey(app), JSON.stringify(layout));
  } catch { /* Kept only until Mobius closes. */ }
}

/** A dock's size within its range. `room` is the content's height, for the bottom dock. */
export function clampDock(dock: PanelDock, size: number, room = Infinity): number {
  if (dock !== 'bottom') return Math.round(Math.min(DOCK_SIZE[dock].max, Math.max(DOCK_SIZE[dock].min, size)));
  const max = Math.max(DOCK_SIZE.bottom.min, Math.floor(room * DOCK_SIZE.bottom.maxShare));
  return Math.round(Math.min(max, Math.max(DOCK_SIZE.bottom.min, size)));
}

/** One place in a dock: a panel on its own, or a tab group's shown panels with the one in front. */
export interface DockPlace { key: string; panels: PanelSpec[]; front: PanelSpec }

/** A dock's shown panels as places, in the order declared; a group sits where its first shown panel is. The front of
 *  a group is the one kept in front if it is still shown, else the first. */
export function dockPlaces(shown: readonly PanelSpec[], front: Record<string, string> = {}): DockPlace[] {
  const places: DockPlace[] = [];
  const byGroup = new Map<string, DockPlace>();
  for (const p of shown) {
    const at = p.group ? byGroup.get(p.group) : undefined;
    if (at) { at.panels.push(p); if (front[p.group!] === p.id) at.front = p; continue; }
    const place = { key: p.group ? `group:${p.group}` : p.id, panels: [p], front: p };
    if (p.group) byGroup.set(p.group, place);
    places.push(place);
  }
  return places;
}

/** The keys that show or hide a whole dock of the open app's panels (docs/design/panel-layouts.md). */
export const DOCK_KEYS: Record<PanelDock, string> = { left: 'mod+\\', right: 'mod+alt+\\', bottom: 'mod+j' };

/** Whether a key press is `keys` ("mod+shift+o": mod is Command on a Mac, Control elsewhere). */
export function pressIs(keys: string, e: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }, mac: boolean): boolean {
  const parts = keys.toLowerCase().split('+');
  const key = parts.pop();
  if (!key) return false;
  const mod = parts.includes('mod');
  return e.key.toLowerCase() === key && (mac ? e.metaKey : e.ctrlKey) === mod && (mac ? !e.ctrlKey : !e.metaKey) && e.shiftKey === parts.includes('shift') && e.altKey === parts.includes('alt');
}

/** What the toolbar's Panels menu needs from the open app's layout. */
export interface PanelsOfApp {
  panels: { id: string; name: string; dock: PanelDock; shown: boolean; keys?: string }[];
  toggle: (id: string) => void;
  /** Puts a panel in another dock, shown; its own dock again forgets the move. */
  move?: (id: string, dock: PanelDock) => void;
  /** Pops a panel out to float over the page (where it floated last, or a place of its own). */
  float?: (id: string) => void;
  /** Back to the app's own layout: its panels as declared, its docks at their default sizes. */
  reset: () => void;
}

const Registry = createContext<((app: PanelsOfApp | null) => void) | null>(null);

/** The frame provides this: the open app's layout registers itself, so the Panels menu can list it. */
export const PanelRegistryContext = Registry;

const mac = () => typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);

/**
 * `away` is true while the app is put aside for another place (Settings over it): its docks then go and come back with
 * that place, without sliding.
 */
export function PanelLayout({ app, panels: declared, away = false, children }: { app: string; panels: readonly PanelSpec[]; away?: boolean; children: ReactNode }) {
  const [saved, setSaved] = useState<SavedLayout>(() => readLayout(app));
  // Each panel where it is now: in the dock the person moved it to, or its own.
  const panels = useMemo(() => placedPanels(declared, saved.dock), [declared, saved.dock]);
  // Another app's layout is read when the app changes; not again on mount, which would draw everything a second time.
  const readFor = useRef(app);
  useEffect(() => {
    if (readFor.current === app) return;
    readFor.current = app;
    setSaved(readLayout(app));
  }, [app]);
  const update = useCallback((change: (was: SavedLayout) => SavedLayout) => {
    setSaved((was) => { const next = change(was); writeLayout(app, next); return next; });
  }, [app]);
  const isShown = useCallback((p: PanelSpec) => p.fixed || (saved.shown[p.id] ?? p.shown ?? false), [saved.shown]);
  const isFront = useCallback((p: PanelSpec) => {
    if (!p.group) return true;
    const place = dockPlaces(panels.filter((x) => x.dock === p.dock && isShown(x)), saved.front).find((x) => x.panels.includes(p));
    return place?.front === p;
  }, [panels, isShown, saved.front]);
  const toggle = useCallback((id: string) => {
    const p = panels.find((x) => x.id === id);
    if (!p || p.fixed) return;
    const on = isShown(p);
    // A panel shown behind another tab comes to the front rather than hiding.
    if (on && p.group && !isFront(p)) { update((was) => ({ ...was, front: { ...was.front, [p.group!]: id } })); return; }
    if (p.onHide && on) { p.onHide(); return; }
    update((was) => ({ ...withFront(was, on ? [] : [p]), shown: { ...was.shown, [id]: !on } }));
  }, [panels, isShown, isFront, update]);
  const reset = useCallback(() => update(() => EMPTY), [update]);
  const move = useCallback((id: string, dock: PanelDock) => {
    const own = declared.find((x) => x.id === id);
    if (!own || own.fixed) return;
    update((was) => {
      const moved = { ...was.dock };
      if (dock === own.dock) delete moved[id]; else moved[id] = dock;
      const floats = { ...was.float };
      delete floats[id];
      const { dock: _, float: __, ...rest } = was;
      return { ...rest, ...(Object.keys(moved).length > 0 ? { dock: moved } : {}), ...(Object.keys(floats).length > 0 ? { float: floats } : {}), shown: { ...was.shown, [id]: true } };
    });
  }, [declared, update]);
  const floatPanel = useCallback((id: string, rect?: FloatRect) => {
    const own = declared.find((x) => x.id === id);
    if (!own || own.fixed) return;
    update((was) => {
      const at = rect ?? was.float?.[id] ?? { x: 96, y: 64, width: 320, height: 420 };
      const r = { x: Math.max(0, Math.round(at.x)), y: Math.max(0, Math.round(at.y)), width: Math.max(FLOAT_MIN.width, Math.round(at.width)), height: Math.max(FLOAT_MIN.height, Math.round(at.height)) };
      return { ...was, float: { ...was.float, [id]: r }, shown: { ...was.shown, [id]: true } };
    });
  }, [declared, update]);
  // A panel whose `reveal` changed since the last render is shown.
  const reveals = useRef<Record<string, number | undefined>>({});
  useEffect(() => {
    const now = panels.filter((p) => p.reveal !== undefined && reveals.current[p.id] !== undefined && reveals.current[p.id] !== p.reveal);
    for (const p of panels) reveals.current[p.id] = p.reveal;
    if (now.length > 0) update((was) => ({ ...withFront(was, now), shown: { ...was.shown, ...Object.fromEntries(now.map((p) => [p.id, true])) } }));
  }, [panels, update]);

  // The frame lists this app's panels in its Panels menu while the app is on screen.
  const register = useContext(Registry);
  const listed = useMemo<PanelsOfApp>(() => ({
    panels: panels.filter((p) => !p.fixed).map((p) => ({ id: p.id, name: p.name, dock: p.dock, shown: isShown(p), ...(p.keys ? { keys: p.keys } : {}) })),
    toggle,
    reset,
    move,
    float: (id: string) => floatPanel(id),
  }), [panels, isShown, toggle, reset, move, floatPanel]);
  useEffect(() => { register?.(listed); }, [register, listed]);
  useEffect(() => () => register?.(null), [register]);

  // Each panel's key, and a key for each whole dock (DOCK_KEYS). The dock keys are taken before the shell sees them
  // (capture), so an app with its own left panels answers Ctrl+\ rather than the shell's list.
  useEffect(() => {
    const onDock = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const dock = DOCKS.find((d) => pressIs(DOCK_KEYS[d], e, mac()));
      // A place that uses the key for itself says so (Music's notes join with Ctrl+J, as in a studio).
      if (dock && (e.target as Element | null)?.closest?.(`[data-own-keys~="${DOCK_KEYS[dock]}"]`)) return;
      const all = dock ? panels.filter((p) => p.dock === dock) : [];
      if (all.length === 0) return;
      e.preventDefault();
      // A dock of fixed panels keeps the key, so it doesn't reach the shell's list hidden behind them.
      const inDock = all.filter((p) => !p.fixed);
      if (inDock.length === 0) return;
      const anyShown = inDock.some(isShown);
      if (anyShown) inDock.filter((p) => p.onHide && isShown(p)).forEach((p) => p.onHide!());
      update((was) => ({ ...was, shown: { ...was.shown, ...Object.fromEntries(inDock.filter((p) => !(anyShown && p.onHide)).map((p) => [p.id, !anyShown])) } }));
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const hit = panels.find((p) => p.keys && pressIs(p.keys, e, mac()));
      if (hit) { e.preventDefault(); toggle(hit.id); }
    };
    window.addEventListener('keydown', onDock, true);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onDock, true); window.removeEventListener('keydown', onKey); };
  }, [panels, isShown, toggle, update]);

  const main = useRef<HTMLDivElement>(null);
  // The content's height, for how tall the bottom dock may be: kept from a ResizeObserver, since reading it while
  // drawing would make the browser lay out the page there and then, on every render.
  const mainHeight = useRef(Infinity);
  useEffect(() => {
    const node = main.current;
    if (!node || typeof ResizeObserver === 'undefined') return undefined;
    const seen = new ResizeObserver(() => { mainHeight.current = node.clientHeight; });
    seen.observe(node);
    return () => seen.disconnect();
  }, []);
  const leftDock = useRef<HTMLDivElement>(null);
  // A popped-out panel floats over the page instead of sitting in its dock.
  const floats = (p: PanelSpec) => !p.fixed && saved.float?.[p.id] !== undefined;
  const docked = (dock: PanelDock) => (p: PanelSpec) => p.dock === dock && isShown(p) && !floats(p);
  const floating = panels.filter((p) => isShown(p) && floats(p));
  const left = panels.filter(docked('left'));
  // The lists on the left fold their sections, as every sidebar does (side-fold.ts).
  useSideFolds(leftDock, left.length > 0);
  const right = panels.filter(docked('right'));
  const leftSize = atLeast('left', left, clampDock('left', saved.size.left ?? left.find((p) => p.size)?.size ?? DOCK_SIZE.left.initial));
  const bottom = panels.filter(docked('bottom'));
  const rightSize = atLeast('right', right, clampDock('right', saved.size.right ?? right.find((p) => p.size)?.size ?? DOCK_SIZE.right.initial));
  const bottomSize = atLeast('bottom', bottom, clampDock('bottom', saved.size.bottom ?? bottom.find((p) => p.size)?.size ?? DOCK_SIZE.bottom.initial, mainHeight.current), mainHeight.current);
  const resize = (dock: PanelDock, size: number | undefined) => update((was) => {
    const next = { ...was.size };
    if (size === undefined) delete next[dock]; else next[dock] = clampDock(dock, size, mainHeight.current);
    return { ...was, size: next };
  });
  // Close in a tab group's header hides the whole group.
  const hide = (place: DockPlace) => {
    place.panels.filter((p) => p.onHide).forEach((p) => p.onHide!());
    const rest = place.panels.filter((p) => !p.onHide && !p.fixed);
    if (rest.length > 0) update((was) => ({ ...was, shown: { ...was.shown, ...Object.fromEntries(rest.map((p) => [p.id, false])) } }));
  };
  const choose = (p: PanelSpec) => update((was) => withFront(was, [p]));
  // Moving a panel: its header dragged over a dock's edge of the page (or its menu's Move to).
  const [moving, setMoving] = useState<{ id: string; from: PanelDock | null; over: PanelDock | null } | null>(null);
  const draw = (shown: PanelSpec[]) => dockPlaces(shown, saved.front).map((place) => (
    <Panel key={place.key} place={place} onHide={() => hide(place)} onChoose={choose} onMove={(p, dock) => move(p.id, dock)} onFloat={(p, r) => floatPanel(p.id, r)} onDrag={setMoving} />
  ));

  // Each dock slides out of its edge as it opens and back as it closes (dockIn, dockOut); switching app, or going to
  // Settings and back, does not.
  const rightDock = useRef<HTMLDivElement>(null);
  const bottomDock = useRef<HTMLDivElement>(null);
  const place = away ? `${app}\u0000away` : app;
  const l = useDockMotion('left', left, leftSize, place, leftDock);
  const b = useDockMotion('bottom', bottom, bottomSize, place, bottomDock);
  const r = useDockMotion('right', right, rightSize, place, rightDock);
  const leaving = (m: DockMotion) => (m.leaving ? { inert: true, 'aria-hidden': true } : {});

  return (
    <div className="ui-panels" data-app={app} {...(moving ? { 'data-moving-panel': moving.id } : {})}>
      {l.panels.length > 0 && (
        <div ref={leftDock} className="ui-dock" data-dock="left" style={{ width: l.size }} {...leaving(l)}>
          {draw(l.panels)}
          <DockEdge dock="left" size={l.size} onSize={(n) => resize('left', n)} />
        </div>
      )}
      <div ref={main} className="ui-panels-main">
        <div className="ui-panels-content">{children}</div>
        {b.panels.length > 0 && (
          <div ref={bottomDock} className="ui-dock" data-dock="bottom" style={{ height: b.size }} {...leaving(b)}>
            <DockEdge dock="bottom" size={b.size} onSize={(n) => resize('bottom', n)} />
            {draw(b.panels)}
          </div>
        )}
      </div>
      {r.panels.length > 0 && (
        <div ref={rightDock} className="ui-dock" data-dock="right" style={{ width: r.size }} {...leaving(r)}>
          <DockEdge dock="right" size={r.size} onSize={(n) => resize('right', n)} />
          {draw(r.panels)}
        </div>
      )}
      {floating.map((p) => {
        const r = saved.float![p.id]!;
        const place = { key: p.id, panels: [p], front: p };
        return (
          <div key={p.id} className="ui-float" style={{ left: `min(${r.x}px, calc(100% - 120px))`, top: `min(${r.y}px, calc(100% - 48px))`, width: `min(${r.width}px, 100%)`, height: `min(${r.height}px, 100%)` }}>
            <Panel place={place} floating={r} onHide={() => hide(place)} onChoose={choose} onMove={(x, dock) => move(x.id, dock)} onFloat={(x, rect) => floatPanel(x.id, rect)} onDrag={setMoving} />
            <FloatSize onSize={(width, height) => floatPanel(p.id, { ...r, width, height })} />
          </div>
        );
      })}
      {moving && (
        <div className="ui-dock-targets" aria-hidden="true">
          {DOCKS.filter((d) => d !== moving.from).map((d) => <div key={d} className="ui-dock-target" data-dock={d} data-over={moving.over === d || undefined} />)}
        </div>
      )}
    </div>
  );
}

/** The corner of a floating panel: drag to make it bigger or smaller. */
function FloatSize({ onSize }: { onSize: (width: number, height: number) => void }) {
  const drag = useRef<{ x: number; y: number; width: number; height: number; box: HTMLElement } | null>(null);
  return (
    <div
      className="ui-float-size"
      aria-hidden="true"
      onPointerDown={(e) => {
        const box = e.currentTarget.parentElement;
        if (!box || e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, y: e.clientY, width: box.offsetWidth, height: box.offsetHeight, box };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        d.box.style.width = `${Math.max(FLOAT_MIN.width, d.width + e.clientX - d.x)}px`;
        d.box.style.height = `${Math.max(FLOAT_MIN.height, d.height + e.clientY - d.y)}px`;
      }}
      onPointerUp={() => {
        const d = drag.current;
        drag.current = null;
        if (d) onSize(d.box.offsetWidth, d.box.offsetHeight);
      }}
      onLostPointerCapture={() => { drag.current = null; }}
    />
  );
}

/** A dock's size, at least what its shown panels need (`min`), still within the dock's range. */
export function atLeast(dock: PanelDock, shown: readonly PanelSpec[], size: number, room = Infinity): number {
  const need = Math.max(0, ...shown.map((p) => (dock === 'bottom' ? p.min?.height : p.min?.width) ?? 0));
  return need > size ? clampDock(dock, need, room) : size;
}

/** Panels in the docks the person moved them to (a fixed panel stays). */
export function placedPanels(declared: readonly PanelSpec[], moved: SavedLayout['dock']): PanelSpec[] {
  return declared.map((p) => {
    const to = moved?.[p.id];
    return to && to !== p.dock && !p.fixed ? { ...p, dock: to } : p;
  });
}

/** How near the page's side or bottom a dragged panel must be to dock there, in pixels. */
export const DOCK_REACH = 72;
/** Where a panel dragged to (x, y) over the page would go: close to its left or right side, or its bottom; else
 *  nowhere (a floating panel just moves). */
export function dockAt(x: number, y: number, page: { left: number; top: number; width: number; height: number }): PanelDock | null {
  const [dx, dy] = [x - page.left, y - page.top];
  if (dx < 0 || dx > page.width || dy < 0 || dy > page.height) return null;
  if (dx < DOCK_REACH) return 'left';
  if (page.width - dx < DOCK_REACH) return 'right';
  if (page.height - dy < DOCK_REACH) return 'bottom';
  return null;
}

interface DockMotion { panels: PanelSpec[]; size: number; leaving: boolean }

/**
 * What a dock draws: its shown panels, or, for the moment it takes to slide back into its edge, the ones just hidden.
 * Opening a dock slides it out. Neither happens when the place changes (another app, or Settings over this one: the
 * whole page settles in then) or when the window is not shown.
 */
function useDockMotion(dock: PanelDock, shown: PanelSpec[], size: number, place: string, ref: RefObject<HTMLDivElement | null>): DockMotion {
  const open = shown.length > 0;
  const [gone, setGone] = useState<{ panels: PanelSpec[]; size: number } | null>(null);
  const before = useRef({ place, open, panels: shown, size });
  // Whether the dock, as last drawn, may slide away: by the time a close is seen here it has already left the page.
  const mayLeave = useRef(false);
  useLayoutEffect(() => { if (ref.current) mayLeave.current = dockLeaves(ref.current); });
  useLayoutEffect(() => {
    const was = before.current;
    before.current = { place, open, panels: open ? shown : was.panels, size: open ? size : was.size };
    if (was.place !== place) { setGone(null); return; }
    if (open && !was.open) {
      setGone(null);
      if (ref.current) dockIn(ref.current, dock, size);
    } else if (!open && was.open && mayLeave.current) {
      setGone({ panels: was.panels, size: was.size });
    }
  }, [place, open]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const node = ref.current;
    if (!gone || !node) return undefined;
    let live = true;
    void dockOut(node, dock, gone.size).then(() => { if (live) setGone(null); });
    return () => { live = false; };
  }, [gone]); // eslint-disable-line react-hooks/exhaustive-deps
  if (open) return { panels: shown, size, leaving: false };
  return gone ? { panels: gone.panels, size: gone.size, leaving: true } : { panels: shown, size, leaving: false };
}

/** Bring these panels to the front of their tab groups. */
function withFront(was: SavedLayout, shown: readonly PanelSpec[]): SavedLayout {
  const grouped = shown.filter((p) => p.group);
  return grouped.length === 0 ? was : { ...was, front: { ...was.front, ...Object.fromEntries(grouped.map((p) => [p.group!, p.id])) } };
}

/** Every panel has the same header: its name (or, for a tab group, its tabs), then close. Nothing else lives there. */
function Panel({ place, floating, onHide, onChoose, onMove, onFloat, onDrag }: {
  place: DockPlace;
  /** Where it floats, when popped out. */
  floating?: FloatRect;
  onHide: () => void;
  onChoose: (p: PanelSpec) => void;
  onMove: (p: PanelSpec, dock: PanelDock) => void;
  onFloat: (p: PanelSpec, rect?: FloatRect) => void;
  onDrag: (moving: { id: string; from: PanelDock | null; over: PanelDock | null } | null) => void;
}) {
  const spec = place.front;
  const tabbed = place.panels.length > 1;
  const list = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const movable = !spec.fixed;
  const moveEntries: MenuEntry[] = !movable ? [] : floating
    ? DOCKS.map((d) => ({ label: d === 'bottom' ? 'Dock at the bottom' : `Dock on the ${d}`, run: () => onMove(spec, d) }))
    : [...DOCKS.filter((d) => d !== spec.dock).map((d) => ({ label: d === 'bottom' ? 'Move to the bottom' : `Move to the ${d}`, run: () => onMove(spec, d) })), { label: 'Pop out', run: () => onFloat(spec), separated: true }];
  const drag = useRef<{ x: number; y: number; page: DOMRect; over: PanelDock | null; live: boolean; home: boolean; box: DOMRect; at: { x: number; y: number } } | null>(null);
  const [held, setHeld] = useState(false);
  const section = useRef<HTMLElement>(null);
  const [shape, setShape] = useState<PanelShape>(() => (spec.dock === 'bottom' ? 'strip' : 'column'));
  useLayoutEffect(() => {
    const node = section.current;
    if (!node || typeof ResizeObserver === 'undefined') return undefined;
    const seen = new ResizeObserver(() => setShape(panelShape(node.clientWidth, node.clientHeight)));
    seen.observe(node);
    return () => seen.disconnect();
  }, []);
  const down = (e: ReactPointerEvent<HTMLElement>) => {
    if (!movable || e.button !== 0 || (e.target as Element).closest('button')) return;
    const page = e.currentTarget.closest('.ui-panels')?.getBoundingClientRect();
    const box = section.current?.getBoundingClientRect();
    if (!page || !box) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, page, over: null, live: false, home: true, box, at: { x: box.left - page.left, y: box.top - page.top } };
  };
  /** Where the panel's box would float with the pointer at (x, y), kept on the page. */
  const floatAt = (d: NonNullable<typeof drag.current>, x: number, y: number): FloatRect => {
    const width = floating ? d.box.width : Math.min(420, Math.max(260, d.box.width));
    const height = floating ? d.box.height : Math.min(520, Math.max(240, d.box.height));
    const left = floating ? d.at.x + x - d.x : x - d.page.left - Math.min(60, width / 2);
    const top = floating ? d.at.y + y - d.y : y - d.page.top - 16;
    return { x: Math.min(Math.max(0, left), Math.max(0, d.page.width - 120)), y: Math.min(Math.max(0, top), Math.max(0, d.page.height - 48)), width, height };
  };
  const last = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragMove = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    if (!d.live && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) return;
    last.current = { x: e.clientX, y: e.clientY };
    const at = dockAt(e.clientX, e.clientY, d.page);
    const over = floating ? at : at === spec.dock ? null : at;
    d.home = !floating && at === spec.dock;
    // A floating panel follows the pointer.
    const box = section.current?.parentElement;
    if (floating && box?.classList.contains('ui-float')) {
      const r = floatAt(d, e.clientX, e.clientY);
      box.style.left = `${r.x}px`;
      box.style.top = `${r.y}px`;
    }
    // The page draws again only when the drag starts or the dock under it changes.
    if (d.live && over === d.over) return;
    if (!d.live) setHeld(true);
    d.live = true;
    d.over = over;
    onDrag({ id: spec.id, from: floating ? null : spec.dock, over });
  };
  const drop = (keep: boolean) => {
    const d = drag.current;
    drag.current = null;
    if (!d?.live) return;
    setHeld(false);
    onDrag(null);
    if (!keep) {
      // Put a floating panel back where it was.
      const box = section.current?.parentElement;
      if (floating && box?.classList.contains('ui-float')) { box.style.left = `${floating.x}px`; box.style.top = `${floating.y}px`; }
      return;
    }
    if (d.over) onMove(spec, d.over);
    else {
      // Let go over the page, away from the docks: it floats there (or, floating already, stays where it was put).
      const { x, y } = last.current;
      const inside = x >= d.page.left && x <= d.page.right && y >= d.page.top && y <= d.page.bottom;
      if (floating || (inside && !d.home)) onFloat(spec, floatAt(d, x, y));
    }
  };
  // Escape puts a dragged panel back where it was.
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && drag.current?.live) { e.preventDefault(); e.stopPropagation(); drop(false); } };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  });
  const key = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const at = place.panels.indexOf(spec);
    const to = e.key === 'ArrowRight' ? at + 1 : e.key === 'ArrowLeft' ? at - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? place.panels.length - 1 : null;
    if (to === null) return;
    e.preventDefault();
    const next = place.panels[(to + place.panels.length) % place.panels.length]!;
    onChoose(next);
    afterPaint(() => list.current?.querySelector<HTMLElement>(`[data-tab="${CSS.escape(next.id)}"]`)?.focus());
  };
  const hideLabel = tabbed ? `Hide ${place.panels.map((p) => p.name).join(', ')}` : `Hide ${spec.name}`;
  return (
    <section ref={section} className="ui-panel" data-shape={shape} {...(floating ? { 'data-floating': true } : {})} aria-label={spec.label ?? spec.name} data-panel={spec.id} {...(tabbed ? { 'data-tabbed': true } : {})} {...(held ? { 'data-held': true } : {})}>
      <header
        className="ui-panel-head"
        {...(movable ? { 'data-movable': true } : {})}
        onPointerDown={down}
        onPointerMove={dragMove}
        onPointerUp={() => drop(true)}
        onPointerCancel={() => drop(false)}
        onLostPointerCapture={() => drop(false)}
        onContextMenu={(e) => {
          if (!movable) return;
          e.preventDefault();
          e.stopPropagation();
          const at = e.currentTarget.getBoundingClientRect();
          setMenu({ x: e.clientX || at.left + 8, y: e.clientY || at.bottom });
        }}
      >
        {tabbed ? (
          <div ref={list} className="ui-panel-tabs" role="tablist" aria-label="Panels" onKeyDown={key}>
            {place.panels.map((p) => {
              const on = p === spec;
              return (
                <button
                  key={p.id}
                  type="button"
                  role="tab"
                  id={`panel-tab-${p.id}`}
                  className="ui-panel-tab"
                  data-tab={p.id}
                  aria-selected={on}
                  aria-controls={`panel-body-${spec.id}`}
                  tabIndex={on ? 0 : -1}
                  onClick={() => onChoose(p)}
                >{p.name}</button>
              );
            })}
          </div>
        ) : (
          <h2 className="ui-panel-name">{spec.name}</h2>
        )}
        {!place.panels.every((p) => p.fixed) && (
          <button type="button" className="ui-panel-close" aria-label={hideLabel} title={hideLabel} onClick={onHide}>
            <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6" /></svg>
          </button>
        )}
      </header>
      {menu && (
        <PointMenu
          x={menu.x}
          y={menu.y}
          label={`${spec.name} panel`}
          entries={[...moveEntries, { label: hideLabel, run: onHide, separated: true }]}
          onClose={() => setMenu(null)}
        />
      )}
      <div className="ui-panel-body" id={`panel-body-${spec.id}`} {...(tabbed ? { role: 'tabpanel', 'aria-labelledby': `panel-tab-${spec.id}` } : {})}><ShapeContext.Provider value={shape}>{spec.render()}</ShapeContext.Provider></div>
    </section>
  );
}

/** The edge between a dock and the content: drag to resize, double-click for the default size, arrows by 16px. */
function DockEdge({ dock, size, onSize }: { dock: PanelDock; size: number; onSize: (size: number | undefined) => void }) {
  const drag = useRef<{ from: number; size: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const at = (e: { clientX: number; clientY: number }) => (dock === 'left' ? e.clientX : dock === 'right' ? -e.clientX : -e.clientY);
  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { from: at(e), size };
    setDragging(true);
  };
  const end = () => { drag.current = null; setDragging(false); };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current) onSize(drag.current.size + at(e) - drag.current.from);
  };
  const key = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const grow: Record<string, number> = dock === 'left' ? { ArrowRight: 16, ArrowLeft: -16 } : dock === 'right' ? { ArrowLeft: 16, ArrowRight: -16 } : { ArrowUp: 16, ArrowDown: -16 };
    const by = grow[e.key];
    if (by) { e.preventDefault(); onSize(size + by); }
  };
  return (
    <div
      className="ui-dock-edge"
      role="separator"
      tabIndex={0}
      aria-orientation={dock === 'bottom' ? 'horizontal' : 'vertical'}
      aria-label={dock === 'bottom' ? 'Resize the panels at the bottom' : `Resize the panels on the ${dock}`}
      aria-valuenow={size}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      data-dragging={dragging || undefined}
      onDoubleClick={() => onSize(undefined)}
      onKeyDown={key}
    />
  );
}

/** A panel the shell owns (Mobius), as the Panels menu and the View menu list it. */
export interface ShellPanel { name: string; shown: boolean; keys?: string; disabled?: boolean; toggle: () => void }

/**
 * The rows that show and hide panels: the shell's own (Mobius), the inspector's, the open app's with a tick when
 * shown and its key, then Reset layout. The View menu ends with them; on macOS they are the Panels button's menu.
 * Keys are given as written for this computer when `describeKeys` is given, and as bindings otherwise.
 */
export function usePanelEntries({ app, shell, describeKeys = (k) => k, onReset }: {
  app: PanelsOfApp | null;
  shell: ShellPanel[];
  describeKeys?: (keys: string) => string;
  onReset?: () => void;
}): MenuEntry[] {
  // The inspector's panels: shown means the inspector is open with that panel in front.
  const inspector = useInspector();
  return [
    ...shell.map((s) => ({ label: s.name, checked: s.shown, run: s.toggle, ...(s.keys ? { keys: describeKeys(s.keys) } : {}), ...(s.disabled ? { disabled: true } : {}) })),
    ...inspector.panels.map((p, i) => {
      const on = inspector.open && inspector.active === p.id;
      return { label: p.name, checked: on, run: () => (on ? inspector.setOpen(false) : inspector.show(p.id)), separated: i === 0 };
    }),
    ...(app?.panels ?? []).map((p, i) => ({ label: p.name, checked: p.shown, run: () => app!.toggle(p.id), separated: i === 0, ...(p.keys ? { keys: describeKeys(p.keys) } : {}) })),
    { label: 'Reset layout', separated: true, run: () => { app?.reset(); onReset?.(); } },
  ];
}

/**
 * The Panels button, where the shell's menus are in the system menu bar (macOS): the rows of `usePanelEntries`.
 * Everywhere else those rows end the View menu in the title row.
 */
export function PanelsMenu({ app, shell, describeKeys, onReset }: {
  app: PanelsOfApp | null;
  /** Mobius: panels the shell owns. */
  shell: ShellPanel[];
  /** How a key is written for this computer ("Ctrl+Shift+O"). */
  describeKeys: (keys: string) => string;
  /** The shell's part of Reset layout. */
  onReset?: () => void;
}) {
  const entries = usePanelEntries({ app, shell, describeKeys, ...(onReset ? { onReset } : {}) });
  return (
    <Menu
      label="Panels"
      entries={entries}
      align="end"
      trigger={
        <button type="button" className="strip-btn ui-panels-btn" aria-label="Panels" title="Panels: show, hide and reset">
          <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="4" width="14" height="12" rx="1.5" /><path d="M8 4v12M8 11.5h9" /></svg>
        </button>
      }
    />
  );
}
