import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from '@mobius/shared';
import { allDayOn, clock, daysFor, dragged, draftEnd, movedByDays, eventsOn, heading, isoDay, localDate, parseEventWords, placeDay, snapMinutes, step, weekStart } from './calendar-view';
import { parseWhen } from './tasks-view';

const ev = (title: string, start: string, end: string, allDay = false): CalendarEvent => ({ id: title, calendar: 'Calendar', title, start, end, allDay, location: '', notes: '', repeats: false });
const day = (text: string) => localDate(text);

describe('the days on screen', () => {
  it('starts weeks on Monday and months on the Monday before the first', () => {
    expect(isoDay(weekStart(day('2026-11-08')))).toBe('2026-11-02');
    expect(isoDay(weekStart(day('2026-11-09')))).toBe('2026-11-09');
    expect(daysFor('week', day('2026-11-12')).map(isoDay)).toEqual(['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15']);
    const month = daysFor('month', day('2026-11-20'));
    expect(month.length % 7).toBe(0);
    expect(isoDay(month[0]!)).toBe('2026-10-26');
    expect(isoDay(month[month.length - 1]!)).toBe('2026-12-06');
    expect(daysFor('day', day('2026-11-20')).map(isoDay)).toEqual(['2026-11-20']);
  });

  it('steps by a day, a week or a month, keeping to real dates', () => {
    expect(isoDay(step('day', day('2026-11-30'), 1))).toBe('2026-12-01');
    expect(isoDay(step('week', day('2026-11-30'), -1))).toBe('2026-11-23');
    expect(isoDay(step('month', day('2026-01-31'), 1))).toBe('2026-02-28');
    expect(isoDay(step('month', day('2026-01-15'), -1))).toBe('2025-12-15');
  });

  it('names the month, or both months of a week across two', () => {
    expect(heading('month', day('2026-11-20'), 'en-GB')).toBe('November 2026');
    expect(heading('week', day('2026-11-12'), 'en-GB')).toBe('November 2026');
    expect(heading('week', day('2026-12-01'), 'en-GB')).toBe('Nov – Dec 2026');
    expect(heading('week', day('2026-12-31'), 'en-GB')).toBe('Dec 2026 – Jan 2027');
  });

  it('shows times on the 24-hour clock', () => {
    expect(clock('2026-11-12T09:05')).toBe('9:05');
    expect(clock('2026-11-12T13:30')).toBe('13:30');
  });
});

describe('placing events', () => {
  it('puts overlapping events side by side and the rest full width', () => {
    const placed = placeDay([ev('A', '2026-11-12T09:00', '2026-11-12T10:00'), ev('B', '2026-11-12T09:30', '2026-11-12T10:30'), ev('C', '2026-11-12T12:00', '2026-11-12T13:00'), ev('D', '2026-11-12T10:00', '2026-11-12T11:00')], day('2026-11-12'));
    const by = Object.fromEntries(placed.map((p) => [p.event.title, p]));
    expect([by.A!.column, by.B!.column, by.D!.column]).toEqual([0, 1, 0]);
    expect([by.A!.columns, by.B!.columns, by.D!.columns]).toEqual([2, 2, 2]);
    expect([by.C!.column, by.C!.columns, by.C!.top, by.C!.height]).toEqual([0, 1, 720, 60]);
  });

  it('cuts events at midnight, keeps short ones readable and leaves whole days to the top row', () => {
    const late = ev('Late', '2026-11-12T23:00', '2026-11-13T01:00');
    expect(placeDay([late], day('2026-11-12'))[0]).toMatchObject({ top: 1380, height: 60 });
    expect(placeDay([late], day('2026-11-13'))[0]).toMatchObject({ top: 0, height: 60 });
    expect(placeDay([ev('Ping', '2026-11-12T08:00', '2026-11-12T08:00')], day('2026-11-12'))[0]!.height).toBe(20);
    const long = ev('Conference', '2026-11-11T08:00', '2026-11-14T18:00');
    expect(placeDay([long], day('2026-11-12'))).toEqual([]);
    expect(allDayOn([long], day('2026-11-12')).length).toBe(1);
    expect(allDayOn([long], day('2026-11-11')).length).toBe(0);
  });

  it('lists all-day events across the days they cover', () => {
    const trip = ev('Lisbon', '2026-11-12', '2026-11-15', true);
    expect(['2026-11-11', '2026-11-12', '2026-11-14', '2026-11-15'].map((d) => allDayOn([trip], day(d)).length)).toEqual([0, 1, 1, 0]);
    const lunch = ev('Lunch', '2026-11-12T12:00', '2026-11-12T13:00');
    expect(eventsOn([lunch, trip], day('2026-11-12')).map((e) => e.title)).toEqual(['Lisbon', 'Lunch']);
  });
});

describe('a new event said in words', () => {
  // Friday 6 November 2026, 15:00.
  const now = new Date(2026, 10, 6, 15, 0);
  const said = (text: string) => parseEventWords(text, now, parseWhen);
  it('reads the day and the time in either order, a range, and a length', () => {
    expect(said('Lunch with Sam fri 1pm')).toEqual({ title: 'Lunch with Sam', start: '2026-11-13T13:00', end: '2026-11-13T14:00', allDay: false });
    expect(said('Lunch with Sam 1pm fri')).toEqual({ title: 'Lunch with Sam', start: '2026-11-13T13:00', end: '2026-11-13T14:00', allDay: false });
    expect(said('Standup tomorrow 9:30 for 15m')).toEqual({ title: 'Standup', start: '2026-11-07T09:30', end: '2026-11-07T09:45', allDay: false });
    expect(said('Dentist 12 dec at 3pm')).toEqual({ title: 'Dentist', start: '2026-12-12T15:00', end: '2026-12-12T16:00', allDay: false });
    expect(said('Workshop mon 10-12')).toEqual({ title: 'Workshop', start: '2026-11-09T10:00', end: '2026-11-09T12:00', allDay: false });
    expect(said('Call 2-3pm')).toEqual({ title: 'Call', start: '2026-11-07T14:00', end: '2026-11-07T15:00', allDay: false });
    expect(said('Review at noon for 2h')).toEqual({ title: 'Review', start: '2026-11-07T12:00', end: '2026-11-07T14:00', allDay: false });
    expect(said('Drinks 6pm')).toEqual({ title: 'Drinks', start: '2026-11-06T18:00', end: '2026-11-06T19:00', allDay: false });
  });
  it('a day alone is all day; words with no day or time are not an event yet', () => {
    expect(said('Offsite next week')).toEqual({ title: 'Offsite', start: '2026-11-09', end: '2026-11-09', allDay: true });
    expect(said('Read chapter 12')).toBeNull();
    expect(said('Buy 2 coffees')).toBeNull();
    expect(said('fri 1pm')).toBeNull();
  });
});

describe('dragging an event', () => {
  it('moves by days and snapped minutes, keeping its length, or resizes only its end', () => {
    const e = { start: '2026-11-12T09:00', end: '2026-11-12T10:00' };
    expect(dragged(e, 1, 37, false)).toEqual({ start: '2026-11-13T09:30', end: '2026-11-13T10:30' });
    expect(dragged(e, 0, -100, false)).toEqual({ start: '2026-11-12T07:15', end: '2026-11-12T08:15' });
    expect(dragged(e, 0, 50, true)).toEqual({ start: '2026-11-12T09:00', end: '2026-11-12T10:45' });
    expect(dragged(e, 0, -120, true)).toEqual({ start: '2026-11-12T09:00', end: '2026-11-12T09:15' });
    expect(snapMinutes(608)).toBe(615);
  });
});

describe('dropping an event on another day', () => {
  it('keeps a timed event\'s time and an all-day event\'s length', () => {
    expect(movedByDays({ start: '2026-11-10T09:30', end: '2026-11-10T10:00', allDay: false }, 2)).toEqual({ start: '2026-11-12T09:30', end: '2026-11-12T10:00' });
    // Stored, an all-day event ends the day after; the editor sends its last day.
    expect(movedByDays({ start: '2026-11-10', end: '2026-11-13', allDay: true }, -1)).toEqual({ start: '2026-11-09', end: '2026-11-11' });
    expect(draftEnd({ end: '2026-11-13', allDay: true })).toBe('2026-11-12');
    expect(draftEnd({ end: '2026-11-13T10:00', allDay: false })).toBe('2026-11-13T10:00');
  });
});
