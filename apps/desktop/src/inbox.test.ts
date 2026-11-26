import { describe, expect, it } from 'vitest';
import type { CalendarEvent, MailMessage } from '@mobius/shared';
import { inboxItems, laterUntil, sortInbox, trimKept } from './inbox';

const now = new Date(2026, 10, 25, 20, 0);
const empty = { dueToday: [], projects: [], suggested: [], mail: [], events: [], me: [] };
const task = (text: string, due: string) => ({ line: 1, text, done: false, due });

describe('the Inbox across apps', () => {
  it('lists tasks due, invitations not answered, mail to answer, updates due and suggested changes', () => {
    const invite = { id: 'e1', calendar: 'Work', title: 'Planning', start: '2026-11-27T10:00', end: '2026-11-27T11:00', allDay: false, location: '', notes: '', repeats: false,
      organizer: { name: 'Sam', email: 'sam@x.org', status: '' }, attendees: [{ name: 'Me', email: 'ME@home.org', status: 'needs-action' }] } as CalendarEvent;
    const answered = { ...invite, id: 'e2', attendees: [{ name: 'Me', email: 'me@home.org', status: 'accepted' }] } as CalendarEvent;
    const mail = { id: 'm1', box: 'inbox', subject: 'Quote', from: { name: 'Ana', email: 'a@x.org' }, needsReply: true, dateMs: 5 } as MailMessage;
    const items = inboxItems({
      dueToday: [{ list: 'Home', task: task('Pay rent', '2026-11-20') }, { list: 'Home', task: task('Call Bo', '2026-11-25') }],
      projects: [{ id: 'p', name: 'Offsite', rules: {}, threads: [], status: 'started' }, { id: 'q', name: 'Later', rules: {}, threads: [], status: 'planned' }],
      suggested: [{ id: 'c1', from: 'Mobius', page: 'Pages/A.md', text: 'x', whenMs: 3 }],
      mail: [mail, { ...mail, id: 'm2', needsReply: false }], events: [invite, answered], me: ['me@home.org'],
    }, now);
    expect(items.map((i) => [i.kind, i.name, i.text])).toEqual([
      ['task', 'Pay rent', 'Overdue · Home'], ['task', 'Call Bo', 'Due today · Home'],
      ['invite', 'Planning', 'Invitation from Sam'], ['reply', 'Quote', 'Needs a reply to Ana'],
      ['update', 'Offsite', 'No update yet'], ['suggested', '1 suggested change', 'Waiting to be kept in Knowledge'],
    ]);
    expect(inboxItems(empty, now)).toEqual([]);
  });
  it('Done clears an item for good and Later sets it aside until its time', () => {
    const items = inboxItems({ ...empty, dueToday: [{ list: 'Home', task: task('A', '2026-11-25') }, { list: 'Home', task: task('B', '2026-11-25') }, { list: 'Home', task: task('C', '2026-11-25') }] }, now);
    const [a, b, c] = items.map((i) => i.key) as [string, string, string];
    const got = sortInbox(items, { done: [a], later: { [b]: now.getTime() + 1000, [c]: now.getTime() - 1 } }, now.getTime());
    expect(got.shown.map((i) => i.name)).toEqual(['C']);
    expect(got.later.map((i) => i.name)).toEqual(['B']);
    expect(trimKept({ done: [a], later: { [b]: 1, [c]: now.getTime() + 5 } }, now.getTime()).later).toEqual({ [c]: now.getTime() + 5 });
  });
  it('Later is three hours on, tomorrow at 8:00, or next Monday at 8:00', () => {
    expect(laterUntil('today', now)).toBe(now.getTime() + 3 * 3_600_000);
    expect(new Date(laterUntil('tomorrow', now))).toEqual(new Date(2026, 10, 26, 8, 0));
    expect(new Date(laterUntil('week', now))).toEqual(new Date(2026, 10, 30, 8, 0));
  });
});
