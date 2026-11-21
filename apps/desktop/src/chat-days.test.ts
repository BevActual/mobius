import { describe, expect, it } from 'vitest';
import { chatDayLabel, chatsByDay } from './chat-days';

const now = new Date(2026, 10, 21, 10, 0).getTime();
const at = (d: number, h = 12) => new Date(2026, 10, d, h, 0).getTime();

describe('chat days', () => {
  it('labels by calendar day, not 24 hours', () => {
    expect(chatDayLabel(at(21, 1), now)).toBe('Today');
    expect(chatDayLabel(at(20, 23), now)).toBe('Yesterday');
    expect(chatDayLabel(at(15), now)).toBe('Earlier');
  });
  it('sorts newest first and groups', () => {
    const rows = [{ id: 'a', updated_ms: at(21, 7) }, { id: 'b', updated_ms: at(21, 9) }, { id: 'c', updated_ms: at(19) }, { id: 'd', updated_ms: at(20) }];
    expect(chatsByDay(rows, now).map((g) => [g.label, g.rows.map((r) => r.id).join('')])).toEqual([['Today', 'ba'], ['Yesterday', 'd'], ['Earlier', 'c']]);
  });
});
