import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MixerStrip, faderLabel } from './Mixer';

const noop = () => {};
const strip = (extra: Partial<Parameters<typeof MixerStrip>[0]> = {}) => renderToStaticMarkup(
  <MixerStrip name="Bass" volume={-3} onVolume={noop} pan={0} onPan={noop} mute={false} onMute={noop} solo={false} onSolo={noop} {...extra} />,
);

describe('MixerStrip', () => {
  it('names its fader for the track and reads the real volume', () => {
    const html = strip();
    expect(html).toContain('aria-label="Bass volume"');
    expect(html).toContain('aria-valuenow="-3"');
    expect(html).toContain('aria-label="Mute Bass"');
    expect(html).not.toContain('Arm Bass');
  });

  it('reads off at the floor, shows Arm only for a track that records, and marks what Mobius moved', () => {
    const html = strip({ volume: -60, onArm: noop, arm: true, proposed: { volume: true } });
    expect(html).toContain('aria-valuetext="Off"');
    expect(html).toContain('Arm Bass to record');
    expect(html).toContain('data-proposed="true"');
  });

  it('draws the Main strip without pan, mute or solo, and an empty fader until its volume can be set', () => {
    const main = renderToStaticMarkup(<MixerStrip name="Main" volume={0} onVolume={noop} />);
    expect(main).toContain('Main volume');
    expect(main).not.toContain('Pan');
    expect(main).not.toContain('Mute Main');
    expect(main).toContain('ui-strip-empty');
    const fixed = renderToStaticMarkup(<MixerStrip name="Main" />);
    expect(fixed).not.toContain('role="slider"');
    expect(fixed).toContain('Main level');
  });

  it('writes decibels with true minus signs', () => {
    expect(faderLabel(-3)).toBe('−3.0 dB');
    expect(faderLabel(1.5)).toBe('+1.5 dB');
    expect(faderLabel(-60)).toBe('−∞');
  });
});
