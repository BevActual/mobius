import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MusicPosition } from '@mobius/shared';
import type { Song } from './song-format';

const SONG = { version: 2, tempo: 120, key: 'C major', bars: 4, tracks: [] } as unknown as Song;
const ok = () => Promise.resolve({ ok: true as const });

/** A stand-in for the host's engine: every call kept, positions sent by hand. */
function fakeEngine(opened = true) {
  const calls: unknown[][] = [];
  let listener: ((p: MusicPosition) => void) | null = null;
  const rec = (name: string) => (...args: unknown[]) => { calls.push([name, ...args]); return ok(); };
  const music = {
    engine: () => Promise.resolve(opened ? { ok: true as const, device: 'Test', sampleRate: 48000, latencyMs: 10 } : { ok: false as const, message: 'no output' }),
    load: rec('load'), play: rec('play'), playSession: rec('playSession'), launch: rec('launch'), preview: rec('preview'), countIn: rec('countIn'), stop: rec('stop'), seek: rec('seek'), render: rec('render'),
    arm: rec('arm'), listen: (input: string | null) => { calls.push(['listen', input]); return Promise.resolve({ ok: true as const, listening: input }); },
    midiInputs: () => { calls.push(['midiInputs']); return Promise.resolve({ ok: true as const, inputs: ['Keystation 49', 'Other'], listening: null }); },
    onPosition: (l: (p: MusicPosition) => void) => { listener = l; return () => { listener = null; }; },
  };
  vi.stubGlobal('window', { mobius: { music } });
  return { calls, send: (p: MusicPosition) => listener?.(p), listening: () => listener !== null };
}

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); vi.useRealTimers(); });

describe('Music on the native engine', () => {
  it('arms the chosen track for a keyboard and listens to the first one the computer has, once', async () => {
    const e = fakeEngine();
    const m = await import('./studio-engine');
    await m.engineReady();
    m.armKeys('t1');
    await m.engineIdle();
    m.armKeys('t2');
    m.armKeys(null);
    await m.engineIdle();
    expect(e.calls).toEqual([['arm', 't1'], ['midiInputs'], ['listen', 'Keystation 49'], ['arm', 't2'], ['arm', null]]);
  });

  it('plays through the engine once it opens: the song loaded, then played round the loop, and stopped', async () => {
    const e = fakeEngine();
    const m = await import('./studio-engine');
    expect(await m.engineReady()).toBe(true);
    const p = m.play(SONG, 4, { from: 0, to: 8 }, true);
    await m.engineIdle();
    expect(e.calls.map((c) => c[0])).toEqual(['load', 'play']);
    expect(e.calls[1]).toEqual(['play', 4, { start: 0, end: 8 }, true]);
    p.stop();
    await m.engineIdle();
    expect(e.calls.at(-1)).toEqual(['stop']);
    expect(e.listening()).toBe(false);
  });

  it('carries the beat on between position events by the tempo, wrapping round the loop, and reads meters', async () => {
    const e = fakeEngine();
    const m = await import('./studio-engine');
    await m.engineReady();
    const now = vi.spyOn(performance, 'now').mockReturnValue(1000);
    const p = m.play(SONG, 0, { from: 0, to: 8 });
    e.send({ playing: true, beat: 7, meters: { t1: [-12, -9] }, levels: { 't1/f1/out': -9 } } as MusicPosition);
    now.mockReturnValue(1500); // half a second at 120 bpm: one beat on, past the loop's end
    expect(p.beat()).toBeCloseTo(0);
    expect(p.level!('t1', 'f1', 'out')).toBe(-9);
    expect(p.level!('t1', 'f1', 'in')).toBeNull();
    // From past the loop's end it plays on, as in Live.
    e.send({ playing: true, beat: 9, meters: {} });
    now.mockReturnValue(2000);
    expect(p.beat()).toBeCloseTo(10);
  });

  it('shows a launch as waiting until the engine answers, then what is playing', async () => {
    const e = fakeEngine();
    const m = await import('./studio-engine');
    await m.engineReady();
    const s = m.playSession(SONG, false, {});
    s.launch('t1', 2);
    expect(s.queued()).toEqual({ t1: 2 });
    e.send({ playing: true, beat: 1, meters: {}, session: { t1: { slot: null, start: null, queued: 2 } } });
    expect(s.queued()).toEqual({ t1: 2 });
    e.send({ playing: true, beat: 4, meters: {}, session: { t1: { slot: 2, start: 4, queued: null } } });
    expect(s.queued()).toEqual({});
    expect(s.playing()).toEqual({ t1: { slot: 2, start: 4 } });
    s.launch('t1', null);
    e.send({ playing: true, beat: 5, meters: {}, session: { t1: { slot: 2, start: 4, queued: 'stop' } } });
    expect(s.queued()).toEqual({ t1: null });
  });

  it('previews a note on its track and counts in through the engine', async () => {
    const e = fakeEngine();
    const m = await import('./studio-engine');
    await m.engineReady();
    m.previewOn({ id: 't1', instrument: 'piano' }, 60, 0.5, 0.3);
    // A Library sound goes as itself, on no track.
    m.previewSound({ instrument: 'drums', kit: 'tight' as never }, 36, 0.6, 0.3);
    const c = m.countIn(120, 4);
    c.stop();
    await m.engineIdle();
    expect(e.calls).toEqual([['preview', 't1', 60, 0.5, 0.3], ['preview', { instrument: 'drums', kit: 'tight' }, 36, 0.6, 0.3], ['countIn', 4, 120], ['countIn', null]]);
  });

  it('sends calls one after another, so a stop, a load and a play arrive in that order however long each takes', async () => {
    const e = fakeEngine();
    const m = await import('./studio-engine');
    await m.engineReady();
    const music = (window as unknown as { mobius: { music: Record<string, (...a: unknown[]) => Promise<unknown>> } }).mobius.music;
    const slow = music.stop!;
    music.stop = (...a) => new Promise((r) => setTimeout(() => r(slow(...a)), 30));
    const first = m.play(SONG, 0);
    first.stop();
    m.play(SONG, 8);
    await m.engineIdle();
    expect(e.calls.map((c) => c[0])).toEqual(['load', 'play', 'stop', 'load', 'play']);
  });

  it('without the engine (a page in a browser) nothing sounds, and the playhead and launches still move by the clock', async () => {
    const e = fakeEngine(false);
    const m = await import('./studio-engine');
    expect(await m.engineReady()).toBe(false);
    expect(m.engineOn()).toBe(false);
    m.loadSong(SONG);
    const now = vi.spyOn(performance, 'now').mockReturnValue(1000);
    const p = m.play(SONG, 2, null);
    now.mockReturnValue(1500);
    expect(p.beat()).toBeCloseTo(2 + SONG.tempo / 120);
    p.stop();
    now.mockReturnValue(9000);
    expect(p.beat()).toBeCloseTo(2 + SONG.tempo / 120);
    const s = m.playSession(SONG, false, { a: 0 });
    expect(s.playing()).toEqual({ a: { slot: 0, start: 0 } });
    // A beat in, a stop waits for the next bar line (beat 4), then lands.
    now.mockReturnValue(9500);
    s.launch('a', null);
    expect(s.queued()).toEqual({ a: null });
    now.mockReturnValue(11_000);
    expect(s.queued()).toEqual({});
    expect(s.playing()).toEqual({});
    s.stop();
    now.mockRestore();
    expect(e.calls).toEqual([]);
  });
});
