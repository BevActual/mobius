import type { ChatAccount, ChatChanged, ChatChannel, ChatMessage } from '@mobius/shared';

/**
 * The preview's Messages: a Slack workspace and a Matrix account, kept in memory for as long as the preview is open,
 * so the app can be used and looked at without the Rust core. What is sent is added to the channel; nothing leaves.
 */
const now = Date.now();
const min = 60_000;
const hour = 60 * min;
const ACCOUNTS: ChatAccount[] = [
  { id: 'slack:northway', service: 'slack', name: 'Northway', status: 'ready' },
  { id: 'matrix:home', service: 'matrix', name: 'matrix.org', status: 'ready' },
];
let channels: ChatChannel[] = [
  { id: 'c-p2', account: 'slack:northway', name: 'kestrel-p2', kind: 'channel', unread: 2, mentions: 1, last: now - 6 * min },
  { id: 'c-build', account: 'slack:northway', name: 'build-floor', kind: 'channel', unread: 0, mentions: 0, last: now - 2 * hour },
  { id: 'c-general', account: 'slack:northway', name: 'general', kind: 'channel', unread: 0, mentions: 0, last: now - 26 * hour },
  { id: 'd-priya', account: 'slack:northway', name: 'Priya Natarajan', kind: 'direct', unread: 1, mentions: 0, last: now - 18 * min },
  { id: 'd-tom', account: 'slack:northway', name: 'Tom Okafor', kind: 'direct', unread: 0, mentions: 0, last: now - 5 * hour },
  { id: 'm-climb', account: 'matrix:home', name: 'Saturday climbing', kind: 'group', unread: 0, mentions: 0, last: now - 3 * hour },
];
const me = { id: 'me', name: 'You', me: true };
const priya = { id: 'u-priya', name: 'Priya Natarajan' };
const tom = { id: 'u-tom', name: 'Tom Okafor' };
const lena = { id: 'u-lena', name: 'Lena Brandt' };
const msg = (id: string, channel: string, author: ChatMessage['author'], text: string, ago: number, extra: Partial<ChatMessage> = {}): ChatMessage => ({ id, channel, author, text, at: now - ago, ...extra });
const HISTORY: Record<string, ChatMessage[]> = {
  'c-p2': [
    msg('p1', 'c-p2', tom, 'Morning all. The Veltro quote came in: 60 kWh pack, 9 week lead time.', 3 * hour),
    msg('p2', 'c-p2', priya, 'That pushes the sled test into March. Can we ask about a loan pack in the meantime?', 3 * hour - 12 * min, { replies: 2, repliers: [{ name: 'Tom Okafor' }, { name: 'Lena Brandt' }], lastReply: now - 90 * min, reactions: [{ emoji: '👍', count: 2 }] }),
    msg('p3', 'c-p2', me, 'I’ll ask them today.', 3 * hour - 20 * min),
    msg('p4', 'c-p2', lena, 'Axion confirmed the 150 kW motor ships Friday.', 40 * min, { reactions: [{ emoji: '🎉', count: 3, mine: true }] }),
    msg('p5', 'c-p2', priya, '@You can you bring the torque spec sheet to Thursday’s review?', 6 * min),
  ],
  'p2': [
    msg('p2a', 'c-p2', tom, 'Asked last week, they had none spare. Worth asking again.', 2 * hour, { thread: 'p2' }),
    msg('p2b', 'c-p2', lena, 'Axion lent us one last year; I can ask them too.', 90 * min, { thread: 'p2' }),
  ],
  'c-build': [
    msg('b1', 'c-build', tom, 'Bay 2 is free from Monday for the sled rig.', 2 * hour),
  ],
  'c-general': [
    msg('g1', 'c-general', lena, 'Office is closed on the 28th for the move.', 26 * hour),
  ],
  'd-priya': [
    msg('dp1', 'd-priya', priya, 'Got 10 minutes after lunch to go over the build plan?', 18 * min),
  ],
  'd-tom': [
    msg('dt1', 'd-tom', me, 'Thanks for the rig drawings.', 5 * hour),
    msg('dt2', 'd-tom', tom, 'Any time.', 5 * hour - 3 * min),
  ],
  'm-climb': [
    msg('mc1', 'm-climb', { id: 'u-sam', name: 'Sam' }, 'Usual wall at 10?', 3 * hour),
  ],
};
let listeners: ((change: ChatChanged) => void)[] = [];
let next = 1;

export const PREVIEW_MESSAGES: Record<string, (...args: never[]) => unknown> = {
  'messages.accounts': () => ACCOUNTS.map((a) => ({ ...a })),
  'messages.channels': ((account: string) => channels.filter((c) => c.account === account).map((c) => ({ ...c }))) as never,
  'messages.history': ((_account: string, channel: string, options?: { thread?: string }) => [...(HISTORY[options?.thread ?? channel] ?? [])]) as never,
  'messages.send': ((account: string, channel: string, text: string, thread?: string) => {
    const sent = msg(`sent-${next++}`, channel, me, text, 0, thread ? { thread } : {});
    const key = thread ?? channel;
    HISTORY[key] = [...(HISTORY[key] ?? []), sent];
    if (thread) HISTORY[channel] = (HISTORY[channel] ?? []).map((m) => (m.id === thread ? { ...m, replies: (m.replies ?? 0) + 1 } : m));
    channels = channels.map((c) => (c.id === channel ? { ...c, last: sent.at } : c));
    listeners.forEach((l) => l({ account, channel }));
    return sent;
  }) as never,
  'messages.markRead': ((_account: string, channel: string) => { channels = channels.map((c) => (c.id === channel ? { ...c, unread: 0, mentions: 0 } : c)); }) as never,
  'messages.onChanged': ((listener: (change: ChatChanged) => void) => { listeners.push(listener); return () => { listeners = listeners.filter((l) => l !== listener); }; }) as never,
};
