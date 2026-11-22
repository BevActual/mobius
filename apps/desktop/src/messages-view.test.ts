import { describe, expect, it } from 'vitest';
import type { ChatAccount, ChatChannel, ChatMessage } from '@mobius/shared';
import { accountsFor, isSpaceAccount, railEntries, spaceStatusText, catchUpAsk, channelGroups, channelLabel, chatItem, firstUnread, lastReplyLabel, mentionParts, myName, runs, toggled, unreadLabel } from './messages-view';

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

describe('mentions, the New line and threads', () => {
  const m = (id: string, text: string, me = false): ChatMessage => ({ id, channel: 'c', author: { id: me ? 'me' : 'p', name: me ? 'Sam Lee' : 'Priya', ...(me ? { me: true } : {}) }, text, at: 0 });
  it('finds the person by their full or first name, and @here', () => {
    expect(myName([m('1', 'hi'), m('2', 'yo', true)])).toBe('Sam Lee');
    expect(mentionParts('@Sam can you look?', 'Sam Lee')).toEqual({ parts: [{ text: '@Sam', me: true }, { text: ' can you look?' }], mine: true });
    expect(mentionParts('ping @here now', null).mine).toBe(true);
    expect(mentionParts('@Samantha hi', 'Sam Lee').mine).toBe(false);
    expect(mentionParts('mail sam@x.org', 'Sam Lee').mine).toBe(false);
  });
  it('puts the New line at the first of the unread, counting only other people', () => {
    const list = [m('1', 'a'), m('2', 'b', true), m('3', 'c'), m('4', 'd')];
    expect(firstUnread(list, 2)).toBe('3');
    expect(firstUnread(list, 0)).toBeNull();
    expect(firstUnread(list, 9)).toBe('1');
  });
  it('says when a thread was last answered', () => {
    expect(lastReplyLabel(0, 30_000)).toBe('Last reply just now');
    expect(lastReplyLabel(0, 5 * 60_000)).toBe('Last reply 5 min ago');
    expect(lastReplyLabel(0, 3 * 3_600_000)).toBe('Last reply 3 h ago');
    expect(lastReplyLabel(0, 49 * 3_600_000)).toBe('Last reply 2 days ago');
  });
});

describe('toggled', () => {
  it('adds the person\'s reaction, to a new or an existing emoji', () => {
    expect(toggled([], '👍', true)).toEqual([{ emoji: '👍', count: 1, mine: true }]);
    expect(toggled([{ emoji: '👍', count: 2 }], '👍', true)).toEqual([{ emoji: '👍', count: 3, mine: true }]);
    expect(toggled([{ emoji: '👍', count: 2, mine: true }], '👍', true)).toEqual([{ emoji: '👍', count: 2, mine: true }]);
  });
  it('takes it back, dropping an emoji no one else used', () => {
    expect(toggled([{ emoji: '🎉', count: 3, mine: true }], '🎉', false)).toEqual([{ emoji: '🎉', count: 2, mine: false }]);
    expect(toggled([{ emoji: '🎉', count: 1, mine: true }], '🎉', false)).toEqual([]);
    expect(toggled([{ emoji: '🎉', count: 2 }], '🎉', false)).toEqual([{ emoji: '🎉', count: 2 }]);
  });
});

describe('the rail', () => {
  const acc = (id: string, name: string, service: ChatAccount['service'] = 'slack'): ChatAccount => ({ id, service, name, status: 'ready' });
  const space = acc('m1', 'Mobius space', 'matrix');
  it('lists All, then the Mobius space, then each other account, and shows the chosen one’s', () => {
    const accounts = [acc('s1', 'Northway'), space];
    expect(railEntries(accounts).map((e) => e.label)).toEqual(['All conversations', 'Mobius space', 'Northway · Slack']);
    expect(accountsFor('space', accounts)).toEqual([space]);
    expect(accountsFor('s1', accounts).map((a) => a.id)).toEqual(['s1']);
    expect(accountsFor('gone', accounts)).toHaveLength(2);
    expect(isSpaceAccount(acc('x', 'Mobius space'))).toBe(false);
  });
  it('says what the space is doing until it runs, the first download with its size', () => {
    expect(spaceStatusText({ state: 'downloading', done: 12_000_000, total: 44_000_000 })).toBe('Getting your Mobius space ready, the first time only: 12 of 44 MB');
    expect(spaceStatusText({ state: 'failed', message: 'x', offline: true })).toMatch(/connection/);
    expect(spaceStatusText({ state: 'running', url: 'http://127.0.0.1:1' })).toBeNull();
  });
});
