import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { PanelRegistryContext, type PanelsOfApp } from './PanelLayout';
import { PanelTabsProvider } from './PanelTabs';
import { AppMenuProvider, useAppMenuHost, type AppMenuState } from './AppMenu';
import { createPortal } from 'react-dom';
import type { MenuEntry } from './Menu';
import { fitToolbar, menuRowsOf, type ToolbarPriority } from './toolbarFit';

/**
 * The frame every app sits in: the five zones of docs/design/panel-layouts.md.
 *
 *   1 rail · 2 app sidebar · 3 toolbar · 4 content (with an optional bottom dock) · 5 right dock (Mobius)
 *
 * The shell owns the frame; an app fills its parts from its own files with `ToolbarControls` (its controls in the
 * toolbar's middle), `ViewSwitch` (when it has more than one view) and the `AppSidebar` pieces (its sidebar's places).
 */
export interface ToolbarParts {
  /** At the toolbar's start: the button that shows and hides the sidebar. */
  lead?: ReactNode;
  /** What is open ("Q3 plan"), never the app's name alone unless nothing is open. */
  title?: ReactNode;
  /** One grey line under the title: how many unread, the save state. */
  sub?: ReactNode;
  /** False while something covers the app (Settings): the app's own controls stay mounted but are not shown. */
  appControls?: boolean;
  /** Controls the shell places in the middle, before the app's own (`ToolbarControls`). */
  middle?: ReactNode;
  /** Status that stands on its own between the middle and the end (the core's state, an update). */
  status?: ReactNode;
  /** The trailing end, the same in every app: comments, ⋯ and the Mobius button, always last. Given the open app's
   *  own menu (`AppMenu`), which goes first in the one ⋯. */
  trail?: ReactNode | ((appMenu: AppMenuState | null) => ReactNode);
  /** Changes how the title row lays out (the browser's address takes the room). */
  wideMiddle?: boolean;
  /** The Panels menu, at the end of the middle: given the open app's own panels (none when it has none). */
  panels?: (app: PanelsOfApp | null) => ReactNode;
}

interface FrameProps {
  /** Zone 1. */
  rail: ReactNode;
  /** Zone 3. */
  toolbar: ToolbarParts;
  /** Zones 2, 4 and 5, as the shell lays them out today (stage 1 of panels keeps the docks where they are). */
  children: ReactNode;
  style?: CSSProperties;
  /** data-* attributes the shell's styles and tests read. */
  data?: Record<`data-${string}`, string | boolean | undefined>;
  /** Opens the right panel (zone 5), for an app that brings one of its tabs forward while the panel is shut. */
  openRight?: () => void;
  /** Changes whenever the person asks Mobius something, so Mobius comes in front of an app's panel tab. */
  mobiusAsked?: string | number;
}

const ToolbarSlot = createContext<HTMLElement | null>(null);

export function AppFrame({ rail, toolbar, children, style, data, openRight, mobiusAsked }: FrameProps) {
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const [panels, setPanels] = useState<PanelsOfApp | null>(null);
  const [appMenu, setAppMenu] = useAppMenuHost();
  const dropped = useToolbarFit(slot);
  // Controls that did not fit come first in the one ⋯, above the app's own commands, with a line after them.
  const menu = useMemo<AppMenuState | null>(() => {
    if (dropped.length === 0) return appMenu;
    const own = appMenu?.entries ?? [];
    return { label: appMenu?.label ?? 'View', entries: [...dropped, ...own.map((e, i) => (i === 0 ? { ...e, separated: true } : e))] };
  }, [appMenu, dropped]);
  return (
    <AppMenuProvider value={setAppMenu}>
    <PanelRegistryContext.Provider value={setPanels}>
    <ToolbarSlot.Provider value={slot}>
    <PanelTabsProvider open={openRight} mobiusAsked={mobiusAsked}>
      <div className="app" style={style} {...data}>
        {rail}
        <header className="context-strip">
          <div className="strip-left" role="group" aria-label="Window">{toolbar.lead}</div>
          <div className="toolbar-place" data-browser={toolbar.wideMiddle || undefined}>
            {toolbar.title && <h1 className="strip-title">{toolbar.title}</h1>}
            {toolbar.sub && <span className="toolbar-sub">{toolbar.sub}</span>}
          </div>
          {toolbar.middle}
          <div ref={setSlot} className="ui-toolbar-slot" hidden={toolbar.appControls === false} />
          {toolbar.panels?.(panels)}
          {toolbar.status}
          <div className="strip-right" role="group" aria-label="Applications">{typeof toolbar.trail === 'function' ? toolbar.trail(menu) : toolbar.trail}</div>
        </header>
        {children}
      </div>
    </PanelTabsProvider>
    </ToolbarSlot.Provider>
    </PanelRegistryContext.Provider>
    </AppMenuProvider>
  );
}

/**
 * An app's own controls in the toolbar's middle (zone 3), written in the app's own file. They show only while the
 * app is on screen, and go when it goes. Keep to what is used often; the rest goes in the app's menu (⋯).
 */
export function ToolbarControls({ label, children }: { label: string; children: ReactNode }) {
  const slot = useContext(ToolbarSlot);
  if (!slot) return null;
  return createPortal(<div className="ui-toolbar-group" role="group" aria-label={label}>{children}</div>, slot);
}

/** Menu rows a ToolbarItem gives for itself when it drops into the ⋯ menu, by its element. */
const itemMenus = new WeakMap<Element, () => MenuEntry[]>();

/**
 * One of an app's toolbar controls, with how much it matters when the toolbar is short of room: a "low" one drops into
 * the ⋯ menu before the others, and a "keep" one never drops. `menu` is what it becomes there; without it, a plain
 * button becomes one row that presses it.
 */
export function ToolbarItem({ priority = 'normal', menu, children }: { priority?: ToolbarPriority; menu?: MenuEntry[]; children: ReactNode }) {
  const latest = useRef(menu);
  latest.current = menu;
  const ref = useCallback((el: HTMLDivElement | null) => { if (el) itemMenus.set(el, () => latest.current ?? []); }, []);
  return <div ref={ref} className="ui-toolbar-item" data-priority={priority} data-menu={menu ? '' : undefined}>{children}</div>;
}

/** The menu form of each dropped control: run the newest row, so a row never runs a stale closure. */
const rowsFor = (el: HTMLElement): MenuEntry[] => {
  const given = el.hasAttribute('data-menu') ? itemMenus.get(el)?.() : undefined;
  return menuRowsOf(el, given);
};

const sameRows = (a: MenuEntry[], b: MenuEntry[]) =>
  a.length === b.length && a.every((e, i) => e.label === b[i]!.label && e.keys === b[i]!.keys && e.checked === b[i]!.checked && e.disabled === b[i]!.disabled);

/**
 * Keeps the app's controls inside the toolbar: fits them again whenever the toolbar changes size or the controls
 * change, and returns the rows of those that dropped.
 */
function useToolbarFit(slot: HTMLElement | null): MenuEntry[] {
  const [rows, setRows] = useState<MenuEntry[]>([]);
  useEffect(() => {
    if (!slot || typeof ResizeObserver === 'undefined') return undefined;
    const strip = slot.parentElement ?? slot;
    let timer = 0;
    const fit = () => {
      window.clearTimeout(timer);
      mutations.disconnect();
      const next = fitToolbar(slot).flatMap(rowsFor);
      mutations.observe(strip, WATCH);
      setRows((now) => (sameRows(now, next) ? now : next));
    };
    // A size change fits at once (before it is drawn); a change of the controls (a readout ticking while a song plays)
    // waits a moment, so fitting is not done every frame.
    const later = () => { window.clearTimeout(timer); timer = window.setTimeout(fit, 120); };
    const sizes = new ResizeObserver(fit);
    const mutations = new MutationObserver(later);
    sizes.observe(strip);
    mutations.observe(strip, WATCH);
    fit();
    return () => { window.clearTimeout(timer); sizes.disconnect(); mutations.disconnect(); };
  }, [slot]);
  return rows;
}

const WATCH: MutationObserverInit = { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['aria-pressed', 'aria-checked', 'disabled', 'hidden', 'class'] };
