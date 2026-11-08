import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { CalendarDraft, CalendarEvent } from '@mobius/shared';
import { onCommand } from './commands';
import { addDays, allDayOn, calendarColor, clock, daysFor, eventsOn, isoDay, isoTime, localDate, placeDay, sameDay, step, type CalendarMode } from './calendar-view';
import type { CalendarState } from './useCalendar';

const HOUR_PX = 48;
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
  return (
    <div className="cal-editor-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="cal-editor" role="dialog" aria-modal="true" aria-label="Add a calendar account" onSubmit={(e) => void submit(e)} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
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

/** The calendars, each with its colour (unticked ones are hidden), grouped by where they are kept. */
export function CalendarSidebar({ calendar, pin }: { calendar: CalendarState; pin?: ReactNode }) {
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
        <span className="side-title">Calendars</span>
        <span className="side-actions">
          {pin}
          <button type="button" className="strip-btn" aria-label="New calendar" title="New calendar" onClick={() => setNaming(true)}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg>
          </button>
        </span>
      </div>
      <div className="calendar-groups">
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
        <button type="button" className="calendar-add-account" onClick={() => setAdding(true)}>Add a calendar account…</button>
      </div>
      <p className="calendar-side-note">Your own calendars are kept as .ics files in your workspace, so any calendar app can open them.</p>
      {adding && createPortal(<div className="cal-modal-layer"><AccountDialog calendar={calendar} onClose={() => setAdding(false)} /></div>, document.body)}
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
  const writable = calendar.calendars.filter((c) => !calendar.readOnly(c));
  const [into, setInto] = useState(original?.calendar ?? writable.find((c) => !calendar.hidden.has(c)) ?? 'Calendar');
  const locked = original?.readOnly === true;
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
      <form className="cal-editor" role="dialog" aria-modal="true" aria-label={locked ? 'Event' : original ? 'Edit event' : 'New event'} onSubmit={(e) => void save(e)} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
        <fieldset className="cal-editor-fields" disabled={locked}>
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
        {!original && writable.length > 1 && (
          <label className="cal-editor-row"><span>Calendar</span>
            <select value={into} onChange={(e) => setInto(e.target.value)}>{writable.map((c) => <option key={c} value={c}>{c}</option>)}</select>
          </label>
        )}
        <input aria-label="Place" placeholder="Place" value={where} maxLength={200} onChange={(e) => setWhere(e.target.value)} />
        <textarea aria-label="Notes" placeholder="Notes" value={notes} maxLength={4000} rows={3} onChange={(e) => setNotes(e.target.value)} />
        </fieldset>
        {locked && <p className="cal-editor-note">From {original.calendar}, a subscribed calendar: it can be read here but not changed.</p>}
        {original?.repeats && !locked && <p className="cal-editor-note">This event repeats. Changes apply to every time it happens.</p>}
        {calendar.message && <p className="tasks-message" role="alert">{calendar.message}</p>}
        <div className="cal-editor-actions">
          {original && !locked && <button type="button" className="btn cal-delete" disabled={busy} onClick={() => void calendar.remove(original).then((ok) => { if (ok) onClose(); })}>Delete</button>}
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>{locked ? 'Close' : 'Cancel'}</button>
          {!locked && <button type="submit" className="btn primary" disabled={busy || title.trim() === ''}>{original ? 'Save' : 'Add'}</button>}
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
