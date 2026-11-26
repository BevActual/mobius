import { describe, expect, it } from 'vitest';
import type { ConversationInfo, ProjectInfo } from '@mobius/shared';
import { groupByStatus, progressOf, projectSummary, projectThreads, ruleApps, statusName, targetLine, threadLine, changesSince, draftAsk, parseDraft, updateDue, UPDATE_EVERY_MS } from './projects-view';

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

describe('a project’s status, target and progress', () => {
  it('names the status, counts progress from the task list, and says when the target has passed', () => {
    expect(statusName('started')).toBe('In progress');
    expect(statusName(undefined)).toBe('No status');
    expect(progressOf({ open: 5, done: 3 })).toEqual({ done: 3, total: 8, percent: 38 });
    expect(progressOf({ open: 0, done: 0 })).toEqual({ done: 0, total: 0, percent: 0 });
    expect(progressOf(undefined)).toBeNull();
    const now = new Date(2026, 10, 26, 15, 0);
    expect(targetLine('2026-11-26', 'started', now)).toEqual({ text: 'Today', late: false });
    expect(targetLine('2026-11-27', 'started', now)).toEqual({ text: 'Tomorrow', late: false });
    expect(targetLine('2026-12-04', 'started', now)).toEqual({ text: 'Dec 4', late: false });
    expect(targetLine('2027-01-15', 'planned', now)).toEqual({ text: 'Jan 15, 2027', late: false });
    expect(targetLine('2026-11-20', 'started', now)).toEqual({ text: 'Nov 20', late: true });
    expect(targetLine('2026-11-20', 'completed', now)).toEqual({ text: 'Nov 20', late: false });
    expect(targetLine(undefined, 'started', now)).toBeNull();
  });
});

describe('the Projects panel', () => {
  it('is one group until a project has a status, then grouped by status in work order', () => {
    const plain: { id: string; status?: undefined }[] = [{ id: 'a' }, { id: 'b' }];
    expect(groupByStatus(plain)).toEqual([{ title: 'Projects', projects: [{ id: 'a' }, { id: 'b' }] }]);
    const got = groupByStatus([{ id: 'a', status: 'completed' as const }, { id: 'b' }, { id: 'c', status: 'started' as const }, { id: 'd', status: 'planned' as const }]);
    expect(got.map((g) => [g.title, g.projects.map((p) => p.id)])).toEqual([['In progress', ['c']], ['Planned', ['d']], ['No status', ['b']], ['Completed', ['a']]]);
  });
});

describe('project updates', () => {
  const now = new Date(2026, 10, 26, 15, 0);
  it('say what changed since the last one, with progress only when it moved by more than 2 points', () => {
    expect(changesSince(undefined, { status: 'started' }, now)).toEqual([]);
    expect(changesSince({ status: 'planned', target: '2026-12-04', done: 2, total: 8 }, { status: 'started', target: '2026-12-11', done: 3, total: 8 }, now))
      .toEqual(['Status: Planned → In progress', 'Target day: Dec 4 → Dec 11', 'Progress: 25% → 38% (3 of 8 done)']);
    expect(changesSince({ status: 'started', done: 50, total: 100 }, { status: 'started', done: 52, total: 100 }, now)).toEqual([]);
    expect(changesSince({ target: '2026-12-04' }, {}, now)).toEqual(['Target day removed']);
    expect(changesSince({}, { target: '2026-12-04' }, now)).toEqual(['Target day set to Dec 4']);
  });
  it('are due a week after the last, only for work in progress', () => {
    const t = now.getTime();
    expect(updateDue({ status: 'started' }, t)).toBe(true);
    expect(updateDue({ status: 'planned' }, t)).toBe(false);
    expect(updateDue({ status: 'started', updates: [{ id: 'u', at: t - 2 * 86_400_000, health: 'on_track', text: 'x' }] }, t)).toBe(false);
    expect(updateDue({ status: 'started', updates: [{ id: 'u', at: t - UPDATE_EVERY_MS - 1, health: 'on_track', text: 'x' }] }, t)).toBe(true);
  });
  it('take their health from the first line of a draft', () => {
    expect(parseDraft('At risk\nCatering is late.')).toEqual({ health: 'at_risk', text: 'Catering is late.' });
    expect(parseDraft('**Health: On track.**\n\n- Venue booked')).toEqual({ health: 'on_track', text: '- Venue booked' });
    expect(parseDraft('Venue booked.')).toEqual({ health: null, text: 'Venue booked.' });
  });
  it('ask Mobius with where the project stands and the last update', () => {
    const ask = draftAsk({ id: 'p', name: 'Offsite', rules: {}, threads: [], status: 'started', updates: [{ id: 'u', at: 0, health: 'at_risk', text: 'Catering late.' }] },
      { changes: ['Status: Planned → In progress'], threads: ['Book the venue'], reports: [], progress: '3 of 8 done', target: 'Dec 4' });
    expect(ask).toContain('"Offsite"');
    expect(ask).toContain('Status: In progress.');
    expect(ask).toContain('Since the last update: Status: Planned → In progress.');
    expect(ask).toContain('The last update (At risk): Catering late.');
  });
});
