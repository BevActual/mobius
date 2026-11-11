import { describe, expect, it } from 'vitest';
import type { AgentEvent, Message } from '@mobius/shared';
import { dataOf, MAX_RESULT_SHOWN, findToolArguments, findToolResult, appsSeen, initialConversation, replySources, proposedPlan, reduce, type ConversationState } from './conversation';

const note = (event: AgentEvent, turn = 1) => ({ type: 'notification' as const, notification: { method: 'agent.event' as const, params: { conversation: 'main', turn, event } } });
const delta = (text: string, turn = 1) => ({ type: 'notification' as const, notification: { method: 'agent.delta' as const, params: { conversation: 'main', turn, text } } });
const run = (...actions: Parameters<typeof reduce>[1][]): ConversationState => actions.reduce(reduce, initialConversation('main'));
const kinds = (s: ConversationState) => s.items.map((i) => i.kind);

describe('conversation state', () => {
  it('shows what you sent and marks the conversation busy', () => {
    const s = run({ type: 'sent', text: 'hello', turn: 1 });
    expect(s.items).toMatchObject([{ kind: 'user', text: 'hello' }]);
    expect(s.busy).toBe(true);
    expect(s.turn).toBe(1);
  });

  it('shows your message at once and learns the turn from the first news about it, even if that overtakes the confirmation', () => {
    const s = run({ type: 'sent', text: 'hi' }, delta('Hey', 5), note({ kind: 'message', text: 'Hey' }, 5));
    expect(kinds(s)).toEqual(['user', 'assistant']);
    expect(s.turn).toBe(5);
    expect(s.busy).toBe(true);
  });

  it('shows a send that failed as an error and stops waiting', () => {
    const s = run({ type: 'sent', text: 'hi' }, { type: 'send-failed', message: 'no model is set up yet' });
    expect(s.items.at(-1)).toMatchObject({ kind: 'error', text: 'no model is set up yet' });
    expect(s.busy).toBe(false);
    expect(s.turn).toBeNull();
  });

  it('streams text into one assistant bubble and settles it on the final message', () => {
    let s = run({ type: 'sent', text: 'hi', turn: 1 }, delta('Hel'), delta('lo'));
    expect(s.items.at(-1)).toMatchObject({ kind: 'assistant', text: 'Hello', streaming: true });
    s = reduce(s, note({ kind: 'message', text: 'Hello there' }));
    expect(s.items.filter((i) => i.kind === 'assistant')).toHaveLength(1);
    expect(s.items.at(-1)).toMatchObject({ kind: 'assistant', text: 'Hello there', streaming: false });
    s = reduce(s, note({ kind: 'done' }));
    expect(s.busy).toBe(false);
  });

  it('shows a message that arrived without any streaming', () => {
    const s = run({ type: 'sent', text: 'hi', turn: 1 }, note({ kind: 'message', text: 'Whole.' }));
    expect(s.items.at(-1)).toMatchObject({ kind: 'assistant', text: 'Whole.', streaming: false });
  });

  it('starts a fresh bubble for text after a tool call', () => {
    const s = run(
      { type: 'sent', text: 'go', turn: 1 },
      delta('One moment.'),
      note({ kind: 'message', text: 'One moment.' }),
      note({ kind: 'tool_call', call_id: 'c1', name: 'clock.now' }),
      note({ kind: 'tool_result', call_id: 'c1', name: 'clock.now', is_error: false }),
      delta('It is noon.'),
      note({ kind: 'message', text: 'It is noon.' }),
      note({ kind: 'done' }),
    );
    expect(kinds(s)).toEqual(['user', 'assistant', 'tool', 'assistant']);
  });

  it('follows a tool through waiting for approval to done', () => {
    let s = run({ type: 'sent', text: 'go', turn: 1 }, note({ kind: 'tool_call', call_id: 'c1', name: 'clock.now' }));
    expect(s.items.at(-1)).toMatchObject({ kind: 'tool', status: 'running' });
    s = reduce(s, note({ kind: 'needs_approval', request_id: 9, call_id: 'c1', tool: 'clock.now', arguments: { a: 1 }, once_only: false }));
    expect(s.items.at(-1)).toMatchObject({ kind: 'tool', status: 'waiting', requestId: 9, args: { a: 1 } });
    expect(s.busy).toBe(true);
    s = reduce(s, { type: 'answered', requestId: 9, approve: true });
    expect(s.items.at(-1)).toMatchObject({ status: 'running' });
    s = reduce(s, note({ kind: 'tool_call', call_id: 'c1', name: 'clock.now' }));
    expect(s.items.filter((i) => i.kind === 'tool')).toHaveLength(1);
    s = reduce(s, note({ kind: 'tool_result', call_id: 'c1', name: 'clock.now', is_error: false }));
    expect(s.items.at(-1)).toMatchObject({ status: 'done' });
  });

  it('treats a call id that a server reuses in a later turn as a new call, not the old one', () => {
    const s = run(
      { type: 'sent', text: 'one', turn: 1 },
      note({ kind: 'tool_call', call_id: 'call_1', name: 'browser.open' }),
      note({ kind: 'tool_result', call_id: 'call_1', name: 'browser.open', is_error: false }),
      note({ kind: 'done' }),
      { type: 'sent', text: 'two' },
      note({ kind: 'tool_call', call_id: 'call_1', name: 'browser.read' }, 2),
      note({ kind: 'needs_approval', request_id: 9, call_id: 'call_1', tool: 'browser.read', arguments: {}, once_only: false }, 2),
    );
    const tools = s.items.filter((i) => i.kind === 'tool');
    expect(tools).toMatchObject([{ name: 'browser.open', status: 'done' }, { name: 'browser.read', status: 'waiting', requestId: 9 }]);
  });

  it('remembers a decline even though the model is then told about an error', () => {
    let s = run({ type: 'sent', text: 'go', turn: 1 }, note({ kind: 'tool_call', call_id: 'c1', name: 'x' }), note({ kind: 'needs_approval', request_id: 2, call_id: 'c1', tool: 'x', arguments: {}, once_only: false }), { type: 'answered', requestId: 2, approve: false });
    expect(s.items.at(-1)).toMatchObject({ status: 'declined' });
    s = reduce(s, note({ kind: 'tool_result', call_id: 'c1', name: 'x', is_error: true }));
    expect(s.items.at(-1)).toMatchObject({ status: 'declined' });
  });

  it('shows a tool that failed as failed', () => {
    const s = run({ type: 'sent', text: 'go', turn: 1 }, note({ kind: 'tool_call', call_id: 'c1', name: 'x' }), note({ kind: 'tool_result', call_id: 'c1', name: 'x', is_error: true }));
    expect(s.items.at(-1)).toMatchObject({ kind: 'tool', status: 'failed' });
  });

  it('ends cleanly on failure, and on cancel it closes anything still waiting', () => {
    let s = run({ type: 'sent', text: 'go', turn: 1 }, delta('part'), note({ kind: 'failed', message: 'HTTP 500' }));
    expect(s.busy).toBe(false);
    expect(s.items.at(-1)).toMatchObject({ kind: 'error', text: 'HTTP 500' });
    expect(s.items.find((i) => i.kind === 'assistant')).toMatchObject({ streaming: false });

    s = run({ type: 'sent', text: 'go', turn: 1 }, note({ kind: 'tool_call', call_id: 'c1', name: 'x' }), note({ kind: 'needs_approval', request_id: 2, call_id: 'c1', tool: 'x', arguments: {}, once_only: false }), note({ kind: 'cancelled' }));
    expect(s.busy).toBe(false);
    expect(s.items.at(-1)).toMatchObject({ kind: 'tool', status: 'cancelled' });
  });

  it('ignores news about other conversations and other turns', () => {
    const base = run({ type: 'sent', text: 'hi', turn: 2 });
    const other = { type: 'notification' as const, notification: { method: 'agent.delta' as const, params: { conversation: 'elsewhere', turn: 2, text: 'x' } } };
    expect(reduce(base, other)).toBe(base);
    expect(reduce(base, delta('late', 1))).toBe(base);
    expect(reduce(base, note({ kind: 'done' }, 1))).toBe(base);
  });

  it('loads a saved conversation, folding tool results into their calls', () => {
    const messages: Message[] = [
      { role: 'user', text: 'what time is it' },
      { role: 'assistant', text: 'Checking.', tool_calls: [{ id: 'c1', name: 'clock.now', arguments: {} }] },
      { role: 'tool', call_id: 'c1', name: 'clock.now', content: '{"utc":"x"}', is_error: false },
      { role: 'assistant', text: 'It is noon.', tool_calls: [] },
      { role: 'user', text: 'and again' },
      { role: 'assistant', text: '', tool_calls: [{ id: 'c2', name: 'clock.now', arguments: {} }] },
      { role: 'tool', call_id: 'c2', name: 'clock.now', content: 'denied: no', is_error: true },
    ];
    const s = reduce(initialConversation('main'), { type: 'loaded', messages });
    expect(kinds(s)).toEqual(['user', 'assistant', 'tool', 'assistant', 'user', 'tool']);
    expect(s.items.filter((i) => i.kind === 'tool')).toMatchObject([{ status: 'done' }, { status: 'failed' }]);
    expect(s.busy).toBe(false);
  });

  it('does not let loading history wipe a turn that is in progress', () => {
    const mid = run({ type: 'sent', text: 'hi', turn: 1 }, delta('par'));
    expect(reduce(mid, { type: 'loaded', messages: [] })).toBe(mid);
  });

  it('shows a call that was still running when the window loaded as running, not done', () => {
    const s = reduce(initialConversation('main'), { type: 'loaded', messages: [{ role: 'user', text: 'go' }, { role: 'assistant', text: '', tool_calls: [{ id: 'c1', name: 'clock.now', arguments: {} }] }] });
    expect(s.items.at(-1)).toMatchObject({ kind: 'tool', callId: 'c1', status: 'running' });
  });

  it('attaches a waiting question to the call it belongs to instead of adding a second row', () => {
    const loaded = reduce(initialConversation('main'), { type: 'loaded', messages: [{ role: 'user', text: 'go' }, { role: 'assistant', text: '', tool_calls: [{ id: 'c1', name: 'clock.now', arguments: {} }] }] });
    const s = reduce(loaded, { type: 'pending', requests: [{ requestId: 5, callId: 'c1', tool: 'clock.now', arguments: { a: 1 }, onceOnly: false }] });
    expect(s.items.filter((i) => i.kind === 'tool')).toHaveLength(1);
    expect(s.items.at(-1)).toMatchObject({ status: 'waiting', requestId: 5, args: { a: 1 } });
    expect(s.busy).toBe(true);
    expect(reduce(s, { type: 'pending', requests: [{ requestId: 5, callId: 'c1', tool: 'clock.now', arguments: { a: 1 }, onceOnly: false }] }).items).toHaveLength(s.items.length);
  });

  it('adds the row when the call itself was not in the history', () => {
    const s = reduce(initialConversation('main'), { type: 'pending', requests: [{ requestId: 5, callId: 'c9', tool: 'clock.now', arguments: {}, onceOnly: false }] });
    expect(s.items.at(-1)).toMatchObject({ kind: 'tool', callId: 'c9', status: 'waiting', requestId: 5, name: 'clock.now' });
  });

  it('shows the answer at once, and puts the question back if the answer could not be used', () => {
    const waiting = run({ type: 'sent', text: 'go', turn: 1 }, note({ kind: 'tool_call', call_id: 'c1', name: 'x' }), note({ kind: 'needs_approval', request_id: 2, call_id: 'c1', tool: 'x', arguments: {}, once_only: false }));
    const answered = reduce(waiting, { type: 'answered', requestId: 2, approve: false });
    expect(answered.items.at(-1)).toMatchObject({ status: 'declined' });
    // the result can arrive before the answer's own confirmation does
    const afterResult = reduce(answered, note({ kind: 'tool_result', call_id: 'c1', name: 'x', is_error: true }));
    expect(afterResult.items.at(-1)).toMatchObject({ status: 'declined' });
    expect(reduce(answered, { type: 'answer-failed', requestId: 2 }).items.at(-1)).toMatchObject({ status: 'waiting', requestId: 2 });
    const allowed = reduce(waiting, { type: 'answered', requestId: 2, approve: true });
    expect(reduce(allowed, { type: 'answer-failed', requestId: 2 }).items.at(-1)).toMatchObject({ status: 'waiting' });
    const finished = reduce(allowed, note({ kind: 'tool_result', call_id: 'c1', name: 'x', is_error: false }));
    expect(reduce(finished, { type: 'answer-failed', requestId: 2 }).items.at(-1)).toMatchObject({ status: 'done' });
  });

  it('starts afresh when switching to another conversation, and then only listens to that one', () => {
    const busy = run({ type: 'sent', text: 'hello', turn: 1 }, delta('par'));
    const switched = reduce(busy, { type: 'switch', conversation: 'other' });
    expect(switched).toEqual(initialConversation('other'));
    expect(reduce(switched, delta('late'))).toBe(switched);
    const own = { type: 'notification' as const, notification: { method: 'agent.delta' as const, params: { conversation: 'other', turn: 7, text: 'hi' } } };
    expect(reduce(switched, own).items.at(-1)).toMatchObject({ kind: 'assistant', text: 'hi' });
  });

  it('stops being busy when asked to reset, closing any tool that was still open', () => {
    const open = run({ type: 'sent', text: 'hi', turn: 1 }, note({ kind: 'tool_call', call_id: 'c1', name: 'x' }), note({ kind: 'needs_approval', request_id: 2, call_id: 'c1', tool: 'x', arguments: {}, once_only: false }));
    const s = reduce(open, { type: 'reset-busy' });
    expect(s.busy).toBe(false);
    expect(s.items.at(-1)).toMatchObject({ kind: 'tool', status: 'cancelled' });
  });
});

describe('actions that can only be allowed once', () => {
  it('are marked so from the event and after a reload, and everything else is not', () => {
    const live = run({ type: 'sent', text: 'go', turn: 1 }, note({ kind: 'tool_call', call_id: 'c1', name: 'browser.click' }), note({ kind: 'needs_approval', request_id: 2, call_id: 'c1', tool: 'browser.click', arguments: {}, once_only: true }));
    expect(live.items.find((i) => i.kind === 'tool')).toMatchObject({ status: 'waiting', onceOnly: true });
    const plain = run({ type: 'sent', text: 'go', turn: 1 }, note({ kind: 'needs_approval', request_id: 3, call_id: 'c2', tool: 'browser.read', arguments: {}, once_only: false }));
    expect(plain.items.find((i) => i.kind === 'tool')).toMatchObject({ onceOnly: false });
    const reloaded = run({ type: 'pending', requests: [{ requestId: 4, callId: 'c3', tool: 'browser.type', arguments: {}, onceOnly: true }] });
    expect(reloaded.items.find((i) => i.kind === 'tool')).toMatchObject({ status: 'waiting', onceOnly: true });
  });
});

describe('taking back the last exchange', () => {
  it('removes the last message from the person and everything after it, and keeps the earlier ones', () => {
    const s = run(
      { type: 'loaded', messages: [{ role: 'user', text: 'one' }, { role: 'assistant', text: 'a', tool_calls: [] }, { role: 'user', text: 'two' }, { role: 'assistant', text: 'b', tool_calls: [{ id: 'c1', name: 'x', arguments: {} }] }, { role: 'tool', call_id: 'c1', name: 'x', content: 'r', is_error: false }] as never },
      { type: 'rewound' },
    );
    expect(s.items.map((i) => (i.kind === 'user' || i.kind === 'assistant' ? i.text : i.kind))).toEqual(['one', 'a']);
    expect(s.busy).toBe(false);
  });
  it('empties a conversation with one exchange, and does nothing to one with no person message', () => {
    expect(run({ type: 'sent', text: 'hi', turn: 1 }, { type: 'reset-busy' }, { type: 'rewound' }).items).toEqual([]);
    const empty = initialConversation('c');
    expect(reduce(empty, { type: 'rewound' })).toEqual(empty);
  });
});

describe('finding what a tool returned', () => {
  const messages: Message[] = [
    { role: 'user', text: 'go' },
    { role: 'assistant', text: '', tool_calls: [{ id: 'c1', name: 'a', arguments: {} }, { id: 'c2', name: 'b', arguments: {} }] },
    { role: 'tool', call_id: 'c1', name: 'a', content: 'first result', is_error: false },
    { role: 'tool', call_id: 'c2', name: 'b', content: 'it broke', is_error: true },
  ] as Message[];
  it('gives the result of the call with that id, and whether it was an error', () => {
    expect(findToolResult(messages, 'c1')).toEqual({ text: 'first result', isError: false, truncated: false });
    expect(findToolResult(messages, 'c2')).toEqual({ text: 'it broke', isError: true, truncated: false });
  });
  it('says nothing when there is no such result', () => {
    expect(findToolResult(messages, 'c9')).toBeNull();
    expect(findToolResult([], 'c1')).toBeNull();
  });
  it('uses the newest result when an id was used more than once, and shortens very long ones', () => {
    const reused = [...messages, { role: 'tool', call_id: 'c1', name: 'a', content: 'x'.repeat(MAX_RESULT_SHOWN + 50), is_error: false }] as Message[];
    const found = findToolResult(reused, 'c1');
    expect(found?.text).toHaveLength(MAX_RESULT_SHOWN);
    expect(found?.truncated).toBe(true);
  });
});

describe('finding what a tool was asked to do', () => {
  const messages = [
    { role: 'user', text: 'go' },
    { role: 'assistant', text: '', tool_calls: [{ id: 'c1', name: 'a', arguments: { url: 'https://x.example/' } }] },
  ] as Message[];
  it('gives the arguments of the call with that id', () => {
    expect(findToolArguments(messages, 'c1')).toEqual({ url: 'https://x.example/' });
    expect(findToolArguments(messages, 'c2')).toBeUndefined();
    expect(findToolArguments([], 'c1')).toBeUndefined();
  });
});

describe('a second model taking over', () => {
  const notice = (turn = 1) => ({ method: 'agent.notice' as const, params: { conversation: 'main', turn, kind: 'fallback' as const, model: 'backup-model', why: 'the first model could not be reached' } });
  it('adds a plain line saying which model answered and why, before the answer', () => {
    const s = run({ type: 'sent', text: 'hi', turn: 1 }, { type: 'notification', notification: notice() }, note({ kind: 'message', text: 'from the backup' }));
    expect(s.items.map((i) => (i.kind === 'notice' ? `notice:${i.text}` : i.kind))).toEqual(['user', 'notice:Switched to backup-model because the first model could not be reached.', 'assistant']);
    expect(s.busy).toBe(true);
  });
  it('is ignored for another conversation or turn', () => {
    const base = run({ type: 'sent', text: 'hi', turn: 1 });
    expect(reduce(base, { type: 'notification', notification: { ...notice(), params: { ...notice().params, conversation: 'other' } } })).toEqual(base);
    expect(reduce(base, { type: 'notification', notification: notice(9) })).toEqual(base);
  });
});

describe('a long conversation being summarised', () => {
  it('adds a plain line, keeps the turn going and keeps everything already shown', () => {
    const s = run({ type: 'sent', text: 'hi', turn: 1 }, note({ kind: 'compacted', messages: 12 }), note({ kind: 'message', text: 'answer' }));
    expect(s.items.map((i) => (i.kind === 'notice' ? `notice:${i.text}` : i.kind))).toEqual(['user', 'notice:Earlier messages were summarised to make room for the model. They are still here for you.', 'assistant']);
    expect(s.busy).toBe(true);
  });
});

describe('how full the model window is', () => {
  it('keeps the latest estimate, adds nothing to the conversation, and forgets it for another conversation', () => {
    const s = run({ type: 'sent', text: 'hi', turn: 1 }, note({ kind: 'context', used: 1000, limit: 40000 }), note({ kind: 'context', used: 3000, limit: 40000 }));
    expect(s.context).toEqual({ used: 3000, limit: 40000 });
    expect(s.items.map((i) => i.kind)).toEqual(['user']);
    expect(reduce(s, { type: 'switch', conversation: 'other' }).context).toBeUndefined();
  });
});

describe('the plan and questions', () => {
  const plan = (items: Array<[string, 'pending' | 'in_progress' | 'done']>) => note({ kind: 'todo', items: items.map(([text, status]) => ({ text, status })) });

  it('shows one plan per turn and updates it in place, without tool steps for it', () => {
    const s = run(
      { type: 'sent', text: 'do it', turn: 1 },
      note({ kind: 'tool_call', call_id: 't1', name: 'todo.write' }),
      plan([['Read', 'in_progress'], ['Write', 'pending']]),
      note({ kind: 'tool_result', call_id: 't1', name: 'todo.write', is_error: false }),
      plan([['Read', 'done'], ['Write', 'in_progress']]),
    );
    expect(kinds(s)).toEqual(['user', 'plan']);
    expect(s.items[1]).toMatchObject({ kind: 'plan', items: [{ text: 'Read', status: 'done' }, { text: 'Write', status: 'in_progress' }] });
    const next = [{ type: 'notification' as const, notification: { method: 'agent.event' as const, params: { conversation: 'main', turn: 1, event: { kind: 'done' as const } } } }, { type: 'sent' as const, text: 'again', turn: 2 }, note({ kind: 'todo', items: [{ text: 'New', status: 'pending' }] }, 2)].reduce(reduce, s);
    expect(kinds(next)).toEqual(['user', 'plan', 'user', 'plan']);
  });

  it('shows a question, waits, and records the answer', () => {
    let s = run({ type: 'sent', text: 'pick', turn: 1 }, note({ kind: 'tool_call', call_id: 'q1', name: 'ask.person' }), note({ kind: 'question', call_id: 'q1', question: 'Which?', choices: ['A', 'B'] }));
    expect(kinds(s)).toEqual(['user', 'question']);
    expect(s.items[1]).toMatchObject({ status: 'open', question: 'Which?', choices: ['A', 'B'] });
    s = reduce(s, { type: 'question-answered', callId: 'q1', text: 'B' });
    expect(s.items[1]).toMatchObject({ status: 'sending', answer: 'B' });
    expect(reduce(s, { type: 'question-failed', callId: 'q1' }).items[1]).toMatchObject({ status: 'open' });
    s = reduce(s, note({ kind: 'tool_result', call_id: 'q1', name: 'ask.person', is_error: false }));
    expect(s.items[1]).toMatchObject({ status: 'answered', answer: 'B' });
  });

  it('closes an open question when the turn is stopped', () => {
    const s = run({ type: 'sent', text: 'pick', turn: 1 }, note({ kind: 'question', call_id: 'q1', question: 'Which?', choices: [] }), note({ kind: 'cancelled' }));
    expect(s.items[1]).toMatchObject({ kind: 'question', status: 'cancelled' });
    expect(s.busy).toBe(false);
  });

  it('brings back the plan, the questions and their answers from the saved conversation', () => {
    const messages: Message[] = [
      { role: 'user', text: 'go' },
      { role: 'assistant', text: '', tool_calls: [{ id: 't1', name: 'todo.write', arguments: { items: [{ text: 'A', status: 'done' }] } }, { id: 'q1', name: 'ask.person', arguments: { question: 'Sure?', choices: ['Yes'] } }] },
      { role: 'tool', call_id: 't1', name: 'todo.write', content: 'Plan updated: 1 of 1 done.', is_error: false },
      { role: 'tool', call_id: 'q1', name: 'ask.person', content: 'The person answered: Yes', is_error: false },
    ];
    const s = run({ type: 'loaded', messages });
    expect(kinds(s)).toEqual(['user', 'plan', 'question']);
    expect(s.items[2]).toMatchObject({ status: 'answered', answer: 'Yes' });
  });

  it('shows a question still open after the window comes back', () => {
    const s = run({ type: 'loaded', messages: [{ role: 'user', text: 'go' }] }, { type: 'question-open', question: { callId: 'q9', question: 'Which?', choices: [] } });
    expect(s.items[1]).toMatchObject({ kind: 'question', status: 'open' });
    expect(s.busy).toBe(true);
    expect(run({ type: 'question-open', question: null }).items).toEqual([]);
  });
});

describe('a proposed plan', () => {
  const plan = (statuses: ('pending' | 'in_progress' | 'done')[]) => ({ kind: 'plan' as const, id: 'p', items: statuses.map((status, i) => ({ text: `step ${i}`, status })) });
  const state = (items: ConversationState['items'], busy = false): ConversationState => ({ ...initialConversation('c'), items, busy });
  it('waits for the person when the turn ended with every step still to do', () => {
    const user = { kind: 'user' as const, id: 'u', text: 'plan it' };
    const reply = { kind: 'assistant' as const, id: 'a', text: 'Here is the plan.', streaming: false };
    expect(proposedPlan(state([user, plan(['pending', 'pending']), reply]))).toBe(1);
    expect(proposedPlan(state([user, plan(['pending', 'pending']), reply], true))).toBe(-1);
    expect(proposedPlan(state([user, plan(['done', 'pending'])]))).toBe(-1);
    expect(proposedPlan(state([user, plan(['pending']), { ...user, id: 'u2', text: 'Go ahead with the plan.' }]))).toBe(-1);
    expect(proposedPlan(state([user, reply]))).toBe(-1);
  });
});

describe('what Mobius sees', () => {
  it('names the apps it read from or worked in, in order, and not what you declined', () => {
    const tool = (name: string, status: 'done' | 'declined' | 'running', args?: unknown) => ({ kind: 'tool' as const, id: name + status, callId: name, name, status, args });
    const state: ConversationState = { ...initialConversation('c'), items: [
      { kind: 'user', id: 'u', text: 'tidy', attachments: [{ kind: 'note', title: 'Plan', source: 'notes/Plan.md', text: 'x' }] },
      tool('browser.read', 'done'),
      tool('files.write', 'done', { path: 'tasks/Inbox.md' }),
      tool('files.read', 'done', { path: 'notes/Plan.md' }),
      tool('browser.open', 'declined'),
      tool('demo.echo', 'done'),
    ] };
    expect(appsSeen(state)).toEqual(['Notes', 'Browser', 'Tasks']);
    expect(appsSeen(initialConversation('c'))).toEqual([]);
  });
});

describe('where a reply came from', () => {
  it('names the apps used in that turn only', () => {
    const items: ConversationState['items'] = [
      { kind: 'user', id: 'u1', text: 'one' },
      { kind: 'tool', id: 't1', callId: 'a', name: 'tasks.list', status: 'done' },
      { kind: 'assistant', id: 'a1', text: 'r1', streaming: false },
      { kind: 'user', id: 'u2', text: 'two', attachments: [{ kind: 'page', title: 'P', source: 'https://a', text: 'x' }] },
      { kind: 'tool', id: 't2', callId: 'b', name: 'files.read', status: 'done', args: { path: 'notes/Plan.md' } },
      { kind: 'assistant', id: 'a2', text: 'r2', streaming: false },
    ];
    expect(replySources(items, 2)).toEqual(['Tasks']);
    expect(replySources(items, 5)).toEqual(['Browser', 'Notes']);
    expect(replySources(items, 0)).toEqual([]);
  });
});

import { linkedFrom } from './conversation';

describe('linked from', () => {
  it('names the apps the last turn read, apart from the ones it changed', () => {
    const call = (name: string, args: object = {}) => ({ id: name, name, arguments: args });
    expect(linkedFrom([
      { role: 'user', text: 'earlier' },
      { role: 'assistant', text: '', tool_calls: [call('notes.read')] },
      { role: 'user', text: 'make a task from that email' },
      { role: 'assistant', text: '', tool_calls: [call('mail.read', { id: 'm1' }), call('files.read', { path: 'notes/Work/Plan.md' }), call('tasks.add', { list: 'Inbox' })] },
      { role: 'assistant', text: 'Done.', tool_calls: [] },
    ])).toEqual(['Mail', 'Notes']);
    expect(linkedFrom([{ role: 'user', text: 'x' }, { role: 'assistant', text: '', tool_calls: [call('files.read', { path: 'notes/a.md' }), call('files.write', { path: 'notes/b.md' })] }])).toEqual([]);
  });
});

describe('a request that came from something read', () => {
  it('keeps where it came from on the waiting tool, from the event and from the pending list', () => {
    let s = run({ type: 'sent', text: 'go', turn: 1 }, note({ kind: 'tool_call', call_id: 'c1', name: 'mail.draft' }));
    s = reduce(s, note({ kind: 'needs_approval', request_id: 4, call_id: 'c1', tool: 'mail.draft', arguments: {}, once_only: true, origin: 'Priya Nair’s invite “Dinner”' }));
    expect(s.items.at(-1)).toMatchObject({ status: 'waiting', onceOnly: true, origin: 'Priya Nair’s invite “Dinner”' });
    const fresh = reduce(run(), { type: 'pending', requests: [{ requestId: 5, callId: 'c2', tool: 'mail.draft', arguments: {}, onceOnly: true, origin: 'a web page (evil.example)' }] });
    expect(fresh.items.at(-1)).toMatchObject({ requestId: 5, origin: 'a web page (evil.example)' });
  });
});

describe('taking over', () => {
  it('shows where Mobius paused until it is handed back, and a finished turn clears it', () => {
    let s = run({ type: 'sent', text: 'go', turn: 1 }, note({ kind: 'paused', step: 2, of: 3 }));
    expect(s.control).toEqual({ step: 2, of: 3 });
    s = reduce(s, note({ kind: 'resumed' }));
    expect(s.control).toBeNull();
    s = reduce(s, note({ kind: 'paused', step: 1 }));
    expect(s.control).toEqual({ step: 1 });
    s = reduce(s, note({ kind: 'cancelled' }));
    expect(s.control).toBeNull();
  });
  it('a tool answer is shown without the envelope it went to the model in', () => {
    expect(dataOf('<<untrusted-data source="files.read a">>\n{"x":1}\n<</untrusted-data>>')).toBe('{"x":1}');
  });
});

describe('how a turn ended', () => {
  it('is kept, so messages waiting to go know whether the turn finished, failed or was stopped', () => {
    const sent = { type: 'sent' as const, text: 'go', turn: 1 };
    expect(run(sent, note({ kind: 'done' })).ended).toBe('done');
    expect(run(sent, note({ kind: 'failed', message: 'no model' })).ended).toBe('failed');
    expect(run(sent, note({ kind: 'cancelled' })).ended).toBe('cancelled');
    expect(run(sent, { type: 'reset-busy' }).ended).toBe('cancelled');
    expect(run(sent, { type: 'send-failed', message: 'offline' }).ended).toBe('failed');
  });
  it('what was saved, read when the conversation opened, does not replace a turn that was sent and answered meanwhile', () => {
    let s = reduce(initialConversation('main'), { type: 'sent', text: 'make an ideas page' });
    s = { ...s, busy: false, items: [...s.items, { kind: 'assistant', id: 'i9', text: 'Made it.' }], nextId: 10 } as typeof s;
    expect(reduce(s, { type: 'loaded', messages: [], onOpen: true })).toBe(s);
    // Opened with nothing done yet: what was saved is shown.
    const opened = reduce(initialConversation('main'), { type: 'loaded', messages: [{ role: 'user', text: 'go' }], onOpen: true });
    expect(opened.items.map((i) => i.kind)).toEqual(['user']);
  });
});
