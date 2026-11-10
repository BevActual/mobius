import { describe, expect, it } from 'vitest';
import { mailReadIn } from './MailPlan';
import { nextAt } from './Mail';

describe('ask your mail', () => {
  it('lists the emails the last turn read, each once, in the order read', () => {
    const call = (name: string, args: object) => ({ id: name + JSON.stringify(args), name, arguments: args });
    expect(mailReadIn([
      { role: 'user', text: 'earlier' },
      { role: 'assistant', text: '', tool_calls: [call('mail.read', { id: 'old' })] },
      { role: 'user', text: 'when are the packs arriving?' },
      { role: 'assistant', text: '', tool_calls: [call('mail.search', { query: 'packs' }), call('mail.read', { id: 'a1/inbox/2' })] },
      { role: 'assistant', text: '', tool_calls: [call('mail.read', { id: 'a1/inbox/5' }), call('mail.read', { id: 'a1/inbox/2' })] },
      { role: 'assistant', text: 'In six weeks.', tool_calls: [] },
    ])).toEqual(['a1/inbox/2', 'a1/inbox/5']);
  });
});

describe('send later', () => {
  it('tomorrow at 8:00, and Monday at 9:00 (a week on when it is Monday)', () => {
    const wed = new Date(2026, 10, 11, 15, 30);
    expect(new Date(nextAt(8, null, wed))).toEqual(new Date(2026, 10, 12, 8, 0));
    expect(new Date(nextAt(9, 1, wed))).toEqual(new Date(2026, 10, 16, 9, 0));
    const mon = new Date(2026, 10, 16, 7, 0);
    expect(new Date(nextAt(9, 1, mon))).toEqual(new Date(2026, 10, 23, 9, 0));
  });
});
