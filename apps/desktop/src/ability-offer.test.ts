import { describe, expect, it } from 'vitest';
import type { Message } from '@mobius/shared';
import { abilityAsk, jobSteps } from './ability-offer';

const history: Message[] = [
  { role: 'user', text: 'An older ask' },
  { role: 'assistant', text: 'Done.', tool_calls: [{ id: 'o', name: 'notes.read', arguments: {} }] },
  { role: 'user', text: 'File invoice 42 and add a task to pay it' },
  { role: 'assistant', text: '', tool_calls: [{ id: 'a', name: 'mail.read', arguments: { id: 'm-42' } }, { id: 'b', name: 'files.move', arguments: { from: 'x' } }] },
  { role: 'tool', call_id: 'a', name: 'mail.read', content: '…', is_error: false },
  { role: 'tool', call_id: 'b', name: 'files.move', content: 'no such file', is_error: true },
  { role: 'assistant', text: '', tool_calls: [{ id: 'c', name: 'files.write', arguments: { path: 'docs/Invoices/42.md', text: 'a'.repeat(200) } }, { id: 'd', name: 'tasks.add', arguments: { text: 'Pay invoice 42' } }] },
  { role: 'assistant', text: 'Filed it and added a task.', tool_calls: [] },
];

describe('a job saved as an Ability', () => {
  it('is the last ask, its steps in order without the failed ones, and its answer', () => {
    const job = jobSteps(history);
    expect(job.ask).toBe('File invoice 42 and add a task to pay it');
    expect(job.steps.map((s) => s.split(' ')[0])).toEqual(['mail.read', 'files.write', 'tasks.add']);
    expect(job.steps[1]!.length).toBeLessThan(160);
    expect(job.answer).toBe('Filed it and added a task.');
  });
  it('asks for one general SKILL.md without doing the job again', () => {
    const ask = abilityAsk('Invoice 42', jobSteps(history));
    expect(ask.split('\n')[0]).toBe('Save "Invoice 42" as an Ability');
    expect(ask).toContain('skills/<name>/SKILL.md');
    expect(ask).toContain('Do not do the job again');
    expect(ask).toContain('1. mail.read (id: m-42)');
  });
});
