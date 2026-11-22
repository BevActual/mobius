import type { MusicPosition, MusicTake } from '@mobius/shared';
import { BEATS_PER_BAR, type ArrangeClip, type DrumPad, type Instrument, type KitSound, type Song, type Sound, type Track } from './song-format';
import type { Cycle } from './studio-view';

export interface Player {
  stop(): void;
  beat(): number;
  /** The song as it is now (same tempo and length): a new part, a changed sound or effect is heard from the next beat or two, with no restart. */
  update?(song: Song): void;
  /** How loud a part of a track's effect is sounding now, in dB (−90 for silence), or null when it isn't playing. */
  level?(track: string, fx: string, part: string): number | null;
  /** A track's output level (or `master`'s), left and right in dB, or null when there is none to show. */
  meter?(id: string): [number, number] | null;
}

/** What each track of the Session view is playing: the clip in that slot, since `start` (in beats played). */
export type SessionPlaying = Record<string, { slot: number; start: number }>;
/** A launch waiting for the next bar: a slot to start, or null to stop the track. */
export type SessionQueued = Record<string, number | null>;
export interface SessionPlayer extends Player {
  /** Start a track's clip (or stop the track, with null) at the next bar. */
  launch(trackId: string, slot: number | null): void;
  /** The song as it is now, so a change to a clip is heard the next time round. */
  update(song: Song): void;
  playing(): SessionPlaying;
  queued(): SessionQueued;
}

/**
 * Where Music makes its sound: the native engine in the host (Andrew's decision, 21 November:
 * docs/reference/music-parity.md). It plays silently on a computer with no sound output. Without the desktop app (a
 * page in a browser, for the design checks) nothing sounds, and a clock keeps the playhead moving as it would.
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
/** The open song's page, so the engine reads its audio clips' files from the song's folder. */
let songPath: string | null = null;
export function loadSong(song: Song, path?: string | null): void {
  const m = music();
  if (path !== undefined) songPath = path;
  if (!engineOn() || !m) return;
  const text = JSON.stringify(song) + (songPath ?? '');
  if (text === loaded) return;
  loaded = text;
  send(() => m.load(song, songPath));
}

/** The engine's last position, carried forward between its events (about 30 a second) by the clock and the tempo. */
function follow(tempo: () => number, cycle: Cycle | null, from: number) {
  const m = music()!;
  const at = { beat: from, time: performance.now(), playing: false, meters: {} as MusicPosition['meters'], levels: {} as Record<string, number>, session: undefined as MusicPosition['session'] };
  const off = m.onPosition((p) => {
    at.beat = p.beat; at.time = performance.now(); at.playing = p.playing; at.meters = p.meters; at.session = p.session;
    at.levels = (p as MusicPosition & { levels?: Record<string, number> }).levels ?? {};
  });
  const beat = () => {
    if (!at.playing) return at.beat;
    let b = at.beat + ((performance.now() - at.time) / 60000) * tempo();
    // As in Live (and the engine): the loop goes round only once the playhead is inside it; from past its end it plays on.
    if (cycle && at.beat < cycle.to && b >= cycle.to) b = cycle.from + ((b - cycle.from) % (cycle.to - cycle.from));
    return b;
  };
  /** The level of a part of the device being watched (see watchDevice), in dB, or null when it isn't reported. */
  const level = (track: string, fx: string, part: string) => at.levels[`${track}/${fx}/${part}`] ?? null;
  const meter = (id: string) => at.meters[id] ?? null;
  return { at, off, beat, level, meter };
}

let stopped: { meters: MusicPosition['meters']; time: number } = { meters: {}, time: 0 };
let stoppedOff: (() => void) | null = null;
/**
 * A meter while the song is stopped: what a key played or a note put in sounds on its track and Main, from the
 * engine's position (sent while something sounds), as Live's meters move. Null when nothing has sounded lately.
 */
export function stoppedMeter(id: string): [number, number] | null {
  const m = music();
  if (!engineOn() || !m) return null;
  stoppedOff ??= m.onPosition((p) => { if (!p.playing) stopped = { meters: p.meters, time: performance.now() }; });
  if (performance.now() - stopped.time > 250) return null;
  return stopped.meters[id] ?? null;
}

/** Plays the Arrange view from `fromBeat`, round `loop` if given. */
export function play(songIn: Song, fromBeat = 0, loop: Cycle | null = null, click = false): Player {
  const m = music();
  if (!engineOn() || !m) return clockPlay(songIn, fromBeat, loop);
  let song = songIn;
  const f = follow(() => song.tempo, loop, fromBeat);
  loaded = JSON.stringify(song) + (songPath ?? '');
  send(() => m.load(song, songPath));
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
  if (!engineOn() || !m?.playSession || !m.launch) return clockSession(songIn, launches);
  let song = songIn;
  const f = follow(() => song.tempo, null, 0);
  // A launch is shown as waiting at once, until the engine says otherwise.
  let asked: SessionQueued = { ...launches };
  loaded = JSON.stringify(song) + (songPath ?? '');
  send(() => m.load(song, songPath));
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

/**
 * The device open in the Workbench, whose parts' levels the engine then reports while playing (one at a time; null
 * for none). It holds across loads and plays.
 */
export function watchDevice(trackId: string | null, fxId: string | null): void {
  const m = music() as (ReturnType<typeof music> & { watch?: (track: string | null, fx: string | null) => Promise<unknown> }) | undefined;
  if (!engineOn() || !m?.watch) return;
  send(() => m.watch!(trackId, fxId));
}

let listening: string | null = null;
/**
 * The chosen track plays from a MIDI keyboard, as selecting a track arms it in Live: through the engine only (the
 * window has no MIDI of its own). Until a keyboard is listened to, the first one the computer has is.
 */
export function armKeys(trackId: string | null, onArm?: (heard: ArmHeard) => void): void {
  const m = music();
  if (!engineOn() || !m?.arm) return;
  send(async () => {
    const r = await m.arm!(trackId);
    if (r.ok) onArm?.({ input: r.input ?? null, ...(r.inputProblem ? { problem: r.inputProblem } : {}) });
  });
  if (trackId === null || listening !== null || !m.midiInputs || !m.listen) return;
  send(async () => {
    const found = await m.midiInputs!();
    if (!found.ok) return;
    listening = found.listening;
    const first = found.inputs[0];
    if (listening === null && first !== undefined) {
      const opened = await m.listen!(first);
      if (opened.ok) listening = opened.listening;
    }
  });
}

/** What arming an audio track found: the sound input it listens to, or null with `problem` saying why it can't. */
export interface ArmHeard { input: string | null; problem?: string }

/** Records the armed audio track's input while the song plays (true), or ends the take (false). Engine only. */
export function recordInput(on: boolean): void {
  const m = music();
  if (!engineOn() || !m?.record) return;
  send(() => m.record!(on));
}

/** Each take the engine saves, as it ends (Stop ends one too). */
export function onTake(listener: (take: MusicTake) => void): () => void {
  return music()?.onTake?.(listener) ?? (() => {});
}

/** A recorded take as an audio clip: where it starts and how long it runs in beats, playing its file from the take's offset. */
export function takeClip(take: MusicTake, tempo: number, id: string): ArrangeClip {
  const name = take.file.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') || 'Take';
  return {
    id,
    start: Math.max(0, take.start),
    length: Math.max(1 / 16, (take.seconds * tempo) / 60),
    name,
    notes: [],
    audio: { file: take.file, ...(take.offset > 0 ? { offset: take.offset } : {}) },
  };
}

/** A bar of ticks before recording. */
export function countIn(tempo: number, beats = BEATS_PER_BAR): { done: Promise<void>; stop(): void } {
  const m = music();
  if (!engineOn() || !m?.countIn) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = new Promise<void>((resolve) => { timer = setTimeout(resolve, (0.05 + (beats * 60) / tempo) * 1000); });
    return { done, stop() { clearTimeout(timer); } };
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  // The engine answers no "done": the wait is a bar long, from 50 ms on, as it ticks.
  const done = new Promise<void>((resolve) => { timer = setTimeout(resolve, (0.05 + (beats * 60) / tempo) * 1000); });
  send(() => m.countIn!(beats, tempo));
  return { done, stop() { clearTimeout(timer); send(() => m.countIn!(null)); } };
}

/** A note on a track, at once: through the engine (the track's own sound, kit and pad) or the window. */
export function previewOn(track: Pick<Track, 'id' | 'instrument' | 'sound' | 'kit'>, pitch: number, velocity = 0.8, seconds?: number, pad?: DrumPad): void {
  const m = music();
  void pad;
  if (engineOn() && m?.preview) send(() => m.preview!(track.id, pitch, velocity, seconds));
}

/** A sound from the Library on its own (no track): through the engine, or the window. */
export function previewSound(item: { instrument: Instrument; sound?: Sound; kit?: KitSound }, pitch: number, velocity = 0.8, seconds?: number): void {
  const m = music();
  if (engineOn() && m?.preview) {
    const sound = { instrument: item.instrument, ...(item.sound ? { sound: item.sound } : {}), ...(item.kit ? { kit: item.kit } : {}) };
    send(() => m.preview!(sound, pitch, velocity, seconds));
  }
}

/** The playhead without the engine: the tempo and the clock, round the loop, ending at the song's end (`endless`: never). */
function clockPlay(song: Song, fromBeat: number, loop: Cycle | null, endless = false): Player {
  const started = performance.now();
  let stopped: number | null = null;
  const beat = () => {
    let b = fromBeat + (((stopped ?? performance.now()) - started) / 60000) * song.tempo;
    if (loop && fromBeat < loop.to && b >= loop.to) b = loop.from + ((b - loop.from) % (loop.to - loop.from));
    return loop || endless ? b : Math.min(b, song.bars * BEATS_PER_BAR);
  };
  return { stop() { stopped ??= performance.now(); }, beat, update(next) { song = next; } };
}

/** The Session view's clock without the engine: what is launched starts at the next bar line (at once, before the first beat). */
function clockSession(song: Song, launches: SessionQueued): SessionPlayer {
  const clock = clockPlay(song, 0, null, true);
  let playing: SessionPlaying = {};
  let queued: SessionQueued = { ...launches };
  let asked = 0;
  const land = () => {
    const now = clock.beat();
    const bar = Math.ceil((asked + 1e-9) / BEATS_PER_BAR) * BEATS_PER_BAR;
    if (Object.keys(queued).length === 0 || (asked > 0 && now < bar)) return;
    const next = { ...playing };
    for (const [id, slot] of Object.entries(queued)) {
      if (slot === null) delete next[id];
      else next[id] = { slot, start: asked > 0 ? bar : 0 };
    }
    playing = next;
    queued = {};
  };
  return {
    stop: clock.stop,
    beat: clock.beat,
    launch(trackId, slot) { land(); asked = clock.beat(); queued = { ...queued, [trackId]: slot }; },
    update(next) { song = next; clock.update?.(next); },
    playing() { land(); return playing; },
    queued() { land(); return queued; },
  };
}

/** The shell's sample import, once it has one: saves bytes into the song's Samples folder, answering the file's path in it. */
type ImportSample = (path: string, name: string, base64: string) => Promise<{ ok: true; file: string } | { ok: false; message: string }>;

/** Base64 of bytes, in chunks so a long sample doesn't overflow the call stack. */
export function toBase64(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

/** A sound file from the computer, put in the song's Samples folder for a sampler or a pad: its path there, or why not. */
export async function importSample(songPath: string, file: File): Promise<{ file: string } | { problem: string }> {
  const m = music() as (ReturnType<typeof music> & { importSample?: ImportSample }) | undefined;
  if (!m?.importSample) return { problem: 'Adding samples needs a newer Mobius desktop app.' };
  if (!/\.(wav|wave|aif|aiff|flac|mp3|ogg)$/i.test(file.name)) return { problem: `“${file.name}” isn’t a sound file.` };
  if (file.size > 200 * 1024 * 1024) return { problem: `“${file.name}” is too big for a sample (over 200 MB).` };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const r = await m.importSample(songPath, file.name, toBase64(bytes));
  return r.ok ? { file: r.file } : { problem: r.message };
}
