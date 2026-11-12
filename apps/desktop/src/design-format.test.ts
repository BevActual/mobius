import { describe, expect, it } from 'vitest';
import { changedIds, contrast, freshId, nextFramePlace, parseDesign, resolveColor, writeDesign, type DesignDoc } from './design-format';

const FILE = JSON.stringify({
  version: 1,
  styles: [{ name: 'Primary', color: '#5856d6' }],
  frames: [
    { id: 'f1', name: 'Home', x: 0, y: 0, w: 393, h: 852, fill: '#ffffff', children: [
      { id: 'n1', type: 'text', name: 'Title', x: 24, y: 80, w: 345, h: 40, text: 'Lisbon offsite', size: 28, weight: 700, color: 'style:Primary' },
      { id: 'n2', type: 'rect', x: 24, y: 140, w: 345, h: 120, fill: '#f2f2f7', radius: 16 },
    ] },
    { name: 'Empty' },
  ],
});
const doc = (text: string): DesignDoc => { const r = parseDesign(text); if ('error' in r) throw new Error(r.error); return r.doc; };

describe('designs', () => {
  it('read frames, layers and styles, with defaults for what a file leaves out', () => {
    const d = doc(FILE);
    expect(d.frames).toHaveLength(2);
    expect(d.frames[0]!.children[1]).toMatchObject({ id: 'n2', type: 'rect', name: 'Rectangle', radius: 16, opacity: 1 });
    expect(d.frames[1]).toMatchObject({ id: 'f2', name: 'Empty', x: 460, w: 393, fill: '#ffffff', children: [] });
    expect(resolveColor('style:Primary', d.styles)).toBe('#5856d6');
    expect(resolveColor('#123', d.styles)).toBe('#123');
    expect(parseDesign('{ nope')).toHaveProperty('error');
    expect(doc('{"frames":[{"fill":"red; background:url(x)"}]}').frames[0]!.fill).toBe('#ffffff');
  });

  it('write back what they read, one layer to a line', () => {
    const d = doc(FILE);
    const text = writeDesign(d);
    expect(doc(text)).toEqual(d);
    expect(text).toContain('\n      {"id":"n2","type":"rect","name":"Rectangle","x":24,"y":140,"w":345,"h":120,"fill":"#f2f2f7","radius":16}\n');
    expect(doc(writeDesign({ version: 1, styles: [], frames: [] }))).toEqual({ version: 1, styles: [], frames: [] });
  });

  it('find what a turn changed, and new ids and places', () => {
    const before = doc(FILE);
    const after = doc(FILE);
    after.frames[0]!.children[0]!.color = '#ffffff';
    after.frames.push({ ...after.frames[0]!, id: 'f3', name: 'Home — Dark', children: [] });
    expect([...changedIds(before, after)]).toEqual(['n1', 'f3']);
    expect(freshId(before, 'n')).toBe('n5');
    expect(nextFramePlace(before)).toEqual({ x: 933, y: 0 });
    expect(contrast('#ffffff', '#000000')).toBe(21);
    expect(contrast('#777777', '#ffffff')).toBeLessThan(4.5);
  });
});
