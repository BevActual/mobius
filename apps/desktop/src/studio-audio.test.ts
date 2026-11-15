import { describe, expect, it } from 'vitest';
import { parseDevice } from './device-format';
import { newEffect, type Effect } from './song-format';
import { deviceGraph, effectChain, rmsDb } from './studio-audio';

/**
 * A pretend audio context that writes down every node made, every value set on it and every connection, so a graph
 * can be compared with another without a sound card.
 */
function recorder() {
  const log: string[] = [];
  let n = 0;
  const param = (owner: string, name: string) => {
    const p = { owner: `${owner}.${name}`, _v: 0 };
    return new Proxy(p, {
      set(t, k, v) { if (k === 'value') log.push(`${p.owner}=${Number(v).toFixed(6)}`); (t as Record<string | symbol, unknown>)[k] = v; return true; },
    });
  };
  const node = (kind: string, params: string[] = []) => {
    const id = `${kind}#${++n}`;
    const o: Record<string, unknown> = { id, connect(to: { id?: string; owner?: string }) { log.push(`${id} -> ${to.id ?? to.owner}`); return to; }, start() { log.push(`${id} start`); }, stop() {} };
    for (const p of params) o[p] = param(id, p);
    return new Proxy(o, { set(t, k, v) { if (typeof k === 'string' && !params.includes(k)) log.push(`${id}.${k}=${k === 'buffer' ? `buffer(${(v as { length: number }).length})` : k === 'curve' ? 'curve' : String(v)}`); t[k as string] = v; return true; } });
  };
  const ctx = {
    sampleRate: 1000,
    createGain: () => node('gain', ['gain']),
    createBiquadFilter: () => node('filter', ['frequency', 'Q', 'gain']),
    createDynamicsCompressor: () => node('compressor', ['threshold', 'ratio', 'attack', 'release', 'knee']),
    createDelay: (max: number) => { const d = node('delay', ['delayTime']); log.push(`${String(d.id)} max ${max}`); return d; },
    createConvolver: () => node('convolver'),
    createOscillator: () => node('oscillator', ['frequency']),
    createWaveShaper: () => node('shaper'),
    createStereoPanner: () => node('panner', ['pan']),
    createBuffer: (_ch: number, length: number) => ({ length, getChannelData: () => new Float32Array(length) }),
  };
  return { ctx: ctx as unknown as BaseAudioContext, log, input: node('input') as unknown as AudioNode };
}

/** Music's effects as they were before they became devices, kept here to prove the devices sound the same. */
function oldChain(ctx: BaseAudioContext, input: AudioNode, fx: readonly Effect[], secondsPerBeat: number): AudioNode {
  let at: AudioNode = input;
  for (const e of fx) {
    if (!e.on || e.kind === 'device') continue;
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
      const out = ctx.createGain();
      const dry = ctx.createGain(); dry.gain.value = 1 - e.mix * 0.5;
      const wet = ctx.createGain(); wet.gain.value = e.mix;
      at.connect(dry); dry.connect(out);
      if (e.kind === 'delay') {
        const delay = ctx.createDelay(4); delay.delayTime.value = Math.min(4, e.time * secondsPerBeat);
        const back = ctx.createGain(); back.gain.value = e.feedback;
        at.connect(delay); delay.connect(back); back.connect(delay); delay.connect(wet);
      } else {
        const room = ctx.createConvolver(); room.buffer = ctx.createBuffer(2, Math.max(1, Math.round(ctx.sampleRate * e.size)), ctx.sampleRate);
        at.connect(room); room.connect(wet);
      }
      wet.connect(out);
      at = out;
    }
  }
  return at;
}

/**
 * A graph with its nodes named by what they are and how they are set ("filter{frequency=120,gain=3,type=lowshelf}")
 * rather than the order they were made in, as the list of what each feeds, so two graphs built in a different order
 * compare equal when they would sound the same.
 */
function shape(log: readonly string[]): string[] {
  const settings = new Map<string, string[]>();
  for (const l of log) {
    const m = /^(\w+#\d+)\.(\w+)=(.*)$/.exec(l) ?? /^(\w+#\d+) (max \d+)$/.exec(l);
    if (!m) continue;
    const list = settings.get(m[1]!) ?? [];
    list.push(m[3] !== undefined ? `${m[2]}=${m[3]}` : m[2]!);
    settings.set(m[1]!, list);
  }
  const sig = (id: string) => `${id.split('#')[0]}{${(settings.get(id) ?? []).sort().join(',')}}`;
  return log.flatMap((l) => {
    const m = /^(\w+#\d+) -> (\w+#\d+)(\.\w+)?$/.exec(l);
    return m ? [`${sig(m[1]!)} -> ${sig(m[2]!)}${m[3] ?? ''}`] : [];
  }).sort();
}

const FX: Effect[] = [
  { ...newEffect('eq', 'fx1'), low: 3, mid: -4, midQ: 2, high: 5 } as Effect,
  { ...newEffect('compressor', 'fx2'), threshold: -24, makeup: 6 } as Effect,
  { ...newEffect('delay', 'fx3'), time: 0.5, feedback: 0.6, mix: 0.4 } as Effect,
  { ...newEffect('reverb', 'fx4'), size: 2.5, mix: 0.3 } as Effect,
];

describe('the four effects as devices', () => {
  it('make the same nodes, set the same way and wired the same way, as the effects did', () => {
    for (const e of FX) {
      const a = recorder(), b = recorder();
      oldChain(a.ctx, a.input, [e], 0.5);
      effectChain(b.ctx, b.input, [e], 0.5);
      expect(shape(b.log), e.kind).toEqual(shape(a.log));
      expect(shape(b.log).length, e.kind).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('a device of its own', () => {
  it('is wired as its cables say, an LFO moving the setting it goes to, and leaves through a soft limiter', () => {
    const r = parseDevice({
      name: 'Wobble', parts: [{ id: 'in', kind: 'input' }, { id: 'tone', kind: 'filter', cutoff: 800 }, { id: 'lfo', kind: 'lfo', rate: 2, depth: 300 }, { id: 'out', kind: 'output' }],
      cables: [['in', 'tone'], ['tone', 'out'], ['lfo', 'tone.cutoff']], controls: [],
    });
    if (!('device' in r)) throw new Error(r.error);
    const { ctx, log, input } = recorder();
    const lfos: OscillatorNode[] = [];
    effectChain(ctx, input, [{ id: 'fx1', kind: 'device', on: true, device: r.device }], 0.5, lfos);
    expect(log).toContain('input#1 -> filter#2');
    expect(log).toContain('filter#2.frequency=800.000000');
    expect(log).toContain('oscillator#3 -> gain#4');
    expect(log).toContain('gain#4.gain=300.000000');
    expect(log).toContain('gain#4 -> filter#2.frequency');
    expect(log).toContain('oscillator#3 start');
    expect(lfos).toHaveLength(1);
    // One cable into the output: the sound leaves from the filter, through the limiter.
    expect(log).toContain('filter#2 -> shaper#6');
  });
  it('is left out while switched off', () => {
    const { ctx, log, input } = recorder();
    const out = effectChain(ctx, input, [{ ...FX[0]!, on: false }], 0.5);
    expect(out).toBe(input);
    expect(log).toEqual([]);
  });
});

describe('the levels the Workbench shows', () => {
  it('listens to each part that sounds, not the LFOs or the output, and adds nothing to the sound', () => {
    const r = parseDevice({
      name: 'Wobble', parts: [{ id: 'in', kind: 'input' }, { id: 'tone', kind: 'filter' }, { id: 'lfo', kind: 'lfo', depth: 300 }, { id: 'out', kind: 'output' }],
      cables: [['in', 'tone'], ['tone', 'out'], ['lfo', 'tone.cutoff']], controls: [],
    });
    if (!('device' in r)) throw new Error(r.error);
    const a = recorder(), b = recorder();
    deviceGraph(a.ctx, a.input, r.device, 0.5, [], true);
    const tapped: string[] = [];
    deviceGraph(b.ctx, b.input, r.device, 0.5, [], true, (part) => tapped.push(part));
    expect(tapped).toEqual(['in', 'tone']);
    expect(b.log).toEqual(a.log);
  });
  it('reads a level in dB from the samples: full scale is 0, half is about −6, silence −90', () => {
    expect(rmsDb(new Float32Array(64).fill(1))).toBeCloseTo(0, 6);
    expect(rmsDb(new Float32Array(64).fill(0.5))).toBeCloseTo(-6.02, 2);
    expect(rmsDb(new Float32Array(64))).toBe(-90);
  });
});
