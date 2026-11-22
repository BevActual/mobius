import type { MusicPosition } from '@mobius/shared';
import { BEATS_PER_BAR, type DrumPad, type Instrument, type KitSound, type Song, type Sound, type Track } from './song-format';
import type { Cycle } from './studio-view';
import { countIn as windowCountIn, play as windowPlay, playSession as windowSession, previewNote, type Player, type SessionPlayer, type SessionPlaying, type SessionQueued } from './studio-audio';

/**
 * Where Music makes its sound: the native engine in the host when it has opened a sound output (Andrew's decision,
 * 21 November: docs/reference/music-parity.md), else the Web Audio player in the window. Each function here has the
 * same shape as the window's, so the editor doesn't care which is playing.
 */
const music = () => (typeof window === 'undefined' ? undefined : window.mobius?.music);

/**
 * Calls to the engine, one after another. The bridge runs each call on its own task, so calls not awaited can land in
 * any order; a stop, a load and a play sent together must arrive as sent.
 */
let chain: Promise<unknown> = Promise.resolve();
function send(call: () => Promise<unknown> | undefined): void {
  chain = chain.then(call).catch(() => {});
}

/** Resolves once every call sent so far has been answered (for tests). */
export const engineIdle = () => chain;

let ready: boolean | null = null;
let asking: Promise<boolean> | null = null;
/** Opens the engine's sound output once; false (and the window plays) when there is no engine or no output. */
export function engineReady(): Promise<boolean> {
  if (ready !== null) return Promise.resolve(ready);
  asking ??= (async () => {
    const m = music();
    try { ready = !!m && (await m.engine()).ok === true; } catch { ready = false; }
    return ready;
  })();
  return asking;
}
/** Whether the engine is playing Music's sound (known once engineReady has answered). */
export const engineOn = () => ready === true;

/** The song the engine has, so a note can be previewed on a track without waiting for a load. */
let loaded = '';
export function loadSong(song: Song): void {
  const m = music();
  if (!engineOn() || !m) return;
  const text = JSON.stringify(song);
  if (text === loaded) return;
  loaded = text;
  send(() => m.load(song));
}

/** The engine's last position, carried forward between its events (about 30 a second) by the clock and the tempo. */
function follow(tempo: () => number, cycle: Cycle | null, from: number) {
  const m = music()!;
  const at = { beat: from, time: performance.now(), playing: false, meters: {} as MusicPosition['meters'], session: undefined as MusicPosition['session'] };
  const off = m.onPosition((p) => { at.beat = p.beat; at.time = performance.now(); at.playing = p.playing; at.meters = p.meters; at.session = p.session; });
  const beat = () => {
    if (!at.playing) return at.beat;
    let b = at.beat + ((performance.now() - at.time) / 60000) * tempo();
    if (cycle && b >= cycle.to) b = cycle.from + ((b - cycle.from) % (cycle.to - cycle.from));
    return b;
  };
  const level = (track: string, fx: string, part: string) => {
    const v = at.meters[`${track}/${fx}/${part}`];
    return v ? Math.max(v[0], v[1]) : null;
  };
  const meter = (id: string) => at.meters[id] ?? null;
  return { at, off, beat, level, meter };
}

/** Plays the Arrange view from `fromBeat`, round `loop` if given. */
export function play(songIn: Song, fromBeat = 0, loop: Cycle | null = null, click = false): Player {
  const m = music();
  if (!engineOn() || !m) return windowPlay(songIn, fromBeat, loop, click);
  let song = songIn;
  const f = follow(() => song.tempo, loop, fromBeat);
  loaded = JSON.stringify(song);
  send(() => m.load(song));
  send(() => m.play(fromBeat, loop ? { start: loop.from, end: loop.to } : null, click));
  return {
    stop() { f.off(); send(() => m.stop()); },
    beat: f.beat,
    update(next) { song = next; loadSong(next); },
    level: f.level,
    meter: f.meter,
  };
}

/** Plays the Session view: launches land on the next bar line. */
export function playSession(songIn: Song, click = false, launches: SessionQueued = {}): SessionPlayer {
  const m = music();
  if (!engineOn() || !m?.playSession || !m.launch) return windowSession(songIn, click, launches);
  let song = songIn;
  const f = follow(() => song.tempo, null, 0);
  // A launch is shown as waiting at once, until the engine says otherwise.
  let asked: SessionQueued = { ...launches };
  loaded = JSON.stringify(song);
  send(() => m.load(song));
  send(() => m.playSession!(click, launches));
  return {
    stop() { f.off(); send(() => m.stop()); },
    beat: f.beat,
    level: f.level,
    meter: f.meter,
    launch(trackId, slot) { asked = { ...asked, [trackId]: slot }; send(() => m.launch!(trackId, slot)); },
    update(next) { song = next; loadSong(next); },
    playing() {
      const out: SessionPlaying = {};
      for (const [id, s] of Object.entries(f.at.session ?? {})) if (s.slot !== null && s.start !== null) out[id] = { slot: s.slot, start: s.start };
      return out;
    },
    queued() {
      const out: SessionQueued = {};
      const heard = f.at.session ?? {};
      for (const [id, s] of Object.entries(heard)) if (s.queued !== null) out[id] = s.queued === 'stop' ? null : s.queued;
      // What was asked and not yet answered still waits.
      for (const [id, slot] of Object.entries(asked)) {
        const now = heard[id];
        if (now && (now.queued !== null || now.slot === slot)) continue;
        if (!(id in out)) out[id] = slot;
      }
      asked = Object.fromEntries(Object.entries(asked).filter(([id, slot]) => heard[id]?.slot !== slot));
      return out;
    },
  };
}

/** A bar of ticks before recording. */
export function countIn(tempo: number, beats = BEATS_PER_BAR): { done: Promise<void>; stop(): void } {
  const m = music();
  if (!engineOn() || !m?.countIn) return windowCountIn(tempo, beats);
  let timer: ReturnType<typeof setTimeout> | undefined;
  // The engine answers no "done": the wait is a bar long, from 50 ms on, as it ticks.
  const done = new Promise<void>((resolve) => { timer = setTimeout(resolve, (0.05 + (beats * 60) / tempo) * 1000); });
  send(() => m.countIn!(beats, tempo));
  return { done, stop() { clearTimeout(timer); send(() => m.countIn!(null)); } };
}

/** A note on a track, at once: through the engine (the track's own sound, kit and pad) or the window. */
export function previewOn(track: Pick<Track, 'id' | 'instrument' | 'sound' | 'kit'>, pitch: number, velocity = 0.8, seconds?: number, pad?: DrumPad): void {
  const m = music();
  if (engineOn() && m?.preview) { send(() => m.preview!(track.id, pitch, velocity, seconds)); return; }
  previewNote(track.instrument as Instrument, pitch, velocity, seconds, track.sound as Sound | undefined, track.kit as KitSound | undefined, pad);
}
