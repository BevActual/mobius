import { starterView, writeView, type View } from '../views-format';

/** The preview's Views app: views kept in memory while the preview is open, so the dashboards can be tried without the core. */
const now = Date.now();
const TODAY: View = {
  version: 1,
  tiles: [
    { id: 't1', kind: 'mobius', size: 'wide' },
    { id: 't2', kind: 'tasks', size: 'small', show: 'today' },
    { id: 't3', kind: 'calendar', size: 'small', show: 'week' },
    { id: 't4', kind: 'mail', size: 'small' },
    { id: 't5', kind: 'notes', size: 'small' },
    { id: 't6', kind: 'next', size: 'small' },
  ],
};
const TEXT: Record<string, string> = { 'Views/Today.json': writeView(TODAY), 'Views/Kestrel build.json': writeView({ version: 1, tiles: [{ id: 't1', kind: 'tasks', size: 'wide', show: 'all' }, { id: 't2', kind: 'notes', size: 'small', notebook: 'P2 build' }] }) };
const MODIFIED: Record<string, number> = { 'Views/Today.json': now - 600_000, 'Views/Kestrel build.json': now - 86_400_000 };
const title = (path: string) => path.slice(path.indexOf('/') + 1, -5);

export const PREVIEW_VIEWS: Record<string, (...args: never[]) => unknown> = {
  'views.list': () => [{ name: 'Views', pages: Object.keys(TEXT).map((path) => ({ path, title: title(path), modified: MODIFIED[path] ?? now })) }],
  'views.read': ((path: string) => (path in TEXT ? { path, content: TEXT[path], modified: MODIFIED[path] ?? now } : { ok: false, message: 'that view is not there' })) as never,
  'views.save': ((path: string, content: string) => { TEXT[path] = content; MODIFIED[path] = Date.now(); return { path, modified: MODIFIED[path] }; }) as never,
  'views.createPage': ((folder: string, name?: string) => {
    const path = `${folder}/${(name ?? '').trim() || 'Untitled'}.json`;
    TEXT[path] = writeView(starterView());
    MODIFIED[path] = Date.now();
    return { path, content: TEXT[path], modified: MODIFIED[path] };
  }) as never,
  'views.remove': ((path: string) => { delete TEXT[path]; return { path }; }) as never,
};
