import { describe, expect, it } from 'vitest';
import { localStatusText } from './voice-status';

describe('the speech server on this computer', () => {
  it('says Ready when it answers at the saved address', () => {
    expect(localStatusText('listen', true, 'http://127.0.0.1:8000/v1')).toBe('Ready: the speech server at http://127.0.0.1:8000/v1 answers.');
  });

  it('says Not running, and which kind of server to start, when it does not', () => {
    expect(localStatusText('listen', false, 'http://127.0.0.1:8000/v1')).toMatch(/^Not running at http:\/\/127\.0\.0\.1:8000\/v1\. Start a speech-to-text server/);
    expect(localStatusText('speak', false, 'http://127.0.0.1:8880/v1')).toContain('Kokoro');
  });
});
