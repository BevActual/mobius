import { describe, expect, it } from 'vitest';
import type { ConversationInfo } from '@mobius/shared';
import { jobState, runningElsewhere } from './RunningJobs';

const chat = (id: string, activity: ConversationInfo['activity'], waiting = 0): ConversationInfo => ({ id, title: id, updated_ms: 0, messages: 1, activity, waiting });

describe('running jobs', () => {
  it('lists the other chats Mobius is working on, not the open one or idle ones', () => {
    const list = [chat('open', 'working'), chat('brief', 'working'), chat('ask', 'needs_you'), chat('done', 'idle'), chat('bad', 'failed')];
    expect(runningElsewhere(list, 'open').map((c) => c.id)).toEqual(['brief', 'ask']);
  });
  it('says when one needs you, and which were handed to the background', () => {
    const background = new Set(['brief']);
    expect(jobState(chat('brief', 'working'), background)).toBe('In the background');
    expect(jobState(chat('other', 'working'), background)).toBe('Working');
    expect(jobState(chat('brief', 'working', 1), background)).toBe('Needs you');
    expect(jobState(chat('ask', 'needs_you'), background)).toBe('Needs you');
  });
});
