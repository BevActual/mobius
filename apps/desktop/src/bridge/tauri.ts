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
  type TasksChanged,
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
    mini: {
      open: () => call('mini', 'open', [], () => null).then(() => undefined),
      close: () => call('mini', 'close', [], () => null).then(() => undefined),
      isOpen: () => call('mini', 'isOpen', [], () => false),
      showMain: () => call('mini', 'showMain', [], () => null).then(() => undefined),
      setOnTop: (onTop) => call('mini', 'setOnTop', [onTop], () => null).then(() => undefined),
      onChange: (listener) => on<boolean>('mobius:mini', listener, () => call('mini', 'isOpen', [], () => false)),
    },
    core: {
      getStatus: () => call<CoreStatus>('core', 'getStatus', [], () => 'failed'),
      onStatus: (listener) => on<CoreStatus>('mobius:core-status', listener, () => call<CoreStatus>('core', 'getStatus', [], () => 'failed')),
    },
    agent: {
      send: (conversation, text, context) => call('agent', 'send', [conversation, text, context ?? null], () => refused),
      models: () => call('agent', 'models', [], () => refused),
      setModel: (model) => call('agent', 'setModel', [model], () => refused),
      transcribe: (audio, mime) => call('agent', 'transcribe', [toBase64(audio), mime], () => refused),
      cancel: (conversation) => call('agent', 'cancel', [conversation], () => undefined).then(() => undefined),
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
      add: (list, text, due) => call('tasks', 'add', [list, text, due ?? ''], () => ({ ok: false as const, message: 'Tasks is not available.' })),
      update: (list, line, expect, change) => call('tasks', 'update', [list, line, expect, change], () => ({ ok: false as const, message: 'Tasks is not available.' })),
      remove: (list, line, expect) => call('tasks', 'remove', [list, line, expect], () => ({ ok: false as const, message: 'Tasks is not available.' })),
      clearDone: (list) => call('tasks', 'clearDone', [list], () => ({ ok: false as const, message: 'Tasks is not available.' })),
      onChanged: (listener) => on<TasksChanged>('mobius:tasks-changed', listener),
    },
    notes: {
      list: () => call('notes', 'list', [], () => []),
      read: (path) => call('notes', 'read', [path], () => ({ ok: false as const, message: 'Notes is not available.' })),
      save: (path, content, base) => call('notes', 'save', [path, content, base], () => ({ ok: false as const, message: 'Notes is not available.' })),
      createNotebook: (name) => call('notes', 'createNotebook', [name], () => ({ ok: false as const, message: 'Notes is not available.' })),
      createPage: (notebook, title) => call('notes', 'createPage', [notebook, title], () => ({ ok: false as const, message: 'Notes is not available.' })),
      remove: (path) => call('notes', 'remove', [path], () => ({ ok: false as const, message: 'Notes is not available.' })),
      search: (query) => call('notes', 'search', [query], () => []),
      onChanged: (listener) => on<NotesChange>('mobius:notes-changed', listener),
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
    context: { page: () => call('context', 'page', [], () => refused), file: () => call('context', 'file', [], () => refused) },
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
