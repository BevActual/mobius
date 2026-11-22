import { describe, expect, it } from 'vitest';
import { wavePath } from './studio-wave';

describe('wavePath', () => {
  const p = { rate: 4, per: 1, peaks: [[-0.5, 0.5], [-1, 1], [0, 0], [-0.25, 0.75]] as [number, number][] };
  it('draws one column per point from each stretch’s lowest to highest sample', () => {
    expect(wavePath(p, 0, 1, 2)).toBe('M0.5 -1.000V1.000M1.5 -0.750V0.250');
  });
  it('starts at the clip’s offset, keeps silence as a hairline, and draws nothing past the file', () => {
    expect(wavePath(p, 0.5, 0.75, 1)).toBe('M0.5 0.000V0.020');
    expect(wavePath(p, 2, 3, 4)).toBe('');
    expect(wavePath(p, 0, 1, 0)).toBe('');
  });
});
