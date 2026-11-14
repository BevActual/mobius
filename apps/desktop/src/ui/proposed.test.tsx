import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Knob } from './Instrument';
import { ParamCell, Slider } from './Slider';

const noop = () => {};

describe('values Mobius proposed', () => {
  it('marks a knob, a parameter cell and a slider as proposed only when asked', () => {
    expect(renderToStaticMarkup(<Knob label="Drive" value={0.45} min={0} max={1} step={0.01} proposed onChange={noop} />)).toContain('data-proposed="true"');
    expect(renderToStaticMarkup(<ParamCell label="Drive" value={0.45} min={0} max={1} step={0.01} proposed onChange={noop} />)).toContain('data-proposed="true"');
    expect(renderToStaticMarkup(<Slider label="Warmth" value={20} proposed onChange={noop} />)).toContain('data-proposed="true"');
    expect(renderToStaticMarkup(<Knob label="Drive" value={0.45} min={0} max={1} step={0.01} onChange={noop} />)).not.toContain('data-proposed');
  });

  it('draws the real value on first render, and screen readers always hear the real value', () => {
    const html = renderToStaticMarkup(<Knob label="Cutoff" value={1400} min={80} max={12000} scale="log" format={(v) => `${Math.round(v)} Hz`} proposed onChange={noop} />);
    expect(html).toContain('aria-valuenow="1400"');
    expect(html).toContain('aria-valuetext="1400 Hz"');
    expect(html).toContain('1400 Hz');
    expect(renderToStaticMarkup(<ParamCell label="Drive" value={45} onChange={noop} />)).toContain('value="45"');
  });
});
