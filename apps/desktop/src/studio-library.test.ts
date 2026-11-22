import { describe, expect, it } from 'vitest';
import { collect, LIBRARY, search } from './studio-library';

const names = (xs: { name: string }[]) => xs.map((x) => x.name);

describe('the Library', () => {
  it('every item has a unique id and tags only from its groups', () => {
    expect(new Set(LIBRARY.map((i) => i.id)).size).toBe(LIBRARY.length);
  });

  it('a category narrows the results, sorted by name', () => {
    expect(names(search(LIBRARY, 'drums', '', {}))).toEqual(['Classic Kit', 'Deep Kit', 'Tight Kit']);
    expect(names(search(LIBRARY, 'effects', '', {}))).toEqual(['Compressor', 'Delay', 'EQ', 'Reverb']);
  });

  it('every word must match a name or tag, and #word matches tags only', () => {
    expect(names(search(LIBRARY, 'all', 'pad dark', {}))).toEqual(['Dark Pad']);
    expect(names(search(LIBRARY, 'sounds', '#pluck', {}))).toEqual(['Mallet', 'Pluck']);
    expect(search(LIBRARY, 'all', '#dark pad', {}).map((i) => i.name)).toContain('Dark Pad');
  });

  it('tags: any within a group, all across groups', () => {
    expect(names(search(LIBRARY, 'sounds', '', { type: ['Bass', 'Pad'], character: ['Dark'] }))).toEqual(['Dark Pad', 'Sub Bass']);
  });

  it('collections: 1 to 7 toggle a colour, 0 clears', () => {
    let c = collect({}, 'a', 3);
    c = collect(c, 'a', 1);
    expect(c.a).toEqual([1, 3]);
    c = collect(c, 'a', 3);
    expect(c.a).toEqual([1]);
    expect(collect(c, 'a', 0)).toEqual({});
  });
});

describe('the preview shape', () => {
  it('draws what the audition plays, and nothing for an effect', async () => {
    const { LIBRARY: all, previewShape } = await import('./studio-library');
    const pad = previewShape(all.find((i) => i.id === 'sound:string-pad')!)!;
    expect(pad.peaks).toHaveLength(64);
    expect(pad.seconds).toBeGreaterThan(1);
    expect(Math.max(...pad.peaks)).toBeGreaterThan(0.3);
    expect(previewShape(all.find((i) => i.id === 'effect:reverb')!)).toBeNull();
  });
});
