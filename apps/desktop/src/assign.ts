import type { ContextItem } from '@mobius/shared';

/**
 * Assign to Mobius (docs/design/mobius-agent.md, "Hand it off, it comes back to the Inbox"): an item in an app is
 * handed to Mobius from its own menu. The work runs in a chat of its own, in the background, without opening the
 * panel or changing the chat that is open; it is listed under Also running while it runs, and lands as one row in
 * Home's Inbox with Keep all and Open. Any app can offer it: it sends this event, and the shell does the rest.
 */
export const ASSIGN_EVENT = 'mobius:assign';

export interface Assignment {
  /** What Mobius is asked to do, in the person's voice. */
  ask: string;
  /** The Inbox row's and the running row's name: the item, short. */
  title: string;
  /** The app the item lives in, so Mobius starts there and the run is shown as that app's. */
  app: string;
  context?: ContextItem[];
}

export function assignToMobius(assignment: Assignment): void {
  window.dispatchEvent(new CustomEvent<Assignment>(ASSIGN_EVENT, { detail: assignment }));
}

const quote = (text: string) => `"${text.replace(/\s+/g, ' ').trim()}"`;
const short = (text: string, n = 80) => { const one = text.replace(/\s+/g, ' ').trim(); return one.length > n ? `${one.slice(0, n - 1)}…` : one; };

/** A task: do what it says, as far as Mobius can, leaving the tick to the person unless it is plainly finished. */
export function taskAssignment(list: string, task: { text: string; notes?: string | null; due?: string | null }): Assignment {
  const notes = (task.notes ?? '').trim();
  const lines = [
    `Work on this task from my Tasks list ${quote(list)}: ${quote(task.text)}.`,
    ...(notes ? [`Its notes say: ${quote(notes.slice(0, 2000))}.`] : []),
    ...(task.due ? [`It is due ${task.due}.`] : []),
    'Do as much of it as you can in my apps, then tell me in a few lines what you did and what is left for me. Only mark the task done if it is completely finished.',
  ];
  return { ask: lines.join(' '), title: short(task.text) || 'Task', app: 'tasks' };
}

/** A message: read it and prepare what it needs (a draft reply, a task, an event), sending nothing. */
export function mailAssignment(m: { id: string; subject: string; from: { name?: string | null; email: string } }): Assignment {
  const who = m.from.name ? `${m.from.name} <${m.from.email}>` : m.from.email;
  const subject = m.subject.trim() || '(no subject)';
  return {
    ask: `Deal with this email in Mail: ${quote(subject)} from ${who} (message id ${m.id}). Read it, then prepare what it needs, such as a draft reply, a task or a calendar event. Do not send anything: leave drafts for me to look over, and tell me in a few lines what you prepared.`,
    title: short(subject),
    app: 'mail',
  };
}
