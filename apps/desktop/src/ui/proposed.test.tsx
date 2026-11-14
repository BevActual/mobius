import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { EnvelopeGraph, FilterGraph, Knob } from './Instrument';
import { EqGraph } from './Devices';
import { UndoToast } from './UndoToast';
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

describe('graphs Mobius proposed', () => {
  it('marks only the settings named, and keeps the real values for screen readers', () => {
    const html = renderToStaticMarkup(<FilterGraph value={{ cutoff: 1400, resonance: 0.35 }} proposed={{ cutoff: true }} onChange={noop} />);
    expect(html).toContain('data-proposed="true"');
    expect(html).toContain('aria-valuenow="1400"');
    expect(renderToStaticMarkup(<FilterGraph value={{ cutoff: 1400, resonance: 0.35 }} onChange={noop} />)).not.toContain('data-proposed');
    const env = renderToStaticMarkup(<EnvelopeGraph value={{ attack: 0.01, decay: 0.3, sustain: 0.6, release: 1.2 }} proposed={{ release: true }} onChange={noop} />);
    expect(env.match(/data-proposed/g)).toHaveLength(3); // the graph, the release handle and its readout
    const eq = renderToStaticMarkup(<EqGraph bands={[{ type: 'peak', freq: 400, gain: -3, q: 1 }, { type: 'peak', freq: 3000, gain: 2, q: 1 }]} proposed={[undefined, { gain: true }]} onChange={noop} />);
    expect(eq.match(/data-proposed/g)).toHaveLength(3); // the graph, band 2's dot and its gain
  });
});

describe('UndoToast', () => {
  it('can show a line with no action, and a running share', () => {
    const bare = renderToStaticMarkup(<UndoToast text="Exported" onDismiss={noop} />);
    expect(bare).not.toContain('ui-undo-btn');
    const busy = renderToStaticMarkup(<UndoToast text="Exporting" progress={0.42} undoLabel="Cancel" onUndo={noop} onDismiss={noop} />);
    expect(busy).toContain('42%');
    expect(busy).toContain('aria-valuenow="42"');
    expect(busy).toContain('Cancel');
  });
});
