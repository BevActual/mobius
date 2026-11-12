import type { MemoryCategory, MemoryItem, WikiChange } from '@mobius/shared';

/**
 * The preview's Knowledge: How I work, the changes waiting for the wiki and a few pages, kept in memory for as long as
 * the preview is open, so the app can be used and looked at (and photographed for the README) without the Rust core.
 */
const hour = 3_600_000;
const now = Date.now();

let MEMORY: MemoryItem[] = [
  { text: 'Works on the Kestrel P2 build at Northway Motors', category: 'you', source: 'you added it' },
  { text: 'Based in Leeds; the build team is at Northfield', category: 'you', source: 'you added it' },
  { text: 'Answers mail in the morning, not after six', category: 'prefs', source: 'Mail', learned: true },
  { text: 'No meetings on Friday afternoons', category: 'prefs', source: 'Calendar' },
  { text: 'Supplier quotes go to Files › Suppliers', category: 'prefs', source: 'Files' },
  { text: 'P2 build week starts on the 23rd', category: 'work', source: 'Notes' },
  { text: 'Priya reads on her phone: keep mail to her short', category: 'people', source: 'Mail', learned: true },
  { text: 'Sam Okafor owns the battery pack', category: 'people', source: 'you added it' },
  { text: 'Turn a supplier quote into a Sheets comparison', category: 'skills', source: 'Sheets' },
];

let INCOMING: WikiChange[] = [
  { id: 'w1', from: 'Tomás', page: 'Pages/Pilot line.md', text: 'The pilot line runs two shifts from the 30th.', whenMs: now - 2 * hour },
  { id: 'w3', from: 'Plan the P2 build week', page: 'Projects/Kestrel P2 build.md', text: 'The deposit must be paid before Veltro holds the packs.', whenMs: now - 20 * 60_000 },
  { id: 'w2', from: 'Mobius', page: 'Pages/Battery pack.md', text: 'Veltro packs take six weeks from order to the dock (Mail · Veltro, Tue).', whenMs: now - 5 * hour },
];

const TEXT: Record<string, string> = {
  'Pages/Battery pack.md': `# Battery pack

Owner: Sam Okafor. Supplier: Veltro Cells.

## Spec

- Eight 60 kWh packs per build
- Balance window 40 mV
- Two spare packs stay sealed for the crash test

## Lead time

Six weeks from order to the dock. Veltro holds the price until the deposit is paid.
`,
  'Pages/Pilot line.md': `# Pilot line

The pilot line at Northfield builds the P2 chassis before the main line takes over.

- One shift until the 30th
- Dana runs the morning inspection
`,
  'Pages/Glossary.md': `# Glossary

- **P2**: the second prototype build of the Kestrel
- **Sled**: the crash test rig at Northfield
- **Balance window**: how far apart the cells in a pack may drift
`,
  // A project's memory page, as Projects shows it.
  'Projects/Kestrel P2 build.md': `# Kestrel P2 build

- The build week is the 23rd, at Northfield.
- Packs come from Veltro Cells: six weeks from order to the dock.
- Priya signs off the budget; Sam owns the motor.
`,
  'Shared/Shared notes.md': `# Shared notes

- The team eats together on Thursdays
`,
};
const MODIFIED: Record<string, number> = { 'Pages/Battery pack.md': now - hour, 'Pages/Pilot line.md': now - 26 * hour, 'Pages/Glossary.md': now - 72 * hour, 'Projects/Kestrel P2 build.md': now - 4 * hour, 'Shared/Shared notes.md': now - 50 * hour };
const FOLDERS = new Set(['Pages', 'Projects', 'Shared']);

const title = (path: string) => path.slice(path.indexOf('/') + 1, -3);
const ok = { ok: true as const };
const fail = (message: string) => ({ ok: false as const, message });

export const PREVIEW_KNOWLEDGE: Record<string, (...args: never[]) => unknown> = {
  'memory.items': () => MEMORY.map((m) => ({ ...m })),
  'memory.list': () => MEMORY.map((m) => m.text),
  'memory.add': ((text: string, category: MemoryCategory) => { MEMORY = [...MEMORY, { text, category, source: 'you added it' }]; return ok; }) as never,
  'memory.edit': ((old: string, text: string, category: MemoryCategory) => { MEMORY = MEMORY.map((m) => (m.text === old ? { ...m, text, category } : m)); return ok; }) as never,
  'memory.forget': ((text: string) => { MEMORY = MEMORY.filter((m) => m.text !== text); return ok; }) as never,
  'memory.keep': ((text: string, on: boolean) => { MEMORY = MEMORY.map((m) => (m.text === text ? { ...m, learned: !on } : m)); return ok; }) as never,
  'memory.restore': ((text: string, category: MemoryCategory, source: string) => { MEMORY = [...MEMORY, { text, category, source, learned: true }]; return ok; }) as never,
  'wiki.list': () => [...FOLDERS].map((name) => ({
    name,
    pages: Object.keys(TEXT).filter((p) => p.startsWith(`${name}/`)).map((path) => ({ path, title: title(path), modified: MODIFIED[path] ?? now })).sort((a, b) => a.title.localeCompare(b.title)),
  })),
  'wiki.read': ((path: string) => (path in TEXT ? { path, content: TEXT[path], modified: MODIFIED[path] ?? now } : fail('that page is not there'))) as never,
  'wiki.save': ((path: string, content: string) => { TEXT[path] = content; MODIFIED[path] = Date.now(); return { path, modified: MODIFIED[path] }; }) as never,
  'wiki.createNotebook': ((name: string) => { FOLDERS.add(name); return { name }; }) as never,
  'wiki.createPage': ((folder: string, name?: string) => { const path = `${folder}/${name || 'New page'}.md`; TEXT[path] = `# ${name || 'New page'}\n`; MODIFIED[path] = Date.now(); return { path, title: title(path), modified: MODIFIED[path] }; }) as never,
  'wiki.remove': ((path: string) => { delete TEXT[path]; return { path }; }) as never,
  'wiki.versions': ((path: string) => [
    { checkpoint: 'k2', whenMs: now - 40 * 60_000, content: (TEXT[path] ?? '').replace('40 mV', '25 mV') },
    { checkpoint: 'k1', whenMs: now - 26 * hour, content: (TEXT[path] ?? '').split('\n').slice(0, 3).join('\n') },
  ]) as never,
  'wiki.incoming': () => INCOMING.map((c) => ({ ...c })),
  'wiki.offer': ((from: string, text: string, page?: string | null) => { const c = { id: `w${Date.now()}`, from, text, page: page ?? 'Shared/Shared notes.md', whenMs: Date.now() }; INCOMING = [...INCOMING, c]; return { id: c.id }; }) as never,
  'wiki.keepChange': ((id: string, text?: string | null) => {
    const c = INCOMING.find((x) => x.id === id);
    if (!c) return fail('that change is not there');
    const line = `- ${text ?? c.text}`;
    TEXT[c.page] = `${(TEXT[c.page] ?? `# ${title(c.page)}\n`).trimEnd()}\n${line}\n`;
    INCOMING = INCOMING.filter((x) => x.id !== id);
    return { ok: true as const, change: c, line };
  }) as never,
  'wiki.declineChange': ((id: string) => { const change = INCOMING.find((x) => x.id === id); INCOMING = INCOMING.filter((x) => x.id !== id); return change ? { ok: true as const, change } : fail('that change is not there'); }) as never,
  'wiki.undoChange': ((change: WikiChange, line: string | null) => {
    if (line && TEXT[change.page]) TEXT[change.page] = TEXT[change.page]!.replace(`${line}\n`, '');
    INCOMING = [...INCOMING, change];
    return ok;
  }) as never,
};
