import { describe, expect, it } from 'vitest';
import { describeAction } from './actions';

describe('actions in plain words', () => {
  it('says what each tool would do, with what it would touch', () => {
    expect(describeAction('browser.open', { url: 'https://www.example.com/a?b' })).toBe('open www.example.com in the browser');
    expect(describeAction('tasks.add', { list: 'Inbox', text: 'Water the plants' })).toBe('add “Water the plants” to Inbox in Tasks');
    expect(describeAction('files.write', { path: 'notes/Work/Plan.md' })).toBe('write the note “Work › Plan”');
    expect(describeAction('files.edit', { path: 'tasks/Groceries.md' })).toBe('change the task list “Groceries”');
    expect(describeAction('calendar.add', { title: 'Dentist', start: 'nonsense' })).toBe('add “Dentist” to your calendar on nonsense');
    expect(describeAction('calendar.add', {})).toBe('add an event to your calendar');
    expect(describeAction('calendar.list', {})).toBe('read your calendar');
    expect(describeAction('memory.remember', { text: 'Prefers boutique hotels' })).toBe('remember that “Prefers boutique hotels”');
    expect(describeAction('sessions.search', { query: 'casa amora' })).toBe('search your past conversations for “casa amora”');
  });
  it('has no words for tools it does not know, and copes with missing arguments', () => {
    expect(describeAction('mcp.github.create_issue', {})).toBeNull();
    expect(describeAction('browser.open', null)).toBe('open a page in the browser');
    expect(describeAction('tasks.add', { text: 'x'.repeat(200) })).toMatch(/^add “x+…” to Inbox in Tasks$/);
  });
});
