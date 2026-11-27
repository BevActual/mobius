import { afterEach, describe, expect, it, vi } from 'vitest';
import { soundUrl } from './useSpeech';

describe('soundUrl', () => {
  afterEach(() => vi.restoreAllMocks());

  it('hands a data: sound over as a blob: address with its bytes and type', async () => {
    let made: Blob | null = null;
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => { made = b as Blob; return 'blob:mobius/1'; });
    expect(soundUrl(`data:audio/wav;base64,${btoa('RIFF')}`)).toBe('blob:mobius/1');
    expect(made!.type).toBe('audio/wav');
    expect(await made!.text()).toBe('RIFF');
  });

  it('keeps any other address', () => {
    expect(soundUrl('http://media.localhost/a.wav')).toBe('http://media.localhost/a.wav');
  });
});
