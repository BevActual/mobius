import { describe, expect, it } from 'vitest';
import { parseLaunchChoice } from './ipc';

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
