import { describe, expect, it } from 'vitest';
import { APPS, appName, findApp, isAvailable } from './apps';

describe('the applications in the launcher', () => {
  it('lists the built apps (Browser, Agent, Notes, Tasks, Search) in that order, ahead of the unbuilt ones', () => {
    expect(APPS.slice(0, 5).map((app) => [app.id, app.available])).toEqual([['browser', true], ['agent', true], ['notes', true], ['tasks', true], ['search', true]]);
    expect(APPS.slice(5).every((app) => !app.available)).toBe(true);
  });
  it('has unique ids and names', () => {
    expect(new Set(APPS.map((a) => a.id)).size).toBe(APPS.length);
    expect(new Set(APPS.map((a) => a.name)).size).toBe(APPS.length);
  });
  it('finds an app by id, and refuses to open one that is not built', () => {
    expect(findApp('agent')?.name).toBe('Agent');
    expect(findApp('nope')).toBeUndefined();
    expect(isAvailable('browser')).toBe(true);
    expect(isAvailable('notes')).toBe(true);
    expect(isAvailable('documents')).toBe(false);
    expect(isAvailable('nope')).toBe(false);
    expect(appName('agent')).toBe('Agent');
  });
});
