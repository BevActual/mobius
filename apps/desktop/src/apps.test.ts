import { describe, expect, it } from 'vitest';
import { APP_GROUPS, APPS, askAbout, isAvailable, isListed, noteOpened, recentApps, setInstalledApps, withApp, type AppId } from './apps';

describe('apps', () => {
  it('the ask box names what is open in each app, not another app’s things', () => {
    expect(askAbout('mail')).toBe('Ask about your mail');
    expect(askAbout('browser')).toBe('Ask about this page');
    expect(askAbout('agent')).toBe('Ask Mobius');
    expect(askAbout('docs', false)).toBe('Ask Mobius');
    expect(askAbout('mail', false)).toBe('Ask about your mail');
  });

  it('only added apps open; Home and Mobius’s own apps are always there, and an install from before keeps every app', () => {
    setInstalledApps(['notes']);
    expect(isAvailable('notes')).toBe(true);
    expect(isAvailable('photo')).toBe(false);
    expect(isAvailable('agent') && isAvailable('skills') && isAvailable('files')).toBe(true);
    expect(withApp('photo', true)).toEqual(['notes', 'photo']);
    expect(withApp('notes', false)).toEqual([]);
    setInstalledApps(null);
    expect(isAvailable('photo')).toBe(true);
  });

  it('every app belongs to one of the groups the hub shows', () => {
    for (const app of APPS) expect(APP_GROUPS).toContain(app.group);
  });

  it('remembers the apps opened most recently, newest first, once each, and only ones that can open', () => {
    const store = new Map<string, string>();
    (globalThis as unknown as { window: unknown }).window = {
      localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) },
    };
    expect(recentApps()).toEqual([]);
    for (const id of ['browser', 'notes', 'tasks', 'notes', 'gone', 'agent', 'files'] as const) noteOpened(id as AppId);
    expect(recentApps()).toEqual(['files', 'agent', 'notes', 'tasks']);
    expect(recentApps(10)).toEqual(['files', 'agent', 'notes', 'tasks', 'browser']);
    store.set('mobius.apps.recent', '{not json');
    expect(recentApps()).toEqual([]);
  });
});

import { noteRecentItem, recentItems } from './apps';
describe('recent items', () => {
  it('keeps the things opened last, newest first, once each', () => {
    const store = new Map<string, string>();
    (globalThis as { window?: unknown }).window ??= {};
    (globalThis.window as unknown as { localStorage: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) };
    noteRecentItem({ app: 'notes', ref: 'a', label: 'Garden plan' }, 1);
    noteRecentItem({ app: 'mail', ref: 'b', label: 'Quote' }, 2);
    noteRecentItem({ app: 'notes', ref: 'a', label: 'Garden plan' }, 3);
    noteRecentItem({ app: 'notes', ref: 'c', label: '  ' }, 4);
    expect(recentItems().map((r) => [r.ref, r.at])).toEqual([['a', 3], ['b', 2]]);
  });

  it('Reader is the Browser’s reader mode: not listed on its own, there whenever the Browser is', () => {
    const reader = APPS.find((a) => a.id === 'reader')!;
    expect(isListed(reader)).toBe(false);
    setInstalledApps(['browser']);
    expect(isAvailable('reader')).toBe(true);
    expect(withApp('notes', true)).not.toContain('reader');
    setInstalledApps(['notes']);
    expect(isAvailable('reader')).toBe(false);
    setInstalledApps(null);
  });
});
