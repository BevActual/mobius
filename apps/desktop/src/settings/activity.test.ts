import { describe, expect, it } from 'vitest';
import type { ActivityEntry } from '@mobius/shared';
import { describeActivity } from './activity';

const entry = (over: Partial<ActivityEntry>): ActivityEntry => ({ seq: 1, tsMs: 1, kind: 'tool.started', capability: null, resource: null, tool: null, who: 'agent', ...over });

describe('describing activity in plain words', () => {
  it('says what happened for each kind the core records', () => {
    const cases: Array<[Partial<ActivityEntry>, string]> = [
      [{ kind: 'permission.asked', capability: 'browser.navigate', resource: 'https://example.com' }, 'Asked you about browser.navigate on https://example.com'],
      [{ kind: 'permission.approved', capability: 'clock.read' }, 'You allowed clock.read'],
      [{ kind: 'permission.rejected', capability: 'clock.read' }, 'You declined clock.read'],
      [{ kind: 'permission.allowed', capability: 'clock.read' }, 'Allowed clock.read (already approved)'],
      [{ kind: 'permission.denied', capability: 'fs.delete' }, 'Blocked fs.delete'],
      [{ kind: 'permission.revoked', capability: 'browser.navigate', resource: 'https://example.com' }, 'Approval for browser.navigate on https://example.com removed'],
      [{ kind: 'permission.withdrawn', capability: 'browser.read' }, 'Question about browser.read withdrawn'],
      [{ kind: 'tool.started', tool: 'browser.open', capability: 'browser.navigate' }, 'Started browser.open'],
      [{ kind: 'tool.completed', tool: 'browser.open' }, 'Finished browser.open'],
      [{ kind: 'tool.failed', tool: 'browser.open' }, 'browser.open failed'],
    ];
    for (const [over, expected] of cases) expect(describeActivity(entry(over)).text, over.kind).toBe(expected);
  });

  it('falls back to the capability when a tool is not named, and to the raw kind when it does not know it', () => {
    expect(describeActivity(entry({ kind: 'tool.completed', tool: null, capability: 'clock.read' })).text).toBe('Finished clock.read');
    expect(describeActivity(entry({ kind: 'tool.completed', tool: null, capability: null })).text).toBe('Finished a tool');
    expect(describeActivity(entry({ kind: 'something.new' })).text).toBe('something.new');
  });

  it('marks what deserves attention', () => {
    expect(describeActivity(entry({ kind: 'permission.denied' })).tone).toBe('warning');
    expect(describeActivity(entry({ kind: 'tool.failed' })).tone).toBe('warning');
    expect(describeActivity(entry({ kind: 'permission.rejected' })).tone).toBe('warning');
    expect(describeActivity(entry({ kind: 'tool.completed' })).tone).toBe('normal');
  });

  it('says who did it', () => {
    expect(describeActivity(entry({ who: 'agent' })).who).toBe('Agent');
    expect(describeActivity(entry({ who: 'person' })).who).toBe('You');
    expect(describeActivity(entry({ who: null })).who).toBe('');
    expect(describeActivity(entry({ who: 'mcp_server' })).who).toBe('Connected app');
  });
});
