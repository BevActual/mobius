import { describe, expect, it } from 'vitest';
import { parseSong, writeSong, type Song, type SongNote } from './song-format';
import { setRowLength, setRowStep, setRowStepExtra } from './studio-view';

const hit = (pitch: number, start: number, extra: Partial<SongNote> = {}): SongNote => ({ pitch, start, length: 0.25, velocity: 0.7, ...extra });
const starts = (notes: SongNote[], pitch: number) => notes.filter((n) => n.pitch === pitch).map((n) => n.start);

describe('step rows with lengths of their own (Live 13)', () => {
  it('repeats a row’s first steps through the clip, leaving the other rows', () => {
    const notes = [hit(36, 0), hit(36, 0.5), hit(36, 1), hit(36, 2.25), hit(38, 1)];
    const out = setRowLength(notes, 36, 3, 16);
    // Three steps long: steps 0 and 2 again at 3, 5, 6, 8, 9, 11, 12, 14, 15; what it had past them is gone.
    expect(starts(out, 36)).toEqual([0, 0.5, 0.75, 1.25, 1.5, 2, 2.25, 2.75, 3, 3.5, 3.75]);
    expect(starts(out, 38)).toEqual([1]);
  });

  it('sets a step in every pass of its row, wherever it is clicked, and its chance and repeat too', () => {
    let notes = setRowStep([], 36, 4, 0.7, 0.25, 3, 16);
    expect(starts(notes, 36)).toEqual([0.25, 1, 1.75, 2.5, 3.25]);
    notes = setRowStepExtra(notes, 36, 1, { chance: 0.5, repeat: 2 }, 3, 16);
    expect(notes.every((n) => n.chance === 0.5 && n.repeat === 2)).toBe(true);
    notes = setRowStep(notes, 36, 7, 0, 0.25, 3, 16);
    expect(notes).toEqual([]);
    // No length of its own: one step.
    expect(starts(setRowStep([], 36, 4, 0.7, 0.25, undefined, 16), 36)).toEqual([1]);
  });

  it('keeps each track’s row lengths in the song file, dropping ones that make no sense', () => {
    const song: Song = { version: 2, tempo: 120, key: 'C major', bars: 1, tracks: [{ id: 't', name: 'Drums', instrument: 'drums', volume: 0.8, pan: 0, muted: false, solo: false, color: 'blue', clips: [], stepRows: { 36: 3, 38: 5 } }] };
    const again = parseSong(writeSong(song));
    if (!('song' in again)) throw new Error('not read');
    expect(again.song.tracks[0]!.stepRows).toEqual({ 36: 3, 38: 5 });
    const odd = parseSong(JSON.stringify({ version: 2, tempo: 120, bars: 1, tracks: [{ id: 't', stepRows: { 36: 1, x: 4, 200: 4, 40: 'a', 42: 6.4 } }] }));
    if (!('song' in odd)) throw new Error('not read');
    expect(odd.song.tracks[0]!.stepRows).toEqual({ 42: 6 });
  });
});
