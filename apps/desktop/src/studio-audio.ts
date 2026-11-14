import { BEATS_PER_BAR, KIT_DEFAULTS, PAD_DEFAULTS, audible, drumKit, type DrumPad, type Effect, type Instrument, type KitSound, type Song, type Sound, type Track } from './song-format';
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
function drum(ctx: AudioContext, out: AudioNode, pitch: number, at: number, velocity: number, noiseBuf: AudioBuffer, kitIn: KitSound = KIT_DEFAULTS, pad: DrumPad = PAD_DEFAULTS) {
  const kit = drumKit(kitIn, pad);
  velocity *= pad.level;
  const gain = ctx.createGain();
  if (pad.pan) { const panner = ctx.createStereoPanner(); panner.pan.value = pad.pan; gain.connect(panner); panner.connect(out); } else gain.connect(out);
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

/** A room's ring: noise fading over `size` seconds, its highs fading faster as `damp` goes up. Made once per size. */
function impulse(ctx: AudioContext, size: number, damp: number): AudioBuffer {
  const length = Math.max(1, Math.round(ctx.sampleRate * size));
  const buf = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    let low = 0;
    for (let i = 0; i < length; i++) {
      const fade = (1 - i / length) ** 3;
      const white = Math.random() * 2 - 1;
      // A one-pole low-pass, closing as the tail goes on, softens the highs.
      const k = 1 - damp * Math.min(0.95, i / length + 0.2);
      low += k * (white - low);
      data[i] = low * fade;
    }
  }
  return buf;
}

/**
 * A track's effects, in order, from `input` to the returned output. An effect switched off is left out. The delay's
 * echoes are timed to the song's beat.
 */
export function effectChain(ctx: BaseAudioContext, input: AudioNode, fx: readonly Effect[], secondsPerBeat: number): AudioNode {
  let at: AudioNode = input;
  for (const e of fx) {
    if (!e.on) continue;
    if (e.kind === 'eq') {
      const low = ctx.createBiquadFilter(); low.type = 'lowshelf'; low.frequency.value = e.lowFreq; low.gain.value = e.low;
      const mid = ctx.createBiquadFilter(); mid.type = 'peaking'; mid.frequency.value = e.midFreq; mid.Q.value = e.midQ; mid.gain.value = e.mid;
      const high = ctx.createBiquadFilter(); high.type = 'highshelf'; high.frequency.value = e.highFreq; high.gain.value = e.high;
      at.connect(low); low.connect(mid); mid.connect(high); at = high;
    } else if (e.kind === 'compressor') {
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = e.threshold; comp.ratio.value = e.ratio; comp.attack.value = e.attack; comp.release.value = e.release; comp.knee.value = 6;
      const makeup = ctx.createGain(); makeup.gain.value = 10 ** (e.makeup / 20);
      at.connect(comp); comp.connect(makeup); at = makeup;
    } else {
      // Delay and reverb: the dry sound goes straight on, the wet one is blended in by `mix`.
      const out = ctx.createGain();
      const dry = ctx.createGain(); dry.gain.value = 1 - e.mix * 0.5;
      const wet = ctx.createGain(); wet.gain.value = e.mix;
      at.connect(dry); dry.connect(out);
      if (e.kind === 'delay') {
        const delay = ctx.createDelay(4); delay.delayTime.value = Math.min(4, e.time * secondsPerBeat);
        const back = ctx.createGain(); back.gain.value = e.feedback;
        at.connect(delay); delay.connect(back); back.connect(delay); delay.connect(wet);
      } else {
        const room = ctx.createConvolver(); room.buffer = impulse(ctx as AudioContext, e.size, e.damp);
        at.connect(room); room.connect(wet);
      }
      wet.connect(out);
      at = out;
    }
  }
  return at;
}

/** A track's way into the mix: its volume, then its effects, then its place left to right. Notes connect to `input`. */
function trackStrip(ctx: AudioContext, t: Track, master: AudioNode, secondsPerBeat: number): AudioNode {
  const input = ctx.createGain();
  input.gain.value = t.volume;
  let out = effectChain(ctx, input, t.fx ?? [], secondsPerBeat);
  if (t.pan) {
    const pan = ctx.createStereoPanner();
    pan.pan.value = t.pan;
    out.connect(pan);
    out = pan;
  }
  out.connect(master);
  return input;
}

let sampler: AudioContext | null = null;
/** One note heard at once, as a key is pressed or a note is put on the roll. */
export function previewNote(instrument: Instrument, pitch: number, velocity = 0.8, seconds = 0.35, sound?: Sound, kit?: KitSound, pad?: DrumPad): void {
  try {
    sampler ??= new AudioContext();
    void sampler.resume().catch(() => {});
    const at = sampler.currentTime + 0.01;
    if (instrument === 'drums') drum(sampler, sampler.destination, pitch, at, velocity, noise(sampler), kit, pad);
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
  // Each track's volume, effects and pan are made once, so a delay's echoes and a reverb's tail carry on across beats.
  const strips = new Map(tracks.map((t) => [t.id, trackStrip(ctx, t, master, spb)]));
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
        const out = strips.get(t.id)!;
        for (const n of t.notes) {
          if (n.start < s - 1e-9 || n.start >= s + span - 1e-9) continue;
          // A note that runs past the loop's end is cut there, so it does not ring over the next time round.
          const length = cycle ? Math.min(n.length, cycle.to - n.start) : n.length;
          if (t.instrument === 'drums') drum(ctx, out, n.pitch, at(n.start), n.velocity, noiseBuf, t.kit, t.pads?.[n.pitch]);
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
