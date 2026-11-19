import { describe, expect, it } from 'vitest';
import type { CalendarEvent, CalendarPerson, ChatChannel, Contact, MailMessage, NoteHit } from '@mobius/shared';
import { bodyHits, channelsMatching, eventsMatching, mailRows, pagesMatching, peopleRows } from './app-launcher';

const ev = (id: string, title: string, start: string, extra: Partial<CalendarEvent> = {}): CalendarEvent => ({ id, calendar: 'Work', title, start, end: start, allDay: false, location: '', notes: '', repeats: false, ...extra });

describe('eventsMatching', () => {
  const now = new Date('2026-11-19T09:00:00');
  const events = [
    ev('old', 'Design review', '2026-11-01T10:00'),
    ev('later', 'Design review', '2026-12-03T10:00'),
    ev('soon', 'Design review', '2026-11-20T10:00'),
    ev('lunch', 'Lunch', '2026-11-21T12:00', { attendees: [{ name: 'Priya Nair', email: 'priya@example.com', status: 'accepted' } as CalendarPerson] }),
  ];
  it('puts coming events first, soonest first, then past ones', () => {
    expect(eventsMatching(events, 'design', now).map((e) => e.id)).toEqual(['soon', 'later', 'old']);
  });
  it('finds an event by who is invited', () => {
    expect(eventsMatching(events, 'priya', now).map((e) => e.id)).toEqual(['lunch']);
  });
  it('finds nothing for no words', () => {
    expect(eventsMatching(events, '  ', now)).toEqual([]);
  });
});

describe('launcher rows', () => {
  it('reads mail by subject and sender', () => {
    const m = { id: 'm1', subject: '', from: { name: '', email: 'sam@example.com' } } as MailMessage;
    expect(mailRows([m])).toEqual([{ id: 'm1', label: '(no subject)', detail: 'Mail, from sam@example.com' }]);
  });
  it('offers to email only people with an address', () => {
    const p = (id: string, name: string, email?: string) => ({ id, name, org: 'Acme', emails: email ? [{ value: email, label: 'work' }] : [] }) as unknown as Contact;
    expect(peopleRows([p('a', 'Ana', 'ana@acme.com'), p('b', 'Bo')])).toEqual([{ id: 'a', label: 'Email Ana', detail: 'ana@acme.com · Acme', email: 'ana@acme.com' }]);
  });
  it('leaves out pages the launcher already finds by title', () => {
    const hits: NoteHit[] = [{ path: 'a', title: 'Offsite plan', notebook: 'Work', line: 'offsite in May' }, { path: 'b', title: 'Budget', notebook: 'Work', line: 'offsite costs' }];
    expect(bodyHits(hits, 'offsite').map((h) => h.path)).toEqual(['b']);
  });
});

describe('Messages and Knowledge', () => {
  const ch = (id: string, name: string, extra: Partial<ChatChannel> = {}): ChatChannel => ({ id, account: 'slack', name, kind: 'channel', unread: 0, mentions: 0, ...extra });
  it('finds channels by name, with or without #, those mentioning you first', () => {
    const all = [ch('a', 'design-crit'), ch('b', 'design', { mentions: 2 }), ch('c', 'general')];
    expect(channelsMatching(all, '#design').map((c) => c.id)).toEqual(['b', 'a']);
  });
  it('finds Knowledge pages by title', () => {
    const books = [{ name: 'Team', pages: [{ path: 'Team/Onboarding.md', title: 'Onboarding', modified: 0 }, { path: 'Team/Hiring.md', title: 'Hiring', modified: 0 }] }];
    expect(pagesMatching(books as never, 'onboard')).toEqual([{ path: 'Team/Onboarding.md', title: 'Onboarding', notebook: 'Team' }]);
  });
});
