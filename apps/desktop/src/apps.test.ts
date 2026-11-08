import { describe, expect, it } from 'vitest';
import { APP_GROUPS, APPS, noteOpened, recentApps } from './apps';

describe('apps', () => {
  it('every app belongs to one of the groups the hub shows', () => {
    for (const app of APPS) expect(APP_GROUPS).toContain(app.group);
  });

  it('remembers the apps opened most recently, newest first, once each, and only ones that can open', () => {
    const store = new Map<string, string>();
    (globalThis as unknown as { window: unknown }).window = {
      localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) },
    };
    expect(recentApps()).toEqual([]);
    for (const id of ['browser', 'notes', 'tasks', 'notes', 'code', 'agent', 'search'] as const) noteOpened(id);
    expect(recentApps()).toEqual(['search', 'agent', 'notes', 'tasks']);
    expect(recentApps(10)).toEqual(['search', 'agent', 'notes', 'tasks', 'browser']);
    store.set('mobius.apps.recent', '{not json');
    expect(recentApps()).toEqual([]);
  });
});
