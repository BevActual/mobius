import { describe, expect, it } from 'vitest';
import { autoChoices, fromLane, laneEmpty, override, reEnable, setAuto, toLane } from './studio-auto';
import type { Track } from './song-format';

const track = (more: Partial<Track> = {}): Track => ({ id: 'a', name: 'A', instrument: 'pad', volume: 0.8, pan: 0.5, muted: false, solo: false, color: 'blue', clips: [], ...more } as Track);

describe('a track automation lane', () => {
  it('offers Volume, Pan and a send per return', () => {
    expect(autoChoices([{ id: 'r1', volume: 1, pan: 0 }, { id: 'r2', name: 'Verb', volume: 1, pan: 0 }])).toEqual([
      { name: 'volume', label: 'Volume' }, { name: 'pan', label: 'Pan' }, { name: 'send:r1', label: 'Send A' }, { name: 'send:r2', label: 'Send Verb' }]);
  });
  it('maps pan onto 0 to 1 and back, keeping each point\'s bend by beat', () => {
    const was = [{ beat: 0, value: -1, curve: 0.5 }, { beat: 8, value: 1 }];
    expect(toLane(was, 'pan')).toEqual([{ beat: 0, value: 0, curve: 0.5 }, { beat: 8, value: 1 }]);
    expect(fromLane([{ beat: 0, value: 0.25 }, { beat: 4, value: 0.5 }, { beat: 8, value: 1 }], was, 'pan')).toEqual([{ beat: 0, value: -0.5, curve: 0.5 }, { beat: 4, value: 0 }, { beat: 8, value: 1 }]);
    expect(laneEmpty(track(), 'pan')).toBe(0.75);
    expect(laneEmpty(track({ sends: { r1: 0.3 } }), 'send:r1')).toBe(0.3);
  });
  it('overrides only an automated setting, and re-enables one or all', () => {
    const t = track();
    override(t, 'volume');
    expect(t.autoOff).toBeUndefined();
    setAuto(t, 'volume', [{ beat: 0, value: 1 }]);
    setAuto(t, 'pan', [{ beat: 0, value: 0 }]);
    override(t, 'volume'); override(t, 'volume'); override(t, 'pan');
    expect(t.autoOff).toEqual(['volume', 'pan']);
    reEnable(t, 'volume');
    expect(t.autoOff).toEqual(['pan']);
    reEnable(t);
    expect(t.autoOff).toBeUndefined();
    override(t, 'pan');
    setAuto(t, 'pan', []);
    expect(t.auto).toEqual({ volume: [{ beat: 0, value: 1 }] });
    expect(t.autoOff).toBeUndefined();
  });
});
