import { BEATS_PER_BAR, audible, type Instrument, type Song } from './song-format';
import { songBeat, type Cycle } from './studio-view';

/**
 * A small synthesiser for playing a song in the window: a few simple voices made with Web Audio, scheduled ahead of
 * time. Nothing is recorded or saved; it is only for hearing the notes.
 */
const freq = (pitch: number) => 440 * 2 ** ((pitch - 69) / 12);

function noise(ctx: AudioContext): AudioBuffer {
  const buf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

function drum(ctx: AudioContext, out: AudioNode, pitch: number, at: number, velocity: number, noiseBuf: AudioBuffer) {
  const gain = ctx.createGain();
  gain.connect(out);
  if (pitch === 36 || pitch === 45) {
    // Kick or tom: a sine falling in pitch.
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(pitch === 36 ? 140 : 220, at);
    osc.frequency.exponentialRampToValueAtTime(pitch === 36 ? 45 : 90, at + 0.15);
    gain.gain.setValueAtTime(velocity, at);
    gain.gain.exponentialRampToValueAtTime(0.001, at + 0.35);
    osc.connect(gain);
    osc.start(at);
    osc.stop(at + 0.4);
    return;
  }
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const filter = ctx.createBiquadFilter();
  const open = pitch === 46;
  const hat = pitch === 42 || open;
  filter.type = hat ? 'highpass' : 'bandpass';
  filter.frequency.value = hat ? 7000 : pitch === 39 ? 1500 : 1800;
  const len = hat ? (open ? 0.3 : 0.05) : 0.18;
  gain.gain.setValueAtTime(velocity * (hat ? 0.35 : 0.7), at);
  gain.gain.exponentialRampToValueAtTime(0.001, at + len);
  src.connect(filter);
  filter.connect(gain);
  src.start(at);
  src.stop(at + len + 0.05);
}

function tone(ctx: AudioContext, out: AudioNode, instrument: Instrument, pitch: number, at: number, seconds: number, velocity: number) {
  const gain = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.connect(gain);
  gain.connect(out);
  const f = freq(pitch);
  const voices: OscillatorType[] = instrument === 'bass' ? ['sawtooth'] : instrument === 'pad' ? ['sawtooth', 'sawtooth'] : instrument === 'lead' ? ['square'] : ['triangle', 'sine'];
  const attack = instrument === 'pad' ? 0.25 : 0.005;
  const release = instrument === 'pad' ? 0.5 : instrument === 'piano' ? 0.3 : 0.08;
  const peak = velocity * (instrument === 'pad' ? 0.18 : instrument === 'lead' ? 0.12 : instrument === 'bass' ? 0.35 : 0.3);
  filter.frequency.value = instrument === 'bass' ? 700 : instrument === 'pad' ? 1800 : 5000;
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(peak, at + attack);
  if (instrument === 'piano') gain.gain.exponentialRampToValueAtTime(Math.max(0.001, peak * 0.3), at + Math.max(attack + 0.01, seconds));
  else gain.gain.setValueAtTime(peak, at + Math.max(attack, seconds));
  gain.gain.exponentialRampToValueAtTime(0.0001, at + Math.max(attack, seconds) + release);
  voices.forEach((type, i) => {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = f * (instrument === 'piano' && i === 1 ? 2 : 1);
    if (instrument === 'pad') osc.detune.value = i === 0 ? -7 : 7;
    osc.connect(filter);
    osc.start(at);
    osc.stop(at + Math.max(attack, seconds) + release + 0.05);
  });
}

function tick(ctx: AudioContext, out: AudioNode, at: number, accent: boolean) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = accent ? 1760 : 1320;
  gain.gain.setValueAtTime(accent ? 0.28 : 0.16, at);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
  osc.connect(gain);
  gain.connect(out);
  osc.start(at);
  osc.stop(at + 0.06);
}

let sampler: AudioContext | null = null;
/** One note heard at once, as a key is pressed or a note is put on the roll. */
export function previewNote(instrument: Instrument, pitch: number, velocity = 0.8, seconds = 0.35): void {
  try {
    sampler ??= new AudioContext();
    void sampler.resume().catch(() => {});
    const at = sampler.currentTime + 0.01;
    if (instrument === 'drums') drum(sampler, sampler.destination, pitch, at, velocity, noise(sampler));
    else tone(sampler, sampler.destination, instrument, pitch, at, seconds, velocity);
  } catch { /* No sound here (a test browser); the note is still put in. */ }
}

export interface Player { stop(): void; beat(): number }

/**
 * Plays the song from `fromBeat`. With a `loop` it goes round those bars (a whole-song loop is { from: 0, to: the end });
 * without one it stops at the end. `beat()` says where it is now.
 */
export function play(song: Song, fromBeat = 0, loop: Cycle | null = null, click = false): Player {
  const ctx = new AudioContext();
  void ctx.resume().catch(() => {});
  const master = ctx.createGain();
  master.gain.value = 0.8;
  master.connect(ctx.destination);
  const noiseBuf = noise(ctx);
  const spb = 60 / song.tempo;
  const total = song.bars * BEATS_PER_BAR;
  const cycle = loop && loop.to > loop.from ? { from: Math.max(0, loop.from), to: Math.min(total, loop.to) } : null;
  const start = ctx.currentTime + 0.08;
  const tracks = audible(song);
  // Time is counted in beats played since Play; songBeat() turns that into where in the song it is.
  let scheduled = 0;
  let stopped = false;
  const ended = () => !cycle && fromBeat + scheduled >= total;
  const schedule = () => {
    if (stopped || ended()) return;
    const until = (ctx.currentTime - start) / spb + 2;
    while (scheduled < until && !ended()) {
      const s = songBeat(scheduled, fromBeat, cycle);
      // Played straight on to the loop's end (going round after it), or to the song's end without a loop.
      const end = cycle ? cycle.to : total;
      const span = Math.min(until - scheduled, end - s);
      if (span <= 1e-9) { scheduled += 1e-6; continue; }
      const at = (b: number) => start + (scheduled + (b - s)) * spb;
      // The metronome: a high tick on each bar, a lower one on the other beats.
      if (click) {
        for (let b = Math.ceil(s - 1e-6); b < s + span; b++) {
          if (at(b) < ctx.currentTime) continue;
          tick(ctx, master, at(b), b % BEATS_PER_BAR === 0);
        }
      }
      for (const t of tracks) {
        const out = ctx.createGain();
        out.gain.value = t.volume;
        out.connect(master);
        for (const n of t.notes) {
          if (n.start < s - 1e-9 || n.start >= s + span - 1e-9) continue;
          // A note that runs past the loop's end is cut there, so it does not ring over the next time round.
          const length = cycle ? Math.min(n.length, cycle.to - n.start) : n.length;
          if (t.instrument === 'drums') drum(ctx, out, n.pitch, at(n.start), n.velocity, noiseBuf);
          else tone(ctx, out, t.instrument, n.pitch, at(n.start), length * spb, n.velocity);
        }
      }
      scheduled += span;
    }
  };
  schedule();
  const timer = window.setInterval(schedule, 250);
  return {
    stop() { stopped = true; window.clearInterval(timer); void ctx.close(); },
    beat() { return songBeat(Math.max(0, (ctx.currentTime - start) / spb), fromBeat, cycle); },
  };
}
