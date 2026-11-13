import { describe, expect, it } from 'vitest';
import { LAYOUTS, clock, dropIndex, jumpTarget, layoutOf, moveSlide, movedTo, playOrder, talkMinutes } from './slides-view';
import { blankSlide, parseDeck, writeDeck } from './slides-format';

describe('moveSlide', () => {
  it('moves a slide later, landing before what was at the target', () => {
    expect(moveSlide(['a', 'b', 'c', 'd'], 0, 3)).toEqual(['b', 'c', 'a', 'd']);
    expect(movedTo(0, 3)).toBe(2);
  });
  it('moves a slide earlier and to the very end', () => {
    expect(moveSlide(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c']);
    expect(moveSlide(['a', 'b', 'c'], 0, 3)).toEqual(['b', 'c', 'a']);
    expect(movedTo(0, 3)).toBe(2);
  });
  it('leaves the list as it is for a drop on itself or out of range', () => {
    expect(moveSlide(['a', 'b'], 1, 1)).toEqual(['a', 'b']);
    expect(moveSlide(['a', 'b'], 1, 2)).toEqual(['a', 'b']);
    expect(moveSlide(['a', 'b'], 5, 0)).toEqual(['a', 'b']);
  });
});

describe('dropIndex', () => {
  it('lands before a thumbnail in its top half and after it in its bottom half', () => {
    expect(dropIndex(2, 105, 100, 40)).toBe(2);
    expect(dropIndex(2, 130, 100, 40)).toBe(3);
  });
});

describe('layouts', () => {
  it('start each slide with words to replace, and survive the Markdown file', () => {
    for (const l of LAYOUTS) {
      const slide = l.make();
      const back = parseDeck(writeDeck([slide]))[0]!;
      expect(back).toEqual(slide);
    }
    expect(LAYOUTS.find((l) => l.id === 'blank')!.make()).toEqual(blankSlide());
  });
});

describe('clock', () => {
  it('reads as minutes and seconds, and hours past an hour', () => {
    expect(clock(0)).toBe('0:00');
    expect(clock(245_400)).toBe('4:05');
    expect(clock(3_729_000)).toBe('1:02:09');
  });
});

describe('jumpTarget', () => {
  it('names a slide by its number, or none', () => {
    expect(jumpTarget('3', 5)).toBe(2);
    expect(jumpTarget('0', 5)).toBeNull();
    expect(jumpTarget('6', 5)).toBeNull();
    expect(jumpTarget('', 5)).toBeNull();
  });
});

describe('talkMinutes', () => {
  it('reads notes at 130 words a minute, with at least half a minute a slide', () => {
    expect(talkMinutes([blankSlide(), blankSlide()])).toBe(1);
    const long = { ...blankSlide(), notes: Array.from({ length: 260 }, () => 'word').join(' ') };
    expect(talkMinutes([long, blankSlide()])).toBe(3);
  });
});

describe('layoutOf', () => {
  it('reads each layout back from the slide it makes', () => {
    for (const l of LAYOUTS) expect(layoutOf(l.make())).toBe(l.id);
  });
  it('matches none when a slide has body text and no bullets', () => {
    expect(layoutOf({ ...LAYOUTS[0]!.make(), text: 'A paragraph' })).toBeNull();
  });
});

describe('playOrder', () => {
  it('leaves skipped slides out of Play', () => {
    const s = blankSlide();
    expect(playOrder([s, { ...s, skip: true }, s])).toEqual([0, 2]);
  });
});
