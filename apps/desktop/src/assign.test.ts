import { describe, expect, it } from 'vitest';
import { mailAssignment, pageAssignment, projectAssignment, taskAssignment } from './assign';

describe('Assign to Mobius', () => {
  it('asks to move a project forward from its list, target and last update, leaving ticks to the person', () => {
    const a = projectAssignment({ name: 'Offsite', list: 'Offsite', target: '2026-12-10', updates: [{ text: 'Old' }, { text: 'Venue shortlisted' }] });
    expect(a).toMatchObject({ app: 'projects', title: 'Offsite' });
    expect(a.ask).toContain('my Tasks list "Offsite"');
    expect(a.ask).toContain('done by 2026-12-10');
    expect(a.ask).toContain('Its last update says: "Venue shortlisted".');
    expect(a.ask).toContain('leaving ticks');
    expect(projectAssignment({ name: 'Bare' }).ask).not.toContain('Tasks list');
  });
  it('asks about a note or a document by its title and path, in its own app', () => {
    const n = pageAssignment('notes', { path: 'Work/Plan.md', title: 'Plan' });
    expect(n).toMatchObject({ app: 'notes', title: 'Plan' });
    expect(n.ask.startsWith('Plan\n\n')).toBe(true);
    expect(n.ask).toContain('my note in Notes "Plan" (notes/Work/Plan.md)');
    expect(n.ask).toContain('Add to it only where it asks you to.');
    const d = pageAssignment('docs', { path: 'Offsite brief.md', title: '' });
    expect(d).toMatchObject({ app: 'docs', title: 'Document' });
    expect(d.ask).toContain('document in Docs');
  });
  it('asks about a task by its list, text, notes and deadline, and leaves the tick unless it is finished', () => {
    const a = taskAssignment('Home', { text: 'Fix  the tap', notes: 'Kitchen, drips at night', due: '2026-12-01' });
    expect(a.app).toBe('tasks');
    expect(a.title).toBe('Fix the tap');
    // The first line names the chat it runs in (Also running, All chats).
    expect(a.ask.split('\n')[0]).toBe('Fix the tap');
    expect(a.ask).toContain('my Tasks list "Home": "Fix the tap".');
    expect(a.ask).toContain('Its notes say: "Kitchen, drips at night".');
    expect(a.ask).toContain('It is due 2026-12-01.');
    expect(a.ask).toContain('Only mark the task done if it is completely finished.');
  });
  it('leaves out notes and a deadline it does not have, and keeps a long title short', () => {
    const a = taskAssignment('Work', { text: 'x'.repeat(120) });
    expect(a.ask).not.toContain('notes say');
    expect(a.ask).not.toContain('due');
    expect(a.title).toHaveLength(80);
    expect(a.title.endsWith('…')).toBe(true);
  });
  it('asks about a message by subject, sender and id, and sends nothing', () => {
    const a = mailAssignment({ id: 'acc:42', subject: 'Quote for March', from: { name: 'Ana', email: 'ana@example.com' } });
    expect(a.app).toBe('mail');
    expect(a.title).toBe('Quote for March');
    expect(a.ask.startsWith('Quote for March\n\n')).toBe(true);
    expect(a.ask).toContain('"Quote for March" from Ana <ana@example.com> (message id acc:42)');
    expect(a.ask).toContain('Do not send anything');
    expect(mailAssignment({ id: '1', subject: ' ', from: { email: 'b@example.com' } }).ask).toContain('"(no subject)" from b@example.com');
  });
});
