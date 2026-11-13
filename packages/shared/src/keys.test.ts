import { describe, expect, it } from 'vitest';
import {
  DEFAULT_KEYBINDINGS, SHORTCUT_ACTIONS, actionForPress, comboOfPress, comboProblem, conflictFor, describeCombo, formatCombo, isBinding, isKeyBindings, parseCombo, toAccelerator,
  type KeyPress,
} from './keys';

const press = (code: string, extra: Partial<KeyPress> = {}): KeyPress => ({ code, ctrl: false, meta: false, alt: false, shift: false, ...extra });

describe('combinations', () => {
  it('are written one way, whatever the order they were pressed in', () => {
    expect(formatCombo(parseCombo('mod+shift+k')!)).toBe('mod+shift+k');
    for (const bad of ['shift+mod+k', 'k+mod', 'mod+mod+k', 'ctrl+k', 'mod+', '+k', 'mod+kk', 'MOD+K', 'mod+K', ' mod+k', 'mod+k ', 'mod+alt+alt+k', '', 'mod+enter', 'mod+escape', 'mod+tab']) {
      expect(parseCombo(bad), bad).toBeNull();
    }
    for (const bad of [undefined, null, 3, {}, [], 'x'.repeat(100)]) expect(parseCombo(bad)).toBeNull();
    expect(parseCombo('mod+,')).toMatchObject({ mod: true, key: ',' });
    expect(parseCombo('alt+f4')).toMatchObject({ alt: true, key: 'f4' });
    expect(parseCombo('mod+alt+space')).toMatchObject({ mod: true, alt: true, key: 'space' });
  });

  it('need Control or Alt, unless they are a function key, and never take copy, paste or undo', () => {
    expect(isBinding('k')).toBe(false);
    expect(isBinding('shift+k')).toBe(false);
    expect(isBinding('space')).toBe(false);
    expect(isBinding('f5')).toBe(true);
    expect(isBinding('alt+k')).toBe(true);
    for (const key of ['c', 'v', 'x', 'a', 'z', 'y']) {
      expect(isBinding(`mod+${key}`), key).toBe(false);
      expect(isBinding(`mod+shift+${key}`), key).toBe(false);
      expect(comboProblem(parseCombo(`mod+${key}`)!)).toMatch(/copy, paste and undo/);
    }
    expect(isBinding('mod+alt+c')).toBe(true);
    expect(isBinding('alt+c')).toBe(true);
    expect(isBinding('')).toBe(true);
  });

  it('are taken from the physical key, so Alt, Shift and the layout change nothing', () => {
    expect(comboOfPress(press('KeyK', { ctrl: true }))).toEqual({ mod: true, alt: false, shift: false, key: 'k' });
    expect(comboOfPress(press('KeyK', { meta: true }))).toEqual({ mod: true, alt: false, shift: false, key: 'k' });
    expect(comboOfPress(press('KeyK', { ctrl: true, alt: true, shift: true }))).toEqual({ mod: true, alt: true, shift: true, key: 'k' });
    expect(comboOfPress(press('Digit1', { ctrl: true }))?.key).toBe('1');
    expect(comboOfPress(press('Comma', { ctrl: true }))?.key).toBe(',');
    expect(comboOfPress(press('Space', { alt: true }))?.key).toBe('space');
    expect(comboOfPress(press('F12'))?.key).toBe('f12');
    for (const code of ['ControlLeft', 'ShiftLeft', 'AltRight', 'MetaLeft', 'Enter', 'Escape', 'Tab', 'F13', 'Numpad1', '', 'KeyKK']) expect(comboOfPress(press(code, { ctrl: true })), code).toBeNull();
  });

  it('are matched exactly: an extra Shift or Alt is a different shortcut', () => {
    expect(actionForPress(DEFAULT_KEYBINDINGS, press('KeyK', { ctrl: true }))).toBe('launcher');
    expect(actionForPress(DEFAULT_KEYBINDINGS, press('KeyK', { meta: true }))).toBe('launcher');
    expect(actionForPress(DEFAULT_KEYBINDINGS, press('KeyK', { ctrl: true, shift: true }))).toBeNull();
    expect(actionForPress(DEFAULT_KEYBINDINGS, press('KeyK', { ctrl: true, alt: true }))).toBeNull();
    expect(actionForPress(DEFAULT_KEYBINDINGS, press('KeyK'))).toBeNull();
    expect(actionForPress(DEFAULT_KEYBINDINGS, press('Comma', { ctrl: true }))).toBe('settings');
    expect(actionForPress({ ...DEFAULT_KEYBINDINGS, launcher: 'mod+j' }, press('KeyK', { ctrl: true }))).toBeNull();
    expect(actionForPress({ ...DEFAULT_KEYBINDINGS, launcher: 'mod+j' }, press('KeyJ', { ctrl: true }))).toBe('launcher');
  });

  it('left unbound match nothing, not even a press that makes no combination', () => {
    expect(actionForPress(DEFAULT_KEYBINDINGS, press('ControlLeft', { ctrl: true }))).toBeNull();
    expect(DEFAULT_KEYBINDINGS.quickEntry).toBe('');
  });
});

describe('a set of bindings', () => {
  it('is acceptable when complete, well formed and without two actions on one combination', () => {
    expect(isKeyBindings(DEFAULT_KEYBINDINGS)).toBe(true);
    expect(isKeyBindings({ ...DEFAULT_KEYBINDINGS, launcher: '' })).toBe(true);
    expect(isKeyBindings({ ...DEFAULT_KEYBINDINGS, launcher: 'mod+j', quickEntry: 'mod+alt+space' })).toBe(true);
    expect(isKeyBindings({ ...DEFAULT_KEYBINDINGS, launcher: 'mod+l' }), 'two on one combination').toBe(false);
    expect(isKeyBindings({ ...DEFAULT_KEYBINDINGS, launcher: 'k' })).toBe(false);
    expect(isKeyBindings({ ...DEFAULT_KEYBINDINGS, launcher: 'mod+c' })).toBe(false);
    expect(isKeyBindings({ ...DEFAULT_KEYBINDINGS, launcher: 3 })).toBe(false);
    const { find: _find, ...missing } = DEFAULT_KEYBINDINGS;
    expect(isKeyBindings(missing)).toBe(false);
    expect(isKeyBindings({ ...DEFAULT_KEYBINDINGS, extra: 'mod+j' })).toBe(false);
    for (const bad of [null, undefined, 'mod+k', [], 3]) expect(isKeyBindings(bad)).toBe(false);
  });

  it('names the other action that already has a combination', () => {
    expect(conflictFor(DEFAULT_KEYBINDINGS, 'find', 'mod+k')).toBe('launcher');
    expect(conflictFor(DEFAULT_KEYBINDINGS, 'launcher', 'mod+k')).toBeNull();
    expect(conflictFor(DEFAULT_KEYBINDINGS, 'find', '')).toBeNull();
    expect(conflictFor(DEFAULT_KEYBINDINGS, 'find', 'mod+j')).toBeNull();
  });

  it('has the defaults it always had, all valid and all different', () => {
    expect(SHORTCUT_ACTIONS).toHaveLength(10);
    expect(DEFAULT_KEYBINDINGS).toMatchObject({ launcher: 'mod+k', address: 'mod+l', newTab: 'mod+t', closeTab: 'mod+w', settings: 'mod+,', find: 'mod+f', splitView: 'mod+\\', littleMobius: 'mod+shift+m', holdToTalk: 'mod+space' });
    expect(isKeyBindings(DEFAULT_KEYBINDINGS)).toBe(true);
  });
});

describe('how they are shown and handed to the system', () => {
  it('reads as Ctrl on Windows and Linux and Cmd on a Mac', () => {
    expect(describeCombo('mod+shift+k', 'win32')).toBe('Ctrl+Shift+K');
    expect(describeCombo('mod+alt+space', 'darwin')).toBe('Cmd+Option+Space');
    expect(describeCombo('H', 'win32')).toBe('H');
    expect(describeCombo('mod+,', 'linux')).toBe('Ctrl+,');
    expect(describeCombo('f5', 'win32')).toBe('F5');
    expect(describeCombo('nonsense', 'win32')).toBe('');
  });

  it('is written for Electron global shortcuts', () => {
    expect(toAccelerator('mod+alt+space')).toBe('CommandOrControl+Alt+Space');
    expect(toAccelerator('mod+shift+k')).toBe('CommandOrControl+Shift+K');
    expect(toAccelerator('alt+f4')).toBe('Alt+F4');
    expect(toAccelerator('mod+,')).toBe('CommandOrControl+,');
    expect(toAccelerator('')).toBeNull();
    expect(toAccelerator('k')).toBeNull();
  });
});
