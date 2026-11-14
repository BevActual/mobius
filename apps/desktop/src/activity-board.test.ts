import { describe, expect, it } from 'vitest';
import type { ConversationInfo } from '@mobius/shared';
import { activityBoard } from './activity-board';

const now = new Date(2026, 10, 7, 15, 0);
const c = (id: string, activity: ConversationInfo['activity'], hoursAgo: number, waiting = 0): ConversationInfo => ({ id, title: id, updated_ms: now.getTime() - hoursAgo * 3600_000, messages: 2, activity, waiting });

describe('the activity board', () => {
  it('sorts conversations into needs you, running, and finished today', () => {
    const b = activityBoard([c('a', 'working', 0), c('b', 'idle', 1), c('c', 'idle', 20), c('d', 'needs_you', 2), c('e', 'working', 0, 1), c('f', 'idle', 3)], now);
    expect(b.needsYou.map((x) => x.id)).toEqual(['d', 'e']);
    expect(b.running.map((x) => x.id)).toEqual(['a']);
    expect(b.doneToday.map((x) => x.id)).toEqual(['b', 'f']);
  });
  it('lists a failed run with what needs you, not with what finished', () => {
    const b = activityBoard([c('ok', 'idle', 1), c('broke', 'failed', 1)], now);
    expect(b.needsYou.map((x) => x.id)).toEqual(['broke']);
    expect(b.doneToday.map((x) => x.id)).toEqual(['ok']);
  });
});
