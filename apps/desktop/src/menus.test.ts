import { describe, expect, it, vi } from 'vitest';
import { buildMenus, findItem, menusAsData, nextZoom, type MenuContext } from './menus';

const noop = () => {};
function context(app: MenuContext['app'], over: Partial<MenuContext['state']> = {}): MenuContext {
  return {
    app,
    apps: [{ id: 'agent', name: 'Agent' }, { id: 'browser', name: 'Browser' }, { id: 'notes', name: 'Notes' }, { id: 'tasks', name: 'Tasks' }],
    keys: { newTab: 'mod+t', splitView: 'mod+\\', settings: 'mod+,' },
    state: {
      commenting: false, split: false, canSplit: true, miniOpen: false, zoom: 1,
      browser: { hasPage: true, canBack: false, canForward: false, bookmarked: false, pinned: false },
      notes: { hasPage: false, pinned: false, changed: false, checkedLast: false },
      docs: { hasPage: false, isTemplate: false, templates: [] },
      tasks: { inList: false, done: 0 },
      calendar: { mode: 'week' },
      agent: { busy: false },
      ...over,
    },
    do: {
      create: { conversation: noop, tab: noop, note: noop, task: noop },
      closeTab: noop, settings: noop, shortcuts: noop, learn: noop, profiles: noop, about: noop, edit: noop, find: noop, toggleComments: noop,
      toggleSplit: noop, toggleMini: noop, zoom: noop, open: noop, allApps: noop, launcher: noop,
      browser: { back: noop, forward: noop, reload: noop, address: noop, bookmark: noop, pin: noop, reopen: noop, nextSpace: noop, previousSpace: noop, selection: noop, saveToReader: noop },
      notes: { newNotebook: noop, today: noop, pin: noop, changes: noop, history: noop, clip: noop, markdown: noop, checkedLast: noop },
      tasks: { newList: noop, clearDone: noop, today: noop, scheduled: noop },
      docs: { newDocument: noop, newFolder: noop, fromTemplate: noop, saveAsTemplate: noop },
      video: { newProject: noop, showFolder: noop },
      studio: { newSong: noop, play: noop },
      photo: { newAlbum: noop, export: noop },
      design: { newDesign: noop, newFolder: noop },
      canvas: { newBoard: noop, newFolder: noop, newSticky: noop },
      research: { newResearch: noop, newFolder: noop },
      reader: { newList: noop },
      database: { newDatabase: noop, importCsv: noop },
      terminal: { clear: noop },
      code: { newProject: noop, newFile: noop, save: noop, runTests: noop },
      sheets: { newWorkbook: noop, newSheet: noop, insertRow: noop },
      mail: { newMessage: noop, getMail: noop },
      slides: { newDeck: noop },
      calendar: { newEvent: noop, quickEvent: noop, newCalendar: noop, today: noop, mode: noop },
      agent: { stop: noop },
    },
  };
}
const find = (menus: ReturnType<typeof buildMenus>, id: string) => menus.flatMap((m) => m.items).find((i) => i.kind === 'item' && i.id === id) as Extract<ReturnType<typeof buildMenus>[number]['items'][number], { kind: 'item' }> | undefined;

describe('menus', () => {
  it('has File, Edit, View, Go, Window and Help everywhere, and the open app its own menu before Window', () => {
    expect(buildMenus(context('browser')).map((m) => m.label)).toEqual(['File', 'Edit', 'View', 'Go', 'Browser', 'Window', 'Help']);
    expect(buildMenus(context('tasks')).map((m) => m.label)).toEqual(['File', 'Edit', 'View', 'Go', 'Tasks', 'Window', 'Help']);
    expect(buildMenus(context('calendar')).map((m) => m.label)).toEqual(['File', 'Edit', 'View', 'Go', 'Calendar', 'Window', 'Help']);
    expect(find(buildMenus(context('calendar')), 'week')).toMatchObject({ checked: true });
    expect(buildMenus(context('search')).map((m) => m.label)).toEqual(['File', 'Edit', 'View', 'Go', 'Window', 'Help']);
    // Settings and Store are places, not apps: after the apps in Go, on their own, and Store never among the apps.
    const go = buildMenus({ ...context('notes'), apps: [{ id: 'notes', name: 'Notes' }, { id: 'skills', name: 'Store' }] }).find((m) => m.id === 'go')!;
    expect(go.items.map((i) => ('label' in i ? i.label : '—'))).toEqual(['Notes', '—', 'Settings…', 'Store…', '—', 'All apps…', 'Find apps, pages and commands…']);
    // Settings is a place over the app: the app's own menu goes.
    expect(buildMenus({ ...context('browser'), place: true }).map((m) => m.label)).toEqual(['File', 'Edit', 'View', 'Go', 'Window', 'Help']);
  });

  it('shows what is on and what cannot be done now, and the keys for each', () => {
    const menus = buildMenus(context('browser', { split: true }));
    expect(find(menus, 'split')).toMatchObject({ checked: true, keys: 'mod+\\' });
    expect(find(menus, 'back')?.disabled).toBe(true);
    expect(find(menus, 'go-browser')?.checked).toBe(true);
    // Comments sits in View, with C, and shows whether comment mode is on.
    expect(find(menus, 'comments')).toMatchObject({ checked: false, keys: 'c' });
    expect(find(buildMenus(context('notes', { commenting: true })), 'comments')?.checked).toBe(true);
    expect(find(buildMenus(context('notes')), 'close-tab')?.disabled).toBe(true);
    expect(find(buildMenus(context('tasks', { tasks: { inList: true, done: 3 } })), 'clear-done')).toMatchObject({ label: 'Clear 3 completed', disabled: false });
  });

  it('runs what each item names', () => {
    const c = context('agent', { agent: { busy: true } });
    c.do.agent.stop = vi.fn();
    const stop = find(buildMenus(c), 'stop')!;
    expect(stop).toMatchObject({ disabled: false, keys: 'mod+.' });
    expect(buildMenus(c).map((m) => m.label)).toContain('Conversation');
    stop.run();
    expect(c.do.agent.stop).toHaveBeenCalledOnce();
  });

  it('zooms in steps and stops at the ends', () => {
    expect(nextZoom(1, 1)).toBe(1.1);
    expect(nextZoom(1, -1)).toBe(0.9);
    expect(nextZoom(1.5, 1)).toBe(1.5);
    expect(nextZoom(0.75, -1)).toBe(0.75);
    expect(nextZoom(1.05, 1)).toBe(1.1);
    expect(nextZoom(1.05, -1)).toBe(1);
  });

  it('goes to the macOS menu bar as data, and a choice there runs the same item', () => {
    const c = context('browser', { split: true });
    c.do.toggleSplit = vi.fn();
    const menus = buildMenus(c);
    const data = menusAsData(menus);
    expect(JSON.parse(JSON.stringify(data))).toEqual(data);
    expect(data.find((m) => m.id === 'window')!.items[0]).toEqual({ kind: 'item', id: 'split', label: 'Split view', keys: 'mod+\\', checked: true });
    findItem(menus, 'split')!.run();
    expect(c.do.toggleSplit).toHaveBeenCalledOnce();
    expect(findItem(menus, 'nope')).toBeUndefined();
  });
});

describe('Docs templates in the Docs menu', () => {
  const docsMenu = (over: Partial<MenuContext['state']>) => buildMenus(context('docs', over)).find((m) => m.id === 'app')!;
  const labels = (over: Partial<MenuContext['state']>) => docsMenu(over).items.flatMap((i) => (i.kind === 'item' ? [i.label] : []));
  it('lists each template as New from …, and Save as template only with a document open that is not one', () => {
    const templates = [{ path: 'Templates/Meeting notes.md', title: 'Meeting notes' }];
    expect(labels({ docs: { hasPage: true, isTemplate: false, templates } })).toEqual(['New document', 'New folder', 'New from Meeting notes', 'Save as template']);
    const save = (state: MenuContext['state']['docs']) => docsMenu({ docs: state }).items.find((i) => i.kind === 'item' && i.id === 'save-template');
    expect(save({ hasPage: false, isTemplate: false, templates: [] })).toMatchObject({ disabled: true });
    expect(save({ hasPage: true, isTemplate: true, templates })).toMatchObject({ disabled: true });
    expect(save({ hasPage: true, isTemplate: false, templates })).toMatchObject({ disabled: false });
  });
});
