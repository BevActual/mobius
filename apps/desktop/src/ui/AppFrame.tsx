import { createContext, useContext, useState, type CSSProperties, type ReactNode } from 'react';
import { PanelRegistryContext, type PanelsOfApp } from './PanelLayout';
import { AppMenuProvider, useAppMenuHost, type AppMenuState } from './AppMenu';
import { createPortal } from 'react-dom';

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
}

const ToolbarSlot = createContext<HTMLElement | null>(null);

export function AppFrame({ rail, toolbar, children, style, data }: FrameProps) {
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const [panels, setPanels] = useState<PanelsOfApp | null>(null);
  const [appMenu, setAppMenu] = useAppMenuHost();
  return (
    <AppMenuProvider value={setAppMenu}>
    <PanelRegistryContext.Provider value={setPanels}>
    <ToolbarSlot.Provider value={slot}>
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
          <div className="strip-right" role="group" aria-label="Applications">{typeof toolbar.trail === 'function' ? toolbar.trail(appMenu) : toolbar.trail}</div>
        </header>
        {children}
      </div>
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
