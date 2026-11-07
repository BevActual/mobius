import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { MAIN_BOT_ID, actionForPress, botOfConversation, type SidebarMode } from '@mobius/shared';
import { appName, isAvailable, type AppId } from './apps';
import { AnimatePresence, motion } from 'motion/react';
import { ChatPanel } from './ChatPanel';
import { quick } from './motion';
import { ConversationSidebar, type SideMode } from './ConversationSidebar';
import { DownloadsList } from './DownloadsList';
import { FindBar } from './FindBar';
import { useBookmarks } from './useBookmarks';
import { useArchive } from './useArchive';
import { useBots } from './useBots';
import { useDownloads } from './useDownloads';
import { Launcher } from './Launcher';
import { Resizer } from './Resizer';
import { useAutoHide } from './useAutoHide';
import type { Side } from './resize';
import { SurfaceSlot } from './SurfaceSlot';
import { useAgentSettings } from './useAgentSettings';
import { useBrowser } from './useBrowser';
import { useAppearance } from './useAppearance';
import { usePreferences } from './usePreferences';
import { useConversation } from './useConversation';
import { SettingsPage } from './settings/SettingsPage';
import { useCoreStatus } from './useCoreStatus';
import { useNotes } from './useNotes';
import { NotesSidebar } from './NotesSidebar';
import { NoteEditor } from './NoteEditor';
import { liveTitle } from './notes-state';

const CORE_LABEL = { starting: 'Starting core…', ready: 'Core ready', restarting: 'Restarting core…', failed: 'Core unavailable' } as const;

const NOTICES: Record<string, string> = {
  ask: 'Set up a model in the agent panel to ask questions.',
  blocked: 'Mobius only opens web addresses (http or https).',
};

export function App() {
  const browser = useBrowser();
  const coreStatus = useCoreStatus();
  const bots = useBots();
  const botIds = useMemo(() => bots.bots.map((bot) => bot.id), [bots.bots]);
  const conversation = useConversation(coreStatus, botIds);
  const archive = useArchive(conversation.list);
  const [sideMode, setSideMode] = useState<SideMode>('sessions');
  const appearance = useAppearance();
  const downloads = useDownloads();
  const preferences = usePreferences();
  const bookmarks = useBookmarks();
  const notes = useNotes();
  const bindings = preferences.value.keybindings;
  // Clicking a notification brings Mobius forward; show the conversation it was about.
  useEffect(() => window.mobius.app.onOpenConversation((id) => { conversation.select(id); setChatOpen(true); }), [conversation.select]);
  // Once the saved choices are known, apply the ones that only matter at start-up, once.
  useEffect(() => {
    if (!appearance.loaded || startedUp.current) return;
    startedUp.current = true;
    if (!appearance.value.sidebarAtStart || appearance.value.leftSidebar === 'floating') setPanelOpen(false);
    if (appearance.value.leftSidebar === 'floating') setAgentListOpen(false);
    if (appearance.value.rightSidebar === 'floating') setChatOpen(false);
    if (!appearance.value.resumeLast) conversation.startFresh();
  }, [appearance.loaded, appearance.value, conversation]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [app, setApp] = useState<AppId>('browser');
  const [finding, setFinding] = useState(0);
  const [findOpen, setFindOpen] = useState(false);
  const openFind = useCallback(() => { setFindOpen(true); setFinding((n) => n + 1); }, []);
  const inBrowser = app === 'browser';
  const inAgent = app === 'agent';
  const inNotes = app === 'notes';
  const openApp = useCallback((id: AppId) => { if (isAvailable(id)) setApp(id); }, []);
  const needsYou = conversation.list.reduce((sum, c) => sum + c.waiting, 0);
  const { settings, save: saveSettings, reload: reloadSettings } = useAgentSettings();
  const active = browser.tabs.find((tab) => tab.active);
  const saved = active !== undefined && bookmarks.some((b) => b.url === active.url);
  const [panelOpen, setPanelOpen] = useState(true);
  const startedUp = useRef(false);
  const [chatOpen, setChatOpen] = useState(true);
  const [focusToken, setFocusToken] = useState(0);
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const address = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  // Where the sidebars sit and how wide they are. A floating one hides until asked for, and draws over the window.
  const hasLeft = inBrowser || inAgent || inNotes;
  // The agent panel sits beside the Browser and Notes; the Agent app is the conversation itself.
  const hasRight = inBrowser || inNotes;
  const leftFloating = appearance.value.leftSidebar === 'floating';
  const rightFloating = appearance.value.rightSidebar === 'floating';
  const [agentListOpen, setAgentListOpen] = useState(true);
  const leftOpen = inAgent ? agentListOpen : panelOpen;
  const setLeftOpen = inAgent ? setAgentListOpen : setPanelOpen;
  const rightOpen = hasRight && chatOpen;
  const [drag, setDrag] = useState<{ side: Side; width: number } | null>(null);
  const [hovering, setHovering] = useState(false);
  const leftWidth = drag?.side === 'left' ? drag.width : appearance.value.leftWidth;
  const rightWidth = drag?.side === 'right' ? drag.width : appearance.value.rightWidth;
  const leftDock = useRef<HTMLDivElement>(null);
  const rightDock = useRef<HTMLDivElement>(null);
  const hideLeft = useCallback(() => setLeftOpen(false), [setLeftOpen]);
  const hideRight = useCallback(() => setChatOpen(false), []);
  const leftFromEdge = useRef(false);
  const rightFromEdge = useRef(false);
  useAutoHide(leftFloating, hasLeft && leftOpen, hideLeft, leftDock, leftFromEdge);
  useAutoHide(rightFloating, rightOpen, hideRight, rightDock, rightFromEdge);
  // Switching to floating while the pointer and keyboard are elsewhere puts the sidebar away.
  const wasFloating = useRef({ left: leftFloating, right: rightFloating });
  useEffect(() => {
    const away = (dock: HTMLElement | null) => !dock || (!dock.matches(':hover') && !dock.contains(document.activeElement));
    if (!wasFloating.current.left && leftFloating && away(leftDock.current)) setLeftOpen(false);
    if (!wasFloating.current.right && rightFloating && away(rightDock.current)) setChatOpen(false);
    wasFloating.current = { left: leftFloating, right: rightFloating };
  }, [leftFloating, rightFloating, setLeftOpen]);
  const setMode = (side: Side, mode: SidebarMode) => void appearance.set(side === 'left' ? { leftSidebar: mode } : { rightSidebar: mode });
  const pin = (side: Side) => {
    const floating = side === 'left' ? leftFloating : rightFloating;
    const what = side === 'left' ? 'list' : 'agent panel';
    return (
      <button type="button" className="strip-btn" aria-pressed={!floating} aria-label={floating ? `Attach the ${what}` : `Float the ${what}`} title={floating ? 'Attach: keep it beside the page' : 'Float: show it over the page, and hide it when not used'} onClick={() => setMode(side, floating ? 'attached' : 'floating')}>
        <svg viewBox="0 0 20 20" aria-hidden="true">{floating ? <path d="M10 3v6M6 9h8l-1 4H7zM10 13v4" /> : <path d="M7 3h6M8 3v6l-3 4h10l-3-4V3M10 13v4" />}</svg>
      </button>
    );
  };
  const resizer = (side: Side, label: string) => (
    <Resizer side={side} width={side === 'left' ? leftWidth : rightWidth} label={label} onHover={setHovering}
      onDrag={(width) => setDrag(width === null ? null : { side, width })}
      onCommit={(width) => void appearance.set(side === 'left' ? { leftWidth: width } : { rightWidth: width })} />
  );
  // The native page is drawn above everything in the window. To draw over it, put a picture of it in its place first.
  const floatingShown = (hasLeft && leftFloating && leftOpen) || (rightFloating && rightOpen);
  const needCover = inBrowser && (floatingShown || drag !== null || hovering);
  const [cover, setCover] = useState<{ url: string | null } | null>(null);
  useEffect(() => {
    if (!needCover) { setCover(null); return undefined; }
    let live = true;
    void window.mobius.browser.snapshot().then((url) => { if (live) setCover({ url }); });
    return () => { live = false; };
  }, [needCover]);
  const leftAttached = hasLeft && !leftFloating && leftOpen;
  const rightAttached = !rightFloating && rightOpen;
  const layout = {
    '--col-left': leftAttached ? `${leftWidth}px` : '0px',
    '--col-right': rightAttached ? `${rightWidth}px` : '0px',
    '--pad-left': leftAttached ? '0px' : '8px',
    '--pad-right': rightAttached ? '0px' : '8px',
    '--left-w': `${leftWidth}px`,
    '--right-w': `${rightWidth}px`,
  } as React.CSSProperties;

  const openLauncher = useCallback(() => {
    opener.current = document.activeElement as HTMLElement | null;
    setLauncherOpen(true);
  }, []);
  const closeLauncher = useCallback(() => {
    setLauncherOpen(false);
    queueMicrotask(() => opener.current?.focus?.());
  }, []);
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const newTab = useCallback(() => {
    void window.mobius.browser.open().then(() => address.current?.focus());
  }, []);

  useEffect(
    () =>
      window.mobius.window.onShortcut((shortcut) => {
        if (shortcut === 'launcher') openLauncher();
        else if (shortcut === 'address') { address.current?.focus(); address.current?.select(); }
        else if (shortcut === 'new-tab') newTab();
        else if (shortcut === 'close-tab' && active) window.mobius.browser.close(active.id);
        else if (shortcut === 'settings') openSettings();
        else if (shortcut === 'find') openFind();
        else if (shortcut === 'quick-entry') { setSettingsOpen(false); setLauncherOpen(false); setChatOpen(true); setFocusToken((n) => n + 1); }
      }),
    [openLauncher, openSettings, openFind, newTab, active],
  );

  // The same shortcuts when the shell itself has the keyboard (pages are handled by the main process).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const action = actionForPress(bindings, { code: event.code, ctrl: event.ctrlKey, meta: event.metaKey, alt: event.altKey, shift: event.shiftKey });
      if (action === 'launcher') { event.preventDefault(); openLauncher(); }
      else if (action === 'address') { event.preventDefault(); address.current?.focus(); address.current?.select(); }
      else if (action === 'newTab') { event.preventDefault(); newTab(); }
      else if (action === 'closeTab' && active) { event.preventDefault(); window.mobius.browser.close(active.id); }
      else if (action === 'settings') { event.preventDefault(); openSettings(); }
      else if (action === 'find' && app === 'browser') { event.preventDefault(); openFind(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [bindings, openLauncher, openSettings, openFind, app, newTab, active]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!active) return;
    const typed = draft ?? active.url;
    const outcome = await window.mobius.browser.navigate(active.id, typed);
    if (outcome === 'ask' && settings?.configured && !conversation.state.busy) {
      // A question is for the agent, not the web.
      setChatOpen(true);
      setNotice('');
      setDraft(null);
      address.current?.blur();
      void conversation.send(typed.trim());
      return;
    }
    if (outcome === 'ask') setChatOpen(true);
    setNotice(NOTICES[outcome] ?? '');
    if (outcome === 'navigated') { setDraft(null); address.current?.blur(); }
  };

  return (
    <div className="app" data-app={app} data-panel={leftOpen ? 'open' : 'closed'} data-chat={rightOpen ? 'open' : 'closed'}>
      <div className="strip" role="presentation">
        <span className="strip-title">{inBrowser ? (active?.title || appName(app)) : inAgent ? (conversation.list.find((c) => c.id === conversation.id)?.title || appName(app)) : inNotes && notes.page ? liveTitle(notes.text, notes.page.title || appName(app)) : appName(app)}</span>
        <span className="core-status" role="status" data-state={coreStatus}>{CORE_LABEL[coreStatus]}</span>
      </div>
      <header className="context-strip">
        <div className="strip-left" role="group" aria-label="Window">
          {hasLeft && <button type="button" className="strip-btn" data-dock-toggle aria-pressed={leftOpen} aria-label={inAgent ? 'Show conversations' : inNotes ? 'Show notebooks' : 'Show tabs'} title={inAgent ? 'Show or hide conversations' : inNotes ? 'Show or hide notebooks' : 'Show or hide tabs'} onClick={() => setLeftOpen((open) => !open)}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="4" width="14" height="12" rx="2.5" /><path d="M8 4v12" /></svg>
          </button>}
        </div>
        {inAgent && <div className="strip-middle" role="group" aria-label="Agent"><span className="context-title">{settings?.configured ? `Talking to ${settings.model}` : 'No model connected'}</span></div>}
        {inBrowser && <div className="strip-middle" role="group" aria-label="Browser">
          <button type="button" className="strip-btn" aria-label="Back" disabled={!active?.canGoBack} onClick={() => active && window.mobius.browser.back(active.id)}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M12 4 6 10l6 6" /></svg>
          </button>
          <button type="button" className="strip-btn" aria-label="Forward" disabled={!active?.canGoForward} onClick={() => active && window.mobius.browser.forward(active.id)}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m8 4 6 6-6 6" /></svg>
          </button>
          <button type="button" className="strip-btn" aria-label="Reload" disabled={!active} onClick={() => active && window.mobius.browser.reload(active.id)}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M16 10a6 6 0 1 1-1.8-4.3M16 3v4h-4" /></svg>
          </button>
          <button type="button" className="strip-btn" aria-pressed={saved} aria-label={saved ? 'Remove bookmark' : 'Bookmark this page'} title={saved ? 'Remove bookmark' : 'Bookmark this page'} disabled={!active || !/^https?:/.test(active.url)} onClick={() => void window.mobius.bookmarks.toggle()}>
            <svg viewBox="0 0 20 20" aria-hidden="true" data-filled={saved}><path d="M10 3l2.1 4.4 4.9.6-3.6 3.4.9 4.8L10 13.8 5.7 16.2l.9-4.8L3 8l4.9-.6z" /></svg>
          </button>
          <form className="address" onSubmit={submit}>
            <input
              ref={address}
              type="text"
              aria-label="Address or question"
              placeholder="Search, enter an address, or ask"
              spellCheck={false}
              autoComplete="off"
              value={draft ?? active?.url ?? ''}
              onChange={(event) => { setDraft(event.target.value); setNotice(''); }}
              onFocus={(event) => event.target.select()}
              onBlur={() => setDraft(null)}
            />
            {active?.loading && <span className="spinner" role="status" aria-label="Loading" />}
          </form>
          {notice && <span className="notice" role="status">{notice}</span>}
          {findOpen && active && <FindBar key={active.id} tabId={active.id} focusToken={finding} onClose={() => setFindOpen(false)} />}
        </div>}
        <div className="strip-right" role="group" aria-label="Applications">
          {hasRight && <button type="button" className="strip-btn" data-dock-toggle aria-pressed={chatOpen} aria-label="Show agent" title="Show or hide the agent" onClick={() => { setChatOpen((open) => !open); setFocusToken((n) => n + 1); }}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="4" width="14" height="12" rx="2.5" /><path d="M12 4v12" /></svg>
          </button>}
          <button type="button" className="strip-btn app-button" data-app-library aria-haspopup="dialog" aria-label={`Applications. Current: ${appName(app)}`} onClick={openLauncher}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7" /><path d="m12.8 7.2-1.6 4-4 1.6 1.6-4z" /></svg>
            <span>{appName(app)}</span>
            {needsYou > 0 && <span className="attention" role="status" aria-label={`${needsYou} waiting for you`}>{needsYou}</span>}
            <svg className="chev" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5" /></svg>
          </button>
        </div>
      </header>
      <div className="body" style={layout}>
        {hasLeft && leftOpen && (
          <div ref={leftDock} className="dock left" data-floating={leftFloating || undefined}>
            {inAgent ? (
              <ConversationSidebar
                conversations={conversation.list}
                active={conversation.id}
                canStartNew={conversation.state.items.length > 0 || conversation.state.busy}
                onNew={() => conversation.newConversation()}
                bots={bots.bots}
                archived={archive.archived}
                {...(archive.archive ? { onArchive: archive.archive } : {})}
                mode={sideMode}
                onMode={setSideMode}
                onOpenBot={(id) => {
                  const latest = conversation.list.find((c) => botOfConversation(c.id, botIds) === id);
                  if (latest) conversation.select(latest.id);
                  else conversation.newConversation(id);
                }}
                onNewWithBot={(id) => conversation.newConversation(id)}
                onCreateBot={bots.create}
                onMoveBot={bots.move}
                onUpdateBot={bots.update}
                onRemoveBot={async (id) => {
                  const wasHere = botOfConversation(conversation.id, botIds) === id;
                  const result = await bots.remove(id);
                  if (result.ok && wasHere) conversation.startFresh(MAIN_BOT_ID);
                  void conversation.refresh();
                  return result;
                }}
                onSelect={conversation.select}
                onDelete={conversation.remove}
                pin={pin('left')}
              />
            ) : inNotes ? (
              <NotesSidebar notes={notes} pin={pin('left')} />
            ) : (
          <aside className="side" aria-label="Browser sidebar">
            <div className="side-head">
              <span className="side-title">Tabs</span>
              <span className="side-actions">
                {pin('left')}
                {window.mobius.browser.reopenClosed && (
                  <button type="button" className="strip-btn" aria-label="Reopen closed tab" title="Reopen closed tab" onClick={() => void window.mobius.browser.reopenClosed?.()}>
                    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10a6 6 0 1 0 2-4.5M4 3v4h4" /></svg>
                  </button>
                )}
                <button type="button" className="strip-btn" aria-label="New tab" title="New tab (Ctrl+T)" onClick={newTab}>
                  <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg>
                </button>
              </span>
            </div>
            <ul className="tabs" role="list">
              <AnimatePresence initial={false}>
              {browser.tabs.map((tab) => (
                <motion.li key={tab.id} layout="position" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: quick }} className="tab" aria-current={tab.active ? 'page' : undefined} data-pinned={tab.pinned ? 'true' : undefined}>
                  <button type="button" className="tab-main" onClick={() => window.mobius.browser.activate(tab.id)}>
                    {tab.icon ? <img className="tab-icon" src={tab.icon} alt="" width={16} height={16} /> : <span className="tab-icon placeholder" aria-hidden="true" />}
                    <span className="tab-title">{tab.title}</span>
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
            )}
            {resizer('left', 'Resize the list')}
          </div>
        )}
        {hasLeft && leftFloating && !leftOpen && <div className="hotzone left" data-testid="hotzone-left" onPointerEnter={() => { leftFromEdge.current = true; setLeftOpen(true); }} />}
        <main className="stage">
          {cover?.url && <img className="page-cover" src={cover.url} alt="" data-testid="page-cover" />}
          {settingsOpen && (
            <SettingsPage
              onClose={closeSettings}
              settings={settings}
              onSaveSettings={saveSettings}
              appearance={appearance.value}
              onAppearance={appearance.set}
              preferences={preferences.value}
              onPreferences={preferences.set}
              conversations={conversation.list}
              activeConversation={conversation.id}
              onOpenConversation={(id) => { conversation.select(id); setChatOpen(true); closeSettings(); }}
              onDeleteConversation={conversation.remove}
              onRefreshConversations={conversation.refresh}
              coreStatus={coreStatus}
            />
          )}
          {inNotes && <NoteEditor notes={notes} />}
          {inAgent && (
            <ChatPanel
              variant="full"
              state={conversation.state}
              settings={settings}
              coreReady={coreStatus === 'ready'}
              onSend={(text, items) => void conversation.send(text, items)}
              onStop={conversation.stop}
              onAnswer={conversation.answer}
              onReply={conversation.reply}
              onSaveSettings={saveSettings}
              focusToken={focusToken}
              conversations={conversation.list}
              activeConversation={conversation.id}
              onNewConversation={() => conversation.newConversation()}
              onSelectConversation={conversation.select}
              onOpenSettings={openSettings}
              onRetry={conversation.retry}
              onEdit={conversation.edit}
              onDetails={conversation.toolDetails}
              effort={preferences.value.reasoningEffort}
              onEffort={(reasoningEffort) => void preferences.set({ reasoningEffort })}
              onModelChanged={() => void reloadSettings()}
            />
          )}
          <SurfaceSlot hidden={launcherOpen || settingsOpen || !inBrowser || cover !== null} />
        </main>
        {rightOpen && (
          <div ref={rightDock} className="dock right" data-floating={rightFloating || undefined}>
          <ChatPanel
            state={conversation.state}
            settings={settings}
            coreReady={coreStatus === 'ready'}
            onSend={(text, items) => void conversation.send(text, items)}
            onStop={conversation.stop}
            onAnswer={conversation.answer}
              onReply={conversation.reply}
            onSaveSettings={saveSettings}
            focusToken={focusToken}
            conversations={conversation.list}
            activeConversation={conversation.id}
            onNewConversation={() => conversation.newConversation()}
            onSelectConversation={conversation.select}
            onOpenSettings={openSettings}
            onRetry={conversation.retry}
            onEdit={conversation.edit}
            onDetails={conversation.toolDetails}
              effort={preferences.value.reasoningEffort}
              onEffort={(reasoningEffort) => void preferences.set({ reasoningEffort })}
              onModelChanged={() => void reloadSettings()}
            pin={pin('right')}
          />
            {resizer('right', 'Resize the agent panel')}
          </div>
        )}
        {hasRight && rightFloating && !chatOpen && <div className="hotzone right" data-testid="hotzone-right" onPointerEnter={() => { rightFromEdge.current = true; setChatOpen(true); }} />}
      </div>
      <Launcher open={launcherOpen} onClose={closeLauncher} tabs={browser.tabs} onNewTab={newTab} onActivateTab={(id) => { openApp('browser'); window.mobius.browser.activate(id); }} onOpenApp={openApp} />
    </div>
  );
}
