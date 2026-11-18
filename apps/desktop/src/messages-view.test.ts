import { describe, expect, it } from 'vitest';
import type { ChatAccount, ChatChannel, ChatMessage } from '@mobius/shared';
import { catchUpAsk, channelGroups, channelLabel, chatItem, runs, unreadLabel } from './messages-view';

const work: ChatAccount = { id: 'w', service: 'slack', name: 'Northway', status: 'ready' };
const home: ChatAccount = { id: 'h', service: 'discord', name: 'Friends', status: 'ready' };
const ch = (id: string, account: string, kind: ChatChannel['kind'], last: number): ChatChannel => ({ id, account, name: id, kind, unread: 0, mentions: 0, last });
const at = (h: number, m: number, day = 18) => new Date(2026, 10, day, h, m).getTime();
const msg = (id: string, who: string, when: number, text = id, extra: Partial<ChatMessage> = {}): ChatMessage => ({ id, channel: 'general', author: { id: who, name: who === 'me' ? 'Andrew' : who, ...(who === 'me' ? { me: true } : {}) }, text, at: when, ...extra });

describe('Messages', () => {
  it('lists each account with channels first, then groups and direct messages, newest first', () => {
    const groups = channelGroups([work, home], [ch('priya', 'w', 'direct', 9), ch('random', 'w', 'channel', 1), ch('general', 'w', 'channel', 5), ch('games', 'h', 'channel', 2)]);
    expect(groups.map((g) => [g.account.name, g.channels.map((c) => c.id)])).toEqual([['Northway', ['general', 'random', 'priya']], ['Friends', ['games']]]);
    expect(channelLabel({ name: 'general', kind: 'channel' })).toBe('#general');
    expect(channelLabel({ name: 'Priya Nair', kind: 'direct' })).toBe('Priya Nair');
  });

  it('puts one sender’s messages close together in one run', () => {
    const r = runs([msg('a', 'priya', at(9, 0)), msg('b', 'priya', at(9, 3)), msg('c', 'me', at(9, 4)), msg('d', 'priya', at(9, 30)), msg('e', 'priya', at(9, 31, 19))]);
    expect(r.map((x) => x.messages.map((m) => m.id).join(''))).toEqual(['ab', 'c', 'd', 'e']);
  });

  it('attaches the channel as someone else’s words, by day, and asks for a catch-up without sending', () => {
    const general: ChatChannel = { ...ch('general', 'w', 'channel', 0), unread: 3 };
    const item = chatItem(work, general, [msg('a', 'priya', at(9, 5), 'Build is red\nagain'), msg('b', 'me', at(9, 7), 'Looking', { thread: 'a' })]);
    expect(item).toEqual({ kind: 'file', title: '#general · Slack', source: 'messages:w/general', text: '## 2026-11-18\n[09:05] priya: Build is red again\n[09:07] Andrew (me) (in a thread): Looking' });
    expect(catchUpAsk(general, 3)).toContain('the 3 messages I haven\'t read');
    expect(catchUpAsk(general, 0)).toContain('Do not send anything');
    expect(unreadLabel({ unread: 4, mentions: 1 })).toBe('1 mention');
    expect(unreadLabel({ unread: 4, mentions: 0 })).toBe('4 unread');
  });
});
