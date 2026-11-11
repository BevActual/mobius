import { describe, expect, it } from 'vitest';
import { asUpdateInfo } from './useUpdates';

describe('Software Update replies', () => {
  it('takes a state with its words and the version running', () => {
    expect(asUpdateInfo({ state: 'ready', status: 'Mobius 0.2.0 is ready. Restart to install it.', current: '0.1.0', version: '0.2.0' })).toEqual({ state: 'ready', status: 'Mobius 0.2.0 is ready. Restart to install it.', current: '0.1.0', version: '0.2.0' });
    expect(asUpdateInfo({ state: 'downloading', status: 'Downloading…', current: '0.1.0', version: '0.2.0', percent: 40 })?.percent).toBe(40);
  });
  it('never takes a failure or an unknown state for one', () => {
    expect(asUpdateInfo({ ok: false, error: 'Updates are not available here.' })).toBeNull();
    expect(asUpdateInfo({ state: 'exploded', status: 'x' })).toBeNull();
    expect(asUpdateInfo(null)).toBeNull();
    expect(asUpdateInfo([])).toBeNull();
  });
});
