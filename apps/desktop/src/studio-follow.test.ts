import { describe, expect, it } from 'vitest';
import { FOLLOW_ACTIONS, FOLLOW_NAMES, parseSong, readFollow, writeSong } from './song-format';

describe('follow actions (Live 12, 16.7)', () => {
  it('names every action as Live does', () => {
    expect(FOLLOW_ACTIONS.map((a) => FOLLOW_NAMES[a])).toEqual(['No Action', 'Stop', 'Play Again', 'Previous', 'Next', 'First', 'Last', 'Any', 'Other', 'Jump']);
  });

  it('reads follow actions in range, with Next and No Action where they are missing', () => {
    expect(readFollow({})).toEqual({ a: 'next', b: 'none', chance: 1 });
    expect(readFollow({ a: 'other', b: 'stop', chance: 0.333, time: 3.1, times: 2.6, jump: 2 })).toEqual({ a: 'other', b: 'stop', chance: 0.33, time: 3, times: 3, jump: 2 });
    expect(readFollow({ a: 'sideways', chance: 7, time: -1, times: 0.5, jump: -1 })).toEqual({ a: 'next', b: 'none', chance: 1 });
    expect(readFollow('next')).toBeUndefined();
  });

  it("keeps a Session clip's follow actions through the file", () => {
    const text = JSON.stringify({ version: 2, tempo: 120, bars: 4, tracks: [{ id: 't', slots: [{ name: 'A', bars: 1, notes: [], follow: { a: 'jump', b: 'none', chance: 0.75, jump: 3 } }, null] }] });
    const parsed = parseSong(text);
    if (!('song' in parsed)) throw new Error('not read');
    expect(parsed.song.tracks[0]!.slots![0]!.follow).toEqual({ a: 'jump', b: 'none', chance: 0.75, jump: 3 });
    const again = parseSong(writeSong(parsed.song));
    if (!('song' in again)) throw new Error('not read again');
    expect(again.song.tracks[0]!.slots![0]!.follow).toEqual(parsed.song.tracks[0]!.slots![0]!.follow);
  });
});
