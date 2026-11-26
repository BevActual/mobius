import { describe, expect, it } from 'vitest';
import { mailAssignment, taskAssignment } from './assign';

describe('Assign to Mobius', () => {
  it('asks about a task by its list, text, notes and deadline, and leaves the tick unless it is finished', () => {
    const a = taskAssignment('Home', { text: 'Fix  the tap', notes: 'Kitchen, drips at night', due: '2026-12-01' });
    expect(a.app).toBe('tasks');
    expect(a.title).toBe('Fix the tap');
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
    expect(a.ask).toContain('"Quote for March" from Ana <ana@example.com> (message id acc:42)');
    expect(a.ask).toContain('Do not send anything');
    expect(mailAssignment({ id: '1', subject: ' ', from: { email: 'b@example.com' } }).ask).toContain('"(no subject)" from b@example.com');
  });
});
