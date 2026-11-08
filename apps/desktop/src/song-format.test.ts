import { describe, expect, it } from 'vitest';
import { audible, changedTracks, freshTrackId, keyPitches, noteName, parseSong, songSeconds, writeSong, type Song } from './song-format';

const FILE = JSON.stringify({
  tempo: 112, key: 'A minor', bars: 4,
  tracks: [
    { id: 't1', name: 'Chords', instrument: 'pad', notes: [{ pitch: 57, start: 0, length: 4 }, [60, 0, 4, 0.7]] },
    { id: 't2', instrument: 'drums', muted: true, notes: [{ pitch: 36, start: 0, length: 0.5 }, { pitch: 38, start: 99, length: 1 }, { start: 1 }] },
  ],
});
const song = (text: string): Song => { const r = parseSong(text); if ('error' in r) throw new Error(r.error); return r.song; };

describe('songs', () => {
  it('read tracks of notes, with defaults and limits', () => {
    const s = song(FILE);
    expect(s).toMatchObject({ tempo: 112, key: 'A minor', bars: 4 });
    expect(s.tracks[0]!.notes).toEqual([{ pitch: 57, start: 0, length: 4, velocity: 0.8 }, { pitch: 60, start: 0, length: 4, velocity: 0.7 }]);
    expect(s.tracks[1]).toMatchObject({ name: 'Drums', muted: true });
    expect(s.tracks[1]!.notes.map((n) => n.start)).toEqual([0, 16]);
    expect(song('{"key":"H major"}').key).toBe('C major');
    expect(parseSong('{')).toHaveProperty('error');
  });

  it('write back what they read, one note to a line', () => {
    const s = song(FILE);
    const text = writeSong(s);
    expect(song(text)).toEqual(s);
    expect(text).toContain('\n      {"pitch":57,"start":0,"length":4,"velocity":0.8},\n');
    expect(song(writeSong({ ...s, tracks: [] })).tracks).toEqual([]);
  });

  it('know which tracks changed, which are heard, and the key', () => {
    const before = song(FILE);
    const after = song(FILE);
    after.tracks[1]!.muted = false;
    expect([...changedTracks(before, after)]).toEqual([]);
    after.tracks.push({ id: freshTrackId(after), name: 'Bass', instrument: 'bass', volume: 0.8, muted: false, solo: false, notes: [{ pitch: 45, start: 0, length: 1, velocity: 0.9 }] });
    expect([...changedTracks(before, after)]).toEqual(['t3']);
    expect(audible(before).map((t) => t.id)).toEqual(['t1']);
    expect(audible({ ...after, tracks: after.tracks.map((t) => ({ ...t, solo: t.id === 't3' })) }).map((t) => t.id)).toEqual(['t3']);
    expect(noteName(60)).toBe('C4');
    expect([...keyPitches('A minor')].sort((a, b) => a - b)).toEqual([0, 2, 4, 5, 7, 9, 11]);
    expect(keyPitches('Eb major').has(3)).toBe(true);
    expect(songSeconds(before)).toBeCloseTo(8.57, 1);
  });
});
