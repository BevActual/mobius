import { articleFile } from '../reader-format';

/**
 * The preview's Reader: articles kept in memory for as long as the preview is open, so Reader can be used and looked
 * at without the Rust core. Saving a link makes a short stand-in article, since the preview cannot fetch pages.
 */
const hour = 3_600_000;
const now = Date.now();
const daysAgo = (n: number) => new Date(now - n * 24 * hour);

const TEXT: Record<string, string> = {
  'Reading list/Why battery packs ship by sea.md': articleFile({
    url: 'https://www.veltro.example/journal/why-packs-ship-by-sea',
    title: 'Why battery packs ship by sea',
    text: `Most large lithium packs still cross oceans on container ships, not planes. The reason is less about cost than about rules: a 60 kWh pack is far over what air freight allows for a single battery, and splitting it into modules adds weeks of paperwork at both ends.

## Six weeks, door to dock

From the day an order is confirmed, a pack spends about two weeks in final testing, a week waiting for a sailing, and three weeks at sea and in customs. Builders who plan around that number rarely get caught out. Builders who plan around the quote's best case usually do.

> The fastest pack is the one already on the water.

## What builders can do

- Order the long-lead parts first, before the build date is final
- Ask the supplier to hold stock against a deposit
- Keep two sealed spares for testing, so a damaged pack does not stop the build

None of this is new, but it is easy to forget when a build week is set by the calendar rather than the supply chain.`,
  }, daysAgo(1)),
  'Reading list/The quiet sled.md': articleFile({
    url: 'https://northway.example/blog/the-quiet-sled',
    title: 'The quiet sled',
    text: `Crash sleds are loud, expensive and booked months ahead. The one at Northfield is booked for a single Friday in the P2 build week, which means every chassis that needs it has to be ready by Thursday night.

The team's answer has been to treat the sled as the deadline, and plan backwards from it.`,
  }, daysAgo(3)),
  'Reading list/Calibrating a motor controller.md': articleFile({
    url: 'https://axion.example/notes/calibration',
    title: 'Calibrating a motor controller',
    text: `A controller flashed with the wrong calibration will still spin the motor, which is what makes the mistake easy to miss. Check the build calibration's checksum against the one in the release notes before the first full-load test.`,
  }, daysAgo(6)),
  'Archive/Planning a build week.md': articleFile({
    url: 'https://northway.example/blog/planning-a-build-week',
    title: 'Planning a build week',
    text: `Start with what has the longest lead time, then the people, then the room.`,
  }, daysAgo(12)),
};
const MODIFIED: Record<string, number> = {
  'Reading list/Why battery packs ship by sea.md': now - 24 * hour,
  'Reading list/The quiet sled.md': now - 3 * 24 * hour,
  'Reading list/Calibrating a motor controller.md': now - 6 * 24 * hour,
  'Archive/Planning a build week.md': now - 12 * 24 * hour,
};
const FOLDERS = new Set(['Reading list', 'Archive']);

const title = (path: string) => (TEXT[path] ?? '').match(/^# (.+)$/m)?.[1] ?? path.slice(path.indexOf('/') + 1, -3);
const lead = (text: string) => (text.split('---')[1] ?? '').split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('#')) ?? '';
const fail = (message: string) => ({ ok: false as const, message });

export const PREVIEW_READING: Record<string, (...args: never[]) => unknown> = {
  'reading.list': () => [...FOLDERS].map((name) => ({
    name,
    pages: Object.keys(TEXT).filter((p) => p.startsWith(`${name}/`)).map((path) => ({ path, title: title(path), modified: MODIFIED[path] ?? now, preview: lead(TEXT[path]!).slice(0, 120), tags: [], links: [] })).sort((a, b) => b.modified - a.modified),
  })),
  'reading.read': ((path: string) => (path in TEXT ? { path, content: TEXT[path], modified: MODIFIED[path] ?? now } : fail('that article is not there'))) as never,
  'reading.save': ((path: string, content: string) => { TEXT[path] = content; MODIFIED[path] = Date.now(); return { path, modified: MODIFIED[path] }; }) as never,
  'reading.createNotebook': ((name: string) => { FOLDERS.add(name.trim() || 'Reading list'); return { name: name.trim() || 'Reading list' }; }) as never,
  'reading.createPage': ((folder: string, name?: string) => {
    FOLDERS.add(folder);
    let base = (name ?? '').trim() || 'Article';
    for (let n = 2; `${folder}/${base}.md` in TEXT; n += 1) base = `${(name ?? '').trim() || 'Article'} ${n}`;
    const path = `${folder}/${base}.md`;
    TEXT[path] = `# ${base}\n\n`;
    MODIFIED[path] = Date.now();
    return { path, content: TEXT[path], modified: MODIFIED[path] };
  }) as never,
  'reading.remove': ((path: string) => { delete TEXT[path]; delete MODIFIED[path]; return { path }; }) as never,
  'reading.search': ((query: string) => Object.entries(TEXT).filter(([, t]) => t.toLowerCase().includes(query.toLowerCase())).map(([path, t]) => ({ path, title: title(path), notebook: path.split('/')[0], line: t.split('\n').find((l) => l.toLowerCase().includes(query.toLowerCase())) ?? '' }))) as never,
  'reading.fetch': ((url: string) => {
    let host = url;
    try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { return fail('that is not a web address'); }
    return { ok: true as const, url, title: `A page from ${host}`, text: 'The preview cannot fetch pages, so this stands in for the article\'s words.' };
  }) as never,
};
