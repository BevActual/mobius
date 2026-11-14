/**
 * Mobius's shared controls. Every app uses these instead of drawing its own menus, dialogs, popovers, switches and
 * pickers, so they behave and look the same everywhere. Behaviour comes from Base UI; the look comes from ui.css,
 * which uses only the values in tokens.css.
 */
import './ui.css';

export { Menu, PointMenu, type MenuEntry } from './Menu';
export { UndoToast } from './UndoToast';
export { AppFrame, ToolbarControls, type ToolbarParts } from './AppFrame';
export { ViewSwitch, type ViewChoice } from './ViewSwitch';
export { AppSidebar, SidebarSearch, SidebarSection, SidebarRow, type SidebarRowDrop } from './AppSidebar';
export { PanelLayout, PanelsMenu, DOCK_SIZE, type PanelSpec, type PanelDock, type PanelsOfApp } from './PanelLayout';
export { PanelTab, PanelTabsProvider, RightPanelTabs, useShowPanelTab } from './PanelTabs';
export { AppMenu, AppMenuProvider, useAppMenuHost, type AppMenuState } from './AppMenu';
export { TooltipLayer, KeyCaps, splitTitle } from './Tooltip';
export { KeyHintBar, type KeyHint } from './KeyHintBar';
