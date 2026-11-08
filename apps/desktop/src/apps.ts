export type AppId = 'browser' | 'agent' | 'search' | 'code' | 'documents' | 'notes' | 'canvas' | 'tasks' | 'calendar' | 'review';

/** What an app is for. The hub groups apps this way, so however many there are, they read as a few clear groups. */
export type AppGroup = 'Assistant' | 'Browse and find' | 'Write and plan' | 'Create' | 'Review';
export const APP_GROUPS: readonly AppGroup[] = ['Assistant', 'Browse and find', 'Write and plan', 'Create', 'Review'];

export interface AppInfo { id: AppId; name: string; available: boolean; group: AppGroup }

/** Every application Mobius will have. Only the ones marked available can be opened. */
export const APPS: readonly AppInfo[] = [
  { id: 'browser', name: 'Browser', available: true, group: 'Browse and find' },
  { id: 'agent', name: 'Agent', available: true, group: 'Assistant' },
  { id: 'notes', name: 'Notes', available: true, group: 'Write and plan' },
  { id: 'tasks', name: 'Tasks', available: true, group: 'Write and plan' },
  { id: 'calendar', name: 'Calendar', available: true, group: 'Write and plan' },
  { id: 'search', name: 'Search', available: true, group: 'Browse and find' },
  { id: 'code', name: 'Code', available: false, group: 'Create' },
  { id: 'documents', name: 'Documents', available: false, group: 'Write and plan' },
  { id: 'canvas', name: 'Canvas', available: false, group: 'Create' },
  { id: 'review', name: 'Review', available: false, group: 'Review' },
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
