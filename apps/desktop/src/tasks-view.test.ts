import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setLocaleForTests } from './dates';
import type { TaskItem } from '@mobius/shared';
import { byDay, byList, dueLabel, LIST_COLORS, listColor, nest, parseWhen, searchTasks, smartView, splitDone, tasksIn } from './tasks-view';

const t = (text: string, due: string | null = null, done = false, line = 0): TaskItem => ({ line, text, done, due });
const today = new Date(2026, 10, 6, 15, 0); // 6 November 2026, afternoon
// Dates follow the computer's regional format; these are written for en-GB.
beforeAll(() => setLocaleForTests('en-GB'));
afterAll(() => setLocaleForTests(null));

describe('due dates in plain words', () => {
  it('says today, tomorrow, the weekday this week, else the date, and marks what is late', () => {
    expect(dueLabel('2026-11-06', today)).toEqual({ text: 'Today', tone: 'today' });
    expect(dueLabel('2026-11-07', today)).toEqual({ text: 'Tomorrow', tone: 'soon' });
    expect(dueLabel('2026-11-10', today)).toEqual({ text: 'Tuesday', tone: 'soon' });
    expect(dueLabel('2026-11-20', today)).toEqual({ text: '20 Nov', tone: 'later' });
    expect(dueLabel('2027-01-02', today)).toEqual({ text: '2 Jan 2027', tone: 'later' });
    expect(dueLabel('2026-11-05', today)).toEqual({ text: 'Yesterday', tone: 'late' });
    expect(dueLabel('2026-10-30', today)).toEqual({ text: '30 Oct', tone: 'late' });
  });
});

describe('lists', () => {
  it('keeps open tasks in file order and puts the done ones apart', () => {
    const { open, done } = splitDone([t('a', null, true, 2), t('b', null, false, 3), t('c', null, false, 4)]);
    expect(open.map((x) => x.text)).toEqual(['b', 'c']);
    expect(done.map((x) => x.text)).toEqual(['a']);
  });
  it('Today gathers what is due today or late from every list, earliest first, never done ones', () => {
    const lists = { Inbox: [t('late', '2026-11-01'), t('done', '2026-11-06', true), t('later', '2026-12-01')], Work: [t('today', '2026-11-06'), t('none')] };
    expect(smartView('today', lists, today).map((x) => [x.list, x.task.text])).toEqual([['Inbox', 'late'], ['Work', 'today']]);
    expect(smartView('scheduled', lists, today).map((x) => x.task.text)).toEqual(['late', 'today', 'later']);
  });
});

describe('what a list had before a turn', () => {
  it('reads each task by its text, done or not, without its due date', () => {
    const before = tasksIn('# P2 build\n\n- [ ] Hold 8 packs at Veltro (due 2026-11-10)\n- [x] Order the jig\nNotes about the list\n* [ ] Book the sled\n');
    expect([...before]).toEqual(['Hold 8 packs at Veltro', 'Order the jig', 'Book the sled']);
    expect(tasksIn('').size).toBe(0);
  });
});

describe('the views across every list', () => {
  const lists = { Inbox: [{ ...t('flag', null), flagged: true }, t('plain'), t('old', null, true)], Work: [{ ...t('flag done', null, true), flagged: true }, t('report', '2026-11-20')] };
  it('Flagged, All and Completed', () => {
    expect(smartView('flagged', lists, today).map((x) => x.task.text)).toEqual(['flag']);
    expect(smartView('all', lists, today).map((x) => x.task.text)).toEqual(['flag', 'plain', 'report']);
    expect(smartView('completed', lists, today).map((x) => x.task.text)).toEqual(['old', 'flag done']);
    expect(byList(smartView('all', lists, today)).map((g) => [g.list, g.rows.length])).toEqual([['Inbox', 2], ['Work', 1]]);
  });
  it('search finds every word in the words or the notes', () => {
    const found = searchTasks('dana code', { Build: [{ ...t('Book the sled'), notes: 'Dana has the code.' }, t('Call Dana')] });
    expect(found.map((x) => x.task.text)).toEqual(['Book the sled']);
    expect(searchTasks('  ', lists)).toEqual([]);
  });
  it('subtasks sit under their task', () => {
    const rows = nest([t('a', null, false, 2), { ...t('a1', null, false, 3), parent: 2 }, t('b', null, false, 4)]);
    expect(rows.map((r) => [r.task.text, r.subtasks.map((s) => s.text)])).toEqual([['a', ['a1']], ['b', []]]);
  });
  it('each list keeps one colour, and Inbox is blue', () => {
    expect(listColor('Inbox')).toBe('blue');
    expect(listColor('Home')).toBe(listColor('Home'));
    expect(LIST_COLORS).toContain(listColor('Home'));
  });
});

describe('a date said in words at the end of a new task', () => {
  // 6 November 2026 is a Friday.
  const when = (text: string) => parseWhen(text, today);
  it('reads today, tomorrow, weekdays, next week, the weekend, in N days and dates', () => {
    expect(when('Call Sam tomorrow')).toEqual({ text: 'Call Sam', due: '2026-11-07', phrase: 'tomorrow' });
    expect(when('Pay rent by mon')).toEqual({ text: 'Pay rent', due: '2026-11-09', phrase: 'by mon' });
    expect(when('Review fri')?.due).toBe('2026-11-13');
    expect(when('Plan next week')?.due).toBe('2026-11-09');
    expect(when('Clean the garage this weekend')?.due).toBe('2026-11-07');
    expect(when('Renew in 3 days')?.due).toBe('2026-11-09');
    expect(when('Renew in two weeks')?.due).toBe('2026-11-20');
    expect(when('Book flights 12 dec')?.due).toBe('2026-12-12');
    expect(when('Book flights on March 3rd')).toEqual({ text: 'Book flights', due: '2027-03-03', phrase: 'on March 3rd' });
  });
  it('leaves words alone when there is no date at the end, or nothing else', () => {
    expect(when('Plan the monday meeting')).toBeNull();
    expect(when('tomorrow')).toBeNull();
    expect(when('Pay 31 feb')).toBeNull();
    expect(when('Buy a monitor')).toBeNull();
  });
});

describe('scheduled by day', () => {
  it('puts late tasks under Overdue, the coming week under each day, and later ones under their month', () => {
    const at = (due: string, text = due) => ({ list: 'Inbox', task: t(text, due) });
    const groups = byDay([at('2026-10-30'), at('2026-11-05'), at('2026-11-06'), at('2026-11-07'), at('2026-11-10'), at('2026-11-10', 'second'), at('2026-11-20'), at('2026-11-28'), at('2027-01-02')], today);
    expect(groups.map((g) => [g.label, g.exact, g.rows.length])).toEqual([
      ['Overdue', false, 2], ['Today', true, 1], ['Tomorrow', true, 1], ['Tuesday', true, 2], ['November', false, 2], ['January 2027', false, 1],
    ]);
  });
  it('leaves out tasks without a date', () => {
    expect(byDay([{ list: 'Inbox', task: t('no date') }], today)).toEqual([]);
  });
});

describe('dates in the regional format', () => {
  it('writes the date and month the way the computer does', () => {
    setLocaleForTests('en-US');
    expect(dueLabel('2026-11-20', today).text).toBe('Nov 20');
    expect(byDay([{ list: 'Inbox', task: t('x', '2027-01-02') }], today)[0]!.label).toBe('January 2027');
    setLocaleForTests('de-DE');
    expect(dueLabel('2026-11-10', today).text).toBe('Dienstag');
    setLocaleForTests('en-GB');
  });
});
