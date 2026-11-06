import { splitContext, type AgentNotification, type AgentWaiting, type ContextItem, type Message } from '@mobius/shared';

export type ToolStatus = 'running' | 'waiting' | 'done' | 'failed' | 'declined' | 'cancelled';

export type Item =
  | { kind: 'user'; id: string; text: string; attachments?: ContextItem[] }
  | { kind: 'assistant'; id: string; text: string; streaming: boolean }
  | { kind: 'tool'; id: string; callId: string; name: string; status: ToolStatus; requestId?: number; args?: unknown; onceOnly?: boolean }
  | { kind: 'error'; id: string; text: string }
  /** Something the person should know that is not part of the conversation itself. */
  | { kind: 'notice'; id: string; text: string };

export interface ConversationState {
  conversation: string;
  items: Item[];
  /** A turn is running, including while it waits for a person to answer. */
  busy: boolean;
  turn: number | null;
  nextId: number;
}

export type ConversationAction =
  | { type: 'sent'; text: string; context?: ContextItem[]; turn?: number }
  | { type: 'send-failed'; message: string }
  | { type: 'notification'; notification: AgentNotification }
  | { type: 'answered'; requestId: number; approve: boolean }
  | { type: 'loaded'; messages: Message[] }
  | { type: 'pending'; requests: AgentWaiting[] }
  | { type: 'answer-failed'; requestId: number }
  | { type: 'reset-busy' }
  | { type: 'rewound' }
  | { type: 'switch'; conversation: string };

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

const settleStreaming = (items: Item[]): Item[] => items.map((item) => (item.kind === 'assistant' && item.streaming ? { ...item, streaming: false } : item));

const cancelOpenTools = (items: Item[]): Item[] =>
  items.map((item) => (item.kind === 'tool' && (item.status === 'running' || item.status === 'waiting') ? { ...item, status: 'cancelled' as const } : item));

const finished = (state: ConversationState): ConversationState => ({ ...state, busy: false, turn: null, items: settleStreaming(state.items) });

function fromHistory(state: ConversationState, messages: Message[]): ConversationState {
  let next: ConversationState = { ...state, items: [], nextId: 1 };
  for (const message of messages) {
    if (message.role === 'user') {
      const parts = splitContext(message.text);
      next = withItem(next, (id) => ({ kind: 'user', id, text: parts.text, ...(parts.items.length > 0 ? { attachments: parts.items } : {}) }));
    }
    else if (message.role === 'assistant') {
      if (message.text) next = withItem(next, (id) => ({ kind: 'assistant', id, text: message.text, streaming: false }));
      for (const call of message.tool_calls) next = withItem(next, (id) => ({ kind: 'tool', id, callId: call.id, name: call.name, status: 'running', args: call.arguments }));
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
      return { ...withItem(state, (id) => ({ kind: 'user', id, text: action.text, ...(action.context && action.context.length > 0 ? { attachments: action.context } : {}) })), busy: true, turn: action.turn ?? null };
    case 'send-failed':
      return finished(withItem(state, (id) => ({ kind: 'error', id, text: action.message })));
    case 'answered':
      return updateTool(
        state,
        (item) => item.status === 'waiting' && item.requestId === action.requestId,
        (item) => ({ ...item, status: action.approve ? 'running' : 'declined' }),
      );
    case 'switch':
      return initialConversation(action.conversation);
    case 'reset-busy':
      return finished({ ...state, items: cancelOpenTools(state.items) });
    case 'loaded':
      return state.busy ? state : fromHistory(state, action.messages);
    case 'answer-failed':
      return updateTool(
        state,
        (item) => item.requestId === action.requestId && (item.status === 'running' || item.status === 'declined'),
        (item) => ({ ...item, status: 'waiting' }),
      );
    case 'pending': {
      let next = state;
      for (const request of action.requests) {
        const known = next.items.some((item) => item.kind === 'tool' && item.callId === request.callId);
        if (!known) next = withItem(next, (id) => ({ kind: 'tool', id, callId: request.callId, name: request.tool, status: 'running' }));
        next = updateTool(next, (item) => item.callId === request.callId, (item) => ({ ...item, status: 'waiting', requestId: request.requestId, args: request.arguments, onceOnly: request.onceOnly }));
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
      switch (event.kind) {
        case 'message': {
          const last = base.items.at(-1);
          if (last?.kind === 'assistant' && last.streaming) return { ...base, items: [...base.items.slice(0, -1), { ...last, text: event.text, streaming: false }] };
          return withItem(base, (id) => ({ kind: 'assistant', id, text: event.text, streaming: false }));
        }
        case 'tool_call': {
          // Some servers reuse call ids from one turn to the next, so only a call that is still open counts as the same call.
          const open = base.items.findLast((item) => item.kind === 'tool' && item.callId === event.call_id);
          if (open?.kind === 'tool' && (open.status === 'running' || open.status === 'waiting')) {
            return updateTool(base, (item) => item.callId === event.call_id, (item) => ({ ...item, status: 'running' }));
          }
          return withItem(base, (id) => ({ kind: 'tool', id, callId: event.call_id, name: event.name, status: 'running' }));
        }
        case 'needs_approval': {
          const known = base.items.some((item) => item.kind === 'tool' && item.callId === event.call_id);
          const withTool = known ? base : withItem(base, (id) => ({ kind: 'tool', id, callId: event.call_id, name: event.tool, status: 'running' }));
          return updateTool(withTool, (item) => item.callId === event.call_id, (item) => ({ ...item, status: 'waiting', requestId: event.request_id, args: event.arguments, onceOnly: event.once_only === true }));
        }
        case 'tool_result': {
          const known = base.items.some((item) => item.kind === 'tool' && item.callId === event.call_id);
          const withTool = known ? base : withItem(base, (id) => ({ kind: 'tool', id, callId: event.call_id, name: event.name, status: 'running' }));
          return updateTool(withTool, (item) => item.callId === event.call_id, (item) => (item.status === 'declined' ? item : { ...item, status: event.is_error ? 'failed' : 'done' }));
        }
        case 'done':
          return finished(base);
        case 'failed':
          return finished(withItem(base, (id) => ({ kind: 'error', id, text: event.message })));
        case 'cancelled':
          return finished({ ...base, items: cancelOpenTools(base.items) });
      }
    }
  }
}

export const MAX_RESULT_SHOWN = 4000;

/** What a tool call returned, from the saved messages. The newest one wins when a server reused the call id. */
export function findToolResult(messages: Message[], callId: string): { text: string; isError: boolean; truncated: boolean } | null {
  const message = messages.findLast((m) => m.role === 'tool' && m.call_id === callId);
  if (!message || message.role !== 'tool') return null;
  const truncated = message.content.length > MAX_RESULT_SHOWN;
  return { text: truncated ? message.content.slice(0, MAX_RESULT_SHOWN) : message.content, isError: message.is_error, truncated };
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
