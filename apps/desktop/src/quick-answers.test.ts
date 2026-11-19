import { describe, expect, it } from 'vitest';
import { convert, evaluate, quickAnswer, zoneTime } from './quick-answers';

describe('quick answers', () => {
  it('works out sums with the usual order, brackets, powers and percent', () => {
    expect(evaluate('2+3*4')).toBe(14);
    expect(evaluate('(2+3)*4')).toBe(20);
    expect(evaluate('2^3^2')).toBe(512);
    expect(evaluate('-4 + 10')).toBe(6);
    expect(evaluate('1,200 / 4')).toBe(300);
    expect(evaluate('50%*80')).toBe(40);
    expect(evaluate('12 x 3')).toBe(36);
  });

  it('leaves alone anything that is not a sum', () => {
    expect(evaluate('42')).toBeNull();
    expect(evaluate('notes')).toBeNull();
    expect(evaluate('2+')).toBeNull();
    expect(evaluate('(1+2')).toBeNull();
    expect(quickAnswer('mail')).toBeNull();
    expect(quickAnswer('q3 budget')).toBeNull();
  });

  it('answers percent of a number', () => {
    expect(quickAnswer('12% of 340')).toEqual({ value: '40.8', question: '12% of 340', copy: '40.8' });
  });

  it('converts units of one kind, and temperatures', () => {
    expect(convert('5 km in miles')?.value).toBe('3.1069 miles');
    expect(convert('2.5 lb to kg')?.value).toBe('1.134 kg');
    expect(convert('70 f to c')?.value).toBe('21.1111°C');
    expect(convert('100 c in f')?.value).toBe('212°F');
    expect(convert('5 km in kg')).toBeNull();
    expect(convert('5 parsecs in km')).toBeNull();
  });

  it('shows a time in another zone, from a zone named or from this computer', () => {
    const now = new Date('2026-11-18T12:00:00Z');
    expect(zoneTime('3pm pt in london', now)?.value).toBe('11:00 PM in London');
    expect(zoneTime('9:30 tokyo to new york', now)?.value).toBe('7:30 PM in New York');
    expect(zoneTime('3pm in london', now, 'America/New_York')?.value).toBe('8:00 PM in London');
    expect(zoneTime('time in tokyo', now)?.value).toBe('9:00 PM in Tokyo');
    expect(zoneTime('3pm pt in atlantis', now)).toBeNull();
  });
});
