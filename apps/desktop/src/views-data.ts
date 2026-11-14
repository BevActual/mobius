import type { CalendarEvent, ConversationInfo, MailMessage, Notebook, ScheduleInfo, TaskItem } from '@mobius/shared';
import type { AppId } from './apps';
import { calendarColor, eventsOn, localDate } from './calendar-view';
import { upcoming, whenLabel } from './desk-view';
import { timeLabel, weekdayLabel } from './dates';
import { relativeTime } from './relative-time';
import { dueLabel, smartView } from './tasks-view';
import { tileKind, type Tile } from './views-format';

/** What tiles read: the live state of the other apps, as the window already has it. Views never keeps a copy. */
export interface ViewSources {
  tasks: Record<string, TaskItem[]>;
  events: readonly CalendarEvent[];
  /** The calendars' names, in the Calendar app's order: an event's dot takes its calendar's colour from it. */
  calendars: readonly string[];
  mail: { messages: readonly MailMessage[]; unread: number; accounts: number };
  notes: readonly Notebook[];
  conversations: readonly ConversationInfo[];
  schedules: readonly ScheduleInfo[];
}

/** Where a row of a tile leads when it is clicked. */
export type TileTarget =
  | { kind: 'app'; app: AppId }
  | { kind: 'note'; path: string; title: string }
  | { kind: 'conversation'; id: string }
  | { kind: 'schedules' };

export interface TileRow { key: string; text: string; detail?: string; tone?: 'mobius' | 'late'; /** Content colour, as a dot: an event's calendar. */ color?: string; target: TileTarget }
export interface TileContent {
  app: AppId;
  /** The big number, with what it counts ("3 due"), or nothing for a tile that is a list only. */
  count: { value: number; label: string } | null;
  rows: TileRow[];
  /** More than the rows shown. */
  more: number;
  /** What it says with nothing to show. */
  empty: string;
  /** Where the tile itself leads. */
  target: TileTarget;
}

const ROWS = { small: 4, wide: 6 } as const;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function take<T>(list: readonly T[], tile: Tile): { shown: T[]; more: number } {
  const n = ROWS[tile.size];
  return { shown: list.slice(0, n), more: Math.max(0, list.length - n) };
}

/** What a tile shows now, worked out from the apps' state. Pure: the same sources and time give the same tile. */
export function tileContent(tile: Tile, src: ViewSources, now: Date): TileContent {
  const app = tileKind(tile.kind).app;
  switch (tile.kind) {
    case 'tasks': {
      const show = (tile.show as 'today' | 'scheduled' | 'flagged' | 'all' | undefined) ?? 'today';
      const found = smartView(show, src.tasks, now);
      const { shown, more } = take(found, tile);
      return {
        app, more, target: { kind: 'app', app: 'tasks' },
        count: { value: found.length, label: show === 'today' ? 'due' : show === 'flagged' ? 'flagged' : 'to do' },
        rows: shown.map(({ list, task }) => {
          const due = task.due ? dueLabel(task.due, now) : null;
          return { key: `${list}:${task.line}`, text: task.text, detail: due ? due.text : list, ...(due?.tone === 'late' ? { tone: 'late' as const } : {}), target: { kind: 'app' as const, app: 'tasks' as const } };
        }),
        empty: { today: 'Nothing due today.', scheduled: 'Nothing has a date yet.', flagged: 'No flagged tasks.', all: 'No open tasks.' }[show],
      };
    }
    case 'calendar': {
      const week = tile.show === 'week';
      const days = week ? 7 : 1;
      const seen = new Set<string>();
      const found: { e: CalendarEvent; day: Date }[] = [];
      for (let i = 0; i < days; i++) {
        const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
        for (const e of eventsOn(src.events, day)) {
          const key = `${e.id}@${e.start}`;
          if (seen.has(key)) continue;
          // Today: what has finished already is left out.
          if (i === 0 && !e.allDay && localDate(e.end).getTime() <= now.getTime()) continue;
          seen.add(key);
          found.push({ e, day });
        }
      }
      const { shown, more } = take(found, tile);
      return {
        app, more, target: { kind: 'app', app: 'calendar' },
        count: { value: found.length, label: week ? (found.length === 1 ? 'event this week' : 'events this week') : found.length === 1 ? 'event left today' : 'events left today' },
        rows: shown.map(({ e, day }) => {
          const time = e.allDay ? 'All day' : timeLabel(localDate(e.start));
          const when = week && day.getDate() !== now.getDate() ? `${weekdayLabel(day)} ${time}` : time;
          return { key: `${e.id}@${e.start}`, text: e.title || 'Untitled event', detail: when, color: calendarColor(src.calendars, e.calendar), target: { kind: 'app' as const, app: 'calendar' as const } };
        }),
        empty: week ? 'Nothing in the next seven days.' : 'Nothing else today.',
      };
    }
    case 'mail': {
      const unread = src.mail.messages.filter((m) => !m.seen && m.box === 'inbox' && !m.archived).sort((a, b) => b.dateMs - a.dateMs);
      const { shown, more } = take(unread, tile);
      return {
        app, target: { kind: 'app', app: 'mail' },
        count: src.mail.accounts === 0 ? null : { value: src.mail.unread, label: 'unread' },
        rows: shown.map((m) => ({ key: m.id, text: m.subject || '(no subject)', detail: m.from.name || m.from.email, target: { kind: 'app' as const, app: 'mail' as const } })),
        // The inbox may hold more unread than the messages loaded here.
        more: Math.max(more, src.mail.unread - shown.length),
        empty: src.mail.accounts === 0 ? 'Add a mail account in Mail.' : 'All read.',
      };
    }
    case 'notes': {
      const books = tile.notebook ? src.notes.filter((nb) => nb.name === tile.notebook) : src.notes;
      const pages = books.flatMap((nb) => nb.pages).sort((a, b) => b.modified - a.modified);
      const { shown, more } = take(pages, tile);
      return {
        app, more, count: null, target: { kind: 'app', app: 'notes' },
        rows: shown.map((p) => ({ key: p.path, text: p.title || 'Untitled', detail: relativeTime(p.modified, now.getTime()), target: { kind: 'note' as const, path: p.path, title: p.title } })),
        empty: tile.notebook && books.length === 0 ? `There is no notebook called ${tile.notebook}.` : 'No notes yet.',
      };
    }
    case 'mobius': {
      const waiting = src.conversations.filter((c) => c.waiting > 0);
      const working = src.conversations.filter((c) => c.activity === 'working' && c.waiting === 0);
      const all = [...waiting.map((c) => ({ c, needs: true })), ...working.map((c) => ({ c, needs: false }))];
      const { shown, more } = take(all, tile);
      return {
        app, more, target: { kind: 'app', app: 'agent' },
        count: waiting.length > 0 ? { value: waiting.length, label: 'waiting for you' } : null,
        rows: shown.map(({ c, needs }) => ({ key: c.id, text: c.title.trim() || 'New conversation', detail: needs ? 'Needs you' : 'Working', ...(needs ? { tone: 'mobius' as const } : {}), target: { kind: 'conversation' as const, id: c.id } })),
        empty: working.length === 0 && waiting.length === 0 ? 'All quiet. Nothing is waiting for you.' : '',
      };
    }
    case 'next': {
      const next = upcoming(src.schedules, now, ROWS[tile.size]);
      return {
        app, more: 0, count: null, target: { kind: 'schedules' },
        rows: next.map(({ schedule, at }) => ({ key: schedule.id, text: schedule.title, detail: whenLabel(at, now), target: { kind: 'schedules' as const } })),
        empty: 'Nothing scheduled. Add a schedule in Settings.',
      };
    }
  }
}

/** The one line a tile reads out to a screen reader: its name and what it holds. */
export function tileSummary(title: string, content: TileContent): string {
  if (content.count) return `${title}: ${content.count.value} ${content.count.label}`;
  return content.rows.length === 0 ? `${title}: ${content.empty}` : `${title}: ${plural(content.rows.length + content.more, 'item')}`;
}
