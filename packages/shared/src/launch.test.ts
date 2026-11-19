import { describe, expect, it } from 'vitest';
import { parseLaunchChoice, parseLauncherAnswer } from './ipc';

describe('a choice from the launcher window', () => {
  it('is read when it is well formed', () => {
    expect(parseLaunchChoice({ kind: 'app', app: 'notes' })).toEqual({ kind: 'app', app: 'notes' });
    expect(parseLaunchChoice({ kind: 'place', place: 'settings' })).toEqual({ kind: 'place', place: 'settings' });
    expect(parseLaunchChoice({ kind: 'ask-about', app: 'mail', label: 'Invoice', detail: 'From Sam' })).toEqual({ kind: 'ask-about', app: 'mail', label: 'Invoice', detail: 'From Sam' });
    expect(parseLaunchChoice({ kind: 'new-tab' })).toEqual({ kind: 'new-tab' });
  });

  it('is ignored when it is anything else', () => {
    for (const bad of [null, 'app', { kind: 'app' }, { kind: 'place', place: 'elsewhere' }, { kind: 'ask-about', app: 'mail', label: '' }, { kind: 'run', code: 'x' }, { kind: 'app', app: 'x'.repeat(41) }]) {
      expect(parseLaunchChoice(bad)).toBeNull();
    }
  });
});

describe('the main window\'s answer to the launcher window', () => {
  it('reads found items and commands by id, and chooses them by id', () => {
    expect(parseLaunchChoice({ kind: 'found', id: 'notes:a' })).toEqual({ kind: 'found', id: 'notes:a' });
    expect(parseLaunchChoice({ kind: 'command', id: 'file-new' })).toEqual({ kind: 'command', id: 'file-new' });
    expect(parseLaunchChoice({ kind: 'command', id: '' })).toBeNull();
    expect(parseLauncherAnswer({ items: [{ id: 'notes:a', app: 'notes', label: 'Plan', detail: 'Notes' }], commands: [{ id: 'c', label: 'Compose' }] }))
      .toEqual({ items: [{ id: 'notes:a', app: 'notes', label: 'Plan', detail: 'Notes' }], commands: [{ id: 'c', label: 'Compose' }] });
  });

  it('leaves out what is malformed', () => {
    expect(parseLauncherAnswer(null)).toEqual({ items: [], commands: [] });
    expect(parseLauncherAnswer({ items: [{ id: 'x', label: 'No app' }, { app: 'notes', label: 'No id' }, 'row'], commands: [{ id: 'c' }, { id: 'd', label: 'D', app: 'notes' }] }))
      .toEqual({ items: [], commands: [{ id: 'd', label: 'D' }] });
  });
});
