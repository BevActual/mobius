import { describe, expect, it } from 'vitest';
import { actionForPress, DEFAULT_KEYBINDINGS } from '@mobius/shared';
import { EARLY_KEEP, EARLY_KEEP_MS, keepEarly, stillFresh } from './early-keys';

const press = (code: string, mods: Partial<{ ctrl: boolean; meta: boolean; alt: boolean; shift: boolean }> = {}) => ({ code, ctrl: false, meta: false, alt: false, shift: false, ...mods });

describe('shortcuts pressed before the saved ones are read', () => {
  it('keeps presses with Ctrl, Cmd or Alt, and leaves typing alone', () => {
    let kept = keepEarly([], press('KeyA'), 0);
    kept = keepEarly(kept, press('KeyK', { ctrl: true }), 10);
    kept = keepEarly(kept, press('KeyP', { meta: true }), 20);
    kept = keepEarly(kept, press('KeyS', { alt: true, ctrl: true }), 30);
    expect(stillFresh(kept, 100).map((p) => p.code)).toEqual(['KeyK', 'KeyP', 'KeyS']);
  });

  it('keeps only the last few, and only fresh ones', () => {
    let kept: ReturnType<typeof keepEarly> = [];
    for (let i = 0; i < EARLY_KEEP + 2; i++) kept = keepEarly(kept, press(`Digit${i}`, { ctrl: true }), i * 1000);
    expect(kept).toHaveLength(EARLY_KEEP);
    const now = (EARLY_KEEP + 1) * 1000;
    expect(stillFresh(kept, now).every((p) => p.code >= `Digit${EARLY_KEEP + 1 - EARLY_KEEP_MS / 1000}`)).toBe(true);
    expect(stillFresh(kept, now)).toHaveLength(EARLY_KEEP_MS / 1000 + 1);
  });

  it('is answered with the saved bindings: a moved key does not reach its old default', () => {
    const saved = { ...DEFAULT_KEYBINDINGS, launcher: 'mod+j' };
    const early = stillFresh(keepEarly(keepEarly([], press('KeyK', { ctrl: true }), 0), press('KeyJ', { ctrl: true }), 5), 10);
    expect(early.map((p) => actionForPress(saved, p))).toEqual([null, 'launcher']);
    expect(early[0]).toEqual(press('KeyK', { ctrl: true }));
  });
});
