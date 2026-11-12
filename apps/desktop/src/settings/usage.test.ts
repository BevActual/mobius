import { describe, expect, it } from 'vitest';
import type { UsageRow } from '@mobius/shared';
import { byDay, costText, daysBetween, groupBy, rangeDays, shortCount, toCsv, total } from './usage';

const row = (over: Partial<UsageRow>): UsageRow => ({ day: '2026-11-10', gateway: 'openrouter', model: 'm', app: 'agent', kind: 'chat', requests: 1, inputTokens: 100, outputTokens: 10, costUsd: 0.5, ...over });

describe('usage', () => {
  it('works out the days of each range, ending today', () => {
    const today = new Date(2026, 10, 12);
    expect(rangeDays('7d', today)).toEqual({ from: '2026-11-06', to: '2026-11-12' });
    expect(rangeDays('month', today)).toEqual({ from: '2026-11-01', to: '2026-11-12' });
    expect(rangeDays('30d', new Date(2026, 2, 1))).toEqual({ from: '2026-01-31', to: '2026-03-01' });
    expect(daysBetween('2026-10-30', '2026-11-02')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
  });

  it('fills days with nothing, and sums each day', () => {
    const days = byDay([row({}), row({ inputTokens: 50 })], '2026-11-09', '2026-11-11');
    expect(days.map((d) => d.day)).toEqual(['2026-11-09', '2026-11-10', '2026-11-11']);
    expect(days[0]!.requests).toBe(0);
    expect(days[1]!.inputTokens).toBe(150);
  });

  it('groups by model, service or app, most tokens first', () => {
    const rows = [row({ model: 'small', inputTokens: 10 }), row({ model: 'big', inputTokens: 900 }), row({ model: 'small', inputTokens: 10 })];
    expect(groupBy(rows, 'model').map((g) => [g.key, g.requests])).toEqual([['big', 1], ['small', 2]]);
  });

  it('says Plan, Free or unknown where there is no price', () => {
    expect(costText(total([row({ gateway: 'claude-code', costUsd: null })]))).toBe('Plan');
    expect(costText(total([row({ gateway: 'ollama', costUsd: 0 })]))).toBe('Free');
    expect(costText(total([row({ costUsd: null })]))).toBe('—');
    expect(costText(total([row({ costUsd: 1.234 }), row({ gateway: 'chatgpt', costUsd: null })]))).toBe('$1.23 + plan');
    expect(costText(total([row({ costUsd: 0.004 })]))).toBe('<$0.01');
    expect(costText(total([]))).toBe('$0.00');
  });

  it('shortens big counts', () => {
    expect([950, 1_500, 84_000, 1_200_000, 12_000_000].map(shortCount)).toEqual(['950', '1.5K', '84K', '1.2M', '12M']);
  });

  it('writes CSV a spreadsheet opens safely', () => {
    const csv = toCsv([row({ model: 'a,"b"' }), row({ day: '2026-11-09', model: '=HYPERLINK()', costUsd: null, cachedTokens: 5 })]);
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toBe('day,service,model,app,kind,requests,input_tokens,output_tokens,cached_tokens,cost_usd');
    expect(lines[1]).toBe('2026-11-09,openrouter,"\'=HYPERLINK()",agent,chat,1,100,10,5,');
    expect(lines[2]).toBe('2026-11-10,openrouter,"a,""b""",agent,chat,1,100,10,,0.500000');
  });
});
