/** The preview's Slides: decks kept in memory while the preview is open, so Slides can be used without the core. */
const now = Date.now();
const hour = 3_600_000;
const TEXT: Record<string, string> = {
  'Presentations/P2 build kickoff.md': `<!-- style: accent -->
### Northway Motors
## Kestrel P2 build
Notes:
Welcome, everyone. Two minutes on why this week matters.

---

### The week
## Two running chassis by Friday
- Packs fitted on Tuesday
- Motor bench run on Wednesday
- Crash test on the sled on Thursday
Notes:
Walk through the days. Dana leads Monday's unloading.

---

<!-- style: dark -->
### Part 2
## Packs and motor

---

## What we still need
- Torque curves from the bench run
- A driver for the long trailer
- Sign-off from Northfield

---

<!-- style: warm -->
## Questions?
`,
  'Presentations/Supplier review.md': `## Supplier review
- Veltro: price holds to month end
- Axion: four-week lead time
`,
};
const MODIFIED: Record<string, number> = { 'Presentations/P2 build kickoff.md': now - hour, 'Presentations/Supplier review.md': now - 30 * hour };
const FOLDERS = new Set(['Presentations']);
const title = (path: string) => path.slice(path.indexOf('/') + 1, -3);

export const PREVIEW_SLIDES: Record<string, (...args: never[]) => unknown> = {
  'slides.list': () => [...FOLDERS].sort().map((name) => ({
    name,
    pages: Object.keys(TEXT).filter((p) => p.startsWith(`${name}/`)).map((path) => ({ path, title: title(path), modified: MODIFIED[path] ?? now })).sort((a, b) => b.modified - a.modified),
  })),
  'slides.read': ((path: string) => (path in TEXT ? { path, content: TEXT[path], modified: MODIFIED[path] ?? now } : { ok: false, message: 'that deck is not there' })) as never,
  'slides.save': ((path: string, content: string) => { TEXT[path] = content; MODIFIED[path] = Date.now(); return { path, modified: MODIFIED[path] }; }) as never,
  'slides.createNotebook': ((name: string) => { FOLDERS.add(name.trim() || 'Presentations'); return { name: name.trim() || 'Presentations' }; }) as never,
  'slides.createPage': ((folder: string, name?: string) => {
    FOLDERS.add(folder);
    let base = (name ?? '').trim() || 'Untitled';
    for (let n = 2; `${folder}/${base}.md` in TEXT; n += 1) base = `${(name ?? '').trim() || 'Untitled'} ${n}`;
    const path = `${folder}/${base}.md`;
    TEXT[path] = `## ${base}\n`;
    MODIFIED[path] = Date.now();
    return { path, content: TEXT[path], modified: MODIFIED[path] };
  }) as never,
  'slides.remove': ((path: string) => { delete TEXT[path]; return { path }; }) as never,
  'slides.search': ((query: string) => Object.entries(TEXT).filter(([, t]) => t.toLowerCase().includes(query.toLowerCase())).map(([path, t]) => ({ path, title: title(path), notebook: path.split('/')[0], line: t.split('\n').find((l) => l.toLowerCase().includes(query.toLowerCase())) ?? '' }))) as never,
};
