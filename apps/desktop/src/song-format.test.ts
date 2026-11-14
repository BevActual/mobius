import { describe, expect, it } from 'vitest';
import { audible, PAD_DEFAULTS, drumKit, EFFECT_PARAMS, freshEffectId, newEffect, nextColour, TRACK_COLOURS, changedTracks, freshTrackId, keyPitches, noteName, parseSong, songSeconds, writeSong, type Song } from './song-format';

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
    after.tracks.push({ id: freshTrackId(after), name: 'Bass', instrument: 'bass', volume: 0.8, pan: 0, muted: false, solo: false, color: 'blue', notes: [{ pitch: 45, start: 0, length: 1, velocity: 0.9 }] });
    expect([...changedTracks(before, after)]).toEqual(['t3']);
    expect(audible(before).map((t) => t.id)).toEqual(['t1']);
    expect(audible({ ...after, tracks: after.tracks.map((t) => ({ ...t, solo: t.id === 't3' })) }).map((t) => t.id)).toEqual(['t3']);
    expect(noteName(60)).toBe('C4');
    expect([...keyPitches('A minor')].sort((a, b) => a - b)).toEqual([0, 2, 4, 5, 7, 9, 11]);
    expect(keyPitches('Eb major').has(3)).toBe(true);
    expect(songSeconds(before)).toBeCloseTo(8.57, 1);
  });
});

describe('a track\'s sound', () => {
  it('is kept to its ranges, written back, and left out for drums', () => {
    const s = song(JSON.stringify({ tracks: [
      { id: 'a', instrument: 'pad', sound: { shape: 2, cutoff: 1200, attack: 0.84 }, notes: [] },
      { id: 'b', instrument: 'drums', sound: { shape: 0.5 }, notes: [] },
      { id: 'c', instrument: 'bass', notes: [] },
    ] }));
    expect(s.tracks[0]!.sound).toMatchObject({ shape: 1, cutoff: 1200, attack: 0.84, detune: 14 });
    expect(s.tracks[1]!.sound).toBeUndefined();
    expect(s.tracks[2]!.sound).toBeUndefined();
    expect(song(writeSong(s)).tracks[0]!.sound).toEqual(s.tracks[0]!.sound);
    expect(writeSong(s)).not.toContain('"sound":{"shape":0.5');
  });
});

describe('a track\'s colour', () => {
  it('is one of the shared content colours, by place when a file has none, and written back', () => {
    const s = song(JSON.stringify({ tracks: [{ id: 'a', notes: [] }, { id: 'b', color: 'coral', notes: [] }, { id: 'c', color: 'red', notes: [] }] }));
    expect(s.tracks.map((t) => t.color)).toEqual(['blue', 'coral', 'green']);
    expect(song(writeSong(s)).tracks.map((t) => t.color)).toEqual(['blue', 'coral', 'green']);
    expect(nextColour(s.tracks)).toBe('amber');
    expect(nextColour(TRACK_COLOURS.map((color) => ({ color })))).toBe(TRACK_COLOURS[TRACK_COLOURS.length % TRACK_COLOURS.length]);
  });
});

describe('a track\'s mix and instrument settings', () => {
  it('keeps pan, a full sound and a drum kit, filling settings an older file lacks from its instrument', () => {
    const s = song(JSON.stringify({ tracks: [
      { id: 'a', instrument: 'pad', pan: -0.4, sound: { shape: 0.3, cutoff: 900, attack: 0.5, release: 1 }, notes: [] },
      { id: 'b', instrument: 'drums', pan: 3, kit: { tune: 4, decay: 9 }, notes: [] },
      { id: 'c', instrument: 'piano', kit: { tune: 2 }, notes: [] },
    ] }));
    expect(s.tracks[0]!.pan).toBe(-0.4);
    expect(s.tracks[0]!.sound).toMatchObject({ shape: 0.3, cutoff: 900, sub: 0, decay: 0.3, sustain: 1, vibrato: 0, rate: 5 });
    expect(s.tracks[1]!.pan).toBe(1);
    expect(s.tracks[1]!.kit).toEqual({ tune: 4, decay: 2, tone: 0.5 });
    expect(s.tracks[2]!.kit).toBeUndefined();
    expect(s.tracks[2]!.pan).toBe(0);
    const again = song(writeSong(s));
    expect(again.tracks.map((t) => [t.pan, t.kit])).toEqual(s.tracks.map((t) => [t.pan, t.kit]));
    expect(again.tracks[0]!.sound).toEqual(s.tracks[0]!.sound);
    expect(writeSong(s)).not.toContain('"pan":0');
  });
});

describe('a track\'s instrument switch', () => {
  it('is kept only when the instrument is switched off', () => {
    const read = (t: object) => parseSong(JSON.stringify({ version: 1, tracks: [{ id: 't1', instrument: 'piano', notes: [], ...t }] }));
    const off = read({ instrumentOn: false });
    if (!('song' in off)) throw new Error('not read');
    expect(off.song.tracks[0]!.instrumentOn).toBe(false);
    expect(writeSong(off.song)).toContain('"instrumentOn":false');
    const on = read({ instrumentOn: true });
    if (!('song' in on)) throw new Error('not read');
    expect(on.song.tracks[0]!.instrumentOn).toBeUndefined();
    expect(writeSong(on.song)).not.toContain('instrumentOn');
  });
});

describe('a track\'s effects', () => {
  it('keeps known effects in order, kept to their ranges, and writes them back', () => {
    const s = song(JSON.stringify({ tracks: [
      { id: 'a', instrument: 'pad', fx: [
        { id: 'fx1', kind: 'delay', time: 9, feedback: 0.5 },
        { id: 'fx2', kind: 'wobble' },
        { id: 'fx3', kind: 'eq', low: -30, on: false },
      ], notes: [] },
      { id: 'b', instrument: 'bass', notes: [] },
    ] }));
    expect(s.tracks[0]!.fx).toEqual([
      { id: 'fx1', kind: 'delay', on: true, time: 2, feedback: 0.5, mix: EFFECT_PARAMS.delay.mix!.start },
      { id: 'fx3', kind: 'eq', on: false, low: -18, lowFreq: 120, mid: 0, midFreq: 1000, midQ: 1, high: 0, highFreq: 6000 },
    ]);
    expect(s.tracks[1]!.fx).toBeUndefined();
    expect(song(writeSong(s)).tracks[0]!.fx).toEqual(s.tracks[0]!.fx);
    expect(writeSong({ ...s, tracks: [s.tracks[1]!] })).not.toContain('"fx"');
  });
  it('starts a new effect from its defaults with the next free id', () => {
    const t = song(JSON.stringify({ tracks: [{ id: 'a', fx: [{ id: 'fx1', kind: 'reverb' }], notes: [] }] })).tracks[0]!;
    expect(freshEffectId(t)).toBe('fx2');
    expect(newEffect('compressor', 'fx2')).toEqual({ id: 'fx2', kind: 'compressor', on: true, threshold: -18, ratio: 4, attack: 0.01, release: 0.2, makeup: 0 });
  });
});

describe('a drum kit\'s pads', () => {
  it('keeps each drum\'s own settings, kept to their ranges, and leaves out drums at their defaults', () => {
    const s = song(JSON.stringify({ tracks: [
      { id: 'd', instrument: 'drums', pads: { 38: { tune: 3, pan: -2 }, 36: {}, 99: { tune: 1 } }, notes: [] },
      { id: 'p', instrument: 'piano', pads: { 38: { tune: 3 } }, notes: [] },
    ] }));
    expect(s.tracks[0]!.pads).toEqual({ 38: { tune: 3, decay: 1, level: 1, pan: -1 }, 36: PAD_DEFAULTS });
    expect(s.tracks[1]!.pads).toBeUndefined();
    const text = writeSong(s);
    expect(song(text).tracks[0]!.pads).toEqual({ 38: { tune: 3, decay: 1, level: 1, pan: -1 } });
    expect(drumKit({ tune: 2, decay: 1.5, tone: 0.5 }, { tune: 3, decay: 2, level: 1, pan: 0 })).toEqual({ tune: 5, decay: 3, tone: 0.5 });
  });
});
