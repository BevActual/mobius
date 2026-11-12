import { describe, expect, it } from 'vitest';
import type { ConversationInfo, MailMessage } from '@mobius/shared';
import { setLocaleForTests } from './dates';
import { tileContent, tileSummary, type ViewSources } from './views-data';

const now = new Date(2026, 10, 12, 10, 30);
const convo = (id: string, title: string, activity: string, waiting = 0) => ({ id, title, activity, waiting, updated_ms: now.getTime(), messages: 2 }) as unknown as ConversationInfo;
const message = (id: string, subject: string, seen: boolean, dateMs: number) =>
  ({ id, account: 'a', box: 'inbox', uid: 1, from: { name: 'Ana', email: 'ana@example.com' }, to: [], cc: [], subject, dateMs, seen, flagged: false, preview: '', category: 'primary', attachments: [] }) as unknown as MailMessage;

const src: ViewSources = {
  tasks: {
    Inbox: [
      { line: 1, text: 'Call the bank', done: false, due: '2026-11-12' },
      { line: 2, text: 'Pay the rent', done: false, due: '2026-11-10', flagged: true },
      { line: 3, text: 'Book flights', done: false, due: '2026-11-20' },
      { line: 4, text: 'Done already', done: true, due: '2026-11-12' },
    ],
  },
  events: [
    { id: 'e1', calendar: 'Home', title: 'Standup', start: '2026-11-12T09:00', end: '2026-11-12T09:15', allDay: false, location: '', notes: '', repeats: false },
    { id: 'e2', calendar: 'Home', title: 'Lunch with Ana', start: '2026-11-12T12:30', end: '2026-11-12T13:30', allDay: false, location: '', notes: '', repeats: false },
    { id: 'e3', calendar: 'Home', title: 'Offsite', start: '2026-11-14', end: '2026-11-15', allDay: true, location: '', notes: '', repeats: false },
  ],
  mail: { messages: [message('m1', 'Old', false, 1), message('m2', 'New', false, 5), message('m3', 'Read', true, 9)], unread: 9, accounts: 1 },
  notes: [{ name: 'Home', pages: [{ path: 'Home/Garden.md', title: 'Garden', modified: now.getTime() - 120_000 }] }, { name: 'Work', pages: [{ path: 'Work/Plan.md', title: 'Plan', modified: now.getTime() - 60_000 }] }],
  conversations: [convo('c1', 'Trip', 'working'), convo('c2', 'Invoice', 'idle', 1), convo('c3', 'Old', 'idle')],
  schedules: [],
};

describe('tiles', () => {
  it('Tasks shows what is due today and late, late first and marked', () => {
    const t = tileContent({ id: 't', kind: 'tasks', size: 'small', show: 'today' }, src, now);
    expect(t.count).toEqual({ value: 2, label: 'due' });
    expect(t.rows.map((r) => [r.text, r.tone])).toEqual([['Pay the rent', 'late'], ['Call the bank', undefined]]);
    expect(tileContent({ id: 't', kind: 'tasks', size: 'small', show: 'flagged' }, src, now).rows.map((r) => r.text)).toEqual(['Pay the rent']);
    const all = tileContent({ id: 't', kind: 'tasks', size: 'small', show: 'all' }, { ...src, tasks: { Inbox: Array.from({ length: 9 }, (_, i) => ({ line: i, text: `T${i}`, done: false, due: null })) } }, now);
    expect([all.rows.length, all.more]).toEqual([4, 5]);
  });

  it('Calendar leaves out what has finished today, and the week shows the day', () => {
    const today = tileContent({ id: 'c', kind: 'calendar', size: 'small', show: 'today' }, src, now);
    expect(today.rows.map((r) => `${r.text} ${r.detail}`)).toEqual(['Lunch with Ana 12:30']);
    expect(today.count?.label).toBe('event left today');
    const week = tileContent({ id: 'c', kind: 'calendar', size: 'wide', show: 'week' }, src, now);
    expect(week.rows.map((r) => `${r.text} ${r.detail}`)).toEqual(['Lunch with Ana 12:30', 'Offsite Sat All day']);
  });

  it('Mail lists unread inbox mail, newest first, and counts the whole inbox', () => {
    const t = tileContent({ id: 'm', kind: 'mail', size: 'small' }, src, now);
    expect(t.rows.map((r) => r.text)).toEqual(['New', 'Old']);
    expect(t.count).toEqual({ value: 9, label: 'unread' });
    expect(t.more).toBe(7);
    expect(tileContent({ id: 'm', kind: 'mail', size: 'small' }, { ...src, mail: { messages: [], unread: 0, accounts: 0 } }, now).empty).toBe('Add a mail account in Mail.');
  });

  it('Notes lists the newest notes, from one notebook when asked, and opens each note', () => {
    const t = tileContent({ id: 'n', kind: 'notes', size: 'small' }, src, now);
    expect(t.rows.map((r) => r.text)).toEqual(['Plan', 'Garden']);
    expect(t.rows[0]!.target).toEqual({ kind: 'note', path: 'Work/Plan.md', title: 'Plan' });
    expect(tileContent({ id: 'n', kind: 'notes', size: 'small', notebook: 'Home' }, src, now).rows.map((r) => r.text)).toEqual(['Garden']);
    expect(tileContent({ id: 'n', kind: 'notes', size: 'small', notebook: 'Gone' }, src, now).empty).toBe('There is no notebook called Gone.');
  });

  it('Mobius puts what waits for you first, then what is working', () => {
    const t = tileContent({ id: 'x', kind: 'mobius', size: 'wide' }, src, now);
    expect(t.rows.map((r) => `${r.text}: ${r.detail}`)).toEqual(['Invoice: Needs you', 'Trip: Working']);
    expect(t.count).toEqual({ value: 1, label: 'waiting for you' });
    expect(tileSummary('Mobius', t)).toBe('Mobius: 1 waiting for you');
    const quiet = tileContent({ id: 'x', kind: 'mobius', size: 'wide' }, { ...src, conversations: [] }, now);
    expect(quiet.empty).toBe('All quiet. Nothing is waiting for you.');
  });

  it('Next lists the schedules that run soonest', () => {
    const schedules = [{ id: 's1', title: 'Morning brief', enabled: true, days: [1, 2, 3, 4, 5], time: '08:00', lastRunMs: null }] as unknown as ViewSources['schedules'];
    // Times follow the computer's clock (dates.ts); pin one so the test does not depend on where it runs.
    setLocaleForTests('en-GB');
    const t = tileContent({ id: 's', kind: 'next', size: 'small' }, { ...src, schedules }, now);
    setLocaleForTests(null);
    expect(t.rows.map((r) => `${r.text} ${r.detail}`)).toEqual(['Morning brief Tomorrow at 8:00']);
    expect(tileSummary('Next', tileContent({ id: 's', kind: 'next', size: 'small' }, src, now))).toBe('Next: Nothing scheduled. Add a schedule in Settings.');
  });
});
