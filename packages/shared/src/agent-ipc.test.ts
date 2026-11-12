import { describe, expect, it } from 'vitest';
import { MAX_RECORDING_BYTES, parseAgentNotification, parseConfigureRequest, parseConversationId, parseModelName, parseRecording, parseResolveRequest, parseSendRequest } from './ipc';

describe('conversation ids', () => {
  it('accepts short plain ids and nothing else', () => {
    for (const ok of ['main', 'c-1', 'A_b', 'x'.repeat(64)]) expect(parseConversationId(ok)).toBe(ok);
    for (const bad of ['', ' ', 'a b', '../x', 'a/b', 'x'.repeat(65), 'é', 1, null, undefined, {}, ['main']]) expect(parseConversationId(bad)).toBeNull();
  });
});

describe('send requests with attached material', () => {
  const page = { kind: 'page', title: 'A page', source: 'https://example.com/', text: 'Hello.' };
  it('carry a checked list of attachments, and are refused when it is wrong', () => {
    expect(parseSendRequest({ conversation: 'main', text: 'hi', context: [page] })).toEqual({ conversation: 'main', text: 'hi', context: [page] });
    for (const bad of ['x', [{ ...page, kind: 'video' }], Array.from({ length: 6 }, () => page), [{ ...page, text: 'x'.repeat(20_001) }], null]) {
      expect(parseSendRequest({ conversation: 'main', text: 'hi', context: bad })).toBeNull();
    }
  });
});

describe('send requests', () => {
  it('needs a valid conversation and a non-blank message of bounded length', () => {
    expect(parseSendRequest({ conversation: 'main', text: 'hello' })).toEqual({ conversation: 'main', text: 'hello', context: [] });
    expect(parseSendRequest({ conversation: 'main', text: 'x'.repeat(32000) })).not.toBeNull();
    for (const bad of [null, 'hi', {}, { conversation: 'main' }, { conversation: 'main', text: '' }, { conversation: 'main', text: '  \n' }, { conversation: 'main', text: 'x'.repeat(32001) }, { conversation: '../x', text: 'hi' }, { conversation: 'main', text: 5 }]) {
      expect(parseSendRequest(bad)).toBeNull();
    }
  });
  it('drops anything extra instead of passing it on', () => {
    expect(parseSendRequest({ conversation: 'main', text: 'hi', principal: { kind: 'person' } })).toEqual({ conversation: 'main', text: 'hi', context: [] });
  });
});

describe('resolve requests', () => {
  it('needs a whole positive request id, a boolean and a known duration', () => {
    expect(parseResolveRequest({ requestId: 7, approve: true, duration: 'once' })).toEqual({ requestId: 7, approve: true, duration: 'once' });
    expect(parseResolveRequest({ requestId: 7, approve: false, duration: 'always' })).not.toBeNull();
    for (const bad of [null, {}, { requestId: 0, approve: true, duration: 'once' }, { requestId: -1, approve: true, duration: 'once' }, { requestId: 1.5, approve: true, duration: 'once' }, { requestId: '7', approve: true, duration: 'once' }, { requestId: 7, approve: 'yes', duration: 'once' }, { requestId: 7, approve: true, duration: 'forever' }, { requestId: 7, approve: true }, { requestId: Number.MAX_SAFE_INTEGER + 1, approve: true, duration: 'once' }]) {
      expect(parseResolveRequest(bad)).toBeNull();
    }
  });
});

describe('configure requests', () => {
  const good = { baseUrl: 'http://127.0.0.1:8888/v1', model: 'qwen', apiKey: 'k', system: 'Be brief.' };
  it('accepts the fields and trims names', () => {
    expect(parseConfigureRequest(good)).toEqual(good);
    expect(parseConfigureRequest({ baseUrl: ' https://x.example/v1 ', model: ' m ' })).toEqual({ baseUrl: 'https://x.example/v1', model: 'm' });
  });
  it('treats an empty key or prompt as not provided', () => {
    expect(parseConfigureRequest({ ...good, apiKey: '', system: '' })).toEqual({ baseUrl: good.baseUrl, model: good.model });
  });
  it('can ask for the saved key to be removed', () => {
    expect(parseConfigureRequest({ ...good, apiKey: undefined, clearKey: true })).toEqual({ baseUrl: good.baseUrl, model: good.model, system: good.system, clearKey: true });
    expect(parseConfigureRequest({ ...good, clearKey: 'yes' })).toBeNull();
    expect(parseConfigureRequest({ ...good, clearKey: false })).toEqual(good);
  });
  it('rejects missing, wrongly typed and oversized fields', () => {
    for (const bad of [null, 'x', {}, { baseUrl: good.baseUrl }, { model: 'm' }, { baseUrl: '', model: 'm' }, { baseUrl: good.baseUrl, model: '' }, { baseUrl: 5, model: 'm' }, { ...good, apiKey: 5 }, { ...good, system: 5 }, { ...good, model: 'm'.repeat(201) }, { ...good, baseUrl: 'h'.repeat(2049) }, { ...good, apiKey: 'k'.repeat(4097) }, { ...good, system: 's'.repeat(8001) }]) {
      expect(parseConfigureRequest(bad)).toBeNull();
    }
  });
});

describe('notifications from the core', () => {
  it('accepts the two kinds the renderer understands', () => {
    const delta = { method: 'agent.delta', params: { conversation: 'main', turn: 3, text: 'Hi' } };
    const event = { method: 'agent.event', params: { conversation: 'main', turn: 3, event: { kind: 'done' } } };
    expect(parseAgentNotification(delta)).toEqual(delta);
    expect(parseAgentNotification(event)).toEqual(event);
  });
  it('drops everything else', () => {
    for (const bad of [null, 'x', {}, { method: 'core.ping', params: {} }, { method: 'agent.delta', params: { conversation: '../x', turn: 1, text: 'a' } }, { method: 'agent.delta', params: { conversation: 'main', turn: 'x', text: 'a' } }, { method: 'agent.delta', params: { conversation: 'main', turn: 1, text: 5 } }, { method: 'agent.event', params: { conversation: 'main', turn: 1, event: { kind: 'explode' } } }, { method: 'agent.event', params: { conversation: 'main', turn: 1, event: 'done' } }, { method: 'agent.event', params: { conversation: 'main', turn: 1, event: { kind: 'compacted', messages: -1 } } }, { method: 'agent.event', params: { conversation: 'main', turn: 1, event: { kind: 'context', used: 5, limit: 0 } } }, { method: 'agent.event', params: { conversation: 'main', turn: 1, event: { kind: 'needs_approval', request_id: 'x', call_id: 'c', tool: 't', arguments: {} } } }]) {
      expect(parseAgentNotification(bad)).toBeNull();
    }
  });
  it('checks the fields of every event kind', () => {
    const wrap = (event: unknown) => ({ method: 'agent.event', params: { conversation: 'main', turn: 1, event } });
    for (const ok of [{ kind: 'message', text: 'a' }, { kind: 'tool_call', call_id: 'c', name: 'n', arguments: {} }, { kind: 'tool_result', call_id: 'c', name: 'n', is_error: false }, { kind: 'needs_approval', request_id: 4, call_id: 'c', tool: 't', arguments: { a: 1 } }, { kind: 'done' }, { kind: 'failed', message: 'm' }, { kind: 'cancelled' }, { kind: 'compacted', messages: 12 }, { kind: 'context', used: 9000, limit: 40000 }, { kind: 'todo', items: [{ text: 'a', status: 'done' }] }, { kind: 'question', call_id: 'q', question: 'Which?', choices: ['A'] }]) {
      expect(parseAgentNotification(wrap(ok))).not.toBeNull();
    }
    for (const bad of [{ kind: 'message' }, { kind: 'tool_call', call_id: 'c' }, { kind: 'tool_result', call_id: 'c', name: 'n', is_error: 'no' }, { kind: 'failed' }, { kind: 'todo', items: [{ text: 'a', status: 'maybe' }] }, { kind: 'todo', items: 'x' }, { kind: 'question', call_id: 'q', question: '', choices: [] }, { kind: 'question', call_id: 'q', question: 'Q' }, { kind: 'question', call_id: 'q', question: 'Q', choices: ['1', '2', '3', '4', '5', '6', '7'] }]) {
      expect(parseAgentNotification(wrap(bad))).toBeNull();
    }
  });
});

describe('a notice that a second model took over', () => {
  const good = { method: 'agent.notice', params: { conversation: 'main', turn: 3, kind: 'fallback', model: 'backup-model', why: 'the first model could not be reached' } };
  it('is accepted in its plain form', () => {
    expect(parseAgentNotification(good)).toEqual(good);
  });
  it('is refused when anything is missing, unknown or too long', () => {
    for (const change of [{ kind: 'other' }, { model: 5 }, { model: '' }, { model: 'm'.repeat(300) }, { why: 5 }, { why: 'w'.repeat(500) }, { turn: -1 }, { conversation: '../x' }]) {
      expect(parseAgentNotification({ ...good, params: { ...good.params, ...change } }), JSON.stringify(change)).toBeNull();
    }
  });
  it('drops extra fields instead of passing them on', () => {
    expect(parseAgentNotification({ ...good, params: { ...good.params, evil: 1 } })).toEqual(good);
  });
});

describe('model names from the window', () => {
  it('are short single-line names', () => {
    expect(parseModelName('gpt-4o')).toBe('gpt-4o');
    expect(parseModelName('org/model:Q4_K_M')).toBe('org/model:Q4_K_M');
    for (const bad of ['', 'x'.repeat(201), 'a\nb', 'a\u0000b', 3, null, undefined, {}]) expect(parseModelName(bad)).toBeNull();
  });
});

describe('recordings from the window', () => {
  const bytes = new Uint8Array([1, 2, 3]);
  it('are bytes of a known audio type, with any codec note dropped', () => {
    expect(parseRecording(bytes, 'audio/webm;codecs=opus')).toEqual({ bytes, mime: 'audio/webm' });
    expect(parseRecording(bytes.buffer.slice(0), 'Audio/OGG')?.mime).toBe('audio/ogg');
    expect(parseRecording(bytes, 'audio/wav')?.mime).toBe('audio/wav');
  });
  it('are refused when empty, huge, of another type, or not bytes', () => {
    expect(parseRecording(new Uint8Array(0), 'audio/webm')).toBeNull();
    expect(parseRecording(new Uint8Array(MAX_RECORDING_BYTES + 1), 'audio/webm')).toBeNull();
    expect(parseRecording(new Uint8Array(MAX_RECORDING_BYTES), 'audio/webm')).not.toBeNull();
    for (const bad of ['video/webm', 'text/plain', 'application/octet-stream', '', 3, null]) expect(parseRecording(bytes, bad)).toBeNull();
    for (const bad of ['abc', [1, 2], {}, null, undefined]) expect(parseRecording(bad, 'audio/webm')).toBeNull();
  });
});
