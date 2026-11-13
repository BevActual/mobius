import type { CalendarEvent, MailMessage } from '@mobius/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setLocaleForTests } from './dates';
import { deskAppRows, type DeskSources } from './desk-apps';

// Thursday 12 November 2026, 9:30.
const now = new Date(2026, 10, 12, 9, 30);
const none: DeskSources = { tabs: [], mail: [], unread: 0, dueToday: [], events: [], notes: [], docs: [] };
const event = (title: string, start: string, end: string, allDay = false): CalendarEvent => ({ id: title, calendar: 'Home', title, start, end, allDay, location: '', notes: '', repeats: false });
const mail = (id: string, name: string, dateMs: number, seen = false): MailMessage => ({ id, account: 'a', box: 'inbox', uid: 1, from: { name, email: `${name}@x.org` }, to: [], cc: [], subject: 's', dateMs, seen, flagged: false, preview: '', category: 'primary', attachments: [] });
const page = (title: string, hoursAgo: number) => ({ path: `Work/${title}.md`, title, modified: now.getTime() - hoursAgo * 3_600_000 });

describe('In your apps', () => {
  beforeEach(() => setLocaleForTests('en-GB'));
  afterEach(() => setLocaleForTests(null));

  it('says nothing for apps with nothing in them', () => {
    expect(deskAppRows(none, now)).toEqual([]);
  });

  it('names the next event left today, says Now once it has begun, and opens its day', () => {
    const events = [event('Done', '2026-11-12T08:00', '2026-11-12T09:00'), event('Review', '2026-11-12T14:00', '2026-11-12T15:00'), event('Standup', '2026-11-12T10:00', '2026-11-12T10:15'), event('Tomorrow', '2026-11-13T10:00', '2026-11-13T11:00')];
    expect(deskAppRows({ ...none, events }, now)).toEqual([{ app: 'calendar', item: 'Standup', text: '10:00 · 2 today', target: { app: 'calendar', date: '2026-11-12' } }]);
    const [row] = deskAppRows({ ...none, events: [event('Standup', '2026-11-12T09:15', '2026-11-12T09:45')] }, now);
    expect(row?.text).toBe('Now');
    const [allDay] = deskAppRows({ ...none, events: [event('Offsite', '2026-11-11', '2026-11-12', true), event('Standup', '2026-11-12T10:00', '2026-11-12T10:15')] }, now);
    expect(allDay).toMatchObject({ item: 'Offsite', text: 'All day · 2 today' });
  });

  it('names the first task due and opens its list', () => {
    const task = (text: string) => ({ line: 1, text, done: false, due: '2026-11-12' });
    expect(deskAppRows({ ...none, dueToday: [{ list: 'Kestrel', task: task('Order brake pads') }, { list: 'Inbox', task: task('Call the bank') }] }, now))
      .toEqual([{ app: 'tasks', item: 'Order brake pads', text: '2 due today', target: { app: 'tasks', list: 'Kestrel' } }]);
  });

  it('names who wrote the newest unread mail and opens it', () => {
    const rows = deskAppRows({ ...none, unread: 2, mail: [mail('1', 'Ana', 10), mail('2', 'Ben', 30), mail('3', 'Cat', 50, true)] }, now);
    expect(rows).toEqual([{ app: 'mail', item: 'Ben', text: '2 unread', target: { app: 'mail', id: '2' } }]);
  });

  it('names the note and doc edited last, only when that was in the last three days', () => {
    const rows = deskAppRows({ ...none, notes: [{ name: 'Work', pages: [page('Old', 100), page('Launch plan', 2)] }], docs: [{ name: 'Work', pages: [page('Spec', 80)] }] }, now);
    expect(rows).toEqual([{ app: 'notes', item: 'Launch plan', text: 'Edited 2 h ago', target: { app: 'notes', path: 'Work/Launch plan.md', title: 'Launch plan' } }]);
    expect(deskAppRows({ ...none, docs: [{ name: 'Work', pages: [page('Spec', 20)] }] }, now)[0]?.text).toBe('Edited yesterday');
  });

  it('names the open tab in the browser', () => {
    expect(deskAppRows({ ...none, tabs: [{ title: 'Kestrel specs' }, { title: 'Parts', active: true }] }, now)).toEqual([{ app: 'browser', item: 'Parts', text: '2 tabs open' }]);
  });
});
