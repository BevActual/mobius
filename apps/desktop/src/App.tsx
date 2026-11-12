import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { MenuBar } from './MenuBar';
import { buildMenus, type MenuContext, findItem, menusAsData } from './menus';
import { sendCommand } from './commands';
import { MAIN_BOT_ID, conversationIdFor, MAX_CONTEXT_ITEM_CHARS, MAX_FAVOURITES, type Favourite, actionForPress, describeCombo, botOfConversation, type ContextItem, type KeyPress, type MailContent, type NoteComment, type SidebarMode } from '@mobius/shared';
import { commentsOutline } from './NoteComments';
import { rememberTitles } from './ReviewStrip';
import { appName, askAbout, findApp, isAvailable, isInstalled, setInstalledApps, type AppId, noteOpened, APPS } from './apps';
import { databaseOutline, noteContext, suggestionsFor, tasksContext, type SurfaceState } from './surface';
import { trayShown, type TrayShown } from './tray';
import { ChatPanel } from './ChatPanel';
import { growFrom, morphOut, useMorphIn } from './motion';
import { ConversationSidebar, type SideMode } from './ConversationSidebar';
import { useBookmarks } from './useBookmarks';
import { useArchive } from './useArchive';
import { useBots } from './useBots';
import { useDownloads } from './useDownloads';
import { Launcher } from './Launcher';
import { Resizer } from './Resizer';
import { useAutoHide } from './useAutoHide';
import { useSideFolds } from './side-fold';
import { UpdateNotice } from './UpdateNotice';
import { pressOf, takeEarlyKeys } from './early-keys';
import { CommentButton, CommentLayer, CommentsGroup, useCommentThreads, useOpenComments } from './Comments';
import type { Side } from './resize';
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
import { CalendarPage, CalendarSidebar } from './Calendar';
import { DEFAULT_FOLDER, DocEditor, DocsSidebar, type WritingTool } from './Docs';
import { SheetGrid, SheetsSidebar } from './Sheets';
import { MailPage, MailSidebar } from './Mail';
import { SlidesEditor, SlidesSidebar, type SlidesTool } from './Slides';
import { useMail } from './useMail';
import { useSheets } from './useSheets';
import { useCode } from './useCode';
import { CodeEditor, CodeSidebar } from './Code';
import { DesignEditor, DesignSidebar } from './Design';
import { CanvasBoard, CanvasSidebar } from './Canvas';
import { ResearchPage, ResearchSidebar } from './Research';
import { ReaderPage, ReaderSidebar, saveToReader } from './Reader';
import { DatabasePage, DatabaseSidebar } from './Database';
import { useDatabases } from './useDatabases';
import { TerminalPage, TerminalSidebar } from './Terminal';
import { useTerminal } from './useTerminal';
import { ReviewPage, ReviewSidebar, useReview } from './Review';
import { BrowserChrome, BrowserPage, BrowserSidebar } from './Browser';
import { PhotoEditor, PhotoSidebar } from './Photo';
import { StudioEditor, StudioSidebar } from './Studio';
import { VideoEditor, VideoSidebar } from './Video';
import { SkillEditor } from './Skills';
import { ExtensionsPage, ExtensionsSidebar, type ExtensionPlace } from './Extensions';
import { FilesPage, FilesSidebar, useFiles } from './Files';
import { MailPlanCard } from './MailPlan';
import { ProjectPage, ProjectsSidebar, SideThreads, useProjects } from './Projects';
import { HowIWork, SharedQueue, WikiSidebar, WikiVersions, useWikiIncoming, type WikiPlace } from './Wiki';
import { useSkills } from './useSkills';
import { expandSlash } from './skill-format';
import { useVideo } from './useVideo';
import { writeCut } from './cut-format';
import { usePhotos } from './usePhotos';
import { editsPathFor } from './photo-edit';
import { sheetContext } from './sheets-view';
import { openOnChanges } from './open-on-changes';
import { changeTarget, toolTarget } from './actions';
import { heading as calendarHeading, eventsOn } from './calendar-view';
import { Desk } from './Desk';
import { APP_ICONS, Rail } from './Rail';
import { AppHub, type HubAction } from './AppHub';
import { nest, smartName, smartView } from './tasks-view';
import { SearchPage, SearchSidebar } from './SearchPage';
import type { HubFilter } from './search-hub';
import { activityOf } from './activity';
import type { HubTarget } from './search-hub';
import { useTasks } from './useTasks';
import { useCalendar } from './useCalendar';
import { useTurnChanges } from './useTurnChanges';
import { NoteEditor, type SelectionAction } from './NoteEditor';
import { liveTitle, statusText } from './notes-state';
import { Pane, SplitDivider } from './SplitView';
import { type ClipPage, type WebSelectionAction } from './SelectionMenu';
import { LearnPanel } from './LearnPanel'; // Learn (shell/learn-view)
import { LESSONS } from './learn'; // Learn (shell/learn-view)
import { clipToNotes } from './clip';
import { loadPanes, savePanes, companionFor, followPane, loadShare, saveShare } from './split';
import { TRY_ANOTHER_ASK, TryAnotherContext } from './ReviewBar';

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

/** A button's tooltip with its shortcut after it, when it has one. */
const withKeys = (text: string, binding: string) => (binding ? `${text} (${describeCombo(binding, window.mobius.platform)})` : text);

/** Who is using a tab while a task runs, as the tab says it. */

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
  // The apps added from Abilities decide what opens, what the switcher lists and what loads.
  setInstalledApps(preferences.value.installedApps);
  const bookmarks = useBookmarks();
  const notes = useNotes();
  const docs = useNotes('docs');
  // Apps load when they are first opened, not at start: an app never opened reads nothing (Abilities).
  const [opened, setOpened] = useState<ReadonlySet<AppId>>(() => new Set(loadPanes().filter((id): id is AppId => id !== null)));
  const used = (id: AppId) => opened.has(id) && isInstalled(id);
  const slides = useNotes('slides', used('slides'));
  const designs = useNotes('designs', used('design'));
  const boards = useNotes('boards', used('canvas'));
  const research = useNotes('research', used('research'));
  const reading = useNotes('reading', used('reader'));
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
  const databases = useDatabases(used('database'));
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
  const tasks = useTasks();
  const calendar = useCalendar();
  const [eventToken, setEventToken] = useState(0);
  const bindings = preferences.value.keybindings;
  // Clicking a notification brings Mobius forward; show the conversation it was about.
  useEffect(() => window.mobius.app.onOpenConversation((id) => { conversation.select(id); setChatOpen(true); }), [conversation.select]);
  // Once the saved choices are known, apply the ones that only matter at start-up, once.
  useEffect(() => {
    if (!appearance.loaded || startedUp.current) return;
    startedUp.current = true;
    if (!appearance.value.sidebarAtStart || appearance.value.leftSidebar === 'floating') setPanelOpen(false);
    if (appearance.value.leftSidebar === 'floating') setAgentListOpen(false);
    if (appearance.value.agentPlace === 'beside' && appearance.value.rightSidebar !== 'floating') setChatOpen(true);
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
  const split = panes[1] !== null && !narrow;
  const other: AppId | null = split ? (focused === 0 ? panes[1] : panes[0]) : null;
  useEffect(() => {
    setOpened((was) => (was.has(app) && (other === null || was.has(other)) ? was : new Set([...was, app, ...(other ? [other] : [])])));
  }, [app, other]);
  const panesNow = useRef({ panes, focused });
  panesNow.current = { panes, focused };
  /** Open an app in the focused pane. If the other pane already shows it, go there instead. */
  const setApp = useCallback((id: AppId) => {
    const { panes: [a, b], focused: f } = panesNow.current;
    if (b !== null && (f === 0 ? b : a) === id) { setFocused(f === 0 ? 1 : 0); return; }
    // The conversation stays in a split: another app goes in the other pane, which then has the focus.
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
  const inDocs = app === 'docs';
  const inSlides = app === 'slides';
  const inSheets = app === 'sheets';
  const inMail = app === 'mail';
  const inCode = app === 'code';
  const inDesign = app === 'design';
  const inCanvas = app === 'canvas';
  const inResearch = app === 'research';
  const inReader = app === 'reader';
  const inWiki = app === 'wiki';
  const inProjects = app === 'projects';
  const inDatabase = app === 'database';
  const inTerminal = app === 'terminal';
  const inReview = app === 'review';
  const inFiles = app === 'files';
  const inPhoto = app === 'photo';
  const inStudio = app === 'studio';
  const inVideo = app === 'video';
  const inSkills = app === 'skills';
  const [extPlace, setExtPlace] = useState<ExtensionPlace>('apps');
  const inTasks = app === 'tasks';
  const inCalendar = app === 'calendar';
  const inSearch = app === 'search';
  // Where Search looks: shared by its sidebar's scopes and the page's own.
  const [searchFilter, setSearchFilter] = useState<HubFilter>('all');
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
  const docsNow = useRef(docs);
  docsNow.current = docs;
  const slidesNow = useRef(slides);
  slidesNow.current = slides;
  const sheetsNow = useRef(sheets);
  sheetsNow.current = sheets;
  const designsNow = useRef(designs);
  designsNow.current = designs;
  const boardsNow = useRef(boards);
  boardsNow.current = boards;
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
      if (c.by === 'assistant' && showBeside('calendar')) return;
      mark('calendar');
    });
    return () => { offNotes?.(); offTasks?.(); offDocs?.(); offSheets?.(); offSlides?.(); offMail?.(); offCalendar?.(); offDesigns?.(); offBoards?.(); offResearch?.(); offReading?.(); offDatabases?.(); };
  }, [showBeside]);
  const [searchFocus, setSearchFocus] = useState(0);
  // Going to an app leaves Settings (from the launcher, a shortcut or a link), so the app chosen is the one showing.
  // An app not added yet opens Abilities, where it can be added.
  const openApp = useCallback((id: AppId) => {
    if (isAvailable(id)) { setApp(id); setSettingsOpen(false); }
    else if (findApp(id)?.available) { setExtPlace('apps'); setApp('skills'); setSettingsOpen(false); }
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
  const surface: SurfaceState = {
    app,
    hasPage: active !== undefined && /^https?:/.test(active.url),
    note: inNotes && notes.page ? { path: notes.page.path, title: notes.page.title, text: notes.text } : inDocs && docs.page ? { path: docs.page.path, title: liveTitle(docs.text, docs.page.title), text: docs.text, folder: 'docs', ...(docComments.page === docs.page.path && docComments.outline ? { extra: docComments.outline } : {}) } : inSlides && slides.page ? { path: slides.page.path, title: slides.page.title, text: slides.text, folder: 'slides' } : inDesign && designs.page ? { path: designs.page.path, title: designs.page.title, text: designs.text, folder: 'designs' } : inStudio && songs.page ? { path: songs.page.path, title: songs.page.title, text: songs.text, folder: 'studio' } : inCanvas && boards.page ? { path: boards.page.path, title: boards.page.title, text: boards.text, folder: 'boards' } : inResearch && research.page && !askingResearch ? { path: research.page.path, title: liveTitle(research.text, research.page.title), text: research.text, folder: 'research' } : inReader && reading.page ? { path: reading.page.path, title: reading.page.title, text: reading.text, folder: 'reading' } : inTerminal && lastTerminal ? { path: lastTerminal.cwd || '~', title: `Terminal: ${lastTerminal.command}`.slice(0, 120), text: `$ ${lastTerminal.command}   (in ~/${lastTerminal.cwd})\n${lastTerminal.result!.output.slice(-20_000)}\n${lastTerminal.result!.passed ? 'Exit code 0' : `Exit code ${lastTerminal.result!.code ?? 'none'}${lastTerminal.result!.timedOut ? ' (stopped: too long)' : ''}`}`, folder: 'terminal' } : inDatabase && databases.open ? { path: `${databases.open}.sqlite`, title: `Database ${databases.open}`, text: databaseOutline(databases.open, databases.list.find((d) => d.name === databases.open)?.tables ?? []), folder: 'databases' } : null,
    tasks: inTasks ? tasksContext(tasks) : null,
    mail: inMail && mail.open ? { id: mail.open.id, title: `Email: ${mail.open.subject || '(no subject)'}`, text: `From: ${mail.open.from.name} <${mail.open.from.email}>\nSubject: ${mail.open.subject}\nDate: ${mail.open.dateMs ? new Date(mail.open.dateMs).toString() : ''}\n\n${mail.open.text}` } : null,
    cut: inVideo && video.project ? { title: `Video: ${video.project}`, source: `video/${video.project}/cut.json`, text: `Clips in video/${video.project}/ (never change them):\n${video.clips.map((c) => `- ${c.name}${c.kind === 'audio' ? ' (sound)' : ''}: ${video.lengthOf(c.name) ?? '?'} s`).join('\n') || '(none yet)'}\n\nThe cut, video/${video.project}/cut.json:\n${writeCut(video.cut)}` } : null,
    photo: inPhoto && photos.open ? { title: `Photo: ${photos.open.path}`, source: `photos/${editsPathFor(photos.open.path)}`, picture: photos.open.dataUrl, text: `The photo: ${photos.described}\nThe picture itself is attached when your model reads pictures. Change only its edits file, photos/${editsPathFor(photos.open.path)}, keeping the format below.\n\n${JSON.stringify(photos.edits, null, 1)}` } : null,
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
  // The open profile, shown in the sidebar when it is not Personal.
  const [profileName, setProfileName] = useState<string | null>(null);
  useEffect(() => {
    void window.mobius.profiles?.list().then((p) => setProfileName(p.current === 'default' ? null : (p.list.find((x) => x.id === p.current)?.name ?? null))).catch(() => undefined);
  }, []);
  const activity = activityOf(conversation.state);
  const turnMarks = useTurnChanges(conversation.state.conversation, conversation.state.busy);
  // An app Mobius changed things in loads, so its changes show there when the turn ends, even if it was never opened.
  useEffect(() => {
    const touched: AppId[] = [];
    const add = (id: AppId, set: ReadonlySet<string>) => { if (set.size > 0) touched.push(id); };
    add('slides', turnMarks.slides); add('design', turnMarks.designs); add('canvas', turnMarks.boards); add('research', turnMarks.research);
    add('reader', turnMarks.reading); add('database', turnMarks.databases); add('photo', turnMarks.photos); add('studio', turnMarks.songs);
    add('video', turnMarks.video); add('sheets', turnMarks.sheets); add('code', turnMarks.code);
    if (touched.length > 0) setOpened((was) => (touched.every((id) => was.has(id)) ? was : new Set([...was, ...touched])));
  }, [turnMarks]);
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
  const place = settingsOpen ? settingsTitle : inProjects && projects.open ? projects.open.name : inBrowser ? (active?.title || appName(app)) : inAgent ? (conversation.list.find((c) => c.id === conversation.id)?.title || (projects.list.some((p) => p.threads.includes(conversation.id)) ? `New thread in ${projects.list.find((p) => p.threads.includes(conversation.id))!.name}` : 'New conversation')) : inNotes && notes.page ? liveTitle(notes.text, notes.page.title || appName(app)) : inDocs && docs.page ? liveTitle(docs.text, docs.page.title || appName(app)) : inSlides && slides.page ? (slides.page.title || appName(app)) : inSheets && sheets.data ? sheets.data.workbook : inSkills && skills.open ? `/${skills.open.name}` : inVideo && video.project ? video.project : inStudio && songs.page ? songs.page.title : inPhoto && photos.browsing ? (photos.album ?? appName(app)) : inPhoto && photos.open ? (photos.open.path.split('/').pop() ?? appName(app)) : inDesign && designs.page ? designs.page.title : inCanvas && boards.page ? boards.page.title : inResearch && research.page && !askingResearch ? liveTitle(research.text, research.page.title || appName(app)) : inReader && reading.page ? (reading.page.title || appName(app)) : inDatabase && databases.open ? databases.open : inTerminal ? (terminal.cwd ? `~/${terminal.cwd}` : 'Terminal') : inCode ? (code.open?.path.split('/').pop() ?? code.project ?? appName(app)) : inMail ? (mail.view.kind === 'drafts' ? 'Drafts' : mail.view.box === 'sent' ? 'Sent' : 'Inbox') : inTasks ? (tasks.view.kind === 'list' ? tasks.view.name : smartName(tasks.view.id)) : inCalendar ? calendarHeading(calendar.mode, calendar.anchor) : inBrowser ? appName(app) : '';
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
    database: some(databases.list.length, 'database'),
    review: (() => { const n = review.turns.reduce((s, t) => s + t.files.length, 0); return n ? `${plural(n, 'change')} to look at` : 'Nothing to review'; })(),
    terminal: terminal.processes.some((p) => p.running) ? `${plural(terminal.processes.filter((p) => p.running).length, 'command')} running` : 'Your workspace',
    research: some(research.notebooks.reduce((sum, nb) => sum + nb.pages.length, 0), 'report'),
    reader: some(reading.notebooks.filter((nb) => nb.name !== 'Archive').reduce((sum, nb) => sum + nb.pages.length, 0), 'article', ' to read'),
    mail: mail.accounts.length === 0 ? 'Add an account' : mail.counts.all > 0 ? `${mail.counts.all} unread` : 'All read',
    tasks: dueToday > 0 ? `${dueToday} due today` : openTasks > 0 ? `${openTasks} to do` : 'All done',
    calendar: eventsToday > 0 ? `${plural(eventsToday, 'event')} today` : 'Nothing today',
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
  // Where the agent sits when it is open: in the sidebar, which turns into Mobius (the default), or pinned beside the
  // page. Pinning is kept per computer.
  const chatPlace = appearance.value.agentPlace;
  const setChatPlace = (place: 'beside' | 'sidebar') => { void appearance.set({ agentPlace: place }); };
  // In the sidebar, Mobius waits to be asked and the app's own list shows; pinned beside, it is there from the start.
  const [chatOpen, setChatOpen] = useState(false);
  // Learn (shell/learn-view): lessons beside the page, in the slot Mobius uses when pinned beside. One at a time.
  const [learnOpen, setLearnOpen] = useState(false);
  const learnFrom = useRef<HTMLElement | null>(null);
  const [focusToken, setFocusToken] = useState(0);
  const [switcherToken, setSwitcherToken] = useState(0);
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const address = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  // Where the sidebars sit and how wide they are. A floating one hides until asked for, and draws over the window.
  const hasAppList = inBrowser || inSearch || inAgent || inMail || inCode || inDesign || inCanvas || inResearch || inReader || inDatabase || inTerminal || inReview || inFiles || inWiki || inProjects || inPhoto || inStudio || inVideo || inSkills || inNotes || inDocs || inSheets || inSlides || inTasks || inCalendar;
  // The agent panel sits beside the Browser and Notes; the Agent app is the conversation itself.
  // With the Agent app open in a pane, the conversation is already on screen.
  const hasRight = (inBrowser || inMail || inCode || inDesign || inCanvas || inResearch || inReader || inDatabase || inTerminal || inReview || inFiles || inWiki || inProjects || inPhoto || inStudio || inVideo || inSkills || inNotes || inDocs || inSheets || inSlides || inTasks || inCalendar) && !shows('agent');
  const leftFloating = appearance.value.leftSidebar === 'floating';
  const rightFloating = appearance.value.rightSidebar === 'floating';
  const [agentListOpen, setAgentListOpen] = useState(true);
  const leftOpen = inAgent ? agentListOpen : panelOpen;
  const setLeftOpen = inAgent ? setAgentListOpen : setPanelOpen;
  const chatInSide = hasRight && chatPlace === 'sidebar';
  // Mobius in the sidebar takes the sidebar column at its usual width, even when it was folded to the rail or the
  // window is narrow; closing it folds the column back.
  const showWide = wide || (chatInSide && chatOpen && !settingsOpen);
  // In the full sidebar the app's list lives inside it, so there is no separate one beside the page.
  const hasLeft = hasAppList && !showWide;
  const rightOpen = hasRight && chatOpen && !chatInSide && !learnOpen;
  useEffect(() => { if (rightOpen && miniOpen) void window.mobius.mini.close(); }, [rightOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  // Learn (shell/learn-view): Mobius opening beside the page takes the slot back from Learn.
  useEffect(() => { if (learnOpen && chatOpen && hasRight && !chatInSide) setLearnOpen(false); }, [chatOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  const [drag, setDrag] = useState<{ side: Side; width: number } | null>(null);
  const [hovering, setHovering] = useState(false);
  const leftWidth = drag?.side === 'left' ? drag.width : appearance.value.leftWidth;
  const rightWidth = drag?.side === 'right' ? drag.width : appearance.value.rightWidth;
  const leftDock = useRef<HTMLDivElement>(null);
  const rightDock = useRef<HTMLDivElement>(null);
  const hideLeft = useCallback(() => setLeftOpen(false), [setLeftOpen]);
  // Mobius beside the page goes back toward where it is asked from (its corner) before it is put away.
  // An app opened from the switcher, All apps or the launcher grows out of the tile or row that was clicked.
  const shownApp = useRef(app);
  useLayoutEffect(() => {
    if (shownApp.current === app) return;
    shownApp.current = app;
    const stage = document.querySelector<HTMLElement>('.stage');
    if (stage) growFrom(stage, 'left');
  }, [app]);
  // Pin beside moves the card across, from the sidebar to its place beside the page, rather than fading one out and the
  // other in.
  const pinFrom = useRef<DOMRect | null>(null);
  useLayoutEffect(() => {
    const from = pinFrom.current;
    pinFrom.current = null;
    const card = document.querySelector<HTMLElement>('.dock.right:not([data-floating]) > .chat');
    if (!from || !card || typeof card.animate !== 'function' || document.visibilityState === 'hidden') return;
    const to = card.getBoundingClientRect();
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { card.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150 }); return; }
    card.animate([
      { transformOrigin: '0 0', transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})` },
      { transformOrigin: '0 0', transform: 'none' },
    ], { duration: 320, easing: 'cubic-bezier(0.2, 0, 0, 1)' });
  });
  // Shown again while it was on its way out (a shortcut, the Ask capsule, Mobius in the sidebar), it stays: a hide
  // still finishing would otherwise close it, since chatOpen never went false and the effect below does not run.
  const hides = useRef(0);
  const hideRight = useCallback(() => { const mine = ++hides.current; void morphOut(document.querySelector<HTMLElement>('.dock.right > .chat'), 'right').then(() => { if (hides.current === mine) setChatOpen(false); }); }, []);
  useEffect(() => { if (chatOpen) hides.current += 1; }, [chatOpen]);
  const leftFromEdge = useRef(false);
  const rightFromEdge = useRef(false);
  // The floating agent panel came out because the pointer reached the edge (not the toolbar button or a shortcut).
  const [peeked, setPeeked] = useState(false);
  useEffect(() => { if (!chatOpen) setPeeked(false); }, [chatOpen]);
  useAutoHide(leftFloating, hasLeft && leftOpen, hideLeft, leftDock, leftFromEdge);
  useSideFolds(leftDock, hasLeft && leftOpen);
  // Comments: on anything in the open document, in comment mode (the button, or C).
  const [commenting, setCommenting] = useState(false);
  const [commentFocus, setCommentFocus] = useState<string | null>(null);
  const commentDoc = inSheets && sheets.data ? `${sheets.data.workbook}/${sheets.data.sheet}` : inMail && mail.open ? mail.open.id : inNotes && notes.page ? notes.page.path : inDocs && docs.page ? docs.page.path : inTasks ? (tasks.view.kind === 'list' ? tasks.view.name : tasks.view.id) : inCalendar ? 'calendar' : inBrowser ? (active?.url ?? null) : place || appName(app);
  const commentThreads = useCommentThreads(app, commentDoc);
  const openComments = useOpenComments(app);
  useEffect(() => { setCommenting(false); }, [app]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'c' || event.ctrlKey || event.metaKey || event.altKey) return;
      const t = event.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (document.querySelector('dialog[open]')) return;
      event.preventDefault();
      setCommenting((on) => !on);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useMorphIn(rightDock, rightOpen);
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
  // A menu from the toolbar is open: the web page shows as a picture under it, as under the other menus.
  const [menuOpen, setMenuOpen] = useState(false);
  const needCover = shows('browser') && (floatingShown || drag !== null || hovering || splitDrag !== null || selectionMenu || menuOpen);
  const [cover, setCover] = useState<{ url: string | null } | null>(null);
  useEffect(() => {
    if (!needCover) { setCover(null); return undefined; }
    let live = true;
    void window.mobius.browser.snapshot().then((url) => { if (live) setCover({ url }); });
    return () => { live = false; };
  }, [needCover]);
  const leftAttached = hasLeft && !leftFloating && leftOpen;
  const rightAttached = (!rightFloating && rightOpen) || learnOpen;
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
  const [settingsSection, setSettingsSection] = useState<'advanced' | 'layout' | 'profiles' | 'keyboard' | 'about' | 'schedules' | 'voice' | undefined>(undefined);
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
    const tab = browser.tabs.find((t) => t.url === url);
    if (tab) window.mobius.browser.activate(tab.id); else void window.mobius.browser.open(url);
  };
  /** Open something found in Search in the app it belongs to. */
  /** A file Mobius changed, opened in its app (from Review). */
  const openChangedFile = (path: string) => {
    const [top, ...rest] = path.split('/');
    const inner = rest.join('/');
    const title = (rest.at(-1) ?? '').replace(/\.(md|json|csv|sqlite)$/i, '');
    if (top === 'notes' || top === 'docs' || top === 'slides' || top === 'designs' || top === 'boards' || top === 'research' || top === 'reading' || top === 'studio') {
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
  };
  const openTarget = (target: HubTarget) => {
    if (target.app === 'agent') { conversation.select(target.conversation); openApp('agent'); }
    else if (target.app === 'notes') { openApp('notes'); void notes.open(target.path, target.title); }
    else if (target.app === 'docs') { openApp('docs'); void docs.open(target.path, target.title); }
    else if (target.app === 'slides') { openApp('slides'); void slides.open(target.path, target.title); }
    else if (target.app === 'sheets') { openApp('sheets'); void sheets.open(target.workbook, target.sheet); }
    else if (target.app === 'mail') { openApp('mail'); mail.setView({ kind: 'box', box: target.id.split('/')[1] === 'sent' ? 'sent' : 'inbox', category: 'all' }); void mail.read(target.id); }
    else if (target.app === 'tasks') { tasks.setView({ kind: 'list', name: target.list }); openApp('tasks'); }
    else if (target.app === 'design') { openApp('design'); void designs.open(target.path, target.title); }
    else if (target.app === 'canvas') { openApp('canvas'); void boards.open(target.path, target.title); }
    else if (target.app === 'database') { openApp('database'); void databases.choose(target.name); }
    else if (target.app === 'reader') { openApp('reader'); void reading.open(target.path, target.title); }
    else if (target.app === 'research') { setAskingResearch(false); openApp('research'); void research.open(target.path, target.title); }
    else if (target.app === 'studio') { openApp('studio'); void songs.open(target.path, target.title); }
    else if (target.app === 'photo') { openApp('photo'); void photos.openPhoto(target.path); }
    else if (target.app === 'video') { openApp('video'); void video.open(target.project); }
    else if (target.app === 'code') { openApp('code'); void code.openProject(target.project); }
    else if (target.app === 'calendar') { openApp('calendar'); if (target.date) { const day = new Date(`${target.date}T12:00:00`); if (!Number.isNaN(day.getTime())) calendar.setAnchor(day); } }
    else if (target.app === 'open') openApp(target.id);
    else showPage(target.url);
  };
  // An app opened while the last turn's changes in it wait for Keep opens on them (once for each set of changes).
  const openedOnChanges = useRef(new Set<string>());
  const openTargetNow = useRef(openTarget);
  openTargetNow.current = openTarget;
  useEffect(() => {
    if (conversation.state.busy) return;
    const showing: Partial<Record<AppId, boolean>> = {
      notes: !!notes.page && turnMarks.notes.has(notes.page.path),
      docs: !!docs.page && turnMarks.docs.has(docs.page.path),
      slides: !!slides.page && turnMarks.slides.has(slides.page.path),
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
    openTargetNow.current(target);
    panesNow.current = { panes: panesNow.current.panes, focused: chat };
    setFocused(chat);
  }, [conversation.state.items]); // eslint-disable-line react-hooks/exhaustive-deps
  // However Settings closes, the next opening starts at its first page again.
  const closeSettings = useCallback(() => { setSettingsOpen(false); setSettingsSection(undefined); }, []);
  const newTab = useCallback(() => {
    void window.mobius.browser.open().then(() => address.current?.focus());
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
      const action = actionForPress(bindings, press);
      if (action === 'launcher') { claim(); openLauncher(); }
      else if (action === 'address') { claim(); address.current?.focus(); address.current?.select(); }
      else if (action === 'newTab') { claim(); newTab(); }
      else if (action === 'closeTab' && active) { claim(); window.mobius.browser.close(active.id); }
      else if (action === 'settings') { claim(); openSettings(); }
      else if (action === 'find' && app === 'browser') { claim(); openFind(); }
      else if (action === 'splitView') { claim(); toggleSplit(); }
      else if (action === 'littleMobius') { claim(); toggleMini(); }
      // Stop is fixed (Cmd-period, Ctrl-period elsewhere) unless that press was given to something else.
      else if (action === null && (press.ctrl || press.meta) && !press.alt && !press.shift && press.code === 'Period' && conversation.state.busy) { claim(); void conversation.stop(); }
    };
    const onKey = (event: KeyboardEvent) => answer(pressOf(event), () => event.preventDefault());
    window.addEventListener('keydown', onKey);
    for (const press of takeEarlyKeys(performance.now())) answer(press, () => undefined);
    return () => window.removeEventListener('keydown', onKey);
  }, [keysReady, bindings, openLauncher, openSettings, openFind, app, newTab, active, toggleSplit, toggleMini, conversation]);

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
    { id: 'doc', label: 'New document', app: 'docs', run: () => { closeSettings(); openApp('docs'); void (async () => { const folder = docs.page?.path.split('/')[0] ?? docs.notebooks[0]?.name ?? (await docs.createNotebook(DEFAULT_FOLDER)); if (folder) await docs.createPage(folder); })(); } },
    { id: 'message', label: 'New message', app: 'mail', run: () => { closeSettings(); openApp('mail'); mail.compose(); } },
    { id: 'deck', label: 'New deck', app: 'slides', run: () => { closeSettings(); openApp('slides'); void (async () => { const folder = slides.page?.path.split('/')[0] ?? slides.notebooks[0]?.name ?? (await slides.createNotebook('Presentations')); if (folder) await slides.createPage(folder, 'Untitled deck'); })(); } },
    { id: 'design', label: 'New design', app: 'design', run: () => { closeSettings(); openApp('design'); void (async () => { const folder = designs.page?.path.split('/')[0] ?? designs.notebooks[0]?.name ?? (await designs.createNotebook('Designs')); if (folder) await designs.createPage(folder, 'Untitled design'); })(); } },
    { id: 'board', label: 'New board', app: 'canvas', run: () => { closeSettings(); openApp('canvas'); void (async () => { const folder = boards.page?.path.split('/')[0] ?? boards.notebooks[0]?.name ?? (await boards.createNotebook('Boards')); if (folder) await boards.createPage(folder, 'Untitled board'); })(); } },
    { id: 'command', label: 'New command', app: 'terminal', run: () => { closeSettings(); openApp('terminal'); setTerminalFocus((n) => n + 1); } },
    { id: 'database', label: 'New database', app: 'database', run: () => { closeSettings(); openApp('database'); window.setTimeout(() => sendCommand('new-database'), 0); } },
    { id: 'article', label: 'Save a link', app: 'reader', run: () => { closeSettings(); openApp('reader'); window.setTimeout(() => sendCommand('save-link'), 0); } },
    { id: 'research', label: 'New research', app: 'research', run: () => { closeSettings(); openApp('research'); setAskingResearch(true); } },
    { id: 'song', label: 'New song', app: 'studio', run: () => { closeSettings(); openApp('studio'); void (async () => { const folder = songs.page?.path.split('/')[0] ?? songs.notebooks[0]?.name ?? (await songs.createNotebook('Songs')); if (folder) await songs.createPage(folder, 'Untitled song'); })(); } },
    { id: 'workbook', label: 'New workbook', app: 'sheets', run: () => { closeSettings(); openApp('sheets'); void sheets.createWorkbook('Workbook'); } },
    { id: 'event', label: 'New event', app: 'calendar', run: () => { closeSettings(); openApp('calendar'); setEventToken((n) => n + 1); } },
  ];
  /** The one thing worth starting in the app you are in: the panel's New button changes with it. */
  // The open app's New, or none: an app with nothing to make from here (Projects, Photo, Files, Review...) shows no Create,
  // rather than one that starts a conversation.
  const createFor = (id: AppId): HubAction | undefined => createActions.find((a) => a.app === id);
  const appSidebar = (pinNode: ReactNode) => settingsOpen ? <div ref={setSettingsSlot} className="settings-side" /> : (
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
                onOpenSchedules={() => openSettingsAt('schedules')}
                onDelete={conversation.remove}
                pin={pinNode}
              />
            ) : inNotes ? (
              <NotesSidebar notes={notes} tags pin={pinNode} changed={turnMarks.notes} pinned={pinnedNotes} onPin={(path, title) => togglePin({ kind: 'note', id: path, title })} starts={startsFor('notes')} onStart={startWithMobius} />
            ) : inSkills ? (
              <ExtensionsSidebar place={extPlace} onPlace={setExtPlace} skills={skills} pin={pinNode} changed={turnMarks.skills} />
            ) : inVideo ? (
              <VideoSidebar video={video} pin={pinNode} changed={turnMarks.video} />
            ) : inStudio ? (
              <StudioSidebar songs={songs} pin={pinNode} changed={turnMarks.songs} starts={startsFor('studio')} onStart={startWithMobius} />
            ) : inPhoto ? (
              <PhotoSidebar photos={photos} pin={pinNode} changed={turnMarks.photos} />
            ) : inDesign ? (
              <DesignSidebar designs={designs} pin={pinNode} changed={turnMarks.designs} starts={startsFor('design')} onStart={startWithMobius} />
            ) : inFiles ? (
              <FilesSidebar files={files} pin={pinNode} />
            ) : inReview ? (
              <ReviewSidebar review={review} pin={pinNode} />
            ) : inTerminal ? (
              <TerminalSidebar term={terminal} pin={pinNode} />
            ) : inDatabase ? (
              <DatabaseSidebar db={databases} pin={pinNode} changed={turnMarks.databases} />
            ) : inProjects ? (
              <ProjectsSidebar projects={projects} pin={pinNode} conversations={conversation.list} />
            ) : inWiki ? (
              <WikiSidebar wiki={wiki} place={wikiPlace} onPlace={setWikiPlace} incoming={wikiIncoming} pin={pinNode} />
            ) : inReader ? (
              <ReaderSidebar reading={reading} pin={pinNode} changed={turnMarks.reading} starts={startsFor('reader')} onStart={startWithMobius} />
            ) : inResearch ? (
              <ResearchSidebar research={research} pin={pinNode} changed={turnMarks.research} starts={startsFor('research')} onStart={startWithMobius} />
            ) : inCanvas ? (
              <CanvasSidebar boards={boards} pin={pinNode} changed={turnMarks.boards} starts={startsFor('canvas')} onStart={startWithMobius} />
            ) : inCode ? (
              <CodeSidebar code={code} pin={pinNode} changed={turnMarks.code} starts={startsFor('code')} onStart={startWithMobius} />
            ) : inMail ? (
              <MailSidebar mail={mail} pin={pinNode} starts={startsFor('mail')} onStart={startWithMobius} />
            ) : inSlides ? (
              <SlidesSidebar slides={slides} pin={pinNode} changed={turnMarks.slides} starts={startsFor('slides')} onStart={startWithMobius} />
            ) : inSheets ? (
              <SheetsSidebar sheets={sheets} pin={pinNode} changed={turnMarks.sheets} starts={startsFor('sheets')} onStart={startWithMobius} />
            ) : inDocs ? (
              <DocsSidebar docs={docs} pin={pinNode} changed={turnMarks.docs} starts={startsFor('docs')} onStart={startWithMobius} />
            ) : inCalendar ? (
              <CalendarSidebar calendar={calendar} pin={pinNode} onNew={createFor('calendar')!.run} starts={startsFor('calendar')} onStart={startWithMobius} />
            ) : inSearch ? (
              <SearchSidebar filter={searchFilter} onFilter={setSearchFilter} pin={pinNode} />
            ) : inTasks ? (
              <TasksSidebar tasks={tasks} pin={pinNode} changed={turnMarks.lists} pinned={pinnedLists} onPin={(name) => togglePin({ kind: 'list', id: name, title: name })} starts={startsFor('tasks')} onStart={startWithMobius} />
            ) : (
          <BrowserSidebar tabs={browser.tabs} pin={pinNode} onNewTab={newTab} downloads={downloads} />
            )}
            <CommentsGroup threads={openComments} onOpen={(t) => { if (t.doc === commentDoc) setCommentFocus(t.id); }} />
          </>
  );

  // A short message about something done without the agent, such as a task made from a selection.
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => { if (!toast) return undefined; const t = window.setTimeout(() => setToast(null), 2600); return () => window.clearTimeout(t); }, [toast]);
  const [incoming, setIncoming] = useState<{ token: number; item?: ContextItem; text?: string } | null>(null);
  /** A start from an app's New row: its words go in the message box, for the person to finish and send. */
  const startWithMobius = (prompt: string) => { if (!shows('agent')) setChatOpen(true); setIncoming({ token: Date.now(), text: prompt }); };
  /** Mobius's starts for the open app: the suggestions that need nothing attached. */
  const startsFor = (id: AppId) => suggestionsFor({ ...surface, app: id }).filter((s) => !s.attach).slice(0, 2);
  // Pinned favourites: notes and task lists one click away in the sidebar.
  const favourites = appearance.value.favourites ?? [];
  const pinnedNotes = useMemo(() => new Set(favourites.filter((f) => f.kind === 'note').map((f) => f.id)), [favourites]);
  const pagePinned = active !== undefined && favourites.some((f) => f.kind === 'page' && f.id === active.url);
  const pinnedLists = useMemo(() => new Set(favourites.filter((f) => f.kind === 'list').map((f) => f.id)), [favourites]);
  const togglePin = (fav: Favourite) => {
    const has = favourites.some((f) => f.kind === fav.kind && f.id === fav.id);
    if (!has && favourites.length >= MAX_FAVOURITES) { setToast(`The sidebar holds ${MAX_FAVOURITES} pinned items. Unpin one first.`); return; }
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
    const typing = document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement || (document.activeElement as HTMLElement | null)?.isContentEditable;
    if ((command === 'undo' || command === 'redo') && (inCanvas || inDesign || inSlides || inPhoto) && !typing) { sendCommand(command); return; }
    document.execCommand(command);
  };
  // Learn (shell/learn-view): opening it unpins Mobius from beside; closing puts focus back where it was.
  const openLearn = () => {
    learnFrom.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (chatOpen && !chatInSide) setChatOpen(false);
    setLearnOpen(true);
  };
  const closeLearn = () => { setLearnOpen(false); learnFrom.current?.focus(); };
  const openSettingsAt = (section: 'keyboard' | 'about' | 'schedules' | 'profiles' | 'voice') => { setSettingsSection(section); setSettingsOpen(true); };
  const menuContext: MenuContext = {
    app,
    apps: APPS.filter((a) => isAvailable(a.id)),
    keys: bindings,
    state: {
      // The sidebar is the app list with the open app's own list under it; with a separate list panel (hasLeft), that panel.
      sidebarShown: hasLeft ? leftOpen : wide, hasSidebar: true, agentShown: chatOpen, hasAgentPanel: hasRight, split, canSplit: !narrow, miniOpen,
      zoom: appearance.value.zoom,
      browser: { hasPage: active !== undefined && /^https?:/.test(active.url), canBack: active?.canGoBack ?? false, canForward: active?.canGoForward ?? false, bookmarked: saved, pinned: pagePinned },
      notes: { hasPage: notes.page !== null, pinned: notes.page !== null && pinnedNotes.has(notes.page.path), changed: notes.page !== null && turnMarks.notes.has(notes.page.path) },
      tasks: { inList: tasks.view.kind === 'list', done: tasksDone },
      calendar: { mode: calendar.mode },
      agent: { busy: conversation.state.busy },
    },
    do: {
      create: { conversation: createActions[0]!.run, note: createActions[1]!.run, task: createActions[2]!.run, tab: createActions[3]!.run },
      closeTab: () => { if (active) window.mobius.browser.close(active.id); },
      settings: openSettings,
      shortcuts: () => openSettingsAt('keyboard'),
      learn: openLearn,
      profiles: () => openSettingsAt('profiles'),
      about: () => openSettingsAt('about'),
      edit,
      find: openFind,
      toggleSidebar: () => (hasLeft ? setLeftOpen((open) => !open) : toggleWide()),
      toggleAgent: () => setChatOpen((open) => !open),
      toggleSplit,
      toggleMini,
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
        selection: () => setSelectionMenu(true),
        saveToReader: () => { if (active) void saveToReader(reading, active.url).then((done) => setToast(done.ok ? 'Saved to Reader' : done.message)); },
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
        newNotebook: () => sendCommand('new-notebook'),
        pin: () => { if (notes.page) togglePin({ kind: 'note', id: notes.page.path, title: notes.page.title || notes.page.path }); },
        changes: () => sendCommand('show-changes'),
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
        play: () => (document.querySelector<HTMLButtonElement>('.studio-transport .btn.primary'))?.click(),
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
      },
      calendar: {
        newEvent: () => createActions.find((a) => a.id === 'event')!.run(),
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
      shorter: `Make ${what} about half as long, with the same meaning. ${inPlace}`,
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
            <BrowserPage onStartPage={onStartPage} hidden={launcherOpen || hubOpen || settingsOpen || cover !== null || onStartPage} onOpen={(url) => { if (active) void window.mobius.browser.navigate(active.id, url); }} onRead={(path, title) => { openApp('reader'); void reading.open(path, title); }} />
          </>
        );
      case 'notes':
        return <NoteEditor notes={notes} autoFocus={app === 'notes'} onSelection={onNoteSelection} review={notes.page && turnMarks.notes.has(notes.page.path) ? { conversation: conversation.state.conversation } : null} />;
      case 'tasks':
        return <TasksPage tasks={tasks} focusToken={taskFocus} onAsk={startWithMobius} review={tasks.view.kind === 'list' && turnMarks.lists.has(tasks.view.name) ? { conversation: conversation.state.conversation } : null} />;
      case 'docs':
        return <DocEditor docs={docs} autoFocus={app === 'docs'} review={docs.page && turnMarks.docs.has(docs.page.path) ? { conversation: conversation.state.conversation } : null} onTool={onWritingTool} onComments={onDocComments} busy={conversation.state.busy} />;
      case 'slides':
        return <SlidesEditor slides={slides} review={slides.page && turnMarks.slides.has(slides.page.path) ? { conversation: conversation.state.conversation } : null} onTool={onSlidesTool} busy={conversation.state.busy} />;
      case 'skills':
        if (extPlace !== 'skills') return <ExtensionsPage place={extPlace} skills={skills} onPlace={setExtPlace} />;
        return <SkillEditor skills={skills} review={skills.open && turnMarks.skills.has(skills.open.name) ? { conversation: conversation.state.conversation } : null} onRun={(name) => { openApp('agent'); void conversation.send(expandSlash(`/${name}`, skills.names), []); }} />;
      case 'video':
        return <VideoEditor video={video} review={video.project && turnMarks.video.has(video.project) ? { conversation: conversation.state.conversation } : null} />;
      case 'studio':
        return <StudioEditor songs={songs} review={songs.page && turnMarks.songs.has(songs.page.path) ? { conversation: conversation.state.conversation } : null} />;
      case 'photo':
        return <PhotoEditor photos={photos} review={photos.open && turnMarks.photos.has(photos.open.path) ? { conversation: conversation.state.conversation } : null} />;
      case 'design':
        return <DesignEditor designs={designs} review={designs.page && turnMarks.designs.has(designs.page.path) ? { conversation: conversation.state.conversation } : null} />;
      case 'files':
        return <FilesPage files={files} onOpenFile={openChangedFile} />;
      case 'review':
        return <ReviewPage review={review} onOpenFile={openChangedFile} onOpenConversation={(id) => { conversation.select(id); openApp('agent'); }} />;
      case 'terminal':
        return <TerminalPage term={terminal} focusToken={terminalFocus} onAsk={(title, text) => { if (!shows('agent')) setChatOpen(true); setIncoming({ token: Date.now(), item: { kind: 'file', title, source: `terminal/${terminal.cwd || '~'}`, text } }); }} />;
      case 'database':
        return <DatabasePage db={databases} review={databases.open && turnMarks.databases.has(databases.open) ? { conversation: conversation.state.conversation } : null} />;
      case 'projects':
        return (
          <ProjectPage
            projects={projects}
            conversations={conversation.list}
            incoming={wikiIncoming}
            onOpenThread={(id) => { conversation.select(id); openApp('agent'); }}
            onNewThread={(pid) => { const id = conversationIdFor(MAIN_BOT_ID, crypto.randomUUID()); void projects.addThread(pid, id).then((ok) => { if (ok) { conversation.select(id); openApp('agent'); } }); }}
            onOpenMemory={(p) => { setWikiPlace({ kind: 'page' }); openApp('wiki'); void wiki.open(`Projects/${p.name}.md`, p.name); }}
            onOpenFiles={(p) => { files.setPlace({ kind: 'folder', path: `projects/${p.name}` }); openApp('files'); }}
            onOpenMade={(path) => { const target = changeTarget(path); if (target) openTarget(target); }}
          />
        );
      case 'wiki':
        if (wikiPlace.kind === 'mine') return <HowIWork asking={conversation.state.items} onAnswer={(id, approve) => void conversation.answer(id, approve, 'once')} />;
        if (wikiPlace.kind === 'shared') return <SharedQueue incoming={wikiIncoming} />;
        return <div className="wiki-doc"><WikiVersions wiki={wiki} /><DocEditor docs={wiki} autoFocus={app === 'wiki'} busy={conversation.state.busy} /></div>;
      case 'reader':
        return <ReaderPage reading={reading} tab={active ? { url: active.url, title: active.title } : null} review={reading.page && turnMarks.reading.has(reading.page.path) ? { conversation: conversation.state.conversation } : null} />;
      case 'research':
        return <ResearchPage research={research} busy={conversation.state.busy} asking={askingResearch} onAskDone={() => setAskingResearch(false)} onAsk={onResearch} review={research.page && turnMarks.research.has(research.page.path) ? { conversation: conversation.state.conversation } : null} />;
      case 'canvas':
        return <CanvasBoard boards={boards} review={boards.page && turnMarks.boards.has(boards.page.path) ? { conversation: conversation.state.conversation } : null} />;
      case 'code':
        return <CodeEditor code={code} review={code.open && code.project && turnMarks.code.has(`${code.project}/${code.open.path}`) ? { conversation: conversation.state.conversation, settled: !conversation.state.busy } : null} />;
      case 'mail':
        return <MailPage mail={mail} onDraftReply={onDraftReply} />;
      case 'sheets':
        return <SheetGrid sheets={sheets} review={sheets.data && turnMarks.sheets.has(sheets.data.workbook) ? { conversation: conversation.state.conversation } : null} />;
      case 'calendar':
        return <CalendarPage calendar={calendar} newToken={eventToken} />;
      case 'search':
        return (
          <SearchPage
            conversations={conversation.list}
            notebooks={notes.notebooks}
            tasks={tasks.all}
            docFolders={docs.notebooks}
            deckFolders={slides.notebooks}
            workbooks={sheets.workbooks}
            made={{ designFolders: designs.notebooks, boardFolders: boards.notebooks, researchFolders: research.notebooks, readingFolders: reading.notebooks, databases: databases.list.map((d) => ({ name: d.name, modified: d.modified })), songFolders: songs.notebooks, albums: photos.albums, videoProjects: video.projects.map((p) => p.name), codeProjects: code.projects.map((p) => ({ name: p.name, modified: (p as { modified?: number }).modified ?? 0 })) }}
            focusToken={searchFocus}
            filter={searchFilter}
            onFilter={setSearchFilter}
            chips={!(showWide || (hasLeft && leftOpen))}
            canAsk={settings?.configured === true && coreStatus === 'ready' && !conversation.state.busy}
            onAsk={(question) => { openApp('agent'); void conversation.send(question, []); }}
            onOpen={openTarget}
          />
        );
      case 'agent':
        return (
          <ChatPanel
            surface={surface}
            onOpenItem={openTarget}
            variant="full"
            desk={(
              <Desk
                rows={[
                  ...(browser.tabs.length > 0 ? [{ app: 'browser' as const, text: plural(browser.tabs.length, 'tab') + ' open' }] : []),
                  ...(mail.counts.all > 0 ? [{ app: 'mail' as const, text: `${mail.counts.all} unread` }] : []),
                  ...(dueToday > 0 ? [{ app: 'tasks' as const, text: `${dueToday} due today` }] : []),
                  ...(eventsToday > 0 ? [{ app: 'calendar' as const, text: `${plural(eventsToday, 'event')} today` }] : []),
                ]}
                changed={changed}
                activity={activity}
                conversations={conversation.list}
                onOpenApp={openApp}
                onOpenConversation={conversation.select}
                onOpenSchedules={() => openSettingsAt('schedules')}
              />
            )}
            state={conversation.state}
            settings={settings}
            coreReady={coreStatus === 'ready'}
            onSend={(text, items, options) => void conversation.send(expandSlash(text, skills.names), items, options)}
            onDrive={driveTasks}
            onStop={conversation.stop}
            onTakeOver={conversation.takeOver}
            appCard={inMail ? <MailPlanCard onChanged={() => void mail.refresh()} /> : <SideThreads projects={projects} conversation={conversation.state.conversation} bots={bots.bots} onOpen={(id) => { conversation.select(id); openApp('agent'); }} />}
            onOpenMail={(id) => { openApp('mail'); void mail.read(id); }}
            onHandBack={conversation.handBack}
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

  // The agent's panel: beside the page, or in the sidebar.
  const chatPanel = (pinned: React.ReactNode) => (
          <ChatPanel
              takeFocus={!(rightFloating && peeked)}
              surface={surface}
              onOpenItem={openTarget}
            state={conversation.state}
            settings={settings}
            coreReady={coreStatus === 'ready'}
            onSend={(text, items, options) => void conversation.send(expandSlash(text, skills.names), items, options)}
            onDrive={driveTasks}
            onStop={conversation.stop}
            onTakeOver={conversation.takeOver}
            appCard={inMail ? <MailPlanCard onChanged={() => void mail.refresh()} /> : <SideThreads projects={projects} conversation={conversation.state.conversation} bots={bots.bots} onOpen={(id) => { conversation.select(id); openApp('agent'); }} />}
            onOpenMail={(id) => { openApp('mail'); void mail.read(id); }}
            onHandBack={conversation.handBack}
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
            onOpenSettings={openSettings}
            onRetry={conversation.retry}
            onEdit={conversation.edit}
            onDetails={conversation.toolDetails}
              effort={preferences.value.reasoningEffort}
              onEffort={(reasoningEffort) => void preferences.set({ reasoningEffort })}
              onModelChanged={() => void reloadSettings()}
            pin={pinned}
            place={appName(app)}
            onPlace={() => { if (showWide) setSwitcherToken((n) => n + 1); else openHub(); }}
            menuItems={rightOpen ? [{ label: rightFloating ? 'Attach the agent panel' : 'Float the agent panel', onSelect: () => setMode('right', rightFloating ? 'attached' : 'floating') }] : undefined}
            onHide={hideRight}
            onOpenVoice={() => openSettingsAt('voice')}
          />
  );
  // The browser's own controls. With the full sidebar they live in it, under the app's name, and nothing but the
  // page's title sits above the page; with the narrow rail they stay in the toolbar.
  const browserChrome = (
    <BrowserChrome
      active={active}
      saved={saved}
      pagePinned={pagePinned}
      onTogglePagePin={() => active && togglePin({ kind: 'page', id: active.url, title: active.title || active.url })}
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
      findOpen={findOpen}
      finding={finding}
      onCloseFind={() => setFindOpen(false)}
    />
  );
  // The menus live in the sidebar, as one Menu button: in its head when it is full, at the top of the folded rail.
  // Nothing sits on top of the page but its title row.
  const menuBar = nativeMenus ? null : <MenuBar menus={menus} compact onOpenChange={setMenuOpen} />;
  // Try another, from any review bar: Mobius is told its change was put back and asked to do it differently.
  const tryAnother = settings?.configured && !conversation.state.busy
    ? () => { if (!shows('agent')) setChatOpen(true); void conversation.send(TRY_ANOTHER_ASK, []); }
    : null;

  return (
    <TryAnotherContext.Provider value={tryAnother}>
    <div className="app" data-keys-ready={keysReady || undefined} style={{ '--chat-col': (rightOpen && !rightFloating) || learnOpen ? `${rightWidth}px` : '0px' } as React.CSSProperties} data-wide={showWide || undefined} data-mobius-side={(chatInSide && chatOpen && !settingsOpen) || undefined} data-app={app} data-settings={settingsOpen || undefined} data-panel={leftOpen ? 'open' : 'closed'} data-chat={rightOpen ? 'open' : 'closed'}>
      <Rail
        {...(profileName ? { profile: profileName, onProfiles: () => openSettingsAt('profiles') } : {})}
        app={app}
        expanded={showWide}
        onToggle={toggleWide}
        onOpen={(id) => { closeSettings(); if (id === 'search') setSearchFocus((n) => n + 1); if (id === 'agent') setSideMode('sessions'); openApp(id); }}
        ownApps={[
          { id: 'bots', name: 'Agents', current: !settingsOpen && app === 'agent' && sideMode === 'bots', run: () => { closeSettings(); setSideMode('bots'); openApp('agent'); } },
          { id: 'activity', name: 'Activity', current: !settingsOpen && app === 'agent' && sideMode === 'activity', run: () => { closeSettings(); setSideMode('activity'); openApp('agent'); } },
          { id: 'extensions', name: 'Abilities', current: !settingsOpen && app === 'skills', run: () => { closeSettings(); openApp('skills'); } },
          { id: 'settings', name: 'Settings', current: settingsOpen, run: () => (settingsOpen ? closeSettings() : openSettings()) },
        ]}
        activity={activity}
        changed={changed}
        needsYou={needsYou}
        counts={{ browser: browser.tabs.length, tasks: dueToday }}
        create={createFor(app)}
        createInList={(['notes', 'docs', 'slides', 'design', 'canvas', 'research', 'reader', 'studio', 'tasks', 'mail', 'calendar', 'sheets'] as AppId[]).includes(app)}
        menus={menuBar}
        chrome={showWide && inBrowser && !settingsOpen ? browserChrome : null}
        mobius={hasRight && !settingsOpen ? {
          shown: chatInSide && chatOpen,
          onToggle: () => { if (chatInSide && chatOpen) { setChatOpen(false); } else { hides.current += 1; setChatPlace('sidebar'); setChatOpen(true); setFocusToken((n) => n + 1); } },
          onBeside: () => { setLearnOpen(false); pinFrom.current = document.querySelector('.rail[data-expanded]')?.getBoundingClientRect() ?? null; setChatPlace('beside'); setChatOpen(true); },
          panel: chatInSide && chatOpen ? chatPanel(null) : null,
        } : null}
        onLauncher={openHub}
        {...(keysReady ? { launcherKeys: bindings.launcher, settingsKeys: bindings.settings } : {})}
        switcherToken={switcherToken}
        onSettings={() => (settingsOpen ? closeSettings() : openSettings())}
        settingsOpen={settingsOpen}
        apps={appearance.value.sidebarApps}
        onApps={(sidebarApps) => void appearance.set({ sidebarApps: sidebarApps as typeof appearance.value.sidebarApps })}
        onEditApps={() => { setSettingsSection('layout'); openSettings(); }}
        favourites={favourites}
        onOpenFavourite={openFavourite}
        onUnpin={togglePin}
        onReorderFavourites={(next) => void appearance.set({ favourites: next })}
        currentFavourite={settingsOpen ? null : currentFavourite}
      >
        {showWide && (hasAppList || settingsOpen) && appSidebar(null)}
      </Rail>
      <header className="context-strip" data-quiet={showWide || undefined}>
        <div className="strip-left" role="group" aria-label="Window">
          {hasLeft && <button type="button" className="strip-btn" data-dock-toggle aria-pressed={leftOpen} aria-label={inAgent ? 'Show conversations' : inNotes ? 'Show notebooks' : inTasks ? 'Show lists' : inCalendar ? 'Show calendars' : inSearch ? 'Show scopes' : 'Show tabs'} title={inAgent ? 'Show or hide conversations' : inNotes ? 'Show or hide notebooks' : inTasks ? 'Show or hide lists' : inCalendar ? 'Show or hide calendars' : 'Show or hide tabs'} onClick={() => setLeftOpen((open) => !open)}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="4" width="14" height="12" rx="2.5" /><path d="M8 4v12" /></svg>
          </button>}
        </div>
        <div className="toolbar-place" data-browser={(inBrowser && !showWide) || undefined}>
          {/* The open document's name, or the app's when nothing is open, so the title bar is never blank. */}
          {(place || (!settingsOpen && appName(app))) && <h1 className="strip-title">{place || appName(app)}</h1>}
          {inAgent && <span className="toolbar-sub">{settings?.configured ? `Talking to ${settings.model}` : 'No model connected'}</span>}
          {inNotes && notes.page && <span className="toolbar-sub">{notes.page.path.split('/')[0]} · <span className="note-status" role="status" data-status={notes.status}>{notes.message || statusText(notes.status)}</span></span>}
          {inMail && <span className="toolbar-sub">{mail.counts.all === 0 ? 'Nothing unread' : `${mail.counts.all} unread`}</span>}
          {inSheets && sheets.data && <span className="toolbar-sub">{sheets.data.sheet}</span>}
          {inCalendar && <span className="toolbar-sub">{eventsToday === 0 ? 'Nothing today' : `${plural(eventsToday, 'event')} today`}</span>}
          {inTasks && <span className="toolbar-sub">{tasksOpen === 0 ? 'Nothing to do' : `${tasksOpen} to do`}</span>}
        </div>
        {inTasks && tasks.view.kind === 'list' && tasksDone > 0 && (
          <div className="strip-middle toolbar-tools" role="group" aria-label="Tasks">
            <button type="button" className="tool-btn" onClick={() => { if (tasks.view.kind === 'list') void tasks.clearDone(tasks.view.name); }}>Clear {tasksDone} completed</button>
          </div>
        )}
        {inBrowser && !showWide && browserChrome}
        <span className="core-status" role="status" data-state={coreStatus}>{CORE_LABEL[coreStatus]}</span>
        {hasRight && !rightOpen && !(chatInSide && chatOpen) && (
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
            <input name="ask" type="text" aria-label="Ask Mobius" placeholder={settingsOpen ? 'Ask about settings' : askAbout(app, !!surface.note || (inBrowser && surface.hasPage) || (inSheets && !!sheets.data) || (inPhoto && !!photos.open) || (inVideo && !!video.project) || (inCode && !!code.open))} autoComplete="off" disabled={!settings?.configured} />
            {activity && <span className="ask-working" role="status" aria-label="Agent activity">{activity.label}</span>}
          </form>
        )}
        {/* Words and icons never share a capsule: the update notice stands on its own, before the icons. */}
        <div className="strip-texts"><UpdateNotice /></div>
        <div className="strip-right" role="group" aria-label="Applications">
          <button type="button" className="strip-btn" data-mini-toggle aria-pressed={miniOpen} aria-label={miniOpen ? 'Close Little Mobius' : 'Open Little Mobius'} title={withKeys(miniOpen ? 'Close the small agent window' : 'Little Mobius: the agent in a small window above your other apps', bindings.littleMobius)} onClick={toggleMini}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="3.5" width="14" height="13" rx="3" /><rect x="9.5" y="9.5" width="5.5" height="5" rx="1.5" /></svg>
          </button>
          {!narrow && <button type="button" className="strip-btn" data-split-toggle aria-pressed={split} aria-label={split ? 'Close split view' : 'Split view'} title={withKeys(split ? 'Show one app' : 'Show two apps side by side', bindings.splitView)} onClick={toggleSplit}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="4.5" width="6.5" height="11" rx="2" /><rect x="11" y="4.5" width="6.5" height="11" rx="2" /></svg>
          </button>}
          <CommentButton on={commenting} count={openComments.length} onToggle={() => setCommenting((on) => !on)} />
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
        <main className="stage" data-split={split || undefined} data-edge-left={(hasLeft && leftFloating && !leftOpen) || undefined} data-edge-right={(hasRight && rightFloating && !chatOpen) || undefined} style={split ? ({ '--split': `${(splitDrag ?? share) * 100}%` } as React.CSSProperties) : undefined}>
          {settingsOpen && (
            <SettingsPage
              {...(settingsSection === 'layout' ? { initial: 'appearance' as const, initialSubpage: 'layout' } : settingsSection === 'profiles' ? { initial: 'advanced' as const, initialSubpage: 'profiles' } : settingsSection ? { initial: settingsSection } : {})}
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
            {chatPanel(<>
              <button type="button" className="head-icon" data-pinned-beside aria-label="Unpin from beside" title="Put Mobius back in the sidebar" onClick={() => setChatPlace('sidebar')}>
                <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 3h6M8 3v6l-3 4h10l-3-4V3M10 13v4" /><path d="M4 4l12 12" /></svg>
              </button>
            </>)}
            {resizer('right', 'Resize the agent panel')}
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
      <AppHub
        open={hubOpen}
        onClose={closeHub}
        current={app}
        onOpenApp={(id) => { closeSettings(); if (id === 'search') setSearchFocus((n) => n + 1); openApp(id); }}
        onConnect={() => { closeSettings(); setExtPlace('connectors'); openApp('skills'); }}
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
      <Launcher open={launcherOpen} onClose={closeLauncher} tabs={browser.tabs} onNewTab={newTab} onActivateTab={(id) => { openApp('browser'); window.mobius.browser.activate(id); }} onOpenApp={openApp}
        onAsk={settings?.configured ? (question) => { setChatOpen(true); setFocusToken((n) => n + 1); void conversation.send(question, []); } : undefined}
        commands={launcherCommands} />
    </div>
    </TryAnotherContext.Provider>
  );
}
