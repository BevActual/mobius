import { describe, expect, it } from 'vitest';
import { activityOf, appOfTool, appOfTurn, toolLabel } from './activity';
import { initialConversation, type ConversationState, type Item } from './conversation';

const busy = (items: Item[]): ConversationState => ({ ...initialConversation('c'), items, busy: true });
const tool = (name: string, status: 'running' | 'waiting' | 'done', args?: unknown): Item => ({ kind: 'tool', id: name + status, callId: name, name, status, args });

describe('what the agent is doing', () => {
  it('is nothing while idle', () => {
    expect(activityOf({ ...busy([tool('tasks.add', 'running')]), busy: false })).toBeNull();
  });
  it('names the running tool and the app it works in', () => {
    expect(activityOf(busy([tool('browser.read', 'done'), tool('tasks.add', 'running')]))).toEqual({ label: 'Adding a task', app: 'tasks', needsYou: false });
    expect(activityOf(busy([tool('files.write', 'running', { path: 'notes\\Work\\Plan.md' })]))).toMatchObject({ label: 'Writing in Notes', app: 'notes' });
  });
  it('says Paused, and where Mobius stopped, once the person took over', () => {
    expect(activityOf({ ...busy([tool('files.write', 'running', { path: 'notes/A.md' })]), control: { step: 2, of: 4 } })).toEqual({ label: 'Paused', app: null, needsYou: false, paused: { step: 2, of: 4 } });
  });
  it('knows the app this turn last worked in, while it thinks between steps', () => {
    const user: Item = { kind: 'user', id: 'u', text: 'Tidy' } as Item;
    expect(appOfTurn(busy([tool('tasks.add', 'done'), user, tool('files.read', 'done', { path: 'notes/A.md' }), tool('clock.now', 'done')]))).toBe('notes');
    expect(appOfTurn(busy([tool('tasks.add', 'done'), user]))).toBeNull();
    expect(appOfTurn({ ...busy([tool('tasks.add', 'done')]), busy: false })).toBeNull();
  });
  it('puts waiting for the person first, and says where', () => {
    expect(activityOf(busy([tool('browser.open', 'waiting'), tool('tasks.list', 'running')]))).toEqual({ label: 'Waiting for you to allow it', app: 'browser', needsYou: true });
    expect(activityOf(busy([{ kind: 'question', id: 'q', callId: 'q', question: 'Which?', choices: [], status: 'open' }]))).toMatchObject({ label: 'Waiting for your answer', needsYou: true });
  });
  it('says Writing while the answer streams, and Thinking otherwise', () => {
    expect(activityOf(busy([tool('tasks.add', 'done'), { kind: 'assistant', id: 'a', text: 'Hi', streaming: true }]))?.label).toBe('Writing');
    expect(activityOf(busy([{ kind: 'user', id: 'u', text: 'hi' }]))?.label).toBe('Thinking');
  });
  it('carries the plan progress', () => {
    const plan: Item = { kind: 'plan', id: 'p', items: [{ text: 'a', status: 'done' }, { text: 'b', status: 'in_progress' }, { text: 'c', status: 'pending' }] };
    expect(activityOf(busy([plan, tool('browser.read', 'running')]))?.step).toEqual({ done: 1, total: 3 });
  });
});

describe('tools and apps', () => {
  it('maps tools to apps, files by their folder', () => {
    expect(appOfTool('browser.tabs')).toBe('browser');
    expect(appOfTool('files.edit', { path: 'tasks/Inbox.md' })).toBe('tasks');
    expect(appOfTool('files.read', { path: 'other.md' })).toBeNull();
    expect(appOfTool('todo.write')).toBeNull();
  });
  it('labels tools in plain words, including ones from other servers', () => {
    expect(toolLabel('files.read', { path: 'notes/a.md' })).toBe('Reading a note');
    expect(toolLabel('mcp.github.create_issue')).toBe('Using github');
    expect(toolLabel('something.new')).toBe('Working');
  });
});
