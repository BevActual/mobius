import { describe, expect, it } from 'vitest';
import { autoChoices, envelopeChoices, setEnvelope, fromLane, laneEmpty, override, overrideEffect, reEnable, setAuto, toLane } from './studio-auto';
import { newEffect, type Track } from './song-format';

const track = (more: Partial<Track> = {}): Track => ({ id: 'a', name: 'A', instrument: 'pad', volume: 0.8, pan: 0.5, muted: false, solo: false, color: 'blue', clips: [], ...more } as Track);

describe('a track automation lane', () => {
  it('offers Volume, Pan, a send per return, and each built-in effect\'s automatable settings', () => {
    const t = track({ sends: { r1: 0.3 }, fx: [newEffect('delay', 'd'), newEffect('reverb', 'v'), newEffect('reverb', 'w')] });
    const choices = autoChoices(t, [{ id: 'r1', volume: 1, pan: 0 }, { id: 'r2', name: 'Verb', volume: 1, pan: 0 }]);
    expect(choices.map((c) => c.label)).toEqual(['Volume', 'Pan', 'Send A', 'Send Verb', 'Delay Time', 'Delay Feedback', 'Delay Mix', 'Reverb 1 Mix', 'Reverb 2 Mix']);
    expect(choices.find((c) => c.name === 'fx:d:feedback')).toMatchObject({ lo: 0, hi: 0.9, own: 0.35 });
    expect(laneEmpty(choices.find((c) => c.name === 'send:r1')!)).toBe(0.3);
    expect(laneEmpty(choices.find((c) => c.name === 'pan')!)).toBe(0.75);
  });
  it('maps a range onto 0 to 1 and back, keeping each point\'s bend by beat', () => {
    const pan = { lo: -1, hi: 1 };
    const was = [{ beat: 0, value: -1, curve: 0.5 }, { beat: 8, value: 1 }];
    expect(toLane(was, pan)).toEqual([{ beat: 0, value: 0, curve: 0.5 }, { beat: 8, value: 1 }]);
    expect(fromLane([{ beat: 0, value: 0.25 }, { beat: 4, value: 0.5 }, { beat: 8, value: 1 }], was, pan)).toEqual([{ beat: 0, value: -0.5, curve: 0.5 }, { beat: 4, value: 0 }, { beat: 8, value: 1 }]);
    expect(fromLane([{ beat: 0, value: 0.75 }], [], { lo: -18, hi: 18 })).toEqual([{ beat: 0, value: 9 }]);
  });
  it('overrides the effect settings a hand changed, when they are automated', () => {
    const t = track({ fx: [newEffect('delay', 'd')] });
    setAuto(t, 'fx:d:mix', [{ beat: 0, value: 1 }]);
    const before = { ...t.fx![0]! };
    Object.assign(t.fx![0]!, { mix: 0.5, feedback: 0.1 });
    overrideEffect(t, before, t.fx![0]!);
    expect(t.autoOff).toEqual(['fx:d:mix']);
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
  it('offers a clip\'s envelopes at their own resting values, and drops an empty one', () => {
    expect(envelopeChoices([{ id: 'r1', volume: 1, pan: 0 }]).map((c) => [c.name, laneEmpty(c)])).toEqual([['volume', 1], ['pan', 0.5], ['send:r1', 1]]);
    const clip: { envelopes?: Record<string, { beat: number; value: number }[]> } = {};
    setEnvelope(clip, 'pan', [{ beat: 1, value: -0.5 }]);
    expect(clip.envelopes).toEqual({ pan: [{ beat: 1, value: -0.5 }] });
    setEnvelope(clip, 'pan', []);
    expect(clip.envelopes).toBeUndefined();
  });
});
