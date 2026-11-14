import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AutomationLane, beatLabel, laneValueAt, type AutomationPoint } from './Automation';
import { StepGrid } from './Instrument';
import { PadGrid } from './Pads';

const noop = () => {};
const pts: AutomationPoint[] = [{ beat: 0, value: 0.2 }, { beat: 4, value: 0.8 }, { beat: 6, value: 0.5 }];

describe('automation lane', () => {
  it('reads a beat as bar.beat.sixteenth', () => {
    expect(beatLabel(0)).toBe('1.1.1');
    expect(beatLabel(5.25)).toBe('2.2.2');
    expect(beatLabel(7.75)).toBe('2.4.4');
    expect(beatLabel(3, 3)).toBe('2.1.1');
  });

  it('holds flat before the first point and after the last, and runs straight between', () => {
    expect(laneValueAt(pts, -1)).toBe(0.2);
    expect(laneValueAt(pts, 2)).toBeCloseTo(0.5);
    expect(laneValueAt(pts, 5)).toBeCloseTo(0.65);
    expect(laneValueAt(pts, 20)).toBe(0.5);
    expect(laneValueAt([], 3, 0.7)).toBe(0.7);
  });

  it('is as wide as the arrangement, names its points, and takes one tab stop', () => {
    const html = renderToStaticMarkup(<AutomationLane label="Volume" points={pts} beats={16} pxPerBeat={24} onChange={noop} />);
    expect(html).toContain('width:384px');
    expect(html).toContain('aria-label="Volume automation"');
    expect(html.match(/role="slider"/g)).toHaveLength(3);
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
    expect(html).toContain('aria-valuetext="2.1.1, 80%"');
    expect(html).toContain('left:25%');
    // Three bar lines inside four bars; no dashes anywhere (dashes mean Mobius made it).
    expect(html.match(/ui-graph-guide/g)).toHaveLength(3);
    expect(html).not.toContain('dash');
  });

  it('shows an empty lane at the setting’s own level, muted, and lets the keyboard add the first point', () => {
    const html = renderToStaticMarkup(<AutomationLane label="Cutoff" points={[]} beats={8} pxPerBeat={20} empty={0.6} format={(v) => `${Math.round(v * 100)} %`} onChange={noop} />);
    expect(html).toContain('data-empty="true"');
    expect(html).toContain('data-ghost="true"');
    expect(html).toContain('M 0 40 L 100 40');
    expect(html).toContain('60 %');
    expect(html).toMatch(/class="ui-lane-plot"[^>]*tabindex="0"/);
    expect(html).not.toContain('role="slider"');
  });

  it('takes no tab stop when disabled', () => {
    const html = renderToStaticMarkup(<AutomationLane label="Pan" points={pts} beats={8} pxPerBeat={20} onChange={noop} disabled />);
    expect(html).not.toContain('tabindex="0"');
    expect(html).toContain('data-disabled="true"');
  });

  it('lets StepGrid and PadGrid fill their width only when asked', () => {
    const rows = [{ id: 'k', name: 'Kick' }];
    expect(renderToStaticMarkup(<StepGrid rows={rows} cells={[[1]]} onChange={noop} fill />)).toContain('data-fill="true"');
    expect(renderToStaticMarkup(<StepGrid rows={rows} cells={[[1]]} onChange={noop} />)).not.toContain('data-fill');
    const pads = [{ id: 'a', name: 'Kick' }, { id: 'b', name: 'Snare' }];
    expect(renderToStaticMarkup(<PadGrid label="Kit" pads={pads} chosen={0} onChoose={noop} fill columns={2} />)).toContain('data-fill="true"');
  });

  it('keeps its head in its own band, and can leave it out and take a track colour', () => {
    const withHead = renderToStaticMarkup(<AutomationLane label="Volume" points={pts} beats={8} pxPerBeat={20} onChange={noop} />);
    expect(withHead).toContain('class="ui-lane-head"');
    expect(withHead).not.toContain('data-headless');
    const bare = renderToStaticMarkup(<AutomationLane label="Volume" points={pts} beats={8} pxPerBeat={20} color="violet" head={false} onChange={noop} />);
    expect(bare).not.toContain('ui-lane-head');
    expect(bare).toContain('data-headless="true"');
    expect(bare).toContain('data-color="violet"');
    expect(bare).toContain('aria-label="Volume automation"');
  });
});
