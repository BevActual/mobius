import { describe, expect, it } from 'vitest';
import { MAX_SHARE, MIN_SHARE, clampShare, companionFor } from './split';

describe('split view', () => {
  it('keeps the divider within reach of both panes', () => {
    expect(clampShare(0.5)).toBe(0.5);
    expect(clampShare(0)).toBe(MIN_SHARE);
    expect(clampShare(1)).toBe(MAX_SHARE);
  });
  it('opens the browser beside other apps, and notes beside the browser', () => {
    expect(companionFor('browser')).toBe('notes');
    expect(companionFor('notes')).toBe('browser');
    expect(companionFor('agent')).toBe('browser');
  });
});
