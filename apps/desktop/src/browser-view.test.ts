import { describe, expect, it } from 'vitest';
import type { BrowserTabState } from '@mobius/shared';
import { addressParts, dropPlan, hostOf, suggestionsFor, tileHue, tileLetter } from './browser-view';

const tab = (id: string, url: string, title: string, extra: Partial<BrowserTabState> = {}): BrowserTabState => ({ id, url, title, loading: false, canGoBack: false, canGoForward: false, active: false, icon: null, ...extra });

describe('the address at rest', () => {
  it('shows the site name and whether the connection is private', () => {
    expect(addressParts('https://www.veltro.example/packs?x=1')).toEqual({ secure: true, host: 'veltro.example' });
    expect(addressParts('http://localhost:5173/')).toEqual({ secure: false, host: 'localhost' });
    expect(addressParts('file:///C:/Users/me/Report%201.pdf')).toEqual({ secure: false, host: 'Report 1.pdf' });
  });
  it('leaves anything else as it is', () => {
    expect(addressParts('')).toBeNull();
    expect(addressParts('about:blank')).toBeNull();
    expect(addressParts('mobius://settings')).toBeNull();
    expect(hostOf('not an address')).toBe('not an address');
  });
});

describe('site tiles', () => {
  it('gives a site the same colour and letter every time', () => {
    expect(tileHue('veltro.example')).toBe(tileHue('veltro.example'));
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
