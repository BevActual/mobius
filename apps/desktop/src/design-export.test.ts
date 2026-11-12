import { describe, expect, it } from 'vitest';
import { wrapText } from './design-export';

// Each letter is 10 wide.
const measure = (s: string) => s.length * 10;

describe('text in an export', () => {
  it('wraps on spaces to fit the box, keeps line breaks, and breaks a word only when it alone is too wide', () => {
    expect(wrapText('Book the flights', 100, measure)).toEqual(['Book the', 'flights']);
    expect(wrapText('One\nTwo', 100, measure)).toEqual(['One', 'Two']);
    expect(wrapText('Supercalifragilistic', 50, measure)).toEqual(['Super', 'calif', 'ragil', 'istic']);
    expect(wrapText('', 50, measure)).toEqual(['']);
  });
});
