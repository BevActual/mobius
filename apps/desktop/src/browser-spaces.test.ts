import { describe, expect, it } from 'vitest';
import type { BrowserTabState } from '@mobius/shared';
import { addFolder, addSpace, favouriteTab, foldersIn, putInFolder, removeFolder, renameFolder, toggleFolder, inSpace, initialSpaces, readSpaces, removeSpace, staleTabs, syncSpaces, tabToShow, toggleFavourite } from './browser-spaces';

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
});
