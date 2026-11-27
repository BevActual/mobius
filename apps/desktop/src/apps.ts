export type AppId = 'browser' | 'agent' | 'code' | 'design' | 'photo' | 'studio' | 'video' | 'skills' | 'docs' | 'sheets' | 'slides' | 'mail' | 'notes' | 'canvas' | 'research' | 'reader' | 'database' | 'terminal' | 'tasks' | 'calendar' | 'files' | 'wiki' | 'projects' | 'views' | 'messages';

/** What an app is for. The hub groups apps this way, so however many there are, they read as a few clear groups. */
export type AppGroup = 'Assistant' | 'Browse and find' | 'Write and plan' | 'Create' | 'Review';
export const APP_GROUPS: readonly AppGroup[] = ['Assistant', 'Browse and find', 'Write and plan', 'Create', 'Review'];

export interface AppInfo { id: AppId; name: string; available: boolean; group: AppGroup; /** One of Mobius's own apps: opened from Mobius's apps in the switcher, not the app list. */ own?: boolean; /** Other words it is found by. */ also?: string; /** Folded into another app as one of its modes (Reader is the Browser's reader mode): not listed as an app of its own, and there whenever that app is. */ modeOf?: AppId }

/** Every application Mobius will have. Only the ones marked available can be opened. */
export const APPS: readonly AppInfo[] = [
  { id: 'browser', name: 'Browser', available: true, group: 'Browse and find' },
  { id: 'agent', name: 'Agent', available: true, group: 'Assistant' },
  { id: 'mail', name: 'Mail', available: true, group: 'Browse and find' },
  { id: 'messages', name: 'Messages', available: true, group: 'Browse and find', also: 'Chat Slack Matrix Teams Telegram Channels' },
  { id: 'skills', name: 'Store', available: true, group: 'Assistant', own: true, also: 'Abilities Extensions Add apps Skills Connectors Plugins Catalogue Updates MCP Tools' },
  { id: 'notes', name: 'Notes', available: true, group: 'Write and plan' },
  { id: 'docs', name: 'Docs', available: true, group: 'Write and plan' },
  { id: 'projects', name: 'Projects', available: true, group: 'Write and plan', also: 'Project place rules threads' },
  { id: 'wiki', name: 'Knowledge', available: true, group: 'Write and plan', also: 'Wiki How I work Memory Journey What Mobius knows' },
  { id: 'sheets', name: 'Sheets', available: true, group: 'Write and plan' },
  { id: 'slides', name: 'Slides', available: true, group: 'Create' },
  { id: 'tasks', name: 'Tasks', available: true, group: 'Write and plan' },
  { id: 'database', name: 'Database', available: true, group: 'Write and plan' },
  { id: 'calendar', name: 'Calendar', available: true, group: 'Write and plan' },
  { id: 'research', name: 'Research', available: true, group: 'Browse and find' },
  { id: 'reader', name: 'Reader', available: true, group: 'Browse and find', modeOf: 'browser', also: 'Read later Reading list Articles' },
  { id: 'design', name: 'Design', available: true, group: 'Create' },
  { id: 'photo', name: 'Photo', available: true, group: 'Create' },
  { id: 'studio', name: 'Music', available: true, group: 'Create', also: 'Studio songs' },
  { id: 'video', name: 'Video', available: true, group: 'Create' },
  { id: 'code', name: 'Code', available: true, group: 'Create' },
  { id: 'terminal', name: 'Terminal', available: true, group: 'Create', modeOf: 'code', also: 'Shell Command line Console' },
  { id: 'canvas', name: 'Canvas', available: true, group: 'Create' },
  { id: 'files', name: 'Files', available: true, group: 'Browse and find', also: 'Drive Made by Mobius Artifacts' },
  { id: 'views', name: 'Views', available: true, group: 'Browse and find', modeOf: 'database', also: 'Dashboard Dashboards Live view Overview Widgets Tiles' },
];

/**
 * Pro apps start in compact density (Instrument, docs/design/instrument.md: "Pro apps (Music, Video, Code, Database,
 * Sheets) default to compact"). Daily apps follow the Density setting, which is comfortable unless changed.
 */
export const COMPACT_APPS: ReadonlySet<AppId> = new Set<AppId>(['studio', 'video', 'code', 'database', 'sheets']);

export const findApp = (id: string): AppInfo | undefined => APPS.find((app) => app.id === id);

/** Always there: Home (the agent) and Mobius's own apps. Every other app is added from Abilities. */
export const CORE_APPS: readonly AppId[] = ['agent', 'skills', 'projects', 'files', 'views'];
/** The apps a new install starts with, beside the core ones (the same list as the preferences' default). */
export const DEFAULT_APPS: readonly AppId[] = ['notes', 'tasks', 'calendar', 'mail', 'docs', 'browser'];
/** The apps added from Abilities; null is every app (an install from before Abilities). Set from the preferences. */
let installed: ReadonlySet<string> | null = null;
export function setInstalledApps(list: readonly string[] | null | undefined): void {
  installed = Array.isArray(list) ? new Set(list) : null;
}
/** Whether an app is added (or one that is always there). */
export const isInstalled = (id: string): boolean => {
  const mode = findApp(id)?.modeOf;
  if (mode) return isInstalled(mode);
  // Terminal is Code's now, and Views Database's: one added before it was folded in brings its app with it.
  return installed === null || installed.has(id) || (id === 'code' && installed.has('terminal')) || (id === 'database' && installed.has('views')) || (CORE_APPS as readonly string[]).includes(id);
};
/** Listed as an app of its own (not a mode folded into another). */
export const isListed = (app: AppInfo): boolean => !app.modeOf;
/** The apps that can be opened now: built, and added. */
export const isAvailable = (id: string): boolean => findApp(id)?.available === true && isInstalled(id);
/** The added apps after adding or removing one, for the preferences. Removing keeps the app's files. */
export function withApp(id: AppId, add: boolean): AppId[] {
  const now = APPS.filter((a) => a.available && isListed(a) && !(CORE_APPS as readonly string[]).includes(a.id) && isInstalled(a.id)).map((a) => a.id);
  return add ? [...new Set([...now, id])] : now.filter((a) => a !== id);
}
export const appName = (id: string): string => findApp(id)?.name ?? id;

/** The apps opened most recently, newest first: the hub shows them at the top. Kept per device. */
const RECENT_KEY = 'mobius.apps.recent';
export function recentApps(limit = 4): AppId[] {
  try {
    const kept: unknown = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(kept) ? kept.filter((id): id is AppId => typeof id === 'string' && isAvailable(id)).slice(0, limit) : [];
  } catch {
    return [];
  }
}
export function noteOpened(id: AppId): void {
  if (!isAvailable(id)) return;
  try { window.localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...recentApps(8).filter((other) => other !== id)])); } catch { /* Not kept. */ }
}

/** What the ask box in the title row offers to talk about, for the app that is open. */
const ASK_ABOUT: Partial<Record<AppId, string>> = {
  browser: 'this page', notes: 'this note', tasks: 'your tasks', mail: 'your mail', calendar: 'your calendar', docs: 'this document',
  sheets: 'this sheet', slides: 'these slides', reader: 'this article', research: 'this research', code: 'this code', canvas: 'this board',
  database: 'this database', design: 'this design', photo: 'this picture', video: 'this video', studio: 'this song', terminal: 'this terminal',
  files: 'your files', wiki: 'what Mobius knows', projects: 'your projects', views: 'this view',
};
/** `open` says whether the app has one thing open: with none, "this document" would point at nothing. */
export const askAbout = (id: AppId, open = true): string => {
  const about = ASK_ABOUT[id];
  if (!about || (!open && /^th(is|ese) /.test(about))) return 'Ask Mobius';
  return `Ask about ${about}`;
};

/**
 * A thing opened in an app (a note, a thread, a file, a song), for the launcher's Recent. The app says how to open it
 * again from `ref`. Kept per device, newest first.
 */
export interface RecentItem { app: AppId; ref: string; label: string; at: number }
const RECENT_ITEMS_KEY = 'mobius.recent.items';
export function recentItems(limit = 8): RecentItem[] {
  try {
    const kept: unknown = JSON.parse(window.localStorage.getItem(RECENT_ITEMS_KEY) ?? '[]');
    if (!Array.isArray(kept)) return [];
    return kept.filter((r): r is RecentItem => !!r && typeof r === 'object' && typeof (r as RecentItem).ref === 'string' && typeof (r as RecentItem).label === 'string'
      && typeof (r as RecentItem).at === 'number' && isAvailable((r as RecentItem).app)).slice(0, limit);
  } catch {
    return [];
  }
}
/** Note that `ref` was opened in `app` (call it when a note, thread, file or song opens). */
export function noteRecentItem(item: Omit<RecentItem, 'at'>, at = Date.now()): void {
  if (!item.label.trim()) return;
  try {
    const rest = recentItems(40).filter((r) => !(r.app === item.app && r.ref === item.ref));
    window.localStorage.setItem(RECENT_ITEMS_KEY, JSON.stringify([{ ...item, at }, ...rest].slice(0, 40)));
  } catch { /* Not kept. */ }
}
