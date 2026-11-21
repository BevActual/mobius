import { describe, expect, it } from 'vitest';
import { aliasHit, cleanAlias, comboOf, keyHit, targetOf, withAlias, withKey } from './launcher-shortcuts';

const mail = { type: 'app' as const, ref: 'mail' };
const notes = { type: 'app' as const, ref: 'notes' };
const press = (key: string, code: string, mods: { ctrl?: boolean; alt?: boolean; shift?: boolean } = {}) => ({ key, code, ctrlKey: !!mods.ctrl, altKey: !!mods.alt, shiftKey: !!mods.shift, metaKey: false });

describe('launcher shortcuts', () => {
  it('reads what a row stands for', () => {
    expect(targetOf('pin-mail')).toEqual(mail);
    expect(targetOf('grid-mail')).toEqual(mail);
    expect(targetOf('cmd-new-note')).toEqual({ type: 'command', ref: 'new-note' });
    expect(targetOf('place-settings')).toEqual({ type: 'place', ref: 'settings' });
    expect(targetOf('item-notes-1')).toBeNull();
    expect(targetOf('grid-more')).toBeNull();
    expect(targetOf('alias-command-new-note')).toEqual({ type: 'command', ref: 'new-note' });
  });

  it('keeps one alias per target and moves an alias that was taken', () => {
    let list = withAlias([], mail, 'Mail', 'm');
    expect(aliasHit(list, ' M ')?.label).toBe('Mail');
    list = withAlias(list, notes, 'Notes', 'm');
    expect(aliasHit(list, 'm')?.label).toBe('Notes');
    expect(list.find((s) => s.label === 'Mail')).toBeUndefined();
    list = withAlias(list, notes, 'Notes', null);
    expect(list).toEqual([]);
  });

  it('an alias is one short word', () => {
    expect(cleanAlias(' GH ')).toBe('gh');
    expect(cleanAlias('two words')).toBeNull();
    expect(cleanAlias('a'.repeat(13))).toBeNull();
  });

  it('a key needs two modifiers with Ctrl or Alt, and is named by the key itself', () => {
    expect(comboOf(press('m', 'KeyM', { ctrl: true }))).toBeNull();
    expect(comboOf(press('M', 'KeyM', { ctrl: true, shift: true }))).toBe('Ctrl+Shift+M');
    expect(comboOf(press('µ', 'KeyM', { ctrl: true, alt: true }))).toBe('Ctrl+Alt+M');
    expect(comboOf(press('!', 'Digit1', { alt: true, shift: true }))).toBe('Alt+Shift+1');
    expect(comboOf(press('Control', 'ControlLeft', { ctrl: true, alt: true }))).toBeNull();
    expect(comboOf(press('H', 'KeyH', { ctrl: true, alt: true, shift: true }))).toBeNull();
  });

  it('keeps an alias and a key on the same target', () => {
    let list = withAlias([], mail, 'Mail', 'm');
    list = withKey(list, mail, 'Mail', 'Ctrl+Alt+M');
    expect(keyHit(list, 'Ctrl+Alt+M')).toMatchObject({ label: 'Mail', alias: 'm' });
    list = withKey(list, mail, 'Mail', null);
    expect(aliasHit(list, 'm')?.key).toBeUndefined();
  });
});
