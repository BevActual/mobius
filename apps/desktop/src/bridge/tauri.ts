import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  DEFAULT_APPEARANCE,
  DEFAULT_PREFERENCES,
  MAIN_BOT_ID,
  MAIN_BOT_NAME,
  type AboutInfo,
  type AgentNotification,
  type AgentSettings,
  type AppearanceSettings,
  type BotsState,
  type PreferencesSettings,
  type Shortcut,
  type BrowserState,
  type CoreStatus,
  type DownloadEntry,
  type FindResult,
  type MobiusBridge,
  type ModelsEvent,
  type NotesChange,
  type DbChange,
  type TasksChanged,
  type CalendarChanged,
  type SheetsChanged,
  type CodeChanged,
  type CodeTestRun,
  type PhotosChanged,
  type VideoChanged,
  type CodeTestsEvent,
} from '@mobius/shared';

/**
 * The interface's side of the Tauri shell. Every call goes through the one Rust command, `bridge`, which decides what
 * is allowed. When Rust says a call is "not available yet", the call gets the answer in `preview.ts` (an empty list,
 * the default settings, a plain refusal) so the rest of the interface still works. As each part moves to Rust, its
 * entry here is deleted. Nothing in this file holds state or makes a decision.
 */

interface BridgeFailure { kind: 'not_available' | 'invalid'; message: string }

const isFailure = (value: unknown): value is BridgeFailure =>
  typeof value === 'object' && value !== null && 'kind' in value && 'message' in value;

async function call<T>(namespace: string, method: string, args: unknown[], preview: () => T): Promise<T> {
  try {
    return (await invoke('bridge', { namespace, method, args })) as T;
  } catch (error) {
    if (isFailure(error) && error.kind === 'not_available') return preview();
    throw error;
  }
}

/** Calls that expect no answer still go in the order they were made (a hide must not overtake the show before it). */
let queue: Promise<unknown> = Promise.resolve();
function fire(namespace: string, method: string, args: unknown[]): void {
  queue = queue.then(() => invoke('bridge', { namespace, method, args })).catch(() => undefined);
}

/**
 * Listens for an event from Rust. Registering takes a moment, so anything that changed in between would be missed:
 * `catchUp` reads the current value once the listener is in place and passes it on.
 */
function on<T>(event: string, listener: (payload: T) => void, catchUp?: () => Promise<T>): () => void {
  let live = true;
  let off: (() => void) | null = null;
  void listen<T>(event, (e) => live && listener(e.payload)).then((stop) => {
    if (!live) {
      stop();
      return;
    }
    off = stop;
    if (catchUp) void catchUp().then((value) => live && listener(value)).catch(() => undefined);
  });
  return () => {
    live = false;
    off?.();
  };
}

const never = () => () => undefined;
const refused = { ok: false as const, error: 'This is not available in the Tauri preview yet.' };
const NO_AGENT: AgentSettings = { baseUrl: '', model: '', system: '', configured: false, hasKey: false, maxSteps: 25, keyStorage: 'none', fallbackBaseUrl: '', fallbackModel: '', hasFallbackKey: false };

/** A recording as text the bridge can carry. */
function toBase64(audio: ArrayBuffer): string {
  const bytes = new Uint8Array(audio);
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}
const EMPTY_BROWSER: BrowserState = { tabs: [], activeId: null };
const MAIN = { id: MAIN_BOT_ID, name: MAIN_BOT_NAME, instructions: '', model: '', createdMs: 0 };

export function createTauriBridge(): MobiusBridge {
  return {
    platform: navigator.userAgent.includes('Windows') ? 'win32' : navigator.userAgent.includes('Mac') ? 'darwin' : 'linux',
    window: {
      onState: never,
      onShortcut: (listener) => on<Shortcut>('mobius:shortcut', listener),
      quickEntryActive: () => call('window', 'quickEntryActive', [], () => false),
    },
    surface: { setBounds: (bounds) => fire('surface', 'setBounds', [bounds]) },
    changes: {
      lastTurn: (conversation) => call('changes', 'lastTurn', [conversation], () => ({ checkpoint: null, files: [] })),
      undo: (conversation) => call('changes', 'undo', [conversation], () => refused),
      undoFile: (conversation, path) => call('changes', 'undoFile', [conversation, path], () => refused),
      before: (conversation, path) => call('changes', 'before', [conversation, path], () => refused),
      turns: (conversation) => call('changes', 'turns', [conversation], () => ({ ok: true as const, turns: [] })),
      turnBefore: (conversation, start, path) => call('changes', 'turnBefore', [conversation, start, path], () => refused),
      undoTurnFile: (conversation, start, path, force) => call('changes', 'undoTurnFile', [conversation, start, path, force === true], () => refused),
      rewindPreview: (conversation, start) => call('changes', 'rewindPreview', [conversation, start], () => refused),
      rewind: (conversation, start) => call('changes', 'rewind', [conversation, start], () => refused),
      undoRewind: (conversation, undo) => call('changes', 'undoRewind', [conversation, undo], () => refused),
    },
    mini: {
      open: () => call('mini', 'open', [], () => null).then(() => undefined),
      close: () => call('mini', 'close', [], () => null).then(() => undefined),
      isOpen: () => call('mini', 'isOpen', [], () => false),
      showMain: () => call('mini', 'showMain', [], () => null).then(() => undefined),
      setOnTop: (onTop) => call('mini', 'setOnTop', [onTop], () => null).then(() => undefined),
      onChange: (listener) => on<boolean>('mobius:mini', listener, () => call('mini', 'isOpen', [], () => false)),
    },
    profiles: {
      list: () => call('profiles', 'list', [], () => ({ current: 'default', list: [{ id: 'default', name: 'Personal' }] })),
      create: (name) => call('profiles', 'create', [name], () => ({ ok: false as const, error: 'Not here.' })),
      rename: (id, name) => call('profiles', 'rename', [id, name], () => ({ ok: false as const, error: 'Not here.' })),
      remove: (id) => call('profiles', 'remove', [id], () => ({ ok: false as const, error: 'Not here.' })),
      switch: (id) => call('profiles', 'switch', [id], () => ({ ok: false as const, error: 'Not here.' })),
    },
    signins: {
      list: (conversation) => call('signins', 'list', [conversation], () => refused),
      signedIn: (conversation, site) => call('signins', 'signedIn', [conversation, site], () => refused),
      signOut: (conversation, site) => call('signins', 'signOut', [conversation, site], () => refused),
      onNeeded: (listener) => on<{ conversation: string; site: string; tab: string }>('mobius:signin-needed', listener),
      onChanged: (listener) => on<{ conversation: string }>('mobius:signins-changed', listener),
    },
    schedules: {
      list: () => call('schedules', 'list', [], () => []),
      add: (draft) => call('schedules', 'add', [draft], () => refused),
      update: (id, draft) => call('schedules', 'update', [id, draft], () => refused),
      remove: (id) => call('schedules', 'remove', [id], () => null).then(() => undefined),
      runNow: (id) => call('schedules', 'runNow', [id], () => refused),
      onChange: (listener) => on<null>('mobius:schedules-changed', () => listener()),
    },
    memory: {
      list: () => call<string[]>('memory', 'list', [], () => []),
      items: () => call('memory', 'items', [], () => []),
      add: (text, category) => call('memory', 'add', [text, category], () => refused),
      edit: (old, text, category) => call('memory', 'edit', [old, text, category], () => refused),
      forget: (text) => call('memory', 'forget', [text], () => refused),
      keep: (text, on) => call('memory', 'keep', [text, on], () => refused),
      restore: (text, category, source) => call('memory', 'restore', [text, category, source], () => refused),
      onChange: (listener) => on<null>('mobius:memory-changed', () => listener()),
    },
    menu: {
      set: (menus) => call('menu', 'set', [menus], () => null).then(() => undefined),
      onSelect: (listener) => on<string>('mobius:menu', listener),
    },
    tray: {
      set: (shown) => call('tray', 'set', [shown], () => null).then(() => undefined),
      // Its own event: the window's "open the conversation a notice was about" is a different thing.
      onOpenConversation: (listener) => on<string>('mobius:tray-conversation', listener),
      onStopAll: (listener) => on<null>('mobius:tray-stop-all', () => listener()),
    },
    core: {
      getStatus: () => call<CoreStatus>('core', 'getStatus', [], () => 'failed'),
      onStatus: (listener) => on<CoreStatus>('mobius:core-status', listener, () => call<CoreStatus>('core', 'getStatus', [], () => 'failed')),
    },
    agent: {
      send: (conversation, text, context, options) => call('agent', 'send', options && (options.plan || (options.images && options.images.length > 0)) ? [conversation, text, context ?? null, options] : [conversation, text, context ?? null], () => refused),
      models: () => call('agent', 'models', [], () => refused),
      setModel: (model) => call('agent', 'setModel', [model], () => refused),
      transcribe: (audio, mime) => call('agent', 'transcribe', [toBase64(audio), mime], () => refused),
      cancel: (conversation) => call('agent', 'cancel', [conversation], () => undefined).then(() => undefined),
      takeOver: (conversation) => call('agent', 'takeOver', [conversation], () => ({ ok: false as const, error: 'Not available.' })),
      handBack: (conversation) => call('agent', 'handBack', [conversation], () => ({ ok: false as const, error: 'Not available.' })),
      control: (conversation) => call('agent', 'control', [conversation], () => ({ theirs: false })),
      history: (conversation) => call('agent', 'history', [conversation], () => []),
      waiting: (conversation) => call('agent', 'waiting', [conversation], () => []),
      question: (conversation) => call('agent', 'question', [conversation], () => null),
      answer: (conversation, callId, text) => call('agent', 'answer', [conversation, callId, text], () => ({ ok: false as const, error: 'The answer could not be sent.' })),
      conversations: () => call('agent', 'conversations', [], () => []),
      archive: (conversation, archived) => call('agent', 'archive', [conversation, archived], () => []),
      savedServers: () => call('agent', 'savedServers', [], () => []),
      saveServer: (name) => call('agent', 'saveServer', [name], () => refused),
      useServer: (id) => call('agent', 'useServer', [id], () => refused),
      removeServer: (id) => call('agent', 'removeServer', [id], () => refused),
      archived: () => call('agent', 'archived', [], () => []),
      deleteConversation: (conversation) => call('agent', 'deleteConversation', [conversation], () => refused),
      rewind: (conversation) => call('agent', 'rewind', [conversation], () => refused),
      grants: () => call('agent', 'grants', [], () => []),
      revokeGrant: (id) => call('agent', 'revokeGrant', [id], () => refused),
      activity: (limit) => call('agent', 'activity', [limit ?? 50], () => []),
      resolve: (requestId, approve, duration) => call('agent', 'resolve', [requestId, approve, duration], () => refused),
      getSettings: () => call('agent', 'getSettings', [], () => NO_AGENT),
      configure: (settings) => call('agent', 'configure', [settings], () => refused),
      onNotification: (listener) => on<AgentNotification>('mobius:agent-notification', listener),
      onSettings: (listener) => on<AgentSettings>('mobius:agent-settings', listener, () => call('agent', 'getSettings', [], () => NO_AGENT)),
    },
    appearance: {
      get: () => call('appearance', 'get', [], () => DEFAULT_APPEARANCE),
      set: (change) => call('appearance', 'set', [change], () => DEFAULT_APPEARANCE),
      onChange: (listener) => on<AppearanceSettings>('mobius:appearance-changed', listener, () => call('appearance', 'get', [], () => DEFAULT_APPEARANCE)),
    },
    models: {
      hardware: () => call('models', 'hardware', [], () => null),
      local: () => call('models', 'local', [], () => []),
      status: () => call('models', 'status', [], () => ({ binary: null, runtime: null })),
      discover: (query) => call('models', 'discover', [query], () => ({ ok: false, error: refused.error }) as never),
      download: (repo, file) => call('models', 'download', [repo, file], () => ({ ok: false, error: refused.error }) as never),
      cancelDownload: () => call('models', 'cancelDownload', [], () => undefined).then(() => undefined),
      start: (id, context) => call('models', 'start', [id, context ?? null], () => ({ ok: false, error: refused.error }) as never),
      stop: () => call('models', 'stop', [], () => ({ ok: false, error: refused.error }) as never),
      engine: () => call('models', 'engine', [], () => null),
      installEngine: () => call('models', 'installEngine', [], () => ({ ok: false as const, error: refused.error })),
      cancelEngine: () => call('models', 'cancelEngine', [], () => undefined).then(() => undefined),
      autostart: () => call('models', 'autostart', [], () => ({ enabled: false, modelId: null })),
      setAutostart: (on) => call('models', 'setAutostart', [on], () => ({ ok: false as const, error: refused.error })),
      onEvent: (listener) => on<ModelsEvent>('mobius:models-event', listener),
    },
    providers: {
      catalog: () => call('providers', 'catalog', [], () => ({ current: '', groups: [] })),
      accounts: () => call('providers', 'accounts', [], () => []),
      accountStatus: (id) => call('providers', 'accountStatus', [id], () => ({ installed: false, signedIn: false })),
      signIn: (id) => call('providers', 'signIn', [id], () => ({ ok: false as const, error: 'Sign-in is not available.' })),
      cancelSignIn: (id) => call('providers', 'cancelSignIn', [id], () => undefined).then(() => undefined),
      signOut: (id) => call('providers', 'signOut', [id], () => undefined).then(() => undefined),
      list: () => call('providers', 'list', [], () => []),
      setKey: (id, key) => call('providers', 'setKey', [id, key], () => ({ ok: false as const, error: 'Providers are not available.' })),
      removeKey: (id) => call('providers', 'removeKey', [id], () => undefined),
      models: (id) => call('providers', 'models', [id], () => ({ ok: false as const, error: 'Providers are not available.' })),
      use: (id, model) => call('providers', 'use', [id, model], () => ({ ok: false as const, error: 'Providers are not available.' })),
      onChanged: (listener) => on<null>('mobius:providers-changed', () => listener()),
    },
    projects: {
      list: () => call('projects', 'list', [], () => []),
      create: (name) => call('projects', 'create', [name], () => ({ ok: false as const, message: 'Projects are not available.' })),
      rename: (id, name) => call('projects', 'rename', [id, name], () => ({ ok: false as const, message: 'Projects are not available.' })),
      remove: (id) => call('projects', 'remove', [id], () => ({ ok: false as const, message: 'Projects are not available.' })),
      setRule: (id, app, level) => call('projects', 'setRule', [id, app, level], () => ({ ok: false as const, message: 'Projects are not available.' })),
      addSide: (id, parent, conversation, bot, botName, ask) => call('projects', 'addSide', [id, parent, conversation, bot, botName, ask], () => ({ ok: false as const, message: 'Projects are not available.' })),
      report: (conversation, text) => call('projects', 'report', [conversation, text], () => ({ ok: false as const, message: 'Projects are not available.' })),
      addThread: (id, conversation) => call('projects', 'addThread', [id, conversation], () => ({ ok: false as const, message: 'Projects are not available.' })),
      onChanged: (listener) => on<null>('mobius:projects-changed', () => listener()),
    },
    comments: {
      list: (app, doc) => call('comments', 'list', [app, doc], () => []),
      all: (app) => call('comments', 'all', [app], () => []),
      set: (app, doc, threads) => call('comments', 'set', [app, doc, threads], () => ({ ok: false as const, message: 'Comments are not available.' })),
      onChanged: (listener) => on<{ app?: string } | null>('mobius:comments-changed', (p) => listener(p?.app ?? '')),
    },
    files: {
      list: (path) => call('files', 'list', [path], () => ({ error: 'Not available.' })),
    },
    extensions: {
      connectors: () => call('extensions', 'connectors', [], () => ({ running: [], failed: [], problem: null })),
    },
    share: {
      status: () => call('share', 'status', [], () => ({ enabled: false, allowChanges: false, port: 0, running: false, url: null, problem: 'Not available.' })),
      set: (change) => call('share', 'set', [change], () => ({ ok: false as const, error: 'Not available.' })),
      token: () => call('share', 'token', [], () => null),
      renewToken: () => call('share', 'renewToken', [], () => ({ ok: false as const, error: 'Not available.' })),
    },
    tasks: {
      lists: () => call('tasks', 'lists', [], () => []),
      read: (list) => call('tasks', 'read', [list], () => ({ ok: false as const, message: 'Tasks is not available.' })),
      createList: (name) => call('tasks', 'createList', [name], () => ({ ok: false as const, message: 'Tasks is not available.' })),
      add: (list, text, due, options) => call('tasks', 'add', [list, text, due ?? '', options ?? {}], () => ({ ok: false as const, message: 'Tasks is not available.' })),
      update: (list, line, expect, change) => call('tasks', 'update', [list, line, expect, change], () => ({ ok: false as const, message: 'Tasks is not available.' })),
      remove: (list, line, expect) => call('tasks', 'remove', [list, line, expect], () => ({ ok: false as const, message: 'Tasks is not available.' })),
      restore: (list, line, text) => call('tasks', 'restore', [list, line, text], () => ({ ok: false as const, message: 'Tasks is not available.' })),
      move: (list, line, expect, to, before) => call('tasks', 'move', before ? [list, line, expect, to, before] : [list, line, expect, to], () => ({ ok: false as const, message: 'Tasks is not available.' })),
      renameList: (list, to) => call('tasks', 'renameList', [list, to], () => ({ ok: false as const, message: 'Tasks is not available.' })),
      deleteList: (list) => call('tasks', 'deleteList', [list], () => ({ ok: false as const, message: 'Tasks is not available.' })),
      restoreList: (list, text) => call('tasks', 'restoreList', [list, text], () => ({ ok: false as const, message: 'Tasks is not available.' })),
      clearDone: (list) => call('tasks', 'clearDone', [list], () => ({ ok: false as const, message: 'Tasks is not available.' })),
      onChanged: (listener) => on<TasksChanged>('mobius:tasks-changed', listener),
    },
    mail: {
      accounts: () => call('mail', 'accounts', [], () => []),
      connect: (account) => call('mail', 'connect', [account], () => ({ ok: false as const, message: 'Mail is not available.' })),
      removeAccount: (id) => call('mail', 'removeAccount', [id], () => ({ ok: false as const, message: 'Mail is not available.' })),
      sync: (id) => call('mail', 'sync', [id], () => []),
      list: (box, category, query) => call('mail', 'list', [box, category, query], () => []),
      counts: () => call('mail', 'counts', [], () => ({ primary: 0, transactions: 0, updates: 0, all: 0, drafts: 0, suggested: 0 })),
      read: (id) => call('mail', 'read', [id], () => ({ ok: false as const, message: 'Mail is not available.' })),
      flag: (id, which, on) => call('mail', 'flag', [id, which, on], () => ({ ok: false as const, message: 'Mail is not available.' })),
      sort: (id, category) => call('mail', 'sort', [id, category], () => ({ ok: false as const, message: 'Mail is not available.' })),
      drafts: () => call('mail', 'drafts', [], () => []),
      saveDraft: (draft) => call('mail', 'saveDraft', [draft], () => ({ ok: false as const, message: 'Mail is not available.' })),
      deleteDraft: (id) => call('mail', 'deleteDraft', [id], () => ({ ok: false as const, message: 'Mail is not available.' })),
      plan: () => call('mail', 'plan', [], () => ({ ok: false as const, message: 'Not available.' })),
      keepPlan: (plan) => call('mail', 'keepPlan', [plan], () => ({ ok: false as const, message: 'Not available.' })),
      undoPlan: () => call('mail', 'undoPlan', [], () => ({ ok: false as const, message: 'Not available.' })),
      archive: (id, on) => call('mail', 'archive', [id, on], () => ({ ok: false as const, message: 'Not available.' })),
      remind: (id, atMs) => call('mail', 'remind', [id, atMs], () => ({ ok: false as const, message: 'Not available.' })),
      schedule: (id, atMs) => call('mail', 'schedule', [id, atMs], () => ({ ok: false as const, message: 'Not available.' })),
      suggestSend: (id) => call('mail', 'suggestSend', [id], () => null),
      send: (id) => call('mail', 'send', [id], () => ({ ok: false as const, message: 'Mail is not available.' })),
      onChanged: (listener) => on<{ by: string }>('mobius:mail-changed', listener),
    },
    video: {
      projects: () => call('video', 'projects', [], () => []),
      createProject: (name) => call('video', 'createProject', [name], () => ({ ok: false as const, message: 'Video is not available.' })),
      readCut: (project) => call('video', 'readCut', [project], () => ({ ok: false as const, message: 'Video is not available.' })),
      saveCut: (project, text, base) => call('video', 'saveCut', [project, text, base], () => ({ ok: false as const, message: 'Video is not available.' })),
      addClip: (project, name, data) => call('video', 'addClip', [project, name, data], () => ({ ok: false as const, message: 'Video is not available.' })),
      showFolder: (project) => call('video', 'showFolder', [project], () => ({ ok: false as const, message: 'Video is not available.' })),
      onChanged: (listener) => on<VideoChanged>('mobius:video-changed', listener),
    },
    skills: {
      list: () => call('skills', 'list', [], () => []),
      read: (name) => call('skills', 'read', [name], () => ({ ok: false as const, message: 'Skills is not available.' })),
      save: (name, text, base) => call('skills', 'save', [name, text, base], () => ({ ok: false as const, message: 'Skills is not available.' })),
      create: (title, description) => call('skills', 'create', [title, description], () => ({ ok: false as const, message: 'Skills is not available.' })),
      install: (text) => call('skills', 'install', [text], () => ({ ok: false as const, message: 'Skills is not available.' })),
      restore: (name, version) => call('skills', 'restore', [name, version], () => ({ ok: false as const, message: 'Skills is not available.' })),
      remove: (name) => call('skills', 'remove', [name], () => ({ ok: false as const, message: 'Skills is not available.' })),
      onChanged: (listener) => on<{ name: string | null; by: string }>('mobius:skills-changed', listener),
    },
    photos: {
      albums: () => call('photos', 'albums', [], () => []),
      createAlbum: (name) => call('photos', 'createAlbum', [name], () => ({ ok: false as const, message: 'Photo is not available.' })),
      read: (path) => call('photos', 'read', [path], () => ({ ok: false as const, message: 'Photo is not available.' })),
      saveEdits: (path, text, base) => call('photos', 'saveEdits', [path, text, base], () => ({ ok: false as const, message: 'Photo is not available.' })),
      add: (album, name, data) => call('photos', 'add', [album, name, data], () => ({ ok: false as const, message: 'Photo is not available.' })),
      export: (path, data) => call('photos', 'export', [path, data], () => ({ ok: false as const, message: 'Photo is not available.' })),
      onChanged: (listener) => on<PhotosChanged>('mobius:photos-changed', listener),
    },
    code: {
      projects: () => call('code', 'projects', [], () => []),
      createProject: (name) => call('code', 'createProject', [name], () => ({ ok: false as const, message: 'Code is not available.' })),
      tree: (project) => call('code', 'tree', [project], () => ({ ok: false as const, message: 'Code is not available.' })),
      read: (project, path) => call('code', 'read', [project, path], () => ({ ok: false as const, message: 'Code is not available.' })),
      save: (project, path, text, base) => call('code', 'save', [project, path, text, base], () => ({ ok: false as const, message: 'Code is not available.' })),
      createFile: (project, path) => call('code', 'createFile', [project, path], () => ({ ok: false as const, message: 'Code is not available.' })),
      removeFile: (project, path) => call('code', 'removeFile', [project, path], () => ({ ok: false as const, message: 'Code is not available.' })),
      testCommand: (project) => call('code', 'testCommand', [project], () => ({ ok: false as const, message: 'Code is not available.' })),
      setTestCommand: (project, command) => call('code', 'setTestCommand', [project, command], () => ({ ok: false as const, message: 'Code is not available.' })),
      runTests: (project) => call('code', 'runTests', [project], () => ({ ok: false as const, message: 'Code is not available.' })),
      git: (project) => call('code', 'git', [project], () => ({ repo: false as const })),
      processes: (project) => call('code', 'processes', [project], () => []),
      start: (project, command) => call('code', 'start', [project, command], () => ({ ok: false as const, message: 'Code is not available.' })),
      stopProcess: (id) => call('code', 'stopProcess', [id], () => ({ ok: false as const, message: 'Code is not available.' })),
      onProcesses: (listener) => on<unknown>('mobius:code-processes', () => listener()),
      runCommand: (project, command) => call('code', 'runCommand', [project, command], () => ({ ok: false as const, message: 'Code is not available.' })),
      onConsole: (listener) => on<{ project: string; command: string; result: CodeTestRun; by: 'person' | 'assistant' }>('mobius:code-console', listener),
      commit: (project, message) => call('code', 'commit', [project, message], () => ({ ok: false as const, message: 'Code is not available.' })),
      push: (project) => call('code', 'push', [project], () => ({ ok: false as const, message: 'Code is not available.' })),
      onChanged: (listener) => on<CodeChanged>('mobius:code-changed', listener),
      onTests: (listener) => on<CodeTestsEvent>('mobius:code-tests', listener),
    },
    sheets: {
      list: () => call('sheets', 'list', [], () => []),
      read: (workbook, sheet) => call('sheets', 'read', [workbook, sheet], () => ({ ok: false as const, message: 'Sheets is not available.' })),
      set: (workbook, sheet, cells, version) => call('sheets', 'set', [workbook, sheet, cells, version], () => ({ ok: false as const, message: 'Sheets is not available.' })),
      shift: (workbook, sheet, what, at, insert) => call('sheets', 'shift', [workbook, sheet, what, at, insert], () => ({ ok: false as const, message: 'Sheets is not available.' })),
      createWorkbook: (name) => call('sheets', 'createWorkbook', [name], () => ({ ok: false as const, message: 'Sheets is not available.' })),
      addSheet: (workbook, name) => call('sheets', 'addSheet', [workbook, name], () => ({ ok: false as const, message: 'Sheets is not available.' })),
      renameSheet: (workbook, sheet, name) => call('sheets', 'renameSheet', [workbook, sheet, name], () => ({ ok: false as const, message: 'Sheets is not available.' })),
      removeSheet: (workbook, sheet) => call('sheets', 'removeSheet', [workbook, sheet], () => ({ ok: false as const, message: 'Sheets is not available.' })),
      onChanged: (listener) => on<SheetsChanged>('mobius:sheets-changed', listener),
    },
    calendar: {
      calendars: () => call('calendar', 'calendars', [], () => []),
      events: (from, to) => call('calendar', 'events', [from, to], () => []),
      create: (name) => call('calendar', 'create', [name], () => ({ ok: false as const, message: 'Calendar is not available.' })),
      add: (calendar, draft) => call('calendar', 'add', [calendar, draft], () => ({ ok: false as const, message: 'Calendar is not available.' })),
      update: (calendar, id, draft) => call('calendar', 'update', [calendar, { ...draft, id }], () => ({ ok: false as const, message: 'Calendar is not available.' })),
      remove: (calendar, id) => call('calendar', 'remove', [calendar, id], () => ({ ok: false as const, message: 'Calendar is not available.' })),
      sources: () => call('calendar', 'sources', [], () => []),
      suggestions: () => call('calendar', 'suggestions', [], () => []),
      accept: (id) => call('calendar', 'accept', [id], () => ({ ok: false as const, message: 'Calendar is not available.' })),
      decline: (id) => call('calendar', 'decline', [id], () => ({ ok: false as const, message: 'Calendar is not available.' })),
      accounts: () => call('calendar', 'accounts', [], () => []),
      subscribe: (name, link) => call('calendar', 'subscribe', [name, link], () => ({ ok: false as const, message: 'Calendar is not available.' })),
      connect: (account) => call('calendar', 'connect', [account], () => ({ ok: false as const, message: 'Calendar is not available.' })),
      removeAccount: (id) => call('calendar', 'removeAccount', [id], () => ({ ok: false as const, message: 'Calendar is not available.' })),
      sync: (id) => call('calendar', 'sync', [id], () => []),
      onChanged: (listener) => on<CalendarChanged>('mobius:calendar-changed', listener),
    },
    notes: {
      list: () => call('notes', 'list', [], () => []),
      read: (path) => call('notes', 'read', [path], () => ({ ok: false as const, message: 'Notes is not available.' })),
      save: (path, content, base) => call('notes', 'save', [path, content, base], () => ({ ok: false as const, message: 'Notes is not available.' })),
      createNotebook: (name) => call('notes', 'createNotebook', [name], () => ({ ok: false as const, message: 'Notes is not available.' })),
      createPage: (notebook, title) => call('notes', 'createPage', [notebook, title], () => ({ ok: false as const, message: 'Notes is not available.' })),
      remove: (path) => call('notes', 'remove', [path], () => ({ ok: false as const, message: 'Notes is not available.' })),
      search: (query) => call('notes', 'search', [query], () => []),
      versions: (path) => call('notes', 'versions', [path], () => []),
      attach: (path, name, base64) => call('notes', 'attach', [path, name, base64], () => ({ ok: false as const, message: 'Notes is not available.' })),
      asset: (path, ref) => call('notes', 'asset', [path, ref], () => ({ ok: false as const, message: 'Notes is not available.' })),
      comments: (path) => call('notes', 'comments', [path], () => []),
      setComments: (path, comments) => call('notes', 'setComments', [path, comments], () => ({ ok: false as const, message: 'Notes is not available.' })),
      export: (path, kind, html) => call('notes', 'export', [path, kind, html ?? null], () => ({ ok: false as const, message: 'Notes is not available.' })),
      onChanged: (listener) => on<NotesChange>('mobius:notes-changed', listener),
    },
    docs: {
      list: () => call('docs', 'list', [], () => []),
      read: (path) => call('docs', 'read', [path], () => ({ ok: false as const, message: 'Docs is not available.' })),
      save: (path, content, base) => call('docs', 'save', [path, content, base], () => ({ ok: false as const, message: 'Docs is not available.' })),
      createNotebook: (name) => call('docs', 'createNotebook', [name], () => ({ ok: false as const, message: 'Docs is not available.' })),
      createPage: (notebook, title) => call('docs', 'createPage', [notebook, title], () => ({ ok: false as const, message: 'Docs is not available.' })),
      remove: (path) => call('docs', 'remove', [path], () => ({ ok: false as const, message: 'Docs is not available.' })),
      search: (query) => call('docs', 'search', [query], () => []),
      onChanged: (listener) => on<NotesChange>('mobius:docs-changed', listener),
    },
    slides: {
      list: () => call('slides', 'list', [], () => []),
      read: (path) => call('slides', 'read', [path], () => ({ ok: false as const, message: 'Slides is not available.' })),
      save: (path, content, base) => call('slides', 'save', [path, content, base], () => ({ ok: false as const, message: 'Slides is not available.' })),
      createNotebook: (name) => call('slides', 'createNotebook', [name], () => ({ ok: false as const, message: 'Slides is not available.' })),
      createPage: (notebook, title) => call('slides', 'createPage', [notebook, title], () => ({ ok: false as const, message: 'Slides is not available.' })),
      remove: (path) => call('slides', 'remove', [path], () => ({ ok: false as const, message: 'Slides is not available.' })),
      search: (query) => call('slides', 'search', [query], () => []),
      onChanged: (listener) => on<NotesChange>('mobius:slides-changed', listener),
    },
    designs: {
      list: () => call('designs', 'list', [], () => []),
      read: (path) => call('designs', 'read', [path], () => ({ ok: false as const, message: 'Design is not available.' })),
      save: (path, content, base) => call('designs', 'save', [path, content, base], () => ({ ok: false as const, message: 'Design is not available.' })),
      createNotebook: (name) => call('designs', 'createNotebook', [name], () => ({ ok: false as const, message: 'Design is not available.' })),
      createPage: (notebook, title) => call('designs', 'createPage', [notebook, title], () => ({ ok: false as const, message: 'Design is not available.' })),
      remove: (path) => call('designs', 'remove', [path], () => ({ ok: false as const, message: 'Design is not available.' })),
      search: (query) => call('designs', 'search', [query], () => []),
      onChanged: (listener) => on<NotesChange>('mobius:designs-changed', listener),
    },
    boards: {
      list: () => call('boards', 'list', [], () => []),
      read: (path) => call('boards', 'read', [path], () => ({ ok: false as const, message: 'Canvas is not available.' })),
      save: (path, content, base) => call('boards', 'save', [path, content, base], () => ({ ok: false as const, message: 'Canvas is not available.' })),
      createNotebook: (name) => call('boards', 'createNotebook', [name], () => ({ ok: false as const, message: 'Canvas is not available.' })),
      createPage: (notebook, title) => call('boards', 'createPage', [notebook, title], () => ({ ok: false as const, message: 'Canvas is not available.' })),
      remove: (path) => call('boards', 'remove', [path], () => ({ ok: false as const, message: 'Canvas is not available.' })),
      search: (query) => call('boards', 'search', [query], () => []),
      onChanged: (listener) => on<NotesChange>('mobius:boards-changed', listener),
    },
    research: {
      list: () => call('research', 'list', [], () => []),
      read: (path) => call('research', 'read', [path], () => ({ ok: false as const, message: 'Research is not available.' })),
      save: (path, content, base) => call('research', 'save', [path, content, base], () => ({ ok: false as const, message: 'Research is not available.' })),
      createNotebook: (name) => call('research', 'createNotebook', [name], () => ({ ok: false as const, message: 'Research is not available.' })),
      createPage: (notebook, title) => call('research', 'createPage', [notebook, title], () => ({ ok: false as const, message: 'Research is not available.' })),
      remove: (path) => call('research', 'remove', [path], () => ({ ok: false as const, message: 'Research is not available.' })),
      search: (query) => call('research', 'search', [query], () => []),
      onChanged: (listener) => on<NotesChange>('mobius:research-changed', listener),
    },
    terminal: {
      places: () => call('terminal', 'places', [], () => []),
      resolve: (cwd, target) => call('terminal', 'resolve', [cwd, target], () => ({ ok: false as const, message: 'Terminal is not available.' })),
      run: (cwd, command) => call('terminal', 'run', [cwd, command], () => ({ ok: false as const, message: 'Terminal is not available.' })),
      start: (cwd, command) => call('terminal', 'start', [cwd, command], () => ({ ok: false as const, message: 'Terminal is not available.' })),
      processes: () => call('terminal', 'processes', [], () => []),
      stop: (id) => call('terminal', 'stop', [id], () => null),
    },
    databases: {
      list: () => call('databases', 'list', [], () => []),
      create: (name) => call('databases', 'create', [name], () => ({ ok: false as const, message: 'Database is not available.' })),
      remove: (name) => call('databases', 'remove', [name], () => ({ ok: false as const, message: 'Database is not available.' })),
      importCsv: (name, table, csv) => call('databases', 'importCsv', [name, table, csv], () => ({ ok: false as const, message: 'Database is not available.' })),
      query: (name, sql) => call('databases', 'query', [name, sql], () => ({ ok: false as const, message: 'Database is not available.' })),
      onChanged: (listener) => on<DbChange>('mobius:databases-changed', listener),
    },
    wiki: {
      list: () => call('wiki', 'list', [], () => []),
      read: (path) => call('wiki', 'read', [path], () => ({ ok: false as const, message: 'The wiki is not available.' })),
      save: (path, content, base) => call('wiki', 'save', [path, content, base], () => ({ ok: false as const, message: 'The wiki is not available.' })),
      createNotebook: (name) => call('wiki', 'createNotebook', [name], () => ({ ok: false as const, message: 'The wiki is not available.' })),
      createPage: (notebook, title) => call('wiki', 'createPage', [notebook, title], () => ({ ok: false as const, message: 'The wiki is not available.' })),
      remove: (path) => call('wiki', 'remove', [path], () => ({ ok: false as const, message: 'The wiki is not available.' })),
      search: (query) => call('wiki', 'search', [query], () => []),
      versions: (path) => call('wiki', 'versions', [path], () => []),
      incoming: () => call('wiki', 'incoming', [], () => []),
      offer: (from, text, page) => call('wiki', 'offer', [from, text, page ?? null], () => ({ ok: false as const, message: 'The wiki is not available.' })),
      keepChange: (id, text) => call('wiki', 'keepChange', [id, text ?? null], () => ({ ok: false as const, message: 'The wiki is not available.' })),
      declineChange: (id) => call('wiki', 'declineChange', [id], () => ({ ok: false as const, message: 'The wiki is not available.' })),
      undoChange: (change, keptLine) => call('wiki', 'undoChange', [change, keptLine], () => ({ ok: false as const, message: 'The wiki is not available.' })),
      onChanged: (listener) => on<NotesChange>('mobius:wiki-changed', listener),
    },
    reading: {
      list: () => call('reading', 'list', [], () => []),
      read: (path) => call('reading', 'read', [path], () => ({ ok: false as const, message: 'Reader is not available.' })),
      save: (path, content, base) => call('reading', 'save', [path, content, base], () => ({ ok: false as const, message: 'Reader is not available.' })),
      createNotebook: (name) => call('reading', 'createNotebook', [name], () => ({ ok: false as const, message: 'Reader is not available.' })),
      createPage: (notebook, title) => call('reading', 'createPage', [notebook, title], () => ({ ok: false as const, message: 'Reader is not available.' })),
      remove: (path) => call('reading', 'remove', [path], () => ({ ok: false as const, message: 'Reader is not available.' })),
      search: (query) => call('reading', 'search', [query], () => []),
      fetch: (url) => call('reading', 'fetch', [url], () => ({ ok: false as const, message: 'Reader is not available.' })),
      onChanged: (listener) => on<NotesChange>('mobius:reading-changed', listener),
    },
    songs: {
      list: () => call('songs', 'list', [], () => []),
      read: (path) => call('songs', 'read', [path], () => ({ ok: false as const, message: 'Studio is not available.' })),
      save: (path, content, base) => call('songs', 'save', [path, content, base], () => ({ ok: false as const, message: 'Studio is not available.' })),
      createNotebook: (name) => call('songs', 'createNotebook', [name], () => ({ ok: false as const, message: 'Studio is not available.' })),
      createPage: (notebook, title) => call('songs', 'createPage', [notebook, title], () => ({ ok: false as const, message: 'Studio is not available.' })),
      remove: (path) => call('songs', 'remove', [path], () => ({ ok: false as const, message: 'Studio is not available.' })),
      search: (query) => call('songs', 'search', [query], () => []),
      onChanged: (listener) => on<NotesChange>('mobius:songs-changed', listener),
    },
    bookmarks: {
      get: (query) => call('bookmarks', 'get', [query], () => []),
      toggle: () => call('bookmarks', 'toggle', [], () => false),
      remove: (url) => fire('bookmarks', 'remove', [url]),
      onChanged: (listener) => on<null>('mobius:bookmarks-changed', () => listener()),
    },
    history: {
      get: (query) => call('history', 'get', [query], () => ({ enabled: false, entries: [] })),
      remove: (url) => fire('history', 'remove', [url]),
      clear: () => fire('history', 'clear', []),
      setEnabled: (enabled) => fire('history', 'setEnabled', [enabled]),
      onChanged: (listener) => on<null>('mobius:history-changed', () => listener()),
    },
    downloads: {
      get: () => call('downloads', 'get', [], () => []),
      cancel: (id) => fire('downloads', 'cancel', [id]),
      open: (id) => fire('downloads', 'open', [id]),
      show: (id) => fire('downloads', 'show', [id]),
      clear: () => fire('downloads', 'clear', []),
      onState: (listener) => on<DownloadEntry[]>('mobius:downloads-state', listener, () => call('downloads', 'get', [], () => [])),
    },
    bots: {
      get: () => call('bots', 'get', [], () => ({ bots: [MAIN] })),
      create: (draft) => call('bots', 'create', [draft], () => refused),
      update: (id, draft) => call('bots', 'update', [{ id, draft }], () => refused),
      move: (id, direction) => call('bots', 'move', [{ id, direction }], () => refused),
      remove: (id) => call('bots', 'remove', [id], () => refused),
      onChange: (listener) => on<BotsState>('mobius:bots-changed', listener, () => call('bots', 'get', [], () => ({ bots: [MAIN] }))),
    },
    context: { page: () => call('context', 'page', [], () => refused), file: () => call('context', 'file', [], () => refused), selection: () => call('context', 'selection', [], () => refused) },
    preferences: {
      get: () => call('preferences', 'get', [], () => DEFAULT_PREFERENCES),
      set: (change) => call('preferences', 'set', [change], () => DEFAULT_PREFERENCES),
      onChange: (listener) => on<PreferencesSettings>('mobius:preferences-changed', listener, () => call('preferences', 'get', [], () => DEFAULT_PREFERENCES)),
    },
    app: {
      onOpenConversation: (listener) => on<string>('mobius:open-conversation', listener),
      about: () => call<AboutInfo>('app', 'about', [], () => ({ app: '0.0.0', engine: 'unknown', platform: 'unknown', arch: 'unknown', core: null, dataFolder: '' })),
      openDataFolder: () => call('app', 'openDataFolder', [], () => undefined),
      removeData: () => call('app', 'removeData', [], () => refused as never),
    },
    browser: {
      open: (input) => call('browser', 'open', [input ?? null], () => null),
      activate: (id) => fire('browser', 'activate', [id]),
      close: (id) => fire('browser', 'close', [id]),
      navigate: (id, input) => call('browser', 'navigate', [id, input], () => 'blocked' as const),
      back: (id) => fire('browser', 'back', [id]),
      forward: (id) => fire('browser', 'forward', [id]),
      reload: (id) => fire('browser', 'reload', [id]),
      find: (request) => fire('browser', 'find', [request]),
      stopFind: (id) => fire('browser', 'stopFind', [id]),
      onFound: (listener) => on<FindResult>('mobius:browser-found', listener),
      snapshot: () => call('browser', 'snapshot', [], () => null),
      reopenClosed: () => call('browser', 'reopenClosed', [], () => null),
      duplicate: (id) => call('browser', 'duplicate', [id], () => null),
      pin: (id, pinned) => fire('browser', 'pin', [id, pinned]),
      moveTab: (id, index) => fire('browser', 'moveTab', [id, index]),
      getState: () => call('browser', 'getState', [], () => EMPTY_BROWSER),
      onState: (listener) => on<BrowserState>('mobius:browser-state', listener, () => call('browser', 'getState', [], () => EMPTY_BROWSER)),
    },
  };
}

/** Installs the bridge when the page runs inside the Tauri shell and nothing else has provided one. */
export function installTauriBridge(): boolean {
  const w = window as unknown as { __TAURI_INTERNALS__?: unknown; mobius?: MobiusBridge };
  if (w.mobius || !w.__TAURI_INTERNALS__) return false;
  w.mobius = createTauriBridge();
  return true;
}
