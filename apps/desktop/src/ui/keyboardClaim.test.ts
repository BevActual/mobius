import { describe, expect, it } from 'vitest';
import { claimKeyboardForTests, keyboardClaimed, shellStandsDown } from './keyboardClaim';

const press = (key: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, ...mods });

describe('an app claiming the keyboard', () => {
  it('makes the shell leave bare keys alone, but not Escape or shortcuts with Ctrl, Cmd or Alt', () => {
    expect(shellStandsDown(press('c'))).toBe(false);
    claimKeyboardForTests(true);
    expect(keyboardClaimed()).toBe(true);
    expect(shellStandsDown(press('c'))).toBe(true);
    expect(shellStandsDown(press('1'))).toBe(true);
    expect(shellStandsDown(press('Escape'))).toBe(false);
    expect(shellStandsDown(press('k', { ctrlKey: true }))).toBe(false);
    expect(shellStandsDown(press('k', { metaKey: true }))).toBe(false);
    claimKeyboardForTests(false);
    expect(shellStandsDown(press('c'))).toBe(false);
  });
});
