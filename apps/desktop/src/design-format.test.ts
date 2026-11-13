import { describe, expect, it } from 'vitest';
import { changedIds, componentOf, contrast, copyOf, detach, freshId, makeComponent, moveLayer, nextFramePlace, withOverride, parseDesign, resolveColor, writeDesign, type DesignDoc } from './design-format';

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

  it('keep a layer hidden or locked, and leave the flags out when they are off', () => {
    const d = doc(FILE);
    d.frames[0]!.children[1]!.hidden = true;
    d.frames[0]!.children[0]!.locked = true;
    const text = writeDesign(d);
    expect(text).toContain('"radius":16,"hidden":true}');
    expect(text).toContain('"locked":true}');
    expect(doc(text).frames[0]!.children.map((c) => [c.hidden, c.locked])).toEqual([[undefined, true], [true, undefined]]);
    expect(doc('{"frames":[{"children":[{"hidden":"yes","locked":1}]}]}').frames[0]!.children[0]).not.toHaveProperty('hidden');
    expect(writeDesign(doc(FILE))).not.toContain('hidden');
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

  it('keep a border only when it has a colour and a width', () => {
    const d = doc(FILE);
    expect(d.frames[0]).toMatchObject({ stroke: 'transparent', strokeWidth: 0 });
    d.frames[0]!.children[1]!.stroke = '#ff0000';
    d.frames[0]!.children[1]!.strokeWidth = 2;
    d.frames[1]!.stroke = 'style:Primary';
    d.frames[1]!.strokeWidth = 1;
    const text = writeDesign(d);
    expect(text).toContain('"radius":16,"stroke":"#ff0000","strokeWidth":2}');
    expect(doc(text)).toEqual(d);
    d.frames[0]!.children[1]!.strokeWidth = 0;
    expect(writeDesign(d)).not.toContain('#ff0000');
  });

  it('move a layer in the list, in front of or behind another, or onto another frame where it keeps its place', () => {
    const d = doc(FILE);
    expect(moveLayer(d, 'n1', 'n2', 'above')).toBe(true);
    expect(d.frames[0]!.children.map((c) => c.id)).toEqual(['n2', 'n1']);
    moveLayer(d, 'n1', 'n2', 'below');
    expect(d.frames[0]!.children.map((c) => c.id)).toEqual(['n1', 'n2']);
    expect(moveLayer(d, 'n1', 'f2', 'above')).toBe(true);
    expect(d.frames[1]!.children[0]).toMatchObject({ id: 'n1', x: 24 - 460, y: 80 });
    expect(moveLayer(d, 'n2', 'n2', 'above')).toBe(false);
    expect(moveLayer(d, 'f1', 'n2', 'above')).toBe(false);
  });

  it('make a component from layers, leave a copy in their place, and keep copies with their own text', () => {
    const d = doc(FILE);
    const made = makeComponent(d, 'f1', ['n1', 'n2'], 'Card')!;
    const main = d.frames.find((f) => f.id === made.component)!;
    expect(main).toMatchObject({ name: 'Card', component: true, x: 933, w: 345, h: 180 });
    expect(main.children.map((c) => [c.id, c.x, c.y])).toEqual([['n1', 0, 0], ['n2', 0, 60]]);
    const copy = d.frames[0]!.children.find((c) => c.id === made.copy)!;
    expect(copy).toMatchObject({ type: 'instance', of: made.component, x: 24, y: 80, w: 345, h: 180 });
    expect(d.frames[0]!.children.map((c) => c.id)).toEqual([made.copy]);
    expect(componentOf(d, copy)).toBe(main);
    copy.overrides = { n1: { text: 'Porto' } };
    expect(withOverride(main.children[0]!, copy).text).toBe('Porto');
    // Written and read back as it was.
    expect(doc(writeDesign(d))).toEqual(d);
    // A second copy; then the first, twice as wide, made back into plain layers with its own text.
    d.frames[0]!.children.push(copyOf(d, main, 24, 400));
    copy.w = 690;
    const ids = detach(d, copy.id);
    expect(ids).toHaveLength(2);
    expect(d.frames[0]!.children.map((c) => c.type)).toEqual(['text', 'rect', 'instance']);
    expect(d.frames[0]!.children[0]).toMatchObject({ text: 'Porto', x: 24, w: 690 });
    expect(new Set(d.frames[0]!.children.map((c) => c.id)).size).toBe(3);
    expect(makeComponent(d, 'f1', ['nope'], 'X')).toBeNull();
    expect(doc('{"frames":[{"children":[{"type":"instance"}]}]}').frames[0]!.children[0]!.type).toBe('rect');
  });
});
