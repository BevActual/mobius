import type { ConversationInfo } from '@mobius/shared';

export type TrayState = 'idle' | 'working' | 'needs' | 'done';
export interface TrayShown { state: TrayState; tooltip: string; items: { id: string; title: string; status: string }[] }

/**
 * What the print in the menu bar or notification area shows: waiting for you comes first, then working, then a
 * finished turn you have not seen yet (the window was away when it ended). Its menu lists the conversations that
 * need you or are working, so you can go straight to one.
 */
export function trayShown(list: readonly ConversationInfo[], finishedAway: boolean): TrayShown {
  const needs = list.filter((c) => c.activity === 'needs_you' || c.waiting > 0);
  const working = list.filter((c) => c.activity === 'working' && !needs.includes(c));
  const items = [
    ...needs.map((c) => ({ id: c.id, title: c.title || 'New conversation', status: 'Needs you' })),
    ...working.map((c) => ({ id: c.id, title: c.title || 'New conversation', status: 'Working' })),
  ].slice(0, 8);
  if (needs.length > 0) return { state: 'needs', tooltip: needs.length === 1 ? `Mobius needs you: ${items[0]!.title}` : `Mobius needs you in ${needs.length} conversations`, items };
  if (working.length > 0) return { state: 'working', tooltip: working.length === 1 ? `Mobius is working: ${items[0]!.title}` : `Mobius is working on ${working.length} things`, items };
  if (finishedAway) return { state: 'done', tooltip: 'Mobius finished', items };
  return { state: 'idle', tooltip: 'Mobius', items };
}
