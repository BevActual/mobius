import { describe, expect, it } from 'vitest';
import { APP_GROUPS, APPS, askAbout, isAvailable, noteOpened, recentApps, setInstalledApps, withApp, type AppId } from './apps';

describe('apps', () => {
  it('the ask box names what is open in each app, not another app’s things', () => {
    expect(askAbout('mail')).toBe('Ask about your mail');
    expect(askAbout('browser')).toBe('Ask about this page');
    expect(askAbout('search')).toBe('Ask Mobius');
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
    for (const id of ['browser', 'notes', 'tasks', 'notes', 'gone', 'agent', 'search'] as const) noteOpened(id as AppId);
    expect(recentApps()).toEqual(['search', 'agent', 'notes', 'tasks']);
    expect(recentApps(10)).toEqual(['search', 'agent', 'notes', 'tasks', 'browser']);
    store.set('mobius.apps.recent', '{not json');
    expect(recentApps()).toEqual([]);
  });
});
