import type { FormEvent, ReactNode, RefObject } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { BrowserTabState, DownloadEntry } from '@mobius/shared';
import { DownloadsList } from './DownloadsList';
import { FindBar } from './FindBar';
import { quick } from './motion';
import { SelectionMenu, type ClipPage, type WebSelectionAction } from './SelectionMenu';
import { StartPage } from './StartPage';
import { SurfaceSlot } from './SurfaceSlot';

/**
 * The Browser app's own UI: the list of tabs, the controls above the page (back, forward, reload, the address bar),
 * and the page itself, which is Mobius's start page for a new tab and otherwise the native page's slot. The shell
 * keeps the native page glued to that slot (SurfaceSlot and the window's bounds code); this file only draws.
 */

const TAB_DRIVER = { reading: 'Mobius reading', mobius: 'Mobius', yours: 'Yours' } as const;
const TAB_DRIVER_TITLE = { reading: 'Mobius is reading this tab', mobius: 'Mobius is using this tab', yours: 'You took over this tab from Mobius' } as const;

/** The tabs, with New tab and Reopen closed tab in the head, and the downloads under them. */
export function BrowserSidebar({ tabs, pin, onNewTab, downloads }: { tabs: readonly BrowserTabState[]; pin: ReactNode; onNewTab: () => void; downloads: DownloadEntry[] }) {
  return (
        <aside className="side" aria-label="Browser sidebar">
          <div className="side-head">
            <span className="side-title">Tabs</span>
            <span className="side-actions">
              {pin}
              {window.mobius.browser.reopenClosed && (
                <button type="button" className="strip-btn" aria-label="Reopen closed tab" title="Reopen closed tab" onClick={() => void window.mobius.browser.reopenClosed?.()}>
                  <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10a6 6 0 1 0 2-4.5M4 3v4h4" /></svg>
                </button>
              )}
              <button type="button" className="strip-btn" aria-label="New tab" title="New tab (Ctrl+T)" onClick={onNewTab}>
                <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg>
              </button>
            </span>
          </div>
          <ul className="tabs" role="list">
            <AnimatePresence initial={false}>
            {tabs.map((tab) => (
              <motion.li key={tab.id} layout="position" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: quick }} className="tab" aria-current={tab.active ? 'page' : undefined} data-pinned={tab.pinned ? 'true' : undefined}>
                <button type="button" className="tab-main" onClick={() => window.mobius.browser.activate(tab.id)}>
                  {tab.icon ? <img className="tab-icon" src={tab.icon} alt="" width={16} height={16} /> : <span className="tab-icon placeholder" aria-hidden="true" />}
                  <span className="tab-title">{tab.title}</span>
                  {tab.driver && <span className="tab-driver" data-driver={tab.driver} title={TAB_DRIVER_TITLE[tab.driver]}>{TAB_DRIVER[tab.driver]}</span>}
                  {tab.loading && <span className="tab-loading" aria-label="Loading" />}
                </button>
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
                <button type="button" className="tab-close" aria-label={`Close ${tab.title}`} onClick={() => window.mobius.browser.close(tab.id)}>
                  <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 6 8 8M14 6l-8 8" /></svg>
                </button>
              </motion.li>
            ))}
            </AnimatePresence>
          </ul>
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
        <form className="address" onSubmit={onSubmit}>
          <input
            ref={address}
            type="text"
            aria-label="Address or question"
            placeholder="Search, enter an address, or ask"
            spellCheck={false}
            autoComplete="off"
            value={draft ?? active?.url ?? ''}
            onChange={(event) => { setDraft(event.target.value); setNotice(''); }}
            // From the moment it is focused the text is the person's draft: a page finishing loading meanwhile cannot change it under their typing.
            onFocus={(event) => { setDraft(event.target.value); event.target.select(); }}
            onBlur={() => setDraft(null)}
          />
          {active?.loading && <span className="spinner" role="status" aria-label="Loading" />}
        </form>
        {notice && <span className="notice" role="status">{notice}</span>}
        {findOpen && active && <FindBar key={active.id} tabId={active.id} focusToken={finding} onClose={onCloseFind} />}
      </div>
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
