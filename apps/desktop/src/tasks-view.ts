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
export type SmartView = 'today' | 'scheduled' | 'flagged' | 'all' | 'completed';

/** The views across every list, in the order the sidebar shows them. */
export const SMART_VIEWS: readonly { id: SmartView; name: string }[] = [
  { id: 'today', name: 'Today' },
  { id: 'scheduled', name: 'Scheduled' },
  { id: 'all', name: 'All' },
  { id: 'flagged', name: 'Flagged' },
  { id: 'completed', name: 'Completed' },
];
export const smartName = (id: SmartView): string => SMART_VIEWS.find((v) => v.id === id)?.name ?? 'Today';
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

/**
 * Tasks from every list for a view: due today or late (Today) or with any date (Scheduled), earliest first; flagged
 * (Flagged); every open one, list by list (All); or every done one (Completed). Only Completed shows done tasks.
 */
export function smartView(view: SmartView, lists: Record<string, TaskItem[]>, now: Date): Located[] {
  const today = isoDay(now);
  const every: Located[] = Object.entries(lists).flatMap(([list, tasks]) => tasks.map((task) => ({ list, task })));
  if (view === 'completed') return every.filter((x) => x.task.done);
  const open = every.filter((x) => !x.task.done);
  if (view === 'all') return open;
  if (view === 'flagged') return open.filter((x) => x.task.flagged);
  const dated = open.filter((x) => x.task.due !== null && (view === 'scheduled' || x.task.due! <= today));
  return dated.sort((a, b) => a.task.due!.localeCompare(b.task.due!));
}

/** Tasks whose words or notes have every word of `query` in them, from every list. */
export function searchTasks(query: string, lists: Record<string, TaskItem[]>): Located[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  return Object.entries(lists).flatMap(([list, tasks]) => tasks
    .filter((t) => { const hay = `${t.text}\n${t.notes ?? ''}`.toLowerCase(); return words.every((w) => hay.includes(w)); })
    .map((task) => ({ list, task })));
}

/** Rows grouped under the list they are in, keeping the lists' order. */
export function byList(rows: readonly Located[]): { list: string; rows: Located[] }[] {
  const out: { list: string; rows: Located[] }[] = [];
  for (const r of rows) {
    const last = out.find((g) => g.list === r.list);
    if (last) last.rows.push(r);
    else out.push({ list: r.list, rows: [r] });
  }
  return out;
}

/** A list's tasks as the page shows them: each top-level task followed by its subtasks. */
export function nest(tasks: readonly TaskItem[]): { task: TaskItem; subtasks: TaskItem[] }[] {
  const tops = tasks.filter((t) => t.parent === null || t.parent === undefined || !tasks.some((p) => p.line === t.parent));
  return tops.map((task) => ({ task, subtasks: tasks.filter((t) => t.parent === task.line && t !== task) }));
}

/** Each list keeps a colour, as in Apple's Reminders: Inbox is blue, the rest take one from their name. */
export const LIST_COLORS = ['orange', 'green', 'purple', 'pink', 'teal', 'indigo', 'red', 'yellow', 'brown'] as const;
export type ListColor = 'blue' | (typeof LIST_COLORS)[number];
export function listColor(name: string): ListColor {
  if (name === DEFAULT_LIST_NAME) return 'blue';
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return LIST_COLORS[h % LIST_COLORS.length]!;
}

const WEEKDAY: Record<string, number> = { sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, weds: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6 };
const MONTH: Record<string, number> = { jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11 };
const COUNT: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, ten: 10 };
const plus = (now: Date, days: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
const PHRASE = new RegExp(
  `(?:^|\\s)(?:(?:due|by|on|for)\\s+)?(today|tonight|tomorrow|tmrw|tmr|next week|this weekend|the weekend|weekend`
  + `|in\\s+(?:\\d{1,3}|a|an|one|two|three|four|five|six|seven|ten)\\s+(?:days?|weeks?|months?)`
  + `|(?:next\\s+|this\\s+)?(?:${Object.keys(WEEKDAY).join('|')})`
  + `|\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${Object.keys(MONTH).join('|')})`
  + `|(?:${Object.keys(MONTH).join('|')})\\s+\\d{1,2}(?:st|nd|rd|th)?)\\s*$`,
  'i',
);

/**
 * A date said in words at the end of a new task ("Call Sam tomorrow", "Pay rent by fri", "Book flights 12 dec"):
 * the words without it, and the day it means. Nothing when there is no such phrase, or nothing would be left.
 */
export function parseWhen(text: string, now: Date): { text: string; due: string; phrase: string } | null {
  const m = PHRASE.exec(text);
  if (!m) return null;
  const rest = text.slice(0, m.index).trim();
  const said = m[1]!.toLowerCase().replace(/\s+/g, ' ');
  if (!rest) return null;
  let date: Date | null = null;
  if (said === 'today' || said === 'tonight') date = plus(now, 0);
  else if (said === 'tomorrow' || said === 'tmrw' || said === 'tmr') date = plus(now, 1);
  else if (said === 'next week') date = plus(now, ((8 - now.getDay()) % 7) || 7);
  else if (said.endsWith('weekend')) date = plus(now, now.getDay() === 0 ? 0 : 6 - now.getDay());
  else if (said.startsWith('in ')) {
    const [, n, unit] = said.split(' ');
    const k = COUNT[n!] ?? Number(n);
    date = unit!.startsWith('day') ? plus(now, k) : unit!.startsWith('week') ? plus(now, 7 * k) : new Date(now.getFullYear(), now.getMonth() + k, now.getDate());
  } else {
    const word = said.replace(/^(next|this) /, '');
    if (word in WEEKDAY) date = plus(now, ((WEEKDAY[word]! - now.getDay() + 7) % 7) || 7);
    else {
      const num = Number(/\d+/.exec(said)![0]);
      const month = MONTH[said.split(' ').find((w) => w in MONTH)!]!;
      date = new Date(now.getFullYear(), month, num);
      if (date.getMonth() !== month) return null;
      if (isoDay(date) < isoDay(now)) date = new Date(now.getFullYear() + 1, month, num);
    }
  }
  return { text: rest, due: isoDay(date), phrase: m[0].trim() };
}
