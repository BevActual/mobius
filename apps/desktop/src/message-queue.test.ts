import { describe, expect, it } from 'vitest';
import { EMPTY_QUEUE, MAX_QUEUED, afterTurn, clearQueue, editQueued, enqueue, removeQueued, resumeQueue } from './message-queue';

const three = () => enqueue(enqueue(enqueue(EMPTY_QUEUE, 'first'), 'second'), 'third');
const texts = (q: { items: Array<{ text: string }> }) => q.items.map((i) => i.text);

describe('messages queued while Mobius works', () => {
  it('waits in order, and blank messages are not queued', () => {
    const q = enqueue(three(), '   ');
    expect(texts(q)).toEqual(['first', 'second', 'third']);
    expect(q.items.map((i) => i.id)).toEqual([1, 2, 3]);
  });

  it('keeps what was attached and how it was sent', () => {
    const q = enqueue(EMPTY_QUEUE, 'look', [{ kind: 'page', title: 'Menu', source: 'https://x.test', text: 'soup' }], { plan: true });
    expect(q.items[0]).toEqual({ id: 1, text: 'look', context: [{ kind: 'page', title: 'Menu', source: 'https://x.test', text: 'soup' }], options: { plan: true } });
    expect(enqueue(EMPTY_QUEUE, 'plain', [], {}).items[0]).toEqual({ id: 1, text: 'plain', context: [] });
  });

  it('holds at most ten', () => {
    let q = EMPTY_QUEUE;
    for (let i = 0; i < MAX_QUEUED + 3; i++) q = enqueue(q, `m${i}`);
    expect(q.items).toHaveLength(MAX_QUEUED);
    expect(q.items.at(-1)!.text).toBe(`m${MAX_QUEUED - 1}`);
  });

  it('can be edited, and an emptied one is taken out; any one can be removed', () => {
    let q = editQueued(three(), 2, 'second, better');
    expect(texts(q)).toEqual(['first', 'second, better', 'third']);
    q = editQueued(q, 1, '  ');
    expect(texts(q)).toEqual(['second, better', 'third']);
    q = removeQueued(q, 3);
    expect(texts(q)).toEqual(['second, better']);
  });

  it('sends the first as each turn ends well, one at a time, and nothing while a turn runs', () => {
    let q = three();
    expect(afterTurn(q, true, true, undefined).send).toBeNull();
    expect(afterTurn(q, false, false, 'done').send).toBeNull();
    let step = afterTurn(q, true, false, 'done');
    expect(step.send!.text).toBe('first');
    q = step.queue;
    step = afterTurn(q, true, false, 'done');
    expect(step.send!.text).toBe('second');
    expect(texts(step.queue)).toEqual(['third']);
  });

  it('after Stop or a failed turn, keeps the queue and waits; Send next goes on, Clear queue empties it', () => {
    for (const ended of ['cancelled', 'failed'] as const) {
      const stopped = afterTurn(three(), true, false, ended);
      expect(stopped.send).toBeNull();
      expect(stopped.queue.paused).toBe(true);
      expect(texts(stopped.queue)).toEqual(['first', 'second', 'third']);
      // Still paused at the next turn's end, until the person says.
      expect(afterTurn(stopped.queue, true, false, 'done').send).toBeNull();
      expect(resumeQueue(stopped.queue, true)).toEqual({ queue: { ...stopped.queue, paused: false }, send: null });
      const resumed = resumeQueue(stopped.queue, false);
      expect(resumed.send!.text).toBe('first');
      expect(resumed.queue.paused).toBe(false);
      expect(clearQueue(stopped.queue)).toEqual({ ...stopped.queue, items: [], paused: false });
    }
  });

  it('is no longer paused once the last waiting message is removed', () => {
    const one = afterTurn(enqueue(EMPTY_QUEUE, 'only'), true, false, 'cancelled').queue;
    expect(removeQueued(one, 1).paused).toBe(false);
  });
});
