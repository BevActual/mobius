import { BEATS_PER_BAR, KIT_DEFAULTS, audible, type Instrument, type KitSound, type Song, type Sound } from './song-format';
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

/** One drum hit through the kit: tuned up or down in semitones, its ring stretched by `decay`, brighter or darker by `tone`. */
function drum(ctx: AudioContext, out: AudioNode, pitch: number, at: number, velocity: number, noiseBuf: AudioBuffer, kit: KitSound = KIT_DEFAULTS) {
  const gain = ctx.createGain();
  gain.connect(out);
  const tune = 2 ** (kit.tune / 12);
  const bright = 2 ** ((kit.tone - 0.5) * 2);
  if (pitch === 36 || pitch === 45) {
    // Kick or tom: a sine falling in pitch.
    const osc = ctx.createOscillator();
    const ring = 0.35 * kit.decay;
    osc.frequency.setValueAtTime((pitch === 36 ? 140 : 220) * tune, at);
    osc.frequency.exponentialRampToValueAtTime((pitch === 36 ? 45 : 90) * tune, at + 0.15 * kit.decay);
    gain.gain.setValueAtTime(velocity, at);
    gain.gain.exponentialRampToValueAtTime(0.001, at + ring);
    osc.connect(gain);
    osc.start(at);
    osc.stop(at + ring + 0.05);
    return;
  }
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const filter = ctx.createBiquadFilter();
  const open = pitch === 46;
  const hat = pitch === 42 || open;
  filter.type = hat ? 'highpass' : 'bandpass';
  filter.frequency.value = Math.min(16000, (hat ? 7000 : pitch === 39 ? 1500 : 1800) * tune * bright);
  const len = (hat ? (open ? 0.3 : 0.05) : 0.18) * kit.decay;
  gain.gain.setValueAtTime(velocity * (hat ? 0.35 : 0.7), at);
  gain.gain.exponentialRampToValueAtTime(0.001, at + len);
  src.connect(filter);
  filter.connect(gain);
  src.start(at);
  src.stop(at + len + 0.05);
}

/** A soft clip for Drive: none at 0, warm and then square-ish towards 1. */
const curves = new Map<number, Float32Array>();
function driveCurve(amount: number): Float32Array {
  const key = Math.round(amount * 20);
  let curve = curves.get(key);
  if (!curve) {
    const k = 1 + key * 1.5;
    curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) { const x = (i / (curve.length - 1)) * 2 - 1; curve[i] = Math.tanh(k * x) / Math.tanh(k); }
    curves.set(key, curve);
  }
  return curve;
}

/**
 * A note through a track's own sound: a sine and a saw mixed by shape (two voices when detuned) and a sine sub an
 * octave down, through drive, a low-pass filter the envelope can sweep open, and an attack, decay, sustain and release
 * envelope. Vibrato wobbles every voice's pitch.
 */
function shaped(ctx: AudioContext, out: AudioNode, instrument: Instrument, sound: Sound, pitch: number, at: number, seconds: number, velocity: number) {
  const gain = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = 0.7 + sound.resonance * 14;
  const { attack, decay, sustain, release } = sound;
  const held = Math.max(attack, seconds);
  const end = at + held + release;
  // The filter opens by up to four octaves at the note's start and closes back over the decay.
  const open = Math.min(18000, sound.cutoff * 2 ** (sound.envAmount * 4));
  filter.frequency.setValueAtTime(sound.cutoff, at);
  if (sound.envAmount > 0.001) {
    filter.frequency.linearRampToValueAtTime(open, at + attack);
    filter.frequency.setTargetAtTime(sound.cutoff, at + attack, decay / 3);
  }
  let into: AudioNode = filter;
  if (sound.drive > 0.001) {
    const shaper = ctx.createWaveShaper();
    shaper.curve = driveCurve(sound.drive) as Float32Array<ArrayBuffer>;
    shaper.oversample = '2x';
    shaper.connect(filter);
    into = shaper;
  }
  filter.connect(gain);
  gain.connect(out);
  const peak = velocity * (instrument === 'pad' ? 0.18 : instrument === 'lead' ? 0.12 : instrument === 'bass' ? 0.35 : 0.3);
  const rest = Math.max(0.0001, peak * sustain);
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(peak, at + attack);
  gain.gain.setTargetAtTime(rest, at + attack, decay / 3);
  gain.gain.setTargetAtTime(0.0001, at + held, release / 4);
  // Vibrato: one slow sine moving every voice's pitch by up to `vibrato` cents.
  let wobble: GainNode | null = null;
  if (sound.vibrato > 0.5) {
    const lfo = ctx.createOscillator();
    lfo.frequency.value = sound.rate;
    wobble = ctx.createGain();
    wobble.gain.value = sound.vibrato;
    lfo.connect(wobble);
    lfo.start(at);
    lfo.stop(end + 0.05);
  }
  const voice = (type: OscillatorType, hz: number, cents: number, level: number) => {
    const osc = ctx.createOscillator();
    const mix = ctx.createGain();
    osc.type = type;
    osc.frequency.value = hz;
    osc.detune.value = cents;
    if (wobble) wobble.connect(osc.detune);
    mix.gain.value = level;
    osc.connect(mix);
    mix.connect(into);
    osc.start(at);
    osc.stop(end + 0.05);
  };
  const detunes = sound.detune > 0 ? [-sound.detune / 2, sound.detune / 2] : [0];
  for (const cents of detunes) {
    for (const [type, level] of [['sine', 1 - sound.shape], ['sawtooth', sound.shape]] as const) {
      if (level > 0.001) voice(type, freq(pitch), cents, level / detunes.length);
    }
  }
  if (sound.sub > 0.001) voice('sine', freq(pitch) / 2, 0, sound.sub * 0.8);
}

function tone(ctx: AudioContext, out: AudioNode, instrument: Instrument, pitch: number, at: number, seconds: number, velocity: number, sound?: Sound) {
  if (sound) { shaped(ctx, out, instrument, sound, pitch, at, seconds, velocity); return; }
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
export function previewNote(instrument: Instrument, pitch: number, velocity = 0.8, seconds = 0.35, sound?: Sound, kit?: KitSound): void {
  try {
    sampler ??= new AudioContext();
    void sampler.resume().catch(() => {});
    const at = sampler.currentTime + 0.01;
    if (instrument === 'drums') drum(sampler, sampler.destination, pitch, at, velocity, noise(sampler), kit);
    else tone(sampler, sampler.destination, instrument, pitch, at, seconds, velocity, sound);
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
        if (t.pan) {
          const pan = ctx.createStereoPanner();
          pan.pan.value = t.pan;
          out.connect(pan);
          pan.connect(master);
        } else out.connect(master);
        for (const n of t.notes) {
          if (n.start < s - 1e-9 || n.start >= s + span - 1e-9) continue;
          // A note that runs past the loop's end is cut there, so it does not ring over the next time round.
          const length = cycle ? Math.min(n.length, cycle.to - n.start) : n.length;
          if (t.instrument === 'drums') drum(ctx, out, n.pitch, at(n.start), n.velocity, noiseBuf, t.kit);
          else tone(ctx, out, t.instrument, n.pitch, at(n.start), length * spb, n.velocity, t.sound);
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
