import { describe, expect, it } from 'vitest';
import type { AgentNotification } from '@mobius/shared';
import { aboutPrompt, isQuestion, selectionNow, sourceOfTool, stepInline, translateCommand, type InlineAnswer } from './launcher-ask';

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

describe('about this', () => {
  const doc = (active: object | null, selected = '') => ({ activeElement: active, getSelection: () => ({ toString: () => selected }) }) as unknown as Document;
  it('takes the selected part of a field, else the selected text on the page', () => {
    expect(selectionNow(doc({ tagName: 'TEXTAREA', value: 'hello there world', selectionStart: 6, selectionEnd: 11 }))).toEqual({ text: 'there' });
    expect(selectionNow(doc({ tagName: 'DIV' }, '  Meet at 3  '))).toEqual({ text: 'Meet at 3' });
    expect(selectionNow(doc(null, 'x'))).toBeUndefined();
    expect(selectionNow(doc(null, 'abcdef'), 3)).toEqual({ text: 'abc…' });
  });
  it('reads "translate to french" as a command, and nothing else', () => {
    expect(translateCommand('translate to french')).toMatchObject({ label: 'Translate to French' });
    expect(translateCommand('Translate it into Spanish')).toMatchObject({ label: 'Translate to Spanish' });
    expect(translateCommand('translate to french')!.instruction).toMatch(/names of people, companies and products as they are/);
    expect(translateCommand('translate')).toBeNull();
    expect(translateCommand('notes')).toBeNull();
  });
  it('sends the instruction with the selection quoted after it', () => {
    expect(aboutPrompt('Summarize', 'Summarize this.', { text: 'A long note' })).toBe('Summarize: “A long note”\n\nSummarize this.\n\nThe selected text:\n"""\nA long note\n"""');
    // Titled by its first line: the command and the start of the selection, on one line.
    expect(aboutPrompt('Explain', 'Explain this simply.', { text: 'Hi Maya,\nthe harness lead time is now six weeks' }).split('\n')[0]).toBe('Explain: “Hi Maya, the harness lead time is now s…”');
    // A question typed about it is its own first line.
    expect(aboutPrompt('who sent this?', 'who sent this?', { text: 'x' }).split('\n')[0]).toBe('who sent this?');
  });
});
