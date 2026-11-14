import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DeviceChain, DeviceFrame, EqGraph, bandLevel, eqLevel, type EqBand } from './Devices';

const noop = () => {};

describe('devices', () => {
  it('puts devices in a named list, each with a grip, an on switch, a title and a fold', () => {
    const html = renderToStaticMarkup(
      <DeviceChain label="Bass effects" count={2} onMove={noop}>
        <DeviceFrame title="EQ" index={0} on onToggle={noop} onCollapse={noop}>controls</DeviceFrame>
        <DeviceFrame title="Echo" index={1} on={false} onToggle={noop} collapsed onCollapse={noop} proposed>echo-controls</DeviceFrame>
      </DeviceChain>,
    );
    expect(html).toContain('role="list" aria-label="Bass effects"');
    expect(html.match(/role="listitem"/g)).toHaveLength(2);
    expect(html).toContain('aria-label="Move EQ"');
    expect(html).toContain('aria-label="EQ on"');
    expect(html).toContain('aria-label="Fold EQ"');
    expect(html).toContain('aria-label="Show Echo"');
    expect(html).toContain('data-off="true"');
    expect(html).toContain('data-proposed="true"');
    expect(html).toContain('controls');
    expect(html).not.toContain("echo-controls");
  });

  it('stacks the chain when it runs vertically, and runs sideways by default', () => {
    const noop = () => {};
    const side = renderToStaticMarkup(<DeviceChain label="FX" count={1} onMove={noop}><DeviceFrame title="EQ" index={0} on onToggle={noop}>x</DeviceFrame></DeviceChain>);
    expect(side).not.toContain('data-orientation');
    const stack = renderToStaticMarkup(<DeviceChain label="FX" count={1} onMove={noop} orientation="vertical"><DeviceFrame title="EQ" index={0} on onToggle={noop}>x</DeviceFrame></DeviceChain>);
    expect(stack).toContain('data-orientation="vertical"');
  });
  it('draws a lone frame without a grip', () => {
    const html = renderToStaticMarkup(<DeviceFrame title="Reverb" index={0} on onToggle={noop}>x</DeviceFrame>);
    expect(html).not.toContain('Move Reverb');
  });

  it('computes bands as Web Audio does: a bell reaches its gain at its frequency, a shelf beyond its corner', () => {
    expect(bandLevel({ type: 'peak', freq: 1000, gain: 6, q: 1 }, 1000)).toBeCloseTo(6, 3);
    expect(bandLevel({ type: 'peak', freq: 1000, gain: 6, q: 1 }, 20)).toBeCloseTo(0, 1);
    expect(bandLevel({ type: 'lowshelf', freq: 200, gain: -6, q: 0.71 }, 20)).toBeCloseTo(-6, 1);
    expect(bandLevel({ type: 'lowshelf', freq: 200, gain: -6, q: 0.71 }, 200)).toBeCloseTo(-3, 1);
    expect(bandLevel({ type: 'highshelf', freq: 4000, gain: 4, q: 0.71 }, 18000)).toBeCloseTo(4, 0);
    expect(bandLevel({ type: 'peak', freq: 1000, gain: 6, q: 1, on: false }, 1000)).toBe(0);
    const two: EqBand[] = [{ type: 'peak', freq: 1000, gain: 3, q: 1 }, { type: 'peak', freq: 1000, gain: 3, q: 1 }];
    expect(eqLevel(two, 1000)).toBeCloseTo(6, 3);
  });

  it('gives each band a numbered dot that says its values, and a column underneath', () => {
    const bands: EqBand[] = [{ type: 'lowshelf', freq: 120, gain: -4, q: 0.71 }, { type: 'peak', freq: 2800, gain: 4.5, q: 1.2 }];
    const html = renderToStaticMarkup(<EqGraph bands={bands} reset={[{ ...bands[0]!, gain: 0 }, bands[1]!]} onChange={noop} />);
    expect(html.match(/role="slider"/g)).toHaveLength(2);
    expect(html).toContain('aria-label="Band 1, Low shelf"');
    expect(html).toContain('aria-valuetext="2.8 kHz, +4.5 dB, Q 1.20"');
    expect(html).toContain('−4.0 dB');
    expect(html.match(/data-changed="true"/g)).toHaveLength(1);
    expect(html).toMatch(/data-selected="true"[^>]*>1</);
  });
  it('puts a lead control right after the title', () => {
    const html = renderToStaticMarkup(<DeviceFrame title="Instrument" index={0} on onToggle={noop} lead={<button type="button">Pad</button>}>x</DeviceFrame>);
    expect(html).toMatch(/ui-device-title">Instrument<\/h3><span class="ui-device-lead"><button type="button">Pad<\/button>/);
  });
});
