import { describe, expect, it } from 'vitest';
import { MAX_SHARE, MIN_SHARE, clampShare, companionFor, loadPanes, savePanes } from './split';

describe('split view', () => {
  it('keeps the divider within reach of both panes', () => {
    expect(clampShare(0.5)).toBe(0.5);
    expect(clampShare(0)).toBe(MIN_SHARE);
    expect(clampShare(1)).toBe(MAX_SHARE);
  });
  it('opens the browser beside other apps, and notes beside the browser', () => {
    expect(companionFor('browser')).toBe('notes');
    expect(companionFor('notes')).toBe('browser');
    expect(companionFor('agent')).toBe('browser');
  });
});

describe('where Mobius opens', () => {
  const store = new Map<string, string>();
  (globalThis as unknown as { window: unknown }).window = {
    localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) },
  };
  it('opens the app, or the pair, that was showing', () => {
    savePanes(['notes', 'browser']);
    expect(loadPanes()).toEqual(['notes', 'browser']);
    savePanes(['tasks', null]);
    expect(loadPanes()).toEqual(['tasks', null]);
  });
  it('starts in the browser when what was kept makes no sense', () => {
    for (const bad of ['["notes","notes"]', '["notes","code"]', '["code",null]', '"browser"', '{', '["agent"]']) {
      store.set('mobius.split.panes', bad);
      expect(loadPanes(), bad).toEqual(['browser', null]);
    }
  });
});
