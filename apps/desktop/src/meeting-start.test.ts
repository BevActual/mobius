import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from '@mobius/shared';
import { calendarDay, isMeeting, meetingKey, meetingStarting } from './meeting-start';

const event = (over: Partial<CalendarEvent>): CalendarEvent => ({ id: 'a', calendar: 'Work', title: 'Budget review', start: '2026-11-25T11:00', end: '2026-11-25T12:00', allDay: false, location: 'Room 4', notes: '', repeats: false, ...over });

describe('the nudge when a meeting starts', () => {
  it('is for a timed event with people or a place', () => {
    expect(isMeeting(event({}))).toBe(true);
    expect(isMeeting(event({ location: '', attendees: [{ name: 'Ana', email: 'ana@example.com', status: 'accepted' }] }))).toBe(true);
    expect(isMeeting(event({ location: '' }))).toBe(false);
    expect(isMeeting(event({ allDay: true }))).toBe(false);
  });

  it('comes from a minute before the start to five minutes after, once for each time', () => {
    const budget = event({});
    const at = (h: number, m: number, s = 0) => new Date(2026, 10, 25, h, m, s);
    expect(meetingStarting([budget], at(10, 58, 59), new Set())).toBeNull();
    expect(meetingStarting([budget], at(10, 59, 30), new Set())).toBe(budget);
    expect(meetingStarting([budget], at(11, 5), new Set())).toBe(budget);
    expect(meetingStarting([budget], at(11, 5, 1), new Set())).toBeNull();
    expect(meetingStarting([budget], at(11, 1), new Set([meetingKey(budget)]))).toBeNull();
    // The next time of a repeating meeting is a new one.
    const next = event({ repeats: true, occurrence: '2026-11-26T11:00' });
    expect(meetingKey(next)).not.toBe(meetingKey(budget));
  });

  it('offers the one that started first when two overlap, and never a plain event', () => {
    const late = event({ id: 'b', title: 'Standup', start: '2026-11-25T11:02' });
    const plain = event({ id: 'c', title: 'Lunch', location: '', start: '2026-11-25T11:00' });
    expect(meetingStarting([late, plain, event({})], new Date(2026, 10, 25, 11, 2), new Set())?.title).toBe('Budget review');
    expect(calendarDay(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});
