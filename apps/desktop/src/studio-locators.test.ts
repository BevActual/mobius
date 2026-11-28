import { describe, expect, it } from 'vitest';
import { parseSong, writeSong, type Song } from './song-format';
import { addLocator, locatorName, loopToNext, moveLocator, nextLocator, previousLocator, removeLocator, renameLocator } from './studio-locators';

const song = (bars = 8): Song => ({ version: 2, tempo: 120, key: 'C major', bars, tracks: [] });

describe('locators', () => {
  it('are added in time order to the sixteenth, once per place, inside the song, and numbered until named', () => {
    const s = song(4);
    expect(addLocator(s, 8.1)).toBe(0);
    expect(addLocator(s, 0)).toBe(0);
    expect(addLocator(s, 8)).toBe(1);
    expect(addLocator(s, 99)).toBe(2);
    expect(s.locators).toEqual([{ beat: 0, name: '' }, { beat: 8, name: '' }, { beat: 15.75, name: '' }]);
    expect(renameLocator(s, 8, '  Chorus ')).toBe(true);
    expect([0, 1, 2].map((i) => locatorName(s.locators!, i))).toEqual(['1', 'Chorus', '3']);
    expect(moveLocator(s, 8, 4)).toBe(true);
    expect(moveLocator(s, 4, 0)).toBe(false);
    expect(removeLocator(s, 0)).toBe(true);
    expect(removeLocator(s, 0)).toBe(false);
    expect(s.locators).toEqual([{ beat: 4, name: 'Chorus' }, { beat: 15.75, name: '' }]);
    removeLocator(s, 4);
    removeLocator(s, 15.75);
    expect(s.locators).toBeUndefined();
  });

  it('step back and on from where the playhead is, and loop from one to the next', () => {
    const s = song(8);
    for (const b of [0, 8, 20]) addLocator(s, b);
    expect(nextLocator(s.locators, 8)?.beat).toBe(20);
    expect(nextLocator(s.locators, 20)).toBeNull();
    expect(previousLocator(s.locators, 9)?.beat).toBe(8);
    // Playing just past one, Previous goes to the one before it.
    expect(previousLocator(s.locators, 8.5, true)?.beat).toBe(0);
    expect(previousLocator(s.locators, 0)).toBeNull();
    expect(loopToNext(s, 8)).toEqual({ a: 2, b: 4 });
    expect(loopToNext(s, 20)).toEqual({ a: 5, b: 7 });
  });

  it('are kept in the song file, in range and in order', () => {
    const read = parseSong(JSON.stringify({ version: 2, tempo: 120, key: 'C major', bars: 4, tracks: [], locators: [{ beat: 8, name: 'B' }, { beat: 0.1, name: 'A' }, { beat: 8, name: 'twice' }, { beat: 64 }, { beat: 'x' }, { beat: 4 }] }));
    if (!('song' in read)) throw new Error(read.error);
    expect(read.song.locators).toEqual([{ beat: 0, name: 'A' }, { beat: 4, name: '' }, { beat: 8, name: 'B' }]);
    const back = parseSong(writeSong(read.song));
    if (!('song' in back)) throw new Error(back.error);
    expect(back.song.locators).toEqual(read.song.locators);
  });
});

describe('locators in another time signature', () => {
  it('stay inside the song and loop whole bars of it', () => {
    const s: Song = { ...song(4), signature: [3, 4] };
    expect(addLocator(s, 99)).toBe(0);
    expect(s.locators).toEqual([{ beat: 11.75, name: '' }]);
    addLocator(s, 3);
    expect(loopToNext(s, 3)).toEqual({ a: 1, b: 3 });
  });
});
