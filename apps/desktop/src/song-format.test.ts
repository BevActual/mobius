import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { SOUND_RANGE, autoValueAt, readAuto, writeSong as writeSongForAuto, sceneCount, sceneName, audible, PAD_DEFAULTS, drumKit, EFFECT_PARAMS, freshEffectId, newEffect, nextColour, TRACK_COLOURS, changedTracks, freshTrackId, keyPitches, noteName, parseSong, songSeconds, writeSong, type Song } from './song-format';

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
  it('is kept in the song file, and left out when there is none', () => {
    const r = parseSong(JSON.stringify({ version: 1, tempo: 100, key: 'C major', bars: 4, tracks: [{ id: 'a', name: 'A', instrument: 'pad', volume: 0.8, notes: [], volumeAuto: [{ beat: 0, value: 0 }, { beat: 16, value: 1 }] }] }));
    if (!('song' in r)) throw new Error('no song');
    expect(r.song.tracks[0]!.volumeAuto).toHaveLength(2);
    expect(writeSongForAuto(r.song)).toContain('"volumeAuto":[{"beat":0,"value":0},{"beat":16,"value":1}]');
    r.song.tracks[0]!.volumeAuto = [];
    expect(writeSongForAuto(r.song)).not.toContain('volumeAuto');
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
