import { describe, expect, it } from 'vitest';
import { parseSong, writeSong, type Groove, type Song, type SongNote } from './song-format';
import { GROOVE_LIBRARY, addGroove, commitGroove, extractGroove, grooveFrom, grooveNotes, grooveUses, removeGroove, roll } from './studio-groove';

const note = (start: number, velocity = 0.8): SongNote => ({ pitch: 60, start, length: 0.25, velocity });
const swing: Groove = { id: 's', name: 'Swing', base: 0.5, quantize: 0, timing: 1, random: 0, velocity: 0, length: 1, hits: [{ at: 0, velocity: 1 }, { at: 2 / 3, velocity: 0.6 }] };
const song = (): Song => ({ version: 2, tempo: 120, key: 'C major', bars: 1, tracks: [{ id: 't', name: 'T', instrument: 'piano', volume: 0.8, pan: 0, muted: false, solo: false, color: 'blue', clips: [{ id: 'c1', start: 0, length: 4, notes: [note(0.5), note(1)] }], slots: [{ name: 'A', bars: 1, notes: [note(1.5)] }, null] }] });

describe('grooves (Live 12, 14)', () => {
  it('moves notes toward the groove, as the engine does, and leaves its grid notes', () => {
    const out = grooveNotes([note(0), note(0.5), note(1.5)], swing);
    expect(out.map((n) => n.start.toFixed(9))).toEqual(['0.000000000', '0.666666667', '1.666666667']);
    expect(grooveNotes([note(0.5)], { ...swing, timing: 0.5 })[0]!.start).toBeCloseTo(0.5 + 1 / 12, 9);
    // Global Amount, up to 130%.
    expect(grooveNotes([note(0.5)], swing, 2)[0]!.start).toBeCloseTo(0.5 + 1.3 / 6, 9);
    expect(grooveNotes([note(0.5)], swing, 0)[0]!.start).toBe(0.5);
  });

  it('quantizes first, follows velocity either way, and pushes notes the same random way each time', () => {
    expect(grooveNotes([note(0.6)], { ...swing, quantize: 1, timing: 0 })[0]!.start).toBeCloseTo(0.5, 9);
    const loud = grooveNotes([note(0, 0.5), note(0.5, 0.5)], { ...swing, velocity: 1, timing: 0 });
    expect(loud.map((n) => n.velocity.toFixed(3))).toEqual(['0.700', '0.300']);
    const turned = grooveNotes([note(0, 0.5), note(0.5, 0.5)], { ...swing, velocity: -1, timing: 0 });
    expect(turned.map((n) => n.velocity.toFixed(3))).toEqual(['0.300', '0.700']);
    const notes = Array.from({ length: 16 }, (_, k) => note(k * 0.5));
    const a = grooveNotes(notes, { ...swing, random: 1, timing: 0 });
    expect(a).toEqual(grooveNotes(notes, { ...swing, random: 1, timing: 0 }));
    expect(a.every((n, k) => Math.abs(n.start - notes[k]!.start) <= 0.125 + 1e-9)).toBe(true);
    // The same roll as the engine's (groove.rs `roll_matches_studio_groove`).
    expect([roll(60, 0.5), roll(36, 1.25)]).toEqual([0.5307444930076599, 0.4368025064468384]);
  });

  it('builds swing from the library, adds and removes it from the pool, and counts the clips using it', () => {
    const g = grooveFrom(GROOVE_LIBRARY.find((t) => t.name === 'Swing 8ths 66')!, 'x');
    expect(g.hits.slice(0, 2).map((h) => h.at)).toEqual([0, 2 / 3]);
    const s = song();
    const id = addGroove(s, g)!;
    s.tracks[0]!.clips[0]!.groove = id;
    s.tracks[0]!.slots![0]!.groove = id;
    expect(grooveUses(s, id)).toBe(2);
    removeGroove(s, id);
    expect(s.grooves).toBeUndefined();
    expect(s.tracks[0]!.clips[0]!.groove).toBeUndefined();
  });

  it('commits a groove into the notes and sets the clip to None; extracts a groove from a clip', () => {
    const s = song();
    const id = addGroove(s, swing)!;
    const clip = s.tracks[0]!.clips[0]!;
    clip.groove = id;
    expect(commitGroove(s, clip, 4)).toBe(true);
    expect(clip.groove).toBeUndefined();
    expect(clip.notes.map((n) => n.start)).toEqual([0.666667, 1]);
    expect(commitGroove(s, clip, 4)).toBe(false);
    const ex = extractGroove('Keys', [note(0, 1), note(0, 0.5), note(0.7, 0.6), note(9)], 4);
    expect(ex).toMatchObject({ name: 'Keys Groove', length: 4, base: 0.25, hits: [{ at: 0, velocity: 1 }, { at: 0.7, velocity: 0.6 }] });
  });

  it('reads and writes the pool, Global Amount and each clip’s groove, dropping a groove that is not there', () => {
    const s = song();
    const id = addGroove(s, grooveFrom(GROOVE_LIBRARY[0]!, ''))!;
    s.grooveAmount = 1.2;
    s.tracks[0]!.clips[0]!.groove = id;
    s.tracks[0]!.slots![0]!.groove = 'gone';
    const again = parseSong(writeSong(s));
    if (!('song' in again)) throw new Error('not read');
    expect(again.song.grooves).toEqual(s.grooves);
    expect(again.song.grooveAmount).toBe(1.2);
    expect(again.song.tracks[0]!.clips[0]!.groove).toBe(id);
    expect(again.song.tracks[0]!.slots![0]!.groove).toBeUndefined();
  });
});
