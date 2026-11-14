import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { EnvelopeGraph, FilterGraph, Knob, StepGrid, envelopePoints, filterLevel, hertzLabel, musicQ, panLabel, secondsLabel } from './Instrument';

const noop = () => {};

describe('instrument controls', () => {
  it('reads times, hertz and pan the way a musician does', () => {
    expect(secondsLabel(0.005)).toBe('5 ms');
    expect(secondsLabel(1.2)).toBe('1.20 s');
    expect(hertzLabel(80)).toBe('80 Hz');
    expect(hertzLabel(1800)).toBe('1.8 kHz');
    expect(hertzLabel(12000)).toBe('12 kHz');
    expect(panLabel(0)).toBe('C');
    expect(panLabel(-0.4)).toBe('L 40');
    expect(panLabel(0.25)).toBe('R 25');
  });

  it('draws a knob as a slider with its formatted value, marked changed once off its origin', () => {
    const html = renderToStaticMarkup(<Knob label="Pan" value={-0.4} min={-1} max={1} step={0.01} format={panLabel} onChange={noop} />);
    expect(html).toContain('role="slider"');
    expect(html).toContain('aria-valuetext="L 40"');
    expect(html).toContain('data-changed="true"');
    expect(html).toContain('ui-knob-fill');
    const rest = renderToStaticMarkup(<Knob label="Drive" value={0} min={0} max={1} step={0.01} onChange={noop} />);
    expect(rest).not.toContain('data-changed');
    expect(rest).not.toContain('ui-knob-fill');
  });

  it('lays an envelope out in order, each time up to a quarter of the width and sustain held for a fifth', () => {
    const p = envelopePoints({ attack: 0.001, decay: 0.01, sustain: 0.5, release: 0.02 });
    expect(p.a).toBeCloseTo(0.02);
    expect(p.d).toBeCloseTo(0.04);
    expect(p.s).toBeCloseTo(0.24);
    expect(p.r).toBeCloseTo(0.26);
    const long = envelopePoints({ attack: 2, decay: 4, sustain: 1, release: 4 });
    expect(long.r).toBeCloseTo(0.95);
  });

  it('gives the envelope three handles that say their values, and the four values underneath', () => {
    const html = renderToStaticMarkup(<EnvelopeGraph value={{ attack: 0.012, decay: 0.3, sustain: 0.55, release: 0.8 }} reset={{ attack: 0.012, decay: 0.6, sustain: 0.7, release: 0.8 }} onChange={noop} />);
    expect(html.match(/role="slider"/g)).toHaveLength(3);
    expect(html).toContain('aria-valuetext="Decay 300 ms, sustain 55%"');
    expect(html).toContain('aria-valuetext="12 ms"');
    expect(html).toContain('<dd>800 ms</dd>');
    // Decay and sustain moved from the instrument's own; attack and release did not.
    expect(html.match(/data-changed="true"/g)).toHaveLength(2);
  });

  it('computes a two-pole filter: flat below a lowpass, its peak at cutoff set by Q, falling 12 dB an octave above', () => {
    expect(filterLevel('lowpass', 20, 2000, 0.707)).toBeCloseTo(0, 1);
    expect(filterLevel('lowpass', 2000, 2000, 4)).toBeCloseTo(20 * Math.log10(4), 5);
    expect(filterLevel('lowpass', 8000, 1000, 0.707)).toBeCloseTo(-36, 0);
    expect(filterLevel('highpass', 20000, 1000, 0.707)).toBeCloseTo(0, 1);
    expect(filterLevel('bandpass', 1000, 1000, 2)).toBeCloseTo(0, 5);
    expect(musicQ(0)).toBeCloseTo(0.7);
  });

  it('draws the filter with one point, and a dashed curve where the envelope opens it', () => {
    const html = renderToStaticMarkup(<FilterGraph value={{ cutoff: 1800, resonance: 0.3 }} min={80} max={12000} envAmount={0.5} onChange={noop} />);
    expect(html.match(/role="slider"/g)).toHaveLength(1);
    expect(html).toContain('aria-valuetext="Cutoff 1.8 kHz, resonance 30%"');
    expect(html).toContain('data-ghost');
    expect(html).toContain('<dd>7.2 kHz</dd>');
    const plain = renderToStaticMarkup(<FilterGraph value={{ cutoff: 1800, resonance: 0.3 }} onChange={noop} />);
    expect(plain).not.toContain('data-ghost');
  });

  it('shows Sweep as a drag-number field between Resonance and Opens to when it can be changed', () => {
    const html = renderToStaticMarkup(<FilterGraph value={{ cutoff: 1800, resonance: 0.3 }} min={80} max={12000} envAmount={0.5} envAmountReset={0.35} onEnvAmount={noop} onChange={noop} />);
    const names = [...html.matchAll(/<dt>([^<]+)<\/dt>/g)].map((m) => m[1]);
    expect(names).toEqual(['Cutoff', 'Resonance', 'Sweep', 'Opens to']);
    expect(html).toContain('role="spinbutton"');
    expect(html).toContain('aria-valuenow="50"');
    expect(html).toContain('aria-valuetext="50 %"');
    expect(html).toMatch(/data-changed="true"><dt>Sweep/);
    const fixed = renderToStaticMarkup(<FilterGraph value={{ cutoff: 1800, resonance: 0.3 }} envAmount={0.5} onChange={noop} />);
    expect(fixed).not.toContain('Sweep');
  });

  it('draws a step grid with one tab stop, named steps, velocity and accents', () => {
    const rows = [{ id: 'kick', name: 'Kick' }, { id: 'snare', name: 'Snare' }];
    const cells = [[1, 0, 0.7, 0], [0, 0, 0, 0.5]];
    const html = renderToStaticMarkup(<StepGrid label="Drums" rows={rows} cells={cells} steps={4} stepsPerBeat={2} now={2} onChange={noop} />);
    expect(html.match(/<button/g)).toHaveLength(8);
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Kick, step 1, velocity 127, accent"');
    expect(html).toContain('aria-label="Kick, step 3, velocity 89"');
    expect(html).toContain('aria-label="Snare, step 1"');
    expect(html.match(/data-now="true"/g)).toHaveLength(2);
    expect(html).toContain('--vel:0.5');
  });
});
