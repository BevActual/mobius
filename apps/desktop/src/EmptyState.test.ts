import { describe, expect, it } from 'vitest';
import { shownLine } from './EmptyState';

describe('an empty place says only what can be done', () => {
  it('with nothing made yet, it does not point at an empty list', () => {
    expect(shownLine('No workbooks yet', 'Choose one on the left, or start a new one.')).toBe('Start a new one.');
    expect(shownLine('No pages yet', 'Choose a page on the left, or start a new one.')).toBe('Start a new one.');
  });
  it('with things to choose from, the line stays', () => {
    expect(shownLine('No workbook open', 'Choose one on the left, or start a new one.')).toBe('Choose one on the left, or start a new one.');
    expect(shownLine('No songs yet', 'Ask Mobius for one.')).toBe('Ask Mobius for one.');
  });
});
