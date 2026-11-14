import { describe, expect, it } from 'vitest';
import { recordedNote, splitNotes, joinNotes, keyboardPitch, keyboardDrum, nudgeKeyVelocity, spellIn, scaleRows, stepOctave, addNote, clipHits, nextBar, clipsOf, setStep, stepCells, effectText, eqBands, eqFromBand, fromSlider, kitText, panText, soundText, toSlider, cycleOf, fitTracks, songBeat, nudgeVelocity, duplicateNotes, moveNotes, notesIn, pasteNotes, position, quantizeNotes, removeNotes, setVelocity, snap, stretchNotes } from './studio-view';

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

describe('the arrangement and the Device panel', () => {
  const n = (start: number, length = 1) => ({ pitch: 60, start, length, velocity: 0.8 });
  it('groups notes into clips, split where a whole bar is empty', () => {
    expect(clipsOf([n(0), n(5), n(16), n(19.5, 2)], 8)).toEqual([{ from: 0, to: 2 }, { from: 4, to: 6 }]);
    expect(clipsOf([], 4)).toEqual([]);
    // A note that ends on a bar line does not reach into the next bar.
    expect(clipsOf([n(0, 4)], 4)).toEqual([{ from: 0, to: 1 }]);
  });
  it('writes each setting as the panel shows it', () => {
    expect(soundText('shape', 0.35)).toBe('35%');
    expect(soundText('detune', 12)).toBe('12 ct');
    expect(soundText('cutoff', 1200)).toBe('1.2 kHz');
    expect(soundText('cutoff', 700)).toBe('700 Hz');
    expect(soundText('attack', 0.84)).toBe('840 ms');
    expect(soundText('release', 2.1)).toBe('2.1 s');
  });
  it('moves cutoff along its slider in octaves, and back', () => {
    expect(toSlider(80, 80, 12000, true)).toBe(0);
    expect(fromSlider(1, 80, 12000, true)).toBe(12000);
    expect(fromSlider(toSlider(1200, 80, 12000, true), 80, 12000, true)).toBeCloseTo(1200, 0);
    expect(fromSlider(0.5, 0, 50, false)).toBe(25);
  });
});

describe('the Device panel\'s words for a setting', () => {
  it('names times, rates, cents, pan and the kit as a player reads them', () => {
    expect(soundText('decay', 0.25)).toBe('250 ms');
    expect(soundText('rate', 5)).toBe('5.0 Hz');
    expect(soundText('vibrato', 12.4)).toBe('12 ct');
    expect(soundText('sustain', 0.3)).toBe('30%');
    expect([panText(0), panText(-0.4), panText(0.25)]).toEqual(['C', 'L 40', 'R 25']);
    expect([kitText('tune', 3), kitText('tune', -2), kitText('tune', 0)]).toEqual(['+3 st', '−2 st', '0 st']);
    expect([kitText('decay', 1.5), kitText('decay', 1)]).toEqual(['1.5×', '1×']);
  });
});

describe('the Device panel\'s words for an effect', () => {
  it('names gains, frequencies, ratios, times and mixes', () => {
    expect([effectText('eq', 'low', 3), effectText('eq', 'high', -4.5), effectText('eq', 'mid', 0)]).toEqual(['+3.0 dB', '−4.5 dB', '0.0 dB']);
    expect([effectText('eq', 'midFreq', 1000), effectText('eq', 'midFreq', 450)]).toEqual(['1.0 kHz', '450 Hz']);
    expect([effectText('compressor', 'threshold', -18), effectText('compressor', 'ratio', 4), effectText('compressor', 'attack', 0.01)]).toEqual(['−18 dB', '4:1', '10 ms']);
    expect([effectText('reverb', 'size', 2), effectText('delay', 'mix', 0.25)]).toEqual(['2.0 s', '25%']);
  });
});

describe('a track EQ on the graph', () => {
  it('is three bands, and a moved band comes back as the EQ\'s settings, kept to their ranges', () => {
    const eq = { id: 'fx1', kind: 'eq' as const, on: true, low: 2, lowFreq: 120, mid: -3, midFreq: 1000, midQ: 1, high: 0, highFreq: 6000 };
    expect(eqBands(eq).map((b) => [b.type, b.freq, b.gain])).toEqual([['lowshelf', 120, 2], ['peak', 1000, -3], ['highshelf', 6000, 0]]);
    expect(eqFromBand(1, { type: 'peak', freq: 450, gain: 30, q: 2 })).toEqual({ mid: 18, midFreq: 450, midQ: 2 });
    expect(eqFromBand(0, { type: 'lowshelf', freq: 5, gain: -4, q: 0.7 })).toEqual({ low: -4, lowFreq: 30 });
    expect(eqFromBand(2, { type: 'highshelf', freq: 9000, gain: 1.5, q: 0.7 })).toEqual({ high: 1.5, highFreq: 9000 });
  });
});

describe('drum steps', () => {
  const hits = [{ pitch: 36, start: 4, length: 0.25, velocity: 0.9 }, { pitch: 38, start: 5, length: 0.25, velocity: 0.7 }, { pitch: 36, start: 0, length: 1, velocity: 0.8 }];
  it('reads a bar of hits as steps, one row per drum', () => {
    const cells = stepCells(hits, 1, [36, 38]);
    expect(cells[0]![0]).toBe(0.9);
    expect(cells[1]![4]).toBe(0.7);
    expect(cells.flat().filter(Boolean)).toHaveLength(2);
  });
  it('switches a step on, changes it, and off again', () => {
    const on = setStep(hits, 1, 38, 2, 1);
    expect(on.find((n) => n.pitch === 38 && n.start === 4.5)).toEqual({ pitch: 38, start: 4.5, length: 0.25, velocity: 1 });
    expect(setStep(on, 1, 38, 2, 0.5).filter((n) => n.start === 4.5)).toHaveLength(1);
    expect(setStep(on, 1, 38, 2, 0)).toEqual(setStep(hits, 9, 99, 0, 0));
  });
});

describe('a clip in the Session view', () => {
  const notes = [{ start: 0 }, { start: 2 }];
  it('goes round its own length from where it was launched', () => {
    expect(clipHits(notes, 4, 8, 8, 16).map((h) => h.at)).toEqual([8, 10, 12, 14]);
    // Asked for partway round: only the hits still to come, at their place in the loop.
    expect(clipHits(notes, 4, 8, 13, 18).map((h) => h.at)).toEqual([14, 16]);
    expect(clipHits(notes, 4, 8, 4, 8)).toEqual([]);
  });
  it('lands a launch on the next bar line', () => {
    expect(nextBar(0)).toBe(0);
    expect(nextBar(0.5)).toBe(4);
    expect(nextBar(4)).toBe(4);
    expect(nextBar(7.99)).toBe(8);
  });
});

describe('a melody as steps', () => {
  it('has a row per note of the key, high to low, from the C of the octave picked', () => {
    const aMinor = new Set([9, 11, 0, 2, 4, 5, 7]);
    const rows = scaleRows(aMinor, 4, 8);
    expect(rows).toEqual([72, 71, 69, 67, 65, 64, 62, 60]);
  });
  it('opens on the octave its notes sit in most', () => {
    expect(stepOctave([], 2)).toBe(2);
    expect(stepOctave([{ pitch: 45, start: 0, length: 1, velocity: 1 }, { pitch: 64, start: 0, length: 1, velocity: 1 }, { pitch: 60, start: 1, length: 1, velocity: 1 }], 2)).toBe(4);
  });
  it('names its rows as the key spells them', () => {
    expect(spellIn(70, 'F major')).toBe('B♭4');
    expect(spellIn(70, 'B major')).toBe('A♯4');
    expect(spellIn(60, 'A minor')).toBe('C4');
  });
  it('writes a step as long as asked', () => {
    expect(setStep([], 0, 60, 4, 0.8, 0.5)).toEqual([{ pitch: 60, start: 1, length: 0.5, velocity: 0.8 }]);
  });
});

describe('the computer keyboard as an instrument', () => {
  it('plays white keys on the middle row and black keys above, from the octave\'s C', () => {
    expect(keyboardPitch('a', 4)).toBe(60);
    expect(keyboardPitch('W', 4)).toBe(61);
    expect(keyboardPitch('k', 4)).toBe(72);
    expect(keyboardPitch(';', 3)).toBe(64);
    expect(keyboardPitch('q', 4)).toBeNull();
  });
  it('plays the drums from the kick up on the white keys', () => {
    expect(keyboardDrum('a', [36, 38, 39])).toBe(36);
    expect(keyboardDrum('d', [36, 38, 39])).toBe(39);
    expect(keyboardDrum('f', [36, 38, 39])).toBeNull();
    expect(keyboardDrum('w', [36, 38, 39])).toBeNull();
  });
  it('moves velocity in steps, kept in range', () => {
    expect(nudgeKeyVelocity(100, 1)).toBe(120);
    expect(nudgeKeyVelocity(120, 1)).toBe(127);
    expect(nudgeKeyVelocity(10, -1)).toBe(1);
  });
});

describe('splitNotes and joinNotes', () => {
  const n = (pitch: number, start: number, length: number) => ({ pitch, start, length, velocity: 0.8 });
  it('cuts a picked note at the playhead inside it, or on the grid at its middle', () => {
    expect(splitNotes([n(60, 0, 2)], new Set([0]), 0.5, 0.25).notes).toEqual([n(60, 0, 0.5), n(60, 0.5, 1.5)]);
    expect(splitNotes([n(60, 0, 2)], new Set([0]), 8, 0.25).notes).toEqual([n(60, 0, 1), n(60, 1, 1)]);
    const r = splitNotes([n(60, 0, 2), n(62, 0, 1)], new Set([0]), 8, 0.25);
    expect(r.notes).toHaveLength(3);
    expect(r.picked.size).toBe(2);
  });
  it('leaves a note too short to cut', () => {
    expect(splitNotes([n(60, 0, 0.25)], new Set([0]), 8, 0.25).notes).toEqual([n(60, 0, 0.25)]);
  });
  it('joins picked notes of a pitch from the first start to the last end', () => {
    const r = joinNotes([n(60, 0, 0.5), n(60, 1, 0.5), n(62, 0, 1), n(60, 3, 1)], new Set([0, 1, 2]));
    expect(r.notes).toEqual([n(60, 0, 1.5), n(62, 0, 1), n(60, 3, 1)]);
    expect([...r.picked].sort()).toEqual([0, 1]);
  });
});

describe('recordedNote', () => {
  const held = { pitch: 60, start: 2.5, velocity: 0.8 };
  it('runs from the press to the release', () => {
    expect(recordedNote(held, 3.25, null, 16)).toEqual({ pitch: 60, start: 2.5, length: 0.75, velocity: 0.8 });
  });
  it('ends at the loop end when the loop went round while held', () => {
    expect(recordedNote({ ...held, start: 7.5 }, 0.5, { from: 0, to: 8 }, 16)).toMatchObject({ start: 7.5, length: 0.5 });
  });
  it('is at least a 1/64 note, never past the end, and nothing past the end', () => {
    expect(recordedNote(held, 2.5, null, 16)!.length).toBe(0.063);
    expect(recordedNote({ ...held, start: 15.5 }, 20, null, 16)!.length).toBe(0.5);
    expect(recordedNote({ ...held, start: 16 }, 17, null, 16)).toBeNull();
  });
});
