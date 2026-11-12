import { describe, expect, it } from 'vitest';
import { changedShots, cutLength, freshShotId, locate, mediaUrl, parseCut, shotStart, timecode, writeCut } from './cut-format';

const FILE = JSON.stringify({ shots: [{ id: 's1', clip: 'terrace.mp4', in: 2.5, out: 8, title: 'Day one' }, { clip: 'sunset.mov', in: 4, out: 1 }, { in: 3 }] });

describe('cuts', () => {
  it('read shots in order, with defaults, and write them back one to a line', () => {
    const cut = parseCut(FILE);
    expect(cut.shots).toEqual([
      { id: 's1', clip: 'terrace.mp4', in: 2.5, out: 8, title: 'Day one' },
      { id: 's2', clip: 'sunset.mov', in: 4, out: 4.1, title: '' },
    ]);
    expect(parseCut(writeCut(cut))).toEqual(cut);
    expect(writeCut(cut)).toContain('\n    {"id":"s2","clip":"sunset.mov","in":4,"out":4.1}\n');
    expect(parseCut(null).shots).toEqual([]);
    expect(parseCut('nope').shots).toEqual([]);
  });

  it('find where a moment falls, and how long it all is', () => {
    const cut = parseCut(JSON.stringify({ shots: [{ clip: 'a.mp4', in: 10, out: 15 }, { clip: 'b.mp4', in: 0, out: 3 }] }));
    expect(cutLength(cut)).toBe(8);
    expect(locate(cut, 2)).toEqual({ index: 0, clipTime: 12 });
    expect(locate(cut, 6)).toEqual({ index: 1, clipTime: 1 });
    expect(locate(cut, 99)).toEqual({ index: 1, clipTime: 3 });
    expect(shotStart(cut, 1)).toBe(5);
    expect(timecode(65.25)).toBe('1:05.3');
    expect(freshShotId(cut)).toBe('s3');
    const after = parseCut(JSON.stringify({ shots: [{ id: 's1', clip: 'a.mp4', in: 10, out: 15 }, { id: 's2', clip: 'b.mp4', in: 0, out: 2 }] }));
    expect([...changedShots(cut, after)]).toEqual(['s2']);
    expect(mediaUrl('Offsite recap', 'a b.mp4', 'win32')).toBe('http://media.localhost/Offsite%20recap/a%20b.mp4');
    expect(mediaUrl('x', 'y.mp4', 'linux')).toBe('media://localhost/x/y.mp4');
  });
});
