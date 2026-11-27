import { describe, expect, it } from 'vitest';
import { MAX_PIECES, NO_WORK, pieceOfTarget, parsePieces, pieceKey, withPiece, workOpenIn, workToShow, type MobiusWork, type OpenPiece } from './pieces';

describe('pieces', () => {
  it('reads only well-formed pieces, once each', () => {
    const raw = JSON.stringify([
      { kind: 'tasks.list', item: 'Inbox', by: 'you' },
      { kind: 'tasks.list', item: 'Inbox', by: 'mobius' },
      { kind: 'nope', item: 'x' },
      { kind: 'tasks.list', item: '' },
      { kind: 'tasks.list', item: 'Errands', by: 'mobius' },
      'junk',
    ]);
    expect(parsePieces(raw)).toEqual([{ kind: 'tasks.list', item: 'Inbox', by: 'you' }, { kind: 'tasks.list', item: 'Errands', by: 'mobius' }]);
    expect(parsePieces('{')).toEqual([]);
    expect(parsePieces(null)).toEqual([]);
  });

  it('opens a piece once, makes it the person\'s when they ask for it, and keeps at most a few', () => {
    const a: OpenPiece = { kind: 'tasks.list', item: 'A', by: 'mobius' };
    let open = withPiece([], a);
    expect(withPiece(open, a)).toEqual([a]);
    expect(withPiece(open, { ...a, by: 'you' })).toEqual([{ ...a, by: 'you' }]);
    // Mobius bringing it again does not take it back from the person.
    expect(withPiece([{ ...a, by: 'you' }], a)).toEqual([{ ...a, by: 'you' }]);
    for (let i = 0; i < MAX_PIECES + 2; i += 1) open = withPiece(open, { kind: 'tasks.list', item: `L${i}`, by: 'you' });
    expect(open).toHaveLength(MAX_PIECES);
    expect(open.map(pieceKey)).not.toContain(pieceKey(a));
  });

  it('keeps one Calendar day piece, which follows the day it is stepped to', () => {
    const today: OpenPiece = { kind: 'calendar.day', item: 'today', by: 'you' };
    expect(withPiece([today], { kind: 'calendar.day', item: '2026-11-28', by: 'mobius' })).toEqual([{ kind: 'calendar.day', item: '2026-11-28', by: 'you' }]);
  });
});

describe('Mobius bringing pieces', () => {
  const work = (lists: string[] = [], days: [string, string][] = [], drafts: [string, string][] = []): MobiusWork => ({
    lists: new Set(lists), days: new Map(days), drafts: new Map(drafts.map(([id, replyTo]) => [id, { replyTo, title: `Re ${replyTo}` }])),
  });
  it('brings the first new thing of a turn, and nothing for work that was there already', () => {
    expect(workToShow(work(['Inbox']), work(['Inbox']))).toBeNull();
    expect(workToShow(work(['Inbox']), work(['Inbox', 'Errands']))).toEqual({ kind: 'tasks.list', item: 'Errands' });
    expect(workToShow(NO_WORK, work([], [['s1', '2026-11-28']]))).toEqual({ kind: 'calendar.day', item: '2026-11-28' });
    expect(workToShow(NO_WORK, work([], [], [['d1', 'm1']]))).toEqual({ kind: 'mail.thread', item: 'm1', title: 'Re m1' });
  });
  it('knows when the piece\'s work is kept or discarded', () => {
    const now = work(['Errands'], [['s1', '2026-11-28']], [['d1', 'm1']]);
    expect(workOpenIn({ kind: 'tasks.list', item: 'Errands' }, now)).toBe(true);
    expect(workOpenIn({ kind: 'tasks.list', item: 'Inbox' }, now)).toBe(false);
    expect(workOpenIn({ kind: 'calendar.day', item: '2026-11-28' }, now)).toBe(true);
    expect(workOpenIn({ kind: 'mail.thread', item: 'm2' }, now)).toBe(false);
  });
});

describe('Show here', () => {
  it('knows which found things have a piece', () => {
    expect(pieceOfTarget({ app: 'tasks', list: 'Errands' })).toEqual({ kind: 'tasks.list', item: 'Errands' });
    expect(pieceOfTarget({ app: 'mail', id: 'm1' }, 'Re: Lunch')).toEqual({ kind: 'mail.thread', item: 'm1', title: 'Re: Lunch' });
    expect(pieceOfTarget({ app: 'calendar', date: '2026-12-01' })).toEqual({ kind: 'calendar.day', item: '2026-12-01' });
    expect(pieceOfTarget({ app: 'calendar' })).toEqual({ kind: 'calendar.day', item: 'today' });
    expect(pieceOfTarget({ app: 'notes' })).toBeNull();
  });
});
