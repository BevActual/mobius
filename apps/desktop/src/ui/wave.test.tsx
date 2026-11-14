import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { WaveformView, peaksOf, sampleTime } from './Waveform';

const noop = () => {};

describe('waveform view', () => {
  it('reads times as a sampler does', () => {
    expect(sampleTime(0)).toBe('0:00.000');
    expect(sampleTime(1.25)).toBe('0:01.250');
    expect(sampleTime(75.5)).toBe('1:15.500');
  });

  it('finds the loudest sample in each slice', () => {
    expect(peaksOf([0, 0.5, -0.9, 0.1, 0.2, -0.3], 3)).toEqual([0.5, 0.9, 0.3]);
    expect(peaksOf([2, -2], 2)).toEqual([1, 1]);
  });

  it('draws start and end as sliders that stop at the loop, and the loop edges inside them', () => {
    const html = renderToStaticMarkup(
      <WaveformView label="Sample" peaks={[0.2, 0.8, 0.4]} duration={4} value={{ start: 0.12, end: 3.6, loop: { start: 1, end: 2 } }} onChange={noop} playhead={1.4} />,
    );
    expect(html.match(/role="slider"/g)).toHaveLength(4);
    expect(html).toMatch(/aria-valuemin="0" aria-valuemax="1" aria-valuenow="0.12" aria-valuetext="0:00.120"/);
    expect(html).toMatch(/aria-label="Loop end" aria-valuemin="1.01" aria-valuemax="3.6"/);
    expect(html).toContain('0:01.000–0:02.000');
    expect(html).toContain('<dd>0:03.480</dd>');
    expect(html).toContain('ui-wave-playhead');
  });

  it('has no loop edges and offers a loop when there is none', () => {
    const html = renderToStaticMarkup(<WaveformView label="Sample" peaks={[0.5]} duration={2} value={{ start: 0, end: 2, loop: null }} onChange={noop} />);
    expect(html.match(/role="slider"/g)).toHaveLength(2);
    expect(html).toContain('title="Press to add a loop"');
    expect(html).toContain('<dd>Off</dd>');
  });
});
