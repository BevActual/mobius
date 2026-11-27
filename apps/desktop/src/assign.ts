import { MAIN_BOT_ID, type ContextItem } from '@mobius/shared';
import type { MenuEntry } from './ui/Menu';

/**
 * Assign to Mobius (docs/design/mobius-agent.md, "Hand it off, it comes back to the Inbox"): an item in an app is
 * handed to Mobius from its own menu. The work runs in a chat of its own, in the background, without opening the
 * panel or changing the chat that is open; the ask's first line is the item's name, so that chat is named after it. It
 * is listed under Also running while it runs, and lands as one row in Home's Inbox with Keep all and Open. Any app can offer it: it sends this event, and the shell does the rest.
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
  /** Which item this is (a task's list and text, a message id, a page's path), so assigning the same one again while
   * it is being worked on says so, and two items that share a name do not. Falls back to the title. */
  item?: string;
  /** One of the person's own agents to hand it to, instead of Mobius: it runs with that agent's instructions and model. */
  bot?: { id: string; name: string };
}

/** The person's own agents, in their order (the shell keeps this current), offered beside Mobius in Assign menus. */
let agents: readonly { id: string; name: string }[] = [];
/** How many agents an item's menu offers by name; the rest are on the Agents page. */
export const ASSIGN_AGENTS_SHOWN = 4;

export function setAssignAgents(list: readonly { id: string; name: string }[]): void {
  agents = list.filter((b) => b.id !== MAIN_BOT_ID).map((b) => ({ id: b.id, name: b.name }));
}

/**
 * An item's Assign rows: Mobius first, then each of the person's agents by name, so a task can go to the agent made for
 * it ("Assign to Invoices"). `make` builds the hand-off when a row is chosen.
 */
export function assignEntries(make: () => Assignment, back?: () => HTMLElement | null | undefined): MenuEntry[] {
  return [
    { label: 'Assign to Mobius', separated: true, run: () => assignToMobius(make(), back) },
    ...agents.slice(0, ASSIGN_AGENTS_SHOWN).map((bot) => ({ label: `Assign to ${bot.name}`, run: () => assignToMobius({ ...make(), bot }, back) })),
  ];
}

/**
 * Hand it to Mobius. `back` is where the keyboard goes once the menu it was chosen from has gone (the item's row):
 * choosing it moves nothing on the page, so without it the focus would be left on nothing.
 */
export function assignToMobius(assignment: Assignment, back?: () => HTMLElement | null | undefined): void {
  window.dispatchEvent(new CustomEvent<Assignment>(ASSIGN_EVENT, { detail: assignment }));
  if (!back) return;
  const lost = () => !document.activeElement || document.activeElement === document.body || Boolean(document.activeElement.closest('.ui-menu'));
  let tries = 0;
  const settle = () => {
    if (lost()) back()?.focus();
    if (++tries < 10) window.setTimeout(settle, 40);
  };
  window.setTimeout(settle, 0);
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
  const title = short(task.text) || 'Task';
  return { ask: `${title}\n\n${lines.join(' ')}`, title, app: 'tasks', item: `tasks:${list}:${task.text}` };
}

/** A note or a document: do what it asks for, or its next steps, adding to it only where it says so. */
export function pageAssignment(app: 'notes' | 'docs', page: { path: string; title: string }): Assignment {
  const where = app === 'docs' ? 'document in Docs' : 'note in Notes';
  const title = short(page.title) || (app === 'docs' ? 'Document' : 'Note');
  return {
    ask: `${title}\n\nWork on my ${where} ${quote(page.title)} (${app}/${page.path}). Read it, then do what it asks for or the next steps it lists, as far as you can in my apps. Add to it only where it asks you to. Tell me in a few lines what you did and what is left for me.`,
    title,
    app,
    item: `${app}:${page.path}`,
  };
}

/** A project: its next steps, from its Tasks list and its last update, as far as Mobius can take them. */
export function projectAssignment(p: { name: string; list?: string; target?: string; updates?: readonly { text: string }[] }): Assignment {
  const title = short(p.name) || 'Project';
  const last = p.updates?.at(-1)?.text.trim();
  const lines = [
    `Move my project ${quote(p.name)} in Projects forward.`,
    ...(p.list ? [`Its work is in my Tasks list ${quote(p.list)}.`] : []),
    ...(p.target ? [`It should be done by ${p.target}.`] : []),
    ...(last ? [`Its last update says: ${quote(last.slice(0, 2000))}.`] : []),
    'Take the next steps you can in my apps, leaving ticks and anything that sends or deletes to me, then tell me in a few lines what you did and what is left for me.',
  ];
  return { ask: `${title}\n\n${lines.join(' ')}`, title, app: 'projects', item: `projects:${p.name}` };
}

/** A message: read it and prepare what it needs (a draft reply, a task, an event), sending nothing. */
export function mailAssignment(m: { id: string; subject: string; from: { name?: string | null; email: string } }): Assignment {
  const who = m.from.name ? `${m.from.name} <${m.from.email}>` : m.from.email;
  const subject = m.subject.trim() || '(no subject)';
  const title = short(subject);
  return {
    ask: `${title}\n\nDeal with this email in Mail: ${quote(subject)} from ${who} (message id ${m.id}). Read it, then prepare what it needs, such as a draft reply, a task or a calendar event. Do not send anything: leave drafts for me to look over, and tell me in a few lines what you prepared.`,
    title,
    app: 'mail',
    item: `mail:${m.id}`,
  };
}
