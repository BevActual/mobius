import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { MAIN_BOT_ID, MAX_CONTEXT_ITEM_CHARS, actionForPress, botOfConversation, type ContextItem, type SidebarMode } from '@mobius/shared';
import { appName, isAvailable, type AppId } from './apps';
import { AnimatePresence, motion } from 'motion/react';
import { tasksContext, type SurfaceState } from './surface';
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
import { TasksPage, TasksSidebar } from './Tasks';
import { APP_ICONS, Rail } from './Rail';
import { AppHub, type HubAction } from './AppHub';
import { smartView } from './tasks-view';
import { SearchPage } from './SearchPage';
import { activityOf } from './activity';
import type { HubTarget } from './search-hub';
import { useTasks } from './useTasks';
import { useTurnChanges } from './useTurnChanges';
import { NoteEditor, type SelectionAction } from './NoteEditor';
import { liveTitle, statusText } from './notes-state';
import { Pane, SplitDivider } from './SplitView';
import { SelectionMenu, type WebSelectionAction } from './SelectionMenu';
import { clipToNotes } from './clip';
import { companionFor, loadShare, saveShare } from './split';

const CORE_LABEL = { starting: 'Starting core…', ready: 'Core ready', restarting: 'Restarting core…', failed: 'Core unavailable' } as const;

const NOTICES: Record<string, string> = {
  ask: 'Set up a model in the agent panel to ask questions.',
  blocked: 'Mobius only opens web addresses (http or https).',
};

/** True while the window is narrower than `width` pixels. */
function useNarrowWindow(width: number): boolean {
  const query = `(max-width: ${width - 1}px)`;
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const on = () => setNarrow(list.matches);
    list.addEventListener('change', on);
    return () => list.removeEventListener('change', on);
  }, [query]);
  return narrow;
}

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
  const tasks = useTasks();
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
  // Split view: up to two apps side by side. `app` is the focused pane's app, so the toolbar and sidebar follow it.
  // A narrow window has room for one pane, so the other folds away until the window is wide again.
  const narrow = useNarrowWindow(980);
  const [panes, setPanes] = useState<readonly [AppId, AppId | null]>(['browser', null]);
  const [focused, setFocused] = useState<0 | 1>(0);
  const app: AppId = (focused === 1 ? panes[1] : null) ?? panes[0];
  const split = panes[1] !== null && !narrow;
  const other: AppId | null = split ? (focused === 0 ? panes[1] : panes[0]) : null;
  const panesNow = useRef({ panes, focused });
  panesNow.current = { panes, focused };
  /** Open an app in the focused pane. If the other pane already shows it, go there instead. */
  const setApp = useCallback((id: AppId) => {
    const { panes: [a, b], focused: f } = panesNow.current;
    if (b !== null && (f === 0 ? b : a) === id) { setFocused(f === 0 ? 1 : 0); return; }
    setPanes(f === 0 ? [id, b] : [a, id]);
  }, []);
  const [share, setShare] = useState(loadShare);
  // Little Mobius: the conversation in a small window of its own, kept above other apps.
  const [miniOpen, setMiniOpen] = useState(false);
  useEffect(() => window.mobius.mini?.onChange(setMiniOpen), []);
  const [splitDrag, setSplitDrag] = useState<number | null>(null);
  const openSplit = useCallback(() => {
    const { panes: [a], focused: f } = panesNow.current;
    const here = f === 1 ? panesNow.current.panes[1] ?? a : a;
    setPanes([here, companionFor(here)]);
    setFocused(0);
  }, []);
  const closePane = useCallback((index: 0 | 1) => {
    const { panes: [a, b] } = panesNow.current;
    setPanes([index === 0 ? (b ?? a) : a, null]);
    setFocused(0);
  }, []);
  const choosePane = useCallback((index: 0 | 1, id: AppId) => {
    const { panes: [a, b] } = panesNow.current;
    if (b === null) return;
    // Choosing what the other pane shows swaps them, so the same app is never open twice.
    if (index === 0) setPanes(id === b ? [b, a] : [id, b]);
    else setPanes(id === a ? [b, a] : [a, id]);
    setFocused(index);
  }, []);
  const swapPanes = useCallback(() => {
    const { panes: [a, b], focused: f } = panesNow.current;
    if (b === null) return;
    setPanes([b, a]);
    setFocused(f === 0 ? 1 : 0);
  }, []);
  const [finding, setFinding] = useState(0);
  const [findOpen, setFindOpen] = useState(false);
  const openFind = useCallback(() => { setFindOpen(true); setFinding((n) => n + 1); }, []);
  const inBrowser = app === 'browser';
  const inAgent = app === 'agent';
  const inNotes = app === 'notes';
  const inTasks = app === 'tasks';
  const inSearch = app === 'search';
  /** Shown in either pane, focused or not. */
  const shows = (id: AppId) => app === id || other === id;
  // Apps the agent (or another app) changed while you were elsewhere: their rail button carries a dot until opened.
  const [changed, setChanged] = useState<ReadonlySet<AppId>>(new Set());
  const here = useRef({ app, other, narrow });
  here.current = { app, other, narrow };
  useEffect(() => { setChanged((s) => { if (!s.has(app)) return s; const n = new Set(s); n.delete(app); return n; }); }, [app]);
  useEffect(() => { if (other) setChanged((s) => { if (!s.has(other)) return s; const n = new Set(s); n.delete(other); return n; }); }, [other]);
  /**
   * The agent made or changed something while you talk to it in the Agent app: show it in the second pane, beside the
   * conversation, without taking focus away from it. A pane you chose for something else is never replaced.
   */
  const showBeside = useCallback((id: AppId): boolean => {
    const { panes: [a, b], focused: f } = panesNow.current;
    if (here.current.narrow) return false;
    const focusedApp = f === 1 && b !== null ? b : a;
    const otherApp = f === 1 ? a : b;
    if (focusedApp !== 'agent') return false;
    if (otherApp === id) return true;
    if (otherApp !== null) return false;
    setPanes([a, id]);
    return true;
  }, []);
  const notesNow = useRef(notes);
  notesNow.current = notes;
  const tasksNow = useRef(tasks);
  tasksNow.current = tasks;
  useEffect(() => {
    const visible = (id: AppId) => here.current.app === id || here.current.other === id;
    const mark = (id: AppId) => { if (!visible(id)) setChanged((s) => new Set(s).add(id)); };
    const offNotes = window.mobius.notes?.onChanged((c) => {
      if (c.by === 'person') return;
      if (c.by === 'assistant' && c.path && showBeside('notes')) { void notesNow.current.open(c.path); return; }
      mark('notes');
    });
    const offTasks = window.mobius.tasks?.onChanged((c) => {
      if (c.by === 'person') return;
      if (c.by === 'assistant' && c.list && showBeside('tasks')) { tasksNow.current.setView({ kind: 'list', name: c.list }); return; }
      mark('tasks');
    });
    return () => { offNotes?.(); offTasks?.(); };
  }, [showBeside]);
  const [searchFocus, setSearchFocus] = useState(0);
  const openApp = useCallback((id: AppId) => { if (isAvailable(id)) setApp(id); }, []);
  const needsYou = conversation.list.reduce((sum, c) => sum + c.waiting, 0);
  const { settings, save: saveSettings, reload: reloadSettings } = useAgentSettings();
  const active = browser.tabs.find((tab) => tab.active);
  const saved = active !== undefined && bookmarks.some((b) => b.url === active.url);
  const surface: SurfaceState = {
    app,
    hasPage: active !== undefined && /^https?:/.test(active.url),
    note: inNotes && notes.page ? { path: notes.page.path, title: notes.page.title, text: notes.text } : null,
    tasks: inTasks ? tasksContext(tasks) : null,
  };
  const activity = activityOf(conversation.state);
  const turnMarks = useTurnChanges(conversation.state.conversation, conversation.state.busy);
  // A page the agent opens while you talk to it in the Agent app shows in the browser beside the conversation.
  // Pages opened in earlier turns, or in a conversation just switched to, are already seen.
  const seenPages = useRef<{ conversation: string; calls: Set<string> } | null>(null);
  useEffect(() => {
    const { conversation: id, items } = conversation.state;
    const opened = items.flatMap((item) => (item.kind === 'tool' && item.name === 'browser.open' && item.status === 'done' ? [item.callId] : []));
    if (seenPages.current?.conversation !== id) { seenPages.current = { conversation: id, calls: new Set(opened) }; return; }
    const fresh = opened.filter((call) => !seenPages.current!.calls.has(call));
    fresh.forEach((call) => seenPages.current!.calls.add(call));
    if (fresh.length > 0) showBeside('browser');
  }, [conversation.state, showBeside]);
  // The toolbar has the same parts in every app: where you are, a line about it, then that app's own controls.
  const place = inBrowser ? (active?.title || appName(app)) : inAgent ? (conversation.list.find((c) => c.id === conversation.id)?.title || 'New conversation') : inNotes && notes.page ? liveTitle(notes.text, notes.page.title || appName(app)) : inTasks ? (tasks.view.kind === 'list' ? tasks.view.name : tasks.view.id === 'today' ? 'Today' : 'Scheduled') : appName(app);
  const tasksHere = inTasks ? (tasks.view.kind === 'list' ? (tasks.all[tasks.view.name] ?? []) : smartView(tasks.view.id, tasks.all, new Date()).map((x) => x.task)) : [];
  const tasksOpen = tasksHere.filter((t) => !t.done).length;
  const tasksDone = tasksHere.length - tasksOpen;
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const dueToday = smartView('today', tasks.all, new Date()).length;
  const openTasks = tasks.lists.reduce((sum, l) => sum + l.open, 0);
  const pages = notes.notebooks.reduce((sum, nb) => sum + nb.pages.length, 0);
  const hubStatus: Partial<Record<AppId, string>> = {
    agent: activity ? activity.label : needsYou > 0 ? `${needsYou} waiting for you` : plural(conversation.list.length, 'conversation'),
    browser: plural(browser.tabs.length, 'tab') + ' open',
    notes: plural(pages, 'page'),
    tasks: dueToday > 0 ? `${dueToday} due today` : openTasks > 0 ? `${openTasks} to do` : 'All done',
    search: 'Find anything',
  };
  const [panelOpen, setPanelOpen] = useState(true);
  // The left panel: a narrow rail, or the full sidebar with the apps by name and the open app's own list under them.
  // Apple: do not hide the sidebar by default. A narrow window folds it to the rail on its own, as Mail does.
  const [narrowOpen, setNarrowOpen] = useState(false);
  useEffect(() => { if (!narrow) setNarrowOpen(false); }, [narrow]);
  const wide = narrow ? narrowOpen : appearance.value.navigation !== 'rail';
  const toggleWide = useCallback(() => {
    if (narrow) setNarrowOpen((o) => !o);
    else void appearance.set({ navigation: wide ? 'rail' : 'sidebar' });
  }, [narrow, wide, appearance]);
  const startedUp = useRef(false);
  const [chatOpen, setChatOpen] = useState(true);
  const [focusToken, setFocusToken] = useState(0);
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const address = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  // Where the sidebars sit and how wide they are. A floating one hides until asked for, and draws over the window.
  const hasAppList = inBrowser || inAgent || inNotes || inTasks;
  // In the full sidebar the app's list lives inside it, so there is no separate one beside the page.
  const hasLeft = hasAppList && !wide;
  // The agent panel sits beside the Browser and Notes; the Agent app is the conversation itself.
  // With the Agent app open in a pane, the conversation is already on screen.
  const hasRight = (inBrowser || inNotes || inTasks) && !shows('agent');
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
  // The selection menu drops over the page, so the page's picture stands in for it while the menu is open.
  const [selectionMenu, setSelectionMenu] = useState(false);
  const needCover = shows('browser') && (floatingShown || drag !== null || hovering || splitDrag !== null || selectionMenu);
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
  const [hubOpen, setHubOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<'advanced' | 'layout' | undefined>(undefined);
  const [taskFocus, setTaskFocus] = useState(0);
  const openHub = useCallback(() => { opener.current = document.activeElement as HTMLElement | null; setHubOpen(true); }, []);
  const closeHub = useCallback((restore = true) => { setHubOpen(false); if (restore) queueMicrotask(() => opener.current?.focus?.()); }, []);
  const closeLauncher = useCallback(() => {
    setLauncherOpen(false);
    queueMicrotask(() => opener.current?.focus?.());
  }, []);
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  /** Open something found in Search in the app it belongs to. */
  const openTarget = (target: HubTarget) => {
    if (target.app === 'agent') { conversation.select(target.conversation); openApp('agent'); }
    else if (target.app === 'notes') { openApp('notes'); void notes.open(target.path, target.title); }
    else if (target.app === 'tasks') { tasks.setView({ kind: 'list', name: target.list }); openApp('tasks'); }
    else { openApp('browser'); void window.mobius.browser.open(target.url); }
  };
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

  const createActions: HubAction[] = [
    { id: 'conversation', label: 'New conversation', app: 'agent', run: () => { closeSettings(); conversation.newConversation(); openApp('agent'); setFocusToken((n) => n + 1); } },
    { id: 'note', label: 'New note', app: 'notes', run: () => { closeSettings(); openApp('notes'); void (async () => { const nb = notes.page?.path.split('/')[0] ?? notes.notebooks[0]?.name ?? (await notes.createNotebook('Notes')); if (nb) await notes.createPage(nb); })(); } },
    { id: 'task', label: 'New task', app: 'tasks', run: () => { closeSettings(); tasks.setView({ kind: 'list', name: 'Inbox' }); openApp('tasks'); setTaskFocus((n) => n + 1); } },
    { id: 'tab', label: 'New tab', app: 'browser', run: () => { closeSettings(); openApp('browser'); newTab(); } },
  ];
  /** The one thing worth starting in the app you are in: the panel's New button changes with it. */
  const createFor = (id: AppId): HubAction => createActions.find((a) => a.app === (id === 'search' ? 'agent' : id)) ?? createActions[0]!;
  const appSidebar = (pinNode: ReactNode) => (
          <>
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
                pin={pinNode}
              />
            ) : inNotes ? (
              <NotesSidebar notes={notes} pin={pinNode} changed={turnMarks.notes} />
            ) : inTasks ? (
              <TasksSidebar tasks={tasks} pin={pinNode} changed={turnMarks.lists} />
            ) : (
          <aside className="side" aria-label="Browser sidebar">
            <div className="side-head">
              <span className="side-title">Tabs</span>
              <span className="side-actions">
                {pinNode}
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
          </>
  );

  // A short message about something done without the agent, such as a task made from a selection.
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => { if (!toast) return undefined; const t = window.setTimeout(() => setToast(null), 2600); return () => window.clearTimeout(t); }, [toast]);
  const [incoming, setIncoming] = useState<{ token: number; item: ContextItem } | null>(null);
  /** On-canvas actions for the web: what to do with the text selected on the page. */
  const webSelection = async (action: WebSelectionAction) => {
    setSelectionMenu(false);
    const result = await window.mobius.context.selection().catch(() => ({ ok: false as const, error: 'The selection could not be read.' }));
    if (!result.ok) { setNotice(result.error); return; }
    const { item } = result;
    if (action === 'clip') {
      const saved = await clipToNotes(item);
      setNotice(saved.ok ? 'Saved to Clippings in Notes' : saved.error);
      return;
    }
    if (action === 'task') {
      const list = tasks.lists[0]?.name;
      if (!list) { setNotice('Make a task list first, in Tasks.'); return; }
      const words = item.text.replace(/\s+/g, ' ').trim().slice(0, 200);
      const ok = await tasks.add(list, words, null);
      setNotice(ok ? `Added to ${list}` : 'The task could not be added.');
      return;
    }
    const ready = settings?.configured === true && coreStatus === 'ready' && !conversation.state.busy;
    if (!shows('agent')) setChatOpen(true);
    if (action === 'ask' || !ready) { setIncoming({ token: Date.now(), item }); return; }
    void conversation.send(action === 'summarise' ? 'Summarise the attached text from this page in a few lines.' : 'Explain the attached text from this page in plain words.', [item]);
  };
  /** On-canvas actions: what to do with text selected in a note. */
  const onNoteSelection = (action: SelectionAction, text: string) => {
    const page = notes.page;
    if (!page) return;
    const title = liveTitle(notes.text, page.title || appName('notes')).slice(0, 120) || 'Note';
    const item: ContextItem = { kind: 'note', title, source: page.path, text: text.slice(0, MAX_CONTEXT_ITEM_CHARS) };
    if (action === 'task') {
      const list = tasks.lists[0]?.name;
      if (!list) { setToast('Make a task list first, in Tasks.'); return; }
      const words = text.replace(/\s+/g, ' ').trim().slice(0, 200);
      void tasks.add(list, words, null).then((ok) => setToast(ok ? `Added to ${list}` : 'The task could not be added.'));
      return;
    }
    const ready = settings?.configured === true && coreStatus === 'ready' && !conversation.state.busy;
    if (!shows('agent')) setChatOpen(true);
    if (action === 'ask' || !ready) { setIncoming({ token: Date.now(), item }); return; }
    const prompt = action === 'rewrite'
      ? `Rewrite the attached passage from my note "${title}" so it reads more clearly, keeping its meaning. Make the change in the note itself (${page.path}) and change nothing else.`
      : `Summarise the attached passage from my note "${title}" in a few lines.`;
    void conversation.send(prompt, [item]);
  };

  /** What one pane draws for an app. Each app is on screen at most once, so its state is never split in two. */
  const paneContent = (id: AppId): ReactNode => {
    switch (id) {
      case 'browser':
        return (
          <>
            {cover?.url && <img className="page-cover" src={cover.url} alt="" data-testid="page-cover" />}
            <SurfaceSlot hidden={launcherOpen || hubOpen || settingsOpen || cover !== null} />
          </>
        );
      case 'notes':
        return <NoteEditor notes={notes} autoFocus={app === 'notes'} onSelection={onNoteSelection} />;
      case 'tasks':
        return <TasksPage tasks={tasks} focusToken={taskFocus} />;
      case 'search':
        return (
          <SearchPage
            conversations={conversation.list}
            notebooks={notes.notebooks}
            tasks={tasks.all}
            focusToken={searchFocus}
            canAsk={settings?.configured === true && coreStatus === 'ready' && !conversation.state.busy}
            onAsk={(question) => { openApp('agent'); void conversation.send(question, []); }}
            onOpen={openTarget}
          />
        );
      case 'agent':
        return (
          <ChatPanel
            surface={surface}
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
            incoming={incoming}
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
        );
      default:
        return null;
    }
  };

  return (
    <div className="app" data-wide={wide || undefined} data-app={app} data-panel={leftOpen ? 'open' : 'closed'} data-chat={rightOpen ? 'open' : 'closed'}>
      <Rail
        app={app}
        expanded={wide}
        onToggle={toggleWide}
        onOpen={(id) => { closeSettings(); if (id === 'search') setSearchFocus((n) => n + 1); openApp(id); }}
        activity={activity}
        changed={changed}
        needsYou={needsYou}
        counts={{ browser: browser.tabs.length, tasks: dueToday }}
        create={createFor(app)}
        onLauncher={openHub}
        onSettings={() => (settingsOpen ? closeSettings() : openSettings())}
        settingsOpen={settingsOpen}
        apps={appearance.value.sidebarApps}
        onApps={(sidebarApps) => void appearance.set({ sidebarApps: sidebarApps as typeof appearance.value.sidebarApps })}
        onEditApps={() => { setSettingsSection('layout'); openSettings(); }}
      >
        {wide && hasAppList && appSidebar(null)}
      </Rail>
      <header className="context-strip">
        <div className="strip-left" role="group" aria-label="Window">
          {hasLeft && <button type="button" className="strip-btn" data-dock-toggle aria-pressed={leftOpen} aria-label={inAgent ? 'Show conversations' : inNotes ? 'Show notebooks' : inTasks ? 'Show lists' : 'Show tabs'} title={inAgent ? 'Show or hide conversations' : inNotes ? 'Show or hide notebooks' : inTasks ? 'Show or hide lists' : 'Show or hide tabs'} onClick={() => setLeftOpen((open) => !open)}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="4" width="14" height="12" rx="2.5" /><path d="M8 4v12" /></svg>
          </button>}
        </div>
        <div className="toolbar-place" data-browser={inBrowser || undefined}>
          <h1 className="strip-title">{place}</h1>
          {inAgent && <span className="toolbar-sub">{settings?.configured ? `Talking to ${settings.model}` : 'No model connected'}</span>}
          {inNotes && notes.page && <span className="toolbar-sub">{notes.page.path.split('/')[0]} · <span className="note-status" role="status" data-status={notes.status}>{notes.message || statusText(notes.status)}</span></span>}
          {inTasks && <span className="toolbar-sub">{tasksOpen === 0 ? 'Nothing to do' : `${tasksOpen} to do`}</span>}
        </div>
        {inTasks && tasks.view.kind === 'list' && tasksDone > 0 && (
          <div className="strip-middle toolbar-tools" role="group" aria-label="Tasks">
            <button type="button" className="tool-btn" onClick={() => { if (tasks.view.kind === 'list') void tasks.clearDone(tasks.view.name); }}>Clear {tasksDone} completed</button>
          </div>
        )}
        {inBrowser && <div className="strip-middle" role="group" aria-label="Browser">
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
          <div className="selection-menu-wrap">
            <button type="button" className="strip-btn" data-selection-ask aria-haspopup="menu" aria-expanded={selectionMenu} aria-label="Selected text" title="Do something with the text selected on this page" disabled={!active || !/^https?:/.test(active.url)} onClick={() => setSelectionMenu((open) => !open)}>
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 5h8M4 9h5M4 13h4" /><path d="M14.5 9.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" /></svg>
            </button>
            {selectionMenu && cover !== null && (
              <SelectionMenu onClose={() => setSelectionMenu(false)} onChoose={(action) => void webSelection(action)} />
            )}
          </div>
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
        <span className="core-status" role="status" data-state={coreStatus}>{CORE_LABEL[coreStatus]}</span>
        {hasRight && !rightOpen && (
          <form className="ask-pill" role="search" aria-label="Ask the agent" onSubmit={(e) => {
            e.preventDefault();
            const field = e.currentTarget.elements.namedItem('ask') as HTMLInputElement;
            const text = field.value.trim();
            if (!text || !settings?.configured || conversation.state.busy) return;
            field.value = '';
            setChatOpen(true);
            void conversation.send(text, []);
          }}>
            <svg viewBox="0 0 20 20" aria-hidden="true">{APP_ICONS.agent}</svg>
            <input name="ask" type="text" aria-label="Ask Mobius" placeholder={`Ask about ${inBrowser ? 'this page' : inNotes ? 'this note' : 'your tasks'}`} autoComplete="off" disabled={!settings?.configured} />
            {activity && <span className="ask-working" role="status" aria-label="Agent activity">{activity.label}</span>}
          </form>
        )}
        <div className="strip-right" role="group" aria-label="Applications">
          <button type="button" className="strip-btn" data-mini-toggle aria-pressed={miniOpen} aria-label={miniOpen ? 'Close Little Mobius' : 'Open Little Mobius'} title={miniOpen ? 'Close the small agent window' : 'Little Mobius: the agent in a small window above your other apps'} onClick={() => void (miniOpen ? window.mobius.mini.close() : window.mobius.mini.open())}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="3.5" width="14" height="13" rx="3" /><rect x="9.5" y="9.5" width="5.5" height="5" rx="1.5" /></svg>
          </button>
          {!narrow && <button type="button" className="strip-btn" data-split-toggle aria-pressed={split} aria-label={split ? 'Close split view' : 'Split view'} title={split ? 'Show one app' : 'Show two apps side by side'} onClick={() => (split ? closePane(focused === 0 ? 1 : 0) : openSplit())}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="4.5" width="6.5" height="11" rx="2" /><rect x="11" y="4.5" width="6.5" height="11" rx="2" /></svg>
          </button>}
          {hasRight && <button type="button" className="strip-btn" data-dock-toggle aria-pressed={chatOpen} aria-label="Show agent" title="Show or hide the agent" onClick={() => { setChatOpen((open) => !open); setFocusToken((n) => n + 1); }}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="4" width="14" height="12" rx="2.5" /><path d="M12 4v12" /></svg>
          </button>}
        </div>
      </header>
      <div className="body" style={layout}>
        {hasLeft && leftOpen && (
          <div ref={leftDock} className="dock left" data-floating={leftFloating || undefined}>
            {appSidebar(pin('left'))}
            {resizer('left', 'Resize the list')}
          </div>
        )}
        {hasLeft && leftFloating && !leftOpen && <div className="hotzone left" data-testid="hotzone-left" onPointerEnter={() => { leftFromEdge.current = true; setLeftOpen(true); }} />}
        <main className="stage" data-split={split || undefined} style={split ? ({ '--split': `${(splitDrag ?? share) * 100}%` } as React.CSSProperties) : undefined}>
          {settingsOpen && (
            <SettingsPage
              {...(settingsSection === 'layout' ? { initial: 'appearance' as const, initialSubpage: 'layout' } : settingsSection ? { initial: settingsSection } : {})}
              onClose={() => { setSettingsSection(undefined); closeSettings(); }}
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
          {(split ? ([0, 1] as const) : ([focused] as const)).map((index, at) => {
            const id = split ? (panes[index] ?? app) : app;
            const pane = (
              <Pane key={`pane-${at}`} index={index} app={id} split={split} focused={focused === index}
                onFocus={() => { if (split && focused !== index) setFocused(index); }}
                onChoose={(next) => choosePane(index, next)} onSwap={swapPanes} onClose={() => closePane(index)}>
                {paneContent(id)}
              </Pane>
            );
            return at === 1
              ? [<SplitDivider key="divider" share={splitDrag ?? share} onDrag={setSplitDrag} onCommit={(next) => { setShare(next); saveShare(next); }} />, pane]
              : [pane];
          })}
          {toast && <div className="toast" role="status">{toast}</div>}
        </main>
        {rightOpen && (
          <div ref={rightDock} className="dock right" data-floating={rightFloating || undefined}>
          <ChatPanel
              surface={surface}
            state={conversation.state}
            settings={settings}
            coreReady={coreStatus === 'ready'}
            onSend={(text, items) => void conversation.send(text, items)}
            onStop={conversation.stop}
            onAnswer={conversation.answer}
              onReply={conversation.reply}
            onSaveSettings={saveSettings}
            focusToken={focusToken}
            incoming={incoming}
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
      <AppHub
        open={hubOpen}
        onClose={closeHub}
        current={app}
        onOpenApp={(id) => { closeSettings(); if (id === 'search') setSearchFocus((n) => n + 1); openApp(id); }}
        onConnect={() => { setSettingsSection('advanced'); openSettings(); }}
        status={hubStatus}
        actions={createActions}
      />
      <Launcher open={launcherOpen} onClose={closeLauncher} tabs={browser.tabs} onNewTab={newTab} onActivateTab={(id) => { openApp('browser'); window.mobius.browser.activate(id); }} onOpenApp={openApp} />
    </div>
  );
}
