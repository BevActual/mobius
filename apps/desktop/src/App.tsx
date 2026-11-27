import { shellStandsDown } from './ui/keyboardClaim';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { MenuBar } from './MenuBar';
import { buildMenus, type Menu, type MenuContext, type MenuItem, findItem, menusAsData } from './menus';
import { sendCommand } from './commands';
import { MAIN_BOT_ID, parseLaunchChoice, withSteps, conversationIdFor, MAX_CONTEXT_ITEM_CHARS, MAX_FAVOURITES, type Favourite, actionForPress, describeCombo, settleBindings, botOfConversation, type ContextItem, type KeyPress, type MailContent, type NoteComment, type CalendarEvent } from '@mobius/shared';
import { MEETINGS_NOTEBOOK, meetingNote } from './note-insert';
import { citeWhenOpen, listForSource, noteForSource, pageForSource } from './note-sources';
import { ClaimSources } from './RichText';
import { commentsOutline } from './NoteComments';
import { rememberTitles } from './ReviewStrip';
import { appName, askAbout, findApp, isAvailable, isInstalled, isListed, setInstalledApps, type AppId, noteOpened, noteRecentItem, recentItems, APPS, COMPACT_APPS } from './apps';
import { databaseOutline, DEBUG_TEST, noteContext, sheetItem, suggestionsFor, tasksContext, type SurfaceState } from './surface';
import { trayShown, type TrayShown } from './tray';
import { ChatPanel } from './ChatPanel';
import { morphOut, switchIn, useMorphIn } from './motion';
import { ConversationSidebar, type SideMode } from './ConversationSidebar';
import { ActivityPage, ActivitySidebar, activitySub, useActivityFeed } from './ActivityApp';
import { AgentPage, agentWhen, useSchedules, type AgentView } from './AgentPage';
import { useBookmarks } from './useBookmarks';
import { useArchive } from './useArchive';
import { useBots } from './useBots';
import { useDownloads } from './useDownloads';
import { GoButton, Launcher, pinnedApps, type FoundItem } from './Launcher';
import { Resizer } from './Resizer';
import { useAutoHide } from './useAutoHide';
import { UpdateNotice } from './UpdateNotice';
import { pressOf, takeEarlyKeys } from './early-keys';
import { CommentButton, CommentLayer, CommentsGroup, useCommentThreads, useOpenComments, useSuggestions } from './Comments';
import type { Side } from './resize';
import { useAgentSettings } from './useAgentSettings';
import { useBrowser } from './useBrowser';
import { useAppearance } from './useAppearance';
import { usePreferences } from './usePreferences';
import { useConversation } from './useConversation';
import { SettingsPage } from './settings/SettingsPage';
import { useCoreStatus } from './useCoreStatus';
import { useNotes } from './useNotes';
import { saveAll, saveTyped } from './saveBeforeQuit';
import { NotesSidebar } from './NotesSidebar';
import { TasksGlance, TasksListPiece, TasksPage, TasksSidebar } from './Tasks';
import { CalendarDayPiece } from './Calendar';
import { PIECE_APP, pieceName, piecePanelId, putAway, showPiece, usePieces, type OpenPiece } from './pieces';
import { CalendarGlance, CalendarPage, CalendarSidebar } from './Calendar';
import { setLanguage } from './i18n';
import { DEFAULT_FOLDER, DocEditor, DocsSidebar, type WritingTool } from './Docs';
import { fillTemplate, isTemplate, TEMPLATES_FOLDER, templateName, templatesIn } from './docs-view';
import { SheetGrid, SheetsGlance, SheetsSidebar } from './Sheets';
import { MailPage, MailSidebar, MailThreadPiece, mailPlace } from './Mail';
import { MessagesPage, MessagesSidebar, useRailChoice } from './Messages';
import { useMessages } from './useMessages';
import { SlidesEditor, SlidesSidebar, type SlidesTool } from './Slides';
import { useMail } from './useMail';
import { useSheets } from './useSheets';
import { useCode } from './useCode';
import { CodeEditor, CodeGlance, CodeSidebar } from './Code';
import { DesignEditor, DesignSidebar } from './Design';
import { CanvasBoard, CanvasSidebar } from './Canvas';
import { PinnedView, ViewPage, newView, usePinnedView } from './Views';
import type { TileTarget } from './views-data';
import { RESEARCH_FOLDER, ResearchPage, ResearchSidebar } from './Research';
import { researchPrompt, researchSteps, startingPage, titleFor } from './research-format';
import { ReaderPage, readerSub, saveToReader } from './Reader';
import { parseArticle, READING_LIST } from './reader-format';
import { DatabasePage, DatabaseSidebar, databasePlace, databaseSub } from './Database';
import { useDatabases } from './useDatabases';
import { TerminalPage, TerminalPanel, TerminalSidebar } from './Terminal';
import { useTerminal } from './useTerminal';
import { ReviewPage, ReviewSidebar, useReview } from './Review';
import { BrowserChrome, BrowserPage, BrowserSidebar, ownTab, stepSpace } from './Browser';
import { hostOf } from './browser-view';
import { PhotoEditor, PhotoSidebar } from './Photo';
import { StudioEditor, StudioSidebar, StudioSub } from './Studio';
import { VideoEditor, VideoSidebar } from './Video';
import { SkillEditor } from './Skills';
// Abilities (marked): the toolbar's title, grey line and controls, the skills list, and New skill.
import { AbilitiesSub, abilitiesTitle, ExtensionsPage, ExtensionsSidebar, openStoreItem, requestNewSkill, SkillList, SkillsToolbar, useStoreItem, type ExtensionPlace } from './Extensions';
import { FilesCrumbs, FilesPage, FilesSidebar, filesSub, filesTitle, useFiles } from './Files';
import { SyncGlyph } from './Sync';
import { pairFor } from './sync-view';
import { setChatMode } from './chat-mode';
import { MailActions } from './MailPlan';
import { memoryPage, ProjectPage, ProjectsSidebar, SideThreads, useProjects } from './Projects';
import { HowIWork, SharedQueue, WikiPage, WikiSidebar, useWikiIncoming, type WikiPlace } from './Wiki';
import { useSkills } from './useSkills';
import { expandSlash } from './skill-format';
import { useVideo } from './useVideo';
import { writeCut } from './cut-format';
import { RECENTLY_DELETED, usePhotos } from './usePhotos';
import { editsPathFor } from './photo-edit';
import { sheetContext } from './sheets-view';
import { openOnChanges } from './open-on-changes';
import { changeTarget, toolTarget } from './actions';
import { eventsOn, isoDay, rangeLabel as calendarRange } from './calendar-view';
import { Desk } from './Desk';
import { readRuns, useBackgroundRuns } from './background';
import { BRIEF_TITLE, BRIEF_TOOLS, useMorningBrief } from './brief';
import { checkInTitle, useCheckIns } from './checkins';
import { ASSIGN_EVENT, setAssignAgents, type Assignment } from './assign';
import { ABILITY_ITEM, abilityAsk, jobSteps, markSaved } from './ability-offer';
import { AskHere, inlineAnswer, pickedNow, plainAnswer, type Picked } from './AskHere';
import { hereOf } from './surface';
import { itemChatFor, useItemChats } from './itemChats';
import type { SendOptions } from './composer/Composer';
import { inboxItems } from './inbox';
import { fitDocks } from './dock-fit';
import { deskAppRows } from './desk-apps';
import { agoLabel } from './desk-view';
import { APP_ICONS, type OwnApp } from './Rail';
import { useMobiusStepAside } from './ui/PanelTabs';
import { SidebarHead } from './SidebarHead';
import { WEB_LINK_EVENT, sameUrl, type WebLink } from './web-link';
import { BESIDE_EVENT, besideUrlOk, type Beside } from './beside';
import { PanelsListed, ShellPanelsContext, pressIs } from './ui/PanelLayout';
import { calendarDay, meetingKey, meetingStarting, OFFER_SHOWN_MS } from './meeting-start';
import { alertDue, alertSaid } from './calendar-alerts';
import { stopReading } from './useSpeech';
import { OPEN_SPEAKING_SETTINGS, UndoToast, AppFrame, InspectorDock, PanelLayout, PanelsMenu, TooltipLayer, usePanelEntries, type PanelsOfApp, type ShellPanel, type MenuEntry, useAnyMenuOpen, type AppMenuState, type PanelSpec } from './ui';
import { SideHeadMenu } from './SideHeadMenu';
import { AppHub, type HubAction } from './AppHub';
import { SERVICE_NAMES, catchUpAsk, channelLabel, chatItem, isSpaceAccount } from './messages-view';
import { DEFAULT_LIST_NAME, nest, smartName, smartView } from './tasks-view';
import type { HubFilter } from './search-hub';
import { activityOf, appOfTurn } from './activity';
import { WorkingPill } from './WorkingPill';
import { usePauseOnTyping } from './pauseOnTyping';
import { findInSources, sourceCommands } from './launcher-sources';
import { useDailyLauncherSources, useMoreLauncherSources } from './app-launcher';
import { askInline, selectionNow, type LauncherAbout } from './launcher-ask';
import { useClipboardHistory } from './launcher-clipboard';
import { useSystemSearch } from './launcher-system';
import { launcherFind, targetApp, targetLabel, targetOfRef, type HubTarget, type LauncherSources } from './search-hub';
import { useTasks } from './useTasks';
import { useCalendar } from './useCalendar';
import { useLiveMarks } from './liveMarks';
import { contactSheet } from './picture';

import { useTurnChanges } from './useTurnChanges';
import { NoteEditor, type SelectionAction } from './NoteEditor';
import { recentNotes, useNoteQuickOpen } from './note-quick-open';
import { findTodayNote, JOURNAL, liveTitle, statusText, todayNoteTitle } from './notes-state';
import { checkedLast, setCheckedLast } from './checked-last';
import { noteSort, setNoteSort, type NoteSort } from './note-sort';
import { dailyTemplate, KEPT_NOTE_TEMPLATES, noteTemplates, savedTemplates, templateBody, templatesNotebook } from './note-templates';
import { Pane, SplitDivider } from './SplitView';
import { type ClipPage, type WebSelectionAction } from './SelectionMenu';
import { LearnPanel } from './LearnPanel'; // Learn (shell/learn-view)
import { LESSONS } from './learn'; // Learn (shell/learn-view)
import { clipToNotes } from './clip';
import { loadPanes, savePanes, loadByMobius, saveByMobius, leavesSplit, companionFor, followPane, loadShare, saveShare } from './split';
import { TRY_ANOTHER_ASK, TryAnotherContext, TurnRunningContext } from './ReviewBar';

/** Focuses a task's row once its list shows (opened from Ctrl+K), trying for a moment while the list renders. */
function focusTaskRow(text: string, tries = 20): void {
  const row = document.querySelector<HTMLElement>(`.tasks-page .task-line[aria-label="${CSS.escape(text)}"]`);
  if (row) { row.focus(); row.scrollIntoView({ block: 'nearest' }); return; }
  if (tries > 0) window.setTimeout(() => focusTaskRow(text, tries - 1), 50);
}

const CORE_LABEL = { starting: 'Starting core…', ready: 'Core ready', restarting: 'Restarting core…', failed: 'Core unavailable' } as const;

const NOTICES: Record<string, string> = {
  ask: 'Set up a model in Mobius to ask questions.',
  blocked: 'Mobius only opens web addresses (http or https).',
};

/** The key that shows and hides Mobius beside the work. */
/** Shows and hides Mobius beside the work: a key Mobius keeps for itself (FIXED_KEYS), which no shortcut can take. */
const MOBIUS_KEYS = 'mod+shift+m';

/** The toolbar's Mobius button. Pressed means Mobius is in front: while it has stepped aside for the inspector (a window
 * with room for only one of the two) it shows not pressed, and a press brings it forward instead of closing it. */
function MobiusButton({ open, toggle }: { open: boolean; toggle: () => void }) {
  const { aside, bringForward } = useMobiusStepAside();
  const front = open && !aside;
  return (
    <button type="button" className="strip-btn strip-mobius" data-mobius-face aria-pressed={front} aria-label={front ? 'Hide Mobius' : 'Show Mobius'} title={`${front ? 'Hide Mobius' : 'Ask Mobius, beside the work'} (${describeCombo(MOBIUS_KEYS, window.mobius.platform)})`}
      onClick={open && aside ? bringForward : toggle}>
      <svg viewBox="0 0 20 20" aria-hidden="true">{APP_ICONS.agent}</svg>
    </button>
  );
}

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

/** The window's width, kept current as it is resized. */
function useWindowWidth(): number {
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const on = () => setWidth(window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return width;
}

/** A button's tooltip with its shortcut after it, when it has one. */
const withKeys = (text: string, binding: string) => (binding ? `${text} (${describeCombo(binding, window.mobius.platform)})` : text);

/** Who is using a tab while a task runs, as the tab says it. */

/** An album's photos as one numbered picture, for Make these match to look at (the first twenty, as shot). */
async function albumSheet(read: (path: string) => Promise<unknown> | undefined, list: readonly { path: string }[]): Promise<string | null> {
  const got = await Promise.all(list.slice(0, 20).map((p) => Promise.resolve(read(p.path)).catch(() => null)));
  return contactSheet(got.flatMap((g) => (g && typeof g === 'object' && 'dataUrl' in g && typeof g.dataUrl === 'string' ? [g.dataUrl] : [])));
}

/**
 * Apps that own their list as a left panel of their own (docs/design/panel-layouts.md, "Default layout per app"): the
 * shell draws no list for them, and the panel is shown, hidden and sized per app like any other. The name is the
 * panel's header. Home's list is named for what it shows: chats, agents or activity.
 */
const NO_PANELS: readonly PanelSpec[] = [];
const OWN_LIST: Partial<Record<AppId, string>> = {
  agent: 'Chats', mail: 'Mailboxes', messages: 'Conversations', calendar: 'Calendars', tasks: 'Lists', notes: 'Notebooks', docs: 'Documents', files: 'Places',
  reader: 'Library', research: 'Reports', wiki: 'Knowledge', projects: 'Projects', views: 'Dashboards',
  skills: 'Store', sheets: 'Workbooks', database: 'Tables', code: 'Explorer', terminal: 'Sessions', canvas: 'Boards',
  photo: 'Albums', studio: 'Songs', video: 'Videos', design: 'Designs', slides: 'Decks', browser: 'Tabs',
};
/** Apps that lay out panels of their own already: their list is handed to them, as one more of their panels. */
const LIST_HANDED: readonly AppId[] = ['design', 'slides', 'research', 'tasks', 'video', 'code', 'studio', 'database', 'messages', 'photo'];

/** Whether the window is at least this wide, kept up to date as it is resized. */
function useWideWindow(min: number): boolean {
  const [wide, setWide] = useState(() => window.innerWidth >= min);
  useEffect(() => {
    const on = () => setWide(window.innerWidth >= min);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, [min]);
  return wide;
}

/** A ⋯-menu or toolbar row as a menu bar item. */
const entryItems = (entries: MenuEntry[], prefix: string): MenuItem[] => entries.flatMap((e, i): MenuItem[] => [
  ...(e.separated && i > 0 ? [{ kind: 'separator' as const }] : []),
  { kind: 'item', id: `${prefix}-${i}`, label: e.label, run: e.run, ...(e.keys ? { keys: e.keys } : {}), ...(e.disabled ? { disabled: true } : {}), ...(e.checked !== undefined ? { checked: e.checked } : {}) },
]);

/** The shell's menus with the open app's own commands in its menu (`AppMenu`). */
function withAppMenu(base: Menu[], own: AppMenuState | null): Menu[] {
  if (!own) return base;
  const extra = entryItems(own.entries, 'own');
  const window = Math.max(0, base.findIndex((m) => m.id === 'window'));
  return base.some((m) => m.id === 'app')
    ? base.map((m) => (m.id === 'app' ? { ...m, items: [...extra, { kind: 'separator' as const }, ...m.items] } : m))
    : [...base.slice(0, window), { id: 'app', label: own.label, items: extra }, ...base.slice(window)];
}

/**
 * The title row's menus (docs/design/panel-layouts.md): every menu as a title, the app's own commands in its menu, and
 * View ending with the panels, each with a tick when shown and its key, then Reset layout (there is no Panels button).
 */
function TitleMenus({ menus, own, panels, shell, onOpenChange }: { menus: Menu[]; own: AppMenuState | null; panels: PanelsOfApp | null; shell: ShellPanel[]; onOpenChange: (open: boolean) => void }) {
  const rows = usePanelEntries({ app: panels, shell });
  const all = withAppMenu(menus, own).map((m) => (m.id === 'view' ? { ...m, items: [...m.items, { kind: 'separator' as const }, ...entryItems(rows, 'panel')] } : m));
  return <MenuBar menus={all} compact={false} onOpenChange={onOpenChange} />;
}

export function App() {
  const browser = useBrowser();
  const coreStatus = useCoreStatus();
  const bots = useBots();
  const botIds = useMemo(() => bots.bots.map((bot) => bot.id), [bots.bots]);
  const conversation = useConversation(coreStatus, botIds);
  // Work handed to Mobius in the background: it lands in Home's Inbox when done.
  const handoffs = useBackgroundRuns(conversation.list);
  const archive = useArchive(conversation.list);
  const [sideMode, setSideMode] = useState<SideMode>('sessions');
  // Agents app (marked): which agent's page shows while the sidebar is on Agents (null: the one you talk to), and a
  // Run now waiting for its new session to open before it sends the agent's instructions.
  const [agentView, setAgentView] = useState<AgentView | null>(null);
  const [agentRun, setAgentRun] = useState<{ bot: string; text: string } | null>(null);
  const appearance = useAppearance();
  const downloads = useDownloads();
  const preferences = usePreferences();
  // The apps added from Abilities decide what opens, what the switcher lists and what loads.
  setInstalledApps(preferences.value.installedApps);
  // Mobius's own words, in the language chosen (English for now): set once it changes, not on every draw.
  const language = preferences.value.language;
  useEffect(() => setLanguage(language), [language]);
  const bookmarks = useBookmarks();
  const notes = useNotes();
  const docs = useNotes('docs');
  // Apps load when they are first opened, not at start: an app never opened reads nothing (Abilities).
  const [opened, setOpened] = useState<ReadonlySet<AppId>>(() => new Set(loadPanes().filter((id): id is AppId => id !== null)));
  const used = (id: AppId) => opened.has(id) && isInstalled(id);
  const slides = useNotes('slides', used('slides'));
  const designs = useNotes('designs', used('design'));
  const boards = useNotes('boards', used('canvas'));
  const views = useNotes('views', used('views') || used('database')); // Database's sidebar lists them too.
  const research = useNotes('research', used('research'));
  const reading = useNotes('reading', used('reader') || used('browser')); // The Browser's Read later lists it too.
  // Changes are named by the pages' titles as they are now, not the file names they were made with.
  useEffect(() => { rememberTitles('notes', notes.notebooks); }, [notes.notebooks]);
  useEffect(() => { rememberTitles('docs', docs.notebooks); }, [docs.notebooks]);
  useEffect(() => { rememberTitles('slides', slides.notebooks); }, [slides.notebooks]);
  useEffect(() => { rememberTitles('research', research.notebooks); }, [research.notebooks]);
  useEffect(() => { rememberTitles('reading', reading.notebooks); }, [reading.notebooks]);
  const wiki = useNotes('wiki');
  const wikiIncoming = useWikiIncoming();
  const projects = useProjects();
  const [wikiPlace, setWikiPlace] = useState<WikiPlace>({ kind: 'mine' });
  const databases = useDatabases(used('database') || used('views'));
  const terminal = useTerminal();
  const review = useReview(conversation.list, conversation.state.busy);
  const files = useFiles(conversation.state.conversation, conversation.state.busy);
  const [terminalFocus, setTerminalFocus] = useState(0);
  const lastTerminal = [...terminal.entries].reverse().find((e) => e.result !== null) ?? null;
  /** New research was chosen: the Research app shows its question form. */
  const [askingResearch, setAskingResearch] = useState(false);
  const photos = usePhotos(used('photo'));
  const songs = useNotes('songs', used('studio'));
  const video = useVideo(used('video'));
  const skills = useSkills();
  const sheets = useSheets(used('sheets'));
  const code = useCode(used('code'));
  const mail = useMail();
  const chat = useMessages(used('messages'));
  // Messages: while the rail's Mobius space is chosen and none of its channels is open, the page is the space's set-up.
  const chatRail = useRailChoice();
  const chatSpaceSetup = chatRail === 'space' && !!window.mobius.space && !(chat.account && isSpaceAccount(chat.account));
  const tasks = useTasks();
  const calendar = useCalendar();
  // The Inbox's invitations come from their own read of the next 30 days: Calendar's events are only the days on its
  // screen, so an invitation for next week was missed from Day view. Read again whenever Calendar's events or its files change.
  const [ahead, setAhead] = useState<CalendarEvent[]>([]);
  // The person's own addresses, to find the invitations they are on: their mail accounts and calendar sign-ins.
  const myAddresses = [...mail.accounts.map((a) => a.email), ...calendar.accounts.map((a) => a.username).filter((u) => u.includes('@'))];
  const [calendarFiles, setCalendarFiles] = useState(0);
  useEffect(() => window.mobius.calendar?.onChanged(() => setCalendarFiles((n) => n + 1)), []);
  const calendarKey = calendar.events.map((e) => `${e.id}|${e.start}|${e.attendees?.map((a) => a.status).join(',') ?? ''}`).join(';');
  useEffect(() => {
    const api = window.mobius.calendar;
    if (!api) return;
    let on = true;
    const to = new Date();
    to.setDate(to.getDate() + 30);
    void api.events(isoDay(new Date()), isoDay(to)).then((got) => { if (on && Array.isArray(got)) setAhead(got); });
    return () => { on = false; };
  }, [calendarKey, calendarFiles]);
  const [eventToken, setEventToken] = useState(0);
  // An event to open in Calendar, from the Inbox's Answer: its id and day, and a count so the same one opens again.
  const [showEvent, setShowEvent] = useState<{ id: string; date: string; n: number } | null>(null);
  // A saved shortcut on a key Mobius keeps for itself (Little Mobius was Ctrl+Shift+M) goes back to its usual keys.
  const bindings = useMemo(() => settleBindings(preferences.value.keybindings), [preferences.value.keybindings]);
  // Clicking a notification brings Mobius forward; show the conversation it was about.
  useEffect(() => window.mobius.app.onOpenConversation((id) => { conversation.select(id); setChatOpen(true); }), [conversation.select]);
  // Once the saved choices are known, apply the ones that only matter at start-up, once.
  useEffect(() => {
    if (!appearance.loaded || startedUp.current) return;
    startedUp.current = true;
    // The Mobius panel starts closed in every app (Andrew, 24 November 2026); the Mobius icon, its key or a Mobius
    // action opens it. Home is the conversation itself.
    if (!appearance.value.resumeLast) conversation.startFresh();
  }, [appearance.loaded, appearance.value, conversation]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Settings is an app of its own: its sections fill the sidebar, its page's name the title row.
  const [settingsSlot, setSettingsSlot] = useState<HTMLDivElement | null>(null);
  const [settingsTitle, setSettingsTitle] = useState('Settings');
  // Split view: up to two apps side by side. `app` is the focused pane's app, so the toolbar and sidebar follow it.
  // A narrow window has room for one pane, so the other folds away until the window is wide again.
  const narrow = useNarrowWindow(980);
  const [panes, setPanes] = useState<readonly [AppId, AppId | null]>(loadPanes);
  useEffect(() => savePanes(panes), [panes]);
  const [focused, setFocused] = useState<0 | 1>(0);
  const app: AppId = (focused === 1 ? panes[1] : null) ?? panes[0];
  conversation.sentFrom.current = app;
  const split = panes[1] !== null && !narrow;
  const other: AppId | null = split ? (focused === 0 ? panes[1] : panes[0]) : null;
  useEffect(() => {
    setOpened((was) => (was.has(app) && (other === null || was.has(other)) ? was : new Set([...was, app, ...(other ? [other] : [])])));
  }, [app, other]);
  const panesNow = useRef({ panes, focused });
  panesNow.current = { panes, focused };
  // Whether Mobius opened the second pane itself, beside the conversation, rather than the person choosing a split.
  const splitByMobius = useRef(loadByMobius(panes));
  // Set while follow-along opens what Mobius just worked on in the pane beside the conversation: that is Mobius's split
  // carrying on, not the person leaving it.
  const following = useRef(false);
  // Set while the person opens an app from the sidebar (the rail).
  const fromSidebar = useRef(false);
  /** Open an app in the focused pane. If the other pane already shows it, go there instead. */
  const setApp = useCallback((id: AppId) => {
    const { panes: [a, b], focused: f } = panesNow.current;
    // Leaving a split Mobius opened beside the conversation goes to the app alone, with Mobius in its panel again.
    if (!following.current && leavesSplit([a, b], splitByMobius.current, id, fromSidebar.current)) {
      splitByMobius.current = false;
      saveByMobius(false);
      setPanes([id, null]);
      setFocused(0);
      return;
    }
    if (b !== null && (f === 0 ? b : a) === id) { setFocused(f === 0 ? 1 : 0); return; }
    // The conversation stays in a split the person chose: another app goes in the other pane, which then has the focus.
    if (b !== null && (f === 0 ? a : b) === 'agent' && id !== 'agent') {
      setPanes(f === 0 ? [a, id] : [id, b]);
      setFocused(f === 0 ? 1 : 0);
      return;
    }
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
    splitByMobius.current = false;
    saveByMobius(false);
    setPanes([here, companionFor(here)]);
    setFocused(0);
  }, []);
  const closePane = useCallback((index: 0 | 1) => {
    const { panes: [a, b] } = panesNow.current;
    splitByMobius.current = false;
    saveByMobius(false);
    setPanes([index === 0 ? (b ?? a) : a, null]);
    setFocused(0);
  }, []);
  const choosePane = useCallback((index: 0 | 1, id: AppId) => {
    const { panes: [a, b] } = panesNow.current;
    if (b === null) return;
    splitByMobius.current = false;
    saveByMobius(false);
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
  // Activity: one of Mobius's own apps, shown in the Agent app's place with its own sidebar and page.
  const inActivity = inAgent && sideMode === 'activity';
  // Agents app (marked): the agent whose page is open, if any.
  const inAgents = inAgent && sideMode === 'bots';
  // Changes (folded in from the Review app): everything Mobius changed, by turn, to open or put back.
  const inChanges = inAgent && sideMode === 'changes';
  const shownAgent = inAgents && agentView?.kind !== 'new' ? bots.bots.find((b) => b.id === (agentView?.kind === 'show' ? agentView.id : botOfConversation(conversation.id, botIds))) ?? null : null;
  const agentSchedulesList = useSchedules();
  useEffect(() => {
    // Run now: once the agent's new session is the open one, send it the agent's instructions.
    if (!agentRun || botOfConversation(conversation.id, botIds) !== agentRun.bot || conversation.state.items.length > 0 || conversation.state.busy) return;
    const run = agentRun;
    setAgentRun(null);
    void conversation.send(run.text, []);
  }, [agentRun, conversation, botIds]);
  const activityFeed = useActivityFeed(conversation.list, inActivity && !settingsOpen);
  const inNotes = app === 'notes';
  const inDocs = app === 'docs';
  const inSlides = app === 'slides';
  const inSheets = app === 'sheets';
  const inMail = app === 'mail';
  const inMessages = app === 'messages';
  const inCode = app === 'code';
  const inDesign = app === 'design';
  const inCanvas = app === 'canvas';
  const inViews = app === 'views';
  const inResearch = app === 'research';
  const inReader = app === 'reader';
  const inWiki = app === 'wiki';
  const inProjects = app === 'projects';
  const inDatabase = app === 'database';
  const inTerminal = app === 'terminal';
  const inFiles = app === 'files';
  const inPhoto = app === 'photo';
  const inStudio = app === 'studio';
  const inVideo = app === 'video';
  const inSkills = app === 'skills';
  const [extPlace, setExtPlace] = useState<ExtensionPlace>('apps');
  const storeItemOpen = useStoreItem(); // Store (marked): the app whose page is open in Apps
  const inTasks = app === 'tasks';
  const inCalendar = app === 'calendar';
  // Where Search looks: shared by its sidebar's scopes and the page's own.
  /** Shown in either pane, focused or not. */
  const shows = (id: AppId) => app === id || other === id;
  // Apps the agent (or another app) changed while you were elsewhere: a dot on them in the launcher until opened.
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
    splitByMobius.current = true;
    saveByMobius(true);
    setPanes([a, id]);
    return true;
  }, []);
  const notesNow = useRef(notes);
  notesNow.current = notes;
  const docsNow = useRef(docs);
  docsNow.current = docs;
  const slidesNow = useRef(slides);
  slidesNow.current = slides;
  const calendarNow = useRef(calendar);
  calendarNow.current = calendar;
  const sheetsNow = useRef(sheets);
  sheetsNow.current = sheets;
  const designsNow = useRef(designs);
  designsNow.current = designs;
  const boardsNow = useRef(boards);
  boardsNow.current = boards;
  const viewsNow = useRef(views);
  viewsNow.current = views;
  const researchNow = useRef(research);
  researchNow.current = research;
  const readingNow = useRef(reading);
  readingNow.current = reading;
  const databasesNow = useRef(databases);
  databasesNow.current = databases;
  const tasksNow = useRef(tasks);
  tasksNow.current = tasks;
  useEffect(() => {
    const visible = (id: AppId) => here.current.app === id || here.current.other === id;
    const mark = (id: AppId) => { if (!visible(id)) setChanged((s) => new Set(s).add(id)); };
    const offNotes = window.mobius.notes?.onChanged((c) => {
      if (c.by === 'person' || c.by === 'undo') return;
      if (c.by === 'assistant' && c.path && showBeside('notes')) { void notesNow.current.open(c.path); return; }
      mark('notes');
    });
    const offTasks = window.mobius.tasks?.onChanged((c) => {
      if (c.by === 'person' || c.by === 'undo') return;
      if (c.by === 'assistant' && c.list && showBeside('tasks')) { tasksNow.current.setView({ kind: 'list', name: c.list }); return; }
      mark('tasks');
    });
    const offDesigns = window.mobius.designs?.onChanged((c) => {
      if (c.by === 'person' || c.by === 'undo') return;
      if (c.by === 'assistant' && c.path && showBeside('design')) { void designsNow.current.open(c.path); return; }
      mark('design');
    });
    const offBoards = window.mobius.boards?.onChanged((c) => {
      if (c.by === 'person' || c.by === 'undo') return;
      if (c.by === 'assistant' && c.path && showBeside('canvas')) { void boardsNow.current.open(c.path); return; }
      mark('canvas');
    });
    const offViews = window.mobius.views?.onChanged((c) => {
      if (c.by === 'person' || c.by === 'undo') return;
      if (c.by === 'assistant' && c.path && showBeside('views')) { void viewsNow.current.open(c.path); return; }
      mark('views');
    });
    const offResearch = window.mobius.research?.onChanged((c) => {
      if (c.by === 'person' || c.by === 'undo') return;
      if (c.by === 'assistant' && c.path && showBeside('research')) { void researchNow.current.open(c.path); return; }
      mark('research');
    });
    const offDatabases = window.mobius.databases?.onChanged((c) => {
      if (c.by === 'person' || c.by === 'undo') return;
      if (c.by === 'assistant' && c.name && showBeside('database')) { if (databasesNow.current.open !== c.name) void databasesNow.current.choose(c.name); return; }
      mark('database');
    });
    const offReading = window.mobius.reading?.onChanged((c) => {
      if (c.by === 'person' || c.by === 'undo') return;
      if (c.by === 'assistant' && c.path && showBeside('reader')) { void readingNow.current.open(c.path); return; }
      mark('reader');
    });
    const offDocs = window.mobius.docs?.onChanged((c) => {
      if (c.by === 'person' || c.by === 'undo') return;
      if (c.by === 'assistant' && c.path && showBeside('docs')) { void docsNow.current.open(c.path); return; }
      mark('docs');
    });
    const offSlides = window.mobius.slides?.onChanged((c) => {
      if (c.by === 'person' || c.by === 'undo') return;
      if (c.by === 'assistant' && c.path && showBeside('slides')) { void slidesNow.current.open(c.path); return; }
      mark('slides');
    });
    const offSheets = window.mobius.sheets?.onChanged((c) => {
      if (c.by === 'person' || c.by === 'undo') return;
      if (c.by === 'assistant' && c.workbook && showBeside('sheets')) {
        const { workbook } = c;
        if (sheetsNow.current.data?.workbook !== workbook) void sheetsNow.current.refresh().then((list) => { const first = list.find((w) => w.name === workbook)?.sheets[0]; if (first) void sheetsNow.current.open(workbook, first); });
        return;
      }
      mark('sheets');
    });
    const offMail = window.mobius.mail?.onChanged((c) => {
      if (c.by === 'assistant') { if (!showBeside('mail')) mark('mail'); return; }
      if (c.by === 'another app') mark('mail');
    });
    const offCalendar = window.mobius.calendar?.onChanged((c) => {
      if (c.by === 'person' || c.by === 'undo') return;
      // Beside the chat a week is too narrow to read (titles cut mid-word), so Mobius's changes show on today's Day view.
      if (c.by === 'assistant' && showBeside('calendar')) { calendarNow.current.showDay(new Date()); return; }
      mark('calendar');
    });
    return () => { offNotes?.(); offTasks?.(); offDocs?.(); offSheets?.(); offSlides?.(); offMail?.(); offCalendar?.(); offDesigns?.(); offBoards?.(); offViews?.(); offResearch?.(); offReading?.(); offDatabases?.(); };
  }, [showBeside]);
  // Going to an app leaves Settings (from the launcher, a shortcut or a link), so the app chosen is the one showing.
  // An app not added yet opens its page in Store, where it can be added.
  const openApp = useCallback((id: AppId) => {
    if (isAvailable(id)) { setApp(id); setSettingsOpen(false); }
    else if (findApp(id)?.available) { setExtPlace('apps'); openStoreItem(id); setApp('skills'); setSettingsOpen(false); }
  }, []);
  // However an app was opened (the sidebar, the hub, a shortcut, a pinned item), it goes to the top of Recent.
  useEffect(() => noteOpened(app), [app]);
  const needsYou = conversation.list.reduce((sum, c) => sum + c.waiting, 0);
  const { settings, save: saveSettings, reload: reloadSettings } = useAgentSettings();
  const active = browser.tabs.find((tab) => tab.active);
  // The start page's own title says it is there even where its loading never reports done (WebKitGTK).
  const onStartPage = active !== undefined && active.url === '' && (!active.loading || active.title === 'New tab');
  const saved = active !== undefined && bookmarks.some((b) => b.url === active.url);
  // The open document's open comments go with it to Mobius, so it knows they are there.
  const [docComments, setDocComments] = useState<{ page: string; outline: string }>({ page: '', outline: '' });
  const docsPath = docs.page?.path ?? '';
  const onDocComments = useCallback((comments: NoteComment[]) => {
    const outline = commentsOutline(comments, `docs/${docsPath}`);
    setDocComments((was) => (was.page === docsPath && was.outline === outline ? was : { page: docsPath, outline }));
  }, [docsPath]);
  // Settings covers the app: what the app has open is not on screen, so Mobius neither sees nor attaches it.
  const surface: SurfaceState = settingsOpen ? { app, hasPage: false, note: null, settings: true } : {
    app,
    hasPage: active !== undefined && /^https?:/.test(active.url),
    pages: browser.tabs.filter((t) => /^https?:/.test(t.url)).length,
    note: inNotes && notes.page ? { path: notes.page.path, title: notes.page.title, text: notes.text } : inDocs && docs.page ? { path: docs.page.path, title: liveTitle(docs.text, docs.page.title), text: docs.text, folder: 'docs', ...(docComments.page === docs.page.path && docComments.outline ? { extra: docComments.outline } : {}) } : inSlides && slides.page ? { path: slides.page.path, title: slides.page.title, text: slides.text, folder: 'slides' } : inDesign && designs.page ? { path: designs.page.path, title: designs.page.title, text: designs.text, folder: 'designs' } : inStudio && songs.page ? { path: songs.page.path, title: songs.page.title, text: songs.text, folder: 'studio' } : inCanvas && boards.page ? { path: boards.page.path, title: boards.page.title, text: boards.text, folder: 'boards' } : inViews && views.page ? { path: views.page.path, title: views.page.title, text: views.text, folder: 'views' } : inResearch && research.page && !askingResearch ? { path: research.page.path, title: liveTitle(research.text, research.page.title), text: research.text, folder: 'research' } : inReader && reading.page ? { path: reading.page.path, title: reading.page.title, text: reading.text, folder: 'reading' } : inTerminal && lastTerminal ? { path: lastTerminal.cwd || '~', title: `Terminal: ${lastTerminal.command}`.slice(0, 120), text: `$ ${lastTerminal.command}   (in ~/${lastTerminal.cwd})\n${lastTerminal.result!.output.slice(-20_000)}\n${lastTerminal.result!.passed ? 'Exit code 0' : `Exit code ${lastTerminal.result!.code ?? 'none'}${lastTerminal.result!.timedOut ? ' (stopped: too long)' : ''}`}`, folder: 'terminal' } : inDatabase && databases.open ? { path: `${databases.open}.sqlite`, title: databases.open, text: databaseOutline(databases.open, databases.list.find((d) => d.name === databases.open)?.tables ?? []), folder: 'databases' } : null,
    tasks: inTasks ? tasksContext(tasks) : null,
    chat: inMessages && !chatSpaceSetup && chat.account && chat.channel && !chat.channel.encrypted && chat.messages.length > 0 ? { id: `${chat.account.id}/${chat.channel.id}`, title: channelLabel(chat.channel), item: chatItem(chat.account, chat.channel, chat.messages), catchUp: catchUpAsk(chat.channel, chat.unreadAtOpen) } : null,
    folder: inFiles && files.place.kind === 'folder' && files.place.path !== '' ? files.place.path : null,
    mail: inMail && mail.open ? { id: mail.open.id, title: `Email: ${mail.open.subject || '(no subject)'}`, text: `From: ${mail.open.from.name} <${mail.open.from.email}>\nSubject: ${mail.open.subject}\nDate: ${mail.open.dateMs ? new Date(mail.open.dateMs).toString() : ''}\n\n${mail.open.text}` } : null,
    cut: inVideo && video.project ? { title: `Video: ${video.project}`, source: `video/${video.project}/cut.json`, text: `Clips in video/${video.project}/ (never change them):\n${video.clips.map((c) => `- ${c.name}${c.kind === 'audio' ? ' (sound)' : ''}: ${video.lengthOf(c.name) ?? '?'} s`).join('\n') || '(none yet)'}\n\nThe cut, video/${video.project}/cut.json:\n${writeCut(video.cut)}` } : null,
    album: inPhoto && (photos.browsing || !photos.open) && photos.album && photos.album !== RECENTLY_DELETED ? { name: photos.album, photos: photos.albums.find((x) => x.name === photos.album)?.photos.length ?? 0, sheet: () => albumSheet(photos.read, photos.albums.find((x) => x.name === photos.album)?.photos ?? []) } : null,
    // Only a photo open in the editor goes along: the grid of an album attaches none, though one was open before.
    photo: inPhoto && photos.open && !photos.browsing ? { title: `Photo: ${photos.open.path}`, source: `photos/${editsPathFor(photos.open.path)}`, picture: photos.open.dataUrl, text: `The photo: ${photos.described}\nThe picture itself is attached when your model reads pictures. Change only its edits file, photos/${editsPathFor(photos.open.path)}, keeping the format below.\n\n${JSON.stringify(photos.edits, null, 1)}` } : null,
    code: inCode && code.open && code.project && code.open.text !== null ? { title: `${code.project} › ${code.open.path}`, source: `code/${code.project}/${code.open.path}`, text: `${code.draft}${code.tests.last && !code.tests.last.passed ? `\n\n--- Last test run (${code.tests.command ?? ''}) failed:\n${code.tests.last.output.slice(-4000)}` : ''}`, failing: code.tests.last !== null && !code.tests.last.passed } : null,
    sheet: inSheets && sheets.data ? { title: `${sheets.data.workbook} › ${sheets.data.sheet}`, source: `sheets/${sheets.data.workbook}/${sheets.data.sheet}.csv`, text: sheetContext(sheets.data) } : null,
  };
  // I'll Drive: a proposed plan's steps become a task list of their own, named after the conversation, shown beside it.
  const driveTasks = useCallback(async (steps: string[]) => {
    const title = conversation.list.find((c) => c.id === conversation.id)?.title?.trim() || 'Plan';
    const list = await tasks.createList(title.slice(0, 60));
    if (!list) return 'The task list could not be made.';
    for (const step of steps) {
      if (!(await tasks.add(list, step, null))) return 'Not every step could be added to Tasks.';
    }
    // Beside the conversation in the Agent app; elsewhere Tasks opens, with the agent panel still at hand.
    if (!showBeside('tasks')) openApp('tasks');
    return null;
  }, [conversation.list, conversation.id, tasks, showBeside, openApp]);
  // The print in the menu bar or notification area follows what the agent is doing, even with the window away.
  // "Done" shows when work ended while the window was in the background, until you come back to it.
  const [finishedAway, setFinishedAway] = useState(false);
  const wasWorking = useRef(false);
  useEffect(() => {
    const working = conversation.list.some((c) => c.activity !== 'idle');
    if (wasWorking.current && !working && !document.hasFocus()) setFinishedAway(true);
    wasWorking.current = working;
  }, [conversation.list]);
  useEffect(() => {
    const back = () => setFinishedAway(false);
    window.addEventListener('focus', back);
    return () => window.removeEventListener('focus', back);
  }, []);
  const trayNow = trayShown(conversation.list, finishedAway);
  const trayKey = JSON.stringify(trayNow);
  useEffect(() => { void window.mobius.tray?.set(JSON.parse(trayKey) as TrayShown).catch(() => undefined); }, [trayKey]);
  const selectConversation = conversation.select;
  useEffect(() => window.mobius.tray?.onOpenConversation((id) => { openApp('agent'); selectConversation(id); }), [openApp, selectConversation]);
  const workingNow = useRef<string[]>([]);
  workingNow.current = conversation.list.filter((c) => c.activity === 'working').map((c) => c.id);
  useEffect(() => window.mobius.tray?.onStopAll(() => { for (const id of workingNow.current) void window.mobius.agent.cancel(id); }), []);
  // Quitting: write what is still being typed first, then let Mobius go (it waits up to 3 s for this).
  useEffect(() => window.mobius.tray?.onQuitting(() => { void saveAll().finally(() => void window.mobius.tray?.savedForQuit().catch(() => undefined)); }), []);
  const activity = activityOf(conversation.state);
  const callsDone = useMemo(() => conversation.state.items.filter((item) => item.kind === 'tool' && item.status === 'done').length, [conversation.state.items]);
  const marksReading = useRef(false);
  const turnMarks = useTurnChanges(conversation.state.conversation, conversation.state.busy, callsDone, marksReading);
  // Tasks, Calendar and Sheets draw the running turn's changes as each call lands; the other apps when the turn ends.
  // Notes and Docs (marked): a folder Files syncs with a drive shows the sync glyph after its name.
  const syncedIn = (app: string) => (folder: string) => {
    const pair = pairFor(files.sync.pairs, `${app}/${folder}`);
    return pair ? <SyncGlyph line={files.sync.line(pair)} drive={files.sync.driveName(pair.drive)} /> : null;
  };
  const liveMarks = useLiveMarks(conversation.state.conversation, conversation.state.busy, turnMarks);
  /** The views Mobius changed in its last turn and that wait for Keep. */
  const viewMarks = useMemo(() => new Set(turnMarks.files.filter((f) => f.startsWith('views/')).map((f) => f.slice('views/'.length))), [turnMarks.files]);
  // An app Mobius changed things in loads, so its changes show there when the turn ends, even if it was never opened.
  useEffect(() => {
    const touched: AppId[] = [];
    const add = (id: AppId, set: ReadonlySet<string>) => { if (set.size > 0) touched.push(id); };
    add('slides', turnMarks.slides); add('design', turnMarks.designs); add('canvas', turnMarks.boards); add('research', turnMarks.research);
    add('reader', turnMarks.reading); add('database', turnMarks.databases); add('photo', turnMarks.photos); add('studio', turnMarks.songs);
    add('video', turnMarks.video); add('sheets', turnMarks.sheets); add('code', turnMarks.code); add('views', viewMarks);
    if (touched.length > 0) setOpened((was) => (touched.every((id) => was.has(id)) ? was : new Set([...was, ...touched])));
  }, [turnMarks, viewMarks]);
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
  const place = settingsOpen ? 'Settings' : inProjects && projects.open ? projects.open.name : inBrowser ? (active?.title || appName(app)) : inActivity ? 'Activity' : inChanges ? 'Changes' : inAgents ? (agentView?.kind === 'new' ? 'New agent' : shownAgent?.name ?? 'Agents') : inAgent ? (conversation.list.find((c) => c.id === conversation.id)?.title || (projects.list.some((p) => p.threads.includes(conversation.id)) ? `New thread in ${projects.list.find((p) => p.threads.includes(conversation.id))!.name}` : '' /* Home's start page: the Go button already says Home. */)) : inNotes ? appName(app) /* Notes (marked, panel look): its notebook in grey beside it; the page's title is its first line */ : inDocs ? appName(app) /* Docs (marked, panel look): the document's title in grey beside it */ : inSlides && slides.page ? (slides.page.title || appName(app)) : inSheets && sheets.data ? sheets.data.workbook : inSkills && skills.open ? `/${skills.open.name}` : inSkills ? abilitiesTitle(extPlace === 'apps' ? storeItemOpen : null) : inVideo && video.project ? video.project : inStudio && songs.page ? songs.page.title : inPhoto && photos.browsing ? (photos.album === RECENTLY_DELETED ? 'Recently Deleted' : photos.album ?? appName(app)) : inPhoto && photos.open ? (photos.open.path.split('/').pop() ?? appName(app)) : inDesign && designs.page ? designs.page.title : inCanvas && boards.page ? boards.page.title : inViews && views.page ? views.page.title : inResearch && research.page && !askingResearch ? liveTitle(research.text, research.page.title || appName(app)) : inReader && reading.page ? (reading.page.title || appName(app)) : inDatabase && databases.open ? databasePlace(databases) : inTerminal ? (terminal.cwd ? `~/${terminal.cwd}` : 'Terminal') : inCode ? (code.open?.path.split('/').pop() ?? code.project ?? appName(app)) : inMail ? (mail.accounts.length === 0 ? 'Inbox' /* no account: no split to name yet */ : mailPlace(mail.view)) : inMessages ? (chatSpaceSetup ? 'Mobius space' : chat.channel ? channelLabel(chat.channel) : '') /* Messages: the open conversation */ : inTasks ? appName(app) /* Tasks: the list is in grey beside it */ : inCalendar ? appName(app) /* Calendar: its range is in grey beside it */ : inFiles ? filesTitle(files) /* Files: the open folder */ : inWiki ? (wikiPlace.kind === 'mine' ? 'How I work' : wikiPlace.kind === 'shared' ? 'Suggested changes' : wiki.page ? liveTitle(wiki.text, wiki.page.title || appName(app)) : appName(app)): inBrowser ? appName(app) : '';
  // A list counts its tasks as it shows them: subtasks sit under their task and are not counted on their own.
  const tasksHere = inTasks ? (tasks.view.kind === 'list' ? nest(tasks.all[tasks.view.name] ?? []).map((n) => n.task) : smartView(tasks.view.id, tasks.all, new Date()).map((x) => x.task)) : [];
  const tasksOpen = tasksHere.filter((t) => !t.done).length;
  const tasksDone = tasksHere.length - tasksOpen;
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  // A count under an app in the hub, or nothing when there are none ("0 workbooks" says less than a blank line).
  const some = (n: number, one: string, after = '') => (n === 0 ? '' : plural(n, one) + after);
  const dueToday = smartView('today', tasks.all, new Date()).length;
  const openTasks = tasks.lists.reduce((sum, l) => sum + l.open, 0);
  const pages = notes.notebooks.reduce((sum, nb) => sum + nb.pages.length, 0);
  const eventsToday = eventsOn(calendar.events, new Date()).length;
  const hubStatus: Partial<Record<AppId, string>> = {
    agent: activity ? activity.label : needsYou > 0 ? `${needsYou} waiting for you` : some(conversation.list.length, 'conversation'),
    browser: some(browser.tabs.length, 'tab', ' open'),
    notes: some(pages, 'page'),
    docs: some(docs.notebooks.reduce((sum, nb) => sum + nb.pages.length, 0), 'document'),
    sheets: some(sheets.workbooks.length, 'workbook'),
    slides: some(slides.notebooks.reduce((sum, nb) => sum + nb.pages.length, 0), 'deck'),
    code: some(code.projects.length, 'project'),
    video: some(video.projects.length, 'project'),
    skills: some(skills.list.length, 'skill'),
    studio: some(songs.notebooks.reduce((sum, nb) => sum + nb.pages.length, 0), 'song'),
    photo: some(photos.albums.reduce((sum, a) => sum + a.photos.length, 0), 'photo'),
    design: some(designs.notebooks.reduce((sum, nb) => sum + nb.pages.length, 0), 'design'),
    canvas: some(boards.notebooks.reduce((sum, nb) => sum + nb.pages.length, 0), 'board'),
    views: some(views.notebooks.reduce((sum, nb) => sum + nb.pages.length, 0), 'view'),
    database: some(databases.list.length, 'database'),
    terminal: terminal.processes.some((p) => p.running) ? `${plural(terminal.processes.filter((p) => p.running).length, 'command')} running` : 'Your workspace',
    research: some(research.notebooks.reduce((sum, nb) => sum + nb.pages.length, 0), 'report'),
    reader: some(reading.notebooks.filter((nb) => nb.name !== 'Archive').reduce((sum, nb) => sum + nb.pages.length, 0), 'article', ' to read'),
    mail: mail.accounts.length === 0 ? 'Add an account' : mail.counts.all > 0 ? `${mail.counts.all} unread` : 'All read',
    tasks: dueToday > 0 ? `${dueToday} due today` : openTasks > 0 ? `${openTasks} to do` : 'All done',
    calendar: eventsToday > 0 ? `${plural(eventsToday, 'event')} today` : 'Nothing today',
  };
  const startedUp = useRef(false);
  // Mobius sits in the right panel, beside the work, in every app (docs/design: five zones). The sidebar is always the
  // app's own; it no longer turns into Mobius.
  const [chatOpen, setChatOpen] = useState(false);
  // Browser (marked, panel look): Mobius closes on going to the Browser, so the page has the room, and comes back as it
  // was on leaving. A window that opens on a page (a link from outside) keeps Mobius as the start-up choice says.
  const chatBeforeBrowser = useRef<boolean | null>(null);
  const chatOpenNow = useRef(chatOpen);
  chatOpenNow.current = chatOpen;
  const firstApp = useRef(true);
  useEffect(() => {
    if (firstApp.current) { firstApp.current = false; return; }
    // Browser and Store (a place, marked) open with Mobius closed; it comes back as it was on leaving.
    if (app === 'browser' || app === 'reader' || app === 'skills') { if (chatBeforeBrowser.current === null) { chatBeforeBrowser.current = chatOpenNow.current; setChatOpen(false); } }
    else if (chatBeforeBrowser.current !== null) { if (chatBeforeBrowser.current) setChatOpen(true); chatBeforeBrowser.current = null; }
  }, [app]);
  // Learn (shell/learn-view): lessons beside the page, in the slot Mobius uses when pinned beside. One at a time.
  const [learnOpen, setLearnOpen] = useState(false);
  const learnFrom = useRef<HTMLElement | null>(null);
  const [focusToken, setFocusToken] = useState(0);
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const address = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  // Where the sidebars sit and how wide they are. A floating one hides until asked for, and draws over the window.
  // Each own-list app's panel, made once: its body is drawn from the latest render through the ref.
  const ownListRef = useRef<(id: AppId) => ReactNode>(() => null);
  // Activity's list filters its page (which is the region named Activity), so the panel is named for that.
  const homeListName = sideMode === 'activity' ? 'Filter' : sideMode === 'bots' ? 'Agents' : sideMode === 'changes' ? 'Changes' : 'Chats';
  // Mail (marked): below about 1200px wide, Mailboxes starts hidden so the list and the message keep their room; the
  // Panels menu (or the top bar) brings it back, and a choice made there is kept.
  const roomy = useWideWindow(1200);
  // Every other app's list does the same while Mobius is docked beside it, so the page keeps a readable column (at
  // 1024 wide, Notes had about 370px). Home is the chat itself and keeps its list. A choice made in the Panels menu is
  // kept, as for Mail.
  const mobiusDocked = chatOpen && appearance.value.rightSidebar !== 'floating';
  // The Browser in half the window (beside Code's preview, say) starts without its tabs, so the page has the pane's room;
  // the Panels menu brings them back, and that choice is kept.
  const listShown = (id: string): boolean => (id === 'agent' ? true : id === 'browser' && split ? false : id === 'mail' || id === 'calendar' ? roomy : roomy || !mobiusDocked);
  const ownListPanels = useMemo(() => Object.fromEntries(Object.entries(OWN_LIST).map(([id, name]) => [id, [
    { id: 'list', name: id === 'agent' ? homeListName : name, dock: 'left', shown: listShown(id), render: () => ownListRef.current(id as AppId) },
  ] satisfies PanelSpec[]])) as Partial<Record<AppId, PanelSpec[]>>, [homeListName, roomy, mobiusDocked, split]); // eslint-disable-line react-hooks/exhaustive-deps
  // The agent panel sits beside the Browser and Notes; the Agent app is the conversation itself.
  // With the Agent app open in a pane, the conversation is already on screen.
  const hasRight = (inBrowser || inMail || inMessages || inCode || inDesign || inCanvas || inViews || inResearch || inReader || inDatabase || inTerminal || inFiles || inWiki || inProjects || inPhoto || inStudio || inVideo || inSkills || inNotes || inDocs || inSheets || inSlides || inTasks || inCalendar) && !shows('agent')
    || ((inActivity || inChanges) && !split); // Activity and Changes (marked): its page fills the stage, so Mobius sits beside it as in every app
  const rightFloating = appearance.value.rightSidebar === 'floating';
  const rightOpen = hasRight && chatOpen && !learnOpen;
  useEffect(() => { if (rightOpen && miniOpen) void window.mobius.mini.close(); }, [rightOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  // Learn (shell/learn-view): Mobius opening beside the page takes the slot back from Learn.
  useEffect(() => { if (learnOpen && chatOpen && hasRight) setLearnOpen(false); }, [chatOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  const [drag, setDrag] = useState<{ side: Side; width: number } | null>(null);
  const [hovering, setHovering] = useState(false);
  // A narrow window draws the docks narrower than saved, so the content keeps room for its toolbar (dock-fit.ts).
  const windowWidth = useWindowWidth();
  const fitted = fitDocks(windowWidth, appearance.value.rightWidth, (!rightFloating && rightOpen) || learnOpen);
  const rightWidth = drag?.side === 'right' ? drag.width : fitted.right;
  const rightDock = useRef<HTMLDivElement>(null);
  // Mobius beside the page goes back toward where it is asked from (its corner) before it is put away.
  // An app opened from the switcher, All apps or the launcher settles out of the tile or row that was clicked; one
  // opened from the keyboard only lifts out of a dim (switchIn).
  // Settings opening or closing is a change of place too.
  const shownApp = useRef(`${app}|${settingsOpen}`);
  useLayoutEffect(() => {
    const now = `${app}|${settingsOpen}`;
    if (shownApp.current === now) return;
    shownApp.current = now;
    const stage = document.querySelector<HTMLElement>('.stage');
    if (stage) switchIn(stage);
  }, [app, settingsOpen]);
  // Shown again while it was on its way out (a shortcut, Mobius in the sidebar), it stays: a hide
  // still finishing would otherwise close it, since chatOpen never went false and the effect below does not run.
  const hides = useRef(0);
  const hideRight = useCallback(() => { const mine = ++hides.current; void morphOut(document.querySelector<HTMLElement>('.dock.right > .chat'), 'right').then(() => { if (hides.current === mine) setChatOpen(false); }); }, []);
  // Mobius's own apps: Agents and Activity (views of the Agent app), Abilities, and Settings.
  const ownApps: OwnApp[] = [
            { id: 'bots', name: 'Agents', current: !settingsOpen && app === 'agent' && sideMode === 'bots', run: () => { closeSettings(); setSideMode('bots'); openApp('agent'); } },
            { id: 'activity', name: 'Activity', current: !settingsOpen && app === 'agent' && sideMode === 'activity', run: () => { closeSettings(); setSideMode('activity'); openApp('agent'); } },
            { id: 'changes', name: 'Changes', current: !settingsOpen && app === 'agent' && sideMode === 'changes', run: () => { closeSettings(); setSideMode('changes'); openApp('agent'); } },
            { id: 'extensions', name: 'Store', current: !settingsOpen && app === 'skills', run: () => { closeSettings(); openApp('skills'); } },
            { id: 'settings', name: 'Settings', current: settingsOpen, run: () => (settingsOpen ? closeSettings() : openSettings()) },
  ];
  const ownApp = (id: OwnApp['id']) => () => ownApps.find((o) => o.id === id)?.run();
  // What waits, per app, for the launcher's dots and the Go button's: answers Mobius needs, and apps it changed.
  const waiting: Partial<Record<AppId, number>> = { ...Object.fromEntries([...changed].map((id) => [id, 1])), ...(needsYou > 0 ? { agent: needsYou } : {}) };
  // The empty launcher's home: what waits for an answer, and the named agents at work now.
  const launcherHome = launcherOpen ? {
    waiting: [
      ...conversation.list.filter((c) => c.waiting > 0).map((c) => ({ id: c.id, label: c.title || 'Untitled chat', detail: 'Needs your answer', app: 'agent' as AppId, run: () => { conversation.select(c.id); launch.openMobius(); } })),
      ...[...changed].map((a) => ({ id: `changed-${a}`, label: `Changes in ${appName(a)}`, detail: 'Not kept yet', app: a, run: () => launch.openApp(a) })),
    ],
    agents: conversation.list.filter((c) => c.activity === 'working' && botOfConversation(c.id, botIds) !== MAIN_BOT_ID).map((c) => {
      const bot = bots.bots.find((b) => b.id === botOfConversation(c.id, botIds));
      return { id: c.id, name: bot?.name ?? 'Agent', state: 'working' as const, detail: c.title || undefined, run: () => { closeSettings(); conversation.select(c.id); setSideMode('bots'); openApp('agent'); } };
    }),
  } : undefined;
  const waitingTotal = Object.values(waiting).reduce((sum, n) => sum + (n ?? 0), 0);
  // The Mobius button (toolbar): show or hide Mobius beside the work.
  // An app bringing one of its panel tabs forward (useShowPanelTab) opens the right panel without moving focus.
  const openRight = useCallback(() => { hides.current += 1; setLearnOpen(false); setChatOpen(true); }, []);
  // A step waiting for the person's answer brings Mobius in front of an app's panel tab too (kept until the next one,
  // so answering it does not move the panel again).
  const waitingNow = conversation.state.items.filter((item) => 'status' in item && item.status === 'waiting').map((item) => ('requestId' in item ? String(item.requestId) : '?')).join(',');
  const lastWaiting = useRef('');
  if (waitingNow) lastWaiting.current = waitingNow;
  // What the message box sends. "In the background": the panel steps aside while Mobius works, and the result lands
  // in Home's Inbox, so the person carries on with their own work.
  // Research mode: the question becomes a Doc in Docs' Research folder, opened beside Mobius, which fills it with a
  // cited report from the web.
  const startResearch = async (question: string, items: ContextItem[], options: SendOptions) => {
    const title = titleFor(question);
    openApp('docs');
    const book = docs.notebooks.find((n) => n.name === RESEARCH_FOLDER)?.name ?? (await docs.createNotebook(RESEARCH_FOLDER));
    const path = book ? await docs.createPage(book, title, startingPage(question)) : null;
    if (!path) { setToast('Mobius could not make the report’s document.'); return; }
    // Mobius beside the report: its approvals (searches, pages to read) are where they can be answered. Opened whatever
    // was showing before, as Home (where the Agent page is Mobius) gives way to Docs, and not put back as it was when
    // leaving the Browser (that would close it again on the way to Docs).
    chatBeforeBrowser.current = null;
    setChatOpen(true);
    // One report per question: the next message goes back to Agent (Research is chosen again for another).
    setChatMode('agent');
    void conversation.send(researchPrompt(question, 'thorough', `docs/${path}`, 'doc'), items, Object.keys(options).length > 0 ? options : undefined);
  };
  const sendAsked = (text: string, items: ContextItem[], options?: SendOptions) => {
    const { background: away, research: researching, ...rest } = options ?? {};
    if (researching && text.trim()) { void startResearch(text.trim(), items, rest); return; }
    if (away) {
      handoffs.start(conversation.state.conversation, (text.trim().split('\n')[0] ?? '').slice(0, 80) || 'Background task');
      if (rightOpen && app !== 'agent') {
        hideRight();
        // The focus goes to the pill that now says what Mobius is doing, not to the page.
        setTimeout(() => document.querySelector<HTMLElement>('.working-pill-open')?.focus(), 400);
      }
    }
    void conversation.send(expandSlash(text, skills.names), items, Object.keys(rest).length > 0 ? rest : undefined);
  };
  const toggleMobius = () => { if (rightOpen) { hideRight(); } else { hides.current += 1; setLearnOpen(false); setChatOpen(true); setFocusToken((n) => n + 1); } };
  // Ctrl+Shift+M (Cmd on macOS) shows and hides Mobius beside the work, as its button does.
  const mobiusKey = useRef<(() => void) | null>(null);
  mobiusKey.current = hasRight ? toggleMobius : null;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !mobiusKey.current || !pressIs(MOBIUS_KEYS, event, window.mobius.platform === 'darwin')) return;
      event.preventDefault();
      mobiusKey.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => { if (chatOpen) hides.current += 1; }, [chatOpen]);
  const rightFromEdge = useRef(false);
  // The floating agent panel came out because the pointer reached the edge (not the toolbar button or a shortcut).
  const [peeked, setPeeked] = useState(false);
  useEffect(() => { if (!chatOpen) setPeeked(false); }, [chatOpen]);
  // Comments: on anything in the open document, in comment mode (the button, or C).
  const [commenting, setCommenting] = useState(false);
  const [commentFocus, setCommentFocus] = useState<string | null>(null);
  // Notes (marked): Move checked items to the bottom, in the Notes menu.
  const [checkedLastOn, setCheckedLastOn] = useState(checkedLast);
  const [notesSort, setNotesSort] = useState<NoteSort>(noteSort);
  const commentDoc = inSheets && sheets.data ? `${sheets.data.workbook}/${sheets.data.sheet}` : inMail && mail.open ? mail.open.id : inNotes && notes.page ? notes.page.path : inDocs && docs.page ? docs.page.path : inTasks ? (tasks.view.kind === 'list' ? tasks.view.name : tasks.view.id) : inCalendar ? 'calendar' : inBrowser ? (active?.url ?? null) : place || appName(app);
  const commentThreads = useCommentThreads(app, commentDoc);
  const openComments = useOpenComments(app);
  const openSuggestions = useSuggestions(app);
  useEffect(() => { setCommenting(false); }, [app]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'c' || event.ctrlKey || event.metaKey || event.altKey) return;
      if (shellStandsDown(event)) return;
      const t = event.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (document.querySelector('dialog[open]:not([data-leaving])')) return;
      event.preventDefault();
      setCommenting((on) => !on);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useMorphIn(rightDock, rightOpen);
  useAutoHide(rightFloating, rightOpen, hideRight, rightDock, rightFromEdge);
  // Switching to floating while the pointer and keyboard are elsewhere puts the sidebar away.
  const wasFloating = useRef(rightFloating);
  useEffect(() => {
    const dock = rightDock.current;
    if (!wasFloating.current && rightFloating && (!dock || (!dock.matches(':hover') && !dock.contains(document.activeElement)))) setChatOpen(false);
    wasFloating.current = rightFloating;
  }, [rightFloating]);
  const resizer = (side: Side, label: string) => (
    <Resizer side={side} width={rightWidth} label={label} onHover={setHovering}
      onDrag={(width) => setDrag(width === null ? null : { side, width })}
      onCommit={(width) => void appearance.set({ rightWidth: width })} />
  );
  // The native page is drawn above everything in the window. To draw over it, put a picture of it in its place first.
  const floatingShown = rightFloating && rightOpen;
  // The selection menu drops over the page, so the page's picture stands in for it while the menu is open.
  const [selectionMenu, setSelectionMenu] = useState(false);
  // A menu from the toolbar is open: the web page shows as a picture under it, as under the other menus.
  const [menuOpen, setMenuOpen] = useState(false);
  // Browser: the address bar's suggestions are open, so the page is covered by a picture of it.
  const [addressSuggesting, setAddressSuggesting] = useState(false);
  // A menu over the page puts the page away at once, not when its picture arrives: a slow picture left a toolbar menu
  // drawn under the page, cut off at its top edge. Hovers and drags wait for the picture, so the page never flashes.
  // Any menu (Panels, an app's own, a row's) is open: the page steps aside, as it does for the menu bar.
  const anyMenu = useAnyMenuOpen();
  const needCover = shows('browser') && (floatingShown || drag !== null || hovering || splitDrag !== null || selectionMenu || menuOpen || anyMenu || addressSuggesting);
  const [cover, setCover] = useState<{ url: string | null } | null>(null);
  const menuOverPage = shows('browser') && (menuOpen || anyMenu || selectionMenu || addressSuggesting);
  useEffect(() => {
    if (!needCover) { setCover(null); return undefined; }
    let live = true;
    void window.mobius.browser.snapshot().then((url) => { if (live) setCover({ url }); });
    return () => { live = false; };
  }, [needCover]);
  const rightAttached = (!rightFloating && rightOpen) || learnOpen;
  const layout = {
    '--col-right': rightAttached ? `${rightWidth}px` : '0px',
    '--pad-right': rightAttached ? '0px' : '8px',
    '--right-w': `${rightWidth}px`,
  } as React.CSSProperties;

  // The launcher's key pressed again while it is open switches it between its start and All apps.
  const [launcherAgain, setLauncherAgain] = useState(0);
  const [launcherAbout, setLauncherAbout] = useState<LauncherAbout | undefined>(undefined);
  const clipboardHistory = useClipboardHistory();
  const systemSearch = useSystemSearch(launcherOpen);
  const launcherShown = useRef(launcherOpen);
  launcherShown.current = launcherOpen;
  const openLauncher = useCallback(() => {
    if (launcherShown.current) { setLauncherAgain((n) => n + 1); return; }
    opener.current = document.activeElement as HTMLElement | null;
    // About this: what is selected in the open app goes with the launcher, for its AI commands.
    setLauncherAbout(selectionNow());
    setLauncherOpen(true);
  }, []);
  // Ctrl+O in Notes: the launcher, narrowed to Notes.
  const [launcherScope, setLauncherScope] = useState<{ app: AppId; n: number } | undefined>(undefined);
  const openLauncherIn = useCallback((scopeApp: AppId) => {
    setLauncherScope((s) => ({ app: scopeApp, n: (s?.n ?? 0) + 1 }));
    if (launcherShown.current) return;
    opener.current = document.activeElement as HTMLElement | null;
    setLauncherAbout(undefined);
    setLauncherOpen(true);
  }, []);
  const [hubOpen, setHubOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<'advanced' | 'layout' | 'profiles' | 'keyboard' | 'about' | 'schedules' | 'voice' | 'safety' | 'mail' | 'calendar' | 'messages' | 'browser' | undefined>(undefined);
  const [taskFocus, setTaskFocus] = useState(0);
  const openHub = useCallback(() => { opener.current = document.activeElement as HTMLElement | null; setHubOpen(true); }, []);
  const closeHub = useCallback((restore = true) => { setHubOpen(false); if (restore) queueMicrotask(() => opener.current?.focus?.()); }, []);
  const closeLauncher = useCallback(() => {
    setLauncherOpen(false);
    queueMicrotask(() => opener.current?.focus?.());
  }, []);
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  /** A web page in the browser: the tab it is already open in, or a new one. */
  const showPage = (url: string) => {
    openApp('browser');
    const tab = browser.tabs.find((t) => sameUrl(t.url, url));
    if (tab) window.mobius.browser.activate(tab.id); else void window.mobius.browser.open(url);
  };
  // A web link clicked in an app (Notes): shown in its tab, or a new one; in the background with Ctrl.
  const showPageNow = useRef(showPage);
  showPageNow.current = showPage;
  const tabsNow = useRef(browser.tabs);
  tabsNow.current = browser.tabs;
  useEffect(() => {
    const on = (event: Event) => {
      const { url, background } = (event as CustomEvent<WebLink>).detail;
      if (!background) { showPageNow.current(url); return; }
      if (!tabsNow.current.some((t) => sameUrl(t.url, url))) void window.mobius.browser.open(url);
    };
    window.addEventListener(WEB_LINK_EVENT, on);
    return () => window.removeEventListener(WEB_LINK_EVENT, on);
  }, []);
  // Open beside (beside.ts): an app shows the Browser in the other pane at a page (Code's preview), keeping the keyboard.
  useEffect(() => {
    const on = (event: Event) => {
      const what = (event as CustomEvent<Beside>).detail;
      if (what?.app !== 'browser' || !besideUrlOk(what.url)) return;
      const { panes: [a, b], focused: f } = panesNow.current;
      const here = f === 1 && b !== null ? b : a;
      if (here !== 'browser') {
        splitByMobius.current = false;
        saveByMobius(false);
        setPanes(f === 1 && b !== null ? ['browser', b] : [a, 'browser']);
      }
      const tab = tabsNow.current.find((t) => sameUrl(t.url, what.url));
      if (tab) window.mobius.browser.activate(tab.id); else void window.mobius.browser.open(what.url);
    };
    window.addEventListener(BESIDE_EVENT, on);
    return () => window.removeEventListener(BESIDE_EVENT, on);
  }, []);
  /** Open something found in Search in the app it belongs to. */
  /** A file Mobius changed, opened in its app (from Review). */
  const openChangedFile = (path: string) => {
    const [top, ...rest] = path.split('/');
    const inner = rest.join('/');
    const title = (rest.at(-1) ?? '').replace(/\.(md|json|csv|sqlite)$/i, '');
    if (top === 'views') { openApp('views'); void views.open(inner, title); }
    else if (top === 'notes' || top === 'docs' || top === 'slides' || top === 'designs' || top === 'boards' || top === 'research' || top === 'reading' || top === 'studio') {
      const app = ({ notes: 'notes', docs: 'docs', slides: 'slides', designs: 'design', boards: 'canvas', research: 'research', reading: 'reader', studio: 'studio' } as const)[top];
      openTarget({ app, path: inner, title });
    } else if (top === 'sheets') openTarget({ app: 'sheets', workbook: rest[0] ?? '', sheet: title });
    else if (top === 'tasks') openTarget({ app: 'tasks', list: title });
    else if (top === 'photos') openTarget({ app: 'photo', path: inner.replace(/\.edits\.json$/i, '') });
    else if (top === 'video') openTarget({ app: 'video', project: rest[0] ?? '' });
    else if (top === 'databases') openTarget({ app: 'database', name: title });
    else if (top === 'code') { openApp('code'); void code.openProject(rest[0] ?? '', rest.slice(1).join('/') || null); }
    else if (top === 'skills') { openApp('skills'); setExtPlace('skills'); void skills.openSkill(rest[0] ?? ''); }
    else if (top === 'calendar') openApp('calendar');
    // A saved web page opens as a Browser tab the agent may read, being the person's own file.
    else if (top === 'pages' && /\.html?$/i.test(path)) { openApp('browser'); void window.mobius.browser.openPage?.(path); }
  };
  const openTarget = (target: HubTarget, label?: string) => {
    // Kept for the launcher's Recent, which opens it again the same way (targetOfRef).
    const recentApp = targetApp(target);
    const name = label ?? (target.app === 'agent' ? conversation.list.find((c) => c.id === target.conversation)?.title ?? '' : targetLabel(target));
    if (recentApp) noteRecentItem({ app: recentApp, ref: JSON.stringify(target), label: name });
    if (target.app === 'agent') { conversation.select(target.conversation); openApp('agent'); }
    else if (target.app === 'notes') { openApp('notes'); void notes.open(target.path, target.title); }
    else if (target.app === 'docs') { openApp('docs'); void docs.open(target.path, target.title); }
    else if (target.app === 'slides') { openApp('slides'); void slides.open(target.path, target.title); }
    else if (target.app === 'sheets') { openApp('sheets'); void sheets.open(target.workbook, target.sheet); }
    else if (target.app === 'mail') { openApp('mail'); mail.setView({ kind: 'box', box: target.id.split('/')[1] === 'sent' ? 'sent' : 'inbox', category: 'all' }); void mail.read(target.id); }
    else if (target.app === 'tasks') { tasks.setView({ kind: 'list', name: target.list }); openApp('tasks'); if (target.task) focusTaskRow(target.task); }
    else if (target.app === 'design') { openApp('design'); void designs.open(target.path, target.title); }
    else if (target.app === 'canvas') { openApp('canvas'); void boards.open(target.path, target.title); }
    else if (target.app === 'database') { openApp('database'); void databases.choose(target.name); }
    else if (target.app === 'reader') { openApp('reader'); void reading.open(target.path, target.title); }
    else if (target.app === 'research') { setAskingResearch(false); openApp('research'); void research.open(target.path, target.title); }
    else if (target.app === 'studio') { openApp('studio'); void songs.open(target.path, target.title); }
    else if (target.app === 'photo') { openApp('photo'); void photos.openPhoto(target.path); }
    else if (target.app === 'video') { openApp('video'); void video.open(target.project); }
    else if (target.app === 'code') { openApp('code'); void code.openProject(target.project); }
    else if (target.app === 'calendar') { openApp('calendar'); if (target.date) { const day = new Date(`${target.date}T12:00:00`); if (!Number.isNaN(day.getTime())) calendar.setAnchor(day); if (target.event) { const id = target.event, date = target.date; setShowEvent((was) => ({ id, date, n: (was?.n ?? 0) + 1 })); } } }
    else if (target.app === 'open') openApp(target.id);
    else showPage(target.url);
  };
  /** What the launcher finds in as you type: the same things Search lists, by name. */
  const launcherSources = (): LauncherSources => ({
    conversations: conversation.list, notebooks: notes.notebooks, tasks: tasks.all, docFolders: docs.notebooks, deckFolders: slides.notebooks, workbooks: sheets.workbooks,
    designFolders: designs.notebooks, boardFolders: boards.notebooks, researchFolders: research.notebooks, readingFolders: reading.notebooks, databases: databases.list.map((d) => ({ name: d.name, modified: d.modified })),
    songFolders: songs.notebooks, albums: photos.albums, videoProjects: video.projects.map((p) => p.name), codeProjects: code.projects.map((p) => ({ name: p.name, modified: (p as { modified?: number }).modified ?? 0 })),
  });
  // An app opened while the last turn's changes in it wait for Keep opens on them (once for each set of changes).
  const openedOnChanges = useRef(new Set<string>());
  const openTargetNow = useRef(openTarget);
  openTargetNow.current = openTarget;
  useEffect(() => {
    if (conversation.state.busy) return;
    const showing: Partial<Record<AppId, boolean>> = {
      notes: !!notes.page && turnMarks.notes.has(notes.page.path),
      docs: !!docs.page && turnMarks.docs.has(docs.page.path),
      slides: !!slides.page && liveMarks.slides.has(slides.page.path),
      sheets: !!sheets.data && turnMarks.sheets.has(sheets.data.workbook),
      tasks: tasks.view.kind === 'list' && turnMarks.lists.has(tasks.view.name),
    };
    // Only apps that can tell whether a change is already on screen. Any other (Code reopening its whole project) would
    // reload what is open in the middle of its review and lose the change being shown.
    const now = showing[app];
    if (now === undefined) return;
    const target = openOnChanges(app, turnMarks.files, now, openedOnChanges.current);
    if (target) openTargetNow.current(target);
    // Only on coming to an app or when a turn's changes arrive, not as its item changes.
  }, [app, turnMarks, conversation.state.busy]); // eslint-disable-line react-hooks/exhaustive-deps
  // Follow along: with the conversation in one pane of a split, the other shows each thing Mobius finishes working on.
  // The conversation keeps the focus, so typing goes on there.
  const followed = useRef(new Set<string>());
  useEffect(() => {
    const last = conversation.state.items.findLast((i) => i.kind === 'tool' && i.status === 'done');
    if (!last || last.kind !== 'tool' || followed.current.has(last.callId)) return;
    followed.current.add(last.callId);
    if (!conversation.state.busy) return;
    const target = toolTarget(last.name, last.args);
    const follow = split ? followPane(panes, target) : null;
    if (!follow || !target) return;
    const chat: 0 | 1 = follow.pane === 0 ? 1 : 0;
    panesNow.current = { panes, focused: follow.pane };
    following.current = true;
    try { openTargetNow.current(target); } finally { following.current = false; }
    panesNow.current = { panes: panesNow.current.panes, focused: chat };
    setFocused(chat);
  }, [conversation.state.items]); // eslint-disable-line react-hooks/exhaustive-deps
  // However Settings closes, the next opening starts at its first page again.
  const closeSettings = useCallback(() => { setSettingsOpen(false); setSettingsSection(undefined); }, []);
  const newTab = useCallback(() => {
    // The person's own new tab: Air Traffic Control leaves it in the space they are in.
    void window.mobius.browser.open().then((id) => { ownTab(id); address.current?.focus(); });
  }, []);
  // The same as the toolbar's split and Little Mobius buttons, for their shortcuts.
  const toggleSplit = useCallback(() => {
    if (narrow) return;
    if (split) closePane(focused === 0 ? 1 : 0); else openSplit();
  }, [narrow, split, focused, closePane, openSplit]);
  // Little Mobius never sits over the open panel: opening it puts the panel away, and opening the panel closes it.
  const toggleMini = useCallback(() => { if (miniOpen) void window.mobius.mini.close(); else { setChatOpen(false); void window.mobius.mini.open(); } }, [miniOpen]);

  useEffect(
    () =>
      window.mobius.window.onShortcut((shortcut) => {
        if (shortcut === 'launcher') openLauncher();
        else if (shortcut === 'address') { address.current?.focus(); address.current?.select(); }
        else if (shortcut === 'new-tab') newTab();
        else if (shortcut === 'close-tab' && active) window.mobius.browser.close(active.id);
        else if (shortcut === 'settings') openSettings();
        else if (shortcut === 'find') openFind();
        else if (shortcut === 'split-view') toggleSplit();
        else if (shortcut === 'little-mobius') toggleMini();
        else if (shortcut === 'quick-entry') { setSettingsOpen(false); setLauncherOpen(false); setChatOpen(true); setFocusToken((n) => n + 1); }
      }),
    [openLauncher, openSettings, openFind, newTab, active, toggleSplit, toggleMini],
  );

  // The same shortcuts when the shell itself has the keyboard (pages are handled by the main process). Until the saved
  // shortcuts are known, presses are kept rather than answered (the defaults would answer keys the person may have given to
  // something else), then answered with the saved ones: a shortcut pressed as the window opens still works.
  const keysReady = preferences.loaded;
  useEffect(() => {
    if (keysReady) document.documentElement.dataset.keysReady = 'true';
  }, [keysReady]);
  useEffect(() => {
    if (!keysReady) return;
    const answer = (press: KeyPress, claim: () => void) => {
      const plainMod = (press.ctrl || press.meta) && !press.alt && !press.shift;
      // Ctrl+1 to Ctrl+9 open the pinned apps, in the launcher's order.
      const digit = plainMod && /^Digit[1-9]$/.test(press.code) ? Number(press.code.slice(5)) : 0;
      const pinnedApp = digit ? pinnedApps(appearance.value.sidebarApps)[digit - 1] : undefined;
      if (pinnedApp) { claim(); closeSettings(); openApp(pinnedApp); return; }
      const action = actionForPress(bindings, press);
      if (action === 'launcher') { claim(); openLauncher(); }
      else if (action === 'address') { claim(); address.current?.focus(); address.current?.select(); }
      else if (action === 'newTab') { claim(); newTab(); }
      else if (action === 'closeTab' && active) { claim(); window.mobius.browser.close(active.id); }
      else if (action === 'settings') { claim(); openSettings(); }
      else if (action === 'find' && app === 'browser') { claim(); openFind(); }
      else if (action === 'splitView') { claim(); toggleSplit(); }
      else if (action === 'littleMobius') { claim(); toggleMini(); }
      // New (Cmd-N, Ctrl-N elsewhere) is fixed too: it presses the open sidebar's New, whatever that makes there.
      else if (action === null && (press.ctrl || press.meta) && !press.alt && !press.shift && press.code === 'KeyN') {
        // The app's own panel, in the pane being worked in when two apps are side by side.
        const within: ParentNode = document.activeElement?.closest('.pane') ?? document;
        const NEW = '.app-side .side-new > .side-new-row, .app-side .app-side-new';
        const create = within.querySelector<HTMLButtonElement>(NEW) ?? document.querySelector<HTMLButtonElement>(NEW);
        if (create && !create.disabled) { claim(); create.click(); }
        // Calendar's New event is in its tool row, not its panel: the key makes one all the same.
        else if (!create && app === 'calendar') { claim(); setEventToken((n) => n + 1); }
      }
      // Stop is fixed (Cmd-period, Ctrl-period elsewhere) unless that press was given to something else.
      else if (action === null && (press.ctrl || press.meta) && !press.alt && !press.shift && press.code === 'Period' && conversation.state.busy) { claim(); void conversation.stop(); }
    };
    const onKey = (event: KeyboardEvent) => { if (!event.defaultPrevented && !shellStandsDown(event)) answer(pressOf(event), () => event.preventDefault()); };
    window.addEventListener('keydown', onKey);
    for (const press of takeEarlyKeys(performance.now())) answer(press, () => undefined);
    return () => window.removeEventListener('keydown', onKey);
  }, [keysReady, bindings, openLauncher, openSettings, openFind, app, newTab, active, toggleSplit, toggleMini, conversation, appearance.value.sidebarApps, closeSettings, openApp]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!active) return;
    const typed = draft ?? active.url;
    // Going somewhere from reader mode leaves it, for the page.
    if (inReader) openApp('browser');
    // An address the person typed is theirs: Air Traffic Control never moves the tab for it.
    ownTab(active.id);
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
    { id: 'conversation', label: 'New chat', app: 'agent', run: () => { closeSettings(); conversation.newConversation(); openApp('agent'); setFocusToken((n) => n + 1); } },
    { id: 'note', label: 'New note', app: 'notes', run: () => { closeSettings(); openApp('notes'); void (async () => { const nb = notes.page?.path.split('/')[0] ?? notes.notebooks[0]?.name ?? (await notes.createNotebook('Notes')); if (nb) await notes.createPage(nb); })(); } },
    // Notes: today's dated page in the Journal notebook, opened if it was made already, otherwise made.
    { id: 'today-note', label: 'Today’s note', app: 'notes', run: () => { closeSettings(); openApp('notes'); void (async () => {
      const made = findTodayNote(notes.notebooks);
      if (made) { await notes.open(made.path, made.title); return; }
      const book = notes.notebooks.some((nb) => nb.name === JOURNAL) ? JOURNAL : await notes.createNotebook(JOURNAL);
      // From the saved Daily template when there is one, under the day's own heading, so it is found again today.
      const daily = dailyTemplate(notes.notebooks);
      const kept = daily?.path ? await window.mobius.notes?.read(daily.path).catch(() => null) : null;
      const body = kept && 'content' in kept ? fillTemplate(templateBody(kept.content), new Date()) : '';
      if (book) await notes.createPage(book, todayNoteTitle(), `# ${todayNoteTitle()}\n\n${body}`);
    })(); } },
    { id: 'task', label: 'New task', app: 'tasks', run: () => { closeSettings(); tasks.setView({ kind: 'list', name: 'Inbox' }); openApp('tasks'); setTaskFocus((n) => n + 1); } },
    { id: 'tab', label: 'New tab', app: 'browser', keys: 'mod+t', run: () => { closeSettings(); openApp('browser'); newTab(); } },
    { id: 'doc', label: 'New document', app: 'docs', run: () => { closeSettings(); openApp('docs'); void (async () => { const folder = docs.page?.path.split('/')[0] ?? docs.notebooks[0]?.name ?? (await docs.createNotebook(DEFAULT_FOLDER)); if (folder) await docs.createPage(folder); })(); } },
    { id: 'message', label: 'New message', app: 'mail', run: () => { closeSettings(); openApp('mail'); mail.compose(); } },
    { id: 'deck', label: 'New deck', app: 'slides', run: () => { closeSettings(); openApp('slides'); void (async () => { const folder = slides.page?.path.split('/')[0] ?? slides.notebooks[0]?.name ?? (await slides.createNotebook('Presentations')); if (folder) await slides.createPage(folder, 'Untitled deck'); })(); } },
    { id: 'design', label: 'New design', app: 'design', run: () => { closeSettings(); openApp('design'); void (async () => { const folder = designs.page?.path.split('/')[0] ?? designs.notebooks[0]?.name ?? (await designs.createNotebook('Designs')); if (folder) await designs.createPage(folder, 'Untitled design'); })(); } },
    { id: 'view', label: 'New view', app: 'views', run: () => { closeSettings(); openApp('views'); newView(views); } },
    { id: 'board', label: 'New board', app: 'canvas', run: () => { closeSettings(); openApp('canvas'); void (async () => { const folder = boards.page?.path.split('/')[0] ?? boards.notebooks[0]?.name ?? (await boards.createNotebook('Boards')); if (folder) await boards.createPage(folder, 'Untitled board'); })(); } },
    { id: 'command', label: 'New command', app: 'terminal', run: () => { closeSettings(); openApp('terminal'); setTerminalFocus((n) => n + 1); } },
    { id: 'database', label: 'New database', app: 'database', run: () => { closeSettings(); openApp('database'); window.setTimeout(() => sendCommand('new-database'), 0); } },
    { id: 'article', label: 'Save a link', app: 'reader', run: () => { closeSettings(); openApp('reader'); window.setTimeout(() => sendCommand('save-link'), 0); } },
    { id: 'research', label: 'New research', app: 'research', run: () => { closeSettings(); openApp('research'); setAskingResearch(true); } },
    { id: 'song', label: 'New song', app: 'studio', run: () => { closeSettings(); openApp('studio'); void (async () => { const folder = songs.page?.path.split('/')[0] ?? songs.notebooks[0]?.name ?? (await songs.createNotebook('Songs')); if (folder) await songs.createPage(folder, 'Untitled song'); })(); } },
    { id: 'workbook', label: 'New workbook', app: 'sheets', run: () => { closeSettings(); openApp('sheets'); void sheets.createWorkbook('Workbook'); } },
    { id: 'skill', label: 'New skill', app: 'skills', run: () => { closeSettings(); openApp('skills'); setExtPlace('skills'); skills.close(); requestNewSkill(); } },
    { id: 'event', label: 'New event', app: 'calendar', run: () => { closeSettings(); openApp('calendar'); setEventToken((n) => n + 1); } },
  ];
  /** The one thing worth starting in the app you are in: the panel's New button changes with it. */
  // The open app's New, or none: an app with nothing to make from here (Projects, Photo, Files, Review...) shows no Create,
  // rather than one that starts a conversation.
  const createFor = (id: AppId): HubAction | undefined => createActions.find((a) => a.app === id);
  // These apps' own sidebar lists start with their New row, so the head's New is left out.
  const createInList: readonly AppId[] = ['notes', 'docs', 'slides', 'design', 'canvas', 'views', 'research', 'reader', 'studio', 'tasks', 'mail', 'sheets', 'browser', 'skills' /* Store: New skill is in the Skills page's header */, 'calendar' /* Calendar: New event is in its tool row */];
  // An app's own list (OWN_LIST): the same list as before, under the panel's header, with New and the pinned items.
  // Read later (Reader folded into the Browser): the Reading list's articles, newest first.
  // Finished ones (the Archive) are found by searching the panel.
  const readLater = reading.notebooks.flatMap((nb) => nb.pages.map((pg) => ({ path: pg.path, title: pg.title, modified: pg.modified, done: nb.name !== READING_LIST })))
    .sort((x, y) => Number(x.done) - Number(y.done) || y.modified - x.modified).map(({ path, title, done }) => ({ path, title, done }));
  const ownListBody = (id: AppId): ReactNode => {
    const browserSidebar = <BrowserSidebar tabs={browser.tabs} pin={null} onNewTab={newTab} onAsk={surface.hasPage ? () => { openRight(); setFocusToken((n) => n + 1); } : undefined} downloads={downloads} pinnedPages={pinnedPages} onPinPage={(t) => togglePin({ kind: 'page', id: t.url, title: t.title || t.url })} onOpenBookmark={(url) => { if (active) void window.mobius.browser.navigate(active.id, url); else void window.mobius.browser.open(url); }} readLater={readLater} reading={inReader ? (reading.page?.path ?? null) : null} onRead={(a) => { openApp('reader'); void reading.open(a.path, a.title); }} onShowTab={inReader ? () => openApp('browser') : undefined} split={browser.split ?? null} />;
    const list = (() => {
      switch (id) {
        case 'agent':
          return inActivity ? <ActivitySidebar feed={activityFeed} conversations={conversation.list} pin={null} /> : inChanges ? <ReviewSidebar review={review} pin={null} /> : (
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
              agentView={agentView}
              onShowAgent={setAgentView}
              onNewWithBot={(bot) => conversation.newConversation(bot)}
              onMoveBot={bots.move}
              onRemoveBot={async (bot) => {
                const wasHere = botOfConversation(conversation.id, botIds) === bot;
                const result = await bots.remove(bot);
                if (result.ok && wasHere) conversation.startFresh(MAIN_BOT_ID);
                if (result.ok && agentView?.kind === 'show' && agentView.id === bot) setAgentView(null);
                void conversation.refresh();
                return result;
              }}
              onSelect={conversation.select}
              onOpenSchedules={() => openSettingsAt('schedules')}
              onDelete={conversation.remove}
            />
          );
        case 'notes':
          return <NotesSidebar synced={syncedIn('notes')} notes={notes} sort={notesSort} tags pin={null} changed={liveMarks.notes} pinned={pinnedNotes} onPin={(path, title) => togglePin({ kind: 'note', id: path, title })} starts={startsFor('notes')} onStart={startWithMobius} />;
        case 'files':
          return <FilesSidebar files={files} pin={null} />;
        case 'mail':
          return <MailSidebar mail={mail} pin={null} starts={startsFor('mail')} onStart={startWithMobius} />;
        case 'messages':
          return <MessagesSidebar messages={chat} pin={null} />;
        case 'docs':
          return <DocsSidebar synced={syncedIn('docs')} docs={docs} pin={null} changed={liveMarks.docs} starts={startsFor('docs')} onStart={startWithMobius} />;
        case 'calendar':
          return <CalendarSidebar calendar={calendar} pin={null} changed={liveMarks.calendars} review={liveMarks.calendars.size > 0 ? { conversation: conversation.state.conversation, calendars: [...liveMarks.calendars] } : null} onNew={createFor('calendar')!.run} starts={startsFor('calendar')} onStart={startWithMobius} />;
        case 'tasks':
          return <TasksSidebar tasks={tasks} pin={null} changed={liveMarks.lists} pinned={pinnedLists} onPin={(name) => togglePin({ kind: 'list', id: name, title: name })} starts={startsFor('tasks')} onStart={startWithMobius} />;
        case 'skills':
          return <ExtensionsSidebar place={extPlace} onPlace={setExtPlace} skills={skills} pin={null} changed={liveMarks.skills} />
        case 'video':
          return <VideoSidebar video={video} pin={null} changed={liveMarks.video} />
        case 'studio':
          return <StudioSidebar songs={songs} pin={null} changed={liveMarks.songs} starts={startsFor('studio')} onStart={startWithMobius} />
        case 'photo':
          return <PhotoSidebar photos={photos} pin={null} changed={liveMarks.photos} />
        case 'terminal':
          return <TerminalSidebar term={terminal} pin={null} />
        case 'database':
        case 'views':
          // Views are Database's pages (fold-in): dashboards listed under the databases.
          return <DatabaseSidebar db={databases} pin={null} changed={liveMarks.databases} onDatabase={inViews ? () => openApp('database') : undefined}
            views={{ pages: views.notebooks.flatMap((nb) => nb.pages), current: inViews ? (views.page?.path ?? null) : null, changed: viewMarks, onOpen: (path, title) => { openApp('views'); void views.open(path, title); }, onNew: () => { openApp('views'); newView(views); } }} />
        case 'projects':
          return <ProjectsSidebar projects={projects} pin={null} conversations={conversation.list} />
        case 'wiki':
          return <WikiSidebar wiki={wiki} place={wikiPlace} onPlace={setWikiPlace} incoming={wikiIncoming} pin={null} />
        case 'reader':
          // Reader is the Browser's reader mode (fold-in, 2026-11-22): the same tabs panel, with the article current in Read later.
          return browserSidebar;
        case 'research':
          return <ResearchSidebar research={research} pin={null} changed={liveMarks.research} starts={startsFor('research')} onStart={startWithMobius} />
        case 'canvas':
          return <CanvasSidebar boards={boards} pin={null} changed={liveMarks.boards} starts={startsFor('canvas')} onStart={startWithMobius} />
        case 'code':
          return <CodeSidebar code={code} pin={null} changed={liveMarks.code} starts={startsFor('code')} onStart={startWithMobius} />
        case 'sheets':
          return <SheetsSidebar sheets={sheets} pin={null} changed={liveMarks.sheets} starts={startsFor('sheets')} onStart={startWithMobius} />
        case 'design':
          return <DesignSidebar designs={designs} pin={null} changed={liveMarks.designs} starts={startsFor('design')} onStart={startWithMobius} />
        case 'slides':
          return <SlidesSidebar slides={slides} pin={null} changed={liveMarks.slides} starts={startsFor('slides')} onStart={startWithMobius} />
        case 'browser':
          return browserSidebar;
        default:
          return null;
      }
    })();
    return (
      <SidebarHead
        create={(id === 'agent' && (inActivity || inAgents)) || createInList.includes(id) ? undefined : createFor(id)}
        favourites={favourites}
        onOpenFavourite={openFavourite}
        onUnpin={togglePin}
        onReorderFavourites={(next) => void appearance.set({ favourites: next })}
        currentFavourite={currentFavourite}
      >
        {list}
        <CommentsGroup threads={openComments} onOpen={(t) => { if (t.doc === commentDoc) setCommentFocus(t.id); }} />
      </SidebarHead>
    );
  };
  ownListRef.current = ownListBody;
  // Pieces (docs/design/pieces.md): the shell's panels, in every app's right dock until put away. Each body is drawn
  // from the latest render through the ref, as the lists are.
  const openPieces = usePieces();
  /** Calendar at a day, with an event open (as the Inbox's Answer does). */
  const openCalendarAt = (date: string, event?: string) => {
    openApp('calendar');
    const day = new Date(`${date}T12:00:00`);
    if (Number.isNaN(day.getTime())) return;
    calendar.showDay(day);
    if (event) setShowEvent((was) => ({ id: event, date, n: (was?.n ?? 0) + 1 }));
  };
  const pieceBody = (p: OpenPiece): ReactNode => (p.kind === 'tasks.list' ? <TasksListPiece tasks={tasks} list={p.item} />
    : p.kind === 'calendar.day' ? <CalendarDayPiece calendar={calendar} day={p.item} onDay={(day) => showPiece('calendar.day', day, p.by)} onOpen={(date, event) => openCalendarAt(date, event)} />
    : p.kind === 'mail.thread' ? <MailThreadPiece mail={mail} id={p.item} /> : null);
  const pieceBodyRef = useRef(pieceBody);
  pieceBodyRef.current = pieceBody;
  const openPieceInApp = (p: OpenPiece) => {
    openApp(PIECE_APP[p.kind].app);
    if (p.kind === 'tasks.list') tasks.setView({ kind: 'list', name: p.item });
    if (p.kind === 'mail.thread') void mail.read(p.item);
    if (p.kind === 'calendar.day') calendar.showDay(p.item === 'today' ? new Date() : new Date(`${p.item}T12:00:00`));
  };
  const openPieceRef = useRef(openPieceInApp);
  openPieceRef.current = openPieceInApp;
  const piecePanels = useMemo<readonly PanelSpec[]>(() => openPieces.map((p) => {
    const from = PIECE_APP[p.kind].name;
    const name = pieceName(p);
    return {
      id: piecePanelId(p),
      name,
      label: `${name}, from ${from}`,
      dock: 'right',
      shown: true,
      min: { width: 260 },
      mobius: p.by === 'mobius',
      hideLabel: `Put away ${name}`,
      onHide: () => putAway(p.kind, p.item),
      actions: <button type="button" title={`Open ${name} in ${from}`} onClick={() => openPieceRef.current(p)}>Open in {from}</button>,
      // Using a piece Mobius brought makes it the person's: it stays when Mobius's work is done.
      render: () => (
        <div className="piece-body" onPointerDownCapture={() => { if (p.by === 'mobius') showPiece(p.kind, p.item, 'you', p.title); }}>
          {pieceBodyRef.current(p)}
        </div>
      ),
    } satisfies PanelSpec;
  }), [openPieces]);
  const settingsPanels = useMemo<readonly PanelSpec[]>(() => [
    // Settings' Sections panel: always there, as in System Settings. Hidden, it left only the page that was open and no
    // way to another.
    { id: 'list', name: 'Sections', dock: 'left', shown: true, fixed: true, render: () => <div ref={setSettingsSlot} className="settings-side" /> },
  ], []);
  const listFor = (id: AppId): readonly PanelSpec[] => (settingsOpen ? NO_PANELS : ownListPanels[id] ?? NO_PANELS);
  const withOwnList = (id: AppId, content: ReactNode): ReactNode => {
    const panels = ownListPanels[id];
    return panels && !LIST_HANDED.includes(id) ? <PanelLayout app={id} panels={settingsOpen ? NO_PANELS : panels} away={settingsOpen}>{content}</PanelLayout> : content;
  };
  // A short message about something done without the agent, such as a task made from a selection.
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => { if (!toast) return undefined; const t = window.setTimeout(() => setToast(null), 2600); return () => window.clearTimeout(t); }, [toast]);
  // Chats live on items: opening a note, document, sheet or list shows its own chat; elsewhere, the general one. Not
  // while the Agent page is on screen (alone or in split view), where the person picks the chat. Not
  // while the open chat's changes wait for Keep: going to look at them must not take them away.
  useItemChats(hereOf(surface), app !== 'agent' && other !== 'agent' && !settingsOpen, { id: conversation.state.conversation, empty: conversation.state.items.length === 0, count: conversation.state.items.length, busy: conversation.state.busy, waiting: turnMarks.files.length > 0 }, marksReading, conversation.select);
  // Ask from anywhere: Ctrl+Shift+J with something chosen in the open app asks about it there, in a card by it.
  const [askHere, setAskHere] = useState<{ picked: Picked; back: Element | null; range: Range | null; chat: string } | null>(null);
  // The card asks in the item's own chat (so opening the item later shows it), unless that chat is busy right now.
  const askChatFor = useRef<() => string>(() => conversationIdFor(MAIN_BOT_ID, crypto.randomUUID()));
  askChatFor.current = () => {
    const here = hereOf(surface);
    const fresh = () => conversationIdFor(MAIN_BOT_ID, crypto.randomUUID());
    if (!here) return fresh();
    const id = itemChatFor(here);
    return id === conversation.state.conversation && conversation.state.busy ? fresh() : id;
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !pressIs('mod+shift+j', event, window.mobius.platform === 'darwin')) return;
      // Open already: the key takes the keyboard back to its question.
      const open = document.querySelector<HTMLElement>('.ask-here input');
      if (open) { event.preventDefault(); open.focus(); return; }
      const picked = pickedNow();
      if (!picked) return;
      event.preventDefault();
      const selection = document.getSelection();
      setAskHere({ picked, back: document.activeElement, range: selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null, chat: askChatFor.current() });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // Words chosen inside one paragraph take the answer as one line; across paragraphs, its paragraphs stay.
  const fitAnswer = (markdown: string, range: Range): string => {
    const block = (n: Node) => (n instanceof Element ? n : n.parentElement)?.closest('p, li, h1, h2, h3, h4, h5, h6, td, th, blockquote, pre') ?? null;
    const at = block(range.startContainer);
    if (!at || at !== block(range.endContainer)) return plainAnswer(markdown);
    const after = range.endContainer.nodeType === Node.TEXT_NODE ? (range.endContainer.textContent ?? '').slice(range.endOffset) : '';
    return inlineAnswer(markdown, after);
  };
  // `replace`: the answer takes the place of the chosen words, typed in as the person's own (one Undo takes it back).
  const closeAskHere = useCallback((replace?: string) => {
    setAskHere((was) => {
      if (was) {
        // The keyboard goes back to where it was, with the words still chosen.
        window.setTimeout(() => {
          if (was.back instanceof HTMLElement && was.back.isConnected) was.back.focus();
          if (was.range) { const s = document.getSelection(); s?.removeAllRanges(); s?.addRange(was.range); }
          if (replace && was.range) document.execCommand('insertText', false, fitAnswer(replace, was.range));
        }, 0);
      }
      return null;
    });
  }, []);
  // Assign to Mobius, from an item's own menu in any app: the work runs in a chat of its own, in the background, and
  // lands in Home's Inbox; the open chat and the panel stay as they are.
  /** Jobs whose Save as Ability was pressed and whose Ability run is not listed yet. */
  const savingAbility = useRef(new Set<string>());
  const assignNow = useRef<(a: Assignment) => void>(() => undefined);
  assignNow.current = (a: Assignment) => {
    // Assigned again while Mobius is still on it: said, not started twice (two runs, two Inbox rows).
    const who = a.bot?.name ?? 'Mobius';
    const key = a.item ?? a.title;
    const already = handoffs.runs.find((r) => (r.item ?? r.ask) === key && conversation.list.some((c) => c.id === r.conversation && (c.activity === 'working' || c.activity === 'needs_you')));
    if (already) {
      const on = botOfConversation(already.conversation, botIds);
      const busy = on === MAIN_BOT_ID ? 'Mobius' : (bots.bots.find((b) => b.id === on)?.name ?? 'An agent');
      setToast(`${busy} is already working on ${a.title}${/[.!?…]$/.test(a.title) ? '' : '.'}`);
      return;
    }
    void conversation.assign(a.ask, a.context ?? [], a.app, a.bot ? { bot: a.bot.id } : {}).then((result) => {
      if ('error' in result) { setToast(`${who} could not take it: ${result.error}`); return; }
      handoffs.start(result.id, a.title, undefined, undefined, key);
      setToast(`Assigned to ${who}. It will be in your Inbox when done.`);
    });
  };
  // An agent that started on its own (mail came from someone it looks out for): its run lands in the Inbox like any
  // other handed off.
  // Item menus offer the person's own agents beside Mobius (assign.ts).
  useEffect(() => setAssignAgents(bots.bots), [bots.bots]);
  useEffect(() => window.mobius.bots.onStarted?.((run) => handoffs.start(run.conversation, run.title)) ?? (() => undefined), [handoffs.start]);
  // The morning brief: once each morning, asked in its own chat in Ask mode, so it only reads; it lands in the Inbox.
  useMorningBrief(preferences.value.morningBrief, preferences.loaded, async (text) => {
    const result = await conversation.assign(text, [], 'home', { ask: true, tools: BRIEF_TOOLS });
    if ('error' in result) return false;
    handoffs.start(result.id, BRIEF_TITLE, 'brief');
    return true;
  });
  // Check-ins: the first time each day the person stays in Mail, Tasks, Calendar or Notes, Mobius looks there (Ask
  // mode, that app's tools only) and leaves a few suggestions in the Inbox. Not while Settings is open.
  useCheckIns(settingsOpen ? '' : app, preferences.value.checkInApps, preferences.loaded, async (where, text) => {
    const result = await conversation.assign(text, [], where, { ask: true, tools: [where] });
    if ('error' in result) return false;
    handoffs.start(result.id, checkInTitle(where), 'check-in', where);
    return true;
  });
  useEffect(() => {
    const onAssign = (event: Event) => { const a = (event as CustomEvent<Assignment>).detail; if (a && typeof a.ask === 'string' && a.ask.trim()) assignNow.current(a); };
    window.addEventListener(ASSIGN_EVENT, onAssign);
    return () => window.removeEventListener(ASSIGN_EVENT, onAssign);
  }, []);
  // Starting to type in the app Mobius is working in pauses it; the pill (or the panel) resumes it.
  const stageNode = useCallback(() => document.querySelector<HTMLElement>('.stage'), []);
  usePauseOnTyping(stageNode, activity, appOfTurn(conversation.state), app, conversation.takeOver, setToast);
  // What the person typed while they had control is written before Mobius goes on, so it counts as theirs.
  const handBack = useCallback(async (note?: string) => { await saveTyped(); return conversation.handBack(note); }, [conversation.handBack]); // eslint-disable-line react-hooks/exhaustive-deps
  const [incoming, setIncoming] = useState<{ token: number; item?: ContextItem; text?: string } | null>(null);
  /** A start from an app's New row: its words go in the message box, for the person to finish and send. */
  const startWithMobius = (prompt: string) => { if (!shows('agent')) setChatOpen(true); setIncoming({ token: Date.now(), text: prompt }); };
  // Mail (marked): a Triage action sends its turn in Mail's Triage mode, whatever the composer's mode.
  // Triage from Mail's panel action: the composer switches to Triage too, so the next turns stay in it until changed.
  // Code's Glance: Find the cause sends the failing test, with the open file and its output, to Mobius.
  const debugTest = () => { if (!shows('agent')) setChatOpen(true); void conversation.send(withSteps('Find the cause of the failing test', DEBUG_TEST), surface.code ? [sheetItem(surface.code)] : []); };
  const triageMail = (prompt: string) => { if (!shows('agent')) setChatOpen(true); setChatMode('triage'); void conversation.send(prompt, [], { mode: 'triage' }); };
  /** Mobius's starts for the open app: the suggestions that need nothing attached. */
  const startsFor = (id: AppId) => suggestionsFor({ ...surface, settings: false, app: id }).filter((s) => !s.attach).slice(0, 2);
  // Pinned favourites: notes and task lists one click away in the sidebar.
  const favourites = appearance.value.favourites ?? [];
  const pinnedNotes = useMemo(() => new Set(favourites.filter((f) => f.kind === 'note').map((f) => f.id)), [favourites]);
  const pagePinned = active !== undefined && favourites.some((f) => f.kind === 'page' && f.id === active.url);
  // Browser: the pages pinned to the sidebar, for the tab menu's Pin to the sidebar.
  const pinnedPages = useMemo(() => new Set(favourites.filter((f) => f.kind === 'page').map((f) => f.id)), [favourites]);
  const pinnedLists = useMemo(() => new Set(favourites.filter((f) => f.kind === 'list').map((f) => f.id)), [favourites]);
  const togglePin = (fav: Favourite) => {
    const has = favourites.some((f) => f.kind === fav.kind && f.id === fav.id);
    if (!has && favourites.length >= MAX_FAVOURITES) { setToast(`You can pin ${MAX_FAVOURITES} items. Unpin one first.`); return; }
    void appearance.set({ favourites: has ? favourites.filter((f) => !(f.kind === fav.kind && f.id === fav.id)) : [...favourites, { ...fav, title: fav.title.slice(0, 120) || fav.id.slice(0, 120) }] });
  };
  const openFavourite = (fav: Favourite) => {
    closeSettings();
    if (fav.kind === 'note') { openApp('notes'); void notes.open(fav.id, fav.title); }
    else if (fav.kind === 'list') { openApp('tasks'); tasks.setView({ kind: 'list', name: fav.id }); }
    else {
      // A page already open in a tab is shown there; otherwise it opens in a new one.
      showPage(fav.id);
    }
  };
  const currentFavourite = inBrowser && active ? `page:${active.url}` : inNotes && notes.page ? `note:${notes.page.path}` : inTasks && tasks.view.kind === 'list' ? `list:${tasks.view.name}` : null;

  // Everything the menus can do is already here; they gather it in one place.
  const edit = (command: 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll') => {
    if (command === 'paste') {
      void navigator.clipboard?.readText().then((text) => document.execCommand('insertText', false, text)).catch(() => document.execCommand('paste'));
      return;
    }
    // Canvas, Design, Slides and Photo keep their own history: what the menu's Undo means there, outside a text field.
    // Tasks: Undo puts back the task just deleted or ticked off.
    const typing = document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement || (document.activeElement as HTMLElement | null)?.isContentEditable;
    if ((command === 'undo' || command === 'redo') && (inCanvas || inDesign || inSlides || inPhoto || (inTasks && command === 'undo')) && !typing) { sendCommand(command); return; }
    document.execCommand(command);
  };
  // Learn (shell/learn-view): opening it unpins Mobius from beside; closing puts focus back where it was.
  const openLearn = () => {
    learnFrom.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (chatOpen) setChatOpen(false);
    setLearnOpen(true);
  };
  const closeLearn = () => { setLearnOpen(false); if (learnFrom.current?.isConnected) learnFrom.current.focus(); };
  const openSettingsAt = (section: 'keyboard' | 'about' | 'schedules' | 'profiles' | 'voice' | 'safety' | 'mail' | 'calendar' | 'messages' | 'browser') => { setSettingsSection(section); setSettingsOpen(true); };
  // An app's Listen button, when speaking isn't set up: Settings, Models, at Speaking.
  useEffect(() => {
    const open = () => { setSettingsSection('voice'); setSettingsOpen(true); };
    window.addEventListener(OPEN_SPEAKING_SETTINGS, open);
    return () => window.removeEventListener(OPEN_SPEAKING_SETTINGS, open);
  }, [setSettingsOpen]);
  // Views (Database's dashboards): what their tiles read, and where a tile leads. Home shows the pinned one.
  const homeView = usePinnedView();
  const viewApps = { tasks: tasks.all, events: calendar.events, calendars: calendar.calendars, mail: { messages: mail.messages, unread: mail.counts.all, accounts: mail.accounts.length }, notes: notes.notebooks, conversations: conversation.list };
  const openViewTarget = (t: TileTarget) => {
    if (t.kind === 'app') openApp(t.app);
    else if (t.kind === 'note') openTarget({ app: 'notes', path: t.path, title: t.title });
    else if (t.kind === 'conversation') openTarget({ app: 'agent', conversation: t.id });
    else openSettingsAt('schedules');
  };
  // A terminal block, beside the message box for a question about it.
  const askAboutTerminal = (title: string, text: string) => { if (!shows('agent')) setChatOpen(true); setIncoming({ token: Date.now(), item: { kind: 'file', title, source: `terminal/${terminal.cwd || '~'}`, text } }); };
  // Going to another app, tab or Settings stops a page being read aloud (Mobius's replies read on).
  useEffect(() => { stopReading(); }, [app, active?.id, settingsOpen]);
  const menuContext: MenuContext = {
    app,
    place: settingsOpen,
    apps: APPS.filter((a) => isListed(a) && isAvailable(a.id)),
    keys: bindings,
    state: {
      commenting, split, canSplit: !narrow, miniOpen, todayBeside: openPieces.some((p) => p.kind === 'calendar.day'),
      zoom: appearance.value.zoom,
      browser: { hasPage: active !== undefined && /^https?:/.test(active.url), canBack: active?.canGoBack ?? false, canForward: active?.canGoForward ?? false, bookmarked: saved, pinned: pagePinned },
      notes: { hasPage: notes.page !== null, pinned: notes.page !== null && pinnedNotes.has(notes.page.path), changed: notes.page !== null && turnMarks.notes.has(notes.page.path), checkedLast: checkedLastOn, sort: notesSort, isTemplate: isTemplate(notes.page?.path), templates: noteTemplates(notes.notebooks) },
      docs: { hasPage: docs.page !== null, isTemplate: isTemplate(docs.page?.path), templates: templatesIn(docs.notebooks) },
      tasks: { inList: tasks.view.kind === 'list', done: tasksDone },
      calendar: { mode: calendar.mode },
      agent: { busy: conversation.state.busy },
    },
    do: {
      create: { conversation: createActions[0]!.run, note: createActions[1]!.run, task: createActions.find((a) => a.id === 'task')!.run, tab: createActions.find((a) => a.id === 'tab')!.run },
      closeTab: () => { if (active) window.mobius.browser.close(active.id); },
      settings: openSettings,
      shortcuts: () => openSettingsAt('keyboard'),
      learn: openLearn,
      profiles: () => openSettingsAt('profiles'),
      about: () => openSettingsAt('about'),
      edit,
      find: openFind,
      toggleComments: () => setCommenting((on) => !on),
      toggleSplit,
      toggleMini,
      toggleTodayBeside: () => { if (openPieces.some((p) => p.kind === 'calendar.day')) putAway('calendar.day', 'today'); else showPiece('calendar.day', 'today'); },
      zoom: (zoom) => void appearance.set({ zoom }),
      open: (id) => { closeSettings(); openApp(id); },
      allApps: openHub,
      launcher: openLauncher,
      browser: {
        back: () => { if (active) window.mobius.browser.back(active.id); },
        forward: () => { if (active) window.mobius.browser.forward(active.id); },
        reload: () => { if (active) window.mobius.browser.reload(active.id); },
        address: () => { address.current?.focus(); address.current?.select(); },
        bookmark: () => void window.mobius.bookmarks.toggle(),
        pin: () => { if (active) togglePin({ kind: 'page', id: active.url, title: active.title || active.url }); },
        reopen: () => void window.mobius.browser.reopenClosed?.(),
        nextSpace: () => stepSpace(1, browser.tabs, newTab),
        previousSpace: () => stepSpace(-1, browser.tabs, newTab),
        selection: () => setSelectionMenu(true),
        saveToReader: () => { if (active) void saveToReader(reading, active.url).then((done) => setToast(done.ok ? 'Saved to Read later' : done.message)); },
      },
      terminal: {
        clear: () => terminal.clear(),
      },
      database: {
        newDatabase: () => sendCommand('new-database'),
        importCsv: () => (document.querySelector<HTMLInputElement>('.db-side input[type="file"]'))?.click(),
      },
      reader: {
        newList: () => sendCommand('new-folder'),
      },
      notes: {
        open: () => sendCommand('open-note'),
        newNotebook: () => sendCommand('new-notebook'),
        today: () => createActions.find((a) => a.id === 'today-note')!.run(),
        pin: () => { if (notes.page) togglePin({ kind: 'note', id: notes.page.path, title: notes.page.title || notes.page.path }); },
        changes: () => sendCommand('show-changes'),
        // Notes: the page's less-used controls live here, not in a second ⋯ in the toolbar.
        history: () => sendCommand('show-history'),
        clip: () => sendCommand('clip-page'),
        markdown: () => sendCommand('show-markdown'),
        checkedLast: () => { setCheckedLast(!checkedLastOn); setCheckedLastOn(!checkedLastOn); },
        sortBy: (by) => { setNoteSort(by); setNotesSort(by); },
        // A new note from a template, in the notebook open now (never Templates itself), dated where it says {{date}}.
        fromTemplate: (name) => { const t = noteTemplates(notes.notebooks).find((x) => x.name === name); if (!t) return; closeSettings(); openApp('notes'); void (async () => {
          const read = t.path ? await window.mobius.notes?.read(t.path).catch(() => null) : null;
          const content = t.content ?? (read && 'content' in read ? read.content : null);
          if (content === null) { setToast('The template could not be read.'); return; }
          const here = notes.page && !isTemplate(notes.page.path) ? notes.page.path.split('/')[0] : undefined;
          const book = here ?? notes.notebooks.find((n) => !isTemplate(`${n.name}/`))?.name ?? (await notes.createNotebook('Notes'));
          const now = new Date();
          const made = book ? await notes.createPage(book, fillTemplate(t.title, now), fillTemplate(content, now)) : null;
          if (!made) setToast(`${t.name} could not be started${book ? ` in ${book}` : ''}.`);
        })(); },
        // The Templates notebook, with the kept Meeting and Project put in it to change, and its first template opened.
        editTemplates: () => { closeSettings(); openApp('notes'); void (async () => {
          const book = templatesNotebook(notes.notebooks) ?? (await notes.createNotebook(TEMPLATES_FOLDER));
          if (!book) return;
          const saved = savedTemplates(notes.notebooks);
          for (const t of KEPT_NOTE_TEMPLATES) {
            if (!saved.some((s) => s.name.toLocaleLowerCase() === t.name.toLocaleLowerCase())) await notes.createPage(book, t.name, t.content);
          }
          const open = saved[0];
          if (open?.path) await notes.open(open.path, open.title);
        })(); },
        // The open note copied into Templates (made if missing), where New from lists it.
        saveAsTemplate: () => { const page = notes.page; if (!page || isTemplate(page.path)) return; void (async () => {
          const text = notes.text;
          const book = templatesNotebook(notes.notebooks) ?? (await notes.createNotebook(TEMPLATES_FOLDER));
          if (book && await notes.createPage(book, page.title, text)) setToast(`Saved as a template. New from ${templateName(page.title)} is in the Notes menu.`);
        })(); },
      },
      tasks: {
        newList: () => sendCommand('new-list'),
        clearDone: () => { if (tasks.view.kind === 'list') void tasks.clearDone(tasks.view.name); },
        today: () => tasks.setView({ kind: 'smart', id: 'today' }),
        scheduled: () => tasks.setView({ kind: 'smart', id: 'scheduled' }),
      },
      mail: {
        newMessage: () => createActions.find((a) => a.id === 'message')!.run(),
        getMail: () => void mail.sync(),
      },
      slides: {
        newDeck: () => createActions.find((a) => a.id === 'deck')!.run(),
      },
      video: {
        newProject: () => void video.createProject('Project'),
        showFolder: () => void video.showFolder(),
      },
      studio: {
        newSong: () => createActions.find((a) => a.id === 'song')!.run(),
        play: () => (document.querySelector<HTMLButtonElement>('.ui-transport > button'))?.click(), // Music (marked): the toolbar Transport's Play
      },
      photo: {
        newAlbum: () => void photos.createAlbum('Album'),
        export: () => (document.querySelector<HTMLButtonElement>('.photo-head .btn.primary'))?.click(),
      },
      design: {
        newDesign: () => createActions.find((a) => a.id === 'design')!.run(),
        newFolder: () => sendCommand('new-folder'),
      },
      research: {
        newResearch: () => createActions.find((a) => a.id === 'research')!.run(),
        newFolder: () => sendCommand('new-folder'),
      },
      canvas: {
        newBoard: () => createActions.find((a) => a.id === 'board')!.run(),
        newFolder: () => sendCommand('new-folder'),
        newSticky: () => sendCommand('new-sticky'),
      },
      code: {
        newProject: () => sendCommand('new-project'),
        newFile: () => sendCommand('new-file'),
        save: () => void code.save(),
        runTests: () => void code.runTests(),
      },
      sheets: {
        newWorkbook: () => createActions.find((a) => a.id === 'workbook')!.run(),
        newSheet: () => { if (sheets.data) void sheets.addSheet(`Sheet ${sheets.data.sheets.length + 1}`); },
        insertRow: () => void sheets.shift('row', 0, true),
      },
      docs: {
        newDocument: () => createActions.find((a) => a.id === 'doc')!.run(),
        newFolder: () => sendCommand('new-folder'),
        // Apps lead: a new document starts as a copy of the template, in the folder open now (never Templates itself).
        fromTemplate: (path, title) => { closeSettings(); openApp('docs'); void (async () => {
          const read = await window.mobius.docs?.read(path).catch(() => null);
          if (!read || 'ok' in read) { setToast('The template could not be read.'); return; }
          const here = docs.page && !isTemplate(docs.page.path) ? docs.page.path.split('/')[0] : undefined;
          const folder = here ?? docs.notebooks.find((n) => !isTemplate(`${n.name}/`))?.name ?? (await docs.createNotebook(DEFAULT_FOLDER));
          // Named as its first line reads once filled: "Weekly update, {{date}}" makes "Weekly update, Thursday, 19 November 2026".
          const now = new Date();
          const made = folder ? await docs.createPage(folder, fillTemplate(title, now), fillTemplate(read.content, now)) : null;
          if (!made) setToast(`${templateName(title)} could not be started${folder ? ` in ${folder}` : ''}.`);
        })(); },
        // Opens the copy in Templates: what is changed there is what new documents start with.
        saveAsTemplate: () => { const page = docs.page; if (!page || isTemplate(page.path)) return; void (async () => {
          const text = docs.text;
          const folder = docs.notebooks.find((n) => isTemplate(`${n.name}/`))?.name ?? (await docs.createNotebook(TEMPLATES_FOLDER));
          if (folder && await docs.createPage(folder, page.title, text)) setToast(`Saved as a template. New from ${page.title} is in the Docs menu`);
        })(); },
      },
      calendar: {
        newEvent: () => createActions.find((a) => a.id === 'event')!.run(),
        quickEvent: () => sendCommand('quick-event'),
        newCalendar: () => sendCommand('new-calendar'),
        today: () => calendar.setAnchor(new Date()),
        mode: (mode) => calendar.setMode(mode),
      },
      agent: { stop: conversation.stop },
    },
  };
  const menus = buildMenus(menuContext);
  // The launcher finds every menu command by name. Going to apps is already there, and editing needs the place you
  // were typing in, so those are left out.
  const launcherCommands = menus.flatMap((m) => m.items.flatMap((i) => (i.kind === 'item' && !i.disabled && !i.id.startsWith('go-') && !['undo', 'redo', 'cut', 'copy', 'paste', 'select-all', 'launcher', 'all-apps'].includes(i.id)
    ? [{ id: `${m.id}-${i.id}`, label: i.label.replace(/…$/, ''), detail: [m.label, i.keys ? describeCombo(i.keys, window.mobius.platform) : ''].filter(Boolean).join(' · '), run: i.run }]
    : [])));
  // And everything you can start (New document, New deck…), wherever you are: the menus only hold the open app's.
  for (const a of createActions) if (!launcherCommands.some((c) => c.label === a.label)) launcherCommands.push({ id: `new-${a.id}`, label: a.label, detail: appName(a.app), run: a.run });
  // Activity: Mobius's own app, found by name.
  // Agents app (marked): it is a side of the Agent app, so it is found here by name.
  launcherCommands.push({ id: 'open-agents', label: 'Agents', detail: 'Your named agents', run: () => { closeSettings(); setSideMode('bots'); openApp('agent'); } });
  launcherCommands.push({ id: 'all-apps', label: 'All apps', detail: 'Every app, with what is happening in it', run: openHub });
  launcherCommands.push({ id: 'open-activity', label: 'Activity', detail: 'What Mobius did, and what needs you', run: () => { closeSettings(); setSideMode('activity'); openApp('agent'); } });
  // Apps lead: Mail, Calendar, Tasks, Notes, Docs and Files take part in the launcher (app-launcher.ts).
  useDailyLauncherSources({
    openTarget: (target, label) => { opener.current = null; closeSettings(); openTarget(target, label); },
    composeTo: (email) => { opener.current = null; closeSettings(); openApp('mail'); mail.compose(); mail.setEditing((e) => (e ? { ...e, to: email } : e)); },
    tasksView: (id) => { opener.current = null; closeSettings(); tasks.setView({ kind: 'smart', id }); openApp('tasks'); },
    calendarToday: () => { opener.current = null; closeSettings(); calendar.setAnchor(new Date()); openApp('calendar'); },
    filesTrash: () => { opener.current = null; closeSettings(); files.setPlace({ kind: 'trash' }); openApp('files'); },
    taskList: () => tasks.lists.find((l) => l.name === DEFAULT_LIST_NAME && !l.account)?.name ?? tasks.lists.find((l) => !l.account)?.name ?? tasks.lists[0]?.name ?? DEFAULT_LIST_NAME,
    calendarInto: () => { const writable = calendar.calendars.filter((c) => !calendar.readOnly(c)); return writable.find((c) => !calendar.hidden.has(c)) ?? writable[0] ?? 'Calendar'; },
    addEvent: (into, event) => { void calendar.add(into, event).then((ok) => setToast(ok ? `Added to ${into}` : 'The event could not be added.')); },
    addTask: (list, text, due, time) => { void tasks.add(list, text, due, time ? { time } : undefined).then((ok) => setToast(ok ? `Added to ${list}` : 'The task could not be added.')); },
  });
  // Apps lead: Messages and Knowledge take part too (app-launcher.ts).
  useMoreLauncherSources({
    openChannel: (account, channel) => { opener.current = null; closeSettings(); openApp('messages'); chat.choose({ account, channel }); },
    knowledge: () => wiki.notebooks,
    openPage: (path, title) => { opener.current = null; closeSettings(); setWikiPlace({ kind: 'page' }); openApp('wiki'); void wiki.open(path, title); },
    howIWork: () => { opener.current = null; closeSettings(); setWikiPlace({ kind: 'mine' }); openApp('wiki'); },
  });
  // And what each app registered with the launcher (launcher-sources.ts).
  const allCommands = sourceCommands(launcherCommands);
  // What the launcher does, the same from Ctrl+K and from the launcher's own window over other apps.
  // Ctrl+O in Notes opens the launcher narrowed to Notes: the notes edited last, and New note “…” when nothing matches.
  const openNotesLauncher = useCallback(() => openLauncherIn('notes'), [openLauncherIn]);
  useNoteQuickOpen(app === 'notes' && !settingsOpen && !launcherOpen, openNotesLauncher);
  const launcherRecentIn = (scopeApp: AppId): FoundItem[] => (scopeApp !== 'notes' ? [] : recentNotes(notes.notebooks, notes.page?.path).map((n) => ({
    id: n.path, app: 'notes', label: n.title, detail: n.notebook, run: () => { opener.current = null; closeSettings(); openTarget({ app: 'notes', path: n.path, title: n.title }, n.title); },
  })));
  const launcherMakeIn = (scopeApp: AppId, text: string): FoundItem | null => {
    if (scopeApp !== 'notes' || !text) return null;
    const into = notes.page?.path.split('/')[0] ?? notes.notebooks[0]?.name;
    return {
      id: 'new-note', app: 'notes', label: `New note “${text.length > 60 ? `${text.slice(0, 59)}…` : text}”`, detail: into ?? 'Notes',
      run: () => { opener.current = null; closeSettings(); openApp('notes'); void (async () => { const nb = into ?? (await notes.createNotebook('Notes')); if (nb) await notes.createPage(nb, text); })(); },
    };
  };
  const launch = {
    // Everything found in your apps: what Mobius already holds, then what each app's own source finds.
    find: (query: string) => findInSources(query, launcherFind(launcherSources(), query).slice(0, 8).map((r) => ({ id: r.key, app: targetApp(r.target) ?? (r.target.app === 'calendar' ? 'calendar' : 'agent'), label: r.title, detail: r.where, run: () => { opener.current = null; closeSettings(); openTarget(r.target, r.title); } }))),
    commands: allCommands,
    openApp: (id: AppId) => {
      opener.current = null; closeSettings(); if (id === 'agent') setSideMode('sessions');
      // Research is a mode now: "Research" opens its reports, in Docs' Research folder (earlier ones are still found by name).
      if (id === 'research') { openApp('docs'); const latest = docs.notebooks.find((n) => n.name === RESEARCH_FOLDER)?.pages.slice().sort((a, b) => b.modified - a.modified)[0]; if (latest) void docs.open(latest.path, latest.title); return; }
      openApp(id);
    },
    activateTab: (id: string) => { openApp('browser'); window.mobius.browser.activate(id); },
    newTab,
    openRecent: (item: { app: AppId; ref: string; label: string }) => { opener.current = null; closeSettings(); const target = targetOfRef(item.ref); if (target) openTarget(target, item.label); else openApp(item.app); },
    places: { home: () => { closeSettings(); setSideMode('sessions'); openApp('agent'); }, activity: ownApp('activity'), changes: ownApp('changes'), abilities: ownApp('extensions'), settings: () => openSettings() },
    openMobius: () => { closeSettings(); if (hasRight) openRight(); else openApp('agent'); setFocusToken((n) => n + 1); },
    // Mobius opens with the thing chosen attached, as an item is from inside its app; the person says what to ask.
    askAbout: (item: { app?: AppId; label: string; detail?: string }) => {
      closeSettings();
      if (hasRight) openRight(); else openApp('agent');
      const where = item.app ? appName(item.app) : 'Mobius';
      const text = [`${item.label}, in ${where}.`, item.detail ? `Details: ${item.detail}` : ''].filter(Boolean).join('\n');
      setIncoming({ token: Date.now(), item: { kind: 'file', title: item.label.slice(0, 120), source: where, text: text.slice(0, MAX_CONTEXT_ITEM_CHARS) } });
      setFocusToken((n) => n + 1);
    },
    ask: settings?.configured ? (question: string) => { setChatOpen(true); setFocusToken((n) => n + 1); void conversation.send(question, []); } : undefined,
  };
  const launchNow = useRef(launch);
  const foundForWindow = useRef(new Map<string, () => void>());
  launchNow.current = launch;
  // Chosen in the launcher's own window: Mobius has come forward, and opens it here.
  useEffect(() => window.mobius.launcherWindow?.onLaunch((value) => {
    const chosen = parseLaunchChoice(value);
    const l = launchNow.current;
    if (!chosen) return;
    if (chosen.kind === 'app') { if (findApp(chosen.app)) l.openApp(chosen.app as AppId); }
    else if (chosen.kind === 'recent') { if (findApp(chosen.app)) l.openRecent({ app: chosen.app as AppId, ref: chosen.ref, label: chosen.label }); }
    else if (chosen.kind === 'place') l.places[chosen.place]();
    else if (chosen.kind === 'tab') l.activateTab(chosen.id);
    else if (chosen.kind === 'new-tab') l.newTab();
    else if (chosen.kind === 'mobius') l.openMobius();
    else if (chosen.kind === 'ask-about') l.askAbout({ ...(findApp(chosen.app) ? { app: chosen.app as AppId } : {}), label: chosen.label, ...(chosen.detail ? { detail: chosen.detail } : {}) });
    else if (chosen.kind === 'ask') { if (chosen.text.trim() && l.ask) l.ask(chosen.text); else l.openMobius(); }
    else if (chosen.kind === 'found') foundForWindow.current.get(chosen.id)?.();
    else if (chosen.kind === 'command') l.commands.find((c) => c.id === chosen.id)?.run();
  }), []);
  // The launcher's own window asks what is found for its words; it gets them as plain rows, and opens one by its id.
  useEffect(() => window.mobius.launcherWindow?.onFind?.(async (query) => {
    const l = launchNow.current;
    const items = query.trim() ? await l.find(query.trim()) : [];
    foundForWindow.current = new Map(items.map((item) => [`${item.app}:${item.id}`, item.run]));
    return {
      items: items.map((item) => ({ id: `${item.app}:${item.id}`, app: item.app, label: item.label, ...(item.detail ? { detail: item.detail } : {}) })),
      commands: l.commands.map((c) => ({ id: c.id, label: c.label, ...(c.detail ? { detail: c.detail } : {}) })),
    };
  }), []);
  // On macOS the menus go in the system menu bar; elsewhere they are drawn in the toolbar.
  const nativeMenus = window.mobius.platform === 'darwin' && window.mobius.menu !== undefined;
  const menusNow = useRef(menus);
  menusNow.current = menus;
  const menuData = JSON.stringify(menusAsData(menus));
  useEffect(() => { if (nativeMenus) void window.mobius.menu?.set(JSON.parse(menuData) as ReturnType<typeof menusAsData>).catch(() => undefined); }, [nativeMenus, menuData]);
  useEffect(() => window.mobius.menu?.onSelect((id) => {
    const item = findItem(menusNow.current, id);
    if (item && !item.disabled) item.run();
  }), []);
  /** On-canvas actions for the web: what to do with the text selected on the page. */
  // Where Save to Notes puts web text: the chosen page while it exists, otherwise Clippings.
  const clipPages = useMemo<ClipPage[]>(() => notes.notebooks.flatMap((nb) => nb.pages.map((pg) => ({ path: pg.path, title: pg.title, notebook: nb.name }))), [notes.notebooks]);
  const clipTarget = clipPages.find((pg) => pg.path === appearance.value.clippingsPage);
  const clipText = async (target: string) => {
    setSelectionMenu(false);
    const result = await window.mobius.context.selection().catch(() => ({ ok: false as const, error: 'The selection could not be read.' }));
    if (!result.ok) { setNotice(result.error); return; }
    const saved = await clipToNotes(result.item, target);
    const name = clipPages.find((pg) => pg.path === (saved.ok ? saved.path : ''))?.title ?? 'Clippings';
    setNotice(saved.ok ? `Saved to ${name} in Notes` : saved.error);
  };
  const clipToPage = (path: string) => {
    void appearance.set({ clippingsPage: path });
    void clipText(path);
  };
  const webSelection = async (action: WebSelectionAction) => {
    if (action === 'clip') { await clipText(clipTarget?.path ?? ''); return; }
    setSelectionMenu(false);
    const result = await window.mobius.context.selection().catch(() => ({ ok: false as const, error: 'The selection could not be read.' }));
    if (!result.ok) { setNotice(result.error); return; }
    const { item } = result;
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
  /** Docs' writing tools: a request to the agent about the selection (or the whole document), changes made in place. */
  const onWritingTool = (tool: WritingTool, selection: string | null) => {
    const page = docs.page;
    if (!page) return;
    const title = liveTitle(docs.text, page.title || appName('docs')).slice(0, 120) || 'Document';
    const where = `docs/${page.path}`;
    const item: ContextItem = { kind: 'file', title: selection && tool !== 'comment' ? `${title} (selection)` : title, source: where, text: (tool === 'comment' ? docs.text : selection ?? docs.text).slice(0, MAX_CONTEXT_ITEM_CHARS) };
    const what = selection ? `the attached passage from my document "${title}"` : `my document "${title}"`;
    const inPlace = `Make the changes in the document itself (${where}) with files.edit, change nothing else, and keep it Markdown.`;
    const prompt = {
      proofread: `Proofread ${what}: fix spelling, grammar and punctuation only. ${inPlace}`,
      friendlier: `Rewrite ${what} so it reads friendlier and warmer, keeping its meaning and my voice. ${inPlace}`,
      shorter: `Make ${what} about half as long, with the same meaning, by cutting what it can do without: keep my own words and phrases where they stay, and do not reword what you keep. ${inPlace}`,
      summarise: `Summarise ${what} in a few short lines. Do not change the document.`,
      comment: `Answer this comment on "${title}" with comments.reply (page ${where}; its id is in brackets, or find it with comments.list):\n${selection ?? ''}\nIf it asks for a change, make it with files.edit and say in the reply what you changed.`,
    }[tool];
    const ready = settings?.configured === true && coreStatus === 'ready' && !conversation.state.busy;
    if (!shows('agent')) setChatOpen(true);
    if (!ready) { setIncoming({ token: Date.now(), item }); return; }
    void conversation.send(prompt, [item]);
  };
  /** Slides' Ask Mobius menu: a request about the deck; the slides it changes come back dashed to keep or discard. */
  const onSlidesTool = (tool: SlidesTool, slide: number) => {
    const page = slides.page;
    if (!page) return;
    const where = `slides/${page.path}`;
    const item: ContextItem = { kind: 'file', title: page.title || 'Deck', source: where, text: slides.text.slice(0, MAX_CONTEXT_ITEM_CHARS) };
    const inPlace = `Make the changes in the deck itself (${where}) with files.edit, keeping its format: slides split by a line ---, ### kicker, ## title, - bullets, Notes: then presenter notes.`;
    if (tool === 'from-doc') {
      if (!shows('agent')) setChatOpen(true);
      setDraft(`Add slides to the deck "${page.title}" (${where}) made from my document `);
      return;
    }
    const prompt = {
      notes: `Write short presenter notes for each slide of the deck "${page.title}" that has none, in my voice. Change only the notes. ${inPlace}`,
      tighten: `Make the titles and bullets of the deck "${page.title}" shorter and clearer, keeping what they say. ${inPlace}`,
      rehearse: `Rehearse the deck "${page.title}" with me: I will say what I would say on slide ${slide + 1}; tell me what to keep, cut or add, one slide at a time. Do not change the deck.`,
      'from-doc': '',
    }[tool];
    const ready = settings?.configured === true && coreStatus === 'ready' && !conversation.state.busy;
    if (!shows('agent')) setChatOpen(true);
    if (!ready) { setIncoming({ token: Date.now(), item }); return; }
    void conversation.send(prompt, [item]);
  };
  /** Mail's "Draft a reply with Mobius": the agent reads the message and suggests a reply, which waits for the person. */
  const onDraftReply = (m: MailContent) => {
    const ready = settings?.configured === true && coreStatus === 'ready' && !conversation.state.busy;
    if (!shows('agent')) setChatOpen(true);
    const prompt = `Read the email "${m.subject}" (mail.read with id ${m.id}) and suggest a short reply with mail.draft (replyTo: ${m.id}), in my voice. Look at my calendar first if it is about a time. Do not send anything.`;
    if (!ready) { setDraft(prompt); return; }
    void conversation.send(prompt, []);
  };
  /** Research: a question or a follow-up for the agent, with the open report attached for a follow-up. */
  const onResearch = (prompt: string, attach: boolean) => {
    const ready = settings?.configured === true && coreStatus === 'ready' && !conversation.state.busy;
    if (!shows('agent')) setChatOpen(true);
    if (!ready) { setDraft(prompt); return; }
    const page = research.page;
    void conversation.send(prompt, attach && page ? [noteContext({ path: page.path, title: liveTitle(research.text, page.title), text: research.text, folder: 'research' })] : []);
  };
  /** On-canvas actions: what to do with text selected in a note. */
  // Calendar's Record meeting: the event's page in the Meetings notebook (made the first time), opened, and listening.
  const [meetingToken, setMeetingToken] = useState(0);
  const recordMeeting = async (event: CalendarEvent) => {
    const page = meetingNote(event);
    openApp('notes');
    const book = notes.notebooks.find((n) => n.name === MEETINGS_NOTEBOOK)?.name ?? (await notes.createNotebook(MEETINGS_NOTEBOOK));
    if (!book) return;
    const there = notes.notebooks.find((n) => n.name === book)?.pages.find((p) => p.title === page.title);
    const opened = there ? (await notes.open(there.path, there.title), there.path) : await notes.createPage(book, page.title, page.content);
    if (opened) setMeetingToken(Date.now());
  };
  // The nudge when a meeting on the calendar starts: "{Meeting} is starting" in the pill at the foot of the app, with
  // Record, gone by itself after a minute. It never takes focus. Each time of a meeting is offered once.
  const [starting, setStarting] = useState<CalendarEvent | null>(null);
  const offered = useRef(new Set<string>());
  // An event's alert, when it comes: "{Event} in 10 minutes" in the same pill, with Open (docs/design/calendar.md).
  const [alerting, setAlerting] = useState<{ event: CalendarEvent; said: string } | null>(null);
  const alerted = useRef(new Set<string>());
  useEffect(() => {
    const api = window.mobius.calendar;
    if (!api) return;
    let gone = false;
    const look = async () => {
      const now = new Date();
      // Today and tomorrow: an alert a day before, or an all-day event's the day before, is for tomorrow's events.
      const got = await api.events(calendarDay(now), calendarDay(new Date(now.getTime() + 86_400_000))).catch(() => null);
      if (gone || !Array.isArray(got)) return;
      const next = meetingStarting(got.filter((e) => e.start.slice(0, 10) === calendarDay(now)), now, offered.current);
      if (next) { offered.current.add(meetingKey(next)); setStarting(next); }
      const due = alertDue(got, now, alerted.current);
      if (due) { alerted.current.add(meetingKey(due)); setAlerting({ event: due, said: alertSaid(due, now) }); }
    };
    void look();
    const timer = window.setInterval(() => void look(), 30_000);
    return () => { gone = true; window.clearInterval(timer); };
  }, []);
  useEffect(() => {
    if (!starting) return;
    const timer = window.setTimeout(() => setStarting(null), OFFER_SHOWN_MS);
    return () => window.clearTimeout(timer);
  }, [starting]);
  useEffect(() => {
    if (!alerting) return;
    const timer = window.setTimeout(() => setAlerting(null), OFFER_SHOWN_MS);
    return () => window.clearTimeout(timer);
  }, [alerting]);
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
            <BrowserPage onStartPage={onStartPage} hidden={launcherOpen || hubOpen || settingsOpen || menuOverPage || cover !== null || onStartPage} onOpen={(url) => { if (active) void window.mobius.browser.navigate(active.id, url); }} onRead={(path, title) => { openApp('reader'); void reading.open(path, title); }} split={browser.split ?? null} tabs={browser.tabs} peek={browser.peek ?? null} />
          </>
        );
      case 'notes':
        return <NoteEditor notes={notes} autoFocus={app === 'notes'} onSelection={onNoteSelection} onAsk={startWithMobius} recordToken={meetingToken} review={notes.page && liveMarks.notes.has(notes.page.path) ? { conversation: conversation.state.conversation } : null} working={conversation.state.busy} />;
      case 'tasks':
        return <TasksPage tasks={tasks} listPanels={listFor('tasks')} focusToken={taskFocus} onAsk={startWithMobius} review={tasks.view.kind === 'list' && liveMarks.lists.has(tasks.view.name) ? { conversation: conversation.state.conversation } : null} working={conversation.state.busy} />;
      case 'docs':
        return <DocEditor docs={docs} inFrame autoFocus={app === 'docs'} review={docs.page && liveMarks.docs.has(docs.page.path) ? { conversation: conversation.state.conversation } : null} onTool={onWritingTool} onComments={onDocComments} busy={conversation.state.busy} />;
      case 'slides':
        return <SlidesEditor slides={slides} listPanels={listFor('slides')} review={slides.page && liveMarks.slides.has(slides.page.path) ? { conversation: conversation.state.conversation } : null} onTool={onSlidesTool} busy={conversation.state.busy} />;
      case 'skills':
        if (extPlace !== 'skills') return <ExtensionsPage place={extPlace} onOpenApp={openApp} onAdjust={openSettingsAt} />;
        return <>
          <SkillsToolbar skills={skills} onRun={(name) => { openApp('agent'); void conversation.send(expandSlash(`/${name}`, skills.names), []); }} />
          {skills.open ? <SkillEditor skills={skills} review={liveMarks.skills.has(skills.open.name) ? { conversation: conversation.state.conversation } : null} /> : <SkillList skills={skills} />}
        </>;
      case 'video':
        return <VideoEditor video={video} listPanels={listFor('video')} review={video.project && liveMarks.video.has(video.project) ? { conversation: conversation.state.conversation } : null} />;
      case 'studio':
        return <StudioEditor songs={songs} listPanels={listFor('studio')} review={songs.page && liveMarks.songs.has(songs.page.path) ? { conversation: conversation.state.conversation } : null} working={conversation.state.busy} />;
      case 'photo':
        return <PhotoEditor photos={photos} listPanels={listFor('photo')} review={photos.open && liveMarks.photos.has(photos.open.path) ? { conversation: conversation.state.conversation } : null} working={conversation.state.busy} changed={liveMarks.photos} />;
      case 'design':
        return <DesignEditor designs={designs} listPanels={listFor('design')} review={designs.page && liveMarks.designs.has(designs.page.path) ? { conversation: conversation.state.conversation } : null} />;
      case 'files':
        return <FilesPage files={files} onOpenFile={openChangedFile} onAsk={startWithMobius} />;
      case 'terminal':
        // Terminal alone (Ctrl+K, New command): the terminal folded into Code, opened by itself.
        return <TerminalPage term={terminal} focusToken={terminalFocus} onAsk={askAboutTerminal} />;
      case 'database':
        return <DatabasePage db={databases} listPanels={listFor('database')} review={databases.open && liveMarks.databases.has(databases.open) ? { conversation: conversation.state.conversation } : null} />;
      case 'projects':
        return (
          <ProjectPage
            projects={projects}
            conversations={conversation.list}
            incoming={wikiIncoming}
            onForget={(id) => void conversation.remove(id)}
            onOpenThread={(id) => { conversation.select(id); openApp('agent'); }}
            onNewThread={(pid) => { const id = conversationIdFor(MAIN_BOT_ID, crypto.randomUUID()); void projects.addThread(pid, id).then((ok) => { if (ok) { conversation.select(id); openApp('agent'); } }); }}
            onOpenMemory={(p) => { setWikiPlace({ kind: 'page' }); openApp('wiki'); void wiki.open(memoryPage(p), p.name); }}
            onOpenFiles={(p) => { files.setPlace({ kind: 'folder', path: `projects/${p.name}` }); openApp('files'); }}
            onOpenMade={(path) => { const target = changeTarget(path); if (target) openTarget(target); }}
          />
        );
      case 'wiki':
        if (wikiPlace.kind === 'mine') return <HowIWork asking={conversation.state.items} onAnswer={(id, approve) => void conversation.answer(id, approve, 'once')} />;
        if (wikiPlace.kind === 'shared') return <SharedQueue incoming={wikiIncoming} />;
        return <WikiPage wiki={wiki} autoFocus={app === 'wiki'} busy={conversation.state.busy} />;
      case 'reader':
        return <ReaderPage reading={reading} onAsk={startWithMobius} tab={active ? { url: active.url, title: active.title } : null} review={reading.page && liveMarks.reading.has(reading.page.path) ? { conversation: conversation.state.conversation } : null} />;
      case 'research':
        return <ResearchPage research={research} listPanels={listFor('research')} steps={research.page ? researchSteps(conversation.state.items, `research/${research.page.path}`) : []} busy={conversation.state.busy} asking={askingResearch} onAskDone={() => setAskingResearch(false)} onAsk={onResearch} review={research.page && liveMarks.research.has(research.page.path) ? { conversation: conversation.state.conversation } : null} />;
      case 'views':
        return (
          <ViewPage
            views={views}
            apps={viewApps}
            review={views.page && viewMarks.has(views.page.path) ? { conversation: conversation.state.conversation } : null}
            onOpen={openViewTarget}
          />
        );
      case 'canvas':
        return <CanvasBoard boards={boards} review={boards.page && liveMarks.boards.has(boards.page.path) ? { conversation: conversation.state.conversation } : null} />;
      case 'code':
        return <CodeEditor code={code} onAsk={(prompt) => { if (!shows('agent')) setChatOpen(true); void conversation.send(prompt, surface.code ? [sheetItem(surface.code)] : []); }} onDraft={startWithMobius} listPanels={listFor('code')} terminal={<TerminalPanel term={terminal} onAsk={askAboutTerminal} />} review={code.open && code.project && liveMarks.code.has(`${code.project}/${code.open.path}`) ? { conversation: conversation.state.conversation, settled: !conversation.state.busy } : null} />;
      case 'mail':
        return <MailPage mail={mail} onDraftReply={onDraftReply} />;
      case 'messages':
        return <MessagesPage messages={chat} listPanels={listFor('messages')} onAddAccount={() => openSettingsAt('messages')} />;
      case 'sheets':
        return <SheetGrid sheets={sheets} review={sheets.data && liveMarks.sheets.has(sheets.data.workbook) ? { conversation: conversation.state.conversation } : null} working={conversation.state.busy} />;
      case 'calendar':
        return <CalendarPage calendar={calendar} newToken={eventToken} show={showEvent} me={myAddresses} onMeeting={(event) => void recordMeeting(event)} review={liveMarks.calendars.size > 0 ? { conversation: conversation.state.conversation, calendars: [...liveMarks.calendars] } : null} working={conversation.state.busy} />; // Calendar app: what Mobius's last turn changed
      case 'agent':
        // Agents app (marked): while the sidebar is on Agents, the main area is the chosen agent's page.
        if (inAgents) {
          return (
            <AgentPage
              view={agentView ?? { kind: 'show', id: botOfConversation(conversation.id, botIds) }}
              bots={bots.bots}
              loading={!bots.loaded}
              conversations={conversation.list}
              onShow={setAgentView}
              onCreate={bots.create}
              onUpdate={bots.update}
              onNewSession={(id) => { conversation.newConversation(id); setAgentView(null); setSideMode('sessions'); }}
              onOpenSession={(id) => { conversation.select(id); setSideMode('sessions'); }}
              onOpenSafety={() => openSettingsAt('safety')}
              onOpenSchedules={() => openSettingsAt('schedules')}
            />
          );
        }
        if (inChanges) return <ReviewPage review={review} onOpenFile={openChangedFile} onOpenConversation={(id) => { conversation.select(id); setSideMode('sessions'); }} />;
        if (inActivity) return <ActivityPage feed={activityFeed} conversations={conversation.list} active={conversation.id} onOpenConversation={(id) => { conversation.select(id); setSideMode('sessions'); }} onOpenApp={openApp} onOpenSchedules={() => openSettingsAt('schedules')} />;
        return (
          <ChatPanel
            surface={surface}
            onOpenItem={openTarget}
            variant="full"
            {...(chatAgent ? { hint: `Message ${chatAgent}` } : {})}
            desk={(starters) => (
              <Desk
                starters={starters}
                // Tasks due are in the Inbox, each with Done and Later, so In your apps does not say them again.
                rows={deskAppRows({ tabs: browser.tabs, mail: mail.messages, unread: mail.counts.all, dueToday: [], events: calendar.events, notes: notes.notebooks, docs: docs.notebooks }, new Date())}
                onOpenTarget={openTarget}
                changed={changed}
                activity={activity}
                conversations={conversation.list}
                onOpenApp={openApp}
                onOpenConversation={conversation.select}
                onOpenSchedules={() => openSettingsAt('schedules')}
                opened={recentItems(12)}
                onOpenRecent={launch.openRecent}
                suggested={{ count: mail.counts.suggested, onOpen: () => { openApp('mail'); mail.setView({ kind: 'drafts', only: 'mobius' }); } }}
                pinned={homeView && <PinnedView path={homeView} apps={viewApps} onOpen={openViewTarget} onOpenView={(path, title) => { openApp('views'); void views.open(path, title); }} />}
                inbox={{
                  items: inboxItems({ dueToday: smartView('today', tasks.all, new Date()), projects: projects.list, suggested: wikiIncoming.waiting, mail: mail.messages, events: ahead.filter((e) => !calendar.hidden.has(e.calendar)), me: myAddresses }, new Date()),
                  onOpen: (item) => {
                    if (item.target) openTarget(item.target);
                    else if (item.project) { projects.setOpenId(item.project); openApp('projects'); }
                    else if (item.kind === 'suggested') { setWikiPlace({ kind: 'shared' }); openApp('wiki'); }
                  },
                  onDone: async (item) => (item.task ? tasks.complete(item.task.list, item.task.task) : true),
                }}
                background={{
                  items: handoffs.done,
                  by: (run) => { const on = botOfConversation(run.conversation, botIds); return on === MAIN_BOT_ID ? undefined : bots.bots.find((b) => b.id === on)?.name; },
                  onOpen: (run) => { handoffs.drop(run.conversation); conversation.select(run.conversation); openRight(); setFocusToken((n) => n + 1); },
                  // Keeping an Ability's run is what saves its job: from then on, that job offers it no more.
                  onKeep: (run) => { if (run.item?.startsWith(ABILITY_ITEM)) markSaved(run.item.slice(ABILITY_ITEM.length)); handoffs.keep(run); },
                  // Save as Ability: Mobius writes it from the job's own steps, in a chat of its own; the new Ability
                  // lands in the Inbox to Keep, like any change.
                  onSaveAbility: (run) => void (async () => {
                    // Held before anything is awaited, so a second press starts nothing; once its run is listed, that
                    // run hides the offer until it fails, is stopped, or is kept.
                    const listed = readRuns().some((x) => x.item === `${ABILITY_ITEM}${run.conversation}` && !x.stopped && conversation.list.find((c) => c.id === x.conversation)?.activity !== 'failed');
                    if (savingAbility.current.has(run.conversation) || listed) return;
                    savingAbility.current.add(run.conversation);
                    try {
                      const job = jobSteps(await window.mobius.agent.history(run.conversation).catch(() => []));
                      const result = await conversation.assign(abilityAsk(run.ask, job), [], 'skills', { tools: ['skills', 'files'] });
                      if ('error' in result) { setToast(`Mobius could not save it: ${result.error}`); return; }
                      handoffs.start(result.id, `Ability from ${run.ask}`, undefined, undefined, `${ABILITY_ITEM}${run.conversation}`);
                      setToast('Mobius is writing it as an Ability. It will be in your Inbox to keep.');
                    } finally { savingAbility.current.delete(run.conversation); }
                  })(),
                  onDone: (run) => handoffs.drop(run.conversation),
                }}
                // First run: once a model answers, mail and calendar are what make its answers about the person's own day.
                {...(settings?.configured && (mail.accounts.length === 0 || calendar.accounts.length === 0) ? { connect: { mail: mail.accounts.length === 0, calendar: calendar.accounts.length === 0, onMail: () => openSettingsAt('mail'), onCalendar: () => openSettingsAt('calendar') } } : {})}
              />
            )}
            state={conversation.state}
            settings={settings}
            coreReady={coreStatus === 'ready'}
            onSend={sendAsked}
            onDrive={driveTasks}
            onStop={conversation.stop}
            onTakeOver={conversation.takeOver}
            appCard={<>{app === 'sheets' && <SheetsGlance />}{app === 'tasks' && <TasksGlance tasks={tasks} />}{app === 'calendar' && <CalendarGlance calendar={calendar} />}{app === 'code' && <CodeGlance tests={code.tests} onDebug={debugTest} />}{inMail ? <MailActions open={mail.open} unread={mail.messages.filter((m) => !m.seen).length} onTriage={triageMail} onChanged={() => void mail.refresh()} /> : <SideThreads projects={projects} conversation={conversation.state.conversation} bots={bots.bots} onOpen={(id) => { conversation.select(id); openApp('agent'); }} />}</>}
            onOpenMail={(id) => { openApp('mail'); void mail.read(id); }}
            onHandBack={handBack}
            onAnswer={conversation.answer}
            onReply={conversation.reply}
            onSaveSettings={saveSettings}
            focusToken={focusToken}
            incoming={incoming}
            onShowTab={(tab) => { openApp('browser'); window.mobius.browser.activate(tab); }}
            conversations={conversation.list}
            activeConversation={conversation.id}
            onNewConversation={() => conversation.newConversation()}
            onSelectConversation={conversation.select}
            onOpenSettings={(section) => (section ? openSettingsAt(section) : openSettings())}
            onOpenAbilities={() => { closeSettings(); openApp('skills'); }}
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

  // What the agent's message box suggests asking about where the person is ("Ask about your mail"). With nothing
  // particular to point at, it keeps its own "Message Mobius".
  const asked = settingsOpen ? 'Ask about settings' : askAbout(app, !!surface.note || (inBrowser && surface.hasPage) || (inSheets && !!sheets.data) || (inPhoto && !!photos.open) || (inVideo && !!video.project) || (inCode && !!code.open));
  // In one of the person's own agents' chats, the box names that agent instead ("Message Handy").
  const chatBot = botOfConversation(conversation.id, botIds);
  const chatAgent = chatBot === MAIN_BOT_ID ? undefined : bots.bots.find((b) => b.id === chatBot)?.name;
  const askHint = chatAgent ? `Message ${chatAgent}` : asked === 'Ask Mobius' ? undefined : asked;
  // The agent's panel: beside the page, or in the sidebar.
  const chatPanel = (pinned: React.ReactNode) => (
          <ChatPanel
              takeFocus={!(rightFloating && peeked)}
              surface={surface}
              onOpenItem={openTarget}
            state={conversation.state}
            settings={settings}
            coreReady={coreStatus === 'ready'}
            onSend={sendAsked}
            onDrive={driveTasks}
            onStop={conversation.stop}
            onTakeOver={conversation.takeOver}
            appCard={<>{app === 'sheets' && <SheetsGlance />}{app === 'tasks' && <TasksGlance tasks={tasks} />}{app === 'calendar' && <CalendarGlance calendar={calendar} />}{app === 'code' && <CodeGlance tests={code.tests} onDebug={debugTest} />}{inMail ? <MailActions open={mail.open} unread={mail.messages.filter((m) => !m.seen).length} onTriage={triageMail} onChanged={() => void mail.refresh()} /> : <SideThreads projects={projects} conversation={conversation.state.conversation} bots={bots.bots} onOpen={(id) => { conversation.select(id); openApp('agent'); }} />}</>}
            onOpenMail={(id) => { openApp('mail'); void mail.read(id); }}
            onHandBack={handBack}
            onAnswer={conversation.answer}
              onReply={conversation.reply}
            onSaveSettings={saveSettings}
            focusToken={focusToken}
            incoming={incoming}
            onShowTab={(tab) => { openApp('browser'); window.mobius.browser.activate(tab); }}
            conversations={conversation.list}
            activeConversation={conversation.id}
            onNewConversation={() => conversation.newConversation()}
            onSelectConversation={conversation.select}
            onOpenSettings={(section) => (section ? openSettingsAt(section) : openSettings())}
            onOpenAbilities={() => { closeSettings(); openApp('skills'); }}
            onRetry={conversation.retry}
            onEdit={conversation.edit}
            onDetails={conversation.toolDetails}
              effort={preferences.value.reasoningEffort}
              onEffort={(reasoningEffort) => void preferences.set({ reasoningEffort })}
              onModelChanged={() => void reloadSettings()}
            pin={pinned}
            place={settingsOpen ? 'Settings' : appName(app)}
            onPlace={openHub}
            menuItems={rightOpen ? [{ label: rightFloating ? 'Dock Mobius' : 'Float Mobius', onSelect: () => void appearance.set({ rightSidebar: rightFloating ? 'attached' : 'floating' }) }] : undefined}
            onHide={hideRight}
            {...(window.mobius.mini ? { onPopOut: toggleMini } : {})}
            onOpenVoice={() => openSettingsAt('voice')}
            {...(askHint ? { hint: askHint } : {})}
          />
  );
  // The browser's own controls: back, forward, reload and the address, in the toolbar's middle (five zones).
  const browserChrome = (
    <BrowserChrome
      active={active}
      saved={saved}
      selectionMenu={selectionMenu}
      setSelectionMenu={setSelectionMenu}
      selectionReady={cover !== null}
      onSelection={(action) => void webSelection(action)}
      clipTo={clipTarget?.title ?? 'Clippings'}
      clipPages={clipPages}
      onClipTo={clipToPage}
      address={address}
      draft={draft}
      setDraft={setDraft}
      notice={notice}
      setNotice={setNotice}
      onSubmit={submit}
      onSuggesting={setAddressSuggesting}
      findOpen={findOpen}
      finding={finding}
      onCloseFind={() => setFindOpen(false)}
      reading={inReader}
      shownUrl={inReader && reading.page ? parseArticle(reading.text).url : null}
      onRead={() => { if (inReader) { openApp('browser'); return; } if (!active) return; void saveToReader(reading, active.url).then((done) => { if (!done.ok) { setToast(done.message); return; } openApp('reader'); void reading.open(done.path, active.title); }); }}
    />
  );
  // The menus, as one ⋯ button at the toolbar's trailing end, just before Mobius.
  // The one ⋯: the shell's menus, with the open app's own commands (AppMenu) in its menu, which the ⋯ opens on. On
  // macOS the shell's menus are in the system menu bar, so the ⋯ holds only the app's own.
  const menuBar = (own: AppMenuState | null) => {
    const withOwn = withAppMenu(nativeMenus ? [] : menus, own);
    return withOwn.length ? <MenuBar menus={withOwn} compact onOpenChange={setMenuOpen} /> : null;
  };
  // Mobius, the one panel the shell owns: in the View menu (or the Panels button on macOS).
  const shellPanels: ShellPanel[] = hasRight ? [{ name: 'Mobius', shown: chatOpen, toggle: () => setChatOpen((open) => !open) }] : [];
  // Try another, from any review bar: Mobius is told its change was put back and asked to do it differently.
  const tryAnother = settings?.configured && !conversation.state.busy
    ? () => { if (!shows('agent')) setChatOpen(true); void conversation.send(TRY_ANOTHER_ASK, []); }
    : null;

  // A fact Mobius took from something the person wrote ("Notes · <title>", "Docs · <title>", "Knowledge · <title>",
  // "Slides · <title>", "Tasks · <list>") opens it from its card. A note's lines are tinted for a moment when it shows.
  const claimSource = (source: string, words: string) => {
    const note = noteForSource(source, notes.notebooks);
    if (note) return { label: 'Open note', open: () => { citeWhenOpen(note.page.path, words); openTarget({ app: 'notes', path: note.page.path, title: note.page.title }); } };
    const doc = pageForSource(source, 'Docs', docs.notebooks);
    if (doc) return { label: 'Open document', open: () => openTarget({ app: 'docs', path: doc.page.path, title: doc.page.title }) };
    const deck = pageForSource(source, 'Slides', slides.notebooks);
    if (deck) return { label: 'Open deck', open: () => openTarget({ app: 'slides', path: deck.page.path, title: deck.page.title }) };
    const page = pageForSource(source, 'Knowledge', wiki.notebooks);
    if (page) return { label: 'Open page', open: () => { closeSettings(); setWikiPlace({ kind: 'page' }); openApp('wiki'); void wiki.open(page.page.path, page.page.title); } };
    const list = listForSource(source, tasks.lists.map((l) => l.name));
    if (list) return { label: 'Open list', open: () => openTarget({ app: 'tasks', list }) };
    return null;
  };

  return (
    <TryAnotherContext.Provider value={tryAnother}>
    <ClaimSources.Provider value={claimSource}>
    <AppFrame
      openRight={openRight}
      mobiusAsked={`${focusToken}:${incoming?.token ?? 0}:${lastWaiting.current}`}
      data={{ 'data-keys-ready': keysReady || undefined, 'data-platform': window.mobius.platform, 'data-app': app, 'data-density': COMPACT_APPS.has(app) && !settingsOpen ? 'compact' : undefined, 'data-settings': settingsOpen || undefined, 'data-chat': rightOpen ? 'open' : 'closed' }}
      toolbar={{
        // Settings: over the Browser, Settings shows its page title, not the hidden address bar.
        wideMiddle: inBrowser && !settingsOpen,
        appControls: !settingsOpen,
        lead: <>
          {/* The Go button (docs/design/panel-layouts.md): where you are, and the way to anywhere else (the launcher). */}
          <GoButton app={settingsOpen ? 'settings' : app === 'reader' ? 'browser' : app} {...(!settingsOpen && app === 'agent' ? { name: inAgents ? 'Agents' : 'Home' } : {})} waiting={waitingTotal} {...(keysReady && bindings.launcher ? { keys: describeCombo(bindings.launcher, window.mobius.platform) } : {})} open={launcherOpen} onOpen={openLauncher} />
        </>,
        // The open document's name, or the app's when nothing is open, so the title bar is never blank: the Go button shows
        // only the app's icon (Andrew, 21 November 2026), so the title names Home, Messages and Research too.
        // Files inside a nested folder: the path as a breadcrumb, each part opening its folder.
        title: inFiles && !settingsOpen ? <FilesCrumbs files={files} /> : place || (settingsOpen ? undefined : app === 'agent' ? (inAgents ? 'Agents' : 'Home') : appName(app)),
        // Settings (marked, panel look): "Settings", then the section in grey.
        sub: settingsOpen ? (settingsTitle !== 'Settings' ? settingsTitle : undefined) : inAgents ? (shownAgent ? agentWhen(shownAgent, agentSchedulesList) : undefined)
          : inActivity ? activitySub(activityFeed, conversation.list) // Activity: what happened today, what waits
          // Home: when the open conversation was last active; the model lives in the composer.
          : inAgent ? (!settings?.configured ? 'No model connected' : ((c) => (c ? agoLabel(c.updated_ms, new Date()) : undefined))(conversation.list.find((c) => c.id === conversation.id)))
          : inNotes && notes.page ? <>{notes.page.path.split('/')[0]} · <span className="note-status" role="status" data-status={notes.status}>{notes.message || statusText(notes.status)}</span></>
          // Docs (marked, Docs' own line): the document's folder and whether it is saved, as Notes has it.
          : inDocs && docs.page ? <>{liveTitle(docs.text, docs.page.title || appName(app))} · <span className="note-status" role="status" data-status={docs.status}>{statusText(docs.status)}</span></>
          : inReader && reading.page ? readerSub(reading.text) // Reader: the site the article came from
          : inMail ? (mail.accounts.length === 0 ? 'No account yet' : mail.counts.all === 0 ? 'Nothing unread' : `${mail.counts.all} unread`)
          : inMessages && !chatSpaceSetup && chat.account && chat.channel ? `${chat.account.name} · ${SERVICE_NAMES[chat.account.service]}` // Messages: the account it is in
          : inSheets && sheets.data ? sheets.data.sheet
          // Calendar: the week number in Week view (short, so it fits beside the controls), otherwise what today holds.
          : inCalendar ? calendarRange(calendar.mode, calendar.anchor)
          // Tasks: what is left to do, or in Completed, how many are done.
          : inTasks ? (tasks.view.kind === 'list' ? tasks.view.name : smartName(tasks.view.id)) // Tasks: the open list
          : inFiles ? filesSub(files) // Files: how many items
          : inSkills ? <AbilitiesSub place={extPlace} skills={skills} /> // Abilities (marked)
          : inStudio && songs.page ? <StudioSub songs={songs} /> // Music (marked, Music's own): the song's key and whether it is saved
          : inDatabase ? databaseSub(databases) // Database: the table's database and columns
          : inBrowser && active && /^https?:/.test(active.url) ? hostOf(active.url) // Browser (marked): the page's site, grey after its title
          : undefined,
        middle: <>
        </>,
        // Words and icons never share a capsule: the update notice stands on its own, before the icons.
        status: <><span className="core-status" role="status" data-state={coreStatus}>{CORE_LABEL[coreStatus]}</span><div className="strip-texts"><UpdateNotice /></div></>,
        // The Panels menu: the sidebar, the open app's own panels, Mobius, and Reset layout.
        // Settings too: its Sections panel and Mobius, as in every app.
        // The title row's menus, everywhere but macOS, whose menus are in the system menu bar.
        ...(nativeMenus ? {} : { menus: (own: AppMenuState | null, panels: PanelsOfApp | null) => <TitleMenus menus={menus} own={own} panels={panels} shell={shellPanels} onOpenChange={setMenuOpen} /> }),
        panels: (own) => (
          <PanelsMenu
            app={own}
            shell={shellPanels}
            describeKeys={(keys) => describeCombo(keys, window.mobius.platform)}
            onReset={() => {}}
          />
        ),
        trail: (appMenu) => <>
          <CommentButton on={commenting} count={openComments.length} suggestions={openSuggestions} onToggle={() => setCommenting((on) => !on)} />
          {/* Agents app (marked): Run now, the one filled button, before the More menu. */}
          {shownAgent && agentView?.kind !== 'new' && !(agentView?.kind === 'show' && agentView.editing) && (shownAgent.id === MAIN_BOT_ID
            ? <button type="button" className="btn primary agent-run" onClick={() => { conversation.startFresh(MAIN_BOT_ID); setAgentView(null); setSideMode('sessions'); }}>New session</button>
            : <button type="button" className="btn primary agent-run" onClick={() => { setAgentRun({ bot: shownAgent.id, text: shownAgent.instructions.trim() || shownAgent.name }); conversation.startFresh(shownAgent.id); setAgentView(null); setSideMode('sessions'); }}>Run now</button>)}
          {nativeMenus ? menuBar(appMenu) : appMenu && <MenuBar menus={[{ id: 'more', label: 'More', items: entryItems(appMenu.entries, 'more') }]} compact label="More" onOpenChange={setMenuOpen} />}
          {/* Mobius at work with its panel closed: what it is doing, with Stop; a press shows it. */}
          {hasRight && !rightOpen && activity && <WorkingPill activity={activity} onOpen={() => { openRight(); setFocusToken((n) => n + 1); }} onStop={conversation.stop} onPause={conversation.takeOver} onResume={() => handBack()} />}
          {hasRight && <MobiusButton open={rightOpen} toggle={toggleMobius} />}
        </>,
      }}
    >
      <div className="body" style={layout}>
        {/* An app's own controls go in the toolbar's middle from wherever the app is drawn (ui/AppFrame). */}
        {(inBrowser || inReader) && !settingsOpen && browserChrome}
        <main className="stage" tabIndex={-1} data-split={split || undefined} data-edge-right={(hasRight && rightFloating && !chatOpen) || undefined} style={split ? ({ '--split': `${(splitDrag ?? share) * 100}%` } as React.CSSProperties) : undefined}>
          {/* Settings' sections are its own left panel, as an app's list is. */}
          {settingsOpen && (
            <div className="settings-frame">
            <PanelLayout app="settings" panels={settingsPanels}>
            <SettingsPage
              {...(settingsSection === 'layout' ? { initial: 'appearance' as const, initialSubpage: 'layout' } : settingsSection === 'voice' ? { initial: 'model' as const, initialSubpage: 'speaking' } : settingsSection === 'profiles' ? { initial: 'advanced' as const, initialSubpage: 'profiles' } : settingsSection ? { initial: settingsSection } : {})}
              onClose={() => { setSettingsSection(undefined); closeSettings(); }}
              onOpenApp={(id) => { setSettingsSection(undefined); closeSettings(); openApp(id); }}
              sidebar={settingsSlot}
              onTitle={setSettingsTitle}
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
              ownsNav
            />
            </PanelLayout>
            </div>
          )}
          {(split ? ([0, 1] as const) : ([focused] as const)).map((index, at) => {
            const id = split ? (panes[index] ?? app) : app;
            const pane = (
              <Pane key={`pane-${at}`} index={index} app={id} split={split} focused={focused === index}
                onFocus={() => { if (split && focused !== index) setFocused(index); }}
                onChoose={(next) => choosePane(index, next)} onSwap={swapPanes} onClose={() => closePane(index)}>
                {/* The apps show the current conversation's changes as they land; their Keep waits for its turn to end. */}
                <PanelsListed on={!split || focused === index}>
                  {/* Pieces sit at the window's right: in split view, in the right pane only, so each shows once. */}
                  <ShellPanelsContext.Provider value={!split || index === 1 ? piecePanels : NO_PANELS}>
                    <TurnRunningContext.Provider value={conversation.state.busy}>{withOwnList(id, paneContent(id))}</TurnRunningContext.Provider>
                  </ShellPanelsContext.Provider>
                </PanelsListed>
              </Pane>
            );
            return at === 1
              ? [<SplitDivider key="divider" share={splitDrag ?? share} onDrag={setSplitDrag} onCommit={(next) => { setShare(next); saveShare(next); }} />, pane]
              : [pane];
          })}
          {toast && <div className="toast" role="status">{toast}</div>}
          {askHere && <AskHere picked={askHere.picked} here={hereOf(surface)} app={app} chat={askHere.chat} onClose={() => closeAskHere()}
            {...(!askHere.picked.cells && askHere.range && askHere.back instanceof HTMLElement && askHere.back.isContentEditable ? { onReplace: (text: string) => closeAskHere(text) } : {})}
            onContinue={(id) => { setAskHere(null); conversation.select(id); openRight(); setFocusToken((n) => n + 1); }} />}
          {/* An alert, unless the meeting's own nudge is already saying it is starting. */}
          {alerting && !(starting && meetingKey(starting) === meetingKey(alerting.event)) && <UndoToast text={alerting.said} undoLabel="Open" onUndo={() => { const day = new Date(`${alerting.event.start.slice(0, 10)}T12:00:00`); setAlerting(null); closeSettings(); openApp('calendar'); if (!Number.isNaN(day.getTime())) calendar.setAnchor(day); }} onDismiss={() => setAlerting(null)} />}
          {starting && <UndoToast text={`${starting.title.trim() || 'A meeting'} is starting`} undoLabel="Record" onUndo={() => { const event = starting; setStarting(null); void recordMeeting(event); }} onDismiss={() => setStarting(null)} />}
        </main>
        {/* The inspector: the open app's own panels (PanelTab), between the content and Mobius. */}
        <InspectorDock />
        {rightOpen && (
          <div ref={rightDock} className="dock right" data-floating={rightFloating || undefined}>
            {/* The Mobius panel is just Mobius: never a tab, never sharing its dock. */}
            {chatPanel(null)}
            {resizer('right', 'Resize Mobius')}
          </div>
        )}
        {learnOpen && (
          <div className="dock right" data-learn>
            <LearnPanel lessons={LESSONS} app={app} onClose={closeLearn} onOpenApp={(id) => { closeSettings(); openApp(id); }} />
            {resizer('right', 'Resize Learn')}
          </div>
        )}
        {hasRight && rightFloating && !chatOpen && <div className="hotzone right" data-testid="hotzone-right" onPointerEnter={() => { rightFromEdge.current = true; setPeeked(true); setChatOpen(true); }} />}
      </div>
      <SideHeadMenu />
      <AppHub
        open={hubOpen}
        onClose={closeHub}
        current={app}
        onOpenApp={(id) => { closeSettings(); openApp(id); }}
        onConnect={() => { closeSettings(); setExtPlace('connectors'); openApp('skills'); }}
        own={ownApps}
        status={hubStatus}
        actions={createActions}
      />
      <CommentLayer
        app={app}
        doc={commentDoc}
        on={commenting}
        onOff={() => setCommenting(false)}
        threads={commentThreads.threads}
        save={commentThreads.save}
        focus={commentFocus}
        conversation={conversation.id}
        onSend={async (text, context) => {
          if (!settings?.configured) return false;
          setChatOpen(true);
          await conversation.send(text, context);
          return true;
        }}
      />
      <Launcher open={launcherOpen} again={launcherAgain} onClose={closeLauncher} tabs={browser.tabs} onNewTab={newTab} onActivateTab={launch.activateTab} onOpenApp={launch.openApp}
        pinned={appearance.value.sidebarApps}
        onPinned={(sidebarApps) => void appearance.set({ sidebarApps: sidebarApps as typeof appearance.value.sidebarApps })}
        waiting={waiting}
        home={launcherHome}
        about={launcherAbout}
        onOpenUrl={showPage}
        clipboard={clipboardHistory}
        system={systemSearch}
        recent={launcherOpen ? recentItems() : []}
        onOpenRecent={launch.openRecent}
        find={launch.find}
        scopeTo={launcherScope}
        recentIn={launcherRecentIn}
        makeIn={launcherMakeIn}
        places={launch.places}
        onOpenMobius={launch.openMobius}
        onAsk={launch.ask}
        askInline={settings?.configured ? askInline : undefined}
        onContinue={(id) => { conversation.select(id); launch.openMobius(); }}
        onAskAbout={launch.askAbout}
        commands={allCommands} />
      <TooltipLayer />
    </AppFrame>
    </ClaimSources.Provider>
    </TryAnotherContext.Provider>
  );
}
