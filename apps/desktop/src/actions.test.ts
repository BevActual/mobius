import { describe, expect, it } from 'vitest';
import { describeAction, previewArguments } from './actions';

describe('actions in plain words', () => {
  it('says what each tool would do, with what it would touch', () => {
    expect(describeAction('browser.open', { url: 'https://www.example.com/a?b' })).toBe('open www.example.com in the browser');
    expect(describeAction('tasks.add', { list: 'Inbox', text: 'Water the plants' })).toBe('add “Water the plants” to Inbox in Tasks');
    expect(describeAction('files.write', { path: 'notes/Work/Plan.md' })).toBe('write the note “Work › Plan”');
    expect(describeAction('files.edit', { path: 'tasks/Groceries.md' })).toBe('change the task list “Groceries”');
    expect(describeAction('calendar.add', { title: 'Dentist', start: 'nonsense' })).toBe('add “Dentist” to your calendar on nonsense');
    expect(describeAction('calendar.add', {})).toBe('add an event to your calendar');
    expect(describeAction('calendar.list', {})).toBe('read your calendar');
    expect(describeAction('calendar.update', { calendar: 'Work (iCloud)', id: 'x' })).toBe('change an event in the calendar “Work (iCloud)”');
    expect(describeAction('memory.remember', { text: 'Prefers boutique hotels' })).toBe('remember that “Prefers boutique hotels”');
    expect(describeAction('sessions.search', { query: 'casa amora' })).toBe('search your past conversations for “casa amora”');
  });
  it('says what the newer apps’ tools would do, and previews what they would use', () => {
    expect(describeAction('files.write', { path: 'boards/Offsite/Ideas.json' })).toBe('write the board “Offsite › Ideas”');
    expect(describeAction('files.edit', { path: 'code/site/src/app.ts' })).toBe('change “src/app.ts” in the project “site”');
    expect(describeAction('db.execute', { database: 'Trips', sql: 'DELETE FROM x' })).toBe('change the database “Trips”');
    expect(describeAction('web.search', { query: 'lisbon venues' })).toBe('search the web for “lisbon venues”');
    expect(previewArguments('files.write', { path: 'notes/a.md', content: '# Budget\n\n- Hotel\n' })).toEqual({ label: 'What it will write', text: '# Budget\n\n- Hotel', mono: false });
    expect(previewArguments('files.write', { path: 'boards/a.json', content: '{}' })?.mono).toBe(true);
    expect(previewArguments('files.write', { path: 'notes/a.md', content: Array.from({ length: 20 }, (_, i) => `l${i}`).join('\n') })?.text.endsWith('… 6 more lines')).toBe(true);
    expect(previewArguments('db.query', { sql: 'SELECT 1' })).toEqual({ label: 'The statement', text: 'SELECT 1', mono: true });
    expect(previewArguments('tasks.add', { text: 'x' })).toBeNull();
  });

  it('has no words for tools it does not know, and copes with missing arguments', () => {
    expect(describeAction('mcp.github.create_issue', {})).toBeNull();
    expect(describeAction('browser.open', null)).toBe('open a page in the browser');
    expect(describeAction('tasks.add', { text: 'x'.repeat(200) })).toMatch(/^add “x+…” to Inbox in Tasks$/);
  });
});
