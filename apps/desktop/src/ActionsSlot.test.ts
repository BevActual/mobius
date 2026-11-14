import { describe, expect, it } from 'vitest';
import { actionKey, actionsShown } from './ActionsSlot';

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

describe('the actions list', () => {
  it('shows four rows at most: the app’s own first, then ideas fill what is left', () => {
    expect(actionsShown(2, 3)).toEqual({ app: 2, ideas: 2 });
    expect(actionsShown(0, 6)).toEqual({ app: 0, ideas: 4 });
    expect(actionsShown(5, 3)).toEqual({ app: 4, ideas: 0 });
    expect(actionsShown(1, 1)).toEqual({ app: 1, ideas: 1 });
  });
});
