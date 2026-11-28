import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { readSampler, putNotes, trackNotes, SOUND_RANGE, autoValueAt, bend, readAuto, writeSong as writeSongForAuto, sceneCount, sceneName, audible, PAD_DEFAULTS, drumKit, EFFECT_PARAMS, freshEffectId, newEffect, newStack, nextColour, TRACK_COLOURS, changedTracks, freshTrackId, keyPitches, noteName, parseSong, songSeconds, writeSong, ownAt, firstPass, type Song, soundOf, stringOf, STRING_DEFAULTS, malletOf, MALLET_DEFAULTS, electricOf, ELECTRIC_DEFAULTS, wavetableOf, WAVETABLE_DEFAULTS, barBeats, meterOf } from './song-format';

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
    expect(trackNotes(s.tracks[0]!)).toEqual([{ pitch: 57, start: 0, length: 4, velocity: 0.8 }, { pitch: 60, start: 0, length: 4, velocity: 0.7 }]);
    expect(s.tracks[1]).toMatchObject({ name: 'Drums', muted: true });
    // A note at the song's very end has no bar to sit in, so it is not kept.
    expect(trackNotes(s.tracks[1]!).map((n) => n.start)).toEqual([0]);
    expect(song('{"key":"H major"}').key).toBe('C major');
    expect(parseSong('{')).toHaveProperty('error');
  });

  it('write back what they read, one note to a line', () => {
    const s = song(FILE);
    const text = writeSong(s);
    expect(song(text)).toEqual(s);
    expect(text).toContain('\n        {"pitch":57,"start":0,"length":4,"velocity":0.8},\n');
    expect(song(writeSong({ ...s, tracks: [] })).tracks).toEqual([]);
  });

  it('know which tracks changed, which are heard, and the key', () => {
    const before = song(FILE);
    const after = song(FILE);
    after.tracks[1]!.muted = false;
    expect([...changedTracks(before, after)]).toEqual([]);
    after.tracks.push({ id: freshTrackId(after), name: 'Bass', instrument: 'bass', volume: 0.8, pan: 0, muted: false, solo: false, color: 'blue', clips: [{ id: 'c1', start: 0, length: 4, notes: [{ pitch: 45, start: 0, length: 1, velocity: 0.9 }] }] });
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

describe('the Session view\'s clips', () => {
  it('keeps clips in their slots, kept to a clip\'s lengths and to their notes inside it, and scene names', () => {
    const read = parseSong(JSON.stringify({ version: 1, scenes: ['Verse', '', 'Chorus'], tracks: [{ id: 't1', instrument: 'bass', name: 'Bass', notes: [], slots: [null, { bars: 3, notes: [{ pitch: 40, start: 1, length: 1 }, { pitch: 41, start: 9, length: 1 }] }, null, 'nonsense'] }] }));
    if (!('song' in read)) throw new Error('not read');
    const t = read.song.tracks[0]!;
    expect(t.slots).toEqual([null, { name: 'Bass', bars: 2, notes: [{ pitch: 40, start: 1, length: 1, velocity: 0.8 }] }]);
    expect(sceneCount(read.song)).toBe(4);
    expect([0, 1, 2, 3].map((i) => sceneName(read.song, i))).toEqual(['Verse', '2', 'Chorus', '4']);
    const again = parseSong(writeSong(read.song));
    if (!('song' in again)) throw new Error('not read');
    expect(again.song).toEqual(read.song);
  });
  it('leaves slots out of a song with no clips', () => {
    const read = parseSong(JSON.stringify({ version: 1, tracks: [{ id: 't1', instrument: 'bass', notes: [], slots: [null, null] }] }));
    if (!('song' in read)) throw new Error('not read');
    expect(read.song.tracks[0]!.slots).toBeUndefined();
    expect(writeSong(read.song)).not.toContain('slots');
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
  it('keeps a compressor\'s or device\'s sidechain, in range, and leaves its defaults out', () => {
    const s = song(JSON.stringify({ tracks: [{ id: 'a', notes: [], fx: [
      { id: 'c', kind: 'compressor', sidechain: { track: 'kick', gain: 40, mix: 0.5 } },
      { id: 'd', kind: 'compressor', sidechain: { track: 'kick', gain: 0, mix: 1 } },
      { id: 'e', kind: 'compressor', sidechain: { gain: 3 } },
      { id: 'r', kind: 'reverb', sidechain: { track: 'kick' } },
    ] }] }));
    const fx = s.tracks[0]!.fx as { sidechain?: unknown }[];
    expect(fx.map((e) => e.sidechain)).toEqual([{ track: 'kick', gain: 24, mix: 0.5 }, { track: 'kick' }, undefined, undefined]);
    expect(song(writeSong(s)).tracks[0]!.fx).toEqual(s.tracks[0]!.fx);
  });
  it('keeps the gate, limiter, saturator, auto filter, chorus and phaser, in range, with a keyed gate', () => {
    const s = song(JSON.stringify({ tracks: [{ id: 'a', notes: [], fx: [
      { id: 'g', kind: 'gate', threshold: -100, hold: 0.2, sidechain: { track: 'kick' } },
      { id: 'l', kind: 'limiter', ceiling: 3 },
      { id: 's', kind: 'saturator', drive: 12, shape: 0.5 },
      { id: 'f', kind: 'autofilter', filter: 'highpass', shape: 'wobble', depth: 800 },
      { id: 'c', kind: 'chorus', sidechain: { track: 'kick' } },
      { id: 'p', kind: 'phaser', center: 1200 },
    ] }] }));
    const fx = s.tracks[0]!.fx!;
    expect(fx.map((e) => e.kind)).toEqual(['gate', 'limiter', 'saturator', 'autofilter', 'chorus', 'phaser']);
    expect(fx[0]).toMatchObject({ threshold: -80, return: 3, hold: 0.2, floor: -90, sidechain: { track: 'kick' } });
    expect(fx[1]).toMatchObject({ gain: 0, ceiling: 0, release: 0.05 });
    expect(fx[2]).toMatchObject({ drive: 12, shape: 0.5, output: 0, mix: 1 });
    expect(fx[3]).toMatchObject({ filter: 'highpass', shape: 'sine', cutoff: 1000, depth: 800 });
    expect(fx[4]).not.toHaveProperty('sidechain');
    expect(fx[5]).toMatchObject({ center: 1200, rate: 0.5, depth: 600, mix: 0.5 });
    expect(song(writeSong(s)).tracks[0]!.fx).toEqual(fx);
    expect(newEffect('autofilter', 'fx9')).toMatchObject({ filter: 'lowpass', shape: 'sine', cutoff: 1000 });
    // Fractions of a millisecond survive a save: a chorus's depth, a gate's attack.
    const fine = song(JSON.stringify({ tracks: [{ id: 'a', notes: [], fx: [{ id: 'c', kind: 'chorus', depth: 0.0045 }, { id: 'g', kind: 'gate', attack: 0.0004 }] }] }));
    expect(song(writeSong(fine)).tracks[0]!.fx).toMatchObject([{ depth: 0.0045 }, { attack: 0.0004 }]);
  });
  it('keeps Chorus-Ensemble\'s mode, feedback, invert and high-pass, in range, and an old chorus as it sounded', () => {
    const s = song(JSON.stringify({ tracks: [{ id: 'a', notes: [], fx: [
      { id: 'c', kind: 'chorus', mode: 'vibrato', feedback: 2, invert: true, highpass: 5000 },
      { id: 'd', kind: 'chorus', mode: 'ensemble', delay: 0.02, invert: 'yes' },
      { id: 'e', kind: 'chorus', mode: 'vibrato', delay: 0.008 },
    ] }] }));
    const fx = s.tracks[0]!.fx!;
    // A Vibrato with no delay, rate or depth of its own starts where the engine's Vibrato does.
    expect(fx[0]).toMatchObject({ mode: 'vibrato', feedback: 0.95, invert: true, highpass: 2000, delay: 0.005, rate: 5, depth: 0.002 });
    // An unknown mode is a Chorus; a setting that isn't on or off is off. Nothing new is switched on.
    expect(fx[1]).toMatchObject({ mode: 'chorus', delay: 0.02, rate: 0.8, depth: 0.003, feedback: 0, invert: false, highpass: 0, mix: 0.5 });
    expect(fx[2]).toMatchObject({ mode: 'vibrato', delay: 0.008, rate: 5 });
    expect(song(writeSong(s)).tracks[0]!.fx).toEqual(fx);
    expect(newEffect('chorus', 'fx9')).toMatchObject({ mode: 'chorus', feedback: 0, invert: false, highpass: 0 });
  });
  it('keeps Beat Repeat, its sixteenths and its mix mode, in range', () => {
    const s = song(JSON.stringify({ tracks: [{ id: 'a', notes: [], fx: [
      { id: 'r', kind: 'beatrepeat', interval: 4, grid: 2 / 3, gate: 200, chance: 0.5, volume: -6, mix: 'insert' },
      { id: 'q', kind: 'beatrepeat', mix: 'stutter' },
    ] }] }));
    const fx = s.tracks[0]!.fx!;
    expect(fx[0]).toMatchObject({ kind: 'beatrepeat', interval: 4, offset: 0, grid: 0.666667, gate: 64, chance: 0.5, decay: 0, volume: -6, mix: 'insert' });
    expect(fx[1]).toMatchObject({ interval: 16, grid: 2, gate: 8, chance: 1, mix: 'mix' });
    expect(song(writeSong(s)).tracks[0]!.fx).toEqual(fx);
    expect(newEffect('beatrepeat', 'fx9')).toMatchObject({ interval: 16, offset: 0, gate: 8, grid: 2, chance: 1, decay: 0, volume: 0, mix: 'mix' });
  });
  it('keeps an instrument stack\'s chains, zones in range and in order, and leaves its defaults out', () => {
    const s = song(JSON.stringify({ tracks: [{ id: 'a', instrument: 'pad', notes: [], stack: { chains: [
      { instrument: 'bass', keys: { low: 0, high: 59 }, volume: 1, pan: 0 },
      { instrument: 'lead', keys: { low: 200, high: 60 }, velocities: { low: 0, high: 127 }, volume: 3, pan: -0.5, muted: true, sound: { cutoff: 99999 } },
      { instrument: 'nope', keys: { low: 0, high: 127 } },
    ] } }, { id: 'b', notes: [], stack: { chains: [] } }] }));
    expect(s.tracks[0]!.stack!.chains).toEqual([
      { instrument: 'bass', keys: { low: 0, high: 59 } },
      expect.objectContaining({ instrument: 'lead', keys: { low: 60, high: 127 }, volume: 2, pan: -0.5, muted: true, sound: expect.objectContaining({ cutoff: 12000 }) }),
      { instrument: 'piano' },
    ]);
    expect(s.tracks[1]!.stack).toBeUndefined();
    expect(song(writeSong(s)).tracks[0]!.stack).toEqual(s.tracks[0]!.stack);
    expect(writeSong(s)).not.toContain('"stack":{"chains":[]}');
  });
  it('keeps a sidechain EQ, with or without a track, in range', () => {
    const s = song(JSON.stringify({ tracks: [{ id: 'a', notes: [], fx: [
      { id: 'c', kind: 'compressor', sidechain: { eq: { type: 'highpass', freq: 99999, q: 0.7, gain: 3 } } },
      { id: 'g', kind: 'gate', sidechain: { track: 'kick', eq: { type: 'wobble', on: false } } },
      { id: 'd', kind: 'compressor', sidechain: { eq: 'nope', gain: 4 } },
    ] }] }));
    const fx = s.tracks[0]!.fx as { sidechain?: unknown }[];
    expect(fx.map((e) => e.sidechain)).toEqual([
      { eq: { type: 'highpass', freq: 20000, gain: 3 } },
      { track: 'kick', eq: { type: 'lowpass', freq: 100, on: false } },
      undefined,
    ]);
    expect(song(writeSong(s)).tracks[0]!.fx).toEqual(s.tracks[0]!.fx);
    // Six decimals, as effect settings keep.
    const fine = song(JSON.stringify({ tracks: [{ id: 'a', notes: [], fx: [{ id: 'c', kind: 'compressor', sidechain: { eq: { type: 'bandpass', freq: 1234.5678, q: 1.234567 } } }], mods: [{ kind: 'shaper', target: 'volume', amount: 0.2, points: [{ beat: 0.333333, value: -0.123456, curve: 0.4567 }] }] }] }));
    expect((fine.tracks[0]!.fx![0] as { sidechain?: unknown }).sidechain).toEqual({ eq: { type: 'bandpass', freq: 1234.5678, q: 1.234567 } });
    expect(fine.tracks[0]!.mods![0]!.points).toEqual([{ beat: 0.333333, value: -0.123456, curve: 0.4567 }]);
  });
  it('keeps a stack\'s chains and macros, drops a stack inside one, and gives new ids past those in its chains', () => {
    const s = song(JSON.stringify({ tracks: [{ id: 'a', notes: [], fx: [
      { id: 'fx1', kind: 'stack', chains: [
        { name: 'Wet', volume: 0.5, pan: -3, muted: true, fx: [{ id: 'fx2', kind: 'reverb', mix: 1 }, { id: 'in', kind: 'stack', chains: [] }] },
        { fx: [], volume: 1, pan: 0 },
      ], macros: [{ value: 2, name: 'Space', maps: [{ target: 'fx:fx2:mix', min: 0.1, max: 0.9 }, { target: 'volume', min: 0, max: 1 }] }, {}] },
    ] }] }));
    const stack = s.tracks[0]!.fx![0]!;
    expect(stack).toEqual({ id: 'fx1', kind: 'stack', on: true,
      chains: [{ name: 'Wet', volume: 0.5, pan: -1, muted: true, fx: [{ ...newEffect('reverb', 'fx2'), mix: 1 }] }, { fx: [] }],
      macros: [{ name: 'Space', value: 1, maps: [{ target: 'fx:fx2:mix', min: 0.1, max: 0.9 }] }, { value: 0, maps: [] }] });
    expect(song(writeSong(s)).tracks[0]!.fx).toEqual(s.tracks[0]!.fx);
    expect(freshEffectId(s.tracks[0]!)).toBe('fx3');
    expect(newStack('fx3')).toMatchObject({ kind: 'stack', chains: [{ fx: [] }] });
    expect(newStack('fx3').macros).toHaveLength(8);
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

describe('volume automation', () => {
  it('reads points in order, inside the song and 0 to 1, and leaves out the rest', () => {
    expect(readAuto([{ beat: 8, value: 0.2 }, { beat: -1, value: 2 }, { beat: 'x', value: 1 }, { beat: 99, value: 0.5 }], 16)).toEqual([{ beat: 0, value: 1 }, { beat: 8, value: 0.2 }, { beat: 16, value: 0.5 }]);
  });
  it('is flat before the first point and after the last, and a straight line between', () => {
    const line = [{ beat: 4, value: 0 }, { beat: 8, value: 1 }];
    expect(autoValueAt(line, 0, 0.8)).toBe(0);
    expect(autoValueAt(line, 6, 0.8)).toBe(0.5);
    expect(autoValueAt(line, 12, 0.8)).toBe(1);
    expect(autoValueAt([], 3, 0.8)).toBe(0.8);
  });
  it('reads an old volumeAuto as auto.volume and writes auto, and leaves it out when there is none', () => {
    const r = parseSong(JSON.stringify({ version: 1, tempo: 100, key: 'C major', bars: 4, tracks: [{ id: 'a', name: 'A', instrument: 'pad', volume: 0.8, notes: [], volumeAuto: [{ beat: 0, value: 0 }, { beat: 16, value: 1 }] }] }));
    if (!('song' in r)) throw new Error('no song');
    expect(r.song.tracks[0]!.auto?.volume).toHaveLength(2);
    const text = writeSongForAuto(r.song);
    expect(text).toContain('"auto":{"volume":[{"beat":0,"value":0},{"beat":16,"value":1}]}');
    expect(text).not.toContain('volumeAuto');
    delete r.song.tracks[0]!.auto;
    expect(writeSongForAuto(r.song)).not.toContain('"auto"');
  });
  it('keeps pan, sends, effect settings in their own units, curves and overrides, in range, and drops unknown names', () => {
    const r = parseSong(JSON.stringify({ version: 1, tempo: 100, key: 'C major', bars: 4, tracks: [{ id: 'a', name: 'A', instrument: 'pad', volume: 0.8, notes: [],
      auto: { pan: [{ beat: 0, value: -3, curve: 0.5 }, { beat: 8, value: 1 }], 'send:r1': [{ beat: 4, value: 0.4 }], 'fx:m:makeup': [{ beat: 0, value: 6 }], 'fx:b:osc.cutoff': [{ beat: 0, value: 800 }], bogus: [{ beat: 0, value: 1 }] }, autoOff: ['pan', 'pan', 'bogus'] }] }));
    if (!('song' in r)) throw new Error('no song');
    const t = r.song.tracks[0]!;
    expect(t.auto).toEqual({ pan: [{ beat: 0, value: -1, curve: 0.5 }, { beat: 8, value: 1 }], 'send:r1': [{ beat: 4, value: 0.4 }], 'fx:m:makeup': [{ beat: 0, value: 6 }], 'fx:b:osc.cutoff': [{ beat: 0, value: 800 }] });
    expect(t.autoOff).toEqual(['pan']);
    const again = parseSong(writeSongForAuto(r.song));
    if (!('song' in again)) throw new Error('no song');
    expect(again.song.tracks[0]!.auto).toEqual(t.auto);
    expect(again.song.tracks[0]!.autoOff).toEqual(['pan']);
  });
  it('keeps a track\'s modulators, in range, with their defaults left out, and drops unknown kinds and targets', () => {
    const r = parseSong(JSON.stringify({ version: 1, tempo: 100, key: 'C major', bars: 4, tracks: [{ id: 'a', name: 'A', instrument: 'pad', volume: 0.8, notes: [], mods: [
      { kind: 'lfo', target: 'fx:e:midFreq', amount: 400, rate: 1, sync: 4, shape: 'square', phase: 0.25 },
      { kind: 'lfo', target: 'pan', amount: 0.5, rate: 99, shape: 'sine', on: false },
      { kind: 'follow', target: 'volume', amount: -0.5, attack: 0.01, release: 0.5 },
      { kind: 'shaper', target: 'volume', amount: 0.25, sync: 2, shape: 'square', points: [{ beat: 0.5, value: -3, curve: 0.4 }, { beat: 0, value: 1 }, { beat: 'x', value: 0 }] },
      { kind: 'wobble', target: 'volume', amount: 1 }, { kind: 'lfo', target: 'bogus', amount: 1 }, { kind: 'lfo', target: 'pan' },
    ] }] }));
    if (!('song' in r)) throw new Error('no song');
    const mods = r.song.tracks[0]!.mods;
    expect(mods).toEqual([
      { kind: 'lfo', target: 'fx:e:midFreq', amount: 400, sync: 4, shape: 'square', phase: 0.25 },
      { kind: 'lfo', target: 'pan', amount: 0.5, rate: 40, on: false },
      { kind: 'follow', target: 'volume', amount: -0.5, release: 0.5 },
      { kind: 'shaper', target: 'volume', amount: 0.25, sync: 2, points: [{ beat: 0, value: 1 }, { beat: 0.5, value: -1, curve: 0.4 }] },
    ]);
    const again = parseSong(writeSongForAuto(r.song));
    if (!('song' in again)) throw new Error('no song');
    expect(again.song.tracks[0]!.mods).toEqual(mods);
  });
  it('keeps a clip\'s envelopes in its own beats, Session and Arrange, with effect settings', () => {
    const env = { volume: [{ beat: 0, value: 0.5, curve: 0.3 }, { beat: 99, value: 1 }], pan: [{ beat: 2, value: -2 }], 'fx:d:mix': [{ beat: 0, value: 1 }] };
    const r = parseSong(JSON.stringify({ version: 2, tempo: 100, key: 'C major', bars: 8, tracks: [{ id: 'a', name: 'A', instrument: 'pad', volume: 0.8,
      clips: [{ id: 'c', start: 0, length: 8, notes: [], envelopes: env }], slots: [{ name: 'S', bars: 1, notes: [], envelopes: env }] }] }));
    if (!('song' in r)) throw new Error('no song');
    const t = r.song.tracks[0]!;
    expect(t.clips[0]!.envelopes).toEqual({ volume: [{ beat: 0, value: 0.5, curve: 0.3 }, { beat: 8, value: 1 }], pan: [{ beat: 2, value: -1 }], 'fx:d:mix': [{ beat: 0, value: 1 }] });
    expect(t.slots![0]!.envelopes).toEqual({ volume: [{ beat: 0, value: 0.5, curve: 0.3 }, { beat: 4, value: 1 }], pan: [{ beat: 2, value: -1 }], 'fx:d:mix': [{ beat: 0, value: 1 }] });
    const again = parseSong(writeSongForAuto(r.song));
    if (!('song' in again)) throw new Error('no song');
    expect(again.song.tracks[0]!.clips[0]!.envelopes).toEqual(t.clips[0]!.envelopes);
    expect(again.song.tracks[0]!.slots![0]!.envelopes).toEqual(t.slots![0]!.envelopes);
  });
  it('keeps an unlinked envelope\'s own loop, its points running to the loop\'s end past the clip\'s', () => {
    const r = parseSong(JSON.stringify({ version: 2, tempo: 100, key: 'C major', bars: 8, tracks: [{ id: 'a', name: 'A', instrument: 'pad', volume: 0.8,
      slots: [{ name: 'S', bars: 1, notes: [], envelopes: { volume: [{ beat: 0, value: 0 }, { beat: 6, value: 1 }], pan: [{ beat: 6, value: 1 }] },
        unlinked: { volume: { start: 0, end: 6 }, pan: { start: 3, end: 2 }, bogus: { start: 0, end: 1 }, 'send:r': { start: -1, end: 999 } } }] }] }));
    if (!('song' in r)) throw new Error('no song');
    const s = r.song.tracks[0]!.slots![0]!;
    expect(s.unlinked).toEqual({ volume: { start: 0, end: 6 }, 'send:r': { start: 0, end: 256 } });
    // The unlinked volume runs to 6 beats; the linked pan ends with the 4-beat clip.
    expect(s.envelopes).toEqual({ volume: [{ beat: 0, value: 0 }, { beat: 6, value: 1 }], pan: [{ beat: 4, value: 1 }] });
    const again = parseSong(writeSongForAuto(r.song));
    if (!('song' in again)) throw new Error('no song');
    expect(again.song.tracks[0]!.slots![0]!.unlinked).toEqual(s.unlinked);
  });
  it('bends a curved segment as the engine does', () => {
    const line = [{ beat: 0, value: 0, curve: 1 }, { beat: 4, value: 1 }];
    expect(autoValueAt(line, 2, 0)).toBeCloseTo(0.5 ** 0.25);
    expect(bend(0.5, -1)).toBeCloseTo(0.5 ** 4);
    expect(bend(0.5)).toBe(0.5);
  });
});

describe('the agent guide (docs/agent/music.md)', () => {
  // Mobius writes sounds and effects from this page, so every setting it names is the one the app reads, in its range.
  const guide = readFileSync(new URL('../../../docs/agent/music.md', import.meta.url), 'utf8');
  const n = (v: number) => String(v);
  it('names every sound setting with its range', () => {
    for (const [k, r] of Object.entries(SOUND_RANGE)) expect(guide, k).toMatch(new RegExp(`\`${k}\` ${n(r.lo)}-${n(r.hi)}`));
  });
  it('names every effect kind and setting', () => {
    for (const [kind, params] of Object.entries(EFFECT_PARAMS)) {
      expect(guide).toContain(`\`${kind}\``);
      for (const k of Object.keys(params)) expect(guide, `${kind}.${k}`).toContain(`\`${k}\``);
    }
  });
});

describe('clips in Arrange', () => {
  const n = (pitch: number, start: number, length = 1) => ({ pitch, start, length, velocity: 0.8 });
  it('reads a version 1 track into a clip for each run of bars with notes', () => {
    const s = song(JSON.stringify({ version: 1, bars: 8, tracks: [{ id: 't1', instrument: 'bass', notes: [n(40, 0), n(41, 5), n(43, 16, 2)] }] }));
    expect(s.version).toBe(2);
    expect(s.tracks[0]!.clips.map((c) => [c.start, c.length, c.notes.map((x) => x.start)])).toEqual([[0, 8, [0, 5]], [16, 4, [0]]]);
    expect(trackNotes(s.tracks[0]!).map((x) => x.start)).toEqual([0, 5, 16]);
  });
  it('keeps clips as written: their names, mute, and notes in the clip\'s own time; overlaps are cut back', () => {
    const s = song(JSON.stringify({ version: 2, bars: 8, tracks: [{ id: 't1', instrument: 'piano', clips: [
      { id: 'a', start: 4, length: 8, name: 'Verse', notes: [n(60, 0), n(62, 7)] },
      { id: 'b', start: 8, length: 4, muted: true, notes: [n(64, 1)] },
    ] }] }));
    const [a, b] = s.tracks[0]!.clips;
    expect(a).toMatchObject({ id: 'a', start: 4, length: 4, name: 'Verse', notes: [n(60, 0)] });
    expect(b).toMatchObject({ id: 'b', start: 8, length: 4, muted: true });
    expect(trackNotes(s.tracks[0]!, true).map((x) => x.pitch)).toEqual([60]);
    expect(song(writeSong(s))).toEqual(s);
  });
  it('puts edited notes back into the clip each starts in, and makes clips only where there are none', () => {
    const clips = [{ id: 'c1', start: 4, length: 4, name: 'Hook', notes: [n(60, 0)] }];
    const out = putNotes(clips, [n(60, 4), n(62, 6.5), n(64, 9), n(65, 2)], 4);
    expect(out.map((c) => [c.id, c.start, c.length, c.notes.map((x) => x.start)])).toEqual([['c2', 0, 4, [2]], ['c1', 4, 4, [0, 2.5]], ['c3', 8, 4, [1]]]);
    expect(out[1]!.name).toBe('Hook');
    // A clip whose notes are all taken out goes.
    expect(putNotes(clips, [], 4)).toEqual([]);
  });
});

describe('clip loops and start markers (as Live, and as the engine plays them)', () => {
  const looped = song(JSON.stringify({ version: 2, tempo: 120, bars: 4, tracks: [{ id: 't1', instrument: 'bass', clips: [
    { id: 'c1', start: 4, length: 5, loop: { start: 0, end: 2 }, notes: [{ pitch: 40, start: 0, length: 1, velocity: 1 }, { pitch: 43, start: 1.5, length: 1, velocity: 1 }] },
    { id: 'c2', start: 10, length: 2, offset: 1, notes: [{ pitch: 50, start: 0, length: 1, velocity: 1 }, { pitch: 52, start: 2, length: 4, velocity: 1 }] },
    { id: 'c3', start: 12, length: 2, muted: true, notes: [{ pitch: 60, start: 0, length: 1, velocity: 1 }] },
  ] }] }));
  const t = looped.tracks[0]!;

  it('plays the same notes as the engine (song.rs clips_lay_their_notes_out_in_song_time_going_round_their_loops)', () => {
    expect(trackNotes(t, true).map((n) => [n.pitch, n.start, n.length])).toEqual([[40, 4, 1], [43, 5.5, 0.5], [40, 6, 1], [43, 7.5, 0.5], [40, 8, 1], [52, 11, 1]]);
  });

  it('keeps a loop and a start marker through writing and reading, with notes past the clip\'s length', () => {
    const again = song(writeSong(looped)).tracks[0]!;
    expect(again.clips[0]!.loop).toEqual({ start: 0, end: 2 });
    expect(again.clips[1]!.offset).toBe(1);
    expect(again.clips[1]!.notes.map((n) => n.pitch)).toEqual([50, 52]);
  });

  it('edits the first pass in place, and a note written in a repeat goes into the loop', () => {
    // The editor shows c1's first pass (beats 4 to 6) and c2 from its start marker; 50, before the marker, stays hidden.
    const shown = trackNotes(t);
    expect(shown.map((n) => [n.pitch, n.start])).toEqual([[40, 4], [43, 5.5], [52, 11], [60, 12]]);
    // A note at beat 7 is in c1's second pass: it lands at beat 1 of the loop, so it plays on every pass.
    const clips = putNotes(t.clips, [...shown, { pitch: 45, start: 7, length: 0.5, velocity: 0.8 }], looped.bars);
    expect(clips[0]!.notes.map((n) => [n.pitch, n.start])).toEqual([[40, 0], [45, 1], [43, 1.5]]);
    // The hidden note before c2's marker is kept.
    expect(clips[1]!.notes.map((n) => [n.pitch, n.start])).toEqual([[50, 0], [52, 2]]);
  });

  it('says where a beat in a clip falls in its own time', () => {
    expect(ownAt({ length: 8, loop: { start: 0, end: 2 } }, 5)).toBe(1);
    expect(ownAt({ length: 8, offset: 1, loop: { start: 0, end: 2 } }, 1)).toBe(0);
    expect(ownAt({ length: 4, offset: 1 }, 2)).toBe(3);
    expect(firstPass({ length: 8, offset: 1, loop: { start: 0, end: 2 } })).toEqual({ from: 1, to: 2 });
  });
});

describe('Main and return tracks (Live 12 calls the master Main)', () => {
  const text = JSON.stringify({ version: 2, tempo: 120, bars: 4,
    main: { volume: 0.5, fx: [{ id: 'fx1', kind: 'reverb' }] },
    returns: [{ id: 't1', volume: 0.7, pan: -0.5, name: 'Verb', fx: [{ kind: 'delay' }] }, { volume: 2, muted: true }],
    tracks: [{ id: 't1', instrument: 'bass', clips: [], sends: { 't1': 0.4, 'r-t1': 0.3, nope: 0.5, 'r-2': 0 } }] });
  const read = song(text);
  it('reads Main, returns with ids apart from the tracks\', and sends only to returns there are', () => {
    expect(read.main?.volume).toBe(0.5);
    expect(read.main?.fx?.[0]?.kind).toBe('reverb');
    expect(read.returns?.map((r) => r.id)).toEqual(['r-t1', 'r-2']);
    expect(read.returns?.[1]).toMatchObject({ volume: 1, muted: true });
    expect(read.tracks[0]!.sends).toEqual({ 'r-t1': 0.3 });
  });
  it('writes them back as they were read, and a song without them stays without', () => {
    const again = song(writeSong(read));
    expect(again.main).toEqual(read.main);
    expect(again.returns).toEqual(read.returns);
    expect(again.tracks[0]!.sends).toEqual({ 'r-t1': 0.3 });
    const plain = song(JSON.stringify({ version: 2, tracks: [{ id: 't1', instrument: 'bass', clips: [] }] }));
    expect(writeSong(plain)).not.toContain('"main"');
    expect(writeSong(plain)).not.toContain('"returns"');
  });
});

describe('audio tracks', () => {
  it('keeps an audio track, its input and each clip’s sound through a read and a write, as the engine reads them', () => {
    const text = JSON.stringify({ version: 2, bars: 4, tracks: [{ id: 'a1', name: 'Vox', kind: 'audio', input: 1, instrument: 'piano', clips: [
      { id: 'c1', start: 0, length: 8, notes: [], audio: { file: 'Samples/Recorded/take 1.wav', gainDb: -3, transpose: -7.25, offset: 1.25, warp: true, mode: 'repitch', bpm: 96, markers: [{ sample: 0, beat: 0 }, { sample: 44100, beat: 2 }] } },
    ], slots: [{ name: 'Loop', bars: 1, notes: [], audio: { file: 'loop.wav' } }] }] });
    const read = parseSong(text);
    if ('error' in read) throw new Error(read.error);
    const t = read.song.tracks[0]!;
    expect(t.kind).toBe('audio');
    expect(t.input).toBe(1);
    expect(t.clips[0]!.audio).toEqual({ file: 'Samples/Recorded/take 1.wav', gainDb: -3, transpose: -7.25, offset: 1.25, warp: true, mode: 'repitch', bpm: 96, markers: [{ sample: 0, beat: 0 }, { sample: 44100, beat: 2 }] });
    expect(t.slots?.[0]?.audio).toEqual({ file: 'loop.wav' });
    const again = parseSong(writeSong(read.song));
    if ('error' in again) throw new Error(again.error);
    expect(again.song).toEqual(read.song);
  });
  it('leaves a MIDI track and a clip with no file as they were', () => {
    const read = parseSong(JSON.stringify({ version: 2, tracks: [{ id: 't1', instrument: 'bass', kind: 'midi', clips: [{ id: 'c1', start: 0, length: 4, notes: [], audio: { gainDb: 2 } }] }] }));
    if ('error' in read) throw new Error(read.error);
    expect(read.song.tracks[0]!.kind).toBeUndefined();
    expect(read.song.tracks[0]!.clips[0]!.audio).toBeUndefined();
    expect(writeSong(read.song)).not.toContain('"kind"');
  });
});

describe('samplers', () => {
  it('keeps a sampler track’s sound and a drum pad’s sample through a read and a write, as the engine reads them', () => {
    const sampler = { file: 'Samples/pluck.wav', mode: 'oneshot', root: 57, gainDb: -6, start: 0.1, end: 1.5, gate: true, fadeIn: 0.01, fadeOut: 0.2 };
    const text = JSON.stringify({ version: 2, bars: 4, tracks: [
      { id: 's1', name: 'Pluck', kind: 'sampler', instrument: 'piano', sampler, clips: [] },
      { id: 'd1', name: 'Drums', instrument: 'drums', pads: { 36: { tune: 0, decay: 1, level: 0.9, pan: 0, sample: { file: 'Samples/kick.wav' } }, 38: { sample: { file: 'Samples/snare.wav', loop: true, loopStart: 0.2 } } }, clips: [] },
    ] });
    const read = parseSong(text);
    if ('error' in read) throw new Error(read.error);
    const [s, d] = read.song.tracks;
    expect(s!.kind).toBe('sampler');
    expect(s!.sampler).toEqual(sampler);
    expect(d!.pads?.[36]?.sample).toEqual({ file: 'Samples/kick.wav' });
    expect(d!.pads?.[38]).toMatchObject({ level: 1, sample: { file: 'Samples/snare.wav', loop: true, loopStart: 0.2 } });
    const again = parseSong(writeSong(read.song));
    if ('error' in again) throw new Error(again.error);
    expect(again.song).toEqual(read.song);
  });
  it('drops what the engine would not read: no file, a classic mode and root 60 left out', () => {
    expect(readSampler({ mode: 'oneshot' })).toBeUndefined();
    expect(readSampler({ file: 'a.wav', mode: 'classic', root: 60, gainDb: 0, start: 0 })).toEqual({ file: 'a.wav' });
  });
});

describe('frozen tracks', () => {
  it('keeps a frozen track’s render through a read and a write, and drops one with no file', () => {
    const read = parseSong(JSON.stringify({ version: 2, bars: 4, tracks: [
      { id: 't1', name: 'Pad', instrument: 'pad', frozen: { file: 'Samples/Processed/Freeze/Pad.wav' }, clips: [] },
      { id: 't2', name: 'Bass', instrument: 'bass', frozen: {}, clips: [] },
    ] }));
    if ('error' in read) throw new Error(read.error);
    expect(read.song.tracks[0]!.frozen).toEqual({ file: 'Samples/Processed/Freeze/Pad.wav' });
    expect(read.song.tracks[1]!.frozen).toBeUndefined();
    const again = parseSong(writeSong(read.song));
    if ('error' in again) throw new Error(again.error);
    expect(again.song).toEqual(read.song);
  });
});

describe('the metronome level', () => {
  it('keeps the metronome’s volume apart from Main through a read and a write, and leaves it out when unset', () => {
    const read = parseSong(JSON.stringify({ version: 2, bars: 4, metronome: { volume: 0.35 }, tracks: [] }));
    if ('error' in read) throw new Error(read.error);
    expect(read.song.metronome).toEqual({ volume: 0.35 });
    expect(writeSong(read.song)).toContain('"metronome": {"volume":0.35}');
    const plain = parseSong(JSON.stringify({ version: 2, bars: 4, tracks: [] }));
    if ('error' in plain) throw new Error(plain.error);
    expect(plain.song.metronome).toBeUndefined();
    expect(writeSong(plain.song)).not.toContain('metronome');
  });
});

describe('a string track', () => {
  it('keeps its string settings in range, writes them back, and has no synth sound', () => {
    const read = parseSong(JSON.stringify({ version: 2, tempo: 120, key: 'C major', bars: 4, tracks: [{ id: 't1', instrument: 'string', clips: [], sound: { cutoff: 900 }, string: { exciter: 'bow', decay: 99, damping: 0.25, position: -3, tone: 'loud' } }] }));
    if (!('song' in read)) throw new Error(read.error);
    const t = read.song.tracks[0]!;
    expect(t.string).toEqual({ exciter: 'bow', decay: 30, damping: 0.25, position: 0.02, tone: 0.6 });
    expect(t.sound).toBeUndefined();
    expect(soundOf(t)).toBeNull();
    expect(stringOf(t)?.exciter).toBe('bow');
    expect(JSON.parse(writeSong(read.song)).tracks[0].string).toEqual(t.string);
    const plain = parseSong(JSON.stringify({ version: 2, tempo: 120, key: 'C major', bars: 4, tracks: [{ id: 't1', instrument: 'string', clips: [] }] }));
    if (!('song' in plain)) throw new Error(plain.error);
    expect(stringOf(plain.song.tracks[0]!)).toEqual(STRING_DEFAULTS);
    expect(stringOf({ instrument: 'piano' })).toBeNull();
  });
});

describe('a mallet track', () => {
  it('keeps its mallet settings in range, writes them back, and has no synth sound', () => {
    const read = parseSong(JSON.stringify({ version: 2, tempo: 120, key: 'C major', bars: 4, tracks: [{ id: 't1', instrument: 'mallet', clips: [], sound: { cutoff: 900 }, string: { decay: 2 }, mallet: { resonator: 'gong', decay: 40, material: 0, hardness: 2, position: 'middle' } }] }));
    if (!('song' in read)) throw new Error(read.error);
    const t = read.song.tracks[0]!;
    expect(t.mallet).toEqual({ resonator: 'marimba', decay: 20, material: 0, hardness: 1, position: 0.2 });
    expect(t.sound).toBeUndefined();
    expect(t.string).toBeUndefined();
    expect(soundOf(t)).toBeNull();
    expect(JSON.parse(writeSong(read.song)).tracks[0].mallet).toEqual(t.mallet);
    const plain = parseSong(JSON.stringify({ version: 2, tempo: 120, key: 'C major', bars: 4, tracks: [{ id: 't1', instrument: 'mallet', clips: [], mallet: { resonator: 'bell' } }] }));
    if (!('song' in plain)) throw new Error(plain.error);
    expect(malletOf(plain.song.tracks[0]!)).toEqual({ ...MALLET_DEFAULTS, resonator: 'bell' });
    expect(malletOf({ instrument: 'string' })).toBeNull();
  });
});

describe('an electric piano track', () => {
  it('keeps its settings in range, writes them back, and has no synth sound', () => {
    const read = parseSong(JSON.stringify({ version: 2, tempo: 120, key: 'C major', bars: 4, tracks: [{ id: 't1', instrument: 'electric', clips: [], sound: { cutoff: 900 }, mallet: { decay: 2 }, electric: { fork: 'clav', decay: 0, hardness: 0.8, bell: 7, drive: 'lots' } }] }));
    if (!('song' in read)) throw new Error(read.error);
    const t = read.song.tracks[0]!;
    expect(t.electric).toEqual({ fork: 'tine', decay: 0.2, hardness: 0.8, bell: 1, drive: 0.35 });
    expect(t.sound).toBeUndefined();
    expect(t.mallet).toBeUndefined();
    expect(soundOf(t)).toBeNull();
    expect(JSON.parse(writeSong(read.song)).tracks[0].electric).toEqual(t.electric);
    const plain = parseSong(JSON.stringify({ version: 2, tempo: 120, key: 'C major', bars: 4, tracks: [{ id: 't1', instrument: 'electric', clips: [], electric: { fork: 'reed' } }] }));
    if (!('song' in plain)) throw new Error(plain.error);
    expect(electricOf(plain.song.tracks[0]!)).toEqual({ ...ELECTRIC_DEFAULTS, fork: 'reed' });
    expect(electricOf({ instrument: 'piano' })).toBeNull();
  });
});

describe('a wavetable synth track', () => {
  it('keeps its settings in range, whole where they step, writes them back, and has no synth sound', () => {
    const read = parseSong(JSON.stringify({ version: 2, tempo: 120, key: 'C major', bars: 4, tracks: [{ id: 't1', instrument: 'wavetable', clips: [], sound: { cutoff: 900 }, electric: { decay: 2 },
      wavetable: { table1: 'fold', table2: 'noise', position1: 3, transpose2: 7.6, unison: 20, subOctave: -2, cutoff: 5, envPosition: -0.5, attack: 'slow' } }] }));
    if (!('song' in read)) throw new Error(read.error);
    const t = read.song.tracks[0]!;
    expect(t.wavetable).toEqual({ ...WAVETABLE_DEFAULTS, table1: 'fold', position1: 1, transpose2: 8, unison: 8, subOctave: -2, cutoff: 30, envPosition: -0.5 });
    expect(t.sound).toBeUndefined();
    expect(t.electric).toBeUndefined();
    expect(soundOf(t)).toBeNull();
    expect(JSON.parse(writeSong(read.song)).tracks[0].wavetable).toEqual(t.wavetable);
    const plain = parseSong(JSON.stringify({ version: 2, tempo: 120, key: 'C major', bars: 4, tracks: [{ id: 't1', instrument: 'wavetable', clips: [] }] }));
    if (!('song' in plain)) throw new Error(plain.error);
    expect(plain.song.tracks[0]!.wavetable).toBeUndefined();
    expect(wavetableOf(plain.song.tracks[0]!)).toEqual(WAVETABLE_DEFAULTS);
    expect(wavetableOf({ instrument: 'lead' })).toBeNull();
  });
});

describe('a time signature', () => {
  it('is read and written, kept to ones the window can write, and sets the length of the song and its clips', () => {
    const read = parseSong(JSON.stringify({ version: 2, tempo: 120, key: 'C major', bars: 2, signature: [3, 4], tracks: [{ id: 't1', instrument: 'bass', notes: [{ pitch: 40, start: 4, length: 1, velocity: 1 }], slots: [{ bars: 1, notes: [{ pitch: 40, start: 2.5, length: 1, velocity: 1 }, { pitch: 40, start: 3, length: 1, velocity: 1 }] }] }] }));
    if (!('song' in read)) throw new Error(read.error);
    expect(read.song.signature).toEqual([3, 4]);
    expect(barBeats(read.song)).toBe(3);
    expect(songSeconds(read.song)).toBe(3);
    // A loose note goes into a clip of its bar (the second, from beat 3); a slot's notes past its one bar of 3/4 go.
    expect(read.song.tracks[0]!.clips.map((c) => [c.start, c.length])).toEqual([[3, 3]]);
    expect(read.song.tracks[0]!.slots?.[0]?.notes.map((n) => n.start)).toEqual([2.5]);
    expect(JSON.parse(writeSong(read.song)).signature).toEqual([3, 4]);
    for (const odd of [[0, 4], [5, 3], [40, 8], 'x']) {
      const r = parseSong(JSON.stringify({ version: 2, tempo: 120, key: 'C major', bars: 2, signature: odd, tracks: [] }));
      if (!('song' in r)) throw new Error(r.error);
      expect(r.song.signature).toBeUndefined();
      expect(JSON.parse(writeSong(r.song)).signature).toBeUndefined();
    }
    expect(meterOf({ signature: [7, 8] })).toEqual([7, 8]);
    expect(barBeats({ signature: [7, 8] })).toBe(3.5);
    expect(barBeats(undefined)).toBe(4);
  });
});
