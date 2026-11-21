import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { WaveformView, peaksOf, sampleTime, warpBeatAt, warpBeatLabel } from './Waveform';

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

  it('reads the beat a moment falls on from the warp markers around it', () => {
    expect(warpBeatAt([], 1, 120)).toBe(2);
    expect(warpBeatAt([{ sample: 0.5, beat: 4 }], 1, 120)).toBe(5);
    const markers = [{ sample: 0, beat: 0 }, { sample: 1, beat: 2 }, { sample: 3, beat: 4 }];
    expect(warpBeatAt(markers, 0.5)).toBe(1);
    expect(warpBeatAt(markers, 2)).toBe(3);
    // Beyond the last marker, on from the last pair.
    expect(warpBeatAt(markers, 5)).toBe(6);
    expect(warpBeatLabel(0)).toBe('1.1.1');
    expect(warpBeatLabel(5.25)).toBe('2.2.2');
    expect(warpBeatLabel(6, 3)).toBe('3.1.1');
  });

  it('draws warp markers as sliders in their own strip, each held between its neighbours', () => {
    const html = renderToStaticMarkup(
      <WaveformView label="Sample" peaks={[0.5]} duration={4} value={{ start: 0, end: 4, loop: null }} onChange={noop}
        warp={[{ sample: 0, beat: 0 }, { sample: 1.5, beat: 4 }, { sample: 3, beat: 8 }]} />,
    );
    expect(html).toContain('ui-wave-warp');
    expect(html).toContain('data-warp="true"');
    expect(html.match(/class="ui-wave-marker"/g)).toHaveLength(3);
    expect(html).toMatch(/aria-label="Warp marker 2, beat 2.1.1" aria-valuemin="0.01" aria-valuemax="2.99" aria-valuenow="1.5" aria-valuetext="0:01.500 on 2.1.1"/);
    const none = renderToStaticMarkup(<WaveformView label="Sample" peaks={[0.5]} duration={2} value={{ start: 0, end: 2, loop: null }} onChange={noop} />);
    expect(none).not.toContain('ui-wave-warp');
    const empty = renderToStaticMarkup(<WaveformView label="Sample" peaks={[0.5]} duration={2} value={{ start: 0, end: 2, loop: null }} onChange={noop} warp={[]} />);
    expect(empty).toContain('title="Double-click to add a warp marker"');
  });
});
