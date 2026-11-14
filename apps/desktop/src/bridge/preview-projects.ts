import type { ConversationInfo, ProjectInfo, ProjectLevel } from '@mobius/shared';

/**
 * The preview's Projects: two projects kept in memory for as long as the preview is open, with threads, a bot's side
 * thread, a memory page and what the threads made, so the app can be used and looked at without the Rust core.
 */
const now = Date.now();
const min = 60_000;
const hour = 60 * min;

const CONVERSATIONS: ConversationInfo[] = [
  { id: 'main:p2-plan', title: 'Plan the P2 build week', updated_ms: now - 12 * min, messages: 14, activity: 'needs_you', waiting: 1 },
  { id: 'main:p2-cells', title: 'Compare the cell quotes', updated_ms: now - 3 * hour, messages: 8, activity: 'idle', waiting: 0 },
  { id: 'scout:p2-sled', title: 'Find a sled slot', updated_ms: now - 40 * min, messages: 4, activity: 'idle', waiting: 0 },
  { id: 'scout:p2-torque', title: 'Check the torque spec sheet', updated_ms: now - 2 * hour, messages: 0, activity: 'failed', waiting: 0 },
  { id: 'main:hire-1', title: 'Shortlist for the build engineer', updated_ms: now - 26 * hour, messages: 6, activity: 'idle', waiting: 0 },
  { id: 'main:loose', title: 'Weekend in Porto', updated_ms: now - 50 * hour, messages: 5, activity: 'idle', waiting: 0 },
];

const PROJECTS: ProjectInfo[] = [
  {
    id: 'p1', name: 'Kestrel P2 build',
    rules: { notes: 'act', sheets: 'act', mail: 'ask' },
    threads: ['main:p2-plan', 'main:p2-cells'],
    sides: [{ conversation: 'scout:p2-sled', parent: 'main:p2-plan', bot: 'scout', botName: 'Scout', ask: 'Find a sled slot on Friday', report: 'Northfield has the long sled free Friday 08:00 to 12:00. I held it until tomorrow noon.' }],
  },
  { id: 'p2', name: 'Hiring', rules: {}, threads: ['main:hire-1'] },
];

const MADE: Record<string, string[]> = {
  p1: ['notes/Kestrel P2 build/Build plan.md', 'sheets/P2 budget/Sheet 1.csv', 'docs/Kestrel P2 build/Build brief.md', 'tasks/P2 build.md'],
  p2: [],
};

let nextId = 3;
const fail = (message: string) => ({ ok: false as const, message });
const find = (id: string) => PROJECTS.find((p) => p.id === id);

export const PREVIEW_PROJECTS: Record<string, (...args: never[]) => unknown> = {
  'agent.conversations': () => CONVERSATIONS.map((c) => ({ ...c })),
  'projects.list': () => PROJECTS.map((p) => ({ ...p, threads: [...p.threads], sides: [...(p.sides ?? [])] })),
  'projects.create': ((name: string) => {
    const clean = name.trim();
    if (!clean) return fail('a project needs a name');
    if (PROJECTS.some((p) => p.name.toLowerCase() === clean.toLowerCase())) return fail(`there is already a project called ${clean}`);
    const made: ProjectInfo = { id: `p${nextId++}`, name: clean, rules: {}, threads: [] };
    PROJECTS.push(made);
    MADE[made.id] = [];
    return made;
  }) as never,
  'projects.rename': ((id: string, name: string) => { const p = find(id); if (!p) return fail('that project is not there'); p.name = name.trim() || p.name; return p; }) as never,
  'projects.remove': ((id: string) => { const i = PROJECTS.findIndex((p) => p.id === id); if (i >= 0) PROJECTS.splice(i, 1); return { ok: true }; }) as never,
  'projects.setRule': ((id: string, app: string, level: ProjectLevel | 'follow') => {
    const p = find(id);
    if (!p) return fail('that project is not there');
    if (level === 'follow') delete p.rules[app]; else p.rules[app] = level;
    return p;
  }) as never,
  'projects.addThread': ((id: string, conversation: string) => {
    const p = find(id);
    if (!p) return fail('that project is not there');
    for (const other of PROJECTS) other.threads = other.threads.filter((t) => t !== conversation);
    p.threads.push(conversation);
    return p;
  }) as never,
  'projects.removeThread': ((id: string, conversation: string) => {
    const p = find(id);
    if (!p || !p.threads.includes(conversation)) return fail('that conversation is not in this project');
    p.threads = p.threads.filter((t) => t !== conversation);
    p.sides = (p.sides ?? []).filter((s) => s.parent !== conversation);
    return p;
  }) as never,
  'projects.made': ((id: string) => MADE[id] ?? []) as never,
  // A project's memory page and the lines offered to it are Knowledge's (wiki.*), answered in preview-knowledge.ts.
};
