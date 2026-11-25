import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setLocaleForTests } from './dates';
import type { TaskItem } from '@mobius/shared';
import { arrange, byDay, byDone, byList, upcomingDay, whenLabel, dueLabel, LIST_COLORS, listColor, nest, parseWhen, parseWhenAndTime, searchTasks, smartView, splitDone, tasksGlance, tasksIn, timeWords } from './tasks-view';

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
    expect(smartView('scheduled', lists, today).map((x) => x.task.text)).toEqual(['later']);
  });
});

describe('When and Deadline, as Things has them', () => {
  // 6 November 2026.
  const w = (text: string, when: string | null, due: string | null = null, extra: Partial<TaskItem> = {}): TaskItem => ({ line: 0, text, done: false, due, when, ...extra });
  const lists = {
    Inbox: [w('planned today', '2026-11-06'), w('planned last week', '2026-10-30'), w('planned friday', '2026-11-13'), w('someday', 'someday'), w('free', null)],
    Work: [w('deadline today', null, '2026-11-06'), w('plan later, due sooner', '2026-11-20', '2026-11-10'), w('someday, due later', 'someday', '2026-12-01'), w('done', '2026-11-06', null, { done: true, doneOn: '2026-11-05' })],
  };
  const names = (view: Parameters<typeof smartView>[0]) => smartView(view, lists, today).map((x) => x.task.text);
  it('Today is what is planned for today or before, and what is due today or past', () => {
    expect(names('today')).toEqual(['planned last week', 'planned today', 'deadline today']);
  });
  it('Upcoming puts each on the day it is planned for, else its deadline', () => {
    expect(names('scheduled')).toEqual(['planned friday', 'plan later, due sooner', 'someday, due later']);
    expect(upcomingDay(lists.Work[1]!, '2026-11-06')).toBe('2026-11-20');
    expect(byDay(smartView('scheduled', lists, today), today, (t) => upcomingDay(t, '2026-11-06')).map((g) => g.label)).toEqual(['November', 'December']);
  });
  it('Anytime leaves out what is planned for later and Someday; Someday holds those', () => {
    expect(names('all')).toEqual(['planned today', 'planned last week', 'free', 'deadline today']);
    expect(names('someday')).toEqual(['someday', 'someday, due later']);
  });
  it('the Logbook lists the latest done first, under the day it was done', () => {
    const book = { A: [w('old', null, null, { done: true }), w('mon', null, null, { done: true, doneOn: '2026-11-02' }), w('today', null, null, { done: true, doneOn: '2026-11-06' })], B: [w('yday', null, null, { done: true, doneOn: '2026-11-05' })] };
    const rows = smartView('completed', book, today);
    expect(rows.map((x) => x.task.text)).toEqual(['today', 'yday', 'mon', 'old']);
    expect(byDone(rows, today).map((g) => [g.label, g.rows.length])).toEqual([['Today', 1], ['Yesterday', 1], ['2 Nov', 1], ['Earlier', 1]]);
  });
  it('says When in words', () => {
    expect(whenLabel('someday', today)).toBe('Someday');
    expect(whenLabel('2026-11-07', today)).toBe('Tomorrow');
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
  it('Flagged, Anytime and the Logbook', () => {
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

describe('times and repeats', () => {
  const when = (text: string) => parseWhenAndTime(text, today);
  it('reads a time after the day, or on its own for today', () => {
    expect(when('Call Sam tomorrow at 3pm')).toEqual({ text: 'Call Sam', due: '2026-11-07', time: '15:00', phrase: 'tomorrow at 3pm' });
    expect(when('Stand-up mon 9:30')).toEqual({ text: 'Stand-up', due: '2026-11-09', time: '09:30', phrase: 'mon 9:30' });
    expect(when('Ring Mum at 6pm')).toEqual({ text: 'Ring Mum', due: '2026-11-06', time: '18:00', phrase: 'at 6pm' });
    expect(when('Lunch at 12am')).toEqual({ text: 'Lunch', due: '2026-11-06', time: '00:00', phrase: 'at 12am' });
    expect(when('Gym 7am')?.time).toBe('07:00');
    // Numbers that are not times stay words; a day alone still works.
    expect(when('Buy 2')).toBeNull();
    expect(when('Read chapter 12')).toBeNull();
    expect(when('Call Sam tomorrow')).toEqual({ text: 'Call Sam', due: '2026-11-07', phrase: 'tomorrow' });
    expect(when('at 3pm')).toBeNull();
    expect(when('Meet at 25:00')).toBeNull();
  });
  it('writes a time the way the computer does, and Scheduled puts a day in time order', () => {
    expect(timeWords('16:05')).toBe('16:05');
    const rows = smartView('scheduled', { Inbox: [{ ...t('later', '2026-11-07'), line: 0 }, { ...t('nine', '2026-11-07'), time: '09:00', line: 1 }, { ...t('eight', '2026-11-07'), time: '08:00', line: 2 }] }, today);
    expect(rows.map((r) => r.task.text)).toEqual(['eight', 'nine', 'later']);
  });
  it('knows the words of a task that has a time, a repeat and a flag', () => {
    expect([...tasksIn('- [ ] Stand-up (due 2026-11-16 09:30) (every weekday) (flagged)\n- [x] Pay (due 2026-11-01)')]).toEqual(['Stand-up', 'Pay']);
    expect([...tasksIn('- [ ] Plan (when someday)\n- [x] Book (when 2026-11-02) (done 2026-11-03)')]).toEqual(['Plan', 'Book']);
  });
});

describe('the Glance in the Mobius panel', () => {
  it('counts open tasks past their deadline, the rest of Today, and flagged, across every list', () => {
    const t = (line: number, due: string | null, extra: Partial<TaskItem> = {}): TaskItem => ({ line, text: `t${line}`, done: false, due, ...extra });
    const lists = {
      Inbox: [t(1, '2026-11-12'), t(2, '2026-11-14'), t(3, '2026-11-14', { done: true }), t(4, null, { flagged: true }), t(5, null, { when: '2026-11-14' })],
      Garden: [t(1, '2026-11-13', { flagged: true }), t(2, '2026-11-20'), t(3, '2026-11-01', { done: true, flagged: true })],
    };
    expect(tasksGlance(lists, new Date(2026, 10, 14, 9))).toEqual([
      { label: 'Overdue', value: '2' }, { label: 'Today', value: '2' }, { label: 'Flagged', value: '2' },
    ]);
  });
});

describe('arrange', () => {
  const t = (text: string, extra: Partial<TaskItem> = {}): { task: TaskItem } => ({ task: { line: 0, text, done: false, due: null, ...extra } });
  const now = new Date(2026, 10, 22);
  const rows = [t('Pay rent', { due: '2026-12-01' }), t('buy milk', { flagged: true }), t('Call Sam', { due: '2026-11-24', time: '09:00' }), t('Book sled', { due: '2026-11-24' })];
  const names = (r: { task: TaskItem }[]) => r.map((x) => x.task.text);
  it('keeps the hand-made order for Manual and sorts by due date (undated last) or name', () => {
    expect(names(arrange(rows, 'manual', 'all', now))).toEqual(['Pay rent', 'buy milk', 'Call Sam', 'Book sled']);
    expect(names(arrange(rows, 'due', 'all', now))).toEqual(['Call Sam', 'Book sled', 'Pay rent', 'buy milk']);
    expect(names(arrange(rows, 'name', 'all', now))).toEqual(['Book sled', 'buy milk', 'Call Sam', 'Pay rent']);
  });
  it('filters to flagged, dated, or due within the week', () => {
    expect(names(arrange(rows, 'manual', 'flagged', now))).toEqual(['buy milk']);
    expect(names(arrange(rows, 'manual', 'dated', now))).toEqual(['Pay rent', 'Call Sam', 'Book sled']);
    expect(names(arrange(rows, 'due', 'week', now))).toEqual(['Call Sam', 'Book sled']);
  });
});
