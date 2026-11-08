import { describe, expect, it } from 'vitest';
import type { ActivityEntry } from '@mobius/shared';
import { privacyReport, whereItRuns } from './privacy';

let seq = 0;
const e = (kind: string, capability: string, resource: string | null = null, tsMs = 1000, who = 'agent'): ActivityEntry => ({ seq: ++seq, tsMs, kind, capability, resource, tool: null, who });

describe('the privacy report', () => {
  it('counts what Mobius read, changed and was blocked from, by area, since a time', () => {
    const rows = privacyReport([
      e('tool.started', 'browser.read'), e('tool.started', 'browser.read'), e('tool.started', 'browser.navigate', 'https://a.example'),
      e('tool.started', 'files.write', 'notes/Plan.md'), e('tool.started', 'files.read', 'notes/Plan.md'),
      e('permission.denied', 'tasks.write'), e('tool.started', 'memory.write'),
      e('tool.started', 'browser.read', null, 10), e('tool.started', 'tasks.read', null, 1000, 'person'),
      e('permission.asked', 'browser.read'),
    ], 500);
    expect(rows).toEqual([
      { area: 'Browser', read: 2, changed: 1, blocked: 0 },
      { area: 'Notes', read: 1, changed: 1, blocked: 0 },
      { area: 'Memory', read: 0, changed: 1, blocked: 0 },
      { area: 'Tasks', read: 0, changed: 0, blocked: 1 },
    ]);
  });
  it('says where requests run', () => {
    expect(whereItRuns('http://127.0.0.1:8080/v1')).toBe('On this computer');
    expect(whereItRuns('https://api.openai.com/v1')).toBe('api.openai.com');
    expect(whereItRuns('')).toBe('Not set up');
  });
});
