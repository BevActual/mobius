import { describe, expect, it } from 'vitest';
import { rankApps } from './Launcher';

describe('launcher', () => {
  it('offers the apps used last first, and names that start with what was typed before others', () => {
    const apps = [{ id: 'browser', name: 'Browser' }, { id: 'notes', name: 'Notes' }, { id: 'reader', name: 'Reader' }, { id: 'research', name: 'Research' }] as const;
    expect(rankApps(apps, '', ['research', 'notes']).map((a) => a.id)).toEqual(['research', 'notes', 'browser', 'reader']);
    expect(rankApps(apps.filter((a) => a.name.toLowerCase().includes('re')), 're', []).map((a) => a.id)).toEqual(['reader', 'research']);
    expect(rankApps([{ id: 'browser', name: 'Browser' }, { id: 'reader', name: 'Reader' }] as const, 'r', []).map((a) => a.id)).toEqual(['reader', 'browser']);
  });
});

import { frequentSites } from './StartPage';
describe('start page', () => {
  it('offers the sites visited most, once each', () => {
    const h = (url: string) => ({ url, title: url, at: 0 });
    expect(frequentSites([h('https://a.example/1'), h('https://www.b.example/'), h('https://a.example/2'), h('mobius:x')] as never).map((s) => s.site)).toEqual(['a.example', 'b.example']);
  });
});

import { pinnedApps, stepFrom, type LauncherItem } from './Launcher';
describe('launcher with nothing typed', () => {
  const kinds: LauncherItem['kind'][] = ['ask', 'pinned', 'pinned', 'pinned', 'recent', 'recent', 'place', 'place'];
  it('moves along the rows across and between rows, keeping the place in a row', () => {
    expect(stepFrom(kinds, 0, 'ArrowDown')).toBe(1);
    expect(stepFrom(kinds, 2, 'ArrowRight')).toBe(3);
    expect(stepFrom(kinds, 3, 'ArrowRight')).toBe(3);
    expect(stepFrom(kinds, 3, 'ArrowDown')).toBe(4);
    expect(stepFrom(kinds, 4, 'ArrowUp')).toBe(1);
    expect(stepFrom(kinds, 5, 'ArrowDown')).toBe(6);
    expect(stepFrom(kinds, 7, 'ArrowDown')).toBe(0);
    expect(stepFrom(kinds, 0, 'ArrowUp')).toBe(6);
    expect(stepFrom(kinds, 4, 'ArrowLeft')).toBe(4);
  });
  it('pins each app once, leaves Home to the places, and starts with the everyday apps', () => {
    expect(pinnedApps(['mail', 'agent', 'mail', 'notes'])).toEqual(['mail', 'notes']);
    expect(pinnedApps()).toContain('mail');
  });
});
