import { describe, expect, it } from 'vitest';
import { findInSources, registerLauncherSource, sourceCommands } from './launcher-sources';
import type { FoundItem } from './Launcher';

const item = (id: string, app: FoundItem['app'] = 'notes'): FoundItem => ({ id, app, label: id, run: () => {} });

describe('launcher sources', () => {
  it('finds in every source after what was found first, and stops asking one once it is taken away', () => {
    const off = registerLauncherSource({ app: 'notes', find: (q) => [item(`note ${q}`)] });
    const off2 = registerLauncherSource({ app: 'mail', find: () => [item('mail', 'mail')] });
    expect((findInSources('plan', [item('first')]) as FoundItem[]).map((i) => i.id)).toEqual(['first', 'note plan', 'mail']);
    off2();
    expect((findInSources('plan') as FoundItem[]).map((i) => i.id)).toEqual(['note plan']);
    off();
    expect(findInSources('plan')).toEqual([]);
  });

  it('waits for a source that answers later, and one that fails adds nothing', async () => {
    const offs = [
      registerLauncherSource({ app: 'notes', find: () => [item('now')] }),
      registerLauncherSource({ app: 'mail', find: async () => [item('later', 'mail')] }),
      registerLauncherSource({ app: 'files', find: () => Promise.reject(new Error('down')) }),
      registerLauncherSource({ app: 'tasks', find: () => { throw new Error('broken'); } }),
    ];
    const found = findInSources('x');
    expect(found).toBeInstanceOf(Promise);
    expect((await found).map((i) => i.id)).toEqual(['now', 'later']);
    offs.forEach((off) => off());
  });

  it('cancels the question before when a new one is asked', () => {
    const signals: AbortSignal[] = [];
    const off = registerLauncherSource({ app: 'notes', find: (_q, signal) => { signals.push(signal); return []; } });
    findInSources('p');
    findInSources('pl');
    expect(signals.map((s) => s.aborted)).toEqual([true, false]);
    off();
  });

  it('adds each source\'s commands under its app, once by name', () => {
    const off = registerLauncherSource({ app: 'calendar', commands: () => [{ id: 'new', label: 'New event', run: () => {} }, { id: 'dup', label: 'Settings', run: () => {} }] });
    const all = sourceCommands([{ id: 'settings', label: 'Settings', run: () => {} }]);
    expect(all.map((c) => [c.id, c.label, 'detail' in c ? c.detail : undefined])).toEqual([['settings', 'Settings', undefined], ['calendar-new', 'New event', 'Calendar']]);
    off();
  });
});

describe('commands that read the line', () => {
  it('come before what was found', () => {
    const off = registerLauncherSource({ app: 'calendar', find: () => [{ id: 'e', app: 'calendar', label: 'Add event “lunch”', fields: [{ label: 'Title', value: 'lunch' }], run: () => {} }] });
    const found = findInSources('event lunch', [{ id: 'x', app: 'notes', label: 'Lunch spots', run: () => {} }]);
    off();
    expect((found as readonly FoundItem[]).map((f) => f.id)).toEqual(['e', 'x']);
  });
});
