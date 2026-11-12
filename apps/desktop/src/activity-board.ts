import type { ConversationInfo } from '@mobius/shared';

export interface Board { needsYou: ConversationInfo[]; running: ConversationInfo[]; doneToday: ConversationInfo[] }

/**
 * The design's Activity board for conversations: what is waiting for you, what is working, and what finished today
 * (newest first, a few). Scheduled requests are listed beside it from the schedules themselves.
 */
export function activityBoard(list: readonly ConversationInfo[], now: Date, doneLimit = 8): Board {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const needsYou = list.filter((c) => c.activity === 'needs_you' || c.waiting > 0);
  const running = list.filter((c) => c.activity === 'working' && !needsYou.includes(c));
  const doneToday = list
    .filter((c) => c.activity === 'idle' && c.waiting === 0 && c.updated_ms >= midnight && c.messages > 0)
    .sort((a, b) => b.updated_ms - a.updated_ms)
    .slice(0, doneLimit);
  return { needsYou, running, doneToday };
}
