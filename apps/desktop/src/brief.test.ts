import { describe, expect, it } from 'vitest';
import { briefAsk, briefDue, briefLine, briefLines, dayOf } from './brief';

describe('the morning brief', () => {
  const at = (h: number) => new Date(2026, 10, 27, h, 30);
  it('is due once a day, from five in the morning, while it is on', () => {
    expect(briefDue(at(4), null, true)).toBe(false);
    expect(briefDue(at(7), null, true)).toBe(true);
    expect(briefDue(at(7), dayOf(at(7)), true)).toBe(false);
    expect(briefDue(at(7), '2026-11-26', true)).toBe(true);
    expect(briefDue(at(7), null, false)).toBe(false);
  });
  it('is named by its first line and only reads', () => {
    const ask = briefAsk(at(7));
    expect(ask.split('\n')[0]).toBe('Morning brief');
    expect(ask).toContain('Friday 27 November');
    expect(ask).toContain('do not change anything');
  });
  it('shows its first line in the Inbox, without Markdown marks', () => {
    expect(briefLine('## Today\n\n- **Two** tasks due')).toBe('Today');
    expect(briefLine('\n- **Two** tasks due, one overdue')).toBe('Two tasks due, one overdue');
    expect(briefLine('x'.repeat(200)).length).toBe(140);
    expect(briefLines('## Today\n\n- Two tasks due\n1. Dentist at 15:00\n')).toEqual(['Today', 'Two tasks due', 'Dentist at 15:00']);
  });
});
