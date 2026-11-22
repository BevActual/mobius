import { describe, expect, it } from 'vitest';
import type { ConversationInfo } from '@mobius/shared';
import { nameOf, restingOf } from './Resting';

const c = (id: string, updated: number, more: Partial<ConversationInfo> = {}): ConversationInfo => ({ id, title: id, updated_ms: updated, messages: 2, activity: 'idle', waiting: 0, ...more });

describe('the resting panel', () => {
  it('puts chats that need you first, then the latest chat for its changes, then earlier chats', () => {
    const list = [c('a', 1), c('b', 5, { waiting: 1 }), c('here', 9), c('d', 4), c('e', 3), c('f', 2), c('empty', 8, { messages: 0 })];
    const r = restingOf(list, 'here');
    expect(r.needsYou.map((x) => x.id)).toEqual(['b']);
    expect(r.latest?.id).toBe('d');
    expect(r.earlier.map((x) => x.id)).toEqual(['d', 'e', 'f']);
  });
  it('skips a chat that is still working for the changes', () => {
    expect(restingOf([c('w', 9, { activity: 'working' }), c('x', 5)], 'here').latest?.id).toBe('x');
  });
});

describe('nameOf', () => {
  it('names the first person a reply goes to, by name where it has one', () => {
    expect(nameOf('"Priya Nair" <priya@northway.example>, sam@example.com')).toBe('Priya Nair');
    expect(nameOf('Priya Nair <priya@northway.example>')).toBe('Priya Nair');
    expect(nameOf('priya@northway.example')).toBe('priya@northway.example');
    expect(nameOf('')).toBe('someone');
  });
});
