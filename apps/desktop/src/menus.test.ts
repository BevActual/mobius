import { describe, expect, it, vi } from 'vitest';
import { buildMenus, findItem, menusAsData, nextZoom, type MenuContext } from './menus';

const noop = () => {};
function context(app: MenuContext['app'], over: Partial<MenuContext['state']> = {}): MenuContext {
  return {
    app,
    apps: [{ id: 'agent', name: 'Agent' }, { id: 'browser', name: 'Browser' }, { id: 'notes', name: 'Notes' }, { id: 'tasks', name: 'Tasks' }],
    keys: { newTab: 'mod+t', splitView: 'mod+\\', settings: 'mod+,' },
    state: {
      sidebarShown: true, hasSidebar: true, agentShown: true, hasAgentPanel: true, split: false, canSplit: true, miniOpen: false, zoom: 1,
      browser: { hasPage: true, canBack: false, canForward: false, bookmarked: false, pinned: false },
      notes: { hasPage: false, pinned: false, changed: false },
      tasks: { inList: false, done: 0 },
      calendar: { mode: 'week' },
      agent: { busy: false },
      ...over,
    },
    do: {
      create: { conversation: noop, tab: noop, note: noop, task: noop },
      closeTab: noop, settings: noop, shortcuts: noop, profiles: noop, about: noop, edit: noop, find: noop, toggleSidebar: noop, toggleAgent: noop,
      toggleSplit: noop, toggleMini: noop, zoom: noop, open: noop, allApps: noop, launcher: noop,
      browser: { back: noop, forward: noop, reload: noop, address: noop, bookmark: noop, pin: noop, reopen: noop, selection: noop },
      notes: { newNotebook: noop, pin: noop, changes: noop },
      tasks: { newList: noop, clearDone: noop, today: noop, scheduled: noop },
      docs: { newDocument: noop, newFolder: noop },
      sheets: { newWorkbook: noop, newSheet: noop, insertRow: noop },
      calendar: { newEvent: noop, newCalendar: noop, today: noop, mode: noop },
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
  });

  it('shows what is on and what cannot be done now, and the keys for each', () => {
    const menus = buildMenus(context('browser', { split: true }));
    expect(find(menus, 'split')).toMatchObject({ checked: true, keys: 'mod+\\' });
    expect(find(menus, 'back')?.disabled).toBe(true);
    expect(find(menus, 'go-browser')?.checked).toBe(true);
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
