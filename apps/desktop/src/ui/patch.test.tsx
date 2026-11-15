import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PatchCanvas, Port, cablePath, defaultCanConnect, layoutFlow, type PatchBox, type PatchCable, type PortInfo } from './Patch';

const boxes: PatchBox[] = [
  { id: 'in', x: 0, y: 0, title: 'Input', color: 'teal', outputs: [{ id: 'out', label: 'Out', kind: 'audio' }] },
  {
    id: 'filter', x: 200, y: 0, title: 'Filter', inputs: [{ id: 'in', label: 'In', kind: 'audio' }], outputs: [{ id: 'out', label: 'Out', kind: 'audio' }],
    children: <Port id="cutoff" label="Cutoff" kind="control" />,
  },
  { id: 'mix', x: 400, y: 0, title: 'Mix', proposed: true, inputs: [{ id: 'dry', label: 'Dry', kind: 'audio' }, { id: 'wet', label: 'Wet', kind: 'audio' }] },
];
const cables: PatchCable[] = [
  { id: 'a', from: { box: 'in', port: 'out' }, to: { box: 'filter', port: 'in' } },
  { id: 'b', from: { box: 'filter', port: 'out' }, to: { box: 'mix', port: 'wet' } },
  { id: 'c', from: { box: 'in', port: 'out' }, to: { box: 'mix', port: 'dry' } },
];

describe('PatchCanvas', () => {
  it('names each box and port for a screen reader, and places boxes where the app says', () => {
    const html = renderToStaticMarkup(<PatchCanvas label="Bass device" boxes={boxes} cables={cables} />);
    expect(html).toContain('aria-label="Bass device"');
    expect(html).toContain('aria-label="Filter"');
    expect(html).toContain('aria-label="Filter In input"');
    expect(html).toContain('aria-label="Input Out output"');
    expect(html).toContain('aria-label="Filter Cutoff setting"');
    expect(html).toContain('left:200px');
  });

  it('labels the ports only where a box has more than one on a side, and marks what Mobius proposed', () => {
    const html = renderToStaticMarkup(<PatchCanvas label="Bass device" boxes={boxes} cables={cables} />);
    expect(html).toContain('<span class="ui-port-label" aria-hidden="true">Dry</span>');
    expect(html).not.toContain('<span class="ui-port-label" aria-hidden="true">In</span>');
    expect(html).toMatch(/class="ui-patch-box"[^>]*data-proposed="true"[^>]*aria-label|aria-label="Mix"[^>]*data-proposed="true"/);
  });

  it('fills the dots of connected ports and marks a read-only patch', () => {
    const html = renderToStaticMarkup(<PatchCanvas label="Bass device" boxes={boxes} cables={cables} readOnly />);
    expect(html).toContain('data-readonly="true"');
    expect(html).toMatch(/data-port-key="mix\u001fwet"[^>]*data-linked="true"/);
    expect(html).not.toMatch(/data-port-key="filter\u001fcutoff"[^>]*data-linked/);
  });
});

describe('patch helpers', () => {
  const port = (box: string, id: string, side: 'in' | 'out', kind: PortInfo['kind'] = 'audio', param = false): PortInfo => ({ box, id, side, kind, param });

  it('joins an output to an input of the same kind on another box', () => {
    expect(defaultCanConnect(port('a', 'out', 'out'), port('b', 'in', 'in'))).toBe(true);
    expect(defaultCanConnect(port('a', 'out', 'out'), port('a', 'in', 'in'))).toBe(false);
    expect(defaultCanConnect(port('a', 'out', 'out', 'control'), port('b', 'in', 'in'))).toBe(false);
    expect(defaultCanConnect(port('a', 'out', 'out', 'control'), port('b', 'cutoff', 'in', 'control', true))).toBe(true);
    expect(defaultCanConnect(port('a', 'in', 'in'), port('b', 'out', 'out'))).toBe(false);
  });

  it('draws a cable leaving rightward and arriving from the left', () => {
    expect(cablePath(0, 0, 200, 40)).toBe('M0 0C100 0 100 40 200 40');
    expect(cablePath(0, 0, 10, 0)).toBe('M0 0C40 0 -30 0 10 0');
  });

  it('lays boxes out in columns by signal order, on the grid, and survives a feedback loop', () => {
    const at = layoutFlow(boxes, cables, { column: 200, gap: 20, height: () => 60 });
    expect(at.in!.x).toBe(0);
    expect(at.filter!.x).toBe(200);
    expect(at.mix!.x).toBe(400);
    for (const p of Object.values(at)) { expect(p.x % 8).toBe(0); expect(p.y % 8).toBe(0); }
    const loop = layoutFlow(boxes, [...cables, { from: { box: 'mix' }, to: { box: 'in' } }]);
    expect(Object.keys(loop)).toHaveLength(3);
    expect(Math.max(...Object.values(loop).map((p) => p.x))).toBeLessThan(224 * 3);
  });

  it('stacks boxes that share a column and centres the shorter column', () => {
    const at = layoutFlow(
      [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      [{ from: { box: 'a' }, to: { box: 'c' } }, { from: { box: 'b' }, to: { box: 'c' } }],
      { gap: 16, height: () => 64 },
    );
    expect(at.a).toEqual({ x: 0, y: 0 });
    expect(at.b).toEqual({ x: 0, y: 80 });
    expect(at.c).toEqual({ x: 224, y: 40 });
  });
});
