import { describe, expect, it } from 'vitest';
import { describeAction, groupSummary, pastAction, toolTarget } from './actions';

describe('a finished tool row names what it acted on', () => {
  it('in the past tense, with the item', () => {
    expect(pastAction('tasks.add', { list: 'P2 build', text: 'Order brake kit' })).toBe('Added “Order brake kit” to P2 build in Tasks');
    expect(pastAction('files.read', { path: 'notes/Work/Plan.md' })).toBe('Read the note “Work › Plan”');
  });
  it('a new email is drafted, not a reply', () => {
    expect(pastAction('mail.draft', { subject: 'Brake kit' })).toBe('Drafted a new email');
    expect(pastAction('mail.draft', { to: 'priya@example.com', body: 'x' })).toBe('Drafted an email to priya@example.com');
    expect(describeAction('mail.draft', { replyTo: 'm1', to: 'priya@example.com' })).toBe('draft a reply for you to send');
  });
  it('several of the same in a row read as one line', () => {
    const six = Array.from({ length: 6 }, (_, i) => ({ list: 'P2 build', text: `Step ${i}` }));
    expect(groupSummary('tasks.add', six)).toBe('Added 6 tasks to P2 build');
    expect(groupSummary('calendar.add', [{}, {}, {}])).toBe('Added 3 events to the calendar');
  });
  it('a row opens what it made', () => {
    expect(toolTarget('tasks.add', { list: 'P2 build', text: 'x' })).toEqual({ app: 'tasks', list: 'P2 build' });
    expect(toolTarget('files.write', { path: 'docs/Kestrel/P2.md' })).toEqual({ app: 'docs', path: 'Kestrel/P2.md', title: 'P2' });
    expect(toolTarget('sheets.write', { workbook: 'Kestrel', sheet: 'Costs' })).toEqual({ app: 'sheets', workbook: 'Kestrel', sheet: 'Costs' });
    expect(toolTarget('clock.now', {})).toBeNull();
  });
});

import { changeTarget } from './actions';
describe('each change a turn made opens where it is', () => {
  it('notes, lists, sheets and the calendar', () => {
    expect(changeTarget('notes/Work/Ideas.md')).toEqual({ app: 'notes', path: 'Work/Ideas.md', title: 'Ideas' });
    expect(changeTarget('tasks/P2 build.md')).toEqual({ app: 'tasks', list: 'P2 build' });
    expect(changeTarget('sheets/Kestrel/Costs.csv')).toEqual({ app: 'sheets', workbook: 'Kestrel', sheet: 'Costs' });
    expect(changeTarget('calendar/Work.ics')).toEqual({ app: 'calendar' });
    expect(changeTarget('drafts/x.txt')).toBeNull();
  });
});
