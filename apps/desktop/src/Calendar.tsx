import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { CalendarDraft, CalendarEvent } from '@mobius/shared';
import { onCommand } from './commands';
import { addDays, allDayOn, calendarColor, clock, daysFor, eventsOn, isoDay, isoTime, localDate, placeDay, sameDay, step, type CalendarMode } from './calendar-view';
import type { CalendarState } from './useCalendar';

const HOUR_PX = 48;
const MODES: { id: CalendarMode; name: string }[] = [{ id: 'day', name: 'Day' }, { id: 'week', name: 'Week' }, { id: 'month', name: 'Month' }];

/** The calendars, each with its colour; unticked ones are hidden. */
export function CalendarSidebar({ calendar, pin }: { calendar: CalendarState; pin?: ReactNode }) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  useEffect(() => onCommand('new-calendar', () => setNaming(true)), []);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (await calendar.createCalendar(name.trim() || 'Calendar')) { setNaming(false); setName(''); }
  };
  return (
    <aside className="side calendar-side" aria-label="Calendar sidebar">
      <div className="side-head">
        <span className="side-title">Calendars</span>
        <span className="side-actions">
          {pin}
          <button type="button" className="strip-btn" aria-label="New calendar" title="New calendar" onClick={() => setNaming(true)}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg>
          </button>
        </span>
      </div>
      <ul className="calendar-list" role="list" aria-label="Calendars">
        {calendar.calendars.map((c) => (
          <li key={c}>
            <label className="calendar-row">
              <input type="checkbox" checked={!calendar.hidden.has(c)} onChange={() => calendar.toggle(c)} style={{ ['--swatch' as string]: calendarColor(calendar.calendars, c) }} />
              <span>{c}</span>
            </label>
          </li>
        ))}
      </ul>
      {naming && (
        <form className="notes-name" onSubmit={(e) => void submit(e)}>
          <input autoFocus aria-label="Calendar name" placeholder="Calendar name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setNaming(false); }} />
          <button type="submit" className="btn primary">Create</button>
        </form>
      )}
      <p className="calendar-side-note">Your calendars are kept as .ics files in your workspace, so any calendar app can open them.</p>
    </aside>
  );
}

/** What the editor opens with: an event to change, or the start of a new one. */
type Editing = { event: CalendarEvent } | { start: string; allDay: boolean };

function EventBlock({ calendar, event, style, onOpen, compact }: { calendar: CalendarState; event: CalendarEvent; style?: React.CSSProperties; onOpen: (e: CalendarEvent) => void; compact?: boolean }) {
  const color = calendarColor(calendar.calendars, event.calendar);
  const when = event.allDay ? 'All day' : `${clock(event.start)}–${clock(event.end)}`;
  return (
    <button
      type="button"
      className="cal-event"
      data-all-day={event.allDay || undefined}
      data-fresh={calendar.fresh.has(event.id) || undefined}
      data-compact={compact || undefined}
      style={{ ...style, ['--event' as string]: color }}
      aria-label={`${event.title}, ${when}${event.location ? `, ${event.location}` : ''}, ${event.calendar}`}
      title={`${event.title}\n${when}${event.location ? `\n${event.location}` : ''}`}
      onClick={(e) => { e.stopPropagation(); onOpen(event); }}
    >
      <b>{event.title}</b>
      {!event.allDay && !compact && <span>{clock(event.start)}{event.location ? ` · ${event.location}` : ''}</span>}
    </button>
  );
}

function TimeGrid({ calendar, days, onNew, onOpen }: { calendar: CalendarState; days: Date[]; onNew: (e: Editing) => void; onOpen: (e: CalendarEvent) => void }) {
  const scroller = useRef<HTMLDivElement>(null);
  // Opens on the working day, not at midnight.
  useEffect(() => { if (scroller.current) scroller.current.scrollTop = 8 * HOUR_PX - 8; }, []);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = window.setInterval(() => setNow(new Date()), 60_000); return () => window.clearInterval(t); }, []);
  const columns = { gridTemplateColumns: `52px repeat(${days.length}, minmax(0, 1fr))` };
  const allDay = days.map((d) => allDayOn(calendar.events, d));
  const slotAt = (day: Date, y: number) => {
    const minutes = Math.max(0, Math.min(23 * 60 + 30, Math.floor(y / HOUR_PX * 2) * 30));
    return isoTime(new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, minutes));
  };
  return (
    <div className="cal-time">
      <div className="cal-days" style={columns}>
        <span />
        {days.map((d) => (
          <span key={isoDay(d)} className="cal-day-head" data-today={sameDay(d, now) || undefined}>
            {d.toLocaleDateString(undefined, { weekday: 'short' })} <b>{d.getDate()}</b>
          </span>
        ))}
      </div>
      {allDay.some((list) => list.length > 0) && (
        <div className="cal-all-day" style={columns}>
          <span className="cal-hour">all-day</span>
          {allDay.map((list, i) => (
            <div key={isoDay(days[i]!)} className="cal-all-day-cell">
              {list.map((e) => <EventBlock key={`${e.id}:${e.start}`} calendar={calendar} event={e} onOpen={onOpen} compact />)}
            </div>
          ))}
        </div>
      )}
      <div className="cal-scroll" ref={scroller}>
        <div className="cal-grid" style={{ ...columns, height: 24 * HOUR_PX }}>
          <div className="cal-hours">
            {Array.from({ length: 24 }, (_, h) => <span key={h} className="cal-hour" style={{ top: h * HOUR_PX }}>{h === 0 ? '' : `${h}:00`}</span>)}
          </div>
          {days.map((d) => (
            <div
              key={isoDay(d)}
              className="cal-column"
              role="group"
              aria-label={d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
              style={{ backgroundSize: `100% ${HOUR_PX}px` }}
              onDoubleClick={(e) => onNew({ start: slotAt(d, e.clientY - e.currentTarget.getBoundingClientRect().top), allDay: false })}
            >
              {placeDay(calendar.events, d).map((p) => (
                <EventBlock
                  key={`${p.event.id}:${p.event.start}`}
                  calendar={calendar}
                  event={p.event}
                  onOpen={onOpen}
                  compact={p.height < 36}
                  style={{ top: p.top / 60 * HOUR_PX + 1, height: p.height / 60 * HOUR_PX - 2, left: `calc(${p.column / p.columns * 100}% + 2px)`, width: `calc(${100 / p.columns}% - 4px)` }}
                />
              ))}
              {sameDay(d, now) && <span className="cal-now" style={{ top: (now.getHours() * 60 + now.getMinutes()) / 60 * HOUR_PX }} aria-hidden="true" />}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MonthGrid({ calendar, days, onNew, onOpen }: { calendar: CalendarState; days: Date[]; onNew: (e: Editing) => void; onOpen: (e: CalendarEvent) => void }) {
  const today = new Date();
  const month = calendar.anchor.getMonth();
  return (
    <div className="cal-month">
      <div className="cal-month-head">
        {days.slice(0, 7).map((d) => <span key={isoDay(d)}>{d.toLocaleDateString(undefined, { weekday: 'short' })}</span>)}
      </div>
      <div className="cal-month-grid" style={{ gridTemplateRows: `repeat(${days.length / 7}, minmax(0, 1fr))` }}>
        {days.map((d) => {
          const on = eventsOn(calendar.events, d);
          return (
            <div key={isoDay(d)} className="cal-month-cell" role="group" aria-label={d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })} data-outside={d.getMonth() !== month || undefined} data-today={sameDay(d, today) || undefined} onDoubleClick={() => onNew({ start: `${isoDay(d)}T09:00`, allDay: false })}>
              <span className="cal-month-day">{d.getDate()}</span>
              {on.slice(0, 3).map((e) => <EventBlock key={`${e.id}:${e.start}`} calendar={calendar} event={e} onOpen={onOpen} compact />)}
              {on.length > 3 && <button type="button" className="cal-more" onClick={() => { calendar.setAnchor(d); calendar.setMode('day'); }}>{on.length - 3} more</button>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EventEditor({ calendar, editing, onClose }: { calendar: CalendarState; editing: Editing; onClose: () => void }) {
  const original = 'event' in editing ? editing.event : null;
  const startText = 'event' in editing ? editing.event.start : editing.start;
  const initialAllDay = 'event' in editing ? editing.event.allDay : editing.allDay;
  // An all-day event's end is shown as its last day, the way people say it.
  const endText = original ? (original.allDay ? isoDay(addDays(localDate(original.end), -1)) : original.end) : (initialAllDay ? startText.slice(0, 10) : isoTime(new Date(localDate(startText).getTime() + 3600_000)));
  const [title, setTitle] = useState(original?.title ?? '');
  const [allDay, setAllDay] = useState(initialAllDay);
  const [startDay, setStartDay] = useState(startText.slice(0, 10));
  const [startTime, setStartTime] = useState(initialAllDay ? '09:00' : startText.slice(11, 16));
  const [endDay, setEndDay] = useState(endText.slice(0, 10));
  const [endTime, setEndTime] = useState(initialAllDay ? '10:00' : endText.slice(11, 16));
  const [where, setWhere] = useState(original?.location ?? '');
  const [notes, setNotes] = useState(original?.notes ?? '');
  const [into, setInto] = useState(original?.calendar ?? calendar.calendars.find((c) => !calendar.hidden.has(c)) ?? 'Calendar');
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => { field.current?.focus(); }, []);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    const draft: CalendarDraft = {
      title: title.trim(),
      start: allDay ? startDay : `${startDay}T${startTime}`,
      end: allDay ? endDay : `${endDay}T${endTime}`,
      location: where.trim(),
      notes: notes.trim(),
    };
    setBusy(true);
    let done: unknown;
    if (original) {
      // Only what changed is sent, so a repeating event's other times stay where they are.
      const shown: CalendarDraft = { title: original.title, start: original.start, end: endText, location: original.location, notes: original.notes };
      const change = Object.fromEntries(Object.entries(draft).filter(([k, v]) => shown[k as keyof CalendarDraft] !== v)) as CalendarDraft;
      if (change.start !== undefined || change.end !== undefined) { change.start = draft.start; change.end = draft.end; }
      done = Object.keys(change).length === 0 ? true : await calendar.update(original, change);
    } else {
      done = await calendar.add(into, draft);
    }
    setBusy(false);
    if (done) onClose();
  };
  return (
    <div className="cal-editor-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="cal-editor" role="dialog" aria-modal="true" aria-label={original ? 'Edit event' : 'New event'} onSubmit={(e) => void save(e)} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
        <input ref={field} className="cal-editor-title" aria-label="Title" placeholder="New event" value={title} maxLength={200} required onChange={(e) => setTitle(e.target.value)} />
        <label className="cal-editor-check"><input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} /> All day</label>
        <div className="cal-editor-row">
          <span>Starts</span>
          <input type="date" aria-label="Start day" value={startDay} required onChange={(e) => { const was = localDate(startDay).getTime(); setStartDay(e.target.value); if (e.target.value) setEndDay(isoDay(new Date(localDate(endDay).getTime() + localDate(e.target.value).getTime() - was))); }} />
          {!allDay && <input type="time" aria-label="Start time" value={startTime} required onChange={(e) => setStartTime(e.target.value)} />}
        </div>
        <div className="cal-editor-row">
          <span>Ends</span>
          <input type="date" aria-label="End day" value={endDay} min={startDay} required onChange={(e) => setEndDay(e.target.value)} />
          {!allDay && <input type="time" aria-label="End time" value={endTime} required onChange={(e) => setEndTime(e.target.value)} />}
        </div>
        {!original && calendar.calendars.length > 1 && (
          <label className="cal-editor-row"><span>Calendar</span>
            <select value={into} onChange={(e) => setInto(e.target.value)}>{calendar.calendars.map((c) => <option key={c} value={c}>{c}</option>)}</select>
          </label>
        )}
        <input aria-label="Place" placeholder="Place" value={where} maxLength={200} onChange={(e) => setWhere(e.target.value)} />
        <textarea aria-label="Notes" placeholder="Notes" value={notes} maxLength={4000} rows={3} onChange={(e) => setNotes(e.target.value)} />
        {original?.repeats && <p className="cal-editor-note">This event repeats. Changes apply to every time it happens.</p>}
        {calendar.message && <p className="tasks-message" role="alert">{calendar.message}</p>}
        <div className="cal-editor-actions">
          {original && <button type="button" className="btn cal-delete" disabled={busy} onClick={() => void calendar.remove(original).then((ok) => { if (ok) onClose(); })}>Delete</button>}
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={busy || title.trim() === ''}>{original ? 'Save' : 'Add'}</button>
        </div>
      </form>
    </div>
  );
}

/** The Calendar app: a day, a week or a month, events to open and change, and new ones on a double-click. */
export function CalendarPage({ calendar, newToken = 0 }: { calendar: CalendarState; newToken?: number }) {
  const [editing, setEditing] = useState<Editing | null>(null);
  const days = daysFor(calendar.mode, calendar.anchor);
  const fresh = () => { const n = new Date(); n.setMinutes(0, 0, 0); n.setHours(n.getHours() + 1); return isoTime(n); };
  useEffect(() => { if (newToken) setEditing({ start: sameDay(calendar.anchor, new Date()) ? fresh() : `${isoDay(calendar.anchor)}T09:00`, allDay: false }); }, [newToken]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <section className="calendar-page" aria-label="Calendar">
      <header className="cal-head">
        <div className="segmented" role="radiogroup" aria-label="View">
          {MODES.map((m) => <button key={m.id} type="button" role="radio" aria-checked={calendar.mode === m.id} onClick={() => calendar.setMode(m.id)}>{m.name}</button>)}
        </div>
        <span className="spacer" />
        <button type="button" className="strip-btn" aria-label="Back" title="Back" onClick={() => calendar.setAnchor(step(calendar.mode, calendar.anchor, -1))}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m12 5-5 5 5 5" /></svg>
        </button>
        <button type="button" className="btn" onClick={() => calendar.setAnchor(new Date())}>Today</button>
        <button type="button" className="strip-btn" aria-label="Forward" title="Forward" onClick={() => calendar.setAnchor(step(calendar.mode, calendar.anchor, 1))}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m8 5 5 5-5 5" /></svg>
        </button>
        <button type="button" className="btn primary" onClick={() => setEditing({ start: sameDay(calendar.anchor, new Date()) ? fresh() : `${isoDay(calendar.anchor)}T09:00`, allDay: false })}>New event</button>
      </header>
      {calendar.message && !editing && <p className="tasks-message" role="alert">{calendar.message}</p>}
      {calendar.mode === 'month'
        ? <MonthGrid calendar={calendar} days={days} onNew={setEditing} onOpen={(event) => setEditing({ event })} />
        : <TimeGrid calendar={calendar} days={days} onNew={setEditing} onOpen={(event) => setEditing({ event })} />}
      {editing && <EventEditor key={'event' in editing ? editing.event.id + editing.event.start : editing.start} calendar={calendar} editing={editing} onClose={() => setEditing(null)} />}
    </section>
  );
}
