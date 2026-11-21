import { describe, expect, it } from 'vitest';
import { arpeggiate, chop, connect, fitKey, humanize, reverse, strum } from './note-transform';
import type { SongNote } from './song-format';

const n = (pitch: number, start: number, length = 1, velocity = 0.8): SongNote => ({ pitch, start, length, velocity });
const C = [n(60, 0, 2), n(64, 0, 2), n(67, 0, 2)];
const none = new Set<number>();

describe('the Transform tools', () => {
  it('arpeggiate plays a chord a grid step at a time, up, down or both, for as long as it lasted', () => {
    expect(arpeggiate(C, none, 0.5).notes.map((x) => [x.pitch, x.start, x.length])).toEqual([[60, 0, 0.5], [64, 0.5, 0.5], [67, 1, 0.5], [60, 1.5, 0.5]]);
    expect(arpeggiate(C, none, 0.5, 'down').notes.map((x) => x.pitch)).toEqual([67, 64, 60, 67]);
    expect(arpeggiate(C, none, 0.25, 'updown').notes.map((x) => x.pitch)).toEqual([60, 64, 67, 64, 60, 64, 67, 64]);
    // A lone note stays; what came of a pick stays picked.
    const r = arpeggiate([n(48, 0), ...C], new Set([1, 2, 3]), 1);
    expect(r.notes.map((x) => [x.pitch, x.start])).toEqual([[48, 0], [60, 0], [64, 1]]);
    expect([...r.picked]).toEqual([1, 2]);
  });

  it('strum spreads a chord from the bottom (or the top), each note ending where it did', () => {
    expect(strum(C, none, 0.125).notes.map((x) => [x.pitch, x.start, x.length])).toEqual([[60, 0, 2], [64, 0.125, 1.875], [67, 0.25, 1.75]]);
    expect(strum(C, none, 0.125, true).notes.map((x) => [x.pitch, x.start])).toEqual([[67, 0], [64, 0.125], [60, 0.25]]);
    // Never past a sixty-fourth of what is left.
    expect(strum([n(60, 0, 0.1), n(64, 0, 0.1)], none, 1).notes[1]!.length).toBe(0.063);
  });

  it('chop cuts long notes into grid steps and leaves short ones', () => {
    expect(chop([n(60, 0, 1.5), n(62, 2, 0.25)], none, 0.5).notes.map((x) => [x.start, x.length])).toEqual([[0, 0.5], [0.5, 0.5], [1, 0.5], [2, 0.25]]);
  });

  it('connect holds each note until the next starts, the last as it was', () => {
    expect(connect([n(60, 0, 0.25), n(64, 0, 0.5), n(62, 1, 0.25), n(65, 3, 0.5)], none).notes.map((x) => x.length)).toEqual([1, 1, 2, 0.5]);
  });

  it('humanize moves starts and velocities a little, the same way for the same seed, inside the song', () => {
    const notes = [n(60, 0), n(62, 1), n(64, 2), n(65, 3)];
    const a = humanize(notes, none, 4, 7).notes;
    expect(a).toEqual(humanize(notes, none, 4, 7).notes);
    expect(a).not.toEqual(notes);
    for (const x of a) {
      expect(x.start).toBeGreaterThanOrEqual(0);
      expect(x.start + x.length).toBeLessThanOrEqual(4);
      expect(Math.abs(x.velocity - 0.8)).toBeLessThanOrEqual(0.081);
    }
  });

  it('reverse plays the notes backwards across their span', () => {
    expect(reverse([n(60, 0, 1), n(62, 1, 0.5), n(64, 2, 2)], none).notes.map((x) => [x.pitch, x.start])).toEqual([[64, 0], [62, 2.5], [60, 3]]);
  });

  it('fit to key moves notes outside the key to the nearest one in it, down on a tie', () => {
    expect(fitKey([n(61, 0), n(63, 1), n(66, 2), n(60, 3)], none, 'C major').notes.map((x) => x.pitch)).toEqual([60, 62, 65, 60]);
    expect(fitKey([n(64, 0)], none, 'A minor').notes[0]!.pitch).toBe(64);
  });
});
