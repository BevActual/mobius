import { describe, expect, it } from 'vitest';
import type { TaskItem } from '@mobius/shared';
import { dueLabel, smartView, splitDone } from './tasks-view';

const t = (text: string, due: string | null = null, done = false, line = 0): TaskItem => ({ line, text, done, due });
const today = new Date(2026, 10, 6, 15, 0); // 6 November 2026, afternoon

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
