import { describe, expect, it } from 'vitest';
import { MAX_PIECES, parsePieces, pieceKey, withPiece, type OpenPiece } from './pieces';

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
