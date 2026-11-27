import type { Message } from '@mobius/shared';

/**
 * "Save this as an Ability" (docs/design/shaping-mobius.md, Andrew 27 November 2026): after a job that took several
 * steps, its Inbox row offers to keep how it was done as an Ability, the way Hermes saves a skill after a task. Saving
 * asks Mobius, in a chat of its own, to write the Ability from the steps the job took; the new SKILL.md waits for Keep
 * like any other change, and is then in the Store and the slash menu.
 */

/** A job is worth saving once it took this many tool steps: fewer is a lookup, not a way of doing something. */
export const ABILITY_MIN_STEPS = 3;
/** The Inbox's mark on a run that writes an Ability, so its own row offers nothing more. */
export const ABILITY_ITEM = 'ability:';

const SAVED_KEY = 'mobius.abilities-saved';
const SAVED_MAX = 200;
/** The jobs (by chat) already saved as an Ability, or being saved: their rows offer it no more, even once the new
 * Ability has been kept and its own row has gone. */
export function savedJobs(): string[] {
  try {
    const v: unknown = JSON.parse(window.localStorage.getItem(SAVED_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch { return []; }
}
/** Marks a job as saved, at once (so a second press does nothing); false when it already was. `undo` clears it again. */
export function markSaved(conversation: string, undo = false): boolean {
  const all = savedJobs();
  if (!undo && all.includes(conversation)) return false;
  const next = undo ? all.filter((c) => c !== conversation) : [...all, conversation].slice(-SAVED_MAX);
  try { window.localStorage.setItem(SAVED_KEY, JSON.stringify(next)); } catch { /* Not remembered. */ }
  return true;
}

export interface JobSteps { ask: string; steps: string[]; answer: string }

const one = (text: string, n: number) => { const t = text.replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
/** A step as a short line: the tool, and the first few things it was given. */
function stepLine(name: string, args: unknown): string {
  const shown = args && typeof args === 'object' ? Object.entries(args as Record<string, unknown>).slice(0, 3).map(([k, v]) => `${k}: ${one(typeof v === 'string' ? v : JSON.stringify(v) ?? '', 60)}`).join(', ') : '';
  return shown ? `${name} (${shown})` : name;
}

/** The last job in a chat: what was asked, the tool steps taken (in order, failed ones left out) and the answer. */
export function jobSteps(history: readonly Message[]): JobSteps {
  let start = 0;
  for (let i = history.length - 1; i >= 0; i--) if (history[i]!.role === 'user') { start = i; break; }
  const turn = history.slice(start);
  const first = turn[0];
  const failed = new Set(turn.flatMap((m) => (m.role === 'tool' && m.is_error ? [m.call_id] : [])));
  const steps = turn.flatMap((m) => (m.role === 'assistant' ? m.tool_calls.filter((c) => !failed.has(c.id)).map((c) => stepLine(c.name, c.arguments)) : []));
  let answer = '';
  for (let i = turn.length - 1; i >= 0; i--) { const m = turn[i]!; if (m.role === 'assistant' && m.text.trim()) { answer = m.text.trim(); break; } }
  return { ask: first?.role === 'user' ? first.text.trim() : '', steps, answer };
}

/** The ask that writes the Ability: from the job's own steps, general enough to use again, and not doing the job twice. */
export function abilityAsk(title: string, job: JobSteps): string {
  const steps = job.steps.slice(0, 30).map((s, i) => `${i + 1}. ${s}`).join('\n');
  return [
    `Save "${one(title, 80)}" as an Ability`,
    '',
    `I just had a job done, and I want to be able to have it done the same way again. Write it as a new Ability: one file, skills/<name>/SKILL.md, where <name> is a short lowercase name with hyphens that says what it does. Use the Abilities format: front matter with "name: <name>" and "description: <one line on when to use it>", then the steps as a short numbered list, then any notes. Make the steps general (no one-off names, dates, ids or amounts; say what to look for instead), and keep what made it work. Check skills.list first and pick a name that is not taken. Do not do the job again, and change nothing else. Then tell me in one line the Ability's name.`,
    '',
    `What I asked: ${one(job.ask, 1500)}`,
    '',
    `The steps taken:\n${steps}`,
    ...(job.answer ? ['', `What it said when done: ${one(job.answer, 1500)}`] : []),
  ].join('\n');
}
