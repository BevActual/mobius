import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from '@mobius/shared';
import { setLocaleForTests } from './dates';
import { dayLabel, parseDayText, parseTimeText, allDayOn, changedSince, clock, hourLabel, daysFor, dragged, draftEnd, movedByDays, eventsInFile, eventsOn, heading, searchEvents, isoDay, isoWeek, localDate, parseEventWords, placeDay, snapMinutes, step, weekStart } from './calendar-view';
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

  it('shows a whole year in Year view, and steps a year at a time', () => {
    const year = daysFor('year', day('2026-11-12'));
    expect(year).toHaveLength(365);
    expect([isoDay(year[0]!), isoDay(year[364]!)]).toEqual(['2026-01-01', '2026-12-31']);
    expect(daysFor('year', day('2028-03-01'))).toHaveLength(366);
    expect(isoDay(step('year', day('2026-11-12'), 1))).toBe('2027-11-12');
    expect(isoDay(step('year', day('2028-02-29'), -1))).toBe('2027-02-28');
    expect(heading('year', day('2026-11-12'), 'en-GB')).toBe('2026');
  });

  it('numbers weeks as ISO does, Monday to Sunday', () => {
    expect(isoWeek(new Date(2026, 10, 12))).toBe(46);
    expect(isoWeek(new Date(2026, 10, 15))).toBe(46);
    expect(isoWeek(new Date(2026, 10, 16))).toBe(47);
    expect(isoWeek(new Date(2027, 0, 1))).toBe(53);
    expect(isoWeek(new Date(2026, 0, 1))).toBe(1);
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

  it('shows times as the computer keeps its clock, 24-hour or with AM and PM', () => {
    setLocaleForTests('en-GB');
    expect(clock('2026-11-12T09:05')).toBe('9:05');
    expect(clock('2026-11-12T13:30')).toBe('13:30');
    expect(hourLabel(13)).toBe('13:00');
    setLocaleForTests('en-US');
    expect(clock('2026-11-12T13:30').replace(/\s/g, ' ')).toBe('1:30 PM');
    expect(hourLabel(13).replace(/\s/g, ' ')).toBe('1 PM');
    setLocaleForTests(null);
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

  it('counts a whole day when asked with the time now, so "today" at 7 pm still has its morning and not tomorrow', () => {
    const standup = ev('Standup', '2026-11-12T09:00', '2026-11-12T09:15');
    const tomorrow = ev('Gym', '2026-11-13T08:00', '2026-11-13T09:00');
    expect(eventsOn([standup, tomorrow], localDate('2026-11-12T19:00')).map((e) => e.title)).toEqual(['Standup']);
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

describe('the event sheet day and time fields', () => {
  it('read times typed in any of the usual ways', () => {
    expect(parseTimeText('14:30')).toBe('14:30');
    expect(parseTimeText('2:30 pm')).toBe('14:30');
    expect(parseTimeText('2pm')).toBe('14:00');
    expect(parseTimeText('12am')).toBe('00:00');
    expect(parseTimeText('1430')).toBe('14:30');
    expect(parseTimeText('9')).toBe('09:00');
    expect(parseTimeText('25:00')).toBeNull();
    expect(parseTimeText('soon')).toBeNull();
  });
  it('read days typed as dates or words, and as the sheet shows them', () => {
    const now = new Date(2026, 10, 11, 9);
    expect(parseDayText('2026-11-12', now, parseWhen)).toBe('2026-11-12');
    expect(parseDayText('tomorrow', now, parseWhen)).toBe('2026-11-12');
    expect(parseDayText('fri', now, parseWhen)).toBe('2026-11-13');
    expect(parseDayText(dayLabel('2026-12-03'), now, parseWhen)).toBe('2026-12-03');
    expect(parseDayText('whenever', now, parseWhen)).toBeNull();
  });
});

describe('what Mobius changed in a calendar file', () => {
  const file = (body: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${body}END:VCALENDAR\r\n`;
  const event = (uid: string, title: string, start: string) => `BEGIN:VEVENT\r\nUID:${uid}\r\nDTSTART:${start}\r\nSUMMARY:${title}\r\nBEGIN:VALARM\r\nSUMMARY:Alarm\r\nEND:VALARM\r\nEND:VEVENT\r\n`;
  const at = (id: string, title: string, start: string, repeats = false): CalendarEvent => ({ ...ev(title, start, start), id, repeats });
  it('finds events added, moved or renamed, soonest first, and leaves the rest', () => {
    const before = file(event('a', 'Standup', '20261112T090000') + event('b', 'Lunch\\, with Sam', '20261113T120000') + event('c', 'Gym', '20261114T180000'));
    const now = [at('c', 'Gym', '2026-11-14T18:00'), at('a', 'Standup', '2026-11-12T10:00'), at('b', 'Lunch, with Sam', '2026-11-13T12:00'), at('d', 'Kickoff', '2026-11-19T09:00')];
    expect(changedSince(before, now).map((e) => e.id)).toEqual(['a', 'd']);
    expect(changedSince(before, [at('c', 'Gym class', '2026-11-14T18:00')]).map((e) => e.id)).toEqual(['c']);
  });
  it('counts every event in a file the turn made, and a repeating one once', () => {
    expect(changedSince(null, [at('r', 'Run', '2026-11-12T07:00', true), at('r', 'Run', '2026-11-13T07:00', true)]).map((e) => e.start)).toEqual(['2026-11-12T07:00']);
    const before = file(event('r', 'Run', '20261101T070000'));
    expect(changedSince(before, [at('r', 'Run', '2026-11-12T07:00', true)])).toEqual([]);
  });
  it('reads folded lines and all-day dates', () => {
    const before = file('BEGIN:VEVENT\r\nUID:t\r\nDTSTART;VALUE=DATE:20261112\r\nSUMMARY:A long\r\n  trip\r\nEND:VEVENT\r\n');
    expect(eventsInFile(before).get('t')).toEqual({ title: 'A long trip', start: '20261112' });
    expect(changedSince(before, [{ ...at('t', 'A long trip', '2026-11-12'), allDay: true }])).toEqual([]);
  });
});

describe('searching events', () => {
  const at = (id: string, title: string, start: string, extra: Partial<CalendarEvent> = {}): CalendarEvent => ({ ...ev(title, start, start), id, ...extra });
  const today = day('2026-11-12');
  it('matches every word in the title, place or notes, each event once at its next time', () => {
    const events = [
      at('a', 'Crash test', '2026-11-15T09:00', { location: 'Northfield sled' }),
      at('r', 'Standup', '2026-11-10T09:30', { repeats: true }), at('r', 'Standup', '2026-11-13T09:30', { repeats: true }), at('r', 'Standup', '2026-11-14T09:30', { repeats: true }),
      at('b', 'Motor call', '2026-11-11T10:00', { notes: 'Ask Sam about the sled' }),
      at('c', 'Lunch', '2026-11-12T12:30'),
    ];
    expect(searchEvents(events, 'sled', today).map((e) => e.id)).toEqual(['b', 'a']);
    expect(searchEvents(events, 'SLED north', today).map((e) => e.id)).toEqual(['a']);
    expect(searchEvents(events, 'standup', today).map((e) => e.start)).toEqual(['2026-11-13T09:30']);
    expect(searchEvents(events, '  ', today)).toEqual([]);
  });
  it('shows a past repeating event by its latest time', () => {
    const past = [at('r', 'Retro', '2026-10-01T16:00', { repeats: true }), at('r', 'Retro', '2026-10-15T16:00', { repeats: true })];
    expect(searchEvents(past, 'retro', today).map((e) => e.start)).toEqual(['2026-10-15T16:00']);
  });
});
