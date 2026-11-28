import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { parseSong, writeSong, type SongNote } from './song-format';
import { setChance, setStep, setStepExtra, stepMark, stepNotes } from './studio-view';
import { StepGrid } from './ui/Instrument';

const hit = (start: number, extra: Partial<SongNote> = {}): SongNote => ({ pitch: 36, start, length: 0.25, velocity: 0.8, ...extra });

describe("a note's chance (Live 12) and a step's repeat (Live 13)", () => {
  it('sets chance on picked notes and leaves full chance out', () => {
    const notes = [hit(0), hit(1)];
    const half = setChance(notes, new Set([1]), 0.5);
    expect(half[1]).toEqual(hit(1, { chance: 0.5 }));
    expect(half[0]).toEqual(hit(0));
    expect(setChance(half, new Set([1]), 1)[1]).toEqual(hit(1));
  });

  it("sets a step's repeat and chance, keeps them when its velocity changes, and marks it", () => {
    let notes = setStep([], 0, 36, 2, 0.7);
    notes = setStepExtra(notes, 0, 36, 2, { repeat: 3 });
    notes = setStepExtra(notes, 0, 36, 2, { chance: 0.25 });
    expect(notes).toEqual([{ pitch: 36, start: 0.5, length: 0.25, velocity: 0.7, repeat: 3, chance: 0.25 }]);
    notes = setStep(notes, 0, 36, 2, 1);
    expect(notes[0]).toMatchObject({ velocity: 1, repeat: 3, chance: 0.25 });
    const row = stepNotes(notes, 0, [36])[0]!;
    expect(row.map(stepMark)[2]).toBe('×3 25%');
    expect(stepMark(row[0]!)).toBe('');
    expect(setStepExtra(notes, 0, 36, 2, { repeat: 1, chance: 1 })[0]).toEqual({ pitch: 36, start: 0.5, length: 0.25, velocity: 1 });
  });

  it('reads and writes chance and repeat, keeping them in range', () => {
    const text = JSON.stringify({ version: 2, tempo: 120, bars: 1, tracks: [{ id: 'd', instrument: 'drums', clips: [{ id: 'c', start: 0, length: 4, notes: [{ pitch: 36, start: 0, length: 1, velocity: 1, chance: 0.333, repeat: 12 }, { pitch: 38, start: 1, length: 1, velocity: 1, chance: 1, repeat: 1 }] }] }] });
    const parsed = parseSong(text);
    if (!('song' in parsed)) throw new Error('not read');
    const notes = parsed.song.tracks[0]!.clips[0]!.notes;
    expect(notes[0]).toMatchObject({ chance: 0.33, repeat: 8 });
    expect(notes[1]!.chance).toBeUndefined();
    expect(notes[1]!.repeat).toBeUndefined();
    const again = parseSong(writeSong(parsed.song));
    if (!('song' in again)) throw new Error('not read again');
    expect(again.song.tracks[0]!.clips[0]!.notes).toEqual(notes);
  });

  it('shows a step mark and reads it out with the step', () => {
    const html = renderToStaticMarkup(createElement(StepGrid, { rows: [{ id: '36', name: 'Kick' }], cells: [[0.8, 0]], steps: 2, marks: [['×2 50%', '']], onChange: () => {} }));
    expect(html).toContain('Kick, step 1, velocity 102, repeat 2, 50% chance');
    expect(html).toContain('ui-step-mark');
  });
});
