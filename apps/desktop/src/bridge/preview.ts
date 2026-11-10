import { DEFAULT_APPEARANCE, DEFAULT_PREFERENCES, type MobiusBridge } from '@mobius/shared';

/**
 * A stand-in bridge for looking at the interface alone (`npm run dev` in a plain browser, no Rust core).
 * Every call answers with something harmless: lists are empty unless sample data is given below, listeners never fire,
 * and nothing is saved. It exists so the interface can be compared with the design without building the shell.
 * It is installed only by the dev server; a built app never includes a working copy of it.
 */

const day = (offset: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const now = Date.now();
const hour = 3_600_000;

const TASKS = [
  { line: 1, text: 'Confirm the build week with everyone', done: true, due: day(0) },
  { line: 2, text: 'Hold 8 packs at Veltro', done: false, due: day(1) },
  { line: 3, text: 'Book the sled for Friday', done: false, due: day(2) },
  { line: 4, text: 'Draft the build budget', done: true, due: day(0) },
  { line: 5, text: 'Pay the Veltro deposit', done: false, due: null },
];

const person = (name: string, email: string) => ({ name, email });
const MAIL = [
  { id: 'm1', account: 'a1', box: 'inbox', uid: 1, from: person('Priya Nair', 'priya@northway.example'), to: [person('You', 'you@northway.example')], cc: [], subject: 'P2 build dates', dateMs: now - 2 * hour, seen: false, flagged: false, preview: 'Can you confirm the build week and send the plan to the team?', category: 'primary' },
  { id: 'm2', account: 'a1', box: 'inbox', uid: 2, from: person('Veltro Cells', 'sales@veltro.example'), to: [person('You', 'you@northway.example')], cc: [], subject: 'Quote: 8 × 60 kWh packs', dateMs: now - 26 * hour, seen: true, flagged: true, preview: 'Six weeks from order to your dock. The hold lasts until Friday.', category: 'primary' },
  { id: 'm3', account: 'a1', box: 'inbox', uid: 3, from: person('Sam Okafor', 'sam@northway.example'), to: [person('You', 'you@northway.example')], cc: [], subject: 'Motor call', dateMs: now - 30 * hour, seen: true, flagged: false, preview: 'Axion can do Wednesday. Does 10:00 work?', category: 'primary' },
];
const MAIL_TEXT: Record<string, string> = {
  m1: 'Hi,\n\nCan you confirm the build week and send the plan to the team? I would like to tell Northfield by Thursday.\n\nPriya',
  m2: 'Hello,\n\nEight 60 kWh packs: six weeks from order to your dock. The hold lasts until Friday.\n\nVeltro Cells',
  m3: 'Axion can do Wednesday. Does 10:00 work?\n\nSam',
};

const EVENTS = [
  { id: 'e1', calendar: 'Kestrel P2', title: 'Packs arrive', start: `${day(0)}T08:40`, end: `${day(0)}T09:30`, allDay: false, location: 'Dock 2', notes: '', repeats: false },
  { id: 'e2', calendar: 'Kestrel P2', title: 'Motor call with Sam', start: `${day(1)}T10:00`, end: `${day(1)}T10:30`, allDay: false, location: '', notes: '', repeats: false },
  { id: 'e3', calendar: 'Kestrel P2', title: 'Crash test', start: `${day(3)}T09:00`, end: `${day(3)}T11:00`, allDay: false, location: 'Northfield sled', notes: '', repeats: false },
  { id: 'e4', calendar: 'Work', title: 'Standup', start: `${day(0)}T09:30`, end: `${day(0)}T09:45`, allDay: false, location: '', notes: '', repeats: true },
];

const NOTES = [
  { name: 'P2 build', pages: [{ path: 'P2 build/Build plan.md', title: 'Build plan', modified: now - 3 * hour }, { path: 'P2 build/Supplier notes.md', title: 'Supplier notes', modified: now - hour }] },
  { name: 'Home', pages: [{ path: 'Home/Groceries.md', title: 'Groceries', modified: now - 30 * hour }] },
];
const NOTE_TEXT: Record<string, string> = {
  'P2 build/Build plan.md': '# Build plan\n\nThe build week is the 23rd. Packs arrive six weeks from order.\n\n- Confirm the build week with Priya\n- Send the plan to the team\n',
  'P2 build/Supplier notes.md': '# Supplier notes\n\n## Veltro Cells\n\n- 8 × 60 kWh packs, six weeks from order to the dock\n- The price hold lasts until Friday\n',
  'Home/Groceries.md': '# Groceries\n\n- Oats\n- Coffee\n',
};
/** One turn of Mobius's, still waiting to be kept, so the dashed proposals and Why this can be looked at. */
const TURN = { start: 'abc1234', end: null, when: now - 5 * 60_000, ask: 'Add the Veltro quote to my supplier notes', files: ['notes/P2 build/Supplier notes.md', 'tasks/P2 build.md'] };

/** Answers for the calls that must return more than an empty list. Keyed by the call's path. */
const ANSWERS: Record<string, (...args: never[]) => unknown> = {
  'core.getStatus': () => 'ready',
  'appearance.get': () => DEFAULT_APPEARANCE,
  'preferences.get': () => DEFAULT_PREFERENCES,
  'agent.getSettings': () => ({ baseUrl: 'https://portal.example/v1', model: 'Balanced', system: '', configured: true, hasKey: true, maxSteps: 24, keyStorage: 'session', fallbackBaseUrl: '', fallbackModel: '' }),
  'agent.question': () => null,
  'browser.getState': () => ({ tabs: [{ id: 't1', url: 'https://axion.example/motors/150', title: 'Axion 150 kW', loading: false, canGoBack: false, canGoForward: false, active: true }], activeId: 't1' }),
  'bots.get': () => ({ bots: [] }),
  'profiles.list': () => ({ current: 'personal', list: [{ id: 'personal', name: 'Personal' }] }),
  'window.quickEntryActive': () => false,
  'mini.isOpen': () => false,
  'tasks.lists': () => [{ name: 'P2 build', open: 3, done: 2 }, { name: 'Work', open: 0, done: 0 }, { name: 'Home', open: 0, done: 0 }],
  'tasks.read': ((list: string) => ({ list, tasks: list === 'P2 build' ? TASKS : [], version: 'preview' })) as never,
  'notes.list': () => NOTES,
  'notes.read': ((path: string) => ({ path, content: NOTE_TEXT[path] ?? '', modified: now })) as never,
  'changes.lastTurn': () => ({ checkpoint: TURN.start, files: TURN.files }),
  'changes.turns': () => ({ ok: true, turns: [TURN] }),
  // Before the turn: the supplier notes had only their title, and the P2 build list had no deposit task.
  'changes.before': ((_conversation: string, path: string) => ({ ok: true, text: path.startsWith('tasks/') ? '# P2 build\n\n- [x] Confirm the build week with everyone\n- [ ] Hold 8 packs at Veltro\n- [ ] Book the sled for Friday\n- [x] Draft the build budget\n' : '# Supplier notes\n' })) as never,
  'calendar.calendars': () => ['Kestrel P2', 'Work', 'Home'],
  'calendar.events': () => EVENTS,
  'mail.accounts': () => [{ id: 'a1', name: 'Northway', email: 'you@northway.example', lastSyncMs: now, problem: null }],
  'mail.list': () => MAIL,
  // A reply Mobius suggested to Priya, waiting to be kept.
  'mail.drafts': () => [{ id: 'd1', account: 'a1', to: 'priya@northway.example', cc: '', subject: 'Re: P2 build dates', body: 'Hi Priya,\n\nThe build week is the 23rd. I will send the plan to the team today.\n\nThanks', replyTo: 'm1', by: 'mobius', why: 'you asked me to confirm the build week', updatedMs: now }],
  'mail.counts': () => ({ primary: 1, transactions: 0, updates: 0, all: 1, drafts: 0, suggested: 1 }),
  'mail.read': ((id: string) => { const m = MAIL.find((x) => x.id === id) ?? MAIL[0]!; return { id: m.id, from: m.from, to: m.to, cc: m.cc, subject: m.subject, dateMs: m.dateMs, text: MAIL_TEXT[m.id] ?? '', html: null, attachments: [], category: 'primary' }; }) as never,
};

const refused = { ok: false, error: 'This is the preview: nothing is saved.' };

function answer(path: string, args: unknown[]): unknown {
  const name = path.slice(path.lastIndexOf('.') + 1);
  if (/^on[A-Z]/.test(name)) return () => undefined;
  const given = ANSWERS[path];
  if (given) return Promise.resolve((given as (...a: unknown[]) => unknown)(...args));
  if (/^(list|lists|items|get|history|waiting|conversations|archived|drafts|projects|albums|places|processes|sources|suggestions|accounts|turns|search|recent|names)$/.test(name)) return Promise.resolve([]);
  return Promise.resolve(refused);
}

const nodes = new Map<string, unknown>();
/** One object per path, so a part of the bridge is the same object every time it is read. */
function node(path: string): unknown {
  const known = nodes.get(path);
  if (known) return known;
  const made = make(path);
  nodes.set(path, made);
  return made;
}
function make(path: string): unknown {
  return new Proxy(function preview() { /* callable */ }, {
    get(_target, key) {
      if (typeof key !== 'string' || key === 'then') return undefined;
      return node(path ? `${path}.${key}` : key);
    },
    apply(_target, _self, args: unknown[]) { return answer(path, args); },
  });
}

export function installPreviewBridge(): boolean {
  const w = window as unknown as { __TAURI_INTERNALS__?: unknown; mobius?: MobiusBridge };
  if (w.mobius || w.__TAURI_INTERNALS__) return false;
  const root = node('') as Record<string, unknown>;
  w.mobius = new Proxy(root, { get: (target, key) => (key === 'platform' ? 'win32' : target[key as string]) }) as unknown as MobiusBridge;
  return true;
}
