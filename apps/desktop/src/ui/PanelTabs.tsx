import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Tabs in the right panel (zone 5), beside Mobius: an app's own panel (Photo's Adjust, Music's Device, Docs' Outline)
 * written in the app's own file with `PanelTab`, the way `ToolbarControls` fills the toolbar. The rule
 * (docs/design/rules.md): the app's tabs come first, Mobius is always the last tab, and the panel opens again on the
 * tab used last in that app (the app's first tab until one is chosen).
 */
interface Tab { id: string; name: string }
interface TabsApi {
  tabs: Tab[];
  add: (tab: Tab) => void;
  remove: (id: string) => void;
  hosts: Record<string, HTMLElement | null>;
  setHost: (id: string, el: HTMLElement | null) => void;
}

const PanelTabsContext = createContext<TabsApi | null>(null);

/** Held by the frame: the tabs the open app has asked for, and where each one's content is drawn. */
export function PanelTabsProvider({ children }: { children: ReactNode }) {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [hosts, setHosts] = useState<Record<string, HTMLElement | null>>({});
  const add = useCallback((tab: Tab) => setTabs((all) => (all.some((t) => t.id === tab.id && t.name === tab.name) ? all : [...all.filter((t) => t.id !== tab.id), tab])), []);
  const remove = useCallback((id: string) => setTabs((all) => all.filter((t) => t.id !== id)), []);
  const setHost = useCallback((id: string, el: HTMLElement | null) => setHosts((all) => (all[id] === el ? all : { ...all, [id]: el })), []);
  const api = useMemo(() => ({ tabs, add, remove, hosts, setHost }), [tabs, add, remove, hosts, setHost]);
  return <PanelTabsContext.Provider value={api}>{children}</PanelTabsContext.Provider>;
}

/**
 * One of the open app's panels, as a tab before Mobius in the right panel. Rendered anywhere in the app; it shows
 * only while the app is on screen and the right panel is open, and goes when the app goes.
 */
export function PanelTab({ id, name, children }: { id: string; name: string; children: ReactNode }) {
  const api = useContext(PanelTabsContext);
  const add = api?.add;
  const remove = api?.remove;
  useEffect(() => {
    if (!add || !remove) return undefined;
    add({ id, name });
    return () => remove(id);
  }, [add, remove, id, name]);
  const host = api?.hosts[id];
  return host ? createPortal(children, host) : null;
}

const LAST_KEY = 'mobius.panelTab.';
const lastTab = (key: string): string | null => { try { return window.localStorage.getItem(LAST_KEY + key); } catch { return null; } };
const keepTab = (key: string, id: string) => { try { window.localStorage.setItem(LAST_KEY + key, id); } catch { /* Not kept. */ } };

/**
 * The right panel's contents, drawn by the shell: with no app tabs, Mobius alone; with them, a row of tabs (the app's,
 * then Mobius) and a close button, over the chosen tab. Mobius stays mounted behind another tab, so a conversation
 * keeps its place.
 */
export function RightPanelTabs({ mobius, onClose }: { mobius: ReactNode; onClose?: () => void }) {
  const api = useContext(PanelTabsContext);
  const tabs = api?.tabs ?? [];
  const key = tabs.map((t) => t.id).join('+');
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const remembered = chosen[key] ?? lastTab(key);
  const active = tabs.length === 0 ? 'mobius' : remembered === 'mobius' || tabs.some((t) => t.id === remembered) ? remembered! : tabs[0]!.id;
  const choose = (id: string) => { setChosen((all) => ({ ...all, [key]: id })); keepTab(key, id); };
  const all = [...tabs, { id: 'mobius', name: 'Mobius' }];
  // Siblings in the dock, not a wrapper: the shell and its tests find Mobius as the dock's own `.chat`. Behind an app's
  // tab, Mobius is hidden by the head's data-showing (styles.css), not unmounted.
  return (
    <>
      {tabs.length > 0 && (
        <div className="panel-tabs-head" data-showing={active === 'mobius' ? 'mobius' : 'app'}>
          <div className="panel-tabs" role="tablist" aria-label="Panel"
            onKeyDown={(e) => {
              if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
              e.preventDefault();
              const at = all.findIndex((t) => t.id === active);
              const next = all[(at + (e.key === 'ArrowRight' ? 1 : all.length - 1)) % all.length]!;
              choose(next.id);
              requestAnimationFrame(() => document.getElementById(`panel-tab-${next.id}`)?.focus());
            }}>
            {all.map((t) => (
              <button key={t.id} id={`panel-tab-${t.id}`} type="button" role="tab" className="panel-tab" data-mobius={t.id === 'mobius' || undefined}
                aria-selected={t.id === active} tabIndex={t.id === active ? 0 : -1} onClick={() => choose(t.id)}>
                {t.name}
              </button>
            ))}
          </div>
          {onClose && (
            <button type="button" className="head-icon" aria-label="Hide" title="Hide the panel" onClick={onClose}>
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5.5 5.5l9 9M14.5 5.5l-9 9" /></svg>
            </button>
          )}
        </div>
      )}
      {tabs.map((t) => <TabHost key={t.id} id={t.id} shown={active === t.id} />)}
      {mobius}
    </>
  );
}

/** Where one app tab's content is drawn; its element is told to the tab once, not on every render. */
function TabHost({ id, shown }: { id: string; shown: boolean }) {
  const setHost = useContext(PanelTabsContext)?.setHost;
  const ref = useCallback((el: HTMLDivElement | null) => setHost?.(id, el), [id, setHost]);
  return <div ref={ref} role="tabpanel" aria-labelledby={`panel-tab-${id}`} className="panel-tab-body" hidden={!shown} />;
}
