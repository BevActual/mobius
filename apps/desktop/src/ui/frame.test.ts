import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { afterPaint } from './frame';

describe('afterPaint', () => {
  let frames: Array<() => void> = [];
  beforeEach(() => {
    vi.useFakeTimers();
    frames = [];
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => frames.push(cb));
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('still runs in a window that draws no frames (covered or minimised)', () => {
    const fn = vi.fn();
    afterPaint(fn);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(50);
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it('runs once, on the frame when one comes first', () => {
    const fn = vi.fn();
    afterPaint(fn);
    frames.forEach((f) => f());
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it('can be called off', () => {
    const fn = vi.fn();
    const cancel = afterPaint(fn);
    cancel();
    frames.forEach((f) => f());
    vi.advanceTimersByTime(100);
    expect(fn).not.toHaveBeenCalled();
  });
});
