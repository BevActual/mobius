import { attachmentApp } from './surface';
import { splitContext, type AgentNotification, type AgentWaiting, type ContextItem, type Message, type TodoItem } from '@mobius/shared';

/** Tools the agent answers itself: shown as a plan or a question, never as tool steps. */
export const TODO_TOOL = 'todo.write';
export const ASK_TOOL = 'ask.person';
const OWN_TOOLS = new Set([TODO_TOOL, ASK_TOOL]);
const ANSWERED = 'The person answered: ';

export type QuestionStatus = 'open' | 'sending' | 'answered' | 'cancelled';

export type ToolStatus = 'running' | 'waiting' | 'done' | 'failed' | 'declined' | 'cancelled';

export type Item =
  | { kind: 'user'; id: string; text: string; attachments?: ContextItem[]; images?: string[]; /** When it was sent, in milliseconds; older conversations have none. */ at?: number }
  | { kind: 'assistant'; id: string; text: string; streaming: boolean }
  | { kind: 'tool'; id: string; callId: string; name: string; status: ToolStatus; requestId?: number; args?: unknown; onceOnly?: boolean; /** What it was read in, when the request came from there and not from the person. */ origin?: string }
  | { kind: 'error'; id: string; text: string; /** The turn itself failed (the model or the core), not just a message that could not go. */ failed?: boolean }
  /** Something the person should know that is not part of the conversation itself. */
  | { kind: 'notice'; id: string; text: string }
  /** The model's plan for the task in hand; one per turn, updated in place. */
  | { kind: 'plan'; id: string; items: TodoItem[] }
  /** The model asked the person something. */
  | { kind: 'question'; id: string; callId: string; question: string; choices: string[]; status: QuestionStatus; answer?: string };

export interface ConversationState {
  conversation: string;
  items: Item[];
  /** A turn is running, including while it waits for a person to answer. */
  busy: boolean;
  turn: number | null;
  nextId: number;
  /** You took over the running task: Mobius paused at this step (of this many, when it has a plan). */
  control?: { step: number; of?: number } | null;
  /** How full the model's window was at its last request, as the core estimated it, in tokens. */
  context?: { used: number; limit: number };
  /** How the last turn ended: well, failed, or stopped. */
  ended?: 'done' | 'failed' | 'cancelled';
}

export type ConversationAction =
  | { type: 'sent'; text: string; context?: ContextItem[]; turn?: number; images?: string[]; at?: number }
  | { type: 'send-failed'; message: string }
  | { type: 'notification'; notification: AgentNotification }
  | { type: 'answered'; requestId: number; approve: boolean }
  /**
   * What was saved, read from the core. `onOpen`: read when the conversation was opened, so it is older than anything
   * that has happened here since (a turn sent and finished while it was being read) and must not replace it.
   */
  /**
   * `conversation`: the one it was read for. A read started for the conversation shown before a switch can come back
   * after it, and must not fill the new one (it once kept a blank start showing the last conversation).
   */
  | { type: 'loaded'; messages: Message[]; onOpen?: boolean; conversation?: string }
  | { type: 'pending'; requests: AgentWaiting[] }
  | { type: 'answer-failed'; requestId: number }
  | { type: 'question-open'; question: { callId: string; question: string; choices: string[] } | null }
  | { type: 'question-answered'; callId: string; text: string }
  | { type: 'question-failed'; callId: string }
  | { type: 'reset-busy' }
  | { type: 'rewound' }
  | { type: 'switch'; conversation: string }
  | { type: 'control'; control: { step: number; of?: number } | null };

export const initialConversation = (conversation: string): ConversationState => ({ conversation, items: [], busy: false, turn: null, nextId: 1 });

const withItem = (state: ConversationState, make: (id: string) => Item): ConversationState => ({
  ...state,
  items: [...state.items, make(`i${state.nextId}`)],
  nextId: state.nextId + 1,
});

const updateTool = (state: ConversationState, match: (item: Extract<Item, { kind: 'tool' }>) => boolean, change: (item: Extract<Item, { kind: 'tool' }>) => Extract<Item, { kind: 'tool' }>): ConversationState => {
  const index = state.items.findLastIndex((item) => item.kind === 'tool' && match(item));
  if (index < 0) return state;
  const items = [...state.items];
  items[index] = change(items[index] as Extract<Item, { kind: 'tool' }>);
  return { ...state, items };
};

/** Show the plan: the plan of the current turn changes in place, a new turn starts a new one. */
const withPlan = (state: ConversationState, items: TodoItem[]): ConversationState => {
  const lastUser = state.items.findLastIndex((item) => item.kind === 'user');
  const index = state.items.findLastIndex((item) => item.kind === 'plan');
  if (index > lastUser) {
    const next = [...state.items];
    next[index] = { ...(next[index] as Extract<Item, { kind: 'plan' }>), items };
    return { ...state, items: next };
  }
  return withItem(state, (id) => ({ kind: 'plan', id, items }));
};

const withQuestion = (state: ConversationState, q: { callId: string; question: string; choices: string[] }): ConversationState =>
  state.items.some((item) => item.kind === 'question' && item.callId === q.callId) ? state : withItem(state, (id) => ({ kind: 'question', id, callId: q.callId, question: q.question, choices: q.choices, status: 'open' }));

const updateQuestion = (state: ConversationState, callId: string, change: (item: Extract<Item, { kind: 'question' }>) => Item): ConversationState => ({
  ...state,
  items: state.items.map((item) => (item.kind === 'question' && item.callId === callId ? change(item) : item)),
});

const isTodo = (v: unknown): v is TodoItem => typeof v === 'object' && v !== null && typeof (v as TodoItem).text === 'string' && ['pending', 'in_progress', 'done'].includes((v as TodoItem).status);

const settleStreaming = (items: Item[]): Item[] => items.map((item) => (item.kind === 'assistant' && item.streaming ? { ...item, streaming: false } : item));

const cancelOpenTools = (items: Item[]): Item[] =>
  items.map((item) =>
    item.kind === 'tool' && (item.status === 'running' || item.status === 'waiting') ? { ...item, status: 'cancelled' as const }
    : item.kind === 'question' && (item.status === 'open' || item.status === 'sending') ? { ...item, status: 'cancelled' as const }
    : item);

const finished = (state: ConversationState, ended: 'done' | 'failed' | 'cancelled'): ConversationState => ({ ...state, busy: false, turn: null, control: null, ended, items: settleStreaming(state.items) });

function fromHistory(state: ConversationState, messages: Message[]): ConversationState {
  let next: ConversationState = { ...state, items: [], nextId: 1 };
  for (const message of messages) {
    if (message.role === 'user') {
      const parts = splitContext(message.text);
      next = withItem(next, (id) => ({ kind: 'user', id, text: parts.text, ...(parts.items.length > 0 ? { attachments: parts.items } : {}), ...(message.images && message.images.length > 0 ? { images: message.images } : {}), ...(message.at_ms !== undefined ? { at: message.at_ms } : {}) }));
    }
    else if (message.role === 'assistant') {
      if (message.text) next = withItem(next, (id) => ({ kind: 'assistant', id, text: message.text, streaming: false }));
      for (const call of message.tool_calls) {
        const args = call.arguments as { items?: unknown; question?: unknown; choices?: unknown } | null;
        if (call.name === TODO_TOOL) {
          if (Array.isArray(args?.items) && args.items.every(isTodo)) next = withPlan(next, args.items);
        } else if (call.name === ASK_TOOL) {
          if (typeof args?.question === 'string') next = withQuestion(next, { callId: call.id, question: args.question, choices: Array.isArray(args.choices) ? args.choices.filter((c): c is string => typeof c === 'string') : [] });
        } else next = withItem(next, (id) => ({ kind: 'tool', id, callId: call.id, name: call.name, status: 'running', args: call.arguments }));
      }
    } else if (OWN_TOOLS.has(message.name)) {
      if (message.name === ASK_TOOL) {
        next = updateQuestion(next, message.call_id, (item) =>
          !message.is_error && message.content.startsWith(ANSWERED) ? { ...item, status: 'answered', answer: message.content.slice(ANSWERED.length) } : { ...item, status: 'cancelled' });
      }
    } else {
      const status: ToolStatus = !message.is_error ? 'done' : message.content.includes('declined') ? 'declined' : message.content === 'cancelled' ? 'cancelled' : 'failed';
      next = updateTool(next, (item) => item.callId === message.call_id, (item) => ({ ...item, status }));
    }
  }
  return next;
}

export function reduce(state: ConversationState, action: ConversationAction): ConversationState {
  switch (action.type) {
    case 'rewound': {
      const at = state.items.findLastIndex((item) => item.kind === 'user');
      return at < 0 ? state : { ...state, items: state.items.slice(0, at), busy: false, turn: null };
    }
    case 'sent':
      return { ...withItem(state, (id) => ({ kind: 'user', id, text: action.text, ...(action.context && action.context.length > 0 ? { attachments: action.context } : {}), ...(action.images && action.images.length > 0 ? { images: action.images } : {}), at: action.at ?? Date.now() })), busy: true, turn: action.turn ?? null };
    case 'send-failed':
      return finished(withItem(state, (id) => ({ kind: 'error', id, text: action.message })), 'failed');
    case 'answered':
      return updateTool(
        state,
        (item) => item.status === 'waiting' && item.requestId === action.requestId,
        (item) => ({ ...item, status: action.approve ? 'running' : 'declined' }),
      );
    case 'switch':
      return initialConversation(action.conversation);
    case 'control':
      return { ...state, control: action.control };
    case 'reset-busy':
      return finished({ ...state, items: cancelOpenTools(state.items) }, 'cancelled');
    case 'loaded':
      if (action.conversation !== undefined && action.conversation !== state.conversation) return state;
      return state.busy || (action.onOpen && state.nextId !== 1) ? state : fromHistory(state, action.messages);
    case 'answer-failed':
      return updateTool(
        state,
        (item) => item.requestId === action.requestId && (item.status === 'running' || item.status === 'declined'),
        (item) => ({ ...item, status: 'waiting' }),
      );
    case 'question-open':
      return action.question ? { ...withQuestion(state, action.question), busy: true } : state;
    case 'question-answered':
      return updateQuestion(state, action.callId, (item) => ({ ...item, status: 'sending', answer: action.text }));
    case 'question-failed':
      return updateQuestion(state, action.callId, (item) => ({ ...item, status: 'open' }));
    case 'pending': {
      let next = state;
      for (const request of action.requests) {
        const known = next.items.some((item) => item.kind === 'tool' && item.callId === request.callId);
        if (!known) next = withItem(next, (id) => ({ kind: 'tool', id, callId: request.callId, name: request.tool, status: 'running' }));
        next = updateTool(next, (item) => item.callId === request.callId, (item) => ({ ...item, status: 'waiting', requestId: request.requestId, args: request.arguments, onceOnly: request.onceOnly, ...(request.origin ? { origin: request.origin } : {}) }));
        next = { ...next, busy: true };
      }
      return next;
    }
    case 'notification': {
      const { notification } = action;
      const { conversation, turn } = notification.params;
      if (conversation !== state.conversation || (state.turn !== null && turn !== state.turn)) return state;
      const base: ConversationState = state.turn === null ? { ...state, turn, busy: true } : state;
      if (notification.method === 'agent.notice') {
        const { model, why } = notification.params;
        return withItem(base, (id) => ({ kind: 'notice', id, text: `Switched to ${model} because ${why}.` }));
      }
      if (notification.method === 'agent.delta') {
        const last = base.items.at(-1);
        if (last?.kind === 'assistant' && last.streaming) {
          const items = [...base.items.slice(0, -1), { ...last, text: last.text + notification.params.text }];
          return { ...base, items };
        }
        return withItem(base, (id) => ({ kind: 'assistant', id, text: notification.params.text, streaming: true }));
      }
      const event = notification.params.event;
      if ((event.kind === 'tool_call' && OWN_TOOLS.has(event.name)) || (event.kind === 'tool_result' && event.name === TODO_TOOL)) return base;
      if (event.kind === 'tool_result' && event.name === ASK_TOOL) {
        return updateQuestion(base, event.call_id, (item) => (event.is_error ? { ...item, status: 'cancelled' } : { ...item, status: 'answered' }));
      }
      switch (event.kind) {
        case 'todo':
          return withPlan(base, event.items);
        case 'question':
          return withQuestion(base, { callId: event.call_id, question: event.question, choices: event.choices });
        case 'message': {
          const last = base.items.at(-1);
          if (last?.kind === 'assistant' && last.streaming) return { ...base, items: [...base.items.slice(0, -1), { ...last, text: event.text, streaming: false }] };
          return withItem(base, (id) => ({ kind: 'assistant', id, text: event.text, streaming: false }));
        }
        case 'tool_call': {
          // Some servers reuse call ids from one turn to the next, so only a call that is still open counts as the same call.
          const open = base.items.findLast((item) => item.kind === 'tool' && item.callId === event.call_id);
          if (open?.kind === 'tool' && (open.status === 'running' || open.status === 'waiting')) {
            return updateTool(base, (item) => item.callId === event.call_id, (item) => ({ ...item, status: 'running', ...(item.args === undefined && event.arguments !== undefined ? { args: event.arguments } : {}) }));
          }
          // With its arguments, so the row can say what it acted on.
          return withItem(base, (id) => ({ kind: 'tool', id, callId: event.call_id, name: event.name, status: 'running', ...(event.arguments !== undefined ? { args: event.arguments } : {}) }));
        }
        case 'needs_approval': {
          const known = base.items.some((item) => item.kind === 'tool' && item.callId === event.call_id);
          const withTool = known ? base : withItem(base, (id) => ({ kind: 'tool', id, callId: event.call_id, name: event.tool, status: 'running' }));
          return updateTool(withTool, (item) => item.callId === event.call_id, (item) => ({ ...item, status: 'waiting', requestId: event.request_id, args: event.arguments, onceOnly: event.once_only === true, ...(event.origin ? { origin: event.origin } : {}) }));
        }
        case 'tool_result': {
          const known = base.items.some((item) => item.kind === 'tool' && item.callId === event.call_id);
          const withTool = known ? base : withItem(base, (id) => ({ kind: 'tool', id, callId: event.call_id, name: event.name, status: 'running' }));
          return updateTool(withTool, (item) => item.callId === event.call_id, (item) => (item.status === 'declined' ? item : { ...item, status: event.is_error ? 'failed' : 'done' }));
        }
        case 'paused':
          return { ...base, control: { step: event.step, ...(typeof event.of === 'number' ? { of: event.of } : {}) } };
        case 'resumed':
          return { ...base, control: null };
        case 'context':
          return { ...base, context: { used: event.used, limit: event.limit } };
        case 'compacted':
          return withItem(base, (id) => ({ kind: 'notice', id, text: 'Earlier messages were summarised to make room for the model. They are still here for you.' }));
        case 'done':
          return finished(base, 'done');
        case 'failed':
          return finished(withItem(base, (id) => ({ kind: 'error', id, text: event.message, failed: true })), 'failed');
        case 'cancelled':
          return finished({ ...base, items: cancelOpenTools(base.items) }, 'cancelled');
      }
    }
  }
}

export const MAX_RESULT_SHOWN = 4000;

/** A tool's answer without the envelope that tells the model it is data. */
export const dataOf = (content: string): string => content.replace(/^<<untrusted-data source="[^"]*">>\n/, '').replace(/\n<<\/untrusted-data>>$/, '');

/** What a tool call returned, from the saved messages. The newest one wins when a server reused the call id. */
export function findToolResult(messages: Message[], callId: string): { text: string; isError: boolean; truncated: boolean } | null {
  const message = messages.findLast((m) => m.role === 'tool' && m.call_id === callId);
  if (!message || message.role !== 'tool') return null;
  const content = dataOf(message.content);
  const truncated = content.length > MAX_RESULT_SHOWN;
  return { text: truncated ? content.slice(0, MAX_RESULT_SHOWN) : content, isError: message.is_error, truncated };
}

/** What a tool call was asked to do, from the saved messages. */
export function findToolArguments(messages: Message[], callId: string): unknown {
  for (const message of messages.toReversed()) {
    if (message.role !== 'assistant') continue;
    const call = message.tool_calls.find((c) => c.id === callId);
    if (call) return call.arguments;
  }
  return undefined;
}

/**
 * Where a plan waits for the person, or -1: the last plan of an ended turn whose steps are all still to do, with
 * nothing asked since. That is what Plan first leaves behind (a plan-only turn cannot start a step).
 */
export function proposedPlan(state: ConversationState): number {
  if (state.busy) return -1;
  const at = state.items.findLastIndex((item) => item.kind === 'plan');
  if (at < 0) return -1;
  const plan = state.items[at] as Extract<Item, { kind: 'plan' }>;
  if (plan.items.length === 0 || plan.items.some((step) => step.status !== 'pending')) return -1;
  return state.items.slice(at + 1).some((item) => item.kind === 'user') ? -1 : at;
}

/** Which app a tool works in, for saying what Mobius has seen. Files under notes/ and tasks/ belong to those apps. */
export function appOfTool(name: string, args: unknown): string | null {
  const path = typeof args === 'object' && args !== null && typeof (args as { path?: unknown }).path === 'string' ? (args as { path: string }).path : '';
  if (name.startsWith('browser.')) return 'Browser';
  if (name.startsWith('tasks.')) return 'Tasks';
  if (name.startsWith('notes.')) return 'Notes';
  if (name.startsWith('calendar.')) return 'Calendar';
  if (name.startsWith('sheets.')) return 'Sheets';
  if (name.startsWith('mail.')) return 'Mail';
  if (name.startsWith('files.')) return path.startsWith('notes/') ? 'Notes' : path.startsWith('docs/') ? 'Docs' : path.startsWith('slides/') ? 'Slides' : path.startsWith('sheets/') ? 'Sheets' : path.startsWith('tasks/') ? 'Tasks' : path.startsWith('calendar/') ? 'Calendar' : 'Files';
  return null;
}

/**
 * The apps Mobius has read from or worked in during this conversation, in the order it first did: what you attached
 * (a page, a note, a file) and the tools it used that ran. Shown as "Sees:" so it is never a surprise.
 */
/** A tool that only reads (it brings something from an app, and changes nothing). */
const READS = /\.(read|list|search|tabs|events|calendars|lists|query|tables)$/;
export const isReadTool = (name: string): boolean => READS.test(name);

/** Several finished reads in a row, as one line: "Read your mail and calendar". */
export function readsSummary(calls: readonly { name: string; args?: unknown }[]): string {
  const apps: string[] = [];
  for (const call of calls) { const app = appOfTool(call.name, call.args) ?? 'Files'; if (!apps.includes(app)) apps.push(app); }
  const word = (app: string) => (['Mail', 'Calendar', 'Tasks', 'Notes', 'Docs', 'Sheets', 'Files'].includes(app) ? `your ${app === 'Mail' ? 'mail' : app === 'Calendar' ? 'calendar' : app === 'Tasks' ? 'tasks' : app === 'Notes' ? 'notes' : app === 'Docs' ? 'docs' : app === 'Sheets' ? 'sheets' : 'files'}` : app);
  const words = apps.map(word);
  // "your mail and your calendar" says "your" once.
  const joined = words.length === 1 ? words[0]! : `${words.slice(0, -1).join(', ')} and ${words.at(-1)!}`.replace(/(, | and )your /g, '$1');
  return `Read ${joined}`;
}

/**
 * Where a turn's change was made from: the apps its last turn read, apart from the ones it changed. Shown on a
 * proposal as "Linked from Mail · Notes", so a task made from an email says so.
 */
export function linkedFrom(history: readonly Message[]): string[] {
  const start = history.map((m) => m.role).lastIndexOf('user');
  const turn = start < 0 ? [] : history.slice(start);
  const read: string[] = [];
  const changed = new Set<string>();
  for (const m of turn) {
    if (m.role !== 'assistant') continue;
    for (const call of m.tool_calls) {
      const app = appOfTool(call.name, call.arguments);
      if (!app) continue;
      if (READS.test(call.name)) { if (!read.includes(app)) read.push(app); } else changed.add(app);
    }
  }
  return read.filter((app) => !changed.has(app));
}

export function appsSeen(state: ConversationState): string[] {
  const seen: string[] = [];
  const add = (app: string | null) => { if (app && !seen.includes(app)) seen.push(app); };
  for (const item of state.items) {
    if (item.kind === 'user') for (const a of item.attachments ?? []) add(attachmentApp(a));
    if (item.kind === 'tool' && (item.status === 'done' || item.status === 'running' || item.status === 'failed')) add(appOfTool(item.name, item.args));
  }
  return seen;
}

/**
 * Where a reply came from: the apps whose tools ran in the same turn, before it, plus what was attached to the
 * request. Shown under the reply ("Based on Browser · Notes"), so you can tell what it rests on.
 */
export function replySources(items: readonly Item[], index: number): string[] {
  const start = items.slice(0, index).findLastIndex((item) => item.kind === 'user');
  if (start < 0) return [];
  return appsSeen({ ...initialConversation(''), items: items.slice(start, index) });
}
