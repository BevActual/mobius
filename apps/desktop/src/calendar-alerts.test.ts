import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from '@mobius/shared';
import { alertDue, alertLabel, alertSaid } from './calendar-alerts';

const event = (over: Partial<CalendarEvent>): CalendarEvent => ({ id: 'e', calendar: 'Work', title: 'Review', start: '2026-11-25T10:00', end: '2026-11-25T11:00', allDay: false, location: '', notes: '', repeats: false, ...over });

describe('calendar alerts', () => {
  it('comes at its time, for two minutes, once', () => {
    const e = event({ alert: 10 });
    expect(alertDue([e], new Date('2026-11-25T09:49:59'), new Set())).toBeNull();
    expect(alertDue([e], new Date('2026-11-25T09:50:00'), new Set())).toBe(e);
    expect(alertDue([e], new Date('2026-11-25T09:51:30'), new Set())).toBe(e);
    expect(alertDue([e], new Date('2026-11-25T09:52:01'), new Set())).toBeNull();
    expect(alertDue([e], new Date('2026-11-25T09:50:00'), new Set(['Work/e/2026-11-25T10:00']))).toBeNull();
    expect(alertDue([event({})], new Date('2026-11-25T10:00:00'), new Set())).toBeNull();
  });

  it('comes for an all-day event at 9:00 on its day or the day before', () => {
    const on = event({ start: '2026-11-26', end: '2026-11-26', allDay: true, alert: -540 });
    const before = event({ id: 'b', start: '2026-11-26', end: '2026-11-26', allDay: true, alert: 900 });
    expect(alertDue([on, before], new Date('2026-11-25T09:00:30'), new Set())).toBe(before);
    expect(alertDue([on, before], new Date('2026-11-26T09:00:30'), new Set())).toBe(on);
  });

  it('says how long until it starts', () => {
    expect(alertSaid(event({}), new Date('2026-11-25T09:50:00'))).toBe('Review in 10 minutes');
    expect(alertSaid(event({}), new Date('2026-11-25T09:59:00'))).toBe('Review in 1 minute');
    expect(alertSaid(event({}), new Date('2026-11-25T10:00:00'))).toBe('Review is starting');
    expect(alertSaid(event({}), new Date('2026-11-25T09:00:00'))).toBe('Review in 1 hour');
    expect(alertSaid(event({ start: '2026-11-26', allDay: true }), new Date('2026-11-25T09:00:00'))).toBe('Review is tomorrow');
    expect(alertSaid(event({ start: '2026-11-26', allDay: true }), new Date('2026-11-26T09:00:00'))).toBe('Review is today');
  });

  it('names an alert set in another app', () => {
    expect(alertLabel(10, false)).toBe('10 minutes before');
    expect(alertLabel(120, false)).toBe('2 hours before');
    expect(alertLabel(2880, false)).toBe('2 days before');
    expect(alertLabel(-540, true)).toBe('On the day (9:00)');
    expect(alertLabel(null, false)).toBe('None');
  });
});
