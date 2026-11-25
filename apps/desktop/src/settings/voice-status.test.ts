import { describe, expect, it } from 'vitest';
import { deviceText, localStatusText, megabytes } from './voice-status';

describe('the speech server on this computer', () => {
  it('says Ready when it answers at the saved address', () => {
    expect(localStatusText('listen', true, 'http://127.0.0.1:8000/v1')).toBe('Ready: the speech server at http://127.0.0.1:8000/v1 answers.');
  });

  it('says Not running, and which kind of server to start, when it does not', () => {
    expect(localStatusText('listen', false, 'http://127.0.0.1:8000/v1')).toMatch(/^Not running at http:\/\/127\.0\.0\.1:8000\/v1\. Start a speech-to-text server/);
    expect(localStatusText('speak', false, 'http://127.0.0.1:8880/v1')).toContain('Kokoro');
  });
});

describe('listening on this computer', () => {
  const base = { model: 'base.en' as const, available: true, bytes: 161_269_920 };
  it('says what setting up downloads, then its progress, then that it is ready', () => {
    expect(deviceText({ ...base, state: 'absent' })).toBe('Not set up');
    expect(deviceText({ ...base, state: 'downloading', done: 40_000_000, total: 176_000_000 })).toBe('40 MB of 176 MB');
    expect(deviceText({ ...base, state: 'ready' })).toBe('Ready');
  });

  it('passes on why setting up failed, and says so when there is no build for this computer', () => {
    expect(deviceText({ ...base, state: 'failed', message: 'The download was cut off.' })).toBe('The download was cut off.');
    expect(deviceText({ ...base, available: false, state: 'absent' })).toBe('Not available on this computer yet');
  });

  it('never shows a size as nothing', () => {
    expect(megabytes(0)).toBe('1 MB');
    expect(megabytes(376_141_000)).toBe('376 MB');
  });
});
