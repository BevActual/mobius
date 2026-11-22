import { useSideFolds } from '../side-fold';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Menu, type MenuEntry } from './Menu';
import { useInspector } from './PanelTabs';
import { afterPaint } from './frame';

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
  /** The name screen readers hear, when it must differ from the header's (Settings' panel, beside a page also named Settings). */
  label?: string;
  /** The panel's body. Its own controls go here, never in the header. */
  render: () => ReactNode;
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
}

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
    return Object.keys(front).length > 0 ? { shown, size, front } : { shown, size };
  } catch {
    return EMPTY;
  }
}

function readLayout(app: string): SavedLayout {
  try { return parseLayout(window.localStorage.getItem(storeKey(app))); } catch { return EMPTY; }
}
function writeLayout(app: string, layout: SavedLayout) {
  try {
    if (DOCKS.every((d) => layout.size[d] === undefined) && Object.keys(layout.shown).length === 0 && Object.keys(layout.front ?? {}).length === 0) window.localStorage.removeItem(storeKey(app));
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
  /** Back to the app's own layout: its panels as declared, its docks at their default sizes. */
  reset: () => void;
}

const Registry = createContext<((app: PanelsOfApp | null) => void) | null>(null);

/** The frame provides this: the open app's layout registers itself, so the Panels menu can list it. */
export const PanelRegistryContext = Registry;

const mac = () => typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);

export function PanelLayout({ app, panels, children }: { app: string; panels: readonly PanelSpec[]; children: ReactNode }) {
  const [saved, setSaved] = useState<SavedLayout>(() => readLayout(app));
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
  const isShown = useCallback((p: PanelSpec) => saved.shown[p.id] ?? p.shown ?? false, [saved.shown]);
  const isFront = useCallback((p: PanelSpec) => {
    if (!p.group) return true;
    const place = dockPlaces(panels.filter((x) => x.dock === p.dock && isShown(x)), saved.front).find((x) => x.panels.includes(p));
    return place?.front === p;
  }, [panels, isShown, saved.front]);
  const toggle = useCallback((id: string) => {
    const p = panels.find((x) => x.id === id);
    if (!p) return;
    const on = isShown(p);
    // A panel shown behind another tab comes to the front rather than hiding.
    if (on && p.group && !isFront(p)) { update((was) => ({ ...was, front: { ...was.front, [p.group!]: id } })); return; }
    if (p.onHide && on) { p.onHide(); return; }
    update((was) => ({ ...withFront(was, on ? [] : [p]), shown: { ...was.shown, [id]: !on } }));
  }, [panels, isShown, isFront, update]);
  const reset = useCallback(() => update(() => EMPTY), [update]);
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
    panels: panels.map((p) => ({ id: p.id, name: p.name, dock: p.dock, shown: isShown(p), ...(p.keys ? { keys: p.keys } : {}) })),
    toggle,
    reset,
  }), [panels, isShown, toggle, reset]);
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
      const inDock = dock ? panels.filter((p) => p.dock === dock) : [];
      if (inDock.length === 0) return;
      e.preventDefault();
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
  const left = panels.filter((p) => p.dock === 'left' && isShown(p));
  // The lists on the left fold their sections, as every sidebar does (side-fold.ts).
  useSideFolds(leftDock, left.length > 0);
  const right = panels.filter((p) => p.dock === 'right' && isShown(p));
  const leftSize = clampDock('left', saved.size.left ?? left.find((p) => p.size)?.size ?? DOCK_SIZE.left.initial);
  const bottom = panels.filter((p) => p.dock === 'bottom' && isShown(p));
  const rightSize = clampDock('right', saved.size.right ?? right.find((p) => p.size)?.size ?? DOCK_SIZE.right.initial);
  const bottomSize = clampDock('bottom', saved.size.bottom ?? bottom.find((p) => p.size)?.size ?? DOCK_SIZE.bottom.initial, mainHeight.current);
  const resize = (dock: PanelDock, size: number | undefined) => update((was) => {
    const next = { ...was.size };
    if (size === undefined) delete next[dock]; else next[dock] = clampDock(dock, size, mainHeight.current);
    return { ...was, size: next };
  });
  // Close in a tab group's header hides the whole group.
  const hide = (place: DockPlace) => {
    place.panels.filter((p) => p.onHide).forEach((p) => p.onHide!());
    const rest = place.panels.filter((p) => !p.onHide);
    if (rest.length > 0) update((was) => ({ ...was, shown: { ...was.shown, ...Object.fromEntries(rest.map((p) => [p.id, false])) } }));
  };
  const choose = (p: PanelSpec) => update((was) => withFront(was, [p]));
  const draw = (shown: PanelSpec[]) => dockPlaces(shown, saved.front).map((place) => (
    <Panel key={place.key} place={place} onHide={() => hide(place)} onChoose={choose} />
  ));

  return (
    <div className="ui-panels" data-app={app}>
      {left.length > 0 && (
        <div ref={leftDock} className="ui-dock" data-dock="left" style={{ width: leftSize }}>
          {draw(left)}
          <DockEdge dock="left" size={leftSize} onSize={(n) => resize('left', n)} />
        </div>
      )}
      <div ref={main} className="ui-panels-main">
        <div className="ui-panels-content">{children}</div>
        {bottom.length > 0 && (
          <div className="ui-dock" data-dock="bottom" style={{ height: bottomSize }}>
            <DockEdge dock="bottom" size={bottomSize} onSize={(n) => resize('bottom', n)} />
            {draw(bottom)}
          </div>
        )}
      </div>
      {right.length > 0 && (
        <div className="ui-dock" data-dock="right" style={{ width: rightSize }}>
          <DockEdge dock="right" size={rightSize} onSize={(n) => resize('right', n)} />
          {draw(right)}
        </div>
      )}
    </div>
  );
}

/** Bring these panels to the front of their tab groups. */
function withFront(was: SavedLayout, shown: readonly PanelSpec[]): SavedLayout {
  const grouped = shown.filter((p) => p.group);
  return grouped.length === 0 ? was : { ...was, front: { ...was.front, ...Object.fromEntries(grouped.map((p) => [p.group!, p.id])) } };
}

/** Every panel has the same header: its name (or, for a tab group, its tabs), then close. Nothing else lives there. */
function Panel({ place, onHide, onChoose }: { place: DockPlace; onHide: () => void; onChoose: (p: PanelSpec) => void }) {
  const spec = place.front;
  const tabbed = place.panels.length > 1;
  const list = useRef<HTMLDivElement>(null);
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
    <section className="ui-panel" aria-label={spec.label ?? spec.name} data-panel={spec.id} {...(tabbed ? { 'data-tabbed': true } : {})}>
      <header className="ui-panel-head">
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
        <button type="button" className="ui-panel-close" aria-label={hideLabel} title={hideLabel} onClick={onHide}>
          <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6" /></svg>
        </button>
      </header>
      <div className="ui-panel-body" id={`panel-body-${spec.id}`} {...(tabbed ? { role: 'tabpanel', 'aria-labelledby': `panel-tab-${spec.id}` } : {})}>{spec.render()}</div>
    </section>
  );
}

/** The edge between a dock and the content: drag to resize, double-click for the default size, arrows by 16px. */
function DockEdge({ dock, size, onSize }: { dock: PanelDock; size: number; onSize: (size: number | undefined) => void }) {
  const drag = useRef<{ from: number; size: number } | null>(null);
  const at = (e: { clientX: number; clientY: number }) => (dock === 'left' ? e.clientX : dock === 'right' ? -e.clientX : -e.clientY);
  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { from: at(e), size };
  };
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
      onPointerUp={() => { drag.current = null; }}
      onPointerCancel={() => { drag.current = null; }}
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
