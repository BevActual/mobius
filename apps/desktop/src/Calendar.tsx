import { useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { CalendarDraft, CalendarEvent, CalendarSuggestion } from '@mobius/shared';
import { isNotesFailure } from '@mobius/shared';
import { onCommand } from './commands';
import { useMorphIn } from './motion';
import { formatWith } from './dates';
import { settleBy, settleGone } from './settle';
import { addDays, dayLabel, parseDayText, parseTimeText, timeLabel, weekStart, allDayOn, atMinutes, calendarColor, clock, hourLabel, daysFor, draftEnd, dragged, eventsOn, isoDay, isoTime, localDate, movedByDays, parseEventWords, placeDay, REPEAT_OPTIONS, sameDay, snapMinutes, step, type CalendarMode } from './calendar-view';
import { parseWhen } from './tasks-view';
import type { CalendarState, DueTask } from './useCalendar';
import './calendar.css';
import { ReviewActions, WhyThis } from './ReviewBar';
import { useCalendarReview, type CalendarReview } from './useCalendarReview';
import type { Start } from './SideNew';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';

const HOUR_PX = 48;
/** The hours' margin: wide enough for "10:20 AM" on the 12-hour clock. */
const GUTTER = 60;
/** How many events and tasks a month cell lists before "more". */
const CELL_ROWS = 4;
const MODES: { id: CalendarMode; name: string }[] = [{ id: 'day', name: 'Day' }, { id: 'week', name: 'Week' }, { id: 'month', name: 'Month' }];

const PRESETS = [
  { id: 'icloud', name: 'iCloud', server: 'https://caldav.icloud.com', user: 'Apple Account email', help: 'Use an app-specific password, made at account.apple.com under Sign-In and Security. Your Apple Account password will not work here.' },
  { id: 'fastmail', name: 'Fastmail', server: 'https://caldav.fastmail.com/dav/', user: 'Fastmail email', help: 'Use an app password, made in Fastmail under Settings › Privacy & Security › Manage app passwords, with access to calendars (CalDAV).' },
  { id: 'other', name: 'Nextcloud or another server', server: '', user: 'Account name', help: 'Nextcloud\'s address ends in /remote.php/dav. Most servers take an app password, made in their security settings.' },
] as const;

/** Adds a calendar kept elsewhere: a link to subscribe to, or an account on a CalDAV server. */
function AccountDialog({ calendar, onClose }: { calendar: CalendarState; onClose: () => void }) {
  const [kind, setKind] = useState<'link' | (typeof PRESETS)[number]['id']>('link');
  const preset = PRESETS.find((p) => p.id === kind);
  const [name, setName] = useState('');
  const [link, setLink] = useState('');
  const [server, setServer] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    const failed = kind === 'link'
      ? await calendar.addAccount({ kind: 'subscription', name: name.trim(), link: link.trim() })
      : await calendar.addAccount({ kind: 'caldav', name: name.trim() || preset!.name, server: preset!.server || server.trim(), username: username.trim(), password });
    setBusy(false);
    if (failed) setProblem(failed); else onClose();
  };
  const sheet = useRef<HTMLFormElement>(null);
  useMorphIn(sheet, true);
  return (
    <div className="cal-editor-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form ref={sheet} className="cal-editor" role="dialog" aria-modal="true" aria-label="Add a calendar account" onSubmit={(e) => void submit(e)} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
        <h2 className="cal-editor-heading">Add a calendar</h2>
        <label className="cal-editor-row"><span>From</span>
          <select aria-label="Where the calendar is" value={kind} onChange={(e) => { setKind(e.target.value as typeof kind); setProblem(null); }}>
            <option value="link">A calendar link (.ics or webcal)</option>
            {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        {kind === 'link' ? (
          <>
            <input aria-label="Calendar link" placeholder="webcal://… or https://….ics" value={link} required autoFocus onChange={(e) => setLink(e.target.value)} />
            <input aria-label="Name" placeholder="Name, such as Holidays" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
            <p className="cal-editor-note">Mobius reads the link again every 15 minutes. A subscribed calendar can be read but not changed. For Google or Outlook, their settings give a private address in iCal format that works here.</p>
          </>
        ) : (
          <>
            {kind === 'other' && <input aria-label="Server address" placeholder="https://cloud.example.com/remote.php/dav" value={server} required autoFocus onChange={(e) => setServer(e.target.value)} />}
            <input aria-label={preset!.user} placeholder={preset!.user} value={username} required autoFocus={kind !== 'other'} autoComplete="username" onChange={(e) => setUsername(e.target.value)} />
            <input aria-label="App password" placeholder="App password" type="password" value={password} required autoComplete="current-password" onChange={(e) => setPassword(e.target.value)} />
            <p className="cal-editor-note">{preset!.help} The password is kept in this computer's secret store. Events you or Mobius add go to the server.</p>
          </>
        )}
        {problem && <p className="tasks-message" role="alert">{problem}</p>}
        <div className="cal-editor-actions">
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Connecting…' : kind === 'link' ? 'Subscribe' : 'Connect'}</button>
        </div>
      </form>
    </div>
  );
}

function CalendarRow({ calendar, name }: { calendar: CalendarState; name: string }) {
  return (
    <li>
      <label className="calendar-row">
        <input type="checkbox" checked={!calendar.hidden.has(name)} onChange={() => calendar.toggle(name)} style={{ ['--swatch' as string]: calendarColor(calendar.calendars, name) }} />
        <span className="list-name">{name}</span>
        {calendar.readOnly(name) && <svg className="cal-lock" viewBox="0 0 20 20" role="img" aria-label="Read only"><rect x="5" y="9" width="10" height="8" rx="1.5" /><path d="M7.5 9V7a2.5 2.5 0 0 1 5 0v2" /></svg>}
      </label>
    </li>
  );
}

/** A small month to jump to any day; the days on screen are marked. */
function MiniMonth({ calendar }: { calendar: CalendarState }) {
  const a = calendar.anchor;
  const [month, setMonth] = useState(() => new Date(a.getFullYear(), a.getMonth(), 1));
  useEffect(() => { setMonth(new Date(a.getFullYear(), a.getMonth(), 1)); }, [a.getFullYear(), a.getMonth()]); // eslint-disable-line react-hooks/exhaustive-deps
  const days = daysFor('month', month);
  const onScreen = new Set(daysFor(calendar.mode, a).map(isoDay));
  // Days with something on are dotted. The month is read on its own, as it may be one the window is not showing.
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const first = isoDay(days[0]!);
  const last = isoDay(days[days.length - 1]!);
  useEffect(() => {
    let live = true;
    void window.mobius.calendar?.events(first, last).then((got) => {
      if (!live || isNotesFailure(got)) return;
      const shown = got.filter((e) => !calendar.hidden.has(e.calendar));
      setBusy(new Set(days.filter((d) => eventsOn(shown, d).length > 0).map(isoDay)));
    }).catch(() => {});
    return () => { live = false; };
  }, [first, last, calendar.events, calendar.hidden]); // eslint-disable-line react-hooks/exhaustive-deps
  const today = new Date();
  const go = (by: 1 | -1) => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + by, 1));
  return (
    <div className="cal-mini" role="group" aria-label="Go to a day">
      <div className="cal-mini-head">
        <span className="cal-mini-title">{formatWith(month, { month: 'long', year: 'numeric' })}</span>
        <button type="button" className="strip-btn" aria-label="Previous month" onClick={() => go(-1)}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m12 5-5 5 5 5" /></svg></button>
        <button type="button" className="strip-btn" aria-label="Next month" onClick={() => go(1)}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m8 5 5 5-5 5" /></svg></button>
      </div>
      <div className="cal-mini-grid">
        {days.slice(0, 7).map((d) => <span key={`h${d.getDay()}`} className="cal-mini-dow" aria-hidden="true">{formatWith(d, { weekday: 'narrow' })}</span>)}
        {days.map((d) => (
          <button
            key={isoDay(d)}
            type="button"
            className="cal-mini-day"
            aria-label={formatWith(d, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            aria-current={sameDay(d, today) ? 'date' : undefined}
            data-outside={d.getMonth() !== month.getMonth() || undefined}
            data-shown={(calendar.mode !== 'month' && onScreen.has(isoDay(d))) || undefined}
            data-anchor={sameDay(d, a) || undefined}
            data-busy={busy.has(isoDay(d)) || undefined}
            onClick={() => calendar.setAnchor(d)}
          >{d.getDate()}</button>
        ))}
      </div>
    </div>
  );
}

/** The calendars, each with its colour (unticked ones are hidden), grouped by where they are kept. */
export function CalendarSidebar({ calendar, pin }: { calendar: CalendarState; pin?: ReactNode; onNew?: () => void; starts?: readonly Start[]; onStart?: (prompt: string) => void }) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);
  useEffect(() => onCommand('new-calendar', () => setNaming(true)), []);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (await calendar.createCalendar(name.trim() || 'Calendar')) { setNaming(false); setName(''); }
  };
  const local = calendar.sources.length > 0 ? calendar.sources.filter((s) => s.account === null).map((s) => s.name) : calendar.calendars;
  return (
    <aside className="side calendar-side" aria-label="Calendar sidebar">
      <div className="side-head">
        <span className="side-title" title="Your own calendars are kept as .ics files in your workspace, so any calendar app can open them.">Calendars</span>
        <span className="side-actions">
          {pin}
          <button type="button" className="strip-btn" aria-label="New calendar" title="New calendar" onClick={() => setNaming(true)}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg>
          </button>
        </span>
      </div>
      <div className="calendar-groups">
        <MiniMonth calendar={calendar} />
        <ul className="calendar-list" role="list" aria-label="Calendars">
          {local.map((c) => <CalendarRow key={c} calendar={calendar} name={c} />)}
        </ul>
        {naming && (
          <form className="notes-name" onSubmit={(e) => void submit(e)}>
            <input autoFocus aria-label="Calendar name" placeholder="Calendar name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setNaming(false); }} />
            <button type="submit" className="btn primary">Create</button>
          </form>
        )}
        {calendar.accounts.map((a) => {
          const names = calendar.sources.filter((s) => s.account === a.name).map((s) => s.name);
          return (
            <section key={a.id} className="calendar-account" aria-label={a.name}>
              <div className="calendar-account-head">
                <span className="calendar-account-name">{a.name}</span>
                <button type="button" className="strip-btn" aria-label={`Refresh ${a.name}`} title="Refresh now" disabled={calendar.syncing} onClick={() => void calendar.sync(a.id)}>
                  <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M16 10a6 6 0 1 1-1.8-4.3M16 3v4h-4" /></svg>
                </button>
                <button type="button" className="strip-btn" aria-label={`Remove ${a.name}`} title="Remove this account from Mobius" onClick={() => void calendar.removeAccount(a.id)}>
                  <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 6l8 8M14 6l-8 8" /></svg>
                </button>
              </div>
              {a.problem && <p className="calendar-account-problem" role="alert">{a.problem}</p>}
              <ul className="calendar-list" role="list" aria-label={`${a.name} calendars`}>
                {names.map((c) => <CalendarRow key={c} calendar={calendar} name={c} />)}
              </ul>
            </section>
          );
        })}
        {window.mobius.tasks && (
          <ul className="calendar-list" role="list" aria-label="Also show">
            <li>
              <label className="calendar-row">
                <input type="checkbox" checked={calendar.showTasks} onChange={calendar.toggleTasks} style={{ ['--swatch' as string]: 'var(--muted)' }} />
                <span className="list-name">Tasks with due dates</span>
              </label>
            </li>
          </ul>
        )}
        <button type="button" className="calendar-add-account" onClick={() => setAdding(true)}>Add a calendar account…</button>
      </div>
      {adding && createPortal(<div className="cal-modal-layer"><AccountDialog calendar={calendar} onClose={() => setAdding(false)} /></div>, document.body)}
    </aside>
  );
}

/** What the editor opens with: an event to change, or the start (and, swept out, the end) of a new one. */
type Editing = ({ event: CalendarEvent } | { start: string; end?: string; allDay: boolean }) & {
  /** Where it was opened from: the editor opens beside it, as Calendar's popover does. Without it, a sheet in the middle. */
  at?: DOMRect;
};
/** A new event's place on the grid while its editor is open, so the time it will take is drawn there. */
type Pending = { start: string; end: string };
/** What a right-click opens: a menu of what can be done to an event or a stretch of time. */
type Menu = { x: number; y: number; label: string; items: ContextMenuItem[] };

/** An event on screen; a suggestion from Mobius carries what it suggests, and is drawn dashed until answered. */
type Shown = CalendarEvent & { suggestion?: CalendarSuggestion };

/** A suggestion placed like an event. Its all-day end is the last day; an event's is the day after. */
function asShown(s: CalendarSuggestion): Shown {
  const end = s.allDay ? isoDay(addDays(localDate(s.end), 1)) : s.end;
  return { id: `suggested:${s.id}`, calendar: s.calendar, title: s.title, start: s.start, end, allDay: s.allDay, location: s.location, notes: s.notes, repeats: false, suggestion: s };
}

/** Everything to draw: the events, then Mobius's suggestions. */
const onScreen = (calendar: CalendarState): Shown[] => [...calendar.events, ...calendar.suggestions.filter((s) => !calendar.hidden.has(s.calendar)).map(asShown)];
/** One time of an event: a repeating event's times share its id. */
const keyOf = (e: CalendarEvent) => `${e.id}:${e.start}`;
/** Whether an event can be dragged: not a suggestion, and not from a calendar that can only be read. */
const movable = (calendar: CalendarState, e: Shown) => !e.suggestion && !e.readOnly && !calendar.readOnly(e.calendar);
/** A move to make: the event as it was, and where it goes, as the editor would send it. */
export type MoveEvent = (event: Shown, to: { start: string; end: string }) => Promise<unknown>;

/** The event being carried to another day in Month or the all-day row, and the day it was picked up from. */
let carrying: { event: Shown; from: Date } | null = null;

/** What the grids share with the page: the event picked out, and its right-click menu. */
type Picking = { selected: string | null; onMenu: (e: Shown, x: number, y: number) => void; /** Ids of events Mobius's last turn added or changed, drawn dashed until kept. */ proposed: ReadonlySet<string> };

function EventBlock({ calendar, event, style, onOpen, compact, from, onPointerDown, onResize, dragging, span, picking }: {
  calendar: CalendarState; event: Shown; style?: React.CSSProperties; onOpen: (e: Shown, at?: DOMRect) => void; compact?: boolean; picking: Picking;
  /** Where this day falls in an event of several days, so the days join into one bar; `quiet` leaves its title to the first part. */
  span?: { from: boolean; to: boolean; quiet: boolean };
  /** The day it is drawn on, so it can be carried to another (Month and the all-day row). */
  from?: Date;
  onPointerDown?: (e: React.PointerEvent) => void; onResize?: (e: React.PointerEvent) => void; dragging?: boolean;
}) {
  const color = calendarColor(calendar.calendars, event.calendar);
  const when = event.allDay ? 'All day' : `${clock(event.start)}–${clock(event.end)}`;
  const carry = from !== undefined && movable(calendar, event);
  const task = taskFor(calendar.due, event);
  // The hover tip goes once the event is opened, so it never sits over the editor, and comes back when the pointer next comes over it.
  const [tip, setTip] = useState(true);
  return (
    <button
      type="button"
      className="cal-event"
      data-suggested={event.suggestion ? true : undefined}
      data-suggestion={event.suggestion?.id}
      data-all-day={event.allDay || undefined}
      data-fresh={calendar.fresh.has(event.id) || undefined}
      data-proposed={picking.proposed.has(event.id) || undefined}
      data-compact={compact || undefined}
      data-span={span ? true : undefined}
      data-joins-before={(span && !span.from) || undefined}
      data-joins-after={(span && !span.to) || undefined}
      data-quiet={span?.quiet || undefined}
      data-dragging={dragging || undefined}
      data-key={keyOf(event)}
      data-selected={picking.selected === keyOf(event) || undefined}
      aria-current={picking.selected === keyOf(event) || undefined}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setTip(false); picking.onMenu(event, e.clientX, e.clientY); }}
      data-movable={(carry || onPointerDown !== undefined) || undefined}
      style={{ ...style, ['--event' as string]: color }}
      aria-label={`${event.suggestion ? 'Suggested: ' : picking.proposed.has(event.id) ? 'Added by Mobius: ' : ''}${event.title}, ${when}${event.location ? `, ${event.location}` : ''}, ${event.calendar}${task ? `, also a task in ${task.list}` : ''}`}
      title={tip ? `${event.title}\n${when}${event.location ? `\n${event.location}` : ''}${event.repeats ? '\nRepeats' : ''}${task ? `\nAlso a task in ${task.list}` : ''}` : undefined}
      onPointerEnter={() => setTip(true)}
      draggable={carry || undefined}
      onDragStart={carry ? (e) => { carrying = { event, from: from! }; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', event.title); } : undefined}
      onDragEnd={carry ? () => { carrying = null; } : undefined}
      onPointerDown={onPointerDown}
      onClick={(e) => { e.stopPropagation(); setTip(false); onOpen(event, e.currentTarget.getBoundingClientRect()); }}
    >
      <b>{task && <svg className="cal-from-tasks" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7" /><path d="m6.8 10.2 2.2 2.2 4.2-4.6" /></svg>}{event.title}</b>
      {!event.allDay && !compact && <span>{clock(event.start)}{event.location ? ` · ${event.location}` : ''}</span>}
      {event.repeats && !compact && <svg className="cal-repeat" viewBox="0 0 20 20" aria-hidden="true"><path d="M4 9a5 5 0 0 1 9-3h-3M16 11a5 5 0 0 1-9 3h3" /></svg>}
      {onResize && <span className="cal-resize" aria-hidden="true" onPointerDown={onResize} />}
    </button>
  );
}

/** A task due that day, ticked off here as in Tasks. */
function TaskChip({ calendar, item }: { calendar: CalendarState; item: DueTask }) {
  return (
    <label className="cal-task" data-done={item.task.done || undefined} title={`${item.task.text}\n${item.list}`}>
      <input type="checkbox" checked={item.task.done} aria-label={`${item.task.text}, task in ${item.list}`} onChange={(e) => void calendar.tickTask(item, e.target.checked)} />
      <span>{item.task.text}</span>
    </label>
  );
}
/** The task in Tasks that is the same thing as an event: the same words, due on one of its days. */
function taskFor(due: readonly DueTask[], event: Shown): DueTask | undefined {
  if (due.length === 0) return undefined;
  const words = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const title = words(event.title);
  const first = isoDay(localDate(event.start));
  const last = event.allDay ? isoDay(addDays(localDate(event.end), -1)) : isoDay(localDate(event.end));
  return due.find((d) => d.task.due !== undefined && d.task.due !== null && d.task.due >= first && d.task.due <= last && words(d.task.text) === title);
}

const tasksOn = (due: readonly DueTask[], day: Date) => due.filter((d) => d.task.due === isoDay(day)).sort((a, b) => Number(a.task.done) - Number(b.task.done));

/** A day's cell takes an event carried from another day; the cell shows it will. */
function useDrop(onMove: MoveEvent) {
  const [over, setOver] = useState<string | null>(null);
  return (day: Date) => ({
    'data-drop': over === isoDay(day) || undefined,
    onDragOver: (e: DragEvent) => { if (!carrying) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOver(isoDay(day)); },
    onDragLeave: (e: DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null); },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      setOver(null);
      const c = carrying;
      carrying = null;
      if (!c) return;
      const by = Math.round((day.getTime() - c.from.getTime()) / 86_400_000);
      if (by !== 0) void onMove(c.event, movedByDays(c.event, by));
    },
  });
}

/** An event being moved or stretched by the pointer, or a new one being swept out on empty time. */
type Drag = { key: string; event: Shown; resize: boolean; x: number; y: number; day: number; byDays: number; byMinutes: number; moved: boolean; saving: boolean };
type Sweep = { day: number; column: HTMLElement; y: number; from: number; to: number; moved: boolean };

/** The box on screen of a stretch of time in a day's column, for an editor or menu to open beside. */
const slotRect = (column: HTMLElement, minutes: number, length: number) => {
  const r = column.getBoundingClientRect();
  return new DOMRect(r.left, r.top + minutes / 60 * HOUR_PX, r.width, length / 60 * HOUR_PX);
};
/** Minutes into its day of a local time; an end on the next day (midnight) counts as the end of this one. */
const minutesIn = (text: string, from?: string) => {
  const t = localDate(text);
  const m = t.getHours() * 60 + t.getMinutes();
  return from && m === 0 && !sameDay(t, localDate(from)) ? 24 * 60 : m;
};

function TimeGrid({ calendar, days, onNew, onOpen, onMove, picking, pending, onSlotMenu, onEmpty }: {
  calendar: CalendarState; days: Date[]; onNew: (e: Editing) => void; onOpen: (e: Shown, at?: DOMRect) => void; onMove: MoveEvent; picking: Picking;
  /** A new event whose editor is open, drawn where it will go. */
  pending: Pending | null;
  /** A right-click on empty time: the time there, or the day for the all-day row. */
  onSlotMenu: (at: { day: Date; minutes: number | null; rect: DOMRect }, x: number, y: number) => void;
  /** A press on empty time, which lets go of the event picked out. */
  onEmpty: () => void;
}) {
  const all = onScreen(calendar);
  const scroller = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = window.setInterval(() => setNow(new Date()), 60_000); return () => window.clearInterval(t); }, []);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const todayShown = days.some((d) => sameDay(d, now));
  // Opens on the working day, not at midnight, with half an hour above it so the first hour's label is clear of the
  // edge. On today, late in the day, it goes down only as far as keeps the current time two hours above the foot.
  useEffect(() => {
    const box = scroller.current;
    if (!box) return;
    const morning = 7.5 * HOUR_PX;
    const nowY = nowMinutes / 60 * HOUR_PX;
    box.scrollTop = todayShown ? Math.max(morning, nowY + 2 * HOUR_PX - box.clientHeight) : morning;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [drag, setDragState] = useState<Drag | null>(null);
  const [sweep, setSweepState] = useState<Sweep | null>(null);
  // A drag ends in a click on the event; that click must not open it.
  const dragged_ = useRef(false);
  const drop = useDrop(onMove);
  // What the pointer handlers read: kept as it changes, not as last drawn.
  const live = useRef<{ drag: Drag | null; sweep: Sweep | null }>({ drag: null, sweep: null });
  const setDrag = (d: Drag | null) => { live.current.drag = d; setDragState(d); };
  const setSweep = (w: Sweep | null) => { live.current.sweep = w; setSweepState(w); };

  /** Which day's column is under the pointer, kept to the days on screen. */
  const dayAt = (x: number) => {
    const cols = [...(grid.current?.querySelectorAll<HTMLElement>('.cal-column') ?? [])];
    const i = cols.findIndex((c) => { const r = c.getBoundingClientRect(); return x >= r.left && x < r.right; });
    if (i >= 0) return i;
    return x < (cols[0]?.getBoundingClientRect().left ?? 0) ? 0 : cols.length - 1;
  };
  const minutesAt = (column: HTMLElement, y: number) => (y - column.getBoundingClientRect().top) / HOUR_PX * 60;

  useEffect(() => {
    if (!drag || drag.saving) return undefined;
    // The latest place is kept as it comes, so a quick release lands where the pointer was, not a frame behind.
    const move = (e: PointerEvent) => {
      const d = live.current.drag;
      if (!d) return;
      const moved = d.moved || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4;
      setDrag({ ...d, moved, byMinutes: (e.clientY - d.y) / HOUR_PX * 60, byDays: d.resize ? 0 : dayAt(e.clientX) - d.day });
    };
    const up = () => {
      const d = live.current.drag;
      if (!d) return;
      if (!d.moved) { setDrag(null); return; }
      dragged_.current = true;
      window.setTimeout(() => { dragged_.current = false; }, 0);
      const to = dragged(d.event, d.byDays, d.byMinutes, d.resize);
      if (to.start === d.event.start && to.end === d.event.end) { setDrag(null); return; }
      // Drawn where it was dropped until the calendar has it there.
      setDrag({ ...d, saving: true });
      void onMove(d.event, to).finally(() => setDrag(null));
    };
    const cancel = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrag(null); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
    window.addEventListener('keydown', cancel);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('keydown', cancel); };
  }, [drag?.key, drag?.saving, drag?.moved]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!sweep) return undefined;
    const move = (e: PointerEvent) => {
      const s = live.current.sweep;
      if (!s) return;
      setSweep({ ...s, moved: s.moved || Math.abs(e.clientY - s.y) > 6, to: snapMinutes(minutesAt(s.column, e.clientY)) });
    };
    const up = () => {
      const s = live.current.sweep;
      setSweep(null);
      if (!s) return;
      const [a, b] = [Math.min(s.from, s.to), Math.max(s.from, s.to)];
      if (s.moved && b > a) onNew({ start: atMinutes(days[s.day]!, a), end: atMinutes(days[s.day]!, b), allDay: false, at: slotRect(s.column, a, b - a) });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, [sweep?.column]); // eslint-disable-line react-hooks/exhaustive-deps

  // The event being dragged is drawn where it would land.
  const shown = drag?.moved ? all.map((e) => (keyOf(e) === drag.key ? { ...e, ...dragged(e, drag.byDays, drag.byMinutes, drag.resize) } : e)) : all;
  const begin = (e: React.PointerEvent, event: Shown, day: number, resize: boolean) => {
    if (e.button !== 0 || drag) return;
    e.stopPropagation();
    setDrag({ key: keyOf(event), event, resize, x: e.clientX, y: e.clientY, day, byDays: 0, byMinutes: 0, moved: false, saving: false });
  };
  const open = (event: Shown, at?: DOMRect) => { if (!dragged_.current) onOpen(event, at); };

  const columns = { gridTemplateColumns: `${GUTTER}px repeat(${days.length}, minmax(0, 1fr))` };
  const allDay = days.map((d) => allDayOn(shown, d));
  const due = days.map((d) => tasksOn(calendar.due, d));
  const slotAt = (day: Date, y: number) => {
    const minutes = Math.max(0, Math.min(23 * 60 + 30, Math.floor(y / HOUR_PX * 2) * 30));
    return isoTime(new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, minutes));
  };
  return (
    <div className="cal-time">
      <div className="cal-days" style={columns}>
        <span />
        {days.map((d) => (
          <button key={isoDay(d)} type="button" className="cal-day-head" data-today={sameDay(d, now) || undefined} data-weekend={[0, 6].includes(d.getDay()) || undefined} title="Open this day" onClick={() => { calendar.setAnchor(d); calendar.setMode('day'); }} disabled={days.length === 1}>
            <span>{formatWith(d, { weekday: 'short' })}</span> <b>{d.getDate()}</b>
          </button>
        ))}
      </div>
      {(allDay.some((list) => list.length > 0) || due.some((list) => list.length > 0)) && (
        <div className="cal-all-day" style={columns}>
          <span className="cal-hour">all-day</span>
          {allDay.map((list, i) => (
            <div key={isoDay(days[i]!)} className="cal-all-day-cell" {...drop(days[i]!)} onPointerDown={(e) => { if (e.target === e.currentTarget) onEmpty(); }} onContextMenu={(e) => { if (e.target !== e.currentTarget) return; e.preventDefault(); onSlotMenu({ day: days[i]!, minutes: null, rect: e.currentTarget.getBoundingClientRect() }, e.clientX, e.clientY); }}>
              {list.map((e) => <EventBlock key={keyOf(e)} calendar={calendar} event={e} onOpen={onOpen} picking={picking} compact from={days[i]!} span={spanOn(e, days[i]!, i === 0)} />)}
              {due[i]!.map((t) => <TaskChip key={`${t.list}:${t.task.line}`} calendar={calendar} item={t} />)}
            </div>
          ))}
        </div>
      )}
      <div className="cal-scroll" ref={scroller}>
        <div className="cal-grid" ref={grid} style={{ ...columns, height: 24 * HOUR_PX }} data-dragging={drag?.moved || sweep?.moved || undefined}>
          <div className="cal-hours">
            {/* The hour the current time sits on gives its place to the time itself, in red, as in Calendar. */}
            {Array.from({ length: 24 }, (_, h) => <span key={h} className="cal-hour" style={{ top: h * HOUR_PX, visibility: todayShown && Math.abs(nowMinutes - h * 60) < 14 ? 'hidden' : undefined }}>{h === 0 ? '' : hourLabel(h)}</span>)}
            {todayShown && <span className="cal-now-time" style={{ top: nowMinutes / 60 * HOUR_PX }} aria-hidden="true">{clock(isoTime(now))}</span>}
          </div>
          {/* The current time runs faintly across every day on screen, and strongly across today. */}
          {todayShown && days.length > 1 && <span className="cal-now-across" style={{ left: GUTTER, top: nowMinutes / 60 * HOUR_PX }} aria-hidden="true" />}
          {days.map((d, i) => (
            <div
              key={isoDay(d)}
              className="cal-column"
              role="group"
              aria-label={formatWith(d, { weekday: 'long', day: 'numeric', month: 'long' })}
              data-today={sameDay(d, now) || undefined}
              data-weekend={[0, 6].includes(d.getDay()) || undefined}
              style={{ backgroundSize: `100% ${HOUR_PX}px` }}
              onPointerDown={(e) => {
                if (e.button !== 0 || e.target !== e.currentTarget) return;
                onEmpty();
                const from = snapMinutes(Math.floor(minutesAt(e.currentTarget, e.clientY) / 15) * 15);
                setSweep({ day: i, column: e.currentTarget, y: e.clientY, from, to: from, moved: false });
              }}
              onDoubleClick={(e) => { if (e.target === e.currentTarget) onNew({ start: slotAt(d, e.clientY - e.currentTarget.getBoundingClientRect().top), allDay: false, at: slotRect(e.currentTarget, minutesAt(e.currentTarget, e.clientY) - 15, 60) }); }}
              onContextMenu={(e) => {
                if (e.target !== e.currentTarget) return;
                e.preventDefault();
                const minutes = Math.max(0, Math.min(23 * 60 + 30, Math.floor(minutesAt(e.currentTarget, e.clientY) / 30) * 30));
                onSlotMenu({ day: d, minutes, rect: slotRect(e.currentTarget, minutes, 60) }, e.clientX, e.clientY);
              }}
            >
              {placeDay(shown, d, 30).map((p) => {
                const can = movable(calendar, p.event);
                const key = keyOf(p.event);
                const isDragged = drag?.moved === true && drag.key === key;
                return (
                  <EventBlock
                    key={key}
                    calendar={calendar}
                    event={p.event}
                    onOpen={open}
                    picking={picking}
                    compact={p.height < 36}
                    dragging={isDragged}
                    {...(can ? { onPointerDown: (e: React.PointerEvent) => begin(e, p.event, i, false), onResize: (e: React.PointerEvent) => begin(e, p.event, i, true) } : {})}
                    style={{ top: p.top / 60 * HOUR_PX + 1, height: p.height / 60 * HOUR_PX - 2, left: `calc(${p.column / p.columns * 100}% + 2px)`, width: `calc(${100 / p.columns}% - 4px)` }}
                  />
                );
              })}
              {!sweep?.moved && pending && sameDay(localDate(pending.start), d) && (
                <span className="cal-sweep" data-pending aria-hidden="true" style={{ top: minutesIn(pending.start) / 60 * HOUR_PX + 1, height: Math.max(15, minutesIn(pending.end, pending.start) - minutesIn(pending.start)) / 60 * HOUR_PX - 2 }}>
                  New event · {clock(pending.start)}
                </span>
              )}
              {sweep?.moved && sweep.day === i && sweep.to !== sweep.from && (
                <span className="cal-sweep" aria-hidden="true" style={{ top: Math.min(sweep.from, sweep.to) / 60 * HOUR_PX + 1, height: Math.abs(sweep.to - sweep.from) / 60 * HOUR_PX - 2 }}>
                  New event · {clock(atMinutes(d, Math.min(sweep.from, sweep.to)))}–{clock(atMinutes(d, Math.max(sweep.from, sweep.to)))}
                </span>
              )}
              {sameDay(d, now) && <span className="cal-now" style={{ top: (now.getHours() * 60 + now.getMinutes()) / 60 * HOUR_PX }} aria-hidden="true" />}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Where `day` falls in an event of several days; undefined for one within a day. The title shows on its first day, and
 * again at the start of each week row. An event with times joins up too where asked (Month), as a six-day shoot from
 * Monday morning to Saturday evening is one thing, not six.
 */
function spanOn(e: Shown, day: Date, rowStart: boolean, timed = false): { from: boolean; to: boolean; quiet: boolean } | undefined {
  if (!e.allDay && !timed) return undefined;
  const first = localDate(isoDay(localDate(e.start)));
  const end = localDate(e.end);
  // An all-day end is the day after; a timed one ending at midnight ends the day before.
  const last = e.allDay || (end.getHours() === 0 && end.getMinutes() === 0) ? addDays(localDate(isoDay(end)), -1) : localDate(isoDay(end));
  if (!(last.getTime() > first.getTime())) return undefined;
  const from = sameDay(day, first);
  return { from, to: sameDay(day, last), quiet: !from && !rowStart };
}

function MonthGrid({ calendar, days, onNew, onOpen, onMove, picking, onSlotMenu, onEmpty }: {
  calendar: CalendarState; days: Date[]; onNew: (e: Editing) => void; onOpen: (e: Shown, at?: DOMRect) => void; onMove: MoveEvent; picking: Picking;
  onSlotMenu: (at: { day: Date; minutes: number | null; rect: DOMRect }, x: number, y: number) => void; onEmpty: () => void;
}) {
  const shown = onScreen(calendar);
  const today = new Date();
  const month = calendar.anchor.getMonth();
  const drop = useDrop(onMove);
  return (
    <div className="cal-month">
      <div className="cal-month-head">
        {days.slice(0, 7).map((d) => <span key={isoDay(d)}>{formatWith(d, { weekday: 'short' })}</span>)}
      </div>
      <div className="cal-month-grid" style={{ gridTemplateRows: `repeat(${days.length / 7}, minmax(0, 1fr))` }}>
        {days.map((d, i) => {
          // Events of several days go first, earliest first, so each keeps the same row across the days it joins.
          const many = (e: Shown) => (spanOn(e, d, false, true) ? 1 : 0);
          const on = eventsOn(shown, d).sort((a, b) => many(b) - many(a) || (many(a) ? a.start.localeCompare(b.start) : 0));
          const tasks = tasksOn(calendar.due, d);
          // Events first, then tasks in the room left; the rest are counted.
          const shownEvents = on.slice(0, CELL_ROWS);
          const shownTasks = tasks.slice(0, CELL_ROWS - shownEvents.length);
          const hidden = on.length + tasks.length - shownEvents.length - shownTasks.length;
          return (
            <div key={isoDay(d)} className="cal-month-cell" role="group" aria-label={formatWith(d, { weekday: 'long', day: 'numeric', month: 'long' })} data-outside={d.getMonth() !== month || undefined} data-today={sameDay(d, today) || undefined} data-weekend={[0, 6].includes(d.getDay()) || undefined} onDoubleClick={(e) => { if (e.target === e.currentTarget) onNew({ start: `${isoDay(d)}T09:00`, allDay: false, at: e.currentTarget.getBoundingClientRect() }); }} onPointerDown={(e) => { if (e.target === e.currentTarget) onEmpty(); }} onContextMenu={(e) => { if (e.target !== e.currentTarget) return; e.preventDefault(); onSlotMenu({ day: d, minutes: null, rect: e.currentTarget.getBoundingClientRect() }, e.clientX, e.clientY); }} {...drop(d)}>
              <button type="button" className="cal-month-day" title="Open this day" onClick={() => { calendar.setAnchor(d); calendar.setMode('day'); }}>{d.getDate() === 1 ? formatWith(d, { day: 'numeric', month: 'short' }) : d.getDate()}</button>
              {shownEvents.map((e) => <EventBlock key={keyOf(e)} calendar={calendar} event={e} onOpen={onOpen} picking={picking} compact from={d} span={spanOn(e, d, i % 7 === 0, true)} />)}
              {shownTasks.map((t) => <TaskChip key={`${t.list}:${t.task.line}`} calendar={calendar} item={t} />)}
              {hidden > 0 && <button type="button" className="cal-more" onClick={() => { calendar.setAnchor(d); calendar.setMode('day'); }}>{hidden} more</button>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const fromMinutes = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/**
 * A day in the event sheet, written the way the person writes dates ("Thu, 12 Nov 2026"). Typing a date or words
 * ("fri", "12 dec") changes it when the field is left; ↑ and ↓ move a day; the mini month picks one.
 */
function DayField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const commit = () => {
    if (text !== null) { const day = parseDayText(text, new Date(), parseWhen); if (day) onChange(day); }
    setText(null);
  };
  useEffect(() => {
    if (!picking) return undefined;
    const away = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setPicking(false); };
    window.addEventListener('pointerdown', away, true);
    return () => window.removeEventListener('pointerdown', away, true);
  }, [picking]);
  const shown = localDate(value);
  const month = new Date(shown.getFullYear(), shown.getMonth(), 1);
  const [view, setView] = useState(month);
  useEffect(() => setView(month), [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const first = weekStart(view);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(first, i));
  return (
    <span className="cal-field" ref={wrap}>
      <input
        aria-label={label} className="cal-field-day" value={text ?? dayLabel(value)} required spellCheck={false}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); setText(null); onChange(isoDay(addDays(shown, e.key === 'ArrowUp' ? -1 : 1))); }
          else if (e.key === 'Enter') { e.preventDefault(); commit(); }
        }}
      />
      <button type="button" className="cal-field-pick" aria-label="Pick a day" aria-expanded={picking} onClick={() => setPicking((p) => !p)}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 8 4 4 4-4" /></svg>
      </button>
      {picking && (
        <div className="cal-field-month" role="dialog" aria-label={label}>
          <div className="cal-field-month-head">
            <b>{formatWith(view, { month: 'long', year: 'numeric' })}</b>
            <button type="button" className="strip-btn" aria-label="Previous month" onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m12 5-5 5 5 5" /></svg></button>
            <button type="button" className="strip-btn" aria-label="Next month" onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m8 5 5 5-5 5" /></svg></button>
          </div>
          <div className="cal-field-days">
            {cells.slice(0, 7).map((d) => <span key={`h${d.getDay()}`}>{formatWith(d, { weekday: 'narrow' })}</span>)}
            {cells.map((d) => (
              <button key={isoDay(d)} type="button" aria-label={formatWith(d, { weekday: 'long', day: 'numeric', month: 'long' })} aria-pressed={isoDay(d) === value} data-out={d.getMonth() !== view.getMonth() || undefined} data-today={sameDay(d, new Date()) || undefined} onClick={() => { onChange(isoDay(d)); setPicking(false); }}>{d.getDate()}</button>
            ))}
          </div>
        </div>
      )}
    </span>
  );
}

/** A time in the event sheet, written as the person's locale writes times; "2pm" or "1430" typed, ↑ and ↓ by 15 minutes. */
function TimeField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState<string | null>(null);
  const commit = () => { if (text !== null) { const t = parseTimeText(text); if (t) onChange(t); } setText(null); };
  return (
    <input
      aria-label={label} className="cal-field-time" value={text ?? timeLabel(value)} required spellCheck={false} inputMode="numeric"
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          const m = minutesOf(value) + (e.key === 'ArrowUp' ? -15 : 15);
          setText(null);
          onChange(fromMinutes(((Math.round(m / 15) * 15) % 1440 + 1440) % 1440));
        } else if (e.key === 'Enter') { e.preventDefault(); commit(); }
      }}
    />
  );
}

/** Today, a day picked in the mini month, or the day on screen: where a new event starts. */
const newStart = (anchor: Date) => {
  if (!sameDay(anchor, new Date())) return `${isoDay(anchor)}T09:00`;
  const n = new Date();
  n.setMinutes(0, 0, 0);
  n.setHours(n.getHours() + 1);
  return isoTime(n);
};

function EventEditor({ calendar, editing, onClose, onDeleted }: { calendar: CalendarState; editing: Editing; onClose: () => void; onDeleted?: (event: CalendarEvent) => void }) {
  const original = 'event' in editing ? editing.event : null;
  const startText = 'event' in editing ? editing.event.start : editing.start;
  const initialAllDay = 'event' in editing ? editing.event.allDay : editing.allDay;
  // An all-day event's end is shown as its last day, the way people say it.
  const endText = original ? draftEnd(original) : ('end' in editing && editing.end ? editing.end : initialAllDay ? startText.slice(0, 10) : isoTime(new Date(localDate(startText).getTime() + 3600_000)));
  const [title, setTitle] = useState(original?.title ?? '');
  const [allDay, setAllDay] = useState(initialAllDay);
  const [startDay, setStartDay] = useState(startText.slice(0, 10));
  const [startTime, setStartTime] = useState(initialAllDay ? '09:00' : startText.slice(11, 16));
  const [endDay, setEndDay] = useState(endText.slice(0, 10));
  const [endTime, setEndTime] = useState(initialAllDay ? '10:00' : endText.slice(11, 16));
  const [where, setWhere] = useState(original?.location ?? '');
  const [notes, setNotes] = useState(original?.notes ?? '');
  const initialRepeat = original?.repeat ?? (original?.repeats ? 'custom' : '');
  const [repeat, setRepeat] = useState(initialRepeat);
  const writable = calendar.calendars.filter((c) => !calendar.readOnly(c));
  const [into, setInto] = useState(original?.calendar ?? writable.find((c) => !calendar.hidden.has(c)) ?? 'Calendar');
  const locked = original?.readOnly === true;
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const save = async (event?: FormEvent) => {
    event?.preventDefault();
    const draft: CalendarDraft = {
      title: title.trim(),
      start: allDay ? startDay : `${startDay}T${startTime}`,
      end: allDay ? endDay : `${endDay}T${endTime}`,
      location: where.trim(),
      notes: notes.trim(),
    };
    if (repeat !== initialRepeat) draft.repeat = repeat;
    setBusy(true);
    let done: unknown;
    if (original) {
      // Only what changed is sent; moving one time of a repeating event moves every time by as much.
      const shown: CalendarDraft = { title: original.title, start: original.start, end: endText, location: original.location, notes: original.notes };
      const change = Object.fromEntries(Object.entries(draft).filter(([k, v]) => shown[k as keyof CalendarDraft] !== v)) as CalendarDraft;
      if (change.start !== undefined || change.end !== undefined) {
        change.start = draft.start;
        change.end = draft.end;
        if (original.repeats) change.occurrence = original.start;
      }
      done = Object.keys(change).length === 0 ? true : await calendar.update(original, change);
    } else {
      done = await calendar.add(into, draft);
    }
    setBusy(false);
    if (done) onClose();
  };
  const sheet = useRef<HTMLFormElement>(null);
  useMorphIn(sheet, true);
  // Opened from a place on the grid, it is a popover beside that place, on whichever side has room and never off the
  // window. A press anywhere else closes it, keeping what was typed, as Calendar's popover does.
  const at = editing.at;
  // `side` is where the event is, so the arrow points back at it; `arrow` is how far down the popover it sits.
  const [place, setPlace] = useState<{ left: number; top: number; side: 'left' | 'right' | null; arrow: number } | null>(null);
  useLayoutEffect(() => {
    if (!at || !sheet.current) return;
    const { width, height } = sheet.current.getBoundingClientRect();
    const gap = 12;
    const right = at.right + gap;
    const side = right + width <= window.innerWidth - gap ? 'left' : at.left - gap - width >= gap ? 'right' : null;
    const left = side === 'left' ? right : side === 'right' ? at.left - gap - width : Math.max(gap, Math.min(window.innerWidth - width - gap, at.left + at.width / 2 - width / 2));
    const top = Math.max(gap, Math.min(window.innerHeight - height - gap, at.top - 24));
    // Level with the top of the event (or the middle of a short one), kept off the popover's rounded corners.
    const arrow = Math.max(18, Math.min(height - 18, at.top + Math.min(at.height, 36) / 2 - top));
    setPlace({ left, top, side, arrow });
  }, [at]);
  // The title takes the keys once the editor can be seen: a popover is hidden until it has its place.
  useEffect(() => { if (!at || place) field.current?.focus(); }, [at, place !== null]); // eslint-disable-line react-hooks/exhaustive-deps
  const live = useRef({ save, busy, changed: () => false as boolean });
  live.current = {
    save, busy,
    changed: () => !locked && title.trim() !== '' && (title !== (original?.title ?? '') || where !== (original?.location ?? '') || notes !== (original?.notes ?? '') || allDay !== initialAllDay || repeat !== initialRepeat || startDay !== startText.slice(0, 10) || endDay !== endText.slice(0, 10) || (!allDay && (startTime !== startText.slice(11, 16) || endTime !== endText.slice(11, 16))) || !original),
  };
  useEffect(() => {
    if (!at) return undefined;
    const away = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (sheet.current?.contains(t) || t?.closest?.('.ui-menu')) return;
      const l = live.current;
      if (l.busy) return;
      if (l.changed()) void l.save(); else onClose();
    };
    // Escape closes it wherever the keys are, as the popover has no backdrop to hold them.
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented && !(e.target as Element | null)?.closest?.('.ui-menu')) { e.preventDefault(); onClose(); } };
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('keydown', escape);
    return () => { window.removeEventListener('pointerdown', away, true); window.removeEventListener('keydown', escape); };
  }, [at, onClose]);
  const form = (
      <form
        ref={sheet} className="cal-editor" data-pop={at ? true : undefined} data-side={place?.side ?? undefined}
        style={at ? { left: place?.left ?? 0, top: place?.top ?? 0, visibility: place ? undefined : 'hidden', ['--arrow' as string]: `${place?.arrow ?? 0}px` } : undefined}
        role="dialog" aria-modal="true" aria-label={locked ? 'Event' : original ? 'Edit event' : 'New event'} onSubmit={(e) => void save(e)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
          // The popover has no Save: Enter in a line of text keeps the change, as a click elsewhere does. A day or time
          // field takes its own Enter, to read what was typed.
          if (at && e.key === 'Enter' && !e.defaultPrevented && (e.target as HTMLElement).matches('input:not([type="checkbox"])')) {
            e.preventDefault();
            if (live.current.changed()) void save(); else onClose();
          }
        }}
      >
        <fieldset className="cal-editor-fields" disabled={locked}>
        <input ref={field} className="cal-editor-title" aria-label="Title" placeholder="New event" value={title} maxLength={200} required onChange={(e) => setTitle(e.target.value)} />
        <input className="cal-editor-place" aria-label="Place" placeholder="Add a place" value={where} maxLength={200} onChange={(e) => setWhere(e.target.value)} />
        <div className="cal-editor-group">
          <label className="cal-editor-row cal-editor-check"><span>All day</span><input type="checkbox" aria-label="All day" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} /></label>
          <div className="cal-editor-row">
            <span>Starts</span>
            <DayField label="Start day" value={startDay} onChange={(v) => { const was = localDate(startDay).getTime(); setStartDay(v); setEndDay(isoDay(new Date(localDate(endDay).getTime() + localDate(v).getTime() - was))); }} />
            {!allDay && <TimeField label="Start time" value={startTime} onChange={(v) => { const length = minutesOf(endTime) - minutesOf(startTime); setStartTime(v); if (startDay === endDay && length > 0) setEndTime(fromMinutes(Math.min(23 * 60 + 59, minutesOf(v) + length))); }} />}
          </div>
          <div className="cal-editor-row">
            <span>Ends</span>
            <DayField label="End day" value={endDay} onChange={(v) => setEndDay(v < startDay ? startDay : v)} />
            {!allDay && <TimeField label="End time" value={endTime} onChange={setEndTime} />}
          </div>
          <label className="cal-editor-row"><span>Repeat</span>
            <select aria-label="Repeat" value={repeat} onChange={(e) => setRepeat(e.target.value)}>
              {REPEAT_OPTIONS.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              {initialRepeat === 'custom' && <option value="custom" disabled>Custom (set in another app)</option>}
            </select>
          </label>
          {!original && writable.length > 1 && (
            <label className="cal-editor-row"><span>Calendar</span>
              <select aria-label="Calendar" value={into} onChange={(e) => setInto(e.target.value)}>{writable.map((c) => <option key={c} value={c}>{c}</option>)}</select>
            </label>
          )}
        </div>
        <textarea aria-label="Notes" placeholder="Notes" value={notes} maxLength={4000} rows={3} onChange={(e) => setNotes(e.target.value)} />
        </fieldset>
        {locked && <p className="cal-editor-note">From {original.calendar}, a subscribed calendar: it can be read here but not changed.</p>}
        {original?.repeats && !locked && <p className="cal-editor-note">This event repeats. A change to its time moves every time it happens by as much.</p>}
        {calendar.message && <p className="tasks-message" role="alert">{calendar.message}</p>}
        {/* The popover keeps changes as they are made (a click elsewhere or Enter), and Escape takes them back: it needs
            no Cancel or Save, only Delete, as plain red words at its foot. */}
        {at ? (original && !locked && <button type="button" className="cal-pop-delete" disabled={busy} onClick={() => void calendar.remove(original).then((ok) => { if (ok) { onDeleted?.(original); onClose(); } })}>Delete Event</button>) : (
        <div className="cal-editor-actions">
          {original && !locked && <button type="button" className="btn cal-delete" disabled={busy} onClick={() => void calendar.remove(original).then((ok) => { if (ok) { onDeleted?.(original); onClose(); } })}>Delete</button>}
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>{locked ? 'Close' : 'Cancel'}</button>
          {!locked && <button type="submit" className="btn primary" disabled={busy || title.trim() === ''}>{original ? 'Save' : 'Add'}</button>}
        </div>
        )}
      </form>
  );
  if (at) return createPortal(<div className="cal-pop-layer">{form}</div>, document.body);
  return (
    <div className="cal-editor-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      {form}
    </div>
  );
}

/** "Prep slides · Thu 12 Nov, 10:00" for a suggestion card. */
function suggestedWhen(s: CalendarSuggestion): string {
  const day = (text: string) => formatWith(localDate(text), { weekday: 'short', day: 'numeric', month: 'short' });
  if (s.allDay) return s.end && s.end !== s.start ? `${day(s.start)} – ${day(s.end)}` : day(s.start);
  return `${day(s.start)}, ${clock(s.start)}–${clock(s.end)}`;
}

/** What Mobius suggests, opened from its dashed event: why, then Keep (add it), Discard (decline it) or Try another. */
function SuggestionPopover({ calendar, id, at, onClose }: { calendar: CalendarState; id: string; at: DOMRect; onClose: () => void }) {
  const s = calendar.suggestions.find((x) => x.id === id);
  const box = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!s) onClose(); }, [s]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { box.current?.querySelector<HTMLElement>('button[data-kind="keep"]')?.focus(); }, [id]);
  useEffect(() => {
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) onClose(); };
    window.addEventListener('pointerdown', away, true);
    return () => window.removeEventListener('pointerdown', away, true);
  }, [onClose]);
  if (!s) return null;
  const answer = async (add: boolean) => {
    setBusy(true);
    // Kept, the dashed ghost turns solid in place; declined, it fades out. Then the change is made.
    const ghosts = [...document.querySelectorAll<HTMLElement>(`.calendar-page .cal-event[data-suggestion="${CSS.escape(s.id)}"]`)];
    await Promise.all(ghosts.map((g) => (add ? settleBy(g, 'data-keeping') : settleGone(g))));
    await (add ? calendar.accept(s.id) : calendar.decline(s.id));
    ghosts.forEach((g) => g.removeAttribute('data-keeping'));
    setBusy(false);
    onClose();
  };
  // Beside the event, on whichever side has room, and never off the window.
  const width = 300;
  const left = at.right + 10 + width < window.innerWidth ? at.right + 10 : Math.max(10, at.left - 10 - width);
  const top = Math.max(10, Math.min(window.innerHeight - 200, at.top));
  return createPortal(
    <div ref={box} className="cal-suggest-pop" role="dialog" aria-label={`Suggested: ${s.title}`} style={{ left, top, width }} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
      <div className="cal-suggest-pop-head"><span className="review-dot" aria-hidden="true" /><span>Suggested by Mobius</span></div>
      <b className="cal-suggest-pop-title">{s.title}</b>
      <span className="cal-suggest-pop-when">{suggestedWhen(s)} · {s.calendar}</span>
      {s.why && <p className="review-why">Why this: {s.why}</p>}
      <p className="cal-suggest-pop-note">Nothing is added until you keep it. Mobius never invites anyone.</p>
      <div className="cal-suggestion-actions" aria-busy={busy || undefined}>
        <ReviewActions onKeep={() => answer(true)} onDiscard={() => answer(false)} keepTitle="Add it to your calendar" discardTitle="Decline it" />
      </div>
    </div>,
    document.body,
  );
}

/** "Fri 13 Nov, 13:00–14:00", or "Fri 13 Nov, all day", for the quick add's preview. */
function whenSaid(p: { start: string; end: string; allDay: boolean }): string {
  const day = formatWith(localDate(p.start), { weekday: 'short', day: 'numeric', month: 'short' });
  return p.allDay ? `${day}, all day` : `${day}, ${clock(p.start)}–${clock(p.end)}`;
}

/** A new event typed in words, such as "Lunch with Sam fri 1pm"; what it will add shows before Enter. */
function QuickAdd({ calendar, into, onAdded }: { calendar: CalendarState; into: string; onAdded: (start: string) => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const parsed = text.trim() ? parseEventWords(text, new Date(), parseWhen) : null;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!parsed || busy) return;
    setBusy(true);
    const ok = await calendar.add(into, { title: parsed.title, start: parsed.start, end: parsed.end });
    setBusy(false);
    if (ok) { setText(''); onAdded(parsed.start); }
  };
  return (
    <form className="cal-quick" role="search" aria-label="Quick add" onSubmit={(e) => void submit(e)}>
      <input ref={field} aria-label="Quick add an event" aria-describedby="cal-quick-hint" placeholder="Lunch fri 1pm" value={text} maxLength={200} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') { setText(''); field.current?.blur(); } }} />
      {text.trim() && (
        <p id="cal-quick-hint" className="cal-quick-hint" role="status" data-ok={parsed ? true : undefined}>
          {parsed ? <><b>{parsed.title}</b> <span>{whenSaid(parsed)} · {into}</span> <kbd>↵</kbd></> : 'Add a day or a time, such as “tomorrow 9am” or “fri 2-3pm”.'}
        </p>
      )}
    </form>
  );
}

/** A change just made that can be taken back, for a moment. */
type Undoable = { text: string; undo: () => Promise<unknown> };

/** The Calendar app: a day, a week or a month; events to open, drag, stretch and change; new ones swept out or typed in words. */
/**
 * Moving through time slides the grid the way you went: later comes in from the right, earlier from the left.
 * Switching Day, Week and Month crossfades, as does everything under Reduce Motion.
 */
function useGridSlide(page: { current: HTMLElement | null }, mode: CalendarMode, first: string) {
  const was = useRef({ mode, first });
  useLayoutEffect(() => {
    const before = was.current;
    was.current = { mode, first };
    if (before.mode === mode && before.first === first) return;
    const grid = page.current?.querySelector<HTMLElement>(':scope > .cal-time, :scope > .cal-month');
    if (!grid || typeof grid.animate !== 'function') return;
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const by = before.mode !== mode || still ? 0 : first > before.first ? 1 : -1;
    const ms = parseFloat(getComputedStyle(grid).getPropertyValue('--dur-med')) || 0;
    grid.animate(
      by === 0 ? [{ opacity: 0.2 }, { opacity: 1 }] : [{ opacity: 0.4, transform: `translateX(${by * 32}px)` }, { opacity: 1, transform: 'none' }],
      { duration: still ? 160 : Math.max(ms, 1) * 1.25, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
    );
  }, [mode, first]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** The review bar's line: the one event Mobius changed and its day, or how many and from when. */
function changeSaid(changed: readonly CalendarEvent[], first: CalendarEvent): string {
  const when = formatWith(localDate(first.start), { weekday: 'short', day: 'numeric', month: 'short' });
  return changed.length === 1
    ? `Mobius changed your calendar in its last turn: “${first.title}”, ${when}${first.allDay ? '' : ` at ${clock(first.start)}`}.`
    : `Mobius changed ${changed.length} events in its last turn, from ${when}.`;
}

export function CalendarPage({ calendar, newToken = 0, review = null }: { calendar: CalendarState; newToken?: number; /** Mobius's last turn changed these calendars, and it waits to be kept. */ review?: CalendarReview | null }) {
  const [editing, setEditing] = useState<Editing | null>(null);
  const [undoable, setUndoable] = useState<Undoable | null>(null);
  useEffect(() => { if (!undoable) return undefined; const t = window.setTimeout(() => setUndoable(null), 10_000); return () => window.clearTimeout(t); }, [undoable]);
  const takeBack = async () => { const u = undoable; setUndoable(null); await u?.undo(); };
  const deleted = (e: CalendarEvent) => {
    const { calendar: into, title, start, location, notes } = e;
    setUndoable({ text: `Deleted “${title}”.`, undo: () => calendar.add(into, { title, start, end: draftEnd(e), location, notes, ...(e.repeat && e.repeat !== 'custom' ? { repeat: e.repeat } : {}) }) });
  };
  const move: MoveEvent = async (event, to) => {
    const ok = await calendar.update(event, { ...to, ...(event.repeats ? { occurrence: event.start } : {}) });
    if (ok) {
      const day = (t: string) => formatWith(localDate(t), { weekday: 'short', day: 'numeric', month: 'short' });
      const said = event.allDay ? day(to.start) : sameDay(localDate(to.start), localDate(event.start)) ? clock(to.start) : `${day(to.start)}, ${clock(to.start)}`;
      setUndoable({ text: `Moved “${event.title}” to ${said}.`, undo: () => calendar.update(event, { start: event.start, end: draftEnd(event), ...(event.repeats ? { occurrence: to.start } : {}) }) });
    }
    return ok;
  };
  const [asking, setAsking] = useState<{ id: string; at: DOMRect } | null>(null);
  // The event picked out: the last one opened or clicked. Delete, Enter and Ctrl+D act on it, as in Calendar.
  const [selected, setSelected] = useState<string | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  // A suggestion in the grid opens nothing to edit: it opens beside itself, to be kept or declined.
  const open = (event: Shown, at?: DOMRect) => {
    setSelected(keyOf(event));
    if (event.suggestion) setAsking({ id: event.suggestion.id, at: at ?? new DOMRect(window.innerWidth / 2, 120, 0, 0) });
    else setEditing({ event, ...(at ? { at } : {}) });
  };
  const days = daysFor(calendar.mode, calendar.anchor);
  const writable = calendar.calendars.filter((c) => !calendar.readOnly(c));
  const into = writable.find((c) => !calendar.hidden.has(c)) ?? writable[0] ?? 'Calendar';
  const create = () => setEditing({ start: newStart(calendar.anchor), allDay: false });
  useEffect(() => { if (newToken) create(); }, [newToken]); // eslint-disable-line react-hooks/exhaustive-deps
  // A new event being made is drawn on the grid where it will go, until it is added or let go.
  const pending: Pending | null = editing && !('event' in editing) && !editing.allDay
    ? { start: editing.start, end: editing.end ?? isoTime(new Date(localDate(editing.start).getTime() + 3600_000)) }
    : null;

  /** What is on screen for a picked-out key, and where it is drawn, for the editor to open beside. */
  const find = (key: string | null) => (key ? onScreen(calendar).find((e) => keyOf(e) === key) : undefined);
  const rectOf = (key: string) => page.current?.querySelector(`.cal-event[data-key="${CSS.escape(key)}"]`)?.getBoundingClientRect();
  const removeEvent = async (event: Shown) => {
    setSelected(null);
    if (event.suggestion) { await calendar.decline(event.suggestion.id); return; }
    if (!movable(calendar, event)) return;
    if (await calendar.remove(event)) deleted(event);
  };
  /** A copy at the same time, in the same calendar, or the first that can take it when that one is read only. */
  const duplicate = async (event: Shown) => {
    if (event.suggestion) return;
    const to = calendar.readOnly(event.calendar) || event.readOnly ? into : event.calendar;
    const made = await calendar.add(to, { title: event.title, start: event.start, end: draftEnd(event), location: event.location, notes: event.notes });
    if (!made) return;
    setSelected(keyOf(made));
    setUndoable({ text: `Duplicated “${event.title}”.`, undo: () => calendar.remove(made) });
  };
  /** Into another calendar: added there, then taken out of this one. A repeating event stays, as its first time is not on screen. */
  const moveTo = async (event: Shown, to: string) => {
    const draft: CalendarDraft = { title: event.title, start: event.start, end: draftEnd(event), location: event.location, notes: event.notes };
    const made = await calendar.add(to, draft);
    if (!made) return;
    if (!(await calendar.remove(event))) { await calendar.remove(made); return; }
    setSelected(keyOf(made));
    setUndoable({ text: `Moved “${event.title}” to ${to}.`, undo: async () => { if (await calendar.add(event.calendar, draft)) await calendar.remove(made); } });
  };
  const eventMenu = (event: Shown, x: number, y: number) => {
    setSelected(keyOf(event));
    const items: ContextMenuItem[] = event.suggestion
      ? [
        { label: 'Keep', run: () => void calendar.accept(event.suggestion!.id) },
        { label: 'Discard', run: () => void calendar.decline(event.suggestion!.id) },
      ]
      : [
        { action: 'open', label: movable(calendar, event) ? 'Open' : 'Show details', keys: 'Enter', run: () => open(event, rectOf(keyOf(event))) },
        { action: 'duplicate', keys: 'Ctrl+D', run: () => void duplicate(event) },
        ...(movable(calendar, event) && !event.repeats
          ? writable.filter((c) => c !== event.calendar).map((c, i) => ({ action: 'move' as const, label: `Move to ${c}`, separated: i === 0, run: () => void moveTo(event, c) }))
          : []),
        ...(movable(calendar, event) ? [{ action: 'delete' as const, keys: 'Delete', danger: true, separated: true, run: () => void removeEvent(event) }] : []),
      ];
    setMenu({ x, y, label: event.title, items });
  };
  const slotMenu = ({ day, minutes, rect }: { day: Date; minutes: number | null; rect: DOMRect }, x: number, y: number) => {
    setSelected(null);
    const dayName = formatWith(day, { weekday: 'short', day: 'numeric', month: 'short' });
    const items: ContextMenuItem[] = [
      minutes === null
        ? { label: `New event on ${dayName}`, run: () => setEditing({ start: `${isoDay(day)}T09:00`, allDay: false, at: rect }) }
        : { label: `New event at ${clock(atMinutes(day, minutes))}`, run: () => setEditing({ start: atMinutes(day, minutes), end: atMinutes(day, minutes + 60), allDay: false, at: rect }) },
      { label: 'New all-day event', run: () => setEditing({ start: isoDay(day), allDay: true, at: rect }) },
    ];
    setMenu({ x, y, label: dayName, items });
  };
  // What Mobius's last turn changed: drawn dashed until kept, and the calendar opens where the first of it is.
  const proposal = useCalendarReview(review, calendar.events);
  const proposed = useMemo(() => new Set(proposal.changed.map((e) => e.id)), [proposal.changed]);
  const firstChange = proposal.changed.find((e) => e.start >= isoDay(new Date())) ?? proposal.changed[0];
  const showChange = () => { if (firstChange) calendar.setAnchor(localDate(firstChange.start)); };
  const shownChange = useRef('');
  useEffect(() => {
    if (!firstChange || !review) return;
    const mark = `${review.conversation}|${firstChange.id}|${firstChange.start}`;
    if (shownChange.current === mark) return;
    shownChange.current = mark;
    if (!days.some((d) => sameDay(d, localDate(firstChange.start)))) calendar.setAnchor(localDate(firstChange.start));
  }, [firstChange, review]); // eslint-disable-line react-hooks/exhaustive-deps
  const picking: Picking = { selected, onMenu: eventMenu, proposed };

  // Keys as in other calendars: T for today, arrows back and forward, D, W and M for the view, N for a new event.
  const page = useRef<HTMLElement>(null);
  useGridSlide(page, calendar.mode, days[0] ? isoDay(days[0]) : '');
  const keys = useRef({ calendar, editing, create, selected, find, open, rectOf, removeEvent, duplicate, menu });
  keys.current = { calendar, editing, create, selected, find, open, rectOf, removeEvent, duplicate, menu };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { calendar: c, editing: ed, create: make, selected: key, find: lookUp, open: show, rectOf: where, removeEvent: drop, duplicate: copy, menu: m } = keys.current;
      if (e.defaultPrevented || e.altKey || ed || m || !page.current?.isConnected) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest('input, textarea, select, [contenteditable="true"], [role="textbox"], [role="radiogroup"], [aria-modal="true"], .ui-menu') || document.querySelector('[aria-modal="true"]')) return;
      const k = e.key.toLowerCase();
      const picked = lookUp(key);
      if ((e.ctrlKey || e.metaKey) && k === 'd' && picked) { e.preventDefault(); void copy(picked); return; }
      if (e.metaKey || e.ctrlKey) return;
      if (picked && (e.key === 'Delete' || e.key === 'Backspace')) void drop(picked);
      else if (picked && e.key === 'Enter') show(picked, where(key!));
      else if (key && e.key === 'Escape') setSelected(null);
      else if (k === 't') c.setAnchor(new Date());
      else if (e.key === 'ArrowLeft') c.setAnchor(step(c.mode, c.anchor, -1));
      else if (e.key === 'ArrowRight') c.setAnchor(step(c.mode, c.anchor, 1));
      else if (k === 'd') c.setMode('day');
      else if (k === 'w') c.setMode('week');
      else if (k === 'm') c.setMode('month');
      else if (k === 'n') make();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <section className="calendar-page" aria-label="Calendar" ref={page}>
      <header className="cal-head">
        <div className="cal-head-start">
          <div className="cal-step cap-group" role="group" aria-label="Go to">
          <button type="button" className="strip-btn" aria-label="Back" title="Back (←)" onClick={() => calendar.setAnchor(step(calendar.mode, calendar.anchor, -1))}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m12 5-5 5 5 5" /></svg>
          </button>
          <button type="button" className="btn" title="Today (T)" onClick={() => calendar.setAnchor(new Date())}>Today</button>
          <button type="button" className="strip-btn" aria-label="Forward" title="Forward (→)" onClick={() => calendar.setAnchor(step(calendar.mode, calendar.anchor, 1))}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m8 5 5 5-5 5" /></svg>
          </button>
          </div>
        </div>
        <div className="segmented" role="radiogroup" aria-label="View">
          {MODES.map((m) => <button key={m.id} type="button" role="radio" aria-checked={calendar.mode === m.id} title={`${m.name} (${m.name[0]})`} onClick={() => calendar.setMode(m.id)}>{m.name}</button>)}
        </div>
        <div className="cal-head-end">
          <QuickAdd calendar={calendar} into={into} onAdded={(start) => calendar.setAnchor(localDate(start))} />
          <button type="button" className="cal-new" aria-label="New event" title="New event (N)" onClick={create}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg>
          </button>
        </div>
      </header>
      {review && firstChange && (
        <div className="note-review cal-review" role="status">
          <span className="review-dot" aria-hidden="true" />
          <span className="note-review-text">{changeSaid(proposal.changed, firstChange)}<WhyThis conversation={review.conversation} /></span>
          <button type="button" className="btn" title="Go to the day of the change" onClick={showChange}>Show</button>
          <ReviewActions onKeep={proposal.keep} onDiscard={proposal.discard} keepTitle="Keep what Mobius changed in your calendar in that turn" discardTitle="Put your calendar back as it was before that turn" />
          {proposal.problem && <span className="review-problem" role="alert">{proposal.problem}</span>}
        </div>
      )}
      {calendar.message && !editing && <p className="tasks-message" role="alert">{calendar.message}</p>}
      {calendar.mode === 'month'
        ? <MonthGrid calendar={calendar} days={days} onNew={setEditing} onOpen={open} onMove={move} picking={picking} onSlotMenu={slotMenu} onEmpty={() => setSelected(null)} />
        : <TimeGrid calendar={calendar} days={days} onNew={setEditing} onOpen={open} onMove={move} picking={picking} pending={pending} onSlotMenu={slotMenu} onEmpty={() => setSelected(null)} />}
      {menu && createPortal(<ContextMenu x={menu.x} y={menu.y} label={menu.label} items={menu.items} onClose={() => setMenu(null)} />, document.body)}
      {undoable && (
        <p className="cal-undo" role="status">
          <span>{undoable.text}</span>
          <button type="button" className="review-btn" onClick={() => void takeBack()}>Undo</button>
          <button type="button" className="strip-btn" aria-label="Dismiss" onClick={() => setUndoable(null)}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 6l8 8M14 6l-8 8" /></svg>
          </button>
        </p>
      )}
      {/* Closing one suggestion never closes the next: its answer can finish after another was opened. */}
      {asking && <SuggestionPopover key={asking.id} calendar={calendar} id={asking.id} at={asking.at} onClose={() => { const id = asking.id; setAsking((a) => (a?.id === id ? null : a)); }} />}
      {editing && <EventEditor key={'event' in editing ? editing.event.id + editing.event.start : editing.start} calendar={calendar} editing={editing} onClose={() => setEditing(null)} onDeleted={deleted} />}
    </section>
  );
}
