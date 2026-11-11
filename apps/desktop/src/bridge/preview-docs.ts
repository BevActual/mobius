import type { NoteComment } from '@mobius/shared';

/**
 * The preview's Docs: documents kept in memory for as long as the preview is open, with their history, comments and
 * files, so Docs can be used and looked at without the Rust core.
 */
const hour = 3_600_000;
const now = Date.now();

const TEXT: Record<string, string> = {
  'P2 build/Build brief.md': `# Build brief

The P2 build runs the week of the 23rd at Northfield. This brief is what everyone needs before the week starts: what we are building, who is bringing what, and what has to be true by Friday.

## Goal

Two running Kestrel P2 chassis on the sled by Friday afternoon, with the battery packs fitted and the motor tested at full load.

## Packs

Eight 60 kWh packs from Veltro, six weeks from order. Veltro holds them for us until the deposit is paid.

- Deposit due by the 14th
- Packs arrive on pallets at Dock 2
- Two spare packs stay sealed for the crash test

## Motor

The Axion 150 kW unit, with the controller flashed to the build calibration.

> Sam needs the torque curves from the bench run before Wednesday.

## Schedule

| Day | What | Who |
| --- | --- | --- |
| Monday | Unload and inspect packs | Dana |
| Tuesday | Fit packs, wire the harness | Priya, Sam |
| Wednesday | Motor bench run | Sam |
| Thursday | Crash test on the sled | Northfield |
| Friday | Review and sign-off | Everyone |

## Open questions

- [ ] Who drives the long trailer back?
- [x] Is the sled booked for Thursday?
`,
  'P2 build/Supplier notes.md': `# Supplier notes

## Veltro

Price holds until the end of the month. Ask about the cell warranty.

## Axion

Lead time is four weeks. They can ship a loaner controller.
`,
  'Personal/Reading list.md': `# Reading list

- The Design of Everyday Things
- Shape Up
`,
};
const MODIFIED: Record<string, number> = { 'P2 build/Build brief.md': now - hour, 'P2 build/Supplier notes.md': now - 26 * hour, 'Personal/Reading list.md': now - 72 * hour };
const FOLDERS = new Set(['P2 build', 'Personal']);
const COMMENTS: Record<string, NoteComment[]> = {
  'P2 build/Build brief.md': [{ id: 'c1', quote: 'Eight 60 kWh packs from Veltro', text: 'Is it eight, or ten with the spares?', by: 'Dana', whenMs: now - 3 * hour, resolved: false }],
};
const FILES: Record<string, string> = {};

const title = (path: string) => (TEXT[path] ?? '').match(/^# (.+)$/m)?.[1] ?? path.slice(path.indexOf('/') + 1, -3);
const fail = (message: string) => ({ ok: false as const, message });

export const PREVIEW_DOCS: Record<string, (...args: never[]) => unknown> = {
  'docs.list': () => [...FOLDERS].sort().map((name) => ({
    name,
    pages: Object.keys(TEXT).filter((p) => p.startsWith(`${name}/`)).map((path) => ({ path, title: title(path), modified: MODIFIED[path] ?? now })).sort((a, b) => b.modified - a.modified),
  })),
  'docs.read': ((path: string) => (path in TEXT ? { path, content: TEXT[path], modified: MODIFIED[path] ?? now } : fail('that document is not there'))) as never,
  'docs.save': ((path: string, content: string) => { TEXT[path] = content; MODIFIED[path] = Date.now(); return { path, modified: MODIFIED[path] }; }) as never,
  'docs.createNotebook': ((name: string) => { FOLDERS.add(name.trim() || 'Documents'); return { name: name.trim() || 'Documents' }; }) as never,
  'docs.createPage': ((folder: string, name?: string) => {
    FOLDERS.add(folder);
    let base = (name ?? '').trim() || 'Untitled';
    for (let n = 2; `${folder}/${base}.md` in TEXT; n += 1) base = `${(name ?? '').trim() || 'Untitled'} ${n}`;
    const path = `${folder}/${base}.md`;
    TEXT[path] = `# ${base}\n\n`;
    MODIFIED[path] = Date.now();
    return { path, content: TEXT[path], modified: MODIFIED[path] };
  }) as never,
  'docs.remove': ((path: string) => { delete TEXT[path]; return { path }; }) as never,
  'docs.search': ((query: string) => Object.entries(TEXT).filter(([, t]) => t.toLowerCase().includes(query.toLowerCase())).map(([path, t]) => ({ path, title: title(path), notebook: path.split('/')[0], line: t.split('\n').find((l) => l.toLowerCase().includes(query.toLowerCase())) ?? '' }))) as never,
  'docs.versions': ((path: string) => [
    { whenMs: now - 50 * 60_000, content: (TEXT[path] ?? '').replace(/\n## Schedule[\s\S]*?(?=\n## )/, ''), source: 'kept' },
    { whenMs: now - 30 * hour, content: (TEXT[path] ?? '').split('\n').slice(0, 5).join('\n'), source: 'checkpoint' },
  ]) as never,
  'docs.attach': ((path: string, name: string, base64: string) => {
    const ref = `${path.slice(path.indexOf('/') + 1, -3)} files/${name}`.replace(/ /g, '%20');
    FILES[ref] = base64.startsWith('data:') ? base64 : `data:image/png;base64,${base64}`;
    return { path, ref, name, image: /\.(png|jpe?g|gif|webp)$/i.test(name) };
  }) as never,
  'docs.asset': ((_path: string, ref: string) => (FILES[ref] ? { dataUrl: FILES[ref], size: 1 } : fail('that file is not there'))) as never,
  'docs.comments': ((path: string) => COMMENTS[path] ?? []) as never,
  'docs.setComments': ((path: string, comments: NoteComment[]) => { COMMENTS[path] = comments; return { path, comments }; }) as never,
  'docs.export': ((path: string, kind: string) => { const name = `${path.slice(path.indexOf('/') + 1, -3)}.${kind}`; return { path, saved: `Exports/${name}`, name }; }) as never,
};
