import type { BrowserState, BrowserTabState, DownloadEntry } from '@mobius/shared';

/**
 * The preview's Browser: tabs kept in memory while the preview is open, so the tab list, pinning, moving tabs and the
 * address bar can be tried without the Rust core. No page is ever loaded; the page's slot stays empty.
 */
const now = Date.now();
const minute = 60_000;
const listeners = new Set<(state: BrowserState) => void>();
let next = 10;
const tab = (id: string, url: string, title: string, extra: Partial<BrowserTabState> = {}): BrowserTabState => ({ id, url, title, loading: false, canGoBack: true, canGoForward: false, active: false, icon: null, ...extra } as BrowserTabState);
let tabs: BrowserTabState[] = [
  tab('t1', 'https://mail.northway.example/inbox', 'Northway Mail', { pinned: true }),
  tab('t2', 'https://calendar.northway.example/week', 'Calendar · Week of the 23rd', { pinned: true }),
  tab('t3', 'https://axion.example/motors/150', 'Axion 150 kW traction motor', { active: true }),
  tab('t4', 'https://veltro.example/packs/60kwh', 'Veltro 60 kWh pack: specifications', { driver: 'reading' }),
  tab('t5', 'https://en.wikipedia.org/wiki/Electric_vehicle_battery', 'Electric vehicle battery - Wikipedia'),
  tab('t6', 'https://github.com/BevActual/mobius', 'BevActual/mobius', { loading: true }),
];
let closed: BrowserTabState[] = [];

const state = (): BrowserState => ({ tabs: tabs.map((t) => ({ ...t })), activeId: tabs.find((t) => t.active)?.id ?? null });
const emit = () => { const s = state(); listeners.forEach((l) => l(s)); };
const order = () => { tabs = [...tabs.filter((t) => t.pinned), ...tabs.filter((t) => !t.pinned)]; };
const activate = (id: string) => { tabs = tabs.map((t) => ({ ...t, active: t.id === id })); };
const titleOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };

const BOOKMARKS = [
  { url: 'https://northway.example/kestrel', title: 'Kestrel programme', added: now - 3 * 86_400_000 },
  { url: 'https://veltro.example/packs/60kwh', title: 'Veltro 60 kWh pack', added: now - 2 * 86_400_000 },
  { url: 'https://axion.example/motors/150', title: 'Axion 150 kW', added: now - 86_400_000 },
  { url: 'https://github.com/BevActual/mobius', title: 'Mobius on GitHub', added: now - 5 * 86_400_000 },
  { url: 'https://developer.apple.com/design/human-interface-guidelines', title: 'Human Interface Guidelines', added: now - 9 * 86_400_000 },
];
const HISTORY = [
  ['https://axion.example/motors/150', 'Axion 150 kW traction motor'], ['https://veltro.example/packs/60kwh', 'Veltro 60 kWh pack: specifications'],
  ['https://veltro.example/quote', 'Your quote · Veltro Cells'], ['https://en.wikipedia.org/wiki/Electric_vehicle_battery', 'Electric vehicle battery - Wikipedia'],
  ['https://northway.example/kestrel', 'Kestrel programme'], ['https://news.ycombinator.com/', 'Hacker News'], ['https://github.com/BevActual/mobius', 'BevActual/mobius'],
  ['https://axion.example/', 'Axion Motors'], ['https://www.bbc.co.uk/news', 'BBC News'], ['https://veltro.example/', 'Veltro Cells'],
].map(([url, title], i) => ({ url: url!, title: title!, visited: now - (i + 1) * 17 * minute }));
const DOWNLOADS: DownloadEntry[] = [
  { id: 'd1', name: 'Veltro-60kWh-datasheet.pdf', state: 'done', received: 2_400_000, total: 2_400_000, risky: false },
  { id: 'd2', name: 'axion-150-cad.zip', state: 'downloading', received: 31_000_000, total: 52_000_000, risky: false },
];

export const PREVIEW_BROWSER: Record<string, (...args: never[]) => unknown> = {
  'browser.getState': () => state(),
  'browser.onState': ((listener: (s: BrowserState) => void) => { listeners.add(listener); return () => listeners.delete(listener); }) as never,
  'browser.activate': ((id: string) => { activate(id); emit(); }) as never,
  'browser.open': ((input?: string) => {
    const id = `t${next++}`;
    tabs = [...tabs.map((t) => ({ ...t, active: false })), tab(id, input ?? '', input ? titleOf(input) : 'New tab', { active: true, canGoBack: false })];
    emit();
    return id;
  }) as never,
  'browser.close': ((id: string) => {
    const at = tabs.findIndex((t) => t.id === id);
    const gone = tabs[at];
    if (!gone) return;
    closed = [gone, ...closed];
    tabs = tabs.filter((t) => t.id !== id);
    if (gone.active && tabs.length > 0) activate(tabs[Math.min(at, tabs.length - 1)]!.id);
    emit();
  }) as never,
  'browser.navigate': ((id: string, input: string) => {
    const text = input.trim();
    const looksLikeAddress = /^[a-z]+:\/\//i.test(text) || /^[^\s]+\.[a-z]{2,}(\/\S*)?$/i.test(text);
    if (!looksLikeAddress && /\s/.test(text)) return 'ask';
    const url = looksLikeAddress ? (/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`) : `https://duckduckgo.com/?q=${encodeURIComponent(text)}`;
    tabs = tabs.map((t) => (t.id === id ? { ...t, url, title: titleOf(url), canGoBack: true } : t));
    emit();
    return 'navigated';
  }) as never,
  'browser.reopenClosed': () => {
    const [back, ...rest] = closed;
    if (!back) return null;
    closed = rest;
    tabs = [...tabs.map((t) => ({ ...t, active: false })), { ...back, active: true }];
    order();
    emit();
    return back.id;
  },
  'browser.duplicate': ((id: string) => {
    const from = tabs.find((t) => t.id === id);
    if (!from) return null;
    const copy = { ...from, id: `t${next++}`, pinned: false, driver: null, active: true };
    const at = tabs.indexOf(from);
    tabs = [...tabs.slice(0, at + 1).map((t) => ({ ...t, active: false })), copy, ...tabs.slice(at + 1).map((t) => ({ ...t, active: false }))];
    order();
    emit();
    return copy.id;
  }) as never,
  'browser.pin': ((id: string, pinned: boolean) => {
    const it = tabs.find((t) => t.id === id);
    if (!it || (it.pinned === true) === pinned) return;
    const rest = tabs.filter((t) => t.id !== id);
    rest.splice(rest.filter((t) => t.pinned).length, 0, { ...it, pinned });
    tabs = rest;
    emit();
  }) as never,
  'browser.moveTab': ((id: string, index: number) => {
    const moving = tabs.find((t) => t.id === id);
    if (!moving) return;
    const rest = tabs.filter((t) => t.id !== id);
    // As the core does: never across the line between pinned and ordinary tabs.
    const front = rest.filter((t) => t.pinned).length;
    const [low, high] = moving.pinned ? [0, front] : [front, rest.length];
    rest.splice(Math.max(low, Math.min(high, index)), 0, moving);
    tabs = rest;
    emit();
  }) as never,
  'browser.snapshot': () => null,
  'bookmarks.get': ((query: string) => BOOKMARKS.filter((b) => `${b.title} ${b.url}`.toLowerCase().includes(query.toLowerCase()))) as never,
  'history.get': ((query: string) => ({ enabled: true, entries: HISTORY.filter((h) => `${h.title} ${h.url}`.toLowerCase().includes(query.toLowerCase())) })) as never,
  'downloads.get': () => DOWNLOADS,
};
