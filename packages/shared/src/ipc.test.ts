import { describe, expect, it } from 'vitest';
import { parseBounds, parseTabId, parseNavigateRequest } from './ipc';

describe('IPC input validation (the renderer is not trusted)', () => {
  it('accepts a normal rectangle and rounds it to whole pixels', () => {
    expect(parseBounds({ x: 10.4, y: 20.6, width: 800.2, height: 600.7 })).toEqual({ x: 10, y: 21, width: 800, height: 601 });
  });
  it('rejects NaN, infinity, negatives for size, and non-objects', () => {
    expect(parseBounds({ x: NaN, y: 0, width: 1, height: 1 })).toBeNull();
    expect(parseBounds({ x: 0, y: 0, width: Infinity, height: 1 })).toBeNull();
    expect(parseBounds({ x: 0, y: 0, width: -5, height: 1 })).toBeNull();
    expect(parseBounds(null)).toBeNull();
    expect(parseBounds('x')).toBeNull();
    expect(parseBounds({ x: '1', y: 0, width: 1, height: 1 })).toBeNull();
  });
  it('caps absurd rectangles', () => {
    expect(parseBounds({ x: 0, y: 0, width: 1e9, height: 10 })).toBeNull();
  });
  it('validates tab ids', () => {
    expect(parseTabId('tab-1')).toBe('tab-1');
    expect(parseTabId('')).toBeNull();
    expect(parseTabId('../etc')).toBeNull();
    expect(parseTabId(5)).toBeNull();
    expect(parseTabId('a'.repeat(200))).toBeNull();
  });
  it('validates navigate requests through the address rules', () => {
    expect(parseNavigateRequest({ tabId: 'tab-1', input: 'example.com' })).toEqual({ tabId: 'tab-1', url: 'https://example.com/' });
    expect(parseNavigateRequest({ tabId: 'tab-1', input: 'javascript:alert(1)' })).toBeNull();
    expect(parseNavigateRequest({ tabId: 'tab-1', input: 'what is this' })).toBeNull();
    expect(parseNavigateRequest({ input: 'example.com' })).toBeNull();
  });
});
