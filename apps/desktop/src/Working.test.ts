import { describe, expect, it } from 'vitest';
import { stepCount, workingOf } from './Working';
import { initialConversation, type ConversationState, type Item } from './conversation';

const busy = (items: Item[]): ConversationState => ({ ...initialConversation('c'), items, busy: true });
const tool = (name: string, status: 'running' | 'done', args?: unknown): Item => ({ kind: 'tool', id: name + status, callId: name, name, status, args });

describe('the working indicator', () => {
  it('numbers this turn\'s tools, each naming its app, and counts without a total', () => {
    const w = workingOf(busy([{ kind: 'user', id: 'u0', text: 'old' }, tool('mail.read', 'done'), { kind: 'user', id: 'u1', text: 'now' }, tool('calendar.list', 'done'), tool('sheets.read', 'running')]));
    expect(w.steps).toEqual([
      { n: 1, label: 'Reading your calendar', done: true },
      { n: 2, label: 'Reading a sheet in Sheets', done: false },
    ]);
    expect(stepCount(w)).toBe('02');
  });
  it('follows the plan when there is one: 02/03', () => {
    const plan: Item = { kind: 'plan', id: 'p', items: [{ text: 'Find the dates', status: 'done' }, { text: 'Draft the reply', status: 'in_progress' }, { text: 'Add a task', status: 'pending' }] };
    const w = workingOf(busy([{ kind: 'user', id: 'u', text: 'go' }, plan, tool('mail.read', 'running')]));
    expect(w.steps.map((s) => s.label)).toEqual(['Find the dates', 'Draft the reply', 'Add a task']);
    expect(stepCount(w)).toBe('02/03');
  });
  it('starts at step 01 before any tool runs', () => {
    expect(stepCount(workingOf(busy([{ kind: 'user', id: 'u', text: 'hi' }])))).toBe('01');
  });
});
