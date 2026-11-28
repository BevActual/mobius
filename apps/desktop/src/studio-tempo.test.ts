import { describe, expect, it } from 'vitest';
import { parseSong, songSeconds, writeSong, type Song } from './song-format';
import { beatAt, secondsAt, setTempoLine, tempoAt, tempoChanges, tempoLine } from './studio-tempo';

const song = (): Song => ({ version: 2, tempo: 100, key: 'C major', bars: 4, tracks: [] });

describe('tempo changes', () => {
  it('hold the song tempo with no line, and follow a line as the engine does: held, ramped, held', () => {
    const s = song();
    expect(tempoChanges(s)).toBe(false);
    expect(secondsAt(s, 4)).toBeCloseTo(2.4, 9);
    setTempoLine(s, [{ beat: 8, value: 60 }, { beat: 4, value: 120 }], 0.8);
    expect(tempoChanges(s)).toBe(true);
    expect([tempoAt(s, 2), tempoAt(s, 6), tempoAt(s, 20)]).toEqual([120, 90, 60]);
    const ramp = (60 / -15) * Math.log(0.5);
    expect(secondsAt(s, 4)).toBeCloseTo(2, 9);
    expect(secondsAt(s, 8)).toBeCloseTo(2 + ramp, 9);
    expect(secondsAt(s, 10)).toBeCloseTo(4 + ramp, 9);
    for (const b of [0, 1.3, 4, 5.5, 8, 12.25]) expect(beatAt(s, secondsAt(s, b))).toBeCloseTo(b, 9);
    // The song lasts as long as its sixteen beats take along the line.
    expect(songSeconds(s)).toBeCloseTo(2 + ramp + 8, 9);
  });

  it('is kept on the Main track in the file, in range, and taken away with its last point', () => {
    const s = song();
    setTempoLine(s, [{ beat: 0, value: 90 }, { beat: 8, value: 140 }], 0.8);
    const read = parseSong(writeSong(s));
    if (!('song' in read)) throw new Error(read.error);
    expect(tempoLine(read.song).map((p) => [p.beat, p.value])).toEqual([[0, 90], [8, 140]]);
    const wild = parseSong(JSON.stringify({ version: 2, tempo: 100, key: 'C major', bars: 4, tracks: [], main: { volume: 0.8, auto: { tempo: [{ beat: 0, value: 999 }] } } }));
    if (!('song' in wild)) throw new Error(wild.error);
    expect(tempoAt(wild.song, 0)).toBe(300);
    setTempoLine(read.song, [], 0.8);
    expect(read.song.main?.auto).toBeUndefined();
    expect(tempoChanges(read.song)).toBe(false);
  });
});
