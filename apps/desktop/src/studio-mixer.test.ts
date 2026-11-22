import { describe, expect, it } from 'vitest';
import { dbToGain, gainToDb } from './StudioMixer';

describe('the Mixer fader', () => {
  it('reads a track volume in dB and writes it back, silent at the floor and never above full', () => {
    expect(gainToDb(1)).toBe(0);
    expect(gainToDb(0.5)).toBe(-6);
    expect(gainToDb(0)).toBe(-60);
    expect(dbToGain(-6)).toBe(0.501);
    expect(dbToGain(-60)).toBe(0);
    expect(dbToGain(3)).toBe(1);
    expect(dbToGain(gainToDb(0.8))).toBeCloseTo(0.8, 2);
  });
});
