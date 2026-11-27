import { describe, expect, it } from 'vitest';
import { checkInAsk, checkInDue, checkInTitle, isCheckInApp } from './checkins';

describe('check-ins when an app is opened', () => {
  const now = new Date(2026, 10, 27, 9, 0);
  it('look once a day, and not on the first day an app is opened', () => {
    expect(checkInDue('mail', now, {})).toBe('note');
    expect(checkInDue('mail', now, { mail: '2026-11-26' })).toBe('ask');
    expect(checkInDue('mail', now, { mail: '2026-11-27' })).toBe('no');
    expect(checkInDue('tasks', now, { mail: '2026-11-26' })).toBe('note');
  });
  it('are for the apps Mobius can read, and only read and suggest', () => {
    expect(isCheckInApp('mail')).toBe(true);
    expect(isCheckInApp('browser')).toBe(false);
    expect(isCheckInApp('toString')).toBe(false);
    expect(checkInTitle('calendar')).toBe('Suggestions for Calendar');
    const ask = checkInAsk('tasks');
    expect(ask.split('\n')[0]).toBe('Suggestions for Tasks');
    expect(ask).toContain('do not change anything');
  });
});
