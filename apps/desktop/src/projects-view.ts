import type { ConversationInfo, ProjectInfo, ProjectStatus } from '@mobius/shared';
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
