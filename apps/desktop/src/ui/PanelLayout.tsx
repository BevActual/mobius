import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Menu, type MenuEntry } from './Menu';

/**
 * Panels (docs/design/panel-layouts.md, stage 1: show, hide, resize). A panel is a named, self-contained piece of an
 * app that sits in a dock beside its content: the bottom dock under the content (across the content's width only), or
 * the right dock beside it. The app sidebar and Mobius are panels too; the shell owns those two.
 *
 * An app wraps its page in `PanelLayout` and declares its panels. The frame lists them in the toolbar's Panels menu
 * (and View › Panels), with their keys, and keeps what is shown and each dock's size per app, on this device.
 */
export type PanelDock = 'right' | 'bottom';

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
  /** The panel's body. Its own controls go here, never in the header. */
  render: () => ReactNode;
}

/** Each dock's size: the default, and the range a drag keeps to. The bottom dock is at most 70% of the content. */
export const DOCK_SIZE = {
  right: { min: 280, max: 560, initial: 320 },
  bottom: { min: 120, maxShare: 0.7, initial: 260 },
} as const;

export interface SavedLayout { shown: Record<string, boolean>; size: Partial<Record<PanelDock, number>> }

const storeKey = (app: string) => `mobius.layout.${app}`;
const EMPTY: SavedLayout = { shown: {}, size: {} };

/** What was kept for an app: anything unreadable counts as nothing kept. */
export function parseLayout(text: string | null): SavedLayout {
  if (!text) return EMPTY;
  try {
    const v = JSON.parse(text) as Partial<SavedLayout>;
    const shown = Object.fromEntries(Object.entries(v.shown ?? {}).filter(([, on]) => typeof on === 'boolean')) as Record<string, boolean>;
    const size: SavedLayout['size'] = {};
    for (const dock of ['right', 'bottom'] as const) {
      const n = v.size?.[dock];
      if (typeof n === 'number' && Number.isFinite(n)) size[dock] = n;
    }
    return { shown, size };
  } catch {
    return EMPTY;
  }
}

function readLayout(app: string): SavedLayout {
  try { return parseLayout(window.localStorage.getItem(storeKey(app))); } catch { return EMPTY; }
}
function writeLayout(app: string, layout: SavedLayout) {
  try {
    if (layout.size.right === undefined && layout.size.bottom === undefined && Object.keys(layout.shown).length === 0) window.localStorage.removeItem(storeKey(app));
    else window.localStorage.setItem(storeKey(app), JSON.stringify(layout));
  } catch { /* Kept only until Mobius closes. */ }
}

/** A dock's size within its range. `room` is the content's height, for the bottom dock. */
export function clampDock(dock: PanelDock, size: number, room = Infinity): number {
  if (dock === 'right') return Math.round(Math.min(DOCK_SIZE.right.max, Math.max(DOCK_SIZE.right.min, size)));
  const max = Math.max(DOCK_SIZE.bottom.min, Math.floor(room * DOCK_SIZE.bottom.maxShare));
  return Math.round(Math.min(max, Math.max(DOCK_SIZE.bottom.min, size)));
}

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
  useEffect(() => setSaved(readLayout(app)), [app]);
  const update = useCallback((change: (was: SavedLayout) => SavedLayout) => {
    setSaved((was) => { const next = change(was); writeLayout(app, next); return next; });
  }, [app]);
  const isShown = useCallback((p: PanelSpec) => saved.shown[p.id] ?? p.shown ?? false, [saved.shown]);
  const toggle = useCallback((id: string) => {
    const p = panels.find((x) => x.id === id);
    if (p) update((was) => ({ ...was, shown: { ...was.shown, [id]: !(was.shown[id] ?? p.shown ?? false) } }));
  }, [panels, update]);
  const reset = useCallback(() => update(() => EMPTY), [update]);

  // The frame lists this app's panels in its Panels menu while the app is on screen.
  const register = useContext(Registry);
  const listed = useMemo<PanelsOfApp>(() => ({
    panels: panels.map((p) => ({ id: p.id, name: p.name, dock: p.dock, shown: isShown(p), ...(p.keys ? { keys: p.keys } : {}) })),
    toggle,
    reset,
  }), [panels, isShown, toggle, reset]);
  useEffect(() => { register?.(listed); }, [register, listed]);
  useEffect(() => () => register?.(null), [register]);

  // Each panel's key, and mod+J for the whole bottom dock.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const bottom = panels.filter((p) => p.dock === 'bottom');
      if (bottom.length > 0 && pressIs('mod+j', e, mac())) {
        e.preventDefault();
        const anyShown = bottom.some(isShown);
        update((was) => ({ ...was, shown: { ...was.shown, ...Object.fromEntries(bottom.map((p) => [p.id, !anyShown])) } }));
        return;
      }
      const hit = panels.find((p) => p.keys && pressIs(p.keys, e, mac()));
      if (hit) { e.preventDefault(); toggle(hit.id); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panels, isShown, toggle, update]);

  const main = useRef<HTMLDivElement>(null);
  const right = panels.filter((p) => p.dock === 'right' && isShown(p));
  const bottom = panels.filter((p) => p.dock === 'bottom' && isShown(p));
  const rightSize = clampDock('right', saved.size.right ?? right.find((p) => p.size)?.size ?? DOCK_SIZE.right.initial);
  const bottomSize = clampDock('bottom', saved.size.bottom ?? bottom.find((p) => p.size)?.size ?? DOCK_SIZE.bottom.initial, main.current?.clientHeight ?? Infinity);
  const resize = (dock: PanelDock, size: number | undefined) => update((was) => {
    const next = { ...was.size };
    if (size === undefined) delete next[dock]; else next[dock] = clampDock(dock, size, main.current?.clientHeight ?? Infinity);
    return { ...was, size: next };
  });
  const hide = (id: string) => update((was) => ({ ...was, shown: { ...was.shown, [id]: false } }));

  return (
    <div className="ui-panels" data-app={app}>
      <div ref={main} className="ui-panels-main">
        <div className="ui-panels-content">{children}</div>
        {bottom.length > 0 && (
          <div className="ui-dock" data-dock="bottom" style={{ height: bottomSize }}>
            <DockEdge dock="bottom" size={bottomSize} onSize={(n) => resize('bottom', n)} />
            {bottom.map((p) => <Panel key={p.id} spec={p} onHide={() => hide(p.id)} />)}
          </div>
        )}
      </div>
      {right.length > 0 && (
        <div className="ui-dock" data-dock="right" style={{ width: rightSize }}>
          <DockEdge dock="right" size={rightSize} onSize={(n) => resize('right', n)} />
          {right.map((p) => <Panel key={p.id} spec={p} onHide={() => hide(p.id)} />)}
        </div>
      )}
    </div>
  );
}

/** Every panel has the same header: its name, then close. Nothing else lives there. */
function Panel({ spec, onHide }: { spec: PanelSpec; onHide: () => void }) {
  return (
    <section className="ui-panel" aria-label={spec.name} data-panel={spec.id}>
      <header className="ui-panel-head">
        <h2 className="ui-panel-name">{spec.name}</h2>
        <button type="button" className="ui-panel-close" aria-label={`Hide ${spec.name}`} title={`Hide ${spec.name}`} onClick={onHide}>
          <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6" /></svg>
        </button>
      </header>
      <div className="ui-panel-body">{spec.render()}</div>
    </section>
  );
}

/** The edge between a dock and the content: drag to resize, double-click for the default size, arrows by 16px. */
function DockEdge({ dock, size, onSize }: { dock: PanelDock; size: number; onSize: (size: number | undefined) => void }) {
  const drag = useRef<{ from: number; size: number } | null>(null);
  const at = (e: { clientX: number; clientY: number }) => (dock === 'right' ? -e.clientX : -e.clientY);
  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { from: at(e), size };
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current) onSize(drag.current.size + at(e) - drag.current.from);
  };
  const key = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const grow: Record<string, number> = dock === 'right' ? { ArrowLeft: 16, ArrowRight: -16 } : { ArrowUp: 16, ArrowDown: -16 };
    const by = grow[e.key];
    if (by) { e.preventDefault(); onSize(size + by); }
  };
  return (
    <div
      className="ui-dock-edge"
      role="separator"
      tabIndex={0}
      aria-orientation={dock === 'right' ? 'vertical' : 'horizontal'}
      aria-label={dock === 'right' ? 'Resize the panels on the right' : 'Resize the panels at the bottom'}
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

/**
 * The toolbar's Panels menu: every panel of the open app with a tick when shown and its key, the shell's own two (the
 * sidebar and Mobius), then Reset layout.
 */
export function PanelsMenu({ app, shell, describeKeys, onReset }: {
  app: PanelsOfApp | null;
  /** The sidebar and Mobius: panels the shell owns. */
  shell: { name: string; shown: boolean; keys?: string; disabled?: boolean; toggle: () => void }[];
  /** How a key is written for this computer ("Ctrl+Shift+O"). */
  describeKeys: (keys: string) => string;
  /** The shell's part of Reset layout (the sidebar and Mobius back as they start). */
  onReset?: () => void;
}) {
  const entries: MenuEntry[] = [
    ...shell.map((s) => ({ label: s.name, checked: s.shown, run: s.toggle, ...(s.keys ? { keys: describeKeys(s.keys) } : {}), ...(s.disabled ? { disabled: true } : {}) })),
    ...(app?.panels ?? []).map((p, i) => ({ label: p.name, checked: p.shown, run: () => app!.toggle(p.id), separated: i === 0, ...(p.keys ? { keys: describeKeys(p.keys) } : {}) })),
    { label: 'Reset layout', separated: true, run: () => { app?.reset(); onReset?.(); } },
  ];
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
