import { describe, expect, it } from 'vitest';
import { actionKey } from './ActionsSlot';

const key = (k: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, ...mods });

describe('number keys for actions', () => {
  it('pick 1 to 4 when nothing is being typed', () => {
    expect(actionKey(key('1'), false)).toBe(1);
    expect(actionKey(key('4'), false)).toBe(4);
    expect(actionKey(key('5'), false)).toBeNull();
  });
  it('leave typing and shortcuts alone', () => {
    expect(actionKey(key('2'), true)).toBeNull();
    expect(actionKey(key('2', { ctrlKey: true }), false)).toBeNull();
  });
});
