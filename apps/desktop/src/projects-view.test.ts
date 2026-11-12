import { describe, expect, it } from 'vitest';
import type { ConversationInfo, ProjectInfo } from '@mobius/shared';
import { projectSummary, projectThreads, ruleApps, threadLine } from './projects-view';

const NOW = Date.UTC(2026, 10, 12, 12, 0);
const MIN = 60_000;
const talk = (id: string, ago: number, extra: Partial<ConversationInfo> = {}): ConversationInfo => ({ id, title: id, updated_ms: NOW - ago, messages: 4, activity: 'idle', waiting: 0, ...extra });
const project = (threads: string[], rules: ProjectInfo['rules'] = {}): ProjectInfo => ({ id: 'p', name: 'Kestrel', rules, threads });

describe('a project page', () => {
  it('lists its threads newest first, and keeps ones the window does not know yet', () => {
    const rows = projectThreads(project(['a', 'b', 'c']), [talk('a', 60 * MIN), talk('b', 5 * MIN)]);
    expect(rows.map((r) => r.id)).toEqual(['b', 'a', 'c']);
    expect(rows[2]!.info).toBeUndefined();
  });

  it('says under each thread how much is in it and when it last moved', () => {
    expect(threadLine(talk('a', 12 * MIN, { messages: 14 }), NOW)).toBe('14 messages · 12 min ago');
    expect(threadLine(talk('a', 2 * MIN, { messages: 1 }), NOW)).toBe('1 message · 2 min ago');
    expect(threadLine(undefined, NOW)).toBe('Not started');
  });

  it('opens with one line: threads, what was made, what waits on you, and when it last moved', () => {
    const p = project(['a', 'b']);
    const talks = [talk('a', 12 * MIN, { waiting: 1 }), talk('b', 3 * 60 * MIN)];
    expect(projectSummary(p, talks, 4, NOW)).toBe('2 threads · 4 made · 1 waiting on you · updated 12 min ago');
    expect(projectSummary(project([]), [], 0, NOW)).toBe('No threads yet');
    expect(projectSummary(project(['a']), [talk('a', 30 * 60 * MIN)], 0, NOW)).toBe('1 thread · updated yesterday');
  });

  it('lists rules for the apps added from Abilities, and any app that already has a rule of its own', () => {
    const installed = (id: string) => ['notes', 'mail'].includes(id);
    expect(ruleApps(['notes', 'docs', 'mail', 'video'], { video: 'ask' }, installed)).toEqual(['notes', 'mail', 'video']);
  });
});
