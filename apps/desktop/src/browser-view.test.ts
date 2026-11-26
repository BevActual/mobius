import { describe, expect, it } from 'vitest';
import type { BrowserTabState } from '@mobius/shared';
import { addressParts, dropPlan, historyByDay, hostOf, nextTabId, stepZoom, sidebarMatch, suggestionsFor, tileLetter } from './browser-view';

const tab = (id: string, url: string, title: string, extra: Partial<BrowserTabState> = {}): BrowserTabState => ({ id, url, title, loading: false, canGoBack: false, canGoForward: false, active: false, icon: null, ...extra });

describe('the address at rest', () => {
  it('shows the site name and whether the connection is private', () => {
    expect(addressParts('https://www.veltro.example/packs?x=1')).toEqual({ secure: true, host: 'veltro.example', path: 'packs?x=1' });
    expect(addressParts('https://axion.example/motors/150/')).toEqual({ secure: true, host: 'axion.example', path: 'motors/150' });
    expect(addressParts('http://localhost:5173/')).toEqual({ secure: false, host: 'localhost', path: '' });
    expect(addressParts('file:///C:/Users/me/Report%201.pdf')).toEqual({ secure: false, host: 'Report 1.pdf', path: '' });
  });
  it('leaves anything else as it is', () => {
    expect(addressParts('')).toBeNull();
    expect(addressParts('about:blank')).toBeNull();
    expect(addressParts('mobius://settings')).toBeNull();
    expect(hostOf('not an address')).toBe('not an address');
  });
});

describe('site tiles', () => {
  it('gives a site the same letter every time', () => {
    expect(tileLetter('veltro.example')).toBe('V');
    expect(tileLetter('-9gag.com')).toBe('9');
    expect(tileLetter('')).toBe('?');
  });
});

describe('address suggestions', () => {
  const tabs = [tab('t1', 'https://axion.example/motors', 'Axion motors', { active: true }), tab('t2', 'https://veltro.example/packs', 'Veltro packs')];
  const bookmarks = [{ url: 'https://veltro.example/packs', title: 'Veltro packs', added: 1 }, { url: 'https://veltro.example/quote', title: 'Your quote', added: 2 }];
  const history = [{ url: 'https://veltro.example/quote/', title: 'Your quote', visited: 3 }, { url: 'https://news.example/', title: 'Velvet news', visited: 4 }, { url: 'https://example.com/revelt', title: 'Revelt', visited: 5 }];

  it('offers open tabs first, then bookmarks, then history, each page once', () => {
    expect(suggestionsFor('velt', tabs, bookmarks, history).map((s) => `${s.kind} ${s.url}`)).toEqual([
      'tab https://veltro.example/packs',
      'bookmark https://veltro.example/quote',
    ]);
  });
  it('matches the start of words only, and every word typed', () => {
    expect(suggestionsFor('quote you', tabs, bookmarks, history).map((s) => s.url)).toEqual(['https://veltro.example/quote']);
    expect(suggestionsFor('elt', tabs, bookmarks, history)).toEqual([]);
  });
  it('never suggests the tab that is showing, and nothing for an empty bar', () => {
    expect(suggestionsFor('axion', tabs, [], [])).toEqual([]);
    expect(suggestionsFor('  ', tabs, bookmarks, history)).toEqual([]);
  });
  it('takes what is typed literally', () => {
    expect(() => suggestionsFor('c++ (', tabs, bookmarks, history)).not.toThrow();
  });
});

describe('dropping a dragged tab', () => {
  const tabs = [tab('p1', 'a', 'A', { pinned: true }), tab('p2', 'b', 'B', { pinned: true }), tab('t1', 'c', 'C'), tab('t2', 'd', 'D'), tab('t3', 'e', 'E')];
  it('moves it among its own kind', () => {
    expect(dropPlan(tabs, 't3', 't1', false)).toEqual({ pinned: false, index: 2 });
    expect(dropPlan(tabs, 't1', 't3', true)).toEqual({ pinned: false, index: 4 });
  });
  it('pins it when dropped among the pinned tabs, and unpins it the other way', () => {
    expect(dropPlan(tabs, 't2', 'p1', true)).toEqual({ pinned: true, index: 1 });
    expect(dropPlan(tabs, 'p1', 't2', true)).toEqual({ pinned: false, index: 3 });
  });
  it('does nothing when it lands where it was', () => {
    expect(dropPlan(tabs, 't2', 't2', false)).toBeNull();
    expect(dropPlan(tabs, 't2', 't1', true)).toBeNull();
    expect(dropPlan(tabs, 't2', 't3', false)).toBeNull();
    expect(dropPlan(tabs, 'gone', 't1', false)).toBeNull();
  });
});

describe('sidebarMatch', () => {
  it('matches every word against the title and the address, in any case', () => {
    expect(sidebarMatch('', 'Anything', 'https://a.example')).toBe(true);
    expect(sidebarMatch('axion motor', 'Axion 150 kW traction motor', 'https://axion.example/motors/150')).toBe(true);
    expect(sidebarMatch('WIKIPEDIA', 'Electric vehicle battery', 'https://en.wikipedia.org/wiki/EV')).toBe(true);
    expect(sidebarMatch('axion pack', 'Axion 150 kW traction motor', 'https://axion.example/')).toBe(false);
    expect(sidebarMatch('https', 'Page', 'https://www.page.example/')).toBe(false);
  });
});

describe('nextTabId', () => {
  const t = (id: string, extra: Partial<BrowserTabState> = {}) => ({ id, url: `https://${id}.example/`, title: id, loading: false, canGoBack: false, canGoForward: false, active: false, icon: null, ...extra }) as BrowserTabState;
  // As the core keeps them and the tabs panel lists them: Pinned first, then Today.
  const tabs = [t('p', { pinned: true }), t('a', { active: true }), t('b')];
  it('steps through the tabs in the order the sidebar shows, going round', () => {
    expect(nextTabId(tabs, 1)).toBe('b');
    expect(nextTabId(tabs, -1)).toBe('p');
    expect(nextTabId(tabs.map((x) => ({ ...x, active: x.id === 'p' })), 1)).toBe('a');
  });
  it('has nowhere to go with one tab', () => {
    expect(nextTabId([t('a', { active: true })], 1)).toBeNull();
  });
});

describe('History by day', () => {
  const now = new Date(2026, 10, 25, 15);
  const at = (d: number, h: number) => new Date(2026, 10, d, h).getTime();
  const e = (url: string, title: string, visited: number) => ({ url, title, visited });
  it('groups under Today, Yesterday and earlier days, newest first, each page once a day', () => {
    const days = historyByDay([
      e('https://a.test/', 'Alpha', at(25, 9)), e('https://b.test/', 'Beta', at(25, 14)), e('https://a.test/', 'Alpha', at(25, 12)),
      e('https://c.test/', 'Gamma', at(24, 10)), e('https://a.test/', 'Alpha', at(20, 10)),
    ], now);
    expect(days.map((d) => d.label).slice(0, 2)).toEqual(['Today', 'Yesterday']);
    expect(days).toHaveLength(3);
    expect(days[0]!.entries.map((x) => x.title)).toEqual(['Beta', 'Alpha']);
    expect(days[0]!.entries[1]!.visited).toBe(at(25, 12));
    expect(days[2]!.entries.map((x) => x.title)).toEqual(['Alpha']);
  });
  it('keeps only pages with every word typed, in the title or the address', () => {
    const list = [e('https://docs.test/rust', 'Rust book', at(25, 9)), e('https://news.test/', 'News', at(25, 10))];
    expect(historyByDay(list, now, 'rust docs').flatMap((d) => d.entries.map((x) => x.title))).toEqual(['Rust book']);
    expect(historyByDay(list, now, 'nothing')).toEqual([]);
  });
});

describe('page zoom', () => {
  it('steps in and out through Chrome\'s levels, from between them too, and stays at the ends', () => {
    expect(stepZoom(1, 1)).toBe(1.1);
    expect(stepZoom(1, -1)).toBe(0.9);
    expect(stepZoom(1.2, 1)).toBe(1.25);
    expect(stepZoom(1.2, -1)).toBe(1.1);
    expect(stepZoom(5, 1)).toBe(5);
    expect(stepZoom(0.25, -1)).toBe(0.25);
  });
});
