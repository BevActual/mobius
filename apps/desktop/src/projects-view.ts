import type { ConversationInfo, ProjectHealth, ProjectInfo, ProjectStatus, ProjectUpdate } from '@mobius/shared';
import { relativeTime } from './relative-time';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The project's own threads, each with what the window knows of it, the newest first. */
export function projectThreads(project: ProjectInfo, conversations: readonly ConversationInfo[]) {
  const rows = project.threads.map((id, order) => ({ id, order, info: conversations.find((c) => c.id === id) }));
  return rows.sort((a, b) => (b.info?.updated_ms ?? 0) - (a.info?.updated_ms ?? 0) || b.order - a.order);
}

/** The one line under a thread's name: how much is in it and when it last moved. */
export function threadLine(info: ConversationInfo | undefined, now: number): string {
  if (!info) return 'Not started';
  const when = relativeTime(info.updated_ms, now);
  const size = info.messages === 0 ? 'Not started' : plural(info.messages, 'message');
  return when ? `${size} · ${when}` : size;
}

/** The line at the top of a project's page: its threads, what waits on you and when anything last happened. */
export function projectSummary(project: ProjectInfo, conversations: readonly ConversationInfo[], made: number, now: number): string {
  const threads = projectThreads(project, conversations);
  const waiting = threads.reduce((n, t) => n + (t.info?.waiting ?? 0), 0);
  const last = Math.max(0, ...threads.map((t) => t.info?.updated_ms ?? 0));
  const parts = [threads.length === 0 ? 'No threads yet' : plural(threads.length, 'thread')];
  if (made > 0) parts.push(`${made} made`);
  if (waiting > 0) parts.push(`${waiting} waiting on you`);
  if (last > 0) parts.push(`updated ${relativeTime(last, now).replace(/^[A-Z]/, (c) => c.toLowerCase())}`);
  return parts.join(' · ');
}

/**
 * The apps a project's rules list: the ones added from Abilities, and any other with a rule of its own (so a rule is
 * never set where it cannot be seen).
 */
export function ruleApps<T extends string>(all: readonly T[], rules: ProjectInfo['rules'], installed: (id: string) => boolean): T[] {
  return all.filter((app) => installed(app) || (rules[app] !== undefined));
}

/** Linear's project statuses, in their order, with the words shown for each. */
export const PROJECT_STATUSES: readonly { id: ProjectStatus; name: string }[] = [
  { id: 'backlog', name: 'Backlog' },
  { id: 'planned', name: 'Planned' },
  { id: 'started', name: 'In progress' },
  { id: 'paused', name: 'Paused' },
  { id: 'completed', name: 'Completed' },
  { id: 'canceled', name: 'Canceled' },
];
export const statusName = (s: ProjectStatus | undefined) => PROJECT_STATUSES.find((x) => x.id === s)?.name ?? 'No status';

/** How far the project's task list has come, as Linear's progress: done out of all, and the share done (0 to 100). */
export function progressOf(info: { open: number; done: number } | undefined): { done: number; total: number; percent: number } | null {
  if (!info) return null;
  const total = info.open + info.done;
  return { done: info.done, total, percent: total === 0 ? 0 : Math.round((info.done / total) * 100) };
}

/**
 * The target day in words, and whether it has passed while the work is still open: "Dec 4", "Dec 4, 2027" in another
 * year, "Today", or "Tomorrow".
 */
export function targetLine(target: string | undefined, status: ProjectStatus | undefined, now: Date): { text: string; late: boolean } | null {
  if (!target || !/^\d{4}-\d{2}-\d{2}$/.test(target)) return null;
  const [y, m, d] = target.split('-').map(Number) as [number, number, number];
  const day = new Date(y, m - 1, d);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((day.getTime() - today.getTime()) / 86_400_000);
  const text = diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : day.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(y !== now.getFullYear() ? { year: 'numeric' } : {}) });
  return { text, late: diff < 0 && status !== 'completed' && status !== 'canceled' };
}

/**
 * The Projects panel's groups: one "Projects" group while no project has a status; else, as Linear's projects list,
 * a group per status in work order (In progress, Planned, Paused, Backlog, then Completed and Canceled), with
 * projects without one under "No status" after the open ones. Empty groups are left out.
 */
export function groupByStatus<T extends Pick<ProjectInfo, 'status'>>(projects: readonly T[]): { title: string; projects: T[] }[] {
  if (!projects.some((p) => p.status)) return [{ title: 'Projects', projects: [...projects] }];
  const order: (ProjectStatus | undefined)[] = ['started', 'planned', 'paused', 'backlog', undefined, 'completed', 'canceled'];
  return order.map((st) => ({ title: statusName(st), projects: projects.filter((p) => p.status === st) })).filter((g) => g.projects.length > 0);
}

/** Linear's project health, in its order, with the words shown for each. */
export const PROJECT_HEALTHS: readonly { id: ProjectHealth; name: string }[] = [
  { id: 'on_track', name: 'On track' },
  { id: 'at_risk', name: 'At risk' },
  { id: 'off_track', name: 'Off track' },
];
export const healthName = (h: ProjectHealth) => PROJECT_HEALTHS.find((x) => x.id === h)?.name ?? 'On track';

/** Where a project stands at one moment: what an update keeps, and what the next one is compared with. */
export interface ProjectStanding { status?: ProjectStatus | undefined; target?: string | undefined; done?: number | undefined; total?: number | undefined }

/**
 * What changed between two moments, as Linear's progress report on an update: the status, the target day, and the
 * progress when it moved by more than 2 points. Nothing for the first update.
 */
export function changesSince(before: ProjectStanding | undefined, after: ProjectStanding, now: Date): string[] {
  if (!before) return [];
  const out: string[] = [];
  if ((before.status ?? '') !== (after.status ?? '')) out.push(`Status: ${statusName(before.status)} → ${statusName(after.status)}`);
  if ((before.target ?? '') !== (after.target ?? '')) {
    const day = (t: string | undefined) => targetLine(t, 'completed', now)?.text;
    const was = day(before.target), is = day(after.target);
    out.push(was && is ? `Target day: ${was} → ${is}` : is ? `Target day set to ${is}` : 'Target day removed');
  }
  const share = (s: ProjectStanding) => (s.total ? Math.round(((s.done ?? 0) / s.total) * 100) : null);
  const was = share(before), is = share(after);
  if (is !== null && Math.abs(is - (was ?? 0)) > 2) out.push(`Progress: ${was ?? 0}% → ${is}%${after.done !== undefined && after.total ? ` (${after.done} of ${after.total} done)` : ''}`);
  return out;
}

/** A week: an In progress project whose last update is older than this (or that has none) is due one, as Linear's reminders. */
export const UPDATE_EVERY_MS = 7 * 24 * 3_600_000;

/** Whether an update is due: only for work In progress, a week after the last (or with none yet). */
export function updateDue(project: Pick<ProjectInfo, 'status' | 'updates'>, now: number): boolean {
  if (project.status !== 'started') return false;
  const last = project.updates?.at(-1);
  return !last || now - last.at > UPDATE_EVERY_MS;
}

/** The latest update, if any. */
export const latestUpdate = (project: Pick<ProjectInfo, 'updates'>): ProjectUpdate | undefined => project.updates?.at(-1);

/**
 * What Mobius is asked for a drafted update, as Linear's "Write with agent": where the project stands, what changed
 * since the last update, its threads and what side threads reported, and the last update itself.
 */
export function draftAsk(project: ProjectInfo, facts: { changes: string[]; threads: string[]; reports: string[]; progress: string | null; target: string | null }): string {
  const last = latestUpdate(project);
  const lines = [
    `Write a short project update for "${project.name}", as a project lead posts on Linear: what moved, what is at risk, and what comes next.`,
    'Start with one line saying its health: On track, At risk or Off track. Then the update itself, in a few short sentences or bullets, plain and specific. Reply with only that.',
    '',
    `Status: ${statusName(project.status)}.`,
  ];
  if (facts.target) lines.push(`Target day: ${facts.target}.`);
  if (facts.progress) lines.push(`Progress: ${facts.progress}.`);
  if (facts.changes.length > 0) lines.push(`Since the last update: ${facts.changes.join('; ')}.`);
  if (facts.threads.length > 0) lines.push(`Its threads: ${facts.threads.join('; ')}.`);
  if (facts.reports.length > 0) lines.push(`What side threads reported: ${facts.reports.join(' | ')}`);
  if (last) lines.push('', `The last update (${healthName(last.health)}): ${last.text}`);
  return lines.join('\n');
}

/** A drafted update split into its health (from its first line, when it says one) and its words. */
export function parseDraft(text: string): { health: ProjectHealth | null; text: string } {
  const lines = text.trim().split(/\r?\n/);
  const first = (lines[0] ?? '').replace(/[*_#>`]/g, '').replace(/^health\s*:\s*/i, '').trim().toLowerCase().replace(/[.:!]+$/, '');
  const found = PROJECT_HEALTHS.find((h) => first === h.name.toLowerCase());
  return found ? { health: found.id, text: lines.slice(1).join('\n').trim() } : { health: null, text: text.trim() };
}
