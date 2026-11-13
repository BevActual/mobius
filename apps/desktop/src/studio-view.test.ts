import { describe, expect, it } from 'vitest';
import { addNote, cycleOf, fitTracks, songBeat, nudgeVelocity, duplicateNotes, moveNotes, notesIn, pasteNotes, position, quantizeNotes, removeNotes, setVelocity, snap, stretchNotes } from './studio-view';

const n = (pitch: number, start: number, length = 1, velocity = 0.8) => ({ pitch, start, length, velocity });
const notes = [n(57, 0, 4), n(60, 0, 4), n(64, 4)];

describe('editing notes on the roll', () => {
  it('snaps to the grid', () => {
    expect(snap(4.13, 0.25)).toBe(4);
    expect(snap(1.99, 1)).toBe(1);
  });
  it('moves picked notes together, stopping at the edges, and finds them again after sorting', () => {
    const out = moveNotes(notes, new Set([2]), -5, 2, 16);
    expect(out.notes).toEqual([n(57, 0, 4), n(60, 0, 4), n(66, 4)].map((x, i) => (i === 2 ? { ...x, start: 0 } : x)).sort((a, b) => a.start - b.start || a.pitch - b.pitch));
    expect([...out.picked].map((i) => out.notes[i]!.pitch)).toEqual([66]);
    const chord = moveNotes(notes, new Set([0, 1]), 20, 0, 16);
    expect(chord.notes.filter((x) => x.length === 4).map((x) => x.start)).toEqual([12, 12]);
  });
  it('stretches, removes, adds and sets loudness', () => {
    expect(stretchNotes(notes, new Set([2]), 20, 16).notes[2]).toEqual(n(64, 4, 12));
    expect(removeNotes(notes, new Set([0, 1]))).toEqual([n(64, 4)]);
    const added = addNote(notes, n(62, 2));
    expect(added.notes.map((x) => x.pitch)).toEqual([57, 60, 62, 64]);
    expect([...added.picked]).toEqual([2]);
    expect(addNote(notes, n(64, 4)).notes).toHaveLength(3);
    expect(setVelocity(notes, new Set([2]), 1.4)[2]!.velocity).toBe(1);
  });
  it('duplicates after itself on the next bar, and pastes at a beat', () => {
    const d = duplicateNotes(notes, new Set([0, 1]), 16);
    expect(d.notes.filter((x) => x.length === 4).map((x) => x.start)).toEqual([0, 0, 4, 4]);
    expect(d.picked.size).toBe(2);
    const one = duplicateNotes([n(60, 0, 0.5)], new Set([0]), 16);
    expect(one.notes.map((x) => x.start)).toEqual([0, 0.5]);
    const p = pasteNotes(notes, [n(70, 2), n(72, 3)], 8, 16);
    expect(p.notes.slice(-2).map((x) => x.start)).toEqual([8, 9]);
  });
  it('quantizes to the grid', () => {
    const q = quantizeNotes([n(60, 0.13, 0.9), n(62, 1.6, 0.2)], new Set(), 0.5, 16);
    expect(q.notes).toEqual([n(60, 0, 1), n(62, 1.5, 0.5)]);
  });
  it('picks the notes inside a box', () => {
    expect([...notesIn(notes, 3, 5, 59, 70)]).toEqual([1, 2]);
  });
  it('shows the position as bars and time', () => {
    expect(position(0, 120)).toEqual({ bars: '1.1.1', time: '0:00.0' });
    expect(position(5.5, 120)).toEqual({ bars: '2.2.3', time: '0:02.8' });
  });
});

describe('velocity lane and track list', () => {
  it('nudges picked notes by the same amount, keeping each between 0 and 1', () => {
    const vs = [n(60, 0, 1, 0.5), n(62, 1, 1, 0.95), n(64, 2, 1, 0.1)];
    expect(nudgeVelocity(vs, new Set([0, 1]), 0.1).map((x) => x.velocity)).toEqual([0.6, 1, 0.1]);
    expect(nudgeVelocity(vs, new Set([2]), -0.5)[2]!.velocity).toBe(0);
  });
  it('fits the track list to its tracks', () => {
    expect(fitTracks(4)).toBe(24 + 4 * 49);
    expect(fitTracks(0)).toBe(24 + 49);
  });
});

describe('the loop', () => {
  const cycle = { from: 8, to: 16 };
  it('goes round the loop, running into it from before and starting at it from after', () => {
    expect(songBeat(3, 0, null)).toBe(3);
    expect(songBeat(10, 0, cycle)).toBe(10);
    expect(songBeat(17, 0, cycle)).toBe(9);
    expect(songBeat(0, 20, cycle)).toBe(8);
    expect(songBeat(9, 12, cycle)).toBe(13);
  });
  it('is whole bars between the two picked on the ruler, inside the song', () => {
    expect(cycleOf(3, 1, 8)).toEqual({ from: 4, to: 16 });
    expect(cycleOf(2, 2, 8)).toEqual({ from: 8, to: 12 });
    expect(cycleOf(-2, 20, 8)).toEqual({ from: 0, to: 32 });
  });
});
