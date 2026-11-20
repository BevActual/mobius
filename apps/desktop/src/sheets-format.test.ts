import { describe, expect, it } from 'vitest';
import { formatted, localCurrency, shiftFormats } from './sheets-view';

describe('number formats', () => {
  it('shows numbers as Number, Currency or Percentage, and leaves words and Automatic alone', () => {
    expect(formatted('48000', 'number', 'en-US')).toBe('48,000.00');
    expect(formatted('48000', 'currency', 'en-US')).toBe('$48,000.00');
    expect(formatted('0.125', 'percent', 'en-US')).toBe('12.5%');
    expect(formatted('12%', 'percent', 'en-US')).toBe('12%');
    expect(formatted('Total', 'currency', 'en-US')).toBe('Total');
    expect(formatted('#VALUE!', 'number', 'en-US')).toBe('#VALUE!');
    expect(formatted('48000', 'auto', 'en-US')).toBe('48000');
    expect(formatted('', 'currency', 'en-US')).toBe('');
  });
  it('uses the currency and grouping of the computer’s region', () => {
    expect(localCurrency('en-GB')).toBe('GBP');
    expect(localCurrency('de-DE')).toBe('EUR');
    expect(localCurrency('en-US')).toBe('USD');
    expect(formatted('1234.5', 'currency', 'en-GB')).toBe('£1,234.50');
  });
  it('moves column formats along when a column is put in or taken out', () => {
    expect(shiftFormats({ 1: 'currency', 3: 'percent' }, 2, true)).toEqual({ 1: 'currency', 4: 'percent' });
    expect(shiftFormats({ 1: 'currency', 2: 'number', 3: 'percent' }, 2, false)).toEqual({ 1: 'currency', 2: 'percent' });
  });
});

describe('grouped thousands in Automatic', () => {
  it('groups a column of amounts, keeps a column of years, and keeps typed decimals', async () => {
    const { grouped, groupsThousands } = await import('./sheets-view');
    expect(groupsThousands([['Cost'], ['48000'], ['240']], 0)).toBe(true);
    expect(groupsThousands([['Year'], ['2024'], ['2025']], 0)).toBe(false);
    expect(groupsThousands([['Name'], ['Veltro']], 0)).toBe(false);
    expect(grouped('48000', 'en-US')).toBe('48,000');
    expect(grouped('1234.50', 'en-US')).toBe('1,234.50');
    expect(grouped('Total', 'en-US')).toBe('Total');
  });
});
