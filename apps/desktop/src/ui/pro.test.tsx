import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { GainReductionMeter, LetterToggle, LevelMeter, decibelLabel, NumberField, Readout, Transport, barsLabel, clockLabel, levelPosition } from './Pro';

const noop = () => {};

describe('pro controls', () => {
  it('draws a number field as a spinbutton with its unit, sized to its widest value', () => {
    const html = renderToStaticMarkup(<NumberField label="Tempo" value={120} onChange={noop} min={30} max={300} reset={120} unit="BPM" />);
    expect(html).toContain('role="spinbutton"');
    expect(html).toContain('aria-valuenow="120"');
    expect(html).toContain('aria-valuetext="120 BPM"');
    expect(html).toContain('--chars:3');
    expect(html).toContain('Double-click to reset');
  });
  it('signs a transpose and sizes for the minus', () => {
    const up = renderToStaticMarkup(<NumberField label="Transpose" value={3} onChange={noop} min={-24} max={24} signed unit="st" />);
    expect(up).toContain('>+3<');
    expect(up).toContain('--chars:3');
  });
  it('shows a readout in its first format, and says what a click switches to', () => {
    const html = renderToStaticMarkup(<Readout label="Position" formats={[{ name: 'Bars', text: '12 . 3 . 2' }, { name: 'Time', text: '0:23.5' }]} />);
    expect(html).toContain('12 . 3 . 2');
    expect(html).toContain('Click to show time');
    expect(html).toContain('--chars:10');
    const still = renderToStaticMarkup(<Readout label="Signature" formats={[{ name: '', text: '4/4' }]} />);
    expect(still).toContain('role="status"');
    expect(still).not.toContain('<button');
  });
  it('draws letter toggles with full names, and an armed record', () => {
    const html = renderToStaticMarkup(<LetterToggle letter="R" label="Arm Bass" pressed armed onChange={noop} />);
    expect(html).toContain('aria-label="Arm Bass"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('data-armed="true"');
  });
  it('names the transport buttons with their keys, and latches loop', () => {
    const html = renderToStaticMarkup(<Transport playing={false} onPlay={noop} onStop={noop} loop onLoop={noop} metronome={false} onMetronome={noop} />);
    expect(html).toContain('title="Play (Space)"');
    expect(html).toContain('title="Stop (Enter)"');
    expect(html).toMatch(/aria-label="Loop"[^>]*aria-pressed="true"/);
    expect(html).toContain('title="Metronome (K)"');
    expect(renderToStaticMarkup(<Transport playing onPlay={noop} onStop={noop} />)).toContain('title="Pause (Space)"');
  });
  it('draws a stereo level meter on a dB scale with 0 dB marked', () => {
    const html = renderToStaticMarkup(<LevelMeter label="Drums level" />);
    expect(html.match(/class="ui-level-bar"/g)).toHaveLength(2);
    expect(html).toContain('role="meter"');
    expect(html).toContain('aria-valuemin="-60"');
    expect(levelPosition(0)).toBeCloseTo(60 / 66);
    expect(levelPosition(-90)).toBe(0);
    expect(levelPosition(12)).toBe(1);
  });
  it('draws a threshold you can drag only when one is given', () => {
    expect(renderToStaticMarkup(<LevelMeter label="Bus" />)).not.toContain('role="slider"');
    const html = renderToStaticMarkup(<LevelMeter label="Bus" threshold={-18} onThreshold={noop} />);
    expect(html).toContain('role="slider"');
    expect(html).toContain('aria-label="Bus threshold"');
    expect(html).toContain('aria-valuetext="\u221218 dB"');
    expect(html).toContain(`--at:${levelPosition(-18)}`);
    expect(decibelLabel(-4.25, 1)).toBe('\u22124.3 dB');
    expect(decibelLabel(3)).toBe('3 dB');
  });
  it('draws gain reduction as one meter from 0 down to its range, with the most taken off underneath', () => {
    const html = renderToStaticMarkup(<GainReductionMeter label="Bus gain reduction" range={20} />);
    expect(html).toContain('role="meter"');
    expect(html).toContain('aria-valuemax="20"');
    expect(html).toContain('>0.0</span><span class="ui-reduce-unit"> dB</span></button>');
    expect(renderToStaticMarkup(<GainReductionMeter label="GR" readout={false} />)).not.toContain('<button');
  });
  it('writes positions in bars and in time', () => {
    expect(barsLabel(0)).toBe('1 . 1 . 1');
    expect(barsLabel(45.25)).toBe('12 . 2 . 2');
    expect(barsLabel(7, 3)).toBe('3 . 2 . 1');
    expect(clockLabel(65.34)).toBe('1:05.3');
    expect(clockLabel(9)).toBe('0:09.0');
  });
});
