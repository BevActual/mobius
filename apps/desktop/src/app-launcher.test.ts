import { describe, expect, it } from 'vitest';
import type { CalendarEvent, CalendarPerson, ChatChannel, Contact, MailMessage, NoteHit } from '@mobius/shared';
import { bodyHits, channelsMatching, eventsMatching, mailRows, pagesMatching, peopleRows, quickTask, quickTaskDetail } from './app-launcher';

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
    expect(mailRows([m])).toMatchObject([{ id: 'm1', label: '(no subject)', detail: 'Mail, from sam@example.com', preview: { title: '(no subject)', meta: 'sam@example.com' } }]);
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

describe('quick add task', () => {
  const now = new Date('2026-11-19T10:00:00');
  it('reads the words after "task", with the day and time said at the end', () => {
    expect(quickTask('task Call Sam tomorrow at 3pm', now)).toEqual({ text: 'Call Sam', due: '2026-11-20', time: '15:00' });
    expect(quickTask('add task Renew passport', now)).toEqual({ text: 'Renew passport', due: null });
    expect(quickTask('Todo pay rent tomorrow', now)).toEqual({ text: 'pay rent', due: '2026-11-20' });
  });
  it('is nothing for other words', () => {
    expect(quickTask('tasks', now)).toBeNull();
    expect(quickTask('task ', now)).toBeNull();
    expect(quickTask('taskbar settings', now)).toBeNull();
    expect(quickTask('Call Sam', now)).toBeNull();
  });
  it('says where it goes and when it is due', () => {
    expect(quickTaskDetail({ due: null }, 'Inbox')).toBe('Tasks, to Inbox');
    expect(quickTaskDetail({ due: '2026-11-20' }, 'Inbox')).toMatch(/^Tasks, to Inbox, due .*20/);
  });
});

import { eventPreview, eventWhen, quickEvent } from './app-launcher';

describe('quickEvent', () => {
  const now = new Date('2026-11-19T09:00:00');
  it('reads an event from the rest of the line', () => {
    const e = quickEvent('event lunch with Sam fri 1pm', now);
    expect(e?.title).toBe('lunch with Sam');
    expect(e?.start.slice(0, 16)).toBe('2026-11-20T13:00');
    expect(quickEvent('new event Dentist 12 dec at 3pm', now)?.title).toBe('Dentist');
  });
  it('leaves other words alone', () => {
    expect(quickEvent('events this week', now)).toBeNull();
    expect(quickEvent('event', now)).toBeNull();
    expect(quickEvent('meeting notes', now)).toBeNull();
  });
});

describe('launcher previews', () => {
  it('says when an event is, all day or between two times', () => {
    expect(eventWhen({ start: '2026-11-21', end: '2026-11-22', allDay: true })).toMatch(/all day$/);
    expect(eventWhen({ start: '2026-11-21T13:00', end: '2026-11-21T14:00' })).toMatch(/–/);
  });
  it('shows an event’s place and people', () => {
    const p = eventPreview(ev('x', 'Dealer preview', '2026-11-21T13:00', { location: 'Room 2', attendees: [{ name: 'Sam', email: 's@x' } as CalendarPerson] }));
    expect(p.rows?.map(([k]) => k)).toEqual(['When', 'Where', 'People']);
  });
  it('shows a mail’s first lines and who sent it', () => {
    const m = { id: 'm', subject: 'Quote', from: { name: 'Maya', email: 'm@x' }, dateMs: Date.UTC(2026, 10, 19, 9), preview: 'The revised numbers', attachments: ['q.pdf'] } as unknown as MailMessage;
    const [row] = mailRows([m]);
    expect(row!.preview.body).toBe('The revised numbers');
    expect(row!.preview.meta).toContain('Maya');
    expect(row!.preview.rows).toEqual([['Attached', 'q.pdf']]);
  });
});
