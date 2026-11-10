import type { TaskItem } from '@mobius/shared';

/** The list every task lands in when no list is named (matches the Rust side). */
export const DEFAULT_LIST_NAME = 'Inbox';

/** The text of each task in a list's Markdown, done or not, without its due date: "- [ ] Call Sam (due 2026-11-10)". */
export function tasksIn(markdown: string): ReadonlySet<string> {
  const found = new Set<string>();
  for (const line of markdown.split(/\r?\n/)) {
    const m = /^\s*[-*] \[[ xX]\] (.*?)(?:\s+\(due \d{4}-\d{2}-\d{2}\))?\s*$/.exec(line);
    if (m && m[1]) found.add(m[1]);
  }
  return found;
}

export type DueTone = 'late' | 'today' | 'soon' | 'later';
export type SmartView = 'today' | 'scheduled';
export interface Located { list: string; task: TaskItem }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const dayNumber = (d: Date) => Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);
const parse = (due: string) => { const [y, m, d] = due.split('-').map(Number); return new Date(y!, m! - 1, d!); };
/** Today as YYYY-MM-DD in the person's own time zone. */
export const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** A due date in words: Today, Tomorrow, a weekday within the week, else the date; anything past is late. */
export function dueLabel(due: string, now: Date): { text: string; tone: DueTone } {
  const date = parse(due);
  const days = dayNumber(date) - dayNumber(now);
  const plain = `${date.getDate()} ${MONTHS[date.getMonth()]}${date.getFullYear() === now.getFullYear() ? '' : ` ${date.getFullYear()}`}`;
  if (days === 0) return { text: 'Today', tone: 'today' };
  if (days === 1) return { text: 'Tomorrow', tone: 'soon' };
  if (days === -1) return { text: 'Yesterday', tone: 'late' };
  if (days < 0) return { text: plain, tone: 'late' };
  if (days < 7) return { text: DAYS[date.getDay()]!, tone: 'soon' };
  return { text: plain, tone: 'later' };
}

export function splitDone(tasks: TaskItem[]): { open: TaskItem[]; done: TaskItem[] } {
  return { open: tasks.filter((t) => !t.done), done: tasks.filter((t) => t.done) };
}

/** Open tasks from every list: due today or late (Today), or with any date (Scheduled), earliest first. */
export function smartView(view: SmartView, lists: Record<string, TaskItem[]>, now: Date): Located[] {
  const today = isoDay(now);
  const all: Located[] = Object.entries(lists).flatMap(([list, tasks]) => tasks.filter((t) => !t.done && t.due !== null).map((task) => ({ list, task })));
  const chosen = view === 'today' ? all.filter((x) => x.task.due! <= today) : all;
  return chosen.sort((a, b) => a.task.due!.localeCompare(b.task.due!));
}
