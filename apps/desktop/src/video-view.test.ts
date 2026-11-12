import { describe, expect, it } from 'vitest';
import type { Cut } from './cut-format';
import { dropIndex, editPoints, filmstrip, insertClip, moveShot, nextEdit, removeShot, rulerLabel, rulerMarks, splitAt, trimShot } from './video-view';

const cut: Cut = { version: 1, shots: [
  { id: 's1', clip: 'a.mp4', in: 1, out: 4, title: 'Hello' },
  { id: 's2', clip: 'b.mp4', in: 0, out: 2, title: '' },
] };

describe('changing the cut', () => {
  it('adds a clip as a shot of up to six seconds, where asked', () => {
    expect(insertClip(cut, 'c.mp4', 10).shots.at(-1)).toMatchObject({ id: 's3', clip: 'c.mp4', in: 0, out: 6 });
    expect(insertClip(cut, 'c.mp4', 2.5, 0).shots[0]).toMatchObject({ clip: 'c.mp4', out: 2.5 });
  });
  it('splits the shot under the playhead, keeping the title on the first part', () => {
    const got = splitAt(cut, 1.5)!;
    expect(got.cut.shots.map((s) => [s.id, s.in, s.out, s.title])).toEqual([['s1', 1, 2.5, 'Hello'], ['s3', 2.5, 4, ''], ['s2', 0, 2, '']]);
    expect(got.id).toBe('s3');
  });
  it('does not split at an edit point or outside the cut', () => {
    expect(splitAt(cut, 3)).toBeNull();
    expect(splitAt(cut, 0.05)).toBeNull();
    expect(splitAt(cut, 9)).toBeNull();
  });
  it('trims within the clip, never shorter than a tenth of a second', () => {
    expect(trimShot(cut, 's1', 'in', -2, 10).shots[0]!.in).toBe(0);
    expect(trimShot(cut, 's1', 'in', 5, 10).shots[0]!.in).toBe(3.9);
    expect(trimShot(cut, 's1', 'out', 12, 10).shots[0]!.out).toBe(10);
    expect(trimShot(cut, 's1', 'out', 0, 10).shots[0]!.out).toBe(1.1);
  });
  it('moves and removes shots', () => {
    expect(moveShot(cut, 's2', 0).shots.map((s) => s.id)).toEqual(['s2', 's1']);
    expect(moveShot(cut, 's1', 0)).toBe(cut);
    expect(removeShot(cut, 's1').shots.map((s) => s.id)).toEqual(['s2']);
  });
});

describe('the timeline', () => {
  it('knows its edit points and steps between them', () => {
    expect(editPoints(cut)).toEqual([0, 3, 5]);
    expect(nextEdit(cut, 1, 1)).toBe(3);
    expect(nextEdit(cut, 3, -1)).toBe(0);
    expect(nextEdit(cut, 5, 1)).toBeNull();
  });
  it('drops before the shot whose middle is past the pointer', () => {
    expect(dropIndex(cut, 10, 10)).toBe(0);
    expect(dropIndex(cut, 20, 10)).toBe(1);
    expect(dropIndex(cut, 45, 10)).toBe(2);
  });
  it('spaces the ruler to fit, and labels it plainly', () => {
    expect(rulerMarks(5, 40)).toEqual({ step: 2, marks: [0, 2, 4] });
    expect(rulerMarks(3, 200).step).toBe(0.5);
    expect(rulerLabel(65)).toBe('1:05');
    expect(rulerLabel(2.5)).toBe('0:02.5');
  });
  it('picks a frame for each part of a shot', () => {
    expect(filmstrip(cut.shots[0]!, 180, 60)).toEqual([1.5, 2.5, 3.5]);
    expect(filmstrip(cut.shots[1]!, 20, 60)).toEqual([1]);
  });
});
