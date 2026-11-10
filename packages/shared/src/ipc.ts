import { resolveAddress } from './address';
import type { AgentEvent, Assessment, ConversationInfo, Duration, Hardware, LocalModel, Message, Recommendation } from './generated';
import type { Bot, BotDraft, BotResult, BotsState } from './bots';
import { isContextList, type ContextItem } from './context';
import { DEFAULT_KEYBINDINGS, isKeyBindings, type KeyBindings } from './keys';

/** Everything that crosses the renderer -> main boundary is validated here. The renderer is untrusted input. */
export interface Bounds { x: number; y: number; width: number; height: number }

export interface BrowserTabState {
  id: string;
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  active: boolean;
  /** The page's icon as a data address, when it has one. */
  icon: string | null;
  /** Pinned tabs stay at the front of the list. Only the Tauri shell has pinning. */
  pinned?: boolean;
  /** Who is using the tab while a task runs: Mobius reading it, Mobius driving it, or you after taking over. None: yours, as usual. */
  driver?: 'reading' | 'mobius' | 'yours' | null;
}

export interface SavedServer {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  hasKey: boolean;
}

export interface BrowserState { tabs: BrowserTabState[]; activeId: string | null }

/** Channel names. One string per capability, grouped by surface. */
export const channels = {
  windowState: 'window:state',
  surfaceBounds: 'surface:bounds',
  browserOpen: 'browser:open',
  browserActivate: 'browser:activate',
  browserClose: 'browser:close',
  browserNavigate: 'browser:navigate',
  browserBack: 'browser:back',
  browserForward: 'browser:forward',
  browserReload: 'browser:reload',
  browserFind: 'browser:find',
  browserStopFind: 'browser:stop-find',
  browserFound: 'browser:found',
  browserState: 'browser:state',
  browserGetState: 'browser:get-state',
  shortcut: 'shell:shortcut',
  quickEntryStatus: 'shell:quick-entry-status',
  browserSnapshot: 'browser:snapshot',
  agentModels: 'agent:models',
  botsGet: 'bots:get',
  botsCreate: 'bots:create',
  botsUpdate: 'bots:update',
  botsRemove: 'bots:remove',
  botsMove: 'bots:move',
  botsChanged: 'bots:changed',
  agentSetModel: 'agent:set-model',
  agentTranscribe: 'agent:transcribe',
  contextPage: 'context:page',
  contextFile: 'context:file',
  coreStatus: 'core:status',
  coreGetStatus: 'core:get-status',
  agentSend: 'agent:send',
  agentCancel: 'agent:cancel',
  agentHistory: 'agent:history',
  agentWaiting: 'agent:waiting',
  agentResolve: 'agent:resolve',
  agentGetSettings: 'agent:get-settings',
  agentConfigure: 'agent:configure',
  agentNotification: 'agent:notification',
  agentSettings: 'agent:settings',
  agentConversations: 'agent:conversations',
  agentDelete: 'agent:delete',
  agentRewind: 'agent:rewind',
  agentGrants: 'agent:grants',
  agentRevokeGrant: 'agent:revoke-grant',
  agentActivity: 'agent:activity',
  appearanceGet: 'appearance:get',
  appearanceSet: 'appearance:set',
  appearanceChanged: 'appearance:changed',
  appAbout: 'app:about',
  appOpenConversation: 'app:open-conversation',
  preferencesGet: 'preferences:get',
  preferencesSet: 'preferences:set',
  preferencesChanged: 'preferences:changed',
  bookmarksGet: 'bookmarks:get',
  bookmarksToggle: 'bookmarks:toggle',
  bookmarksRemove: 'bookmarks:remove',
  bookmarksChanged: 'bookmarks:changed',
  historyGet: 'history:get',
  historyRemove: 'history:remove',
  historyClear: 'history:clear',
  historyEnable: 'history:enable',
  historyChanged: 'history:changed',
  downloadsGet: 'downloads:get',
  downloadsState: 'downloads:state',
  downloadsCancel: 'downloads:cancel',
  downloadsOpen: 'downloads:open',
  downloadsShow: 'downloads:show',
  downloadsClear: 'downloads:clear',
  modelsHardware: 'models:hardware',
  modelsLocal: 'models:local',
  modelsStatus: 'models:status',
  modelsDiscover: 'models:discover',
  modelsDownload: 'models:download',
  modelsCancelDownload: 'models:cancel-download',
  modelsStart: 'models:start',
  modelsStop: 'models:stop',
  modelsEvent: 'models:event',
  appOpenDataFolder: 'app:open-data-folder',
} as const;

export type CoreStatus = 'starting' | 'ready' | 'restarting' | 'failed';

export type Shortcut = 'launcher' | 'address' | 'new-tab' | 'close-tab' | 'settings' | 'find' | 'split-view' | 'little-mobius' | 'quick-entry';

export interface FindRequest { tabId: string; text: string; forward: boolean; again: boolean }
/** How a search in the page is going: which match is shown, out of how many. */
export interface FindResult { tabId: string; active: number; matches: number }

export interface WindowState { maximized: boolean; fullScreen: boolean; focused: boolean; platform: string }

export type NavigateOutcome = 'navigated' | 'ask' | 'blocked' | 'empty';

/** The API the preload script exposes. Nothing else is reachable from the renderer. */
/** One page of the Notes app: a Markdown file in a notebook folder. `path` is `notebook/page.md`. */
export interface NotePage { path: string; title: string; modified: number }
export interface Notebook { name: string; pages: NotePage[] }
export interface NoteContent { path: string; content: string; modified: number }
export interface NoteHit { path: string; title: string; notebook: string; line: string }
/** A refused notes call. `conflict` means the page changed elsewhere (the assistant) since it was read. */
export interface NotesFailure { ok: false; message: string; conflict?: boolean }
/** `undo` is something put back from the review strip: open pages reload, as for the assistant, without new marks. */
export interface NotesChange { path: string | null; by: 'person' | 'assistant' | 'another app' | 'undo' }
export const isNotesFailure = (value: unknown): value is NotesFailure =>
  typeof value === 'object' && value !== null && (value as { ok?: unknown }).ok === false;

/** One task in a list of the Tasks app: a checkbox line in `tasks/<list>.md`. `line` is where it is in the file. */
export interface TaskItem { line: number; text: string; done: boolean; due: string | null }
export interface TaskList { list: string; tasks: TaskItem[]; version: string }
export interface TaskListInfo { name: string; open: number; done: number }
export interface TaskChange { text?: string; done?: boolean; due?: string | null }
/** `by` says who changed it, so the window can show the agent's work without stealing focus. */
export interface TasksChanged { list: string | null; by: 'person' | 'assistant' | 'another app' | 'undo' }

/** An event in the Calendar app, from `calendar/<calendar>.ics`. Times are local: `YYYY-MM-DD` for an all-day event,
 * `YYYY-MM-DDTHH:MM` otherwise; `end` is exclusive (an all-day event on the 12th ends on the 13th). A repeating event
 * is listed once for each time it happens, all with the same id. */
export interface CalendarEvent { id: string; calendar: string; title: string; start: string; end: string; allDay: boolean; location: string; notes: string; repeats: boolean; readOnly?: boolean }
/** What Mobius remembers, sorted as Journey shows it: about you, preferences, projects, people, learned skills. */
export type MemoryCategory = 'you' | 'prefs' | 'work' | 'people' | 'skills';
export interface MemoryItem { text: string; category: MemoryCategory; source: string; /** Mobius noticed it and you have not kept it yet: shown dashed in How I work. */ learned?: boolean }
/** A change offered to the Wiki: a line for a page, waiting in Shared with this wiki until it is kept or declined. */
export interface WikiChange { id: string; from: string; page: string; text: string; whenMs: number }
/** A wiki page as it was at a checkpoint. */
export interface WikiVersion { checkpoint: string; whenMs: number; content: string }
/** Someone in an email's From, To or Cc. */
export interface MailPerson { name: string; email: string }
/** A message in the Mail app's list. `box` is inbox or sent; `category` is sorted on this computer. */
export interface MailMessage { id: string; account: string; box: 'inbox' | 'sent'; uid: number; from: MailPerson; to: MailPerson[]; cc: MailPerson[]; subject: string; dateMs: number; seen: boolean; flagged: boolean; preview: string; category: MailCategory; attachments: string[]; /** A kept Get to zero plan said it needs a reply. */ needsReply?: boolean; laterMs?: number | null; archived?: boolean }
export type MailCategory = 'primary' | 'transactions' | 'updates';
/** A whole message: its text, and its HTML (shown sandboxed, without loading anything from the web). */
export interface MailContent { id: string; from: MailPerson; to: MailPerson[]; cc: MailPerson[]; subject: string; dateMs: number; text: string; html: string | null; attachments: string[]; category?: MailCategory }
/** A draft: the person's, or one Mobius suggested (`by` mobius), which waits as a suggestion until opened. */
export interface MailDraft {
  /** Send later: when it goes, as you scheduled it. */
  sendAtMs?: number | null; id: string; account: string; to: string; cc: string; subject: string; body: string; replyTo: string | null; by: 'you' | 'mobius'; why: string; updatedMs: number }
export interface MailAccount { id: string; name: string; email: string; lastSyncMs: number; problem: string | null }
export interface MailCounts { primary: number; transactions: number; updates: number; all: number; drafts: number; suggested: number }
/** A sheet in the Sheets app: each cell as typed (`cells`, a formula starts with =) and as worked out (`values`). */
export interface SheetData { workbook: string; sheet: string; sheets: string[]; cells: string[][]; values: string[][]; version: string }
export interface WorkbookInfo { name: string; sheets: string[] }
export interface SheetsChanged { workbook: string | null; by: 'person' | 'assistant' | 'another app' | 'undo' }
/** A Code project's file or folder, as a path inside the project, folders first. */
/** A photo in an album: `path` is `album/name`; `edited` when it has edits beside it. */
export interface PhotoInfo { path: string; name: string; modified: number; edited: boolean }
export interface PhotoAlbum { name: string; photos: PhotoInfo[] }
export interface PhotoContent { path: string; dataUrl: string; edits: string | null; modified: number; editsModified: number | null }
export interface PhotosChanged { path: string | null; by: 'person' | 'assistant' | 'another app' | 'undo' }
/** A Video project: its clips (footage, never changed) and whether it has a cut yet. */
export interface VideoProject { name: string; clips: { name: string; bytes: number; kind: 'video' | 'audio' }[]; hasCut: boolean }
export interface VideoChanged { project: string | null; by: 'person' | 'assistant' | 'another app' | 'undo' }
/** One agent turn: the checkpoint before it, whether its end was marked, when, what was asked, and what it changed. */
export interface TurnRecord { start: string; ended: boolean; when: number; ask: string; files: string[] }
/** A skill: a procedure Mobius follows, `skills/<name>/SKILL.md`, with its earlier versions kept. */
export interface SkillInfo { name: string; description: string; modified: number; version: number }
export interface SkillContent { name: string; text: string; modified: number; version: number; versions: { version: number; modified: number; description: string }[] }
export interface CodeEntry { path: string; folder: boolean; depth: number }
/** The Database app: SQLite files in `databases/`, their tables, and what a query gave. */
export interface DbColumn { name: string; type: string }
export interface DbTable { name: string; columns: DbColumn[]; rows: number }
export interface DbInfo { name: string; modified: number; tables: DbTable[] }
export type DbCell = string | number | null;
export type DbResult = { ok: true; columns: string[]; rows: DbCell[][]; changed: number; truncated: boolean; ms: number } | NotesFailure;
export interface DbChange { name: string | null; by: 'person' | 'assistant' | 'another app' | 'undo' }
export interface CodeFile { project: string; path: string; text: string | null; why?: string; modified: number }
export interface CodeTestRun { ok: true; passed: boolean; code: number | null; output: string; seconds: number; timedOut: boolean }
export interface CodeProcess { id: number; command: string; by: 'person' | 'assistant'; started: number; running: boolean; code: number | null; output: string }
export type CodeGit = { repo: false } | { repo: true; branch: string; changes: { status: string; path: string }[]; ahead: number | null };
export interface CodeChanged { project: string | null; path: string | null; by: 'person' | 'assistant' | 'another app' | 'undo' }
export interface CodeTestsEvent { project: string; running: boolean; result?: CodeTestRun; command?: string; by: 'person' | 'assistant' }
export interface CellChange { row: number; col: number; text: string }
/** An event the agent suggests, waiting for the person to Add or Decline. All-day `end` is the last day, included. */
export interface CalendarSuggestion { id: string; calendar: string; title: string; start: string; end: string; allDay: boolean; location: string; notes: string; why: string }
/** A calendar and where it is kept: the person's own (`account` null), or an account's. */
export interface CalendarSource { name: string; account: string | null; readOnly: boolean }
/** A calendar kept elsewhere: a subscribed link, or a CalDAV account (iCloud, Fastmail, Nextcloud). */
export interface CalendarAccount { id: string; kind: 'subscription' | 'caldav'; name: string; url: string; username: string; calendars: string[]; lastSyncMs: number; problem: string | null }
/** What may be set on an event. An all-day `end` is the last day, included. */
export interface CalendarDraft { title?: string; start?: string; end?: string; location?: string; notes?: string }
export interface CalendarChanged { calendar: string | null; by: 'person' | 'assistant' | 'another app' | 'undo' }

/** `cli`: the service's own app keeps the sign-in. `device`: a code entered on the service's site; Mobius keeps the token in the system secret store. */
export interface AccountInfo { id: string; name: string; note: string; active: boolean; kind?: 'cli' | 'device'; models: Array<{ id: string; label: string }> }
/** A device sign-in waiting for the person to enter `code` at `url`. */
export interface PendingSignIn { code: string; url: string }
export interface AccountStatus { installed: boolean; signedIn: boolean; version?: string | null; account?: string | null; hint?: string | null; active?: boolean; pending?: PendingSignIn | null }

/** A model provider in Settings > Providers. The key itself is never sent to the window. */
export interface ProviderInfo {
  id: string;
  name: string;
  baseUrl: string;
  note: string;
  keyUrl: string | null;
  needsKey: boolean;
  hasKey: boolean;
  /** The agent is using this provider now. */
  active: boolean;
  storage: 'keychain' | 'session' | 'none';
}

export interface MobiusBridge {
  platform: string;
  window: {
    onState(listener: (state: WindowState) => void): () => void;
    onShortcut(listener: (shortcut: Shortcut) => void): () => void;
    /** Whether the global quick-entry shortcut is working: false when none is chosen or another program has it. */
    quickEntryActive(): Promise<boolean>;
  };
  surface: {
    setBounds(bounds: Bounds | null): void;
  };
  /** What the last agent turn of a conversation changed in the workspace (notes, tasks, files), and putting it back. */
  changes: {
    lastTurn(conversation: string): Promise<TurnChanges | AgentFailure>;
    undo(conversation: string): Promise<{ ok: true } | AgentFailure>;
    undoFile(conversation: string, path: string): Promise<{ ok: true } | AgentFailure>;
    /** A file as it was before the last turn: `text` is null when the turn made it. */
    before(conversation: string, path: string): Promise<{ ok: true; text: string | null } | AgentFailure>;
    /** Every turn of the conversation, newest first, with what each changed between its start and its end. */
    turns(conversation: string): Promise<{ ok: true; turns: TurnRecord[] } | AgentFailure>;
    /** A file as it was before one turn (`start` names it); `text` is null when that turn made it. */
    turnBefore(conversation: string, start: string, path: string): Promise<{ ok: true; text: string | null } | AgentFailure>;
    /** Puts one file back as it was before one turn. Refused with `later` when it changed again after that turn, unless `force`. */
    undoTurnFile(conversation: string, start: string, path: string, force?: boolean): Promise<{ ok: true } | (AgentFailure & { later?: boolean })>;
    /** What rewinding to right after one turn would do: how many later turns go, and the files that would change. */
    rewindPreview?(conversation: string, start: string): Promise<{ ok: true; later: number; files: string[] } | AgentFailure>;
    /** Everything back as it was right after that turn; the later turns go. `undo` names the rewind for undoRewind. */
    rewind?(conversation: string, start: string): Promise<{ ok: true; undo: string; later: number } | AgentFailure>;
    undoRewind?(conversation: string, undo: string): Promise<{ ok: true } | AgentFailure>;
  };
  /** Little Mobius: a small window, kept above other apps, with the conversation and nothing else. */
  mini: {
    open(): Promise<void>;
    close(): Promise<void>;
    isOpen(): Promise<boolean>;
    /** Bring the full window forward. */
    showMain(): Promise<void>;
    setOnTop(onTop: boolean): Promise<void>;
    /** Says when Little Mobius opens or closes. */
    onChange(listener: (open: boolean) => void): () => void;
  };
  /** Separate sets of data (Personal, Work…). Switching starts Mobius again with the other one. */
  profiles?: {
    list(): Promise<ProfilesState>;
    create(name: string): Promise<{ ok: true; profiles: ProfilesState } | { ok: false; error: string }>;
    rename(id: string, name: string): Promise<{ ok: true; profiles: ProfilesState } | { ok: false; error: string }>;
    remove(id: string): Promise<{ ok: true; profiles: ProfilesState } | { ok: false; error: string }>;
    switch(id: string): Promise<{ ok: true; profiles: ProfilesState } | { ok: false; error: string }>;
  };
  /** Requests to make at a time of day, on chosen days. Each run is a new conversation. */
  /** Sign in once per task: the sites a conversation's task is signed in to. Only the Tauri shell has it. */
  signins?: {
    list(conversation: string): Promise<{ ok: true; sites: string[] } | AgentFailure>;
    /** The person signed in to `site` for this task. */
    signedIn(conversation: string, site: string): Promise<{ ok: true; sites: string[] } | AgentFailure>;
    /** Sign out now. */
    signOut(conversation: string, site: string): Promise<{ ok: true; sites: string[] } | AgentFailure>;
    /** A page Mobius drives asks for a sign-in this task has not made. */
    onNeeded(listener: (needed: { conversation: string; site: string; tab: string }) => void): () => void;
    onChanged(listener: (change: { conversation: string }) => void): () => void;
  };
  schedules?: {
    list(): Promise<ScheduleInfo[]>;
    add(draft: ScheduleDraft): Promise<{ ok: true; schedule: ScheduleInfo } | AgentFailure>;
    update(id: string, draft: ScheduleDraft): Promise<{ ok: true; schedule: ScheduleInfo } | AgentFailure>;
    remove(id: string): Promise<void>;
    /** Runs it now; says which conversation it started. */
    runNow(id: string): Promise<{ ok: true; conversation: string } | AgentFailure>;
    onChange(listener: () => void): () => void;
  };
  /** What Mobius remembers about the person between conversations. */
  memory?: {
    list(): Promise<string[]>;
    /** Each fact with its kind and where it was noticed, as Journey shows them. */
    items(): Promise<MemoryItem[]>;
    /** The person adds a fact of their own. */
    add(text: string, category: MemoryCategory): Promise<{ ok: true } | AgentFailure>;
    edit(old: string, text: string, category: MemoryCategory): Promise<{ ok: true } | AgentFailure>;
    forget(text: string): Promise<{ ok: true } | AgentFailure>;
    /** Keep what Mobius learned (or undo that). */
    keep?(text: string, on: boolean): Promise<{ ok: true } | AgentFailure>;
    /** Undo of Not true: the fact comes back as it was. */
    restore?(text: string, category: MemoryCategory, source: string): Promise<{ ok: true } | AgentFailure>;
    /** The agent remembered or forgot something, or it was forgotten in Settings. */
    onChange(listener: () => void): () => void;
  };
  /** The macOS menu bar, filled from the same menus the window shows in its toolbar elsewhere. */
  menu?: {
    set(menus: { id: string; label: string; items: ({ kind: 'item'; id: string; label: string; keys?: string; disabled?: boolean; checked?: boolean } | { kind: 'separator' })[] }[]): Promise<void>;
    /** An item was chosen in the menu bar. */
    onSelect(listener: (id: string) => void): () => void;
  };
  /** The print in the menu bar or notification area. Optional: not every window or computer has one. */
  tray?: {
    set(shown: { state: 'idle' | 'working' | 'needs' | 'done'; tooltip: string; items: { id: string; title: string; status: string }[] }): Promise<void>;
    /** A conversation was chosen from the tray's menu. */
    onOpenConversation(listener: (conversation: string) => void): () => void;
    /** Stop All was chosen: every conversation that is working stops. */
    onStopAll(listener: () => void): () => void;
  };
  /** The renderer can see whether the core is up. It cannot call the core: only the main process can. */
  core: {
    getStatus(): Promise<CoreStatus>;
    onStatus(listener: (status: CoreStatus) => void): () => void;
  };
  /** The conversation with Mobius. The main process holds the connection to the core and to the model; the renderer only asks. */
  agent: {
    /** `plan` asks the agent for a plan only: it proposes the steps and does nothing until the person starts it. */
    /** `options.images` attaches pictures, as `data:` URLs, for models that read them. */
    send(conversation: string, text: string, context?: ContextItem[], options?: { plan?: boolean; images?: string[] }): Promise<AgentResult<{ turn: number }>>;
    /** The models the server offers, for the switcher. */
    models(): Promise<AgentResult<{ models: string[] }>>;
    /** Use another model on the same server, with everything else as it was. */
    setModel(model: string): Promise<AgentResult>;
    /** Turn a recording into text, using the speech model on the server. */
    transcribe(audio: ArrayBuffer, mime: string): Promise<AgentResult<{ text: string }>>;
    cancel(conversation: string): Promise<void>;
    /** Take over the running task: Mobius pauses at the next safe point and the apps are yours. */
    takeOver?(conversation: string): Promise<AgentResult>;
    /** Hand the task back: Mobius reads what is there again, then goes on. */
    handBack?(conversation: string): Promise<AgentResult>;
    /** Whether you have control of the conversation's task, and the step Mobius paused at. */
    control?(conversation: string): Promise<{ theirs: boolean; step?: number; of?: number | null }>;
    history(conversation: string): Promise<Message[]>;
    waiting(conversation: string): Promise<AgentWaiting[]>;
    /** The question the model is waiting on in this conversation, if any. */
    question(conversation: string): Promise<AgentQuestion | null>;
    answer(conversation: string, callId: string, text: string): Promise<AgentResult>;
    conversations(): Promise<ConversationInfo[]>;
    deleteConversation(conversation: string): Promise<AgentResult>;
    /** Only the Tauri shell has these two: put a conversation away (or bring it back), and list the ones put away. */
    archive?(conversation: string, archived: boolean): Promise<string[]>;
    archived?(): Promise<string[]>;
    /** Only the Tauri shell has these: servers saved by name. Keys are never returned. */
    savedServers?(): Promise<SavedServer[]>;
    saveServer?(name: string): Promise<AgentResult>;
    useServer?(id: string): Promise<AgentResult>;
    removeServer?(id: string): Promise<AgentResult>;
    /** Take back the last exchange; resolves with the message that was taken back. */
    rewind(conversation: string): Promise<{ ok: true; text: string } | { ok: false; error: string }>;
    grants(): Promise<AgentGrant[]>;
    revokeGrant(id: number): Promise<AgentResult>;
    activity(limit?: number): Promise<ActivityEntry[]>;
    resolve(requestId: number, approve: boolean, duration: Duration): Promise<AgentResult>;
    getSettings(): Promise<AgentSettings>;
    configure(settings: AgentConfigureRequest): Promise<AgentResult>;
    onNotification(listener: (notification: AgentNotification) => void): () => void;
    /** Fires when the model setup changes without the renderer asking, for example after the core restarts. */
    onSettings(listener: (settings: AgentSettings) => void): () => void;
  };
  appearance: {
    get(): Promise<AppearanceSettings>;
    set(change: Partial<AppearanceSettings>): Promise<AppearanceSettings>;
    onChange(listener: (value: AppearanceSettings) => void): () => void;
  };
  models: {
    hardware(): Promise<Hardware | null>;
    local(): Promise<LocalEntry[]>;
    status(): Promise<RuntimeSnapshot>;
    /** Resolves when the search is finished. An empty query asks for what suits this computer. */
    discover(query: string): Promise<DiscoverResult>;
    /** Resolves when the download is finished (or failed, or was cancelled). */
    download(repo: string, file: string): Promise<ModelsResult>;
    cancelDownload(): Promise<void>;
    /** Starts a model from the local list, and points the agent at it once it is ready. */
    /** Run a model on this computer. `context` is one of CONTEXT_SIZES; leave it out for the default. */
    start(id: string, context?: number): Promise<ModelsResult>;
    stop(): Promise<ModelsResult>;
    /** The engine models run on, or null when the core cannot be asked. */
    engine(): Promise<EngineStatus | null>;
    /** Install or update Mobius's own llama.cpp. Resolves when done; progress arrives as `engine` events. */
    installEngine(): Promise<{ ok: true; upToDate: boolean } | { ok: false; error: string }>;
    cancelEngine(): Promise<void>;
    /** Whether the model run last time starts again when Mobius opens. */
    autostart(): Promise<{ enabled: boolean; modelId: string | null }>;
    setAutostart(on: boolean): Promise<ModelsResult>;
    onEvent(listener: (event: ModelsEvent) => void): () => void;
  };
  bookmarks: {
    /** Saved pages, newest first. An empty query lists them all. */
    get(query: string): Promise<BookmarkEntry[]>;
    /** Save the open page, or remove it if it is saved. Resolves with whether it is saved afterwards. */
    toggle(): Promise<boolean>;
    remove(url: string): void;
    onChanged(listener: () => void): () => void;
  };
  /** Settings > Providers. Only the Tauri shell has it. */
  providers?: {
    /** Everything the model picker offers, grouped by where it runs. Asks each provider for its list. */
    catalog(): Promise<ModelCatalog>;
    /** Plans you sign in to instead of pasting a key (the Claude subscription, through Claude Code). */
    accounts(): Promise<AccountInfo[]>;
    /** Asks the service's own app; can take a second or two. */
    accountStatus(id: string): Promise<AccountStatus>;
    /** Opens the service's own sign-in, or (device sign-in) gives the code to enter. */
    signIn(id: string): Promise<AgentResult<Partial<PendingSignIn>>>;
    cancelSignIn(id: string): Promise<void>;
    signOut(id: string): Promise<void>;
    list(): Promise<ProviderInfo[]>;
    setKey(id: string, key: string): Promise<{ ok: true; storage: 'keychain' | 'session' } | { ok: false; error: string }>;
    removeKey(id: string): Promise<void>;
    models(id: string): Promise<{ ok: true; models: string[] } | { ok: false; error: string }>;
    use(id: string, model: string): Promise<AgentResult>;
    onChanged(listener: () => void): () => void;
  };
  /** Other apps using Mobius's tools over MCP. Only the Tauri shell has it. */
  /** Only the desktop app: the workspace folder as a drive, for the person to look through. */
  files?: {
    list(path: string): Promise<{ path: string; entries: FileEntry[]; truncated: boolean } | { error: string }>;
  };
  /** Only the desktop app: what extends Mobius. */
  extensions?: {
    /** The MCP servers from mcp.json: which run, which did not start and why. */
    connectors(): Promise<ConnectorStatus>;
  };
  share?: {
    status(): Promise<ShareStatus>;
    set(change: { enabled?: boolean; allowChanges?: boolean; port?: number }): Promise<AgentResult>;
    /** The token to paste into the other app; null while sharing is off. */
    token(): Promise<string | null>;
    renewToken(): Promise<AgentResult>;
  };
  /** The Tasks app. Only the Tauri shell has it. Failures are `NotesFailure`-shaped (`conflict`: the task changed elsewhere). */
  tasks?: {
    lists(): Promise<TaskListInfo[] | NotesFailure>;
    read(list: string): Promise<TaskList | NotesFailure>;
    createList(name: string): Promise<{ name: string } | NotesFailure>;
    add(list: string, text: string, due: string | null): Promise<TaskList | NotesFailure>;
    update(list: string, line: number, expect: string, change: TaskChange): Promise<TaskList | NotesFailure>;
    remove(list: string, line: number, expect: string): Promise<TaskList | NotesFailure>;
    clearDone(list: string): Promise<TaskList | NotesFailure>;
    onChanged(listener: (change: TasksChanged) => void): () => void;
  };
  /** The Calendar app. Only the Tauri shell has it. */
  calendar?: {
    calendars(): Promise<string[] | NotesFailure>;
    /** Between two days, both included. */
    events(from: string, to: string): Promise<CalendarEvent[] | NotesFailure>;
    create(name: string): Promise<{ name: string } | NotesFailure>;
    add(calendar: string, draft: CalendarDraft): Promise<CalendarEvent | NotesFailure>;
    update(calendar: string, id: string, draft: CalendarDraft): Promise<CalendarEvent | NotesFailure>;
    remove(calendar: string, id: string): Promise<{ calendar: string; removed: string } | NotesFailure>;
    sources(): Promise<CalendarSource[] | NotesFailure>;
    suggestions(): Promise<CalendarSuggestion[] | NotesFailure>;
    accept(id: string): Promise<CalendarEvent | NotesFailure>;
    decline(id: string): Promise<{ declined: string } | NotesFailure>;
    accounts(): Promise<CalendarAccount[] | NotesFailure>;
    subscribe(name: string, link: string): Promise<{ id: string; name: string } | NotesFailure>;
    connect(account: { name: string; server: string; username: string; password: string }): Promise<{ id: string; name: string; calendars: string[] } | NotesFailure>;
    removeAccount(id: string): Promise<{ ok: true } | NotesFailure>;
    /** Reads one account (or all of them) again now. */
    sync(id: string | null): Promise<CalendarAccount[] | NotesFailure>;
    onChanged(listener: (change: CalendarChanged) => void): () => void;
  };
  /** The Mail app. Only the person sends: `send` is for the Send button, and the agent has no way to send. */
  mail?: {
    accounts(): Promise<MailAccount[] | NotesFailure>;
    /** `preset` is icloud, fastmail, gmail, yahoo or other (then the servers are given). */
    connect(account: { preset: string; email: string; password: string; imapHost?: string; imapPort?: number; smtpHost?: string; smtpPort?: number }): Promise<{ id: string; email: string } | NotesFailure>;
    removeAccount(id: string): Promise<{ ok: true } | NotesFailure>;
    sync(id: string | null): Promise<MailAccount[] | NotesFailure>;
    list(box: 'inbox' | 'sent' | 'all', category: MailCategory | 'all', query: string): Promise<MailMessage[] | NotesFailure>;
    counts(): Promise<MailCounts | NotesFailure>;
    read(id: string): Promise<MailContent | NotesFailure>;
    flag(id: string, which: 'seen' | 'flagged', on: boolean): Promise<{ ok: true } | NotesFailure>;
    sort(id: string, category: MailCategory): Promise<{ ok: true } | NotesFailure>;
    drafts(): Promise<MailDraft[] | NotesFailure>;
    saveDraft(draft: Partial<MailDraft>): Promise<MailDraft | NotesFailure>;
    deleteDraft(id: string): Promise<{ ok: true } | NotesFailure>;
    send(id: string): Promise<{ ok: true } | NotesFailure>;
    /** Get to zero: what Mobius proposes for everything in the inbox. */
    plan?(): Promise<MailPlan | NotesFailure>;
    /** Keep the plan: archive, mark for reply, put off until tomorrow 8:00, and add the to-dos to Tasks. */
    keepPlan?(plan: MailPlan): Promise<{ ok: true; todos: string[]; list: string } | NotesFailure>;
    /** Undo all: put back everything the last kept plan did. */
    undoPlan?(): Promise<{ ok: true } | NotesFailure>;
    archive?(id: string, on: boolean): Promise<{ ok: true } | NotesFailure>;
    /** Out of the inbox until then (null: back now). */
    remind?(id: string, atMs: number | null): Promise<{ ok: true } | NotesFailure>;
    /** Send later: when a kept draft of yours goes (null: unschedule). */
    schedule?(id: string, atMs: number | null): Promise<MailDraft | NotesFailure>;
    /** When the person a draft is to is usually on mail, as Mobius's suggestion for Send later. */
    suggestSend?(id: string): Promise<{ atMs: number; why: string } | null>;
    onChanged(listener: (change: { by: string }) => void): () => void;
  };
  /** The Sheets app: workbooks of CSV sheets in `sheets/<workbook>/`. Only the Tauri shell has it. */
  sheets?: {
    list(): Promise<WorkbookInfo[] | NotesFailure>;
    read(workbook: string, sheet: string): Promise<SheetData | NotesFailure>;
    /** Refused with `conflict` when the sheet changed since `version`. */
    set(workbook: string, sheet: string, cells: CellChange[], version: string | null): Promise<SheetData | NotesFailure>;
    shift(workbook: string, sheet: string, what: 'row' | 'column', at: number, insert: boolean): Promise<SheetData | NotesFailure>;
    createWorkbook(name: string): Promise<{ name: string; sheet: string } | NotesFailure>;
    addSheet(workbook: string, name: string): Promise<{ workbook: string; sheet: string } | NotesFailure>;
    renameSheet(workbook: string, sheet: string, name: string): Promise<{ workbook: string; sheet: string } | NotesFailure>;
    removeSheet(workbook: string, sheet: string): Promise<{ workbook: string; removed: string } | NotesFailure>;
    onChanged(listener: (change: SheetsChanged) => void): () => void;
  };
  /** The Code app: projects are folders in `code/`; the test command of each is the person's. Only the Tauri shell has it. */
  code?: {
    projects(): Promise<{ name: string; modified: number }[] | NotesFailure>;
    createProject(name: string): Promise<{ name: string } | NotesFailure>;
    tree(project: string): Promise<{ project: string; entries: CodeEntry[]; truncated: boolean } | NotesFailure>;
    read(project: string, path: string): Promise<CodeFile | NotesFailure>;
    /** Refused with `conflict` when the file changed since `base`. */
    save(project: string, path: string, text: string, base: number | null): Promise<{ project: string; path: string; modified: number } | NotesFailure>;
    createFile(project: string, path: string): Promise<{ project: string; path: string; modified: number } | NotesFailure>;
    removeFile(project: string, path: string): Promise<{ project: string; path: string } | NotesFailure>;
    testCommand(project: string): Promise<{ command: string | null; suggested: string | null } | NotesFailure>;
    setTestCommand(project: string, command: string): Promise<{ ok: true } | NotesFailure>;
    runTests(project: string): Promise<CodeTestRun | NotesFailure>;
    /** A command the person typed in the console, run in the project's folder. */
    runCommand(project: string, command: string): Promise<CodeTestRun | NotesFailure>;
    /** Commands left running in the project (a server, a watcher), with what they printed last. */
    processes(project: string): Promise<CodeProcess[]>;
    start(project: string, command: string): Promise<{ id: number } | NotesFailure>;
    stopProcess(id: number): Promise<{ id: number } | NotesFailure>;
    onProcesses(listener: () => void): () => void;
    /** A command run in a project, by the person or (when allowed) by Mobius. */
    onConsole(listener: (event: { project: string; command: string; result: CodeTestRun; by: 'person' | 'assistant' }) => void): () => void;
    /** The project's git state, when it is a repository. */
    git(project: string): Promise<CodeGit | NotesFailure>;
    commit(project: string, message: string): Promise<{ ok: true; commit: string } | NotesFailure>;
    push(project: string): Promise<{ ok: true; branch: string } | NotesFailure>;
    onChanged(listener: (change: CodeChanged) => void): () => void;
    onTests(listener: (event: CodeTestsEvent) => void): () => void;
  };
  /** The Docs app: documents kept like notes, as Markdown in `docs/<folder>/<doc>.md`. Only the Tauri shell has it. */
  docs?: NonNullable<MobiusBridge['notes']>;
  /** The Wiki app: pages kept like notes, as Markdown in `wiki/<folder>/<page>.md`, and the changes offered to it. */
  wiki?: NonNullable<MobiusBridge['notes']> & {
    versions?(path: string): Promise<WikiVersion[] | NotesFailure>;
    incoming?(): Promise<WikiChange[]>;
    offer?(from: string, text: string, page?: string): Promise<WikiChange | NotesFailure>;
    /** Keep a change: its line (or `text`, edited first) is added to its page. */
    keepChange?(id: string, text?: string): Promise<{ ok: true; change: WikiChange; line: string } | NotesFailure>;
    declineChange?(id: string): Promise<{ ok: true; change: WikiChange } | NotesFailure>;
    /** Undo a keep (`keptLine` is taken back out of the page) or a decline: the change waits again. */
    undoChange?(change: WikiChange, keptLine: string | null): Promise<{ ok: true } | NotesFailure>;
  };
  /** The Slides app: decks kept like notes, as Markdown in `slides/<folder>/<deck>.md`. Only the Tauri shell has it. */
  slides?: NonNullable<MobiusBridge['notes']>;
  /** The Video app: projects in `video/`, each with its clips and `cut.json`. Only the Tauri shell has it. */
  video?: {
    projects(): Promise<VideoProject[] | NotesFailure>;
    createProject(name: string): Promise<{ name: string } | NotesFailure>;
    readCut(project: string): Promise<{ project: string; text: string | null; modified: number | null } | NotesFailure>;
    /** Refused with `conflict` when the cut changed since `base` (null: there was none). */
    saveCut(project: string, text: string, base: number | null): Promise<{ project: string; modified: number } | NotesFailure>;
    addClip(project: string, name: string, data: string): Promise<{ project: string; clip: string } | NotesFailure>;
    showFolder(project: string): Promise<{ ok: true } | NotesFailure>;
    onChanged(listener: (change: VideoChanged) => void): () => void;
  };
  /** The Skills app. Only the Tauri shell has it. */
  skills?: {
    list(): Promise<SkillInfo[] | NotesFailure>;
    read(name: string): Promise<SkillContent | NotesFailure>;
    /** Keeps the version it replaces. Refused with `conflict` when it changed since `base`. */
    save(name: string, text: string, base: number | null): Promise<{ name: string; modified: number } | NotesFailure>;
    create(title: string, description: string): Promise<{ name: string; text: string; modified: number } | NotesFailure>;
    /** Adds a skill someone shared, from its SKILL.md text. */
    install(text: string): Promise<{ name: string; text: string; modified: number } | NotesFailure>;
    restore(name: string, version: number): Promise<{ name: string; modified: number } | NotesFailure>;
    remove(name: string): Promise<{ removed: string } | NotesFailure>;
    onChanged(listener: (change: { name: string | null; by: string }) => void): () => void;
  };
  /** The Photo app: albums in `photos/`, each photo's edits beside it as `<photo>.edits.json`. Only the Tauri shell has it. */
  photos?: {
    albums(): Promise<PhotoAlbum[] | NotesFailure>;
    createAlbum(name: string): Promise<{ name: string } | NotesFailure>;
    read(path: string): Promise<PhotoContent | NotesFailure>;
    /** Refused with `conflict` when the edits changed since `base` (null: there were none). */
    saveEdits(path: string, text: string, base: number | null): Promise<{ path: string; editsModified: number } | NotesFailure>;
    /** `data` is the picture as base64. */
    add(album: string, name: string, data: string): Promise<{ path: string } | NotesFailure>;
    /** Writes the edited picture (JPEG, base64) next to the photo; says where. */
    export(path: string, data: string): Promise<{ path: string } | NotesFailure>;
    onChanged(listener: (change: PhotosChanged) => void): () => void;
  };
  /** The Studio app: songs kept like notes, as JSON in `studio/<folder>/<song>.json`. Only the Tauri shell has it. */
  songs?: NonNullable<MobiusBridge['notes']>;
  /** The Design app: designs kept like notes, as JSON in `designs/<folder>/<design>.json`. Only the Tauri shell has it. */
  designs?: NonNullable<MobiusBridge['notes']>;
  /** The Canvas app: boards kept like notes, as JSON in `boards/<folder>/<board>.json`. Only the Tauri shell has it. */
  boards?: NonNullable<MobiusBridge['notes']>;
  /** The Research app: reports kept like documents, as Markdown in `research/<folder>/<report>.md`. Only the Tauri shell has it. */
  research?: NonNullable<MobiusBridge['notes']>;
  /** The Reader app: articles kept to read later, as Markdown in `reading/<folder>/<article>.md`, and fetching one. */
  /** The Terminal app: the person's commands in a folder of the workspace (`cwd`, from the workspace with `/`). */
  terminal?: {
    places(): Promise<{ cwd: string; name: string; within?: string }[]>;
    /** Where `cd target` leads from `cwd`. */
    resolve(cwd: string, target: string): Promise<{ ok: true; cwd: string } | NotesFailure>;
    run(cwd: string, command: string): Promise<(CodeTestRun & { cwd: string }) | NotesFailure>;
    start(cwd: string, command: string): Promise<{ id: number } | NotesFailure>;
    processes(): Promise<CodeProcess[]>;
    stop(id: number): Promise<unknown>;
  };
  databases?: {
    list(): Promise<DbInfo[]>;
    create(name: string): Promise<{ ok: true; name: string } | NotesFailure>;
    remove(name: string): Promise<{ ok: true } | NotesFailure>;
    /** A CSV as a new table; the first row names the columns. */
    importCsv(name: string, table: string, csv: string): Promise<{ ok: true; table: string; columns: string[]; rows: number } | NotesFailure>;
    /** One statement, which may change the database; at most 1000 rows come back. */
    query(name: string, sql: string): Promise<DbResult>;
    onChanged(listener: (change: DbChange) => void): () => void;
  };
  reading?: NonNullable<MobiusBridge['notes']> & { fetch(url: string): Promise<{ ok: true; url: string; title: string; text: string } | { ok: false; message: string }> };
  /** The Notes app. Only the Tauri shell has it. */
  notes?: {
    list(): Promise<Notebook[] | NotesFailure>;
    read(path: string): Promise<NoteContent | NotesFailure>;
    /** `base` is the `modified` the page had when read; the save is refused if it changed since. */
    save(path: string, content: string, base: number | null): Promise<{ path: string; modified: number } | NotesFailure>;
    createNotebook(name: string): Promise<{ name: string } | NotesFailure>;
    createPage(notebook: string, title: string): Promise<NoteContent | NotesFailure>;
    remove(path: string): Promise<{ ok: true } | NotesFailure>;
    search(query: string): Promise<NoteHit[] | NotesFailure>;
    onChanged(listener: (change: NotesChange) => void): () => void;
  };
  history: {
    /** Newest first; an empty query lists everything recent. */
    get(query: string): Promise<HistoryView>;
    remove(url: string): void;
    clear(): void;
    setEnabled(enabled: boolean): void;
    onChanged(listener: () => void): () => void;
  };
  downloads: {
    get(): Promise<DownloadEntry[]>;
    cancel(id: string): void;
    open(id: string): void;
    show(id: string): void;
    clear(): void;
    onState(listener: (entries: DownloadEntry[]) => void): () => void;
  };
  bots: {
    get(): Promise<BotsState>;
    create(draft: BotDraft): Promise<BotResult<{ bot: Bot }>>;
    update(id: string, draft: BotDraft): Promise<BotResult<{ bot: Bot }>>;
    move(id: string, direction: 'up' | 'down'): Promise<BotResult>;
    /** Removes the bot and every conversation it had. */
    remove(id: string): Promise<BotResult<{ removedSessions: number }>>;
    onChange(listener: (state: BotsState) => void): () => void;
  };
  context: {
    /** The page that is showing, as something to attach. */
    page(): Promise<AgentResult<{ item: ContextItem }>>;
    /** A text file the person picks, as something to attach. `cancelled` when they close the picker. */
    file(): Promise<AgentResult<{ item: ContextItem | null }>>;
    /** The text selected on the page that is showing, as something to attach. */
    selection(): Promise<AgentResult<{ item: ContextItem }>>;
  };
  preferences: {
    get(): Promise<PreferencesSettings>;
    set(change: Partial<PreferencesSettings>): Promise<PreferencesSettings>;
    onChange(listener: (value: PreferencesSettings) => void): () => void;
  };
  app: {
    /** A notification was clicked: show this conversation. */
    onOpenConversation(listener: (conversation: string) => void): () => void;
    about(): Promise<AboutInfo>;
    openDataFolder(): Promise<void>;
    /** Only the Tauri shell has this: remove everything Mobius keeps on this computer, then close. */
    removeData?(): Promise<AgentResult<{ removed: number }>>;
  };
  browser: {
    open(input?: string): Promise<string | null>;
    activate(tabId: string): void;
    close(tabId: string): void;
    navigate(tabId: string, input: string): Promise<NavigateOutcome>;
    back(tabId: string): void;
    forward(tabId: string): void;
    reload(tabId: string): void;
    find(request: { tabId: string; text: string; forward?: boolean; again?: boolean }): void;
    stopFind(tabId: string): void;
    onFound(listener: (result: FindResult) => void): () => void;
    /** A picture of the page that is showing, so something can be drawn over it while the page is hidden. Null when it cannot be taken. */
    snapshot(): Promise<string | null>;
    getState(): Promise<BrowserState>;
    onState(listener: (state: BrowserState) => void): () => void;
    /** Only the Tauri shell provides these four; the interface offers them when they are there. */
    reopenClosed?(): Promise<string | null>;
    duplicate?(tabId: string): Promise<string | null>;
    pin?(tabId: string, pinned: boolean): void;
    moveTab?(tabId: string, index: number): void;
  };
}

/** A tool call that is waiting for a person to allow or decline it. */
export interface AgentWaiting { requestId: number; callId: string; tool: string; arguments: unknown; onceOnly: boolean; /** The request came from something Mobius read, not from the person. */ origin?: string | null }

export type AgentResult<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };

/** A second model to try when the first cannot answer. */
export interface FallbackRequest { baseUrl: string; model: string; apiKey?: string; clearKey?: boolean }
export interface AgentConfigureRequest { baseUrl: string; model: string; apiKey?: string; system?: string; clearKey?: boolean; maxSteps?: number; fallback?: FallbackRequest }

/** Something the agent was allowed (or refused) to do for good. */
export interface AgentGrant { id: number; capability: string; resource: string | null; effect: 'allow' | 'deny'; duration: Duration; createdMs: number }

/** One line of the activity log, without anything that was typed or read. */
export interface ActivityEntry { seq: number; tsMs: number; kind: string; capability: string | null; resource: string | null; tool: string | null; who: string | null }

export type ModelsResult = { ok: true } | { ok: false; error: string };
export type DiscoverResult = { ok: true; results: Recommendation[] } | { ok: false; error: string };

/** A model file on this computer, and what this computer can do with it. */
export interface LocalEntry { model: LocalModel; assessment: Assessment }

export interface RuntimeInfo {
  state: 'starting' | 'ready' | 'failed' | 'stopped';
  reason: string | null;
  /** The identifier of the model in the list of local models. */
  modelId: string;
  /** The name the server is asked for. */
  model: string;
  baseUrl: string;
  log: string[];
  /** The agent has been pointed at this server. */
  usingForAssistant: boolean;
}
export interface RuntimeSnapshot { binary: string | null; runtime: RuntimeInfo | null }

/** The program that runs local models (llama.cpp's llama-server). */
export interface EngineStatus {
  /** Mobius can install its own engine here (64-bit Windows for now). */
  supported: boolean;
  /** The build Mobius would install for this computer, for example "NVIDIA (CUDA 12)". */
  recommended: string;
  installed: { tag: string; label: string; devices: string[] } | null;
  /** The program in use: one the person set, Mobius's own, or one found on the computer. */
  using: { source: 'setting' | 'mobius' | 'found'; path: string } | null;
  installing: boolean;
}

export type ModelsEvent =
  | { kind: 'engine'; state: 'started' | 'progress' | 'finished' | 'failed'; done?: number; total?: number; error?: string }
  | { kind: 'progress'; job: string; done: number; total: number }
  | { kind: 'download'; state: 'started' | 'finished' | 'failed'; repo: string; file: string; error?: string }
  | { kind: 'runtime'; snapshot: RuntimeSnapshot };

export interface HistoryEntry {
  url: string;
  title: string;
  /** Milliseconds since 1970. */
  visited: number;
}

export interface BookmarkEntry {
  url: string;
  title: string;
  /** Milliseconds since 1970. */
  added: number;
}

export interface HistoryView {
  enabled: boolean;
  entries: HistoryEntry[];
}

export interface DownloadEntry {
  id: string;
  name: string;
  state: 'downloading' | 'done' | 'failed' | 'cancelled';
  received: number;
  /** 0 when the page did not say how big the file is. */
  total: number;
  /** A file that can run a program: it is saved but never opened from here. */
  risky: boolean;
}

export type ThemeChoice = 'system' | 'light' | 'dark';
export type ChatFont = 'system' | 'serif' | 'mono';
export type TextDirection = 'auto' | 'ltr' | 'rtl';
export type Density = 'comfortable' | 'compact';
export type ToolSteps = 'show' | 'hide-finished';
export interface AppearanceSettings {
  theme: ThemeChoice;
  zoom: number;
  chatTextScale: number;
  chatFont: ChatFont;
  textDirection: TextDirection;
  /** How tightly lists of tabs and conversations are packed. */
  density: Density;
  /** Whether finished tool steps stay in the conversation. Steps waiting for you are always shown. */
  toolSteps: ToolSteps;
  /** Whether the browser's side list is open when Mobius starts. */
  sidebarAtStart: boolean;
  /** Whether the conversation you were in is opened again when Mobius starts (otherwise it starts blank). */
  resumeLast: boolean;
  /** The list on the left (tabs, or conversations): part of the window, or floating over it and hiding itself. */
  leftSidebar: SidebarMode;
  /** The app list on the left: the full sidebar with names and the app's own list, or a narrow rail of icons. */
  navigation: NavigationStyle;
  /** The agent panel on the right: part of the window, or floating over it and hiding itself. */
  rightSidebar: SidebarMode;
  /** How wide the left list is, in pixels. */
  leftWidth: number;
  /** How wide the agent panel is, in pixels. */
  rightWidth: number;
  /** The apps the sidebar lists, in order. The others stay in All apps. */
  sidebarApps: SidebarApp[];
  /** Notes, task lists and web pages pinned under the apps in the sidebar, in order. */
  favourites: Favourite[];
  /** The note page text saved from a web page goes to, by path; empty for a page called Clippings. */
  clippingsPage: string;
}
/** A note (by page path), a task list (by name) or a web page (by address), kept one click away. */
export interface Favourite { kind: 'note' | 'list' | 'page'; id: string; title: string }
export const MAX_FAVOURITES = 8;
const isFavourite = (v: unknown): v is Favourite => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const { kind, id, title } = v as Record<string, unknown>;
  const text = (s: unknown, max: number) => typeof s === 'string' && s.length > 0 && [...s].length <= max && !/[\u0000-\u001f\u007f]/.test(s);
  return Object.keys(v).length === 3 && (kind === 'note' || kind === 'list' || kind === 'page') && text(id, 2000) && text(title, 120);
};
/** The apps that can be kept in the sidebar. */
export const SIDEBAR_APPS = ['agent', 'search', 'browser', 'mail', 'notes', 'docs', 'sheets', 'slides', 'tasks', 'calendar'] as const;
export type SidebarApp = (typeof SIDEBAR_APPS)[number];
export type SidebarMode = 'attached' | 'floating';
export type NavigationStyle = 'sidebar' | 'rail';
export const SIDEBAR_WIDTH = { left: { min: 200, max: 420, default: 248 }, right: { min: 300, max: 640, default: 380 } } as const;
export const DEFAULT_APPEARANCE: AppearanceSettings = { theme: 'system', zoom: 1, chatTextScale: 1, chatFont: 'system', textDirection: 'auto', density: 'comfortable', toolSteps: 'show', sidebarAtStart: true, resumeLast: true, leftSidebar: 'attached', navigation: 'sidebar', rightSidebar: 'attached', leftWidth: SIDEBAR_WIDTH.left.default, rightWidth: SIDEBAR_WIDTH.right.default, sidebarApps: [...SIDEBAR_APPS], favourites: [], clippingsPage: '' };
export const ZOOM_RANGE = { min: 0.75, max: 1.5 } as const;
export const CHAT_TEXT_RANGE = { min: 0.85, max: 1.4 } as const;

export interface AboutInfo {
  app: string;
  /** The web engine that shows pages, e.g. "Chromium 156" or the system web view. */
  engine: string;
  platform: string;
  arch: string;
  core: { version: string; protocol: number } | null;
  dataFolder: string;
}

/** What the settings panel may know. The key itself is never sent back to the renderer. */
/** The files an agent turn changed, relative to the workspace, and the checkpoint taken before it began. */
export interface TurnChanges { checkpoint: string | null; files: string[] }
export interface AgentFailure { ok: false; error: string }

export interface AgentSettings {
  baseUrl: string;
  model: string;
  system: string;
  configured: boolean;
  hasKey: boolean;
  /** The most model calls one request may use. */
  maxSteps: number;
  /** `keychain`: stored encrypted by the operating system. `session`: kept only until the app closes. */
  keyStorage: 'keychain' | 'session' | 'none';
  /** The second model, if there is one. Its key is never shown. */
  fallbackBaseUrl: string;
  fallbackModel: string;
  hasFallbackKey: boolean;
}

export type AgentNotification =
  | { method: 'agent.delta'; params: { conversation: string; turn: number; text: string } }
  | { method: 'agent.event'; params: { conversation: string; turn: number; event: AgentEvent } }
  /** A second model took over this turn because the first could not answer. */
  | { method: 'agent.notice'; params: { conversation: string; turn: number; kind: 'fallback'; model: string; why: string } };

const MAX_DIMENSION = 20000;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function parseBounds(value: unknown): Bounds | null {
  if (!value || typeof value !== 'object') return null;
  const { x, y, width, height } = value as Record<string, unknown>;
  if (!isNum(x) || !isNum(y) || !isNum(width) || !isNum(height)) return null;
  if (width < 0 || height < 0 || width > MAX_DIMENSION || height > MAX_DIMENSION) return null;
  if (Math.abs(x) > MAX_DIMENSION || Math.abs(y) > MAX_DIMENSION) return null;
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

export function parseTabId(value: unknown): string | null {
  return typeof value === 'string' && /^tab-[a-z0-9]{1,32}$/.test(value) ? value : null;
}

export function parseNavigateRequest(value: unknown): { tabId: string; url: string } | null {
  if (!value || typeof value !== 'object') return null;
  const { tabId, input } = value as Record<string, unknown>;
  const id = parseTabId(tabId);
  if (!id || typeof input !== 'string') return null;
  const result = resolveAddress(input);
  return result.kind === 'url' ? { tabId: id, url: result.url } : null;
}

export const MAX_MESSAGE_CHARS = 32_000;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === 'string';

export function parseConversationId(value: unknown): string | null {
  return isString(value) && /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : null;
}

export function parseSendRequest(value: unknown): { conversation: string; text: string; context: ContextItem[] } | null {
  if (!isObject(value)) return null;
  const conversation = parseConversationId(value.conversation);
  const { text } = value;
  if (!conversation || !isString(text) || text.trim() === '' || [...text].length > MAX_MESSAGE_CHARS) return null;
  const context = value.context === undefined ? [] : value.context;
  if (!isContextList(context)) return null;
  return { conversation, text, context };
}

/** A model name sent by the window for the switcher. */
export function parseModelName(value: unknown): string | null {
  return isModelName(value) ? value : null;
}

export const MAX_RECORDING_BYTES = 12 * 1024 * 1024;
const AUDIO_TYPES = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/wav', 'audio/mpeg'] as const;
export type AudioType = (typeof AUDIO_TYPES)[number];

/** A recording sent by the window: bytes of a known audio type, not empty and not huge. A "codecs" note on the type is dropped. */
export function parseRecording(audio: unknown, mime: unknown): { bytes: Uint8Array; mime: AudioType } | null {
  if (typeof mime !== 'string') return null;
  const base = mime.split(';')[0]?.trim().toLowerCase() ?? '';
  const type = AUDIO_TYPES.find((known) => known === base);
  if (!type) return null;
  const bytes = audio instanceof ArrayBuffer ? new Uint8Array(audio) : audio instanceof Uint8Array ? audio : null;
  if (!bytes || bytes.byteLength === 0 || bytes.byteLength > MAX_RECORDING_BYTES) return null;
  return { bytes, mime: type };
}

const DURATIONS: readonly Duration[] = ['once', 'session', 'always'];

export function parseResolveRequest(value: unknown): { requestId: number; approve: boolean; duration: Duration } | null {
  if (!isObject(value)) return null;
  const { requestId, approve, duration } = value;
  if (typeof requestId !== 'number' || !Number.isSafeInteger(requestId) || requestId < 1) return null;
  if (typeof approve !== 'boolean') return null;
  if (!isString(duration) || !DURATIONS.includes(duration as Duration)) return null;
  return { requestId, approve, duration: duration as Duration };
}

function parseFallback(value: unknown): FallbackRequest | null {
  if (!isObject(value)) return null;
  const { baseUrl, model } = value;
  if (!isString(baseUrl) || !isString(model)) return null;
  const url = baseUrl.trim();
  const name = model.trim();
  if (!url || url.length > 2048 || !name || name.length > 200) return null;
  const second: FallbackRequest = { baseUrl: url, model: name };
  const key = value.apiKey;
  if (key !== undefined && key !== null && key !== '') {
    if (!isString(key) || key.length > 4096) return null;
    second.apiKey = key;
  }
  if (value.clearKey !== undefined && typeof value.clearKey !== 'boolean') return null;
  if (value.clearKey === true) second.clearKey = true;
  return second;
}

export function parseConfigureRequest(value: unknown): AgentConfigureRequest | null {
  if (!isObject(value)) return null;
  const { baseUrl, model } = value;
  if (!isString(baseUrl) || !isString(model)) return null;
  const url = baseUrl.trim();
  const name = model.trim();
  if (!url || url.length > 2048 || !name || name.length > 200) return null;
  const request: AgentConfigureRequest = { baseUrl: url, model: name };
  for (const [field, limit] of [['apiKey', 4096], ['system', 8000]] as const) {
    const given = value[field];
    if (given === undefined || given === null || given === '') continue;
    if (!isString(given) || given.length > limit) return null;
    request[field] = given;
  }
  if (value.fallback !== undefined && value.fallback !== null) {
    const second = parseFallback(value.fallback);
    if (!second) return null;
    request.fallback = second;
  }
  if (value.maxSteps !== undefined && value.maxSteps !== null) {
    if (typeof value.maxSteps !== 'number' || !Number.isInteger(value.maxSteps) || value.maxSteps < 1 || value.maxSteps > 100) return null;
    request.maxSteps = value.maxSteps;
  }
  if (value.clearKey !== undefined && typeof value.clearKey !== 'boolean') return null;
  if (value.clearKey === true) request.clearKey = true;
  return request;
}

/** A group in the composer's model picker: a plan, a provider with a key, this computer, or the server in use. */
export interface ModelGroup {
  kind: 'subscription' | 'provider' | 'local' | 'server';
  id: string;
  name: string;
  /** The agent is using this group now. */
  active: boolean;
  models: Array<{ id: string; label: string; current?: boolean }>;
  error: string | null;
}
export interface ModelCatalog { current: string; groups: ModelGroup[] }

/** Settings > Advanced > Other apps. */
export interface FileEntry { name: string; type: 'file' | 'folder'; bytes?: number }
export interface ConnectorStatus { running: string[]; failed: { server: string; error: string }[]; problem: string | null }
export interface ShareStatus { enabled: boolean; allowChanges: boolean; port: number; running: boolean; url: string | null; problem: string | null }

/** A question the model put to the person. */
export interface AgentQuestion { callId: string; question: string; choices: string[] }

const TODO_STATUSES = ['pending', 'in_progress', 'done'];
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;

function validEvent(event: unknown): event is AgentEvent {
  if (!isObject(event)) return false;
  switch (event.kind) {
    case 'message': return isString(event.text);
    case 'tool_call': return isString(event.call_id) && isString(event.name);
    case 'tool_result': return isString(event.call_id) && isString(event.name) && typeof event.is_error === 'boolean';
    case 'needs_approval': return isCount(event.request_id) && isString(event.call_id) && isString(event.tool) && 'arguments' in event && (event.once_only === undefined || typeof event.once_only === 'boolean') && (event.origin === undefined || event.origin === null || typeof event.origin === 'string');
    case 'failed': return isString(event.message);
    case 'compacted': return isCount(event.messages);
    case 'todo': return Array.isArray(event.items) && event.items.length <= 50 && event.items.every((i: unknown) => isObject(i) && isString(i.text) && i.text.length <= 300 && TODO_STATUSES.includes(i.status as string));
    case 'question': return isString(event.call_id) && isString(event.question) && event.question.length > 0 && event.question.length <= 1000 && Array.isArray(event.choices) && event.choices.length <= 6 && event.choices.every((c: unknown) => isString(c) && c.length <= 200);
    case 'done':
    case 'cancelled': return true;
    case 'paused': return isCount(event.step) && (event.of === undefined || event.of === null || isCount(event.of));
    case 'resumed': return true;
    default: return false;
  }
}

/** Notifications come from our own core, but they cross a process boundary, so they are checked before the renderer sees them. */
export function parseAgentNotification(value: unknown): AgentNotification | null {
  if (!isObject(value) || !isObject(value.params)) return null;
  const { params } = value;
  const conversation = parseConversationId(params.conversation);
  if (!conversation || !isCount(params.turn)) return null;
  if (value.method === 'agent.delta') {
    return isString(params.text) ? { method: 'agent.delta', params: { conversation, turn: params.turn, text: params.text } } : null;
  }
  if (value.method === 'agent.event') {
    return validEvent(params.event) ? { method: 'agent.event', params: { conversation, turn: params.turn, event: params.event } } : null;
  }
  if (value.method === 'agent.notice') {
    const { kind, model, why } = params;
    if (kind !== 'fallback' || !isString(model) || model === '' || model.length > 200 || !isString(why) || why.length > 300) return null;
    return { method: 'agent.notice', params: { conversation, turn: params.turn, kind, model, why } };
  }
  return null;
}

export function parseGrantId(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 ? value : null;
}

const DEFAULT_ACTIVITY = 50;
const MAX_ACTIVITY = 200;

export function parseActivityLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_ACTIVITY;
  return Math.min(MAX_ACTIVITY, Math.max(1, Math.floor(value)));
}

/** A model's name as a server knows it: short, one line, nothing odd. */
export const isModelName = (v: unknown): v is string => typeof v === 'string' && v.length >= 1 && v.length <= 200 && !/[\u0000-\u001f\u007f]/.test(v);
const inRange = (v: unknown, range: { min: number; max: number }): v is number => typeof v === 'number' && Number.isFinite(v) && v >= range.min && v <= range.max;
const oneOf = <T extends string>(...choices: T[]) => (v: unknown): v is T => typeof v === 'string' && (choices as string[]).includes(v);

/** How each appearance setting is checked. Adding a setting means adding it here, to the type, and to the defaults. */
export const APPEARANCE_CHECKS: { [K in keyof AppearanceSettings]: (v: unknown) => v is AppearanceSettings[K] } = {
  theme: oneOf<ThemeChoice>('system', 'light', 'dark'),
  zoom: (v): v is number => inRange(v, ZOOM_RANGE),
  chatTextScale: (v): v is number => inRange(v, CHAT_TEXT_RANGE),
  chatFont: oneOf<ChatFont>('system', 'serif', 'mono'),
  textDirection: oneOf<TextDirection>('auto', 'ltr', 'rtl'),
  density: oneOf<Density>('comfortable', 'compact'),
  toolSteps: oneOf<ToolSteps>('show', 'hide-finished'),
  sidebarAtStart: (v): v is boolean => typeof v === 'boolean',
  resumeLast: (v): v is boolean => typeof v === 'boolean',
  leftSidebar: oneOf<SidebarMode>('attached', 'floating'),
  navigation: oneOf<NavigationStyle>('sidebar', 'rail'),
  rightSidebar: oneOf<SidebarMode>('attached', 'floating'),
  leftWidth: (v): v is number => inRange(v, SIDEBAR_WIDTH.left),
  rightWidth: (v): v is number => inRange(v, SIDEBAR_WIDTH.right),
  clippingsPage: (v): v is string => typeof v === 'string' && (v === '' || (v.endsWith('.md') && [...v].length <= 500 && !/[\u0000-\u001f\u007f]/.test(v))),
  favourites: (v): v is Favourite[] => Array.isArray(v) && v.length <= MAX_FAVOURITES && v.every(isFavourite),
  sidebarApps: (v): v is SidebarApp[] => Array.isArray(v) && v.length > 0 && v.length <= SIDEBAR_APPS.length && new Set(v).size === v.length && v.every((id) => (SIDEBAR_APPS as readonly unknown[]).includes(id)),
};

/** A change to a group of settings: any of the known fields, each checked. Anything unknown is dropped; nothing valid means null. */
export function parsePatch<T extends object>(checks: { [K in keyof T]: (v: unknown) => v is T[K] }, value: unknown): Partial<T> | null {
  if (!isObject(value)) return null;
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(checks) as Array<keyof T & string>) {
    if (value[key] === undefined) continue;
    if (!checks[key](value[key])) return null;
    patch[key] = value[key];
  }
  return Object.keys(patch).length > 0 ? (patch as Partial<T>) : null;
}

export function parseAppearancePatch(value: unknown): Partial<AppearanceSettings> | null {
  return parsePatch(APPEARANCE_CHECKS, value);
}

/** Choices about how Mobius behaves around you, as opposed to how it looks. */
export interface PreferencesSettings {
  /** Tell me when the agent is waiting for my answer and Mobius is in the background. */
  notifyNeedsYou: boolean;
  /** Tell me when a request finishes or fails and Mobius is in the background. */
  notifyFinished: boolean;
  /** Tell me when a download finishes and Mobius is in the background. */
  notifyDownloads: boolean;
  /** Notifications arrive without a sound. */
  muteSounds: boolean;
  /** Stop the computer sleeping while the agent is working. */
  keepAwake: boolean;
  /** How much text a local model keeps in view. More uses more graphics memory. */
  localContext: number;
  /** Let the agent open, read and act on addresses on this computer or the local network. Off unless chosen. */
  agentPrivateUrls: boolean;
  /** As in Hermes: manual asks, smart has a reviewer model look first, off does not ask. A block the person set still blocks. */
  approvalMode: ApprovalModeChoice;
  /** The keyboard shortcuts. The one for quick entry works from anywhere on the computer and is off until chosen. */
  keybindings: KeyBindings;
  /** How hard the model is asked to think: low, medium or high, or empty to leave it to the model. Only models that reason use it. */
  reasoningEffort: EffortChoice;
  /** The speech-to-text model asked for when dictating, on the same server as the chat model. */
  dictationModel: string;
  /** How much the agent may do in each app without asking: off, ask (the usual), read, or act. Risky actions still ask. */
  appAccess: AppAccess;
}
export interface ProfilesState { current: string; list: { id: string; name: string }[] }
/** A scheduled request as the person writes it: `time` is "HH:MM" local; `days` 1 (Monday) to 7 (Sunday). */
export interface ScheduleDraft { title: string; prompt: string; time: string; days: number[]; enabled: boolean }
export interface ScheduleInfo extends ScheduleDraft { id: string; lastRunMs: number | null }
/** Per app: follow the approval mode, always ask the person, or off. */
export type AccessLevel = 'follow' | 'always' | 'off';
/** `calendar` came later: a setting saved before it leaves it out, and it follows the mode. */
export type AppAccess = Record<'browser' | 'notes' | 'tasks', AccessLevel> & { docs?: AccessLevel; sheets?: AccessLevel; slides?: AccessLevel; calendar?: AccessLevel; mail?: AccessLevel; research?: AccessLevel; reader?: AccessLevel; code?: AccessLevel; database?: AccessLevel; design?: AccessLevel; canvas?: AccessLevel; photo?: AccessLevel; studio?: AccessLevel; video?: AccessLevel; skills?: AccessLevel };
export const DEFAULT_APP_ACCESS: AppAccess = { browser: 'follow', notes: 'follow', docs: 'follow', sheets: 'follow', slides: 'follow', tasks: 'follow', calendar: 'follow', mail: 'follow', research: 'follow', reader: 'follow', code: 'follow', database: 'follow', design: 'follow', canvas: 'follow', photo: 'follow', studio: 'follow', video: 'follow', skills: 'follow' };
const ACCESS_LEVELS: readonly string[] = ['follow', 'always', 'off'];
export function isAppAccess(v: unknown): v is AppAccess {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  const apps = ['browser', 'notes', 'docs', 'sheets', 'slides', 'tasks', 'calendar', 'mail', 'research', 'reader', 'code', 'database', 'design', 'canvas', 'photo', 'studio', 'video', 'skills'];
  return Object.keys(o).every((k) => apps.includes(k))
    && (['browser', 'notes', 'tasks'] as const).every((app) => ACCESS_LEVELS.includes(o[app] as string))
    && (['docs', 'sheets', 'slides', 'calendar', 'mail'] as const).every((app) => o[app] === undefined || ACCESS_LEVELS.includes(o[app] as string));
}
/** `none` turns thinking off where the model allows it (models on this computer). */
export type EffortChoice = '' | 'none' | 'low' | 'medium' | 'high';
export const DEFAULT_DICTATION_MODEL = 'whisper-1';
/** Ask first (manual), Propose, or Act (smart). Off is from before the three modes and reads as Act. */
export type ApprovalModeChoice = 'manual' | 'propose' | 'smart' | 'off';
/** The context sizes offered for local models. */
export const CONTEXT_SIZES: readonly number[] = [4096, 8192, 16384, 32768, 65536];
export const DEFAULT_CONTEXT = 16384;
/** A chosen context size: one from the list, undefined for 'the default', or null when it is not acceptable. */
export function parseContextSize(value: unknown): number | undefined | null {
  if (value === undefined) return undefined;
  return typeof value === 'number' && CONTEXT_SIZES.includes(value) ? value : null;
}
export const DEFAULT_PREFERENCES: PreferencesSettings = { notifyNeedsYou: true, notifyFinished: true, notifyDownloads: true, muteSounds: false, keepAwake: false, localContext: DEFAULT_CONTEXT, agentPrivateUrls: false, approvalMode: 'propose', keybindings: DEFAULT_KEYBINDINGS, reasoningEffort: '', dictationModel: DEFAULT_DICTATION_MODEL, appAccess: DEFAULT_APP_ACCESS };
const isFlag = (v: unknown): v is boolean => typeof v === 'boolean';
export const PREFERENCES_CHECKS: { [K in keyof PreferencesSettings]: (v: unknown) => v is PreferencesSettings[K] } = {
  notifyNeedsYou: isFlag,
  notifyFinished: isFlag,
  notifyDownloads: isFlag,
  muteSounds: isFlag,
  keepAwake: isFlag,
  localContext: (v): v is number => typeof v === 'number' && CONTEXT_SIZES.includes(v),
  agentPrivateUrls: isFlag,
  approvalMode: oneOf<ApprovalModeChoice>('manual', 'propose', 'smart', 'off'),
  keybindings: isKeyBindings,
  reasoningEffort: oneOf<EffortChoice>('', 'none', 'low', 'medium', 'high'),
  dictationModel: (v): v is string => isModelName(v),
  appAccess: isAppAccess,
};
export function parsePreferencesPatch(value: unknown): Partial<PreferencesSettings> | null {
  return parsePatch(PREFERENCES_CHECKS, value);
}

export function parseModelId(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= 1000 && !value.includes('\0') ? value : null;
}

const REPO_PATTERN = /^[A-Za-z0-9._-]{1,96}\/[A-Za-z0-9._-]{1,96}$/;

/** A repository and a file in it, as the window may name them. The core checks them again. */
export function parseDownloadRequest(repo: unknown, file: unknown): { repo: string; file: string } | null {
  if (typeof repo !== 'string' || typeof file !== 'string' || !REPO_PATTERN.test(repo) || repo.split('/').some((part) => part === '.' || part === '..')) return null;
  if (file.length === 0 || file.length > 400 || !file.toLowerCase().endsWith('.gguf') || /[\\:\0]/.test(file) || file.startsWith('/') || file.split('/').some((part) => part === '' || part === '.' || part === '..')) return null;
  return { repo, file };
}

export function parseSearchQuery(value: unknown): string | null {
  if (value === undefined || value === null) return '';
  return typeof value === 'string' && value.length <= 100 ? value.trim() : null;
}

export function parseFindRequest(value: unknown): FindRequest | null {
  if (!isObject(value)) return null;
  const tabId = parseTabId(value.tabId);
  if (!tabId || typeof value.text !== 'string' || value.text.length === 0 || value.text.length > 200) return null;
  if ((value.forward !== undefined && typeof value.forward !== 'boolean') || (value.again !== undefined && typeof value.again !== 'boolean')) return null;
  return { tabId, text: value.text, forward: value.forward ?? true, again: value.again ?? false };
}

export function parseDownloadId(value: unknown): string | null {
  return typeof value === 'string' && /^dl-[0-9]{1,9}$/.test(value) ? value : null;
}

export function parseHistoryQuery(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, 200) : '';
}

export function parseHistoryUrl(value: unknown): string | null {
  return typeof value === 'string' && value.length <= 2048 ? value : null;
}

/** One message in a Get to zero plan. To-dos also say what goes into Tasks. */
export interface MailPlanRow { id: string; from: string; subject: string; text?: string }
/** Get to zero: what Mobius proposes for everything in the inbox. */
export interface MailPlan { archive: MailPlanRow[]; reply: MailPlanRow[]; todos: MailPlanRow[]; later: MailPlanRow[] }
