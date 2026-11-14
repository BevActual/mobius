import type { AppId } from './apps';

/**
 * Mobius's menus as plain data: File, Edit, View, Go, the open app's own menu, Window and Help. One definition, shown as
 * menus in the window's toolbar (Windows and Linux) and meant for the menu bar on macOS.
 */
export type MenuItem =
  | { kind: 'item'; id: string; label: string; keys?: string; disabled?: boolean; checked?: boolean; run: () => void }
  | { kind: 'separator' };
export interface Menu { id: string; label: string; items: MenuItem[] }

const item = (id: string, label: string, run: () => void, extra: { keys?: string; disabled?: boolean; checked?: boolean } = {}): MenuItem => ({ kind: 'item', id, label, run, ...extra });
const separator: MenuItem = { kind: 'separator' };

/** What the menus can do, and what is true now. Everything here already exists in the app; the menus only gather it. */
export interface MenuContext {
  app: AppId;
  apps: readonly { id: AppId; name: string }[];
  keys: { newTab?: string; closeTab?: string; settings?: string; find?: string; launcher?: string; splitView?: string; littleMobius?: string; address?: string };
  state: {
    sidebarShown: boolean;
    hasSidebar: boolean;
    agentShown: boolean;
    hasAgentPanel: boolean;
    commenting: boolean;
    split: boolean;
    canSplit: boolean;
    miniOpen: boolean;
    zoom: number;
    browser: { hasPage: boolean; canBack: boolean; canForward: boolean; bookmarked: boolean; pinned: boolean };
    notes: { hasPage: boolean; pinned: boolean; changed: boolean };
    tasks: { inList: boolean; done: number };
    calendar: { mode: 'day' | 'week' | 'month' | 'year' };
    agent: { busy: boolean };
  };
  do: {
    create: Record<'conversation' | 'tab' | 'note' | 'task', () => void>;
    closeTab: () => void;
    settings: () => void;
    shortcuts: () => void;
    learn: () => void;
    profiles: () => void;
    about: () => void;
    edit: (command: 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll') => void;
    find: () => void;
    toggleSidebar: () => void;
    toggleAgent: () => void;
    toggleComments: () => void;
    toggleSplit: () => void;
    toggleMini: () => void;
    zoom: (zoom: number) => void;
    open: (app: AppId) => void;
    allApps: () => void;
    launcher: () => void;
    browser: { back: () => void; forward: () => void; reload: () => void; address: () => void; bookmark: () => void; pin: () => void; reopen: () => void; selection: () => void; saveToReader: () => void };
    notes: { newNotebook: () => void; pin: () => void; changes: () => void; history: () => void; clip: () => void; markdown: () => void };
    tasks: { newList: () => void; clearDone: () => void; today: () => void; scheduled: () => void };
    docs: { newDocument: () => void; newFolder: () => void };
    video: { newProject: () => void; showFolder: () => void };
    studio: { newSong: () => void; play: () => void };
    photo: { newAlbum: () => void; export: () => void };
    design: { newDesign: () => void; newFolder: () => void };
    canvas: { newBoard: () => void; newFolder: () => void; newSticky: () => void };
    research: { newResearch: () => void; newFolder: () => void };
    reader: { newList: () => void };
    database: { newDatabase: () => void; importCsv: () => void };
    terminal: { clear: () => void };
    code: { newProject: () => void; newFile: () => void; save: () => void; runTests: () => void };
    sheets: { newWorkbook: () => void; newSheet: () => void; insertRow: () => void };
    mail: { newMessage: () => void; getMail: () => void };
    slides: { newDeck: () => void };
    calendar: { newEvent: () => void; quickEvent: () => void; newCalendar: () => void; today: () => void; mode: (mode: 'day' | 'week' | 'month' | 'year') => void };
    agent: { stop: () => void };
  };
}

/** Stop is always Command-period (Control-period elsewhere), as in the design; it is not rebound. */
export const STOP_KEYS = 'mod+.';

/** The zoom steps View offers, within what appearance allows. */
export const ZOOM_STEPS = [0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5] as const;
/** The next step up (or down) from `zoom`, even when it sits between steps; at either end it stays. */
export const nextZoom = (zoom: number, step: 1 | -1): number =>
  step === 1 ? ZOOM_STEPS.find((z) => z > zoom + 1e-9) ?? ZOOM_STEPS.at(-1)! : [...ZOOM_STEPS].reverse().find((z) => z < zoom - 1e-9) ?? ZOOM_STEPS[0];

export function buildMenus(c: MenuContext): Menu[] {
  const { state: s, do: d, keys } = c;
  const file: Menu = { id: 'file', label: 'File', items: [
    item('new-conversation', 'New conversation', d.create.conversation),
    item('new-tab', 'New tab', d.create.tab, { keys: keys.newTab }),
    item('new-note', 'New note', d.create.note),
    item('new-task', 'New task', d.create.task),
    separator,
    item('close-tab', 'Close tab', d.closeTab, { keys: keys.closeTab, disabled: c.app !== 'browser' || !s.browser.hasPage }),
    separator,
    item('profiles', 'Profiles…', d.profiles),
    item('settings', 'Settings…', d.settings, { keys: keys.settings }),
  ] };
  const edit: Menu = { id: 'edit', label: 'Edit', items: [
    item('undo', 'Undo', () => d.edit('undo'), { keys: 'mod+z' }),
    item('redo', 'Redo', () => d.edit('redo'), { keys: 'mod+shift+z' }),
    separator,
    item('cut', 'Cut', () => d.edit('cut'), { keys: 'mod+x' }),
    item('copy', 'Copy', () => d.edit('copy'), { keys: 'mod+c' }),
    item('paste', 'Paste', () => d.edit('paste'), { keys: 'mod+v' }),
    item('select-all', 'Select all', () => d.edit('selectAll'), { keys: 'mod+a' }),
    separator,
    item('find', 'Find on page…', d.find, { keys: keys.find, disabled: c.app !== 'browser' || !s.browser.hasPage }),
  ] };
  const view: Menu = { id: 'view', label: 'View', items: [
    item('sidebar', 'Sidebar', d.toggleSidebar, { checked: s.sidebarShown, disabled: !s.hasSidebar }),
    item('agent-panel', 'Agent panel', d.toggleAgent, { checked: s.agentShown, disabled: !s.hasAgentPanel }),
    item('comments', 'Comments', d.toggleComments, { keys: 'c', checked: s.commenting }),
    separator,
    item('zoom-in', 'Zoom in', () => d.zoom(nextZoom(s.zoom, 1)), { disabled: s.zoom >= ZOOM_STEPS.at(-1)! }),
    item('zoom-out', 'Zoom out', () => d.zoom(nextZoom(s.zoom, -1)), { disabled: s.zoom <= ZOOM_STEPS[0] }),
    item('zoom-reset', 'Actual size', () => d.zoom(1), { disabled: s.zoom === 1 }),
  ] };
  const go: Menu = { id: 'go', label: 'Go', items: [
    ...c.apps.map((a) => item(`go-${a.id}`, a.name, () => d.open(a.id), { checked: a.id === c.app })),
    separator,
    item('all-apps', 'All apps…', d.allApps),
    item('launcher', 'Find apps, pages and commands…', d.launcher, { keys: keys.launcher }),
  ] };
  const window: Menu = { id: 'window', label: 'Window', items: [
    item('split', 'Split view', d.toggleSplit, { keys: keys.splitView, checked: s.split, disabled: !s.canSplit && !s.split }),
    item('mini', 'Little Mobius', d.toggleMini, { keys: keys.littleMobius, checked: s.miniOpen }),
  ] };
  const help: Menu = { id: 'help', label: 'Help', items: [
    item('learn', 'Learn Mobius', d.learn),
    item('shortcuts', 'Keyboard shortcuts', d.shortcuts),
    item('about', 'About Mobius', d.about),
  ] };
  const own = appMenu(c);
  return [file, edit, view, go, ...(own ? [own] : []), window, help];
}

/** The open app's own menu: what that app does, all in one place. */
function appMenu(c: MenuContext): Menu | null {
  const { state: s, do: d, keys } = c;
  switch (c.app) {
    case 'browser':
      return { id: 'app', label: 'Browser', items: [
        item('back', 'Back', d.browser.back, { keys: 'alt+left', disabled: !s.browser.canBack }),
        item('forward', 'Forward', d.browser.forward, { keys: 'alt+right', disabled: !s.browser.canForward }),
        item('reload', 'Reload', d.browser.reload, { keys: 'mod+r', disabled: !s.browser.hasPage }),
        item('address', 'Go to the address bar', d.browser.address, { keys: keys.address }),
        separator,
        item('bookmark', s.browser.bookmarked ? 'Remove bookmark' : 'Bookmark this page', d.browser.bookmark, { disabled: !s.browser.hasPage }),
        item('pin-page', s.browser.pinned ? 'Unpin from the sidebar' : 'Pin to the sidebar', d.browser.pin, { disabled: !s.browser.hasPage }),
        item('reopen', 'Reopen closed tab', d.browser.reopen, { keys: 'mod+shift+t' }),
        separator,
        item('selection', 'Selected text…', d.browser.selection, { disabled: !s.browser.hasPage }),
        item('save-to-reader', 'Save page to Reader', d.browser.saveToReader, { disabled: !s.browser.hasPage }),
      ] };
    case 'notes':
      return { id: 'app', label: 'Notes', items: [
        item('new-page', 'New page', c.do.create.note, { keys: 'mod+n' }),
        item('new-notebook', 'New notebook', d.notes.newNotebook),
        separator,
        item('changes', 'Show what the agent changed', d.notes.changes, { disabled: !s.notes.changed }),
        item('pin-note', s.notes.pinned ? 'Unpin from the sidebar' : 'Pin to the sidebar', d.notes.pin, { disabled: !s.notes.hasPage }),
        separator,
        item('history', 'Version history…', d.notes.history, { disabled: !s.notes.hasPage }),
        item('clip-page', 'Clip a web page…', d.notes.clip, { disabled: !s.notes.hasPage }),
        item('show-markdown', 'Show Markdown', d.notes.markdown, { disabled: !s.notes.hasPage }),
      ] };
    case 'tasks':
      return { id: 'app', label: 'Tasks', items: [
        item('new-task-here', 'New task', c.do.create.task),
        item('new-list', 'New list', d.tasks.newList),
        separator,
        item('today', 'Today', d.tasks.today),
        item('scheduled', 'Scheduled', d.tasks.scheduled),
        separator,
        item('clear-done', s.tasks.done > 0 ? `Clear ${s.tasks.done} completed` : 'Clear completed', d.tasks.clearDone, { disabled: !s.tasks.inList || s.tasks.done === 0 }),
      ] };
    case 'slides':
      return { id: 'app', label: 'Slides', items: [
        item('new-deck', 'New deck', d.slides.newDeck),
      ] };
    case 'mail':
      return { id: 'app', label: 'Mail', items: [
        item('new-message', 'New message', d.mail.newMessage),
        item('get-mail', 'Get mail', d.mail.getMail),
      ] };
    case 'video':
      return { id: 'app', label: 'Video', items: [
        item('new-video-project', 'New project', d.video.newProject),
        item('show-footage', 'Show folder', d.video.showFolder),
      ] };
    case 'studio':
      return { id: 'app', label: 'Music', items: [
        item('new-song', 'New song', d.studio.newSong),
        item('play-song', 'Play or stop', d.studio.play),
      ] };
    case 'photo':
      return { id: 'app', label: 'Photo', items: [
        item('new-album', 'New album', d.photo.newAlbum),
        item('export-photo', 'Export…', d.photo.export),
      ] };
    case 'design':
      return { id: 'app', label: 'Design', items: [
        item('new-design', 'New design', d.design.newDesign),
        item('new-folder', 'New folder', d.design.newFolder),
      ] };
    case 'terminal':
      return { id: 'app', label: 'Terminal', items: [
        item('clear-terminal', 'Clear', d.terminal.clear),
      ] };
    case 'database':
      return { id: 'app', label: 'Database', items: [
        item('new-database', 'New database', d.database.newDatabase),
        item('import-csv', 'Import a CSV file…', d.database.importCsv),
      ] };
    case 'reader':
      return { id: 'app', label: 'Reader', items: [
        item('new-list', 'New list', d.reader.newList),
      ] };
    case 'research':
      return { id: 'app', label: 'Research', items: [
        item('new-research', 'New research', d.research.newResearch),
        item('new-folder', 'New folder', d.research.newFolder),
      ] };
    case 'canvas':
      return { id: 'app', label: 'Canvas', items: [
        item('new-board', 'New board', d.canvas.newBoard),
        item('new-folder', 'New folder', d.canvas.newFolder),
        separator,
        item('new-sticky', 'New sticky note', d.canvas.newSticky),
      ] };
    case 'code':
      return { id: 'app', label: 'Code', items: [
        item('new-project', 'New project', d.code.newProject),
        item('new-file', 'New file', d.code.newFile),
        separator,
        item('save-file', 'Save', d.code.save),
        item('run-tests', 'Run tests', d.code.runTests),
      ] };
    case 'sheets':
      return { id: 'app', label: 'Sheets', items: [
        item('new-workbook', 'New workbook', d.sheets.newWorkbook),
        item('new-sheet', 'New sheet', d.sheets.newSheet),
      ] };
    case 'docs':
      return { id: 'app', label: 'Docs', items: [
        item('new-document', 'New document', d.docs.newDocument),
        item('new-folder', 'New folder', d.docs.newFolder),
      ] };
    case 'calendar':
      return { id: 'app', label: 'Calendar', items: [
        item('new-event', 'New event', d.calendar.newEvent, { keys: 'mod+n' }),
        item('quick-event', 'Quick event…', d.calendar.quickEvent, { keys: 'q' }),
        item('new-calendar', 'New calendar', d.calendar.newCalendar),
        separator,
        item('show-today', 'Go to today', d.calendar.today, { keys: 't' }),
        separator,
        item('day', 'Day', () => d.calendar.mode('day'), { keys: 'd', checked: s.calendar.mode === 'day' }),
        item('week', 'Week', () => d.calendar.mode('week'), { keys: 'w', checked: s.calendar.mode === 'week' }),
        item('month', 'Month', () => d.calendar.mode('month'), { keys: 'm', checked: s.calendar.mode === 'month' }),
        item('year', 'Year', () => d.calendar.mode('year'), { keys: 'y', checked: s.calendar.mode === 'year' }),
      ] };
    case 'agent':
      return { id: 'app', label: 'Conversation', items: [
        item('new-conversation-here', 'New conversation', c.do.create.conversation),
        item('stop', 'Stop', d.agent.stop, { keys: STOP_KEYS, disabled: !s.agent.busy }),
      ] };
    default:
      return null;
  }
}

/** The menus as plain data for the macOS menu bar: everything but what each item runs. */
export function menusAsData(menus: Menu[]) {
  return menus.map((m) => ({
    id: m.id,
    label: m.label,
    items: m.items.map((i) => (i.kind === 'separator' ? { kind: 'separator' as const } : { kind: 'item' as const, id: i.id, label: i.label, ...(i.keys ? { keys: i.keys } : {}), ...(i.disabled ? { disabled: true } : {}), ...(i.checked !== undefined ? { checked: i.checked } : {}) })),
  }));
}

/** The item with this id, for a choice made in the menu bar. */
export function findItem(menus: Menu[], id: string) {
  for (const m of menus) for (const i of m.items) if (i.kind === 'item' && i.id === id) return i;
  return undefined;
}
