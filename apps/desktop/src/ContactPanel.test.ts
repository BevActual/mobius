import { describe, expect, it } from 'vitest';
import type { MailMessage } from '@mobius/shared';
import { recentFrom } from './ContactPanel';

const msg = (id: string, email: string, dateMs: number): MailMessage => ({ id, account: 'a', box: 'inbox', uid: 1, from: { name: '', email }, to: [], cc: [], subject: id, dateMs, seen: true, flagged: false, preview: '', category: 'primary', attachments: [] });

describe('recentFrom', () => {
  it('lists only the sender’s mail, newest first, whatever the case of the address, up to the limit', () => {
    const all = [msg('a', 'priya@example.com', 1), msg('b', 'sam@example.com', 5), msg('c', 'Priya@Example.com', 3), msg('d', 'priya@example.com', 2)];
    expect(recentFrom(all, 'PRIYA@example.com').map((m) => m.id)).toEqual(['c', 'd', 'a']);
    expect(recentFrom(all, 'priya@example.com', 2).map((m) => m.id)).toEqual(['c', 'd']);
    expect(recentFrom(all, '')).toEqual([]);
  });
});

describe('address fields', () => {
  it('splits off the address being typed, and writes a contact as Name <email>', async () => {
    const { lastAddress, addressOf } = await import('./ContactPanel');
    expect(lastAddress('pri')).toEqual({ before: '', typing: 'pri' });
    expect(lastAddress('Sam <s@x.com>, pri')).toEqual({ before: 'Sam <s@x.com>, ', typing: 'pri' });
    expect(addressOf('Priya Shah', 'priya@x.com')).toBe('Priya Shah <priya@x.com>');
    expect(addressOf('', 'priya@x.com')).toBe('priya@x.com');
  });
});
