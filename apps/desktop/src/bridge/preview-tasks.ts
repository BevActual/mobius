import type { TaskAt, TaskChange, TaskItem, TaskRepeat } from '@mobius/shared';

/**
 * The preview's Tasks: lists kept in memory for as long as the preview is open, so the app can be used and looked
 * at without the Rust core. A task's `line` is its place in the list; a subtask follows the task it is under.
 */
type Row = Omit<TaskItem, 'line' | 'parent'> & { under: Row | null };

const day = (offset: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const row = (text: string, due: string | null, extra: Partial<Row> = {}): Row => ({ text, done: false, due, time: null, repeat: null, flagged: false, notes: '', under: null, ...extra });

/** The day after `due` a task repeating `every` falls on (as the Rust side does). */
function nextDue(due: string, every: TaskRepeat): string {
  const [y, m, d] = due.split('-').map(Number) as [number, number, number];
  const at = new Date(y, m - 1, d);
  if (every === 'day') at.setDate(d + 1);
  else if (every === 'week') at.setDate(d + 7);
  else if (every === 'weekday') at.setDate(d + (at.getDay() === 5 ? 3 : at.getDay() === 6 ? 2 : 1));
  else {
    const months = every === 'month' ? 1 : 12;
    const last = new Date(y, m - 1 + months + 1, 0).getDate();
    at.setFullYear(y, m - 1 + months, Math.min(d, last));
  }
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
}

function sample(): Record<string, Row[]> {
  const sled = row('Book the sled for Friday', day(2), { flagged: true, notes: 'Dana has the yard code. Ask for the long trailer.' });
  const p2 = [
    row('Confirm the build week with everyone', day(0), { done: true }),
    row('Hold 8 packs at Veltro', day(1)),
    sled,
    row('Check the trailer straps', null, { under: sled }),
    row('Bring the torque wrench', null, { under: sled, done: true }),
    row('Draft the build budget', day(0), { done: true }),
    row('Pay the Veltro deposit', day(-1), { flagged: true }),
  ];
  const work = [row('Send the Q4 report draft', day(0), { time: '16:00' }), row('Team stand-up', day(1), { time: '09:30', repeat: 'weekday' }), row('Approve Priya’s expenses', day(4)), row('Review the suppliers plugin 2.1', null)];
  const home = [row('Fix the kitchen tap', day(6)), row('Book the dentist', null)];
  return { Inbox: [row('Call Sam about the trailer', null)], 'P2 build': p2, Work: work, Home: home };
}

const LISTS = sample();
const ORDER = (): string[] => Object.keys(LISTS).sort((a, b) => (a === 'Inbox' ? -1 : b === 'Inbox' ? 1 : a.localeCompare(b)));
const fail = (message: string, conflict = false) => ({ ok: false as const, message, ...(conflict ? { conflict } : {}) });

function items(rows: Row[]): TaskItem[] {
  return rows.map((r, line) => ({ line, text: r.text, done: r.done, due: r.due, time: r.time ?? null, repeat: r.repeat ?? null, flagged: r.flagged ?? false, notes: r.notes ?? '', parent: r.under ? rows.indexOf(r.under) : null }));
}
const read = (list: string) => (LISTS[list] ? { list, tasks: items(LISTS[list]), version: 'preview' } : fail('that list is not there'));
const at = (list: string, line: number, expect: string): Row | null => (LISTS[list]?.[line]?.text === expect ? LISTS[list]![line]! : null);
/** A task and the subtasks under it. */
const block = (rows: Row[], r: Row) => rows.filter((x) => x === r || x.under === r);

export const PREVIEW_TASKS: Record<string, (...args: never[]) => unknown> = {
  'tasks.lists': () => ORDER().map((name) => ({ name, open: LISTS[name]!.filter((t) => !t.done).length, done: LISTS[name]!.filter((t) => t.done).length })),
  'tasks.read': ((list: string) => read(list)) as never,
  'tasks.createList': ((name: string) => {
    let chosen = name.replace(/[\\/:*?"<>|]/g, ' ').trim() || 'List';
    for (let n = 2; LISTS[chosen]; n += 1) chosen = `${name} ${n}`;
    LISTS[chosen] = [];
    return { name: chosen };
  }) as never,
  'tasks.add': ((list: string, text: string, due: string, options: { flagged?: boolean; under?: TaskAt; time?: string; repeat?: TaskRepeat } = {}) => {
    const rows = (LISTS[list] ??= []);
    const words = text.split(/\s+/).filter(Boolean).join(' ');
    if (!words) return fail('a task needs some words');
    if (options.under) {
      const parent = at(list, options.under.line, options.under.expect);
      if (!parent) return fail('changed elsewhere', true);
      const last = block(rows, parent).at(-1)!;
      rows.splice(rows.indexOf(last) + 1, 0, row(words, due || null, { under: parent, flagged: !!options.flagged }));
    } else rows.push(row(words, due || null, { flagged: !!options.flagged, time: (due && options.time) || null, repeat: options.repeat ?? null }));
    return read(list);
  }) as never,
  'tasks.update': ((list: string, line: number, expect: string, change: TaskChange) => {
    const r = at(list, line, expect);
    if (!r) return fail('changed elsewhere', true);
    if (change.text !== undefined) r.text = change.text.trim() || r.text;
    if (change.due !== undefined) { r.due = change.due || null; if (!r.due) r.time = null; }
    if (change.time !== undefined) r.time = (r.due && change.time) || null;
    if (change.repeat !== undefined) r.repeat = change.repeat || null;
    // Ticking off a repeating task moves it to its next day and leaves it open.
    if (change.done !== undefined) {
      if (change.done && !r.done && r.repeat) r.due = nextDue(r.due ?? day(0), r.repeat);
      else r.done = change.done;
    }
    if (change.flagged !== undefined) r.flagged = change.flagged;
    if (change.notes !== undefined) r.notes = change.notes.split('\n').filter((l) => l.trim()).join('\n');
    return read(list);
  }) as never,
  'tasks.remove': ((list: string, line: number, expect: string) => {
    const r = at(list, line, expect);
    if (!r) return fail('changed elsewhere', true);
    const rows = LISTS[list]!;
    const gone = block(rows, r);
    LISTS[list] = rows.filter((x) => !gone.includes(x));
    STASH.set(`${list}:${line}`, gone);
    return { ...read(list), removed: { line, text: `${list}:${line}` } };
  }) as never,
  'tasks.restore': ((list: string, line: number, text: string) => {
    const gone = STASH.get(text);
    if (!gone || !LISTS[list]) return fail('that cannot be put back');
    LISTS[list]!.splice(Math.min(line, LISTS[list]!.length), 0, ...gone);
    STASH.delete(text);
    return read(list);
  }) as never,
  'tasks.move': ((list: string, line: number, expect: string, to: string, before?: TaskAt) => {
    const r = at(list, line, expect);
    if (!r || !LISTS[to]) return fail('changed elsewhere', true);
    const target = before ? at(to, before.line, before.expect) : null;
    if (before && (!target || target.under)) return fail('changed elsewhere', true);
    const moving = block(LISTS[list]!, r);
    if (target && moving.includes(target)) return fail('a task cannot go inside itself');
    LISTS[list] = LISTS[list]!.filter((x) => !moving.includes(x));
    if (r.under) r.under = null;
    const dest = LISTS[to]!;
    dest.splice(target ? dest.indexOf(target) : dest.length, 0, ...moving);
    return read(to);
  }) as never,
  'tasks.renameList': ((list: string, to: string) => {
    const name = to.trim();
    if (list === 'Inbox' || !name || (LISTS[name] && name !== list)) return fail(LISTS[name] ? `there is already a list called ${name}` : 'that name cannot be used');
    const rows = LISTS[list];
    if (!rows) return fail('that list is not there');
    delete LISTS[list];
    LISTS[name] = rows;
    return { name };
  }) as never,
  'tasks.deleteList': ((list: string) => {
    if (list === 'Inbox' || !LISTS[list]) return fail('that list cannot be deleted');
    STASH.set(`list:${list}`, LISTS[list]!);
    delete LISTS[list];
    return { name: list, text: `list:${list}` };
  }) as never,
  'tasks.restoreList': ((list: string, text: string) => {
    const rows = STASH.get(text);
    if (!rows || LISTS[list]) return fail('that list cannot be put back');
    LISTS[list] = rows;
    return { name: list };
  }) as never,
  'tasks.clearDone': ((list: string) => {
    const rows = LISTS[list] ?? [];
    LISTS[list] = rows.filter((r) => !r.done && !(r.under?.done));
    return read(list);
  }) as never,
};

/** What a delete took, so Undo can put it back. */
const STASH = new Map<string, Row[]>();
