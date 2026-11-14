import { afterEach, describe, expect, it, vi } from 'vitest';
import { RETRY_MS, readBefore } from './readBefore';

const answers = (...list: unknown[]) => {
  const before = vi.fn(() => Promise.resolve(list.shift()));
  (globalThis as { window?: unknown }).window = { mobius: { changes: { before } } };
  return before;
};

describe('readBefore', () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('reads again once when the turn has not recorded the change yet, then hands over the text', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const before = answers({ ok: false, error: 'no turn yet' }, { ok: true, text: 'was' });
    const use = vi.fn();
    const failed = vi.fn();
    readBefore('c1', 'slides/Deck.md', use, failed);
    await vi.advanceTimersByTimeAsync(0);
    expect(use).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(RETRY_MS);
    expect(before).toHaveBeenCalledTimes(2);
    expect(use).toHaveBeenCalledWith('was');
    expect(failed).not.toHaveBeenCalled();
  });

  it('says it failed after the second try, and nothing once cancelled', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    answers({ ok: false, error: 'x' }, { ok: false, error: 'x' });
    const failed = vi.fn();
    readBefore('c1', 'a.md', vi.fn(), failed);
    await vi.advanceTimersByTimeAsync(RETRY_MS);
    expect(failed).toHaveBeenCalledTimes(1);

    const before = answers({ ok: false, error: 'x' });
    const cancel = readBefore('c1', 'a.md', vi.fn(), failed);
    await vi.advanceTimersByTimeAsync(0);
    cancel();
    await vi.advanceTimersByTimeAsync(RETRY_MS);
    expect(before).toHaveBeenCalledTimes(1);
  });
});
