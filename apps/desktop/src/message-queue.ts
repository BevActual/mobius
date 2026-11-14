import type { ContextItem } from '@mobius/shared';

/** The most messages that can wait at once. */
export const MAX_QUEUED = 10;

export interface QueuedOptions { plan?: boolean; ask?: boolean; quick?: boolean; mode?: string; model?: string; images?: string[] }
export interface Queued { id: number; text: string; context: ContextItem[]; options?: QueuedOptions }

/**
 * Messages written while Mobius is still working: they wait above the message box and go, in order, as each turn ends.
 * After Stop (or a turn that failed) the queue waits for the person: it is kept, not sent.
 */
export interface MessageQueue { items: Queued[]; nextId: number; paused: boolean }

export const EMPTY_QUEUE: MessageQueue = { items: [], nextId: 1, paused: false };

/** How a turn ended, as the conversation saw it. */
export type TurnEnd = 'done' | 'failed' | 'cancelled';

/** One more message at the end; nothing when the text is blank or the queue is full. */
export function enqueue(queue: MessageQueue, text: string, context: ContextItem[] = [], options?: QueuedOptions): MessageQueue {
  if (!text.trim() || queue.items.length >= MAX_QUEUED) return queue;
  const item: Queued = { id: queue.nextId, text, context, ...(options && Object.keys(options).length > 0 ? { options } : {}) };
  return { ...queue, items: [...queue.items, item], nextId: queue.nextId + 1 };
}

/** New words for a waiting message. Emptied, it is taken out. */
export function editQueued(queue: MessageQueue, id: number, text: string): MessageQueue {
  if (!text.trim()) return removeQueued(queue, id);
  return { ...queue, items: queue.items.map((item) => (item.id === id ? { ...item, text } : item)) };
}

export function removeQueued(queue: MessageQueue, id: number): MessageQueue {
  const items = queue.items.filter((item) => item.id !== id);
  return { ...queue, items, paused: items.length > 0 && queue.paused };
}

export function clearQueue(queue: MessageQueue): MessageQueue {
  return { ...queue, items: [], paused: false };
}

/**
 * What to do when the conversation's state changes: a turn that just ended well sends the first waiting message; one that
 * was stopped or failed leaves the queue paused. Nothing goes while a turn is running or the queue is paused.
 */
export function afterTurn(queue: MessageQueue, wasBusy: boolean, busy: boolean, ended: TurnEnd | undefined): { queue: MessageQueue; send: Queued | null } {
  if (busy || !wasBusy || queue.items.length === 0) return { queue, send: null };
  if (ended === 'failed' || ended === 'cancelled') return { queue: { ...queue, paused: true }, send: null };
  if (queue.paused) return { queue, send: null };
  const [first, ...rest] = queue.items;
  return { queue: { ...queue, items: rest }, send: first ?? null };
}

/** Send next, after a pause: the first waiting message goes now if Mobius is free, and the rest follow as before. */
export function resumeQueue(queue: MessageQueue, busy: boolean): { queue: MessageQueue; send: Queued | null } {
  const resumed = { ...queue, paused: false };
  if (busy || resumed.items.length === 0) return { queue: resumed, send: null };
  const [first, ...rest] = resumed.items;
  return { queue: { ...resumed, items: rest }, send: first ?? null };
}
