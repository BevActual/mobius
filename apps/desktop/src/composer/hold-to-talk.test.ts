import { describe, expect, it } from 'vitest';
import { DEFAULT_KEYBINDINGS } from '@mobius/shared';
import { holdsHere, isHoldToTalk } from './hold-to-talk';

const press = (code: string, mods: Partial<{ ctrl: boolean; meta: boolean; alt: boolean; shift: boolean }> = {}) => ({ code, ctrl: false, meta: false, alt: false, shift: false, ...mods });

/** A tiny stand-in for elements: each knows its parent and its class. */
interface Fake { parent: Fake | null; cls: string }
const el = (parent: Fake | null, cls = ''): Fake => ({ parent, cls });
const asElement = (f: Fake): Element => ({
  fake: f,
  contains: (other: Element) => { let at: Fake | null = (other as unknown as { fake: Fake }).fake; while (at) { if (at === f) return true; at = at.parent; } return false; },
  closest: (selector: string) => { let at: Fake | null = f; while (at) { if (`.${at.cls}` === selector) return asElement(at); at = at.parent; } return null; },
}) as unknown as Element;

describe('hold to talk', () => {
  it('is Ctrl+Space (Cmd+Space on a Mac) by default, with nothing else held', () => {
    expect(isHoldToTalk(DEFAULT_KEYBINDINGS, press('Space', { ctrl: true }))).toBe(true);
    expect(isHoldToTalk(DEFAULT_KEYBINDINGS, press('Space', { meta: true }))).toBe(true);
    expect(isHoldToTalk(DEFAULT_KEYBINDINGS, press('Space'))).toBe(false);
    expect(isHoldToTalk(DEFAULT_KEYBINDINGS, press('Space', { ctrl: true, shift: true }))).toBe(false);
    expect(isHoldToTalk(DEFAULT_KEYBINDINGS, press('KeyK', { ctrl: true }))).toBe(false);
  });

  it('follows the binding chosen in Settings, Keyboard, and does nothing when it is cleared', () => {
    const moved = { ...DEFAULT_KEYBINDINGS, holdToTalk: 'mod+alt+d' };
    expect(isHoldToTalk(moved, press('KeyD', { ctrl: true, alt: true }))).toBe(true);
    expect(isHoldToTalk(moved, press('Space', { ctrl: true }))).toBe(false);
    expect(isHoldToTalk({ ...DEFAULT_KEYBINDINGS, holdToTalk: '' }, press('Space', { ctrl: true }))).toBe(false);
  });

  it('listens only when the keyboard is in the composer or the Mobius panel around it', () => {
    const page = el(null, 'app');
    const panel = el(page, 'chat');
    const log = el(panel, 'messages');
    const composer = el(panel, 'composer');
    const field = el(composer, 'field');
    const address = el(page, 'address');
    expect(holdsHere(asElement(field), asElement(composer))).toBe(true);
    expect(holdsHere(asElement(log), asElement(composer))).toBe(true);
    expect(holdsHere(asElement(address), asElement(composer))).toBe(false);
    expect(holdsHere(null, asElement(composer))).toBe(false);
  });
});
