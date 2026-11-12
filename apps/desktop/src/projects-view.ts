import type { ConversationInfo, ProjectInfo } from '@mobius/shared';
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
