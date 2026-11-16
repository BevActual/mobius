import { describe, expect, it } from 'vitest';
import { parseDevice } from './device-format';
import { builtinDevice, newEffect, type BuiltinEffect } from './song-format';
import { benchBoxHeight, benchPatch, forwardCables } from './studio-bench';
import { layoutFlow } from './ui';

const tape = () => {
  const r = parseDevice({
    name: 'Tape Delay',
    parts: [
      { id: 'in', kind: 'input' }, { id: 'echo', kind: 'delay', time: 0.75 }, { id: 'tone', kind: 'filter', cutoff: 3000 },
      { id: 'back', kind: 'gain', gain: 0.45 }, { id: 'wobble', kind: 'lfo', rate: 0.6, depth: 0.004 }, { id: 'mix', kind: 'mix', amount: 0.35 }, { id: 'out', kind: 'output' },
    ],
    cables: [['in', 'mix.dry'], ['in', 'echo'], ['echo', 'tone'], ['tone', 'back'], ['back', 'echo'], ['tone', 'mix.wet'], ['mix', 'out'], ['wobble', 'echo.time']],
    controls: [],
  });
  if (!('device' in r)) throw new Error(r.error);
  return r.device;
};

describe('the Workbench’s picture of a device', () => {
  it('has a box per part with its inputs, its output and its settings as heard', () => {
    const { boxes } = benchPatch(tape());
    expect(boxes.map((b) => b.title)).toEqual(['Input', 'echo', 'tone', 'back', 'wobble', 'mix', 'Output']);
    const mix = boxes.find((b) => b.id === 'mix')!;
    expect(mix.inputs.map((p) => p.id)).toEqual(['dry', 'wet']);
    expect(mix.kindName).toBeNull();
    const tone = boxes.find((b) => b.id === 'tone')!;
    expect(tone.kindName).toBe('Filter');
    expect(tone.settings.find((s) => s.key === 'cutoff')).toEqual({ key: 'cutoff', name: 'Cutoff', text: '3.0 kHz', moves: true });
    expect(tone.settings.find((s) => s.key === 'type')).toMatchObject({ text: 'lowpass', moves: false });
    // An LFO sends a wave to settings, not sound; the input takes nothing in and the output sends nothing on.
    expect(boxes.find((b) => b.id === 'wobble')!.outputs).toEqual([{ id: 'out', label: 'Wave', kind: 'control' }]);
    expect(boxes[0]!.inputs).toEqual([]);
    expect(boxes.find((b) => b.id === 'wobble')!.settings.find((s) => s.key === 'depth')!.text).toBe('0.004');
    expect(boxes.at(-1)!.outputs).toEqual([]);
  });
  it('has a cable per cable, to a part’s input or to the setting it moves, each knowing whose level it carries', () => {
    const { cables, source } = benchPatch(tape());
    expect(cables).toHaveLength(8);
    expect(cables[0]).toEqual({ id: 'c0', from: { box: 'in', port: 'out' }, to: { box: 'mix', port: 'dry' } });
    expect(cables[1]!.to).toEqual({ box: 'echo', port: 'in' });
    expect(cables[7]).toEqual({ id: 'c7', from: { box: 'wobble', port: 'out' }, to: { box: 'echo', param: 'time' } });
    expect(source).toMatchObject({ c0: 'in', c4: 'back', c7: 'wobble' });
  });
  it('lays the parts out in the order the sound goes, without boxes in a column overlapping', () => {
    const patch = benchPatch(tape());
    const { boxes } = patch;
    // The echo's repeats (back → echo) run backwards, so they don't shape the layout.
    expect(forwardCables(patch).map((c) => `${c.from.box}>${c.to.box}`)).not.toContain('back>echo');
    expect(forwardCables(patch)).toHaveLength(7);
    const at = layoutFlow(boxes, forwardCables(patch), { column: 240, height: (b) => benchBoxHeight(boxes.find((x) => x.id === b.id)!) });
    expect(at.in!.x).toBeLessThan(at.echo!.x);
    expect(at.echo!.x).toBeLessThan(at.tone!.x);
    expect(at.mix!.x).toBeLessThan(at.out!.x);
    expect(Math.max(...Object.values(at).map((p) => p.x))).toBe(240 * 4);
    const columns = new Map<number, string[]>();
    for (const b of boxes) columns.set(at[b.id]!.x, [...(columns.get(at[b.id]!.x) ?? []), b.id]);
    for (const ids of columns.values()) {
      const spans = ids.map((id) => ({ top: at[id]!.y, bottom: at[id]!.y + benchBoxHeight(boxes.find((b) => b.id === id)!) })).sort((a, b) => a.top - b.top);
      for (let i = 1; i < spans.length; i++) expect(spans[i]!.top).toBeGreaterThanOrEqual(spans[i - 1]!.bottom);
    }
  });
  it('shows a built-in effect as the device it is made of', () => {
    const { boxes, cables } = benchPatch(builtinDevice(newEffect('delay', 'fx1') as BuiltinEffect));
    expect(boxes.map((b) => b.id)).toEqual(['in', 'echo', 'back', 'mix', 'out']);
    expect(cables.some((c) => c.from.box === 'back' && c.to.box === 'echo')).toBe(true);
    const eq = benchPatch(builtinDevice({ ...(newEffect('eq', 'fx1') as BuiltinEffect), low: 3 } as BuiltinEffect));
    expect(eq.boxes.find((b) => b.id === 'low')!.settings.find((s) => s.key === 'gain')!.text).toBe('+3.0 dB');
    expect(eq.boxes.find((b) => b.id === 'low')!.settings.map((s) => s.key)).toEqual(['type', 'cutoff', 'gain']);
    expect(eq.boxes.find((b) => b.id === 'mid')!.settings.map((s) => s.key)).toContain('resonance');
  });
});
