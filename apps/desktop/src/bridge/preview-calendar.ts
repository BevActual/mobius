import type { CalendarDraft, CalendarEvent } from '@mobius/shared';

/**
 * The preview's Calendar: events kept in memory for as long as the preview is open, so they can be added, dragged and
 * changed without the Rust core. A repeating event is shown once; the preview does not expand it.
 */
const day = (offset: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const ev = (id: string, calendar: string, title: string, start: string, end: string, extra: Partial<CalendarEvent> = {}): CalendarEvent =>
  ({ id, calendar, title, start, end, allDay: !start.includes('T'), location: '', notes: '', repeats: false, repeat: '', ...extra });

export const PREVIEW_EVENTS: CalendarEvent[] = [
  ev('e1', 'Kestrel P2', 'Packs arrive', `${day(0)}T08:40`, `${day(0)}T09:30`, { location: 'Dock 2' }),
  ev('e2', 'Kestrel P2', 'Motor call with Sam', `${day(1)}T10:00`, `${day(1)}T10:30`),
  ev('e3', 'Kestrel P2', 'Crash test', `${day(3)}T09:00`, `${day(3)}T11:00`, { location: 'Northfield sled' }),
  ev('e4', 'Work', 'Standup', `${day(0)}T09:30`, `${day(0)}T09:45`, { repeats: true, repeat: 'weekdays' }),
  ev('e5', 'Work', 'Design review', `${day(0)}T13:00`, `${day(0)}T14:30`, { location: 'Room 4' }),
  ev('e6', 'Home', 'Gym', `${day(-1)}T18:00`, `${day(-1)}T19:00`),
  ev('e7', 'Kestrel P2', 'Build week', day(2), day(4)),
  ev('e9', 'Kestrel P2', 'Sled test week', `${day(7)}T08:00`, `${day(12)}T18:00`, { location: 'Northfield' }),
  ev('e8', 'Work', 'Lunch with Priya', `${day(2)}T12:30`, `${day(2)}T13:30`, { location: 'Canteen' }),
];

let next = 100;
const fail = (message: string) => ({ ok: false as const, message });
/** An all-day end, as the window sends it, is the last day; stored, it is the day after. */
const dayAfter = (d: string) => { const [y, m, dd] = d.split('-').map(Number); const t = new Date(y!, m! - 1, dd! + 1); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };

function apply(e: CalendarEvent, draft: CalendarDraft): CalendarEvent {
  const out = { ...e };
  if (draft.title !== undefined) out.title = draft.title.trim() || e.title;
  if (draft.start !== undefined) { out.start = draft.start; out.allDay = !draft.start.includes('T'); }
  if (draft.end !== undefined) out.end = out.allDay ? dayAfter(draft.end) : draft.end;
  if (draft.location !== undefined) out.location = draft.location;
  if (draft.notes !== undefined) out.notes = draft.notes;
  if (draft.repeat !== undefined) { out.repeat = draft.repeat; out.repeats = draft.repeat !== ''; }
  return out;
}

export const PREVIEW_CALENDAR: Record<string, (...args: never[]) => unknown> = {
  'calendar.events': () => PREVIEW_EVENTS,
  'calendar.add': ((calendar: string, draft: CalendarDraft) => {
    if (!draft.title?.trim() || !draft.start) return fail('an event needs a title and a start');
    const start = draft.start;
    const end = draft.end ?? (start.includes('T') ? start : start);
    const made = apply(ev(`p${next++}`, calendar, '', start, end), { ...draft, end });
    PREVIEW_EVENTS.push(made);
    return made;
  }) as never,
  'calendar.update': ((_calendar: string, id: string, draft: CalendarDraft) => {
    const at = PREVIEW_EVENTS.findIndex((e) => e.id === id);
    if (at < 0) return fail('that event is not in that calendar');
    PREVIEW_EVENTS[at] = apply(PREVIEW_EVENTS[at]!, draft);
    return PREVIEW_EVENTS[at];
  }) as never,
  'calendar.remove': ((calendar: string, id: string) => {
    const at = PREVIEW_EVENTS.findIndex((e) => e.id === id);
    if (at < 0) return fail('that event is not in that calendar');
    PREVIEW_EVENTS.splice(at, 1);
    return { calendar, removed: id };
  }) as never,
};
