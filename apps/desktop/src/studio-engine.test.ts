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
    onPosition: (l: (p: MusicPosition) => void) => { listener = l; return () => { listener = null; }; },
  };
  vi.stubGlobal('window', { mobius: { music } });
  return { calls, send: (p: MusicPosition) => listener?.(p), listening: () => listener !== null };
}

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); vi.useRealTimers(); });

describe('Music on the native engine', () => {
  it('plays through the engine once it opens: the song loaded, then played round the loop, and stopped', async () => {
    const e = fakeEngine();
    const m = await import('./studio-engine');
    expect(await m.engineReady()).toBe(true);
    const p = m.play(SONG, 4, { from: 0, to: 8 }, true);
    await new Promise((r) => setTimeout(r, 0));
    expect(e.calls.map((c) => c[0])).toEqual(['load', 'play']);
    expect(e.calls[1]).toEqual(['play', 4, { start: 0, end: 8 }, true]);
    p.stop();
    expect(e.calls.at(-1)).toEqual(['stop']);
    expect(e.listening()).toBe(false);
  });

  it('carries the beat on between position events by the tempo, wrapping round the loop, and reads meters', async () => {
    const e = fakeEngine();
    const m = await import('./studio-engine');
    await m.engineReady();
    const now = vi.spyOn(performance, 'now').mockReturnValue(1000);
    const p = m.play(SONG, 0, { from: 0, to: 8 });
    e.send({ playing: true, beat: 7, meters: { 't1/f1/out': [-12, -9] } });
    now.mockReturnValue(1500); // half a second at 120 bpm: one beat on, past the loop's end
    expect(p.beat()).toBeCloseTo(0);
    expect(p.level!('t1', 'f1', 'out')).toBe(-9);
    expect(p.level!('t1', 'f1', 'in')).toBeNull();
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
    const c = m.countIn(120, 4);
    c.stop();
    expect(e.calls).toEqual([['preview', 't1', 60, 0.5, 0.3], ['countIn', 4, 120], ['countIn', null]]);
  });

  it('leaves the window to play when the engine has no sound output', async () => {
    const e = fakeEngine(false);
    const m = await import('./studio-engine');
    expect(await m.engineReady()).toBe(false);
    expect(m.engineOn()).toBe(false);
    m.loadSong(SONG);
    expect(e.calls).toEqual([]);
  });
});
