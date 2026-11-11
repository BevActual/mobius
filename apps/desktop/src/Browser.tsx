import { useCallback, useEffect, useLayoutEffect, useRef, useState, type DragEvent, type FormEvent, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { BookmarkEntry, BrowserTabState, DownloadEntry, HistoryEntry } from '@mobius/shared';
import { DownloadsList } from './DownloadsList';
import { FindBar } from './FindBar';
import { quick } from './motion';
import { SelectionMenu, type ClipPage, type WebSelectionAction } from './SelectionMenu';
import { StartPage } from './StartPage';
import { addressParts, dropPlan, hostOf, suggestionsFor, tileHue, tileLetter, type Suggestion } from './browser-view';
import { SurfaceSlot } from './SurfaceSlot';
import './browser.css';

/**
 * The Browser app's own UI: the list of tabs, the controls above the page (back, forward, reload, the address bar),
 * and the page itself, which is Mobius's start page for a new tab and otherwise the native page's slot. The shell
 * keeps the native page glued to that slot (SurfaceSlot and the window's bounds code); this file only draws.
 */

const TAB_DRIVER = { reading: 'Mobius reading', mobius: 'Mobius', yours: 'Yours' } as const;
const TAB_DRIVER_TITLE = { reading: 'Mobius is reading this tab', mobius: 'Mobius is using this tab', yours: 'You took over this tab from Mobius' } as const;

/** One tab's row: a click shows it, a middle click closes it, a right click opens its menu, and it can be dragged. */
function TabRow({ tab, onMenu, drag }: { tab: BrowserTabState; onMenu: (tab: BrowserTabState, x: number, y: number) => void; drag: TabDrag }) {
  const site = hostOf(tab.url);
  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: quick }}
      className="tab"
      aria-current={tab.active ? 'page' : undefined}
      data-pinned={tab.pinned ? 'true' : undefined}
      data-drop={drag.over?.id === tab.id ? (drag.over.after ? 'after' : 'before') : undefined}
      data-dragging={drag.dragging === tab.id || undefined}
      draggable={drag.enabled}
      onDragStartCapture={(e) => drag.start(e, tab.id)}
      onDragOver={(e) => drag.overTab(e, tab.id)}
      onDrop={(e) => drag.drop(e)}
      onDragEndCapture={drag.end}
      onContextMenu={(e) => { e.preventDefault(); onMenu(tab, e.clientX, e.clientY); }}
      onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); window.mobius.browser.close(tab.id); } }}
    >
      <button type="button" className="tab-main" title={tab.url ? `${tab.title}\n${tab.url}` : tab.title} onClick={() => window.mobius.browser.activate(tab.id)}>
        {tab.icon ? <img className="tab-icon" src={tab.icon} alt="" width={16} height={16} draggable={false} /> : <span className="tab-icon placeholder" aria-hidden="true" style={tab.url ? { ['--hue' as string]: tileHue(site) } : undefined}>{tab.url ? tileLetter(site) : ''}</span>}
        <span className="tab-title">{tab.title}</span>
        {tab.driver && <span className="tab-driver" data-driver={tab.driver} title={TAB_DRIVER_TITLE[tab.driver]}>{TAB_DRIVER[tab.driver]}</span>}
        {tab.loading && <span className="tab-loading" aria-label="Loading" />}
      </button>
      <span className="tab-actions">
        {window.mobius.browser.pin && (
          <button type="button" className="tab-close tab-pin" aria-label={`${tab.pinned ? 'Unpin' : 'Pin'} ${tab.title}`} aria-pressed={tab.pinned === true} title={tab.pinned ? 'Unpin' : 'Pin'} onClick={() => window.mobius.browser.pin?.(tab.id, !tab.pinned)}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 3h6l-1 5 3 3H5l3-3-1-5ZM10 11v6" /></svg>
          </button>
        )}
        {window.mobius.browser.duplicate && (
          <button type="button" className="tab-close" aria-label={`Duplicate ${tab.title}`} title="Duplicate" onClick={() => void window.mobius.browser.duplicate?.(tab.id)}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 7h9v9H7zM4 13V4h9" /></svg>
          </button>
        )}
        <button type="button" className="tab-close tab-x" aria-label={`Close ${tab.title}`} title="Close tab (Ctrl+W)" onClick={() => window.mobius.browser.close(tab.id)}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 6 8 8M14 6l-8 8" /></svg>
        </button>
      </span>
    </motion.li>
  );
}

interface TabDrag {
  enabled: boolean;
  dragging: string | null;
  over: { id: string; after: boolean } | null;
  start: (e: DragEvent, id: string) => void;
  overTab: (e: DragEvent, id: string) => void;
  drop: (e: DragEvent) => void;
  end: () => void;
}

/** Dragging tabs to put them in another order, or across the line to pin or unpin them. */
function useTabDrag(tabs: readonly BrowserTabState[]): TabDrag {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<{ id: string; after: boolean } | null>(null);
  const enabled = typeof window.mobius.browser.moveTab === 'function';
  return {
    enabled,
    dragging,
    over,
    start: (e, id) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/x-mobius-tab', id); setDragging(id); },
    overTab: (e, id) => {
      if (!dragging) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const r = e.currentTarget.getBoundingClientRect();
      const after = e.clientY > r.top + r.height / 2;
      if (over?.id !== id || over.after !== after) setOver({ id, after });
    },
    drop: (e) => {
      e.preventDefault();
      const plan = dragging && over ? dropPlan(tabs, dragging, over.id, over.after) : null;
      const moving = tabs.find((t) => t.id === dragging);
      if (plan && moving) {
        if ((moving.pinned === true) !== plan.pinned) window.mobius.browser.pin?.(moving.id, plan.pinned);
        window.mobius.browser.moveTab?.(moving.id, plan.index);
      }
      setDragging(null);
      setOver(null);
    },
    end: () => { setDragging(null); setOver(null); },
  };
}

/** A tab's right-click menu. It stays inside the sidebar, since the page is drawn over everything beside it. */
function TabMenu({ tab, x, y, tabs, onClose }: { tab: BrowserTabState; x: number; y: number; tabs: readonly BrowserTabState[]; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const el = box.current;
    const side = el?.closest('.side')?.getBoundingClientRect();
    if (!el || !side) return;
    const r = el.getBoundingClientRect();
    setPlace({ left: Math.max(side.left + 4, Math.min(x, side.right - r.width - 4)), top: Math.max(8, Math.min(y, window.innerHeight - r.height - 8)) });
    el.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [x, y]);
  useEffect(() => {
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) onClose(); };
    window.addEventListener('mousedown', away);
    window.addEventListener('blur', onClose);
    return () => { window.removeEventListener('mousedown', away); window.removeEventListener('blur', onClose); };
  }, [onClose]);
  const others = tabs.filter((t) => t.id !== tab.id && !t.pinned);
  const below = tabs.slice(tabs.findIndex((t) => t.id === tab.id) + 1).filter((t) => !t.pinned);
  const web = /^https?:/i.test(tab.url);
  const item = (label: string, run: () => void, opts: { disabled?: boolean; danger?: boolean; keys?: string } = {}) => (
    <button type="button" role="menuitem" className="tab-menu-item" data-danger={opts.danger || undefined} disabled={opts.disabled} onClick={() => { onClose(); run(); }}>
      <span>{label}</span>{opts.keys && <kbd>{opts.keys}</kbd>}
    </button>
  );
  const move = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...(box.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(at + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
  };
  return (
    <div ref={box} className="tab-menu" role="menu" aria-label={tab.title} style={place} onKeyDown={move}>
      {window.mobius.browser.pin && item(tab.pinned ? 'Unpin tab' : 'Pin tab', () => window.mobius.browser.pin?.(tab.id, !tab.pinned))}
      {window.mobius.browser.duplicate && item('Duplicate tab', () => void window.mobius.browser.duplicate?.(tab.id))}
      {item('Reload', () => window.mobius.browser.reload(tab.id), { disabled: !tab.url })}
      <div className="tab-menu-sep" role="separator" />
      {item('Copy link', () => void navigator.clipboard?.writeText(tab.url).catch(() => {}), { disabled: !web })}
      {item('Bookmark…', () => { window.mobius.browser.activate(tab.id); void window.mobius.bookmarks.toggle(); }, { disabled: !web || !tab.active })}
      <div className="tab-menu-sep" role="separator" />
      {item('Close tab', () => window.mobius.browser.close(tab.id), { keys: 'Ctrl+W' })}
      {item('Close tabs below', () => below.forEach((t) => window.mobius.browser.close(t.id)), { disabled: below.length === 0 })}
      {item('Close other tabs', () => others.forEach((t) => window.mobius.browser.close(t.id)), { disabled: others.length === 0, danger: true })}
    </div>
  );
}

/**
 * The tabs, as Safari's and Arc's sidebars keep them: pinned tabs in their own group above the rest, actions only on the
 * row under the pointer, drag to reorder (or across the line to pin), and a right-click menu. Downloads sit under them.
 */
export function BrowserSidebar({ tabs, pin, onNewTab, downloads }: { tabs: readonly BrowserTabState[]; pin: ReactNode; onNewTab: () => void; downloads: DownloadEntry[] }) {
  const [menu, setMenu] = useState<{ tab: BrowserTabState; x: number; y: number } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const drag = useTabDrag(tabs);
  const pinned = tabs.filter((t) => t.pinned);
  const open = tabs.filter((t) => !t.pinned);
  const row = (tab: BrowserTabState) => <TabRow key={tab.id} tab={tab} drag={drag} onMenu={(t, x, y) => setMenu({ tab: t, x, y })} />;
  const menuTab = menu ? tabs.find((t) => t.id === menu.tab.id) : undefined;
  return (
        <aside className="side browser-side" aria-label="Browser sidebar">
          <div className="side-head">
            <span className="side-title">Tabs</span>
            <span className="side-actions">
              {pin}
              {window.mobius.browser.reopenClosed && (
                <button type="button" className="strip-btn" aria-label="Reopen closed tab" title="Reopen closed tab (Ctrl+Shift+T)" onClick={() => void window.mobius.browser.reopenClosed?.()}>
                  <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10a6 6 0 1 0 2-4.5M4 3v4h4" /></svg>
                </button>
              )}
              <button type="button" className="strip-btn" aria-label="New tab" title="New tab (Ctrl+T)" onClick={onNewTab}>
                <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg>
              </button>
            </span>
          </div>
          <div className="tab-lists" onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) drag.end(); }}>
            {pinned.length > 0 && (
              <ul className="tabs tabs-pinned" role="list" aria-label="Pinned tabs">
                <AnimatePresence initial={false}>{pinned.map(row)}</AnimatePresence>
              </ul>
            )}
            <ul className="tabs" role="list" aria-label="Open tabs">
              <AnimatePresence initial={false}>{open.map(row)}</AnimatePresence>
            </ul>
            {open.length === 0 && pinned.length > 0 && <p className="tabs-empty">No other tabs. Press Ctrl+T for a new one.</p>}
          </div>
          {menu && menuTab && <TabMenu tab={menuTab} x={menu.x} y={menu.y} tabs={tabs} onClose={closeMenu} />}
          <DownloadsList entries={downloads} />
        </aside>
  );
}

export interface BrowserChromeProps {
  active: BrowserTabState | undefined;
  saved: boolean;
  pagePinned: boolean;
  onTogglePagePin: () => void;
  selectionMenu: boolean;
  setSelectionMenu: (update: boolean | ((open: boolean) => boolean)) => void;
  /** A picture of the page covers it, so the selection menu can sit over it. */
  selectionReady: boolean;
  onSelection: (action: WebSelectionAction) => void;
  clipTo: string;
  clipPages: ClipPage[];
  onClipTo: (path: string) => void;
  address: RefObject<HTMLInputElement | null>;
  draft: string | null;
  setDraft: (draft: string | null) => void;
  notice: string;
  setNotice: (notice: string) => void;
  onSubmit: (event: FormEvent) => void;
  findOpen: boolean;
  finding: number;
  onCloseFind: () => void;
}

/** Back, forward, reload, bookmark, pin, the selection menu and the address bar, with Find under them. */
export function BrowserChrome({ active, saved, pagePinned, onTogglePagePin, selectionMenu, setSelectionMenu, selectionReady, onSelection, clipTo, clipPages, onClipTo, address, draft, setDraft, notice, setNotice, onSubmit, findOpen, finding, onCloseFind }: BrowserChromeProps) {
  return (
  <div className="strip-middle" role="group" aria-label="Browser">
        <div className="cap-group">
          <button type="button" className="strip-btn" aria-label="Back" disabled={!active?.canGoBack} onClick={() => active && window.mobius.browser.back(active.id)}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M12 4 6 10l6 6" /></svg>
          </button>
          <button type="button" className="strip-btn" aria-label="Forward" disabled={!active?.canGoForward} onClick={() => active && window.mobius.browser.forward(active.id)}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m8 4 6 6-6 6" /></svg>
          </button>
          <button type="button" className="strip-btn" aria-label="Reload" disabled={!active} onClick={() => active && window.mobius.browser.reload(active.id)}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M16 10a6 6 0 1 1-1.8-4.3M16 3v4h-4" /></svg>
          </button>
        </div>
        <button type="button" className="strip-btn" aria-pressed={saved} aria-label={saved ? 'Remove bookmark' : 'Bookmark this page'} title={saved ? 'Remove bookmark' : 'Bookmark this page'} disabled={!active || !/^https?:/.test(active.url)} onClick={() => void window.mobius.bookmarks.toggle()}>
          <svg viewBox="0 0 20 20" aria-hidden="true" data-filled={saved}><path d="M10 3l2.1 4.4 4.9.6-3.6 3.4.9 4.8L10 13.8 5.7 16.2l.9-4.8L3 8l4.9-.6z" /></svg>
        </button>
        <button type="button" className="strip-btn" data-page-pin aria-pressed={pagePinned} aria-label={pagePinned ? 'Unpin this page from the sidebar' : 'Pin this page to the sidebar'} title={pagePinned ? 'Unpin from the sidebar' : 'Pin to the sidebar'} disabled={!active || !/^https?:/.test(active.url)} onClick={onTogglePagePin}>
          <svg viewBox="0 0 20 20" aria-hidden="true" data-filled={pagePinned}><path d="M7.5 3.5h5l-.8 4.2 2.8 2.8H5.5l2.8-2.8zM10 10.5v6" /></svg>
        </button>
        <div className="selection-menu-wrap">
          <button type="button" className="strip-btn" data-selection-ask aria-haspopup="menu" aria-expanded={selectionMenu} aria-label="Selected text" title="Do something with the text selected on this page" disabled={!active || !/^https?:/.test(active.url)} onClick={() => setSelectionMenu((open) => !open)}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 5h8M4 9h5M4 13h4" /><path d="M14.5 9.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" /></svg>
          </button>
          {selectionMenu && selectionReady && (
            <SelectionMenu onClose={() => setSelectionMenu(false)} onChoose={onSelection} clipTo={clipTo} pages={clipPages} onClipTo={onClipTo} />
          )}
        </div>
        <AddressBar active={active} address={address} draft={draft} setDraft={setDraft} setNotice={setNotice} onSubmit={onSubmit} />
        {notice && <span className="notice" role="status">{notice}</span>}
        {findOpen && active && <FindBar key={active.id} tabId={active.id} focusToken={finding} onClose={onCloseFind} />}
      </div>
  );
}

const SUGGESTION_ICON = {
  tab: 'M3 5h14v10H3zM3 8h14',
  bookmark: 'M10 3l2.1 4.4 4.9.6-3.6 3.4.9 4.8L10 13.8 5.7 16.2l.9-4.8L3 8l4.9-.6z',
  history: 'M10 4a6 6 0 1 1-6 6M10 7v3l2 2',
} as const;

/**
 * The address bar, as Safari's: at rest it shows a lock and the site's name; once clicked it holds the whole address to
 * edit, and suggests open tabs, bookmarks and pages from history as you type. A suggestion is only taken when it is
 * picked with the arrows or the pointer; otherwise Enter goes, or asks, as before.
 */
function AddressBar({ active, address, draft, setDraft, setNotice, onSubmit }: Pick<BrowserChromeProps, 'active' | 'address' | 'draft' | 'setDraft' | 'setNotice' | 'onSubmit'>) {
  const [list, setList] = useState<Suggestion[]>([]);
  const [lit, setLit] = useState(-1);
  const known = useRef<{ tabs: BrowserTabState[]; bookmarks: BookmarkEntry[]; history: HistoryEntry[] }>({ tabs: [], bookmarks: [], history: [] });
  // Suggestions only show where nothing covers them: in the sidebar, not in the toolbar over the page.
  const roomy = useRef(false);
  const editing = draft !== null;
  const parts = !editing && active ? addressParts(active.url) : null;

  const learn = () => {
    void window.mobius.browser.getState().then((s) => { known.current.tabs = s?.tabs ?? []; }).catch(() => {});
    void window.mobius.bookmarks.get('').then((b) => { known.current.bookmarks = b; }).catch(() => {});
    void window.mobius.history.get('').then((h) => { known.current.history = h.enabled ? h.entries.slice(0, 500) : []; }).catch(() => {});
  };
  const suggest = (text: string) => {
    const { tabs, bookmarks, history } = known.current;
    setList(roomy.current && text !== active?.url ? suggestionsFor(text, tabs, bookmarks, history) : []);
    setLit(-1);
  };
  const done = () => { setList([]); setLit(-1); setDraft(null); address.current?.blur(); };
  const pick = (s: Suggestion) => {
    if (s.kind === 'tab') window.mobius.browser.activate(s.id);
    else if (active) void window.mobius.browser.navigate(active.id, s.url);
    else void window.mobius.browser.open(s.url);
    done();
  };

  return (
    <form className="address" onSubmit={(e) => { if (lit >= 0 && list[lit]) { e.preventDefault(); pick(list[lit]!); return; } setList([]); onSubmit(e); }} data-editing={editing || undefined} data-loading={active?.loading || undefined}>
      <input
        ref={address}
        type="text"
        aria-label="Address or question"
        placeholder="Search, enter an address, or ask"
        spellCheck={false}
        autoComplete="off"
        aria-autocomplete="list"
        aria-controls={list.length > 0 ? 'address-suggestions' : undefined}
        aria-activedescendant={lit >= 0 ? `address-suggestion-${lit}` : undefined}
        value={draft ?? active?.url ?? ''}
        onChange={(event) => { setDraft(event.target.value); setNotice(''); suggest(event.target.value); }}
        // From the moment it is focused the text is the person's draft: a page finishing loading meanwhile cannot change it under their typing.
        onFocus={(event) => { roomy.current = event.target.closest('.rail-chrome') !== null; learn(); setDraft(event.target.value); event.target.select(); }}
        onBlur={() => { setList([]); setLit(-1); setDraft(null); }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && list.length > 0) { event.preventDefault(); setLit((i) => (i + 1) % list.length); }
          else if (event.key === 'ArrowUp' && list.length > 0) { event.preventDefault(); setLit((i) => (i <= 0 ? list.length - 1 : i - 1)); }
          else if (event.key === 'Escape') {
            event.preventDefault();
            if (list.length > 0) { setList([]); setLit(-1); }
            else if (draft !== null && draft !== (active?.url ?? '')) { setDraft(active?.url ?? ''); window.requestAnimationFrame(() => address.current?.select()); }
            else done();
          }
        }}
      />
      {parts && (
        <span className="address-rest" aria-hidden="true">
          {parts.secure && <svg viewBox="0 0 20 20"><path d="M6 9V7a4 4 0 0 1 8 0v2M5 9h10v8H5z" /></svg>}
          <span>{parts.host}</span>
        </span>
      )}
      {active?.loading && <span className="address-progress" role="status" aria-label="Loading" />}
      {list.length > 0 && (
        <ul className="address-suggestions" id="address-suggestions" role="listbox" aria-label="Suggestions">
          {list.map((s, i) => (
            <li key={`${s.kind}:${s.url}`} id={`address-suggestion-${i}`} role="option" aria-selected={i === lit} className="address-suggestion" onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setLit(i)} onClick={() => pick(s)}>
              <svg viewBox="0 0 20 20" aria-hidden="true" data-kind={s.kind}><path d={SUGGESTION_ICON[s.kind]} /></svg>
              <span className="address-suggestion-text">
                <span className="address-suggestion-title">{s.title}</span>
                <span className="address-suggestion-url">{s.kind === 'tab' ? `Switch to tab · ${hostOf(s.url)}` : s.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}

/** A new tab shows Mobius's own start page; otherwise the native page sits in its slot. */
export function BrowserPage({ onStartPage, hidden, onOpen, onRead }: { onStartPage: boolean; hidden: boolean; onOpen: (url: string) => void; onRead: (path: string, title: string) => void }) {
  return (
    <>
      {onStartPage && <StartPage onOpen={onOpen} onRead={onRead} />}
      <SurfaceSlot hidden={hidden} />
    </>
  );
}
