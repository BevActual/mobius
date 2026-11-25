import { describe, expect, it } from 'vitest';
import type { MailMessage } from '@mobius/shared';
import { earlierIn, fileKind, sizeWords, threadKey, threads } from './mail-threads';

const m = (id: string, dateMs: number, extra: Partial<MailMessage> = {}): MailMessage => ({
  id, account: 'a', box: 'inbox', uid: 1, from: { name: 'Rui', email: 'rui@example.com' }, to: [], cc: [], subject: 'Plans', dateMs, seen: true, flagged: false, preview: '', category: 'primary', attachments: [], ...extra,
});

describe('conversations', () => {
  const start = m('a/inbox/1', 100, { messageId: '<t1@example.com>' });
  const mine = m('a/sent/1', 200, { box: 'sent', messageId: '<r1@me>', references: ['<T1@example.com>'] });
  const again = m('a/inbox/2', 300, { messageId: '<t2@example.com>', references: ['<t1@example.com>', '<r1@me>'], seen: false });
  const other = m('a/inbox/3', 250, { messageId: '<x@example.com>', flagged: true });
  it('a reply names the start of its conversation', () => {
    expect(threadKey(again)).toBe('t1@example.com');
    expect(threadKey(mine)).toBe(threadKey(start));
    expect(threadKey(m('a/inbox/9', 1))).toBe('a/inbox/9');
  });
  it('the list shows each conversation once, by its latest message, unread if any is', () => {
    const t = threads([again, other, start]);
    expect(t.map((x) => [x.latest.id, x.messages.length, x.unread, x.flagged])).toEqual([['a/inbox/2', 2, true, false], ['a/inbox/3', 1, false, true]]);
    expect(t[0]!.messages.map((x) => x.id)).toEqual(['a/inbox/1', 'a/inbox/2']);
  });
  it('the earlier messages of an open one come from all mail, your replies too, oldest first', () => {
    expect(earlierIn([again, other, mine, start], again).map((x) => x.id)).toEqual(['a/inbox/1', 'a/sent/1']);
  });
});

describe('attachments', () => {
  it('say their size and kind', () => {
    expect([sizeWords(820), sizeWords(14_200), sizeWords(2_340_000), sizeWords(25_000_000)]).toEqual(['820 bytes', '14 KB', '2.3 MB', '25 MB']);
    expect([fileKind('Plan.PDF'), fileKind('a.png'), fileKind('b.xlsx'), fileKind('c'), fileKind('d.zip')]).toEqual(['pdf', 'image', 'sheet', 'file', 'archive']);
  });
});
