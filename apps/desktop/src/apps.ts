export type AppId = 'browser' | 'agent' | 'search' | 'code' | 'design' | 'photo' | 'studio' | 'video' | 'skills' | 'docs' | 'sheets' | 'slides' | 'mail' | 'notes' | 'canvas' | 'research' | 'reader' | 'database' | 'terminal' | 'tasks' | 'calendar' | 'review' | 'files' | 'wiki' | 'projects';

/** What an app is for. The hub groups apps this way, so however many there are, they read as a few clear groups. */
export type AppGroup = 'Assistant' | 'Browse and find' | 'Write and plan' | 'Create' | 'Review';
export const APP_GROUPS: readonly AppGroup[] = ['Assistant', 'Browse and find', 'Write and plan', 'Create', 'Review'];

export interface AppInfo { id: AppId; name: string; available: boolean; group: AppGroup; /** One of Mobius's own apps: opened from Mobius's apps in the switcher, not the app list. */ own?: boolean; /** Other words it is found by. */ also?: string }

/** Every application Mobius will have. Only the ones marked available can be opened. */
export const APPS: readonly AppInfo[] = [
  { id: 'browser', name: 'Browser', available: true, group: 'Browse and find' },
  { id: 'agent', name: 'Agent', available: true, group: 'Assistant' },
  { id: 'mail', name: 'Mail', available: true, group: 'Browse and find' },
  { id: 'skills', name: 'Extensions', available: true, group: 'Assistant', own: true, also: 'Skills Connectors Plugins Catalogue Updates MCP' },
  { id: 'notes', name: 'Notes', available: true, group: 'Write and plan' },
  { id: 'docs', name: 'Docs', available: true, group: 'Write and plan' },
  { id: 'projects', name: 'Projects', available: true, group: 'Write and plan', also: 'Project place rules threads' },
  { id: 'wiki', name: 'Knowledge', available: true, group: 'Write and plan', also: 'Wiki How I work Memory Journey What Mobius knows' },
  { id: 'sheets', name: 'Sheets', available: true, group: 'Write and plan' },
  { id: 'slides', name: 'Slides', available: true, group: 'Create' },
  { id: 'tasks', name: 'Tasks', available: true, group: 'Write and plan' },
  { id: 'database', name: 'Database', available: true, group: 'Write and plan' },
  { id: 'calendar', name: 'Calendar', available: true, group: 'Write and plan' },
  { id: 'search', name: 'Search', available: true, group: 'Browse and find' },
  { id: 'research', name: 'Research', available: true, group: 'Browse and find' },
  { id: 'reader', name: 'Reader', available: true, group: 'Browse and find' },
  { id: 'design', name: 'Design', available: true, group: 'Create' },
  { id: 'photo', name: 'Photo', available: true, group: 'Create' },
  { id: 'studio', name: 'Music', available: true, group: 'Create', also: 'Studio songs' },
  { id: 'video', name: 'Video', available: true, group: 'Create' },
  { id: 'code', name: 'Code', available: true, group: 'Create' },
  { id: 'terminal', name: 'Terminal', available: true, group: 'Create' },
  { id: 'canvas', name: 'Canvas', available: true, group: 'Create' },
  { id: 'files', name: 'Files', available: true, group: 'Browse and find', also: 'Drive Made by Mobius Artifacts' },
  { id: 'review', name: 'Review', available: true, group: 'Review' },
];

export const findApp = (id: string): AppInfo | undefined => APPS.find((app) => app.id === id);
export const isAvailable = (id: string): boolean => findApp(id)?.available === true;
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
};
export const askAbout = (id: AppId): string => (ASK_ABOUT[id] ? `Ask about ${ASK_ABOUT[id]}` : 'Ask Mobius');
