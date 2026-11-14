import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { SIDEBAR_WIDTH } from '@mobius/shared';
import { Resizer } from '../Resizer';

/**
 * The inspector (zone 5a, docs/design/panel-layouts.md): an app's own panels (Photo's Adjust, Slides' Format, Docs'
 * Outline) in a column of their own between the content and Mobius, written in the app's own file with `PanelTab`, the
 * way `ToolbarControls` fills the toolbar. The Mobius panel is just Mobius (Andrew, 14 November 2026): no app panel is
 * ever a tab beside it. With more than one panel the inspector shows them as tabs among themselves, and it opens again
 * on the one used last in that app.
 */
interface Tab { id: string; name: string; shown: boolean }
interface TabsApi {
  tabs: Tab[];
  add: (tab: Tab) => void;
  remove: (id: string) => void;
  hosts: Record<string, HTMLElement | null>;
  setHost: (id: string, el: HTMLElement | null) => void;
  /** Whether the inspector is open for this set of panels (kept per app, on this device). */
  open: boolean;
  setOpen: (open: boolean) => void;
  /** The panel in front, for this set of panels. */
  active: string | null;
  choose: (id: string) => void;
  /** Bring a panel forward, opening the inspector; 'mobius' opens the Mobius panel instead. */
  show: (id: string) => void;
  /** Which of the two was brought forward last, for a window too narrow to show both (under 1280px, styles.css). */
  front: 'inspector' | 'mobius';
}

const PanelTabsContext = createContext<TabsApi | null>(null);

/** Panels that start shown the first time their app is opened (panel-layouts.md); the rest start hidden. Music has no
 * inspector: its devices go in the bottom area. */
const STARTS_SHOWN = new Set(['format', 'adjust', 'shot', 'inspector']);

const OPEN_KEY = 'mobius.inspector.';
const LAST_KEY = 'mobius.panelTab.';
const WIDTH_KEY = 'mobius.inspector.width';
const read = (key: string): string | null => { try { return window.localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string) => { try { window.localStorage.setItem(key, value); } catch { /* Not kept. */ } };

/** Whether the inspector starts open for these panels: as the person left it, else when one of them starts shown. */
export function inspectorStartsOpen(tabs: readonly Tab[], kept: string | null): boolean {
  if (kept === 'open') return true;
  if (kept === 'closed') return false;
  return tabs.some((t) => t.shown);
}

/** The panel in front: the one chosen last if it is still there, else the first. */
export function frontTab(tabs: readonly { id: string }[], kept: string | null): string | null {
  if (tabs.length === 0) return null;
  return kept && tabs.some((t) => t.id === kept) ? kept : tabs[0]!.id;
}

/** Held by the frame: the panels the open app has asked for, where each is drawn, and whether the inspector is open. */
export function PanelTabsProvider({ children, open: openMobius, mobiusAsked }: {
  children: ReactNode;
  /** Opens the Mobius panel (for `useShowPanelTab('mobius')`). */
  open?: () => void;
  /** Changes whenever the person asks Mobius something: where the window has room for only one of the two, Mobius
   * comes in front of the inspector. */
  mobiusAsked?: string | number;
}) {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [hosts, setHosts] = useState<Record<string, HTMLElement | null>>({});
  const add = useCallback((tab: Tab) => setTabs((all) => (all.some((t) => t.id === tab.id && t.name === tab.name && t.shown === tab.shown) ? all : [...all.filter((t) => t.id !== tab.id), tab])), []);
  const remove = useCallback((id: string) => setTabs((all) => all.filter((t) => t.id !== id)), []);
  const setHost = useCallback((id: string, el: HTMLElement | null) => setHosts((all) => (all[id] === el ? all : { ...all, [id]: el })), []);
  const key = tabs.map((t) => t.id).join('+');
  const [openNow, setOpenNow] = useState<Record<string, boolean>>({});
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const open = key !== '' && (openNow[key] ?? inspectorStartsOpen(tabs, read(OPEN_KEY + key)));
  // In a narrow window the inspector and Mobius take turns: the one brought forward last is shown.
  const [front, setFront] = useState<'inspector' | 'mobius'>('mobius');
  const asked = useRef(mobiusAsked);
  useEffect(() => {
    if (asked.current === mobiusAsked) return;
    asked.current = mobiusAsked;
    setFront('mobius');
  }, [mobiusAsked]);
  const setOpen = useCallback((next: boolean) => {
    if (key === '') return;
    setOpenNow((all) => ({ ...all, [key]: next }));
    setFront(next ? 'inspector' : 'mobius');
    write(OPEN_KEY + key, next ? 'open' : 'closed');
  }, [key]);
  const active = frontTab(tabs, chosen[key] ?? read(LAST_KEY + key));
  const choose = useCallback((id: string) => { setChosen((all) => ({ ...all, [key]: id })); write(LAST_KEY + key, id); }, [key]);
  // A panel asked for before it has registered (an app can ask in the same render) is brought forward when it comes.
  const [wanted, setWanted] = useState<string | null>(null);
  const show = useCallback((id: string) => {
    if (id === 'mobius') { setFront('mobius'); openMobius?.(); return; }
    setWanted(id);
  }, [openMobius]);
  useEffect(() => {
    if (!wanted || !tabs.some((t) => t.id === wanted)) return;
    choose(wanted);
    setOpen(true);
    setWanted(null);
  }, [wanted, tabs, choose, setOpen]);
  const api = useMemo(() => ({ tabs, add, remove, hosts, setHost, open, setOpen, active, choose, show, front }), [tabs, add, remove, hosts, setHost, open, setOpen, active, choose, show, front]);
  return <PanelTabsContext.Provider value={api}>{children}</PanelTabsContext.Provider>;
}

/**
 * One of the open app's panels, in the inspector. Rendered anywhere in the app; it shows only while the app is on
 * screen and the inspector is open, and goes when the app goes. `shown` says whether it starts shown (the defaults in
 * panel-layouts.md are used when it is left out).
 */
export function PanelTab({ id, name, shown, children }: { id: string; name: string; shown?: boolean; children: ReactNode }) {
  const api = useContext(PanelTabsContext);
  const add = api?.add;
  const remove = api?.remove;
  const starts = shown ?? STARTS_SHOWN.has(id);
  useEffect(() => {
    if (!add || !remove) return undefined;
    add({ id, name, shown: starts });
    return () => remove(id);
  }, [add, remove, id, name, starts]);
  const host = api?.hosts[id];
  return host ? createPortal(children, host) : null;
}

/**
 * Brings one of the app's panels forward in the inspector, opening it when it is shut ('mobius' opens the Mobius
 * panel): Photo's Adjust button shows Adjust even while the inspector is closed.
 */
export function useShowPanelTab(): (id: string) => void {
  const show = useContext(PanelTabsContext)?.show;
  return useCallback((id: string) => show?.(id), [show]);
}

/** The inspector's state for the frame: its panels, whether it is open, and a way to open or close it. */
export function useInspector(): { panels: { id: string; name: string }[]; open: boolean; active: string | null; setOpen: (open: boolean) => void; show: (id: string) => void } {
  const api = useContext(PanelTabsContext);
  return useMemo(() => ({ panels: (api?.tabs ?? []).map(({ id, name }) => ({ id, name })), open: api?.open ?? false, active: api?.active ?? null, setOpen: api?.setOpen ?? (() => undefined), show: api?.show ?? (() => undefined) }), [api]);
}

const inspectorWidth = (): number => {
  const n = Number(read(WIDTH_KEY));
  const { min, max, default: usual } = SIDEBAR_WIDTH.inspector;
  return Number.isFinite(n) && n >= min && n <= max ? n : usual;
};

/**
 * The inspector column, drawn by the shell between the content and Mobius: nothing while the app has no panels or it
 * is closed; otherwise a head (the panel's name, or the panels as tabs) with a close button, over the panel in front.
 * Every panel's body stays mounted behind the others, so each keeps its place.
 */
export function InspectorDock() {
  const api = useContext(PanelTabsContext);
  const [width, setWidth] = useState(inspectorWidth);
  const [drag, setDrag] = useState<number | null>(null);
  const tabs = api?.tabs ?? [];
  if (!api || tabs.length === 0) return null;
  const { active, choose, open, setOpen, front } = api;
  const shown = drag ?? width;
  return (
    <aside className="dock inspector" aria-label="Inspector" hidden={!open} data-front={front === 'inspector' || undefined} style={{ width: shown }}>
      <div className="panel-tabs-head">
        {tabs.length === 1 ? <h2 className="inspector-title">{tabs[0]!.name}</h2> : (
          <div className="panel-tabs" role="tablist" aria-label="Panel"
            onKeyDown={(e) => {
              if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
              e.preventDefault();
              const at = tabs.findIndex((t) => t.id === active);
              const next = tabs[(at + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]!;
              choose(next.id);
              requestAnimationFrame(() => document.getElementById(`panel-tab-${next.id}`)?.focus());
            }}>
            {tabs.map((t) => (
              <button key={t.id} id={`panel-tab-${t.id}`} type="button" role="tab" className="panel-tab"
                aria-selected={t.id === active} tabIndex={t.id === active ? 0 : -1} onClick={() => choose(t.id)}>
                {t.name}
              </button>
            ))}
          </div>
        )}
        <button type="button" className="head-icon" aria-label="Hide the inspector" title="Hide the inspector" onClick={() => setOpen(false)}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5.5 5.5l9 9M14.5 5.5l-9 9" /></svg>
        </button>
      </div>
      {tabs.map((t) => <TabHost key={t.id} id={t.id} name={t.name} shown={active === t.id} single={tabs.length === 1} />)}
      <Resizer side="inspector" width={shown} label="Resize the inspector" onDrag={setDrag} onCommit={(next) => { setWidth(next); write(WIDTH_KEY, String(next)); }} />
    </aside>
  );
}

/** Where one panel's content is drawn; its element is told to the panel once, not on every render. */
function TabHost({ id, name, shown, single }: { id: string; name: string; shown: boolean; single: boolean }) {
  const setHost = useContext(PanelTabsContext)?.setHost;
  const ref = useCallback((el: HTMLDivElement | null) => setHost?.(id, el), [id, setHost]);
  // Alone, the panel's own content names itself (Studio's Device is its own region); with others it is a tab's panel.
  return single
    ? <div ref={ref} className="panel-tab-body" data-panel={name} />
    : <div ref={ref} role="tabpanel" aria-labelledby={`panel-tab-${id}`} className="panel-tab-body" hidden={!shown} />;
}
