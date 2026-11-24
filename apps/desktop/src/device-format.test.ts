import { describe, expect, it } from 'vitest';
import { MAX_PARTS, parseDevice, type Device } from './device-format';
import { builtinDevice, EFFECT_KINDS, newEffect, parseSong, writeSong, type BuiltinEffect } from './song-format';
import { soundChanges } from './studio-view';

/** The plan's example: echoes that wobble and get darker each time round. */
const TAPE = {
  name: 'Tape Delay',
  about: 'Echoes that wobble and get darker each time round',
  parts: [
    { id: 'in', kind: 'input' },
    { id: 'echo', kind: 'delay', time: 0.75 },
    { id: 'tone', kind: 'filter', type: 'lowpass', cutoff: 3000, resonance: 0.1 },
    { id: 'back', kind: 'gain', gain: 0.45 },
    { id: 'wobble', kind: 'lfo', rate: 0.6, depth: 0.004, shape: 'sine' },
    { id: 'mix', kind: 'mix', amount: 0.35 },
    { id: 'out', kind: 'output' },
  ],
  cables: [['in', 'mix.dry'], ['in', 'echo'], ['echo', 'tone'], ['tone', 'back'], ['back', 'echo'], ['tone', 'mix.wet'], ['mix', 'out'], ['wobble', 'echo.time']],
  controls: [
    { label: 'Time', part: 'echo', param: 'time' },
    { label: 'Repeats', part: 'back', param: 'gain', max: 0.9 },
    { label: 'Tone', part: 'tone', param: 'cutoff' },
    { label: 'Mix', part: 'mix', param: 'amount' },
  ],
};
const read = (d: unknown) => parseDevice(d);
const error = (d: unknown) => { const r = read(d); return 'error' in r ? r.error : null; };
const with_ = (patch: Record<string, unknown>) => ({ ...TAPE, ...patch });

describe('device files', () => {
  it('reads a device: parts with every setting, cables, and the controls it shows', () => {
    const r = read(TAPE);
    if (!('device' in r)) throw new Error(r.error);
    expect(r.device.name).toBe('Tape Delay');
    expect(r.device.parts).toHaveLength(7);
    expect(r.device.parts.find((p) => p.id === 'tone')).toEqual({ id: 'tone', kind: 'filter', type: 'lowpass', cutoff: 3000, resonance: 0.1, gain: 0 });
    expect(r.device.cables).toContainEqual(['wobble', 'echo.time']);
    expect(r.device.controls[1]).toEqual({ label: 'Repeats', part: 'back', param: 'gain', max: 0.9 });
  });
  it('brings settings into range and gives missing ones their start', () => {
    const r = read(with_({ parts: TAPE.parts.map((p) => (p.id === 'tone' ? { ...p, cutoff: 99999, type: 'wobbly' } : p.id === 'back' ? { id: 'back', kind: 'gain' } : p)) }));
    if (!('device' in r)) throw new Error(r.error);
    expect(r.device.parts.find((p) => p.id === 'tone')).toMatchObject({ cutoff: 20000, type: 'lowpass' });
    expect(r.device.parts.find((p) => p.id === 'back')).toMatchObject({ gain: 1 });
  });
  it('refuses what could not play, saying which rule in a line', () => {
    expect(error(with_({ parts: [...TAPE.parts, { id: 'x', kind: 'flanger' }] }))).toMatch(/“x” is a “flanger”, which is not a kind of part/);
    expect(error(with_({ parts: [...TAPE.parts, { id: 'in', kind: 'gain' }] }))).toMatch(/two parts called “in”/);
    expect(error(with_({ parts: TAPE.parts.filter((p) => p.kind !== 'output') }))).toMatch(/one input part and one output part/);
    expect(error(with_({ cables: [...TAPE.cables, ['tone', 'nowhere']] }))).toMatch(/“nowhere”, which is not a part/);
    expect(error(with_({ cables: [...TAPE.cables, ['tone', 'mix']] }))).toMatch(/say which input, mix\.dry or mix\.wet/);
    expect(error(with_({ cables: [...TAPE.cables, ['tone', 'back.pan']] }))).toMatch(/a gain’s pan can’t be moved by a cable/);
    expect(error(with_({ cables: [...TAPE.cables, ['wobble', 'tone']] }))).toMatch(/goes to a setting/);
    expect(error(with_({ cables: [...TAPE.cables, ['out', 'tone']] }))).toMatch(/the output, which sends nothing on/);
    // A loop that doesn't pass through a delay can't be played; the echo's own loop can.
    expect(error(with_({ cables: [...TAPE.cables, ['back', 'tone']] }))).toMatch(/a loop with no delay in it \(tone → back → tone\)/);
    const many = Array.from({ length: MAX_PARTS + 1 }, (_, i) => ({ id: `g${i}`, kind: 'gain' }));
    expect(error(with_({ parts: many }))).toMatch(/at most 24/);
    expect(error(with_({ controls: [{ label: 'Shape', part: 'wobble', param: 'shape' }] }))).toMatch(/not a number setting/);
  });
  it('has each built-in effect the Workbench can draw as a device that reads back as it is', () => {
    const drawn = EFFECT_KINDS.filter((kind) => builtinDevice(newEffect(kind, 'fx1') as BuiltinEffect) !== null);
    expect(EFFECT_KINDS.filter((kind) => !drawn.includes(kind))).toEqual(['gate', 'limiter', 'chorus', 'beatrepeat']);
    for (const kind of drawn) {
      const device = builtinDevice(newEffect(kind, 'fx1') as BuiltinEffect)!;
      const r = read(JSON.parse(JSON.stringify(device)) as Device);
      if (!('device' in r)) throw new Error(`${kind}: ${r.error}`);
      expect(r.device).toEqual(device);
    }
    const delay = builtinDevice({ id: 'fx1', kind: 'delay', on: true, time: 0.5, feedback: 0.6, mix: 0.4 })!;
    expect(delay.parts.find((p) => p.id === 'back')).toMatchObject({ gain: 0.6 });
    const comp = builtinDevice({ id: 'fx1', kind: 'compressor', on: true, threshold: -20, ratio: 4, attack: 0.01, release: 0.2, makeup: 6 })!;
    expect(comp.parts.find((p) => p.id === 'makeup')!.gain).toBeCloseTo(1.995, 3);
  });
});

describe('a device in a song', () => {
  const song = (fx: unknown[]) => JSON.stringify({ version: 1, tempo: 100, key: 'A minor', bars: 1, tracks: [{ id: 't1', name: 'Keys', instrument: 'piano', notes: [], fx }] });
  it('is an effect of kind device with the whole device in it, written back as read', () => {
    const r = parseSong(song([{ id: 'fx1', kind: 'reverb', size: 2 }, { id: 'fx2', kind: 'device', device: TAPE }]));
    if (!('song' in r)) throw new Error(r.error);
    const fx = r.song.tracks[0]!.fx!;
    expect(fx.map((e) => e.kind)).toEqual(['reverb', 'device']);
    const again = parseSong(writeSong(r.song));
    expect('song' in again && again.song.tracks[0]!.fx).toEqual(fx);
  });
  it('refuses the song when a device in it breaks a rule, naming the track and effect', () => {
    const r = parseSong(song([{ id: 'fx2', kind: 'device', device: with_({ cables: [['in', 'nowhere']] }) }]));
    expect(r).toEqual({ error: 'Track “Keys”, effect fx2: Tape Delay: a cable goes to “nowhere”, which is not a part' });
  });
  it('says which knob moved, by its control’s name, or that the patch changed', () => {
    const r = parseSong(song([{ id: 'fx2', kind: 'device', device: TAPE }]));
    if (!('song' in r)) throw new Error(r.error);
    const was = r.song.tracks[0]!;
    const now = structuredClone(was);
    const fx = now.fx![0]!;
    if (fx.kind !== 'device') throw new Error('not a device');
    fx.device.parts.find((p) => p.id === 'tone')!.cutoff = 1500;
    expect(soundChanges(was, now)).toEqual([{ key: 'fx:fx2:tone.cutoff', text: 'Tape Delay tone 3.0 kHz → 1.5 kHz' }]);
    fx.device.cables.pop();
    expect(soundChanges(was, now)).toEqual([{ key: 'fx:fx2', text: 'changed Tape Delay’s parts' }]);
  });
});
