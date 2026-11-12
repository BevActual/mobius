import { describe, expect, it } from 'vitest';
import type { ConversationInfo } from '@mobius/shared';
import { trayShown } from './tray';

const c = (id: string, activity: ConversationInfo['activity'], waiting = 0): ConversationInfo => ({ id, title: id.toUpperCase(), updated_ms: 0, messages: 1, activity, waiting });

describe('the tray print', () => {
  it('puts what needs you first, then work, then a turn that ended while you were away', () => {
    expect(trayShown([c('a', 'idle')], false)).toEqual({ state: 'idle', tooltip: 'Mobius', items: [] });
    expect(trayShown([c('a', 'idle')], true).state).toBe('done');
    const busy = trayShown([c('a', 'working'), c('b', 'idle')], true);
    expect(busy).toMatchObject({ state: 'working', tooltip: 'Mobius is working: A', items: [{ id: 'a', status: 'Working' }] });
    const needs = trayShown([c('a', 'working'), c('b', 'idle', 1)], false);
    expect(needs.state).toBe('needs');
    expect(needs.items.map((i) => [i.id, i.status])).toEqual([['b', 'Needs you'], ['a', 'Working']]);
  });
});
