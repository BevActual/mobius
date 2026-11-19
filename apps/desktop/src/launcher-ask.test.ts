import { describe, expect, it } from 'vitest';
import type { AgentNotification } from '@mobius/shared';
import { isQuestion, sourceOfTool, stepInline, type InlineAnswer } from './launcher-ask';

const start: InlineAnswer = { conversation: 'c', text: '', state: 'asking', sources: [] };
const ev = (event: object): AgentNotification => ({ method: 'agent.event', params: { conversation: 'c', turn: 1, event } } as AgentNotification);

describe('ask inline', () => {
  it('answers questions here and sends other words to the panel', () => {
    expect(isQuestion('what lead time did Maya give for the harness')).toBe(true);
    expect(isQuestion('lead time for the harness?')).toBe(true);
    expect(isQuestion('draft a reply to Maya')).toBe(false);
    expect(isQuestion('how')).toBe(false);
  });
  it('names the apps it read, not its own tools', () => {
    expect(sourceOfTool('mail.search')).toBe('Mail');
    expect(sourceOfTool('notes_read')).toBe('Notes');
    expect(sourceOfTool('todo.write')).toBeNull();
  });
  it('streams the words, settles on the message, and keeps each source once', () => {
    let a = stepInline(start, ev({ kind: 'tool_call', call_id: '1', name: 'mail.search', arguments: {} }));
    a = stepInline(a, ev({ kind: 'tool_call', call_id: '2', name: 'mail.read', arguments: {} }));
    a = stepInline(a, { method: 'agent.delta', params: { conversation: 'c', turn: 1, text: 'Six ' } });
    a = stepInline(a, { method: 'agent.delta', params: { conversation: 'c', turn: 1, text: 'weeks' } });
    expect(a.text).toBe('Six weeks');
    a = stepInline(a, ev({ kind: 'message', text: 'Six weeks, up from four.' }));
    a = stepInline(a, ev({ kind: 'done' }));
    expect(a).toMatchObject({ text: 'Six weeks, up from four.', state: 'done', sources: ['Mail'] });
  });
  it('ignores other conversations, and hands work that needs you to the panel', () => {
    expect(stepInline(start, { method: 'agent.delta', params: { conversation: 'other', turn: 1, text: 'x' } })).toBe(start);
    expect(stepInline(start, ev({ kind: 'needs_approval', request_id: 1, call_id: '1', tool: 'mail.send', arguments: {}, once_only: false })).state).toBe('failed');
  });
});
