export type AppId = 'browser' | 'agent' | 'code' | 'documents' | 'notes' | 'canvas' | 'tasks' | 'review';

export interface AppInfo { id: AppId; name: string; available: boolean }

/** Every application Mobius will have. Only the ones marked available can be opened. */
export const APPS: readonly AppInfo[] = [
  { id: 'browser', name: 'Browser', available: true },
  { id: 'agent', name: 'Agent', available: true },
  { id: 'notes', name: 'Notes', available: true },
  { id: 'code', name: 'Code', available: false },
  { id: 'documents', name: 'Documents', available: false },
  { id: 'canvas', name: 'Canvas', available: false },
  { id: 'tasks', name: 'Tasks', available: false },
  { id: 'review', name: 'Review', available: false },
];

export const findApp = (id: string): AppInfo | undefined => APPS.find((app) => app.id === id);
export const isAvailable = (id: string): boolean => findApp(id)?.available === true;
export const appName = (id: string): string => findApp(id)?.name ?? id;
