import { describe, expect, it } from 'vitest';
import type { SyncPair, SyncStatus } from '@mobius/shared';
import { canPair, conflictStem, pairFor, retryWords, syncLine } from './sync-view';

const idle: SyncStatus = { state: 'idle', done: 0, total: 0, lastSync: 1, retryAt: null, held: [], conflicts: [], ask: null, tooBig: [], error: null };
const pair = (folder: string): SyncPair => ({ id: folder, folder, drive: 'd', remote: folder, paused: false, created: 0, status: idle });

describe('sync line', () => {
  it('says the one most urgent state', () => {
    expect(syncLine(idle, 'Cloud', false, 0)).toEqual({ text: 'Up to date', tone: 'ok' });
    expect(syncLine({ ...idle, state: 'syncing', done: 2, total: 12 }, 'Cloud', false, 0)).toEqual({ text: 'Syncing 3 of 12', tone: 'busy' });
    expect(syncLine({ ...idle, held: ['a', 'b'] }, 'Cloud', false, 0).text).toBe('2 wait for Keep');
    expect(syncLine({ ...idle, held: ['a'] }, 'Cloud', true, 0).text).toBe('Paused');
    expect(syncLine({ ...idle, state: 'offline', retryAt: 150_000 }, 'Cloud', false, 0)).toEqual({ text: 'Offline, trying again in 3 minutes', tone: 'warn' });
    expect(syncLine({ ...idle, state: 'offline', conflicts: [{ path: 'a.md', copy: 'a (conflict from Cloud).md' }] }, 'Cloud', false, 0).text).toBe('1 conflict');
    expect(syncLine({ ...idle, conflicts: [{ path: 'a', copy: 'b' }], ask: { onDrive: ['x', 'y'], here: [] } }, 'Cloud', false, 0)).toEqual({ text: '2 deletes wait for your answer', tone: 'warn', action: 'deletes' });
    expect(syncLine({ ...idle, state: 'signIn', ask: { onDrive: ['x'], here: [] } }, 'Cloud', false, 0)).toEqual({ text: 'Sign in to Cloud again', tone: 'error', action: 'signIn' });
    expect(syncLine({ ...idle, tooBig: ['film.mov'] }, 'Cloud', false, 0)).toEqual({ text: '1 file too big to sync', tone: 'warn' });
  });
  it('counts down by the minute', () => {
    expect(retryWords(null, 0)).toBe('');
    expect(retryWords(30_000, 0)).toBe(', trying again in a minute');
    expect(retryWords(120_000, 0)).toBe(', trying again in 2 minutes');
  });
});

describe('pairs', () => {
  it('finds the pair a path is in, and pairs no folder inside or around one', () => {
    const pairs = [pair('notes')];
    expect(pairFor(pairs, 'notes/Work')?.folder).toBe('notes');
    expect(pairFor(pairs, 'notesy')).toBeNull();
    expect(canPair(pairs, 'docs')).toBe(true);
    expect(canPair(pairs, 'notes/Work')).toBe(false);
    expect(canPair([pair('notes/Work')], 'notes')).toBe(false);
    expect(canPair(pairs, '')).toBe(false);
  });
  it('names a conflict copy by the file it sits beside', () => {
    expect(conflictStem('notes/Work/Plan.md')).toBe('Plan');
    expect(conflictStem('README')).toBe('README');
  });
});
