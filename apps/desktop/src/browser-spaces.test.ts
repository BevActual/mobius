import { describe, expect, it } from 'vitest';
import type { BrowserTabState } from '@mobius/shared';
import { addFolder, addRoute, addSpace, removeRoute, routeFor, favouriteTab, foldersIn, putInFolder, removeFolder, renameFolder, toggleFolder, inSpace, initialSpaces, readSpaces, removeSpace, staleTabs, syncSpaces, tabToShow, toggleFavourite } from './browser-spaces';

const tab = (id: string, url: string, extra: Partial<BrowserTabState> = {}): BrowserTabState => ({ id, url, title: id, loading: false, canGoBack: false, canGoForward: false, active: false, icon: null, ...extra });
const HOUR = 3_600_000;

describe('browser spaces', () => {
  it('puts new tabs in the current space and forgets closed ones', () => {
    let s = syncSpaces(initialSpaces(), [tab('a', 'https://a.example', { active: true })], 0);
    s = addSpace(s, 'Work');
    s = syncSpaces(s, [tab('a', 'https://a.example'), tab('b', 'https://b.example', { active: true })], 1);
    expect(s.tabSpace).toEqual({ a: 's1', b: s.current });
    expect(inSpace(s, [tab('a', ''), tab('b', '')]).map((t) => t.id)).toEqual(['b']);
    s = syncSpaces(s, [tab('b', 'https://b.example', { active: true })], 2);
    expect(Object.keys(s.tabSpace)).toEqual(['b']);
  });

  it('follows the shown tab into its space', () => {
    let s = syncSpaces(initialSpaces(), [tab('a', '', { active: true })], 0);
    s = addSpace(s, 'Work');
    expect(s.current).not.toBe('s1');
    s = syncSpaces(s, [tab('a', '', { active: true })], 1);
    expect(s.current).toBe('s1');
  });

  it('gives back the same state when nothing changed', () => {
    const tabs = [tab('a', '', { active: true }), tab('b', '')];
    const s = syncSpaces(initialSpaces(), tabs, 5);
    expect(syncSpaces(s, tabs, 5)).toBe(s);
  });

  it('clears Today tabs left unseen too long, never pinned, shown or Mobius tabs', () => {
    const tabs = [tab('a', '', { active: true }), tab('b', ''), tab('c', '', { pinned: true }), tab('d', '', { driver: 'reading' })];
    const s = syncSpaces(initialSpaces(), tabs, 0);
    expect(staleTabs(s, tabs, 11 * HOUR)).toEqual([]);
    expect(staleTabs(s, tabs, 13 * HOUR)).toEqual(['b']);
    expect(staleTabs({ ...s, clearAfter: null }, tabs, 100 * HOUR)).toEqual([]);
  });

  it('goes back to the tab seen last in a space', () => {
    let s = syncSpaces(initialSpaces(), [tab('a', '', { active: true }), tab('b', '')], 0);
    s = syncSpaces(s, [tab('a', ''), tab('b', '', { active: true })], 5);
    expect(tabToShow(s, [tab('a', ''), tab('b', '')], 's1')).toBe('b');
    expect(tabToShow(s, [], 's1')).toBeNull();
    // Seen at the same moment, the one shown last still wins.
    const t = syncSpaces(syncSpaces(initialSpaces(), [tab('a', ''), tab('b', '', { active: true })], 0), [tab('a', ''), tab('b', '')], 0);
    expect(tabToShow(t, [tab('a', ''), tab('b', '')], 's1')).toBe('b');
  });

  it('moves a removed space’s tabs to the first space, and keeps the last space', () => {
    let s = addSpace(syncSpaces(initialSpaces(), [], 0), 'Work');
    const work = s.current;
    s = syncSpaces(s, [tab('a', '', { active: true })], 0);
    s = removeSpace(s, work);
    expect(s.tabSpace.a).toBe('s1');
    expect(s.current).toBe('s1');
    expect(removeSpace(s, 's1')).toBe(s);
  });

  it('keeps favourites across spaces and finds their open tab', () => {
    let s = toggleFavourite(initialSpaces(), { url: 'https://www.github.com/', title: 'GitHub' });
    expect(s.favourites).toHaveLength(1);
    const tabs = [tab('a', 'https://github.com/BevActual/mobius')];
    expect(favouriteTab(s, tabs, 'https://www.github.com/')).toBe('a');
    s = toggleFavourite(s, { url: 'https://github.com', title: '' });
    expect(s.favourites).toHaveLength(0);
  });

  it('reads back what was saved, and starts afresh from anything broken', () => {
    expect(readSpaces('not json')).toEqual(initialSpaces());
    expect(readSpaces(JSON.stringify({ spaces: [{ id: 'x', name: 'X' }], current: 'gone' })).current).toBe('x');
  });

  it('keeps pinned tabs in folders per space; a closed tab leaves its folder, and a deleted folder leaves its tabs pinned', () => {
    const tabs = [tab('a', 'https://a.example', { pinned: true, active: true }), tab('b', 'https://b.example', { pinned: true })];
    let s = syncSpaces(initialSpaces(), tabs, 0);
    s = addFolder(s, ' Work ', ['a']);
    const id = s.folders![0]!.id;
    expect(s.folders).toEqual([{ id, name: 'Work', space: 's1', open: true }]);
    s = renameFolder(toggleFolder(putInFolder(s, 'b', id), id), id, 'Reading');
    expect(foldersIn(s)).toEqual([{ id, name: 'Reading', space: 's1', open: false }]);
    expect(s.tabFolder).toEqual({ a: id, b: id });
    s = syncSpaces(s, [tabs[0]!], 1);
    expect(s.tabFolder).toEqual({ a: id });
    expect(foldersIn(addSpace(s, 'Other'))).toEqual([]);
    expect(putInFolder(s, 'a', null).tabFolder).toEqual({});
    s = removeFolder(s, id);
    expect(s.folders).toEqual([]);
    expect(s.tabFolder).toEqual({});
    const back = readSpaces(JSON.stringify(addFolder(s, 'Kept', ['a'])));
    expect(back.folders?.[0]?.name).toBe('Kept');
    expect(back.tabFolder).toEqual({ a: back.folders?.[0]?.id });
  });

  it('puts pinned tabs back in their folders after a restart, when they come back with new ids', () => {
    let s = syncSpaces(initialSpaces(), [tab('a', 'https://a.example/x', { pinned: true, active: true }), tab('b', 'https://b.example', { pinned: true })], 0);
    s = addFolder(s, 'Work', ['a', 'b']);
    s = syncSpaces(s, [tab('a', 'https://a.example/x', { pinned: true, active: true }), tab('b', 'https://b.example', { pinned: true })], 1);
    const id = s.folders![0]!.id;
    const back = readSpaces(JSON.stringify(s));
    // Before the shell has its tabs, nothing is forgotten.
    expect(syncSpaces(back, [], 2).tabFolder).toEqual({ a: id, b: id });
    const after = syncSpaces(back, [tab('n1', 'https://b.example', { pinned: true, active: true }), tab('n2', 'https://a.example/x', { pinned: true }), tab('n3', 'https://a.example/x')], 2);
    expect(after.tabFolder).toEqual({ n1: id, n2: id });
    expect(after.folderUrl).toEqual({ n1: 'https://b.example', n2: 'https://a.example/x' });
  });

  it('sends a new tab on a routed site to its space and shows that space, as Arc\'s Air Traffic Control; old tabs stay put', () => {
    let s = syncSpaces(initialSpaces(), [tab('a', 'https://a.example', { active: true })], 0);
    s = addSpace(s, 'Work');
    const work = s.current;
    s = { ...s, current: 's1' };
    s = addRoute(s, 'https://www.example.com/inbox', work);
    expect(s.routes).toEqual([{ host: 'example.com', space: work }]);
    expect(routeFor(s, 'https://mail.example.com/x')).toBe(work);
    expect(routeFor(s, 'https://notexample.com')).toBeNull();
    s = syncSpaces(s, [tab('a', 'https://a.example'), tab('b', 'https://example.com/doc', { active: true })], 1);
    expect(s.tabSpace).toEqual({ a: 's1', b: work });
    expect(s.current).toBe(work);
    // A tab already placed is not moved by a route, nor a new tab with no address yet.
    s = { ...s, current: 's1' };
    s = syncSpaces(s, [tab('a', 'https://example.com/later', { active: true }), tab('b', 'https://example.com/doc'), tab('c', '')], 2);
    expect(s.tabSpace).toEqual({ a: 's1', b: work, c: 's1' });
    // The shell opens a tab with no address and then loads it: its first address routes it. A start page (not a web
    // address) or what is typed into it later does not.
    s = { ...s, current: 's1' };
    const base = [tab('a', 'https://example.com/later'), tab('b', 'https://example.com/doc')];
    s = syncSpaces(s, [...base, tab('d', '', { active: true }), tab('e', '')], 3);
    expect(s.tabSpace.d).toBe('s1');
    s = syncSpaces(s, [...base, tab('d', 'https://docs.example.com/x', { active: true }), tab('e', 'mobius://start')], 4);
    expect(s.tabSpace.d).toBe(work);
    expect(s.current).toBe(work);
    s = syncSpaces({ ...s, current: 's1' }, [...base, tab('d', 'https://docs.example.com/x'), tab('e', 'https://example.com/typed', { active: true })], 5);
    expect(s.tabSpace.e).toBe('s1');
    // A tab the person opened themselves (New tab), first seen empty, stays where they are whatever they type.
    s = syncSpaces({ ...s, current: 's1' }, [...base, tab('f', '', { active: true })], 6, new Set(['f']));
    s = syncSpaces(s, [...base, tab('f', 'https://example.com/typed', { active: true })], 7, new Set(['f']));
    expect(s.tabSpace.f).toBe('s1');
    // A blank tab left open for a while and typed into later stays where it is.
    s = syncSpaces({ ...s, current: 's1' }, [...base, tab('g', '', { active: true })], 10);
    s = syncSpaces(s, [...base, tab('g', 'https://example.com/later', { active: true })], 60_000);
    expect(s.tabSpace.g).toBe('s1');
    expect(s.unplaced).toEqual({});
    expect(removeRoute(s, 'example.com').routes).toEqual([]);
    expect(removeSpace(s, work).routes).toEqual([]);
    expect(readSpaces(JSON.stringify(s)).routes).toEqual([{ host: 'example.com', space: work }]);
  });
});
