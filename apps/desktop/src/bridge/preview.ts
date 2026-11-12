import { tagsIn } from '../note-tags';
import { linksIn } from '../note-links';
import { PREVIEW_TASKS } from './preview-tasks';
import { PREVIEW_CALENDAR } from './preview-calendar';
import { PREVIEW_DOCS } from './preview-docs';
import { PREVIEW_SONGS } from './preview-songs';
import { PREVIEW_BROWSER } from './preview-browser';
import { PREVIEW_CODE } from './preview-code';
import { PREVIEW_DESIGNS } from './preview-designs';
import { PREVIEW_SLIDES } from './preview-slides';
import { PREVIEW_PHOTOS } from './preview-photos';
import { PREVIEW_VIDEO } from './preview-video';
import { PREVIEW_BUDGET_BEFORE, PREVIEW_SHEETS } from './preview-sheets';
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

const NOTE_FILES: Record<string, string> = {};
const NOTE_COMMENTS: Record<string, unknown[]> = { 'P2 build/Supplier notes.md': [{ id: 'c1', quote: 'six weeks from order to the dock', text: 'Can Veltro do five if we pay the deposit this week?', by: 'you', whenMs: Date.now() - 2 * 3_600_000, resolved: false }] };
const NOTE_TEXT: Record<string, string> = {
  'P2 build/Build plan.md': '# Build plan\n\nThe build week is the 23rd. Packs arrive six weeks from order (see [Supplier notes](Supplier%20notes.md)). #kestrel/p2\n\n## Before we go\n\n- [x] Confirm the build week with Priya\n- [ ] Send the plan to the team\n- [ ] Book the sled for Friday\n\n| Item | Cost |\n| --- | --- |\n| Packs | 48000 |\n| Sled | 6500 |\n',
  'P2 build/Supplier notes.md': '# Supplier notes\n\n## Veltro Cells\n\n- 8 × 60 kWh packs, six weeks from order to the dock\n- The price hold lasts until **Friday** #supplier #kestrel/p2\n',
  'Home/Groceries.md': '# Groceries\n\n- [ ] Oats\n- [ ] Coffee #home\n',
};
const notePage = (path: string, modified: number) => ({ path, title: path.slice(path.indexOf('/') + 1, -3), modified, preview: previewOf(NOTE_TEXT[path] ?? ''), tags: tagsIn(NOTE_TEXT[path] ?? ''), links: linksIn(NOTE_TEXT[path] ?? '', path) });
const NOTES = () => [
  { name: 'P2 build', pages: [notePage('P2 build/Supplier notes.md', now - hour), notePage('P2 build/Build plan.md', now - 3 * hour)] },
  { name: 'Home', pages: [notePage('Home/Groceries.md', now - 30 * hour)] },
];
/** The first line under the title, as the Rust list gives it (roughly: enough for the preview). */
const previewOf = (text: string) => (text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('# ') && !l.startsWith('|'))[0] ?? '').replace(/^#+\s*|^[-*] (\[[ x]\] )?/g, '').replace(/[*_`]/g, '').slice(0, 120);
/** One turn of Mobius's, still waiting to be kept, so the dashed proposals and Why this can be looked at. */
const TURN = { start: 'abc1234', end: null, when: now - 5 * 60_000, ask: 'Add the Veltro quote to my supplier notes', files: ['notes/P2 build/Supplier notes.md', 'tasks/P2 build.md', 'docs/P2 build/Build brief.md', 'sheets/P2 budget/Sheet 1.csv'] };

let previewLook = { ...DEFAULT_APPEARANCE };

/** Answers for the calls that must return more than an empty list. Keyed by the call's path. */
const ANSWERS: Record<string, (...args: never[]) => unknown> = {
  'core.getStatus': () => 'ready',
  'files.list': (path: string) => ({ path, truncated: false, entries: path === '' ? [{ name: 'docs', type: 'folder' }, { name: 'notes', type: 'folder' }, { name: 'sheets', type: 'folder' }, { name: 'tasks', type: 'folder' }, { name: 'README.md', type: 'file', bytes: 2048 }] : path === 'notes' ? [{ name: 'P2 build', type: 'folder' }, { name: 'Home', type: 'folder' }] : path === 'notes/P2 build' ? [{ name: 'Build plan.md', type: 'file', bytes: 620 }, { name: 'Supplier notes.md', type: 'file', bytes: 410 }] : [] }),
  'extensions.connectors': () => ({ running: ['github'], failed: [{ server: 'linear', error: 'The command was not found' }], problem: null }),
  // The look is kept for the session, so choices in the preview stick and a change never answers with a failure.
  'appearance.get': () => ({ ...previewLook }),
  'appearance.set': ((change: Partial<typeof DEFAULT_APPEARANCE>) => { previewLook = { ...previewLook, ...change }; return { ...previewLook }; }) as never,
  'preferences.get': () => DEFAULT_PREFERENCES,
  'agent.getSettings': () => ({ baseUrl: 'https://portal.example/v1', model: 'Balanced', system: '', configured: true, hasKey: true, maxSteps: 24, keyStorage: 'session', fallbackBaseUrl: '', fallbackModel: '' }),
  'agent.question': () => null,
  ...PREVIEW_BROWSER,
  ...PREVIEW_CODE,
  ...PREVIEW_DESIGNS,
  ...PREVIEW_SLIDES,
  ...PREVIEW_PHOTOS,
  ...PREVIEW_VIDEO,
  'bots.get': () => ({ bots: [
    { id: 'main', name: 'Mobius', instructions: '', model: '', createdMs: 0 },
    { id: 'rcpt01', name: 'File receipts', instructions: 'When a receipt arrives in Mail, add a row to the Expenses sheet.', model: '', createdMs: now - 6 * 86_400_000 },
    { id: 'wkly01', name: 'Weekly P2 summary', instructions: 'Every Friday, summarise the week on the Kestrel P2 build from Notes, Tasks and Mail.', model: 'Thorough', createdMs: now - 3 * 86_400_000 },
  ] }),
  'profiles.list': () => ({ current: 'personal', list: [{ id: 'personal', name: 'Personal' }] }),
  'window.quickEntryActive': () => false,
  'mini.isOpen': () => false,
  // Tasks are kept in memory for as long as the preview is open.
  ...PREVIEW_TASKS,
  // Documents are kept in memory for as long as the preview is open.
  ...PREVIEW_DOCS,
  ...PREVIEW_SONGS,
  'notes.list': () => NOTES(),
  'notes.search': ((query: string) => Object.entries(NOTE_TEXT).filter(([, t]) => t.toLowerCase().includes(query.toLowerCase())).map(([path, t]) => ({ path, title: path.slice(path.indexOf('/') + 1, -3), notebook: path.split('/')[0], line: t.split('\n').find((l) => l.toLowerCase().includes(query.toLowerCase())) ?? '' }))) as never,
  // Typing in a note is kept for as long as the preview is open, so the Markdown it is saved as can be looked at.
  'notes.save': ((path: string, content: string) => { NOTE_TEXT[path] = content; (window as unknown as { savedNote?: string }).savedNote = content; return { path, modified: Date.now() }; }) as never,
  // Two earlier versions of every page: one from before Mobius's turn, one kept while typing.
  'notes.versions': ((path: string) => [
    { whenMs: now - 40 * 60_000, content: (NOTE_TEXT[path] ?? '').replace(/\n- The price hold[^\n]*/, ''), source: 'kept' },
    { whenMs: now - 26 * hour, content: (NOTE_TEXT[path] ?? '').split('\n').slice(0, 3).join('\n'), source: 'checkpoint' },
  ]) as never,
  // Files added to a page are kept for as long as the preview is open.
  'notes.attach': ((path: string, name: string, base64: string) => {
    const ref = `${path.slice(path.indexOf('/') + 1, -3)} files/${name}`.replace(/ /g, '%20');
    NOTE_FILES[ref] = base64.startsWith('data:') ? base64 : `data:image/png;base64,${base64}`;
    return { path, ref, name, image: /\.(png|jpe?g|gif|webp)$/i.test(name) };
  }) as never,
  'notes.asset': ((_path: string, ref: string) => (NOTE_FILES[ref] ? { dataUrl: NOTE_FILES[ref], size: 1 } : { ok: false, message: 'that file is not there' })) as never,
  // Comments are kept for as long as the preview is open; Supplier notes starts with one.
  'notes.comments': ((path: string) => NOTE_COMMENTS[path] ?? []) as never,
  'notes.setComments': ((path: string, comments: unknown[]) => { NOTE_COMMENTS[path] = comments; return { path, comments }; }) as never,
  'notes.export': ((path: string, kind: string) => { const name = `${path.slice(path.indexOf('/') + 1, -3)}.${kind}`; (window as unknown as { exported?: string }).exported = name; return { path, saved: `Exports/${name}`, name }; }) as never,
  ...PREVIEW_SHEETS,
  'notes.read': ((path: string) => ({ path, content: NOTE_TEXT[path] ?? '', modified: now })) as never,
  'changes.lastTurn': () => ({ checkpoint: TURN.start, files: TURN.files }),
  'changes.turns': () => ({ ok: true, turns: [TURN] }),
  // Before the turn: the supplier notes had only their title, and the P2 build list had no deposit task.
  'changes.before': ((_conversation: string, path: string) => ({ ok: true, text: path.startsWith('tasks/') ? '# P2 build\n\n- [x] Confirm the build week with everyone\n- [ ] Hold 8 packs at Veltro\n- [ ] Book the sled for Friday\n- [x] Draft the build budget\n' : path.startsWith('sheets/') ? PREVIEW_BUDGET_BEFORE : path.startsWith('docs/') ? '# Build brief\n\nThe P2 build runs the week of the 23rd.\n' : '# Supplier notes\n' })) as never,
  'calendar.calendars': () => ['Kestrel P2', 'Work', 'Home'],
  // Events are kept in memory for as long as the preview is open.
  ...PREVIEW_CALENDAR,
  // Time Mobius suggests, waiting to be kept.
  'calendar.suggestions': () => [{ id: 's1', calendar: 'Kestrel P2', title: 'Prep the build plan', start: `${day(1)}T14:00`, end: `${day(1)}T15:00`, allDay: false, location: '', notes: '', why: 'your first free hour before the build week call' }],
  // The model picker: a plan, a key, and a model on this computer.
  // This computer: a graphics card, the engine, and one model downloaded.
  'models.hardware': () => ({ gpu_name: 'NVIDIA GeForce RTX 4070', vram_total: 12_884_901_888, vram_free: 10_737_418_240, ram_total: 34_359_738_368, ram_free: 17_179_869_184 }),
  'models.status': () => ({ binary: null, runtime: null }),
  'models.local': () => [],
  // Gateways: one service with a key, one on this computer, and the rest to add.
  // Voice: dictation hears a fixed sentence, and replies are read as a moment of silence.
  'agent.transcribe': () => ({ ok: true, text: 'Hello from the preview.' }),
  'voice.speak': () => ({ ok: true, audio: 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=' }),
  'updates.get': () => ({ state: 'off', status: 'Updates are off in the preview.', current: '0.1.0' }),
  'providers.list': () => [
    { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', note: 'GPT models.', keyUrl: 'https://platform.openai.com/api-keys', needsKey: true, voiceOnly: false, hasKey: true, active: false, storage: 'keychain' },
    { id: 'anthropic', name: 'Anthropic', baseUrl: 'https://api.anthropic.com/v1', note: 'Claude models, through their OpenAI-compatible layer.', keyUrl: 'https://console.anthropic.com/settings/keys', needsKey: true, voiceOnly: false, hasKey: false, active: false, storage: 'none' },
    { id: 'elevenlabs', name: 'ElevenLabs', baseUrl: 'https://api.elevenlabs.io/v1', note: 'Voice only: listening and speaking, in Settings, Voice.', keyUrl: 'https://elevenlabs.io/app/settings/api-keys', needsKey: true, voiceOnly: true, hasKey: false, active: false, storage: 'none' },
    { id: 'ollama', name: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1', note: 'Models you run with Ollama on this computer. No key needed.', keyUrl: null, needsKey: false, voiceOnly: false, hasKey: false, active: false, storage: 'none' },
  ],
  'providers.accounts': () => [{ id: 'claude', name: 'Claude Code', note: 'Your Claude plan, through Claude Code on this computer.', active: true, kind: 'cli', models: [{ id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' }] }],
  'providers.accountStatus': () => ({ installed: true, signedIn: true, account: 'you@example.com' }),
  'providers.catalog': () => ({ current: 'claude-sonnet-5-5', groups: [{ kind: 'subscription', id: 'claude', name: 'Claude plan', active: true, models: [{ id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' }, { id: 'claude-opus-5-5', label: 'Opus 5.5' }], error: null }, { kind: 'local', id: 'local', name: 'On this computer', active: false, models: [{ id: 'qwen3-8b', label: 'Qwen3 8B' }], error: null }] }),
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
  const given = ANSWERS[path];
  // A listener answers at once with its way of stopping; only the ones in ANSWERS ever fire.
  if (/^on[A-Z]/.test(name)) return given ? (given as (...a: unknown[]) => unknown)(...args) : () => undefined;
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
