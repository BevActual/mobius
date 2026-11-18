import { describe, expect, it } from 'vitest';
import type { MailMessage } from '@mobius/shared';
import { recentFrom, meetingsWith } from './ContactPanel';

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

describe('meetingsWith', () => {
  const ev = (id: string, start: string, end: string, people: string[], organizer?: string) => ({ id, calendar: 'Work', title: id, start, end, allDay: false, location: '', notes: '', repeats: false, attendees: people.map((email) => ({ name: '', email, status: '' as const })), organizer: organizer ? { name: '', email: organizer, status: '' as const } : null });
  const now = new Date(2026, 10, 18, 12, 0);
  it('lists events with someone, invited or inviting, from now on, soonest first', () => {
    const events = [
      ev('Later', '2026-11-20T10:00', '2026-11-20T11:00', ['Rui@Example.com']),
      ev('Past', '2026-11-17T10:00', '2026-11-17T11:00', ['rui@example.com']),
      ev('Soon', '2026-11-19T09:00', '2026-11-19T10:00', [], 'rui@example.com'),
      ev('Other', '2026-11-19T08:00', '2026-11-19T09:00', ['ana@example.com']),
      ev('Now', '2026-11-18T11:30', '2026-11-18T12:30', ['rui@example.com']),
    ];
    expect(meetingsWith(events, 'rui@example.com', now).map((e) => e.id)).toEqual(['Now', 'Soon', 'Later']);
    expect(meetingsWith(events, '', now)).toEqual([]);
  });
});
