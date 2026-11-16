import { BEATS_PER_BAR, KIT_DEFAULTS, PAD_DEFAULTS, audible, autoValueAt, builtinDevice, drumKit, type DrumPad, type Effect, type Instrument, type KitSound, type Song, type Sound, type Track } from './song-format';
import { cableEnd, type Device } from './device-format';
import { clipHits, nextBar, songBeat, type Cycle } from './studio-view';

/**
 * A small synthesiser for playing a song in the window: a few simple voices made with Web Audio, scheduled ahead of
 * time. Nothing is recorded or saved; it is only for hearing the notes.
 */
const freq = (pitch: number) => 440 * 2 ** ((pitch - 69) / 12);

function noise(ctx: BaseAudioContext): AudioBuffer {
  const buf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

/** One drum hit through the kit: tuned up or down in semitones, its ring stretched by `decay`, brighter or darker by `tone`. */
function drum(ctx: BaseAudioContext, out: AudioNode, pitch: number, at: number, velocity: number, noiseBuf: AudioBuffer, kitIn: KitSound = KIT_DEFAULTS, pad: DrumPad = PAD_DEFAULTS) {
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
function shaped(ctx: BaseAudioContext, out: AudioNode, instrument: Instrument, sound: Sound, pitch: number, at: number, seconds: number, velocity: number) {
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

function tone(ctx: BaseAudioContext, out: AudioNode, instrument: Instrument, pitch: number, at: number, seconds: number, velocity: number, sound?: Sound) {
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

function tick(ctx: BaseAudioContext, out: AudioNode, at: number, accent: boolean) {
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
function impulse(ctx: BaseAudioContext, size: number, damp: number): AudioBuffer {
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
 * A track's effects, in order, from `input` to the returned output. An effect switched off is left out. Each one is a
 * device: the four built-in effects as their built-in devices, a song's own as written. `lfos` gathers the devices'
 * moving waves, so a strip that is replaced can stop them.
 */
export function effectChain(ctx: BaseAudioContext, input: AudioNode, fx: readonly Effect[], secondsPerBeat: number, lfos: OscillatorNode[] = [], tap?: (fx: string, part: string, node: AudioNode) => void): AudioNode {
  let at: AudioNode = input;
  for (const e of fx) {
    if (!e.on) continue;
    const partTap = tap && ((part: string, node: AudioNode) => tap(e.id, part, node));
    at = e.kind === 'device' ? deviceGraph(ctx, at, e.device, secondsPerBeat, lfos, true, partTap) : deviceGraph(ctx, at, builtinDevice(e), secondsPerBeat, lfos, false, partTap);
  }
  return at;
}

/** A gentle ceiling: unchanged up to 0.8, then rounding off towards 1, so a wild patch can't hurt ears or speakers. */
let limitCurve: Float32Array | null = null;
function softLimit(): Float32Array {
  if (limitCurve) return limitCurve;
  const n = 2049, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 4 - 2, a = Math.abs(x);
    const y = a <= 0.8 ? a : 0.8 + 0.2 * Math.tanh((a - 0.8) / 0.2);
    curve[i] = Math.sign(x) * y;
  }
  return (limitCurve = curve);
}

/**
 * A device's parts and cables as Web Audio nodes, from `input` (its input part) to the returned node (its output
 * part). A cable to a setting adds what comes down it to that setting, in the units it is heard in (a filter's cutoff
 * in Hz, a delay's time in seconds). With `limit`, the device's sound passes a soft limiter on its way out. `tap` is
 * handed each sounding part's output (not an LFO's), so the Workbench can show the level on the cables leaving it.
 */
export function deviceGraph(ctx: BaseAudioContext, input: AudioNode, device: Device, secondsPerBeat: number, lfos: OscillatorNode[] = [], limit = true, tap?: (part: string, node: AudioNode) => void): AudioNode {
  const nodes = new Map<string, { in: Record<string, AudioNode>; out: AudioNode | null; params: Record<string, AudioParam> }>();
  for (const part of device.parts) {
    const n = (v: string | number | undefined) => (typeof v === 'number' ? v : 0);
    switch (part.kind) {
      case 'input': nodes.set(part.id, { in: {}, out: input, params: {} }); break;
      case 'output': { const g = ctx.createGain(); nodes.set(part.id, { in: { in: g }, out: g, params: {} }); break; }
      case 'gain': { const g = ctx.createGain(); g.gain.value = n(part.gain); nodes.set(part.id, { in: { in: g }, out: g, params: { gain: g.gain } }); break; }
      case 'filter': {
        const f = ctx.createBiquadFilter(); f.type = part.type as BiquadFilterType; f.frequency.value = n(part.cutoff); f.gain.value = n(part.gain);
        // A shelf has no resonance (Web Audio ignores its Q), so it is left alone there, as the built-in EQ always has.
        if (part.type !== 'lowshelf' && part.type !== 'highshelf') f.Q.value = n(part.resonance);
        nodes.set(part.id, { in: { in: f }, out: f, params: { cutoff: f.frequency, resonance: f.Q, gain: f.gain } });
        break;
      }
      case 'delay': { const d = ctx.createDelay(4); d.delayTime.value = Math.min(4, n(part.time) * secondsPerBeat); nodes.set(part.id, { in: { in: d }, out: d, params: { time: d.delayTime } }); break; }
      case 'lfo': {
        const osc = ctx.createOscillator(); osc.type = part.shape as OscillatorType; osc.frequency.value = n(part.rate);
        const depth = ctx.createGain(); depth.gain.value = n(part.depth);
        osc.connect(depth); osc.start(); lfos.push(osc);
        nodes.set(part.id, { in: {}, out: depth, params: {} });
        break;
      }
      case 'drive': { const w = ctx.createWaveShaper(); w.curve = driveCurve(n(part.amount)) as Float32Array<ArrayBuffer>; w.oversample = '2x'; nodes.set(part.id, { in: { in: w }, out: w, params: {} }); break; }
      case 'compressor': {
        const c = ctx.createDynamicsCompressor();
        c.threshold.value = n(part.threshold); c.ratio.value = n(part.ratio); c.attack.value = n(part.attack); c.release.value = n(part.release); c.knee.value = n(part.knee);
        nodes.set(part.id, { in: { in: c }, out: c, params: {} });
        break;
      }
      case 'reverb': { const r = ctx.createConvolver(); r.buffer = impulse(ctx, n(part.size), n(part.damp)); nodes.set(part.id, { in: { in: r }, out: r, params: {} }); break; }
      case 'pan': { const p = ctx.createStereoPanner(); p.pan.value = n(part.pan); nodes.set(part.id, { in: { in: p }, out: p, params: { pan: p.pan } }); break; }
      case 'mix': {
        const out = ctx.createGain();
        const dry = ctx.createGain(); dry.gain.value = 1 - n(part.amount) * 0.5;
        const wet = ctx.createGain(); wet.gain.value = n(part.amount);
        dry.connect(out); wet.connect(out);
        nodes.set(part.id, { in: { dry, wet }, out, params: {} });
        break;
      }
    }
  }
  if (tap) for (const part of device.parts) { const out = nodes.get(part.id)?.out; if (out && part.kind !== 'lfo' && part.kind !== 'output') tap(part.id, out); }
  const parts = new Map(device.parts.map((p) => [p.id, p]));
  // With one cable into the output, the sound leaves straight from that part, with no extra node on the way.
  const outPart = device.parts.find((p) => p.kind === 'output');
  const intoOut = device.cables.filter(([, to]) => to === outPart?.id);
  const direct = intoOut.length === 1 ? nodes.get(intoOut[0]![0])?.out ?? null : null;
  for (const [from, to] of device.cables) {
    if (direct && to === outPart?.id) continue;
    const src = nodes.get(from)?.out;
    const end = cableEnd(to, parts);
    if (!src || typeof end === 'string') continue;
    const target = nodes.get(end.part);
    if ('param' in end) { const param = target?.params[end.param]; if (param) src.connect(param); } else { const node = target?.in[end.port]; if (node) src.connect(node); }
  }
  const last = direct ?? (outPart && intoOut.length > 0 ? nodes.get(outPart.id)?.out : null) ?? input;
  if (!limit) return last;
  const ceiling = ctx.createWaveShaper(); ceiling.curve = softLimit() as Float32Array<ArrayBuffer>;
  last.connect(ceiling);
  return ceiling;
}

/** A track's way into the mix: its volume, then its effects, then its place left to right. Notes connect to `input`. */
function trackStrip(ctx: BaseAudioContext, t: Track, master: AudioNode, secondsPerBeat: number, lfos: OscillatorNode[] = [], tap?: (fx: string, part: string, node: AudioNode) => void): AudioNode {
  const input = ctx.createGain();
  input.gain.value = t.volume;
  let out = effectChain(ctx, input, t.fx ?? [], secondsPerBeat, lfos, tap);
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

export interface Player {
  stop(): void;
  beat(): number;
  /** The song as it is now (same tempo and length): a new part, a changed sound or effect is heard from the next beat or two, with no restart. */
  update?(song: Song): void;
  /** How loud a part of a track's effect is sounding now, in dB (−90 for silence), or null when it isn't playing. */
  level?(track: string, fx: string, part: string): number | null;
}

/** A level in dB from a stretch of samples: their RMS, with silence at −90. */
export function rmsDb(samples: Float32Array): number {
  let sum = 0;
  for (const v of samples) sum += v * v;
  const rms = Math.sqrt(sum / Math.max(1, samples.length));
  return rms > 0 ? Math.max(-90, 20 * Math.log10(rms)) : -90;
}

/**
 * Plays the song from `fromBeat`. With a `loop` it goes round those bars (a whole-song loop is { from: 0, to: the end });
 * without one it stops at the end. `beat()` says where it is now.
 */
export function play(songIn: Song, fromBeat = 0, loop: Cycle | null = null, click = false): Player {
  let song = songIn;
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
  // Each track's volume, effects and pan are made once, so a delay's echoes and a reverb's tail carry on across beats. A
  // change to them (or a new track) makes a new strip; the old one lets what it is playing ring out.
  const stripOf = stripsFor(ctx, master, spb);
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
      for (const t of audible(song)) {
        const out = stripOf(t);
        // Volume automation: the line from here to the end of this stretch, as ramps on the track's own gain.
        if (t.volumeAuto && t.volumeAuto.length > 0 && out instanceof GainNode) {
          const g = out.gain;
          g.setValueAtTime(autoValueAt(t.volumeAuto, s, t.volume), Math.max(ctx.currentTime, at(s)));
          for (const p of t.volumeAuto) if (p.beat > s + 1e-9 && p.beat < s + span - 1e-9) g.linearRampToValueAtTime(p.value, at(p.beat));
          g.linearRampToValueAtTime(autoValueAt(t.volumeAuto, s + span - 1e-6, t.volume), at(s + span) - 1e-4);
        }
        for (const n of t.instrumentOn === false ? [] : t.notes) {
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
    update(next) { song = next; },
    level: stripOf.level,
  };
}

/** What a track's strip is built from: its pan and effects. Its volume is set on it as it changes. */
export const stripKey = (t: Track) => JSON.stringify([t.pan, t.fx ?? []]);

/**
 * Each track's strip, made the first time it plays and kept, so echoes and reverb tails carry on. A change to its pan
 * or effects makes a new one (the old one lets what it is playing ring out); a change of volume moves its fader.
 */
function stripsFor(ctx: BaseAudioContext, master: AudioNode, spb: number): ((t: Track) => AudioNode) & { level: (track: string, fx: string, part: string) => number | null } {
  const strips = new Map<string, { key: string; volume: number; out: AudioNode; lfos: OscillatorNode[]; taps: Map<string, AnalyserNode> }>();
  const strip = (t: Track) => {
    const key = stripKey(t);
    let s = strips.get(t.id);
    if (!s || s.key !== key) {
      // The old strip rings out; its devices' waves stop once that has had time to fade.
      for (const o of s?.lfos ?? []) o.stop(ctx.currentTime + 10);
      const lfos: OscillatorNode[] = [];
      // Each part of each effect is listened to, for the levels the Workbench draws on its cables.
      const taps = new Map<string, AnalyserNode>();
      const tap = (fx: string, part: string, node: AudioNode) => { const a = ctx.createAnalyser(); a.fftSize = 512; node.connect(a); taps.set(`${fx}/${part}`, a); };
      s = { key, volume: t.volume, out: trackStrip(ctx, t, master, spb, lfos, tap), lfos, taps };
      strips.set(t.id, s);
    }
    if (s.volume !== t.volume && s.out instanceof GainNode && !t.volumeAuto?.length) s.out.gain.setTargetAtTime(t.volume, ctx.currentTime, 0.02);
    s.volume = t.volume;
    return s.out;
  };
  const buf = new Float32Array(512);
  const level = (track: string, fx: string, part: string): number | null => {
    const a = strips.get(track)?.taps.get(`${fx}/${part}`);
    if (!a) return null;
    a.getFloatTimeDomainData(buf);
    return rmsDb(buf);
  };
  return Object.assign(strip, { level });
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
 * Plays the Session view: each track loops the clip launched on it, every launch landing on the next bar line. Nothing
 * plays until a clip is launched; the clock runs from Play, counting bars as the metronome does.
 */
export function playSession(songIn: Song, click = false, launches: SessionQueued = {}): SessionPlayer {
  let song = songIn;
  const ctx = new AudioContext();
  void ctx.resume().catch(() => {});
  const master = ctx.createGain();
  master.gain.value = 0.8;
  master.connect(ctx.destination);
  const noiseBuf = noise(ctx);
  const spb = 60 / song.tempo;
  const start = ctx.currentTime + 0.08;
  const strip = stripsFor(ctx, master, spb);
  const playing: SessionPlaying = {};
  const queued: SessionQueued = { ...launches };
  let scheduled = 0;
  let stopped = false;
  // Launches asked for before Play land on the first beat.
  const land = (at: number) => {
    for (const [id, slot] of Object.entries(queued)) {
      if (slot === null) delete playing[id]; else playing[id] = { slot, start: at };
      delete queued[id];
    }
  };
  land(0);
  const schedule = () => {
    if (stopped) return;
    const until = (ctx.currentTime - start) / spb + 2;
    while (scheduled < until - 1e-9) {
      // Up to the next bar line, where any waiting launch lands.
      const bar = nextBar(scheduled + 1e-6);
      const to = Math.min(until, bar);
      const at = (b: number) => start + b * spb;
      if (click) for (let b = Math.ceil(scheduled - 1e-6); b < to - 1e-9; b++) if (at(b) >= ctx.currentTime) tick(ctx, master, at(b), b % BEATS_PER_BAR === 0);
      const heard = new Set(audible(song).map((t) => t.id));
      for (const t of song.tracks) {
        const now = playing[t.id];
        const clip = now ? t.slots?.[now.slot] : null;
        if (!now || !clip || !heard.has(t.id) || t.instrumentOn === false) continue;
        const length = clip.bars * BEATS_PER_BAR;
        const out = strip(t);
        for (const { note: n, at: b } of clipHits(clip.notes, length, now.start, scheduled, to)) {
          if (at(b) < ctx.currentTime) continue;
          // A note is cut at the clip's end, so it does not ring over the next time round.
          const lengthIn = Math.min(n.length, length - n.start);
          if (t.instrument === 'drums') drum(ctx, out, n.pitch, at(b), n.velocity, noiseBuf, t.kit, t.pads?.[n.pitch]);
          else tone(ctx, out, t.instrument, n.pitch, at(b), lengthIn * spb, n.velocity, t.sound);
        }
      }
      scheduled = to;
      if (Math.abs(scheduled - bar) < 1e-6) land(bar);
    }
  };
  schedule();
  const timer = window.setInterval(schedule, 250);
  return {
    stop() { stopped = true; window.clearInterval(timer); void ctx.close(); },
    beat() { return Math.max(0, (ctx.currentTime - start) / spb); },
    launch(trackId, slot) { queued[trackId] = slot; },
    update(next) { song = next; },
    level: strip.level,
    playing() { return { ...playing }; },
    queued() { return { ...queued }; },
  };
}

/** Seconds of tail after the song's last bar, so a reverb or delay rings out in an export. */
export const RENDER_TAIL = 2;

/**
 * The whole song played into a buffer rather than the speakers, for Export: every audible track, its sound, effects,
 * pan and volume line, from the start to the last bar plus a short tail. 44.1 kHz stereo.
 */
export async function renderSong(song: Song, sampleRate = 44100, onProgress?: (done: number) => void, signal?: AbortSignal): Promise<AudioBuffer> {
  const spb = 60 / song.tempo;
  const total = song.bars * BEATS_PER_BAR;
  const seconds = Math.max(0, total * spb) + RENDER_TAIL;
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate);
  // Rendering takes a while on a long song: stop every few seconds of sound to say how far it has got, and to let it be
  // cancelled (a cancelled render is left suspended, so it does no more work).
  let cancelled: (() => void) | null = null;
  const stopped = new Promise<never>((_, reject) => { cancelled = () => reject(new DOMException('Export cancelled', 'AbortError')); });
  if (onProgress || signal) {
    for (let at = 4; at < seconds; at += 4) {
      void ctx.suspend(at).then(() => {
        if (signal?.aborted) { cancelled?.(); return undefined; }
        onProgress?.(at / seconds);
        return ctx.resume();
      });
    }
  }
  signal?.throwIfAborted();
  const master = ctx.createGain();
  master.gain.value = 0.8;
  master.connect(ctx.destination);
  const noiseBuf = noise(ctx);
  for (const t of audible(song)) {
    const out = trackStrip(ctx, t, master, spb);
    if (t.volumeAuto && t.volumeAuto.length > 0 && out instanceof GainNode) {
      out.gain.setValueAtTime(autoValueAt(t.volumeAuto, 0, t.volume), 0);
      for (const p of t.volumeAuto) out.gain.linearRampToValueAtTime(p.value, p.beat * spb);
    }
    if (t.instrumentOn === false) continue;
    for (const n of t.notes) {
      if (t.instrument === 'drums') drum(ctx, out, n.pitch, n.start * spb, n.velocity, noiseBuf, t.kit, t.pads?.[n.pitch]);
      else tone(ctx, out, t.instrument, n.pitch, n.start * spb, n.length * spb, n.velocity, t.sound);
    }
  }
  return Promise.race([ctx.startRendering(), stopped]);
}
