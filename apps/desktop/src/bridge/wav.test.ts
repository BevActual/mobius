import { describe, expect, it } from 'vitest';
import { encodeWav } from './wav';

describe('encodeWav', () => {
  it('writes a 16 kHz, one-channel, 16-bit PCM WAV that the listening program takes', () => {
    const wav = encodeWav(new Float32Array([0, 1, -1, 0.5, 2]));
    const view = new DataView(wav);
    const text = (at: number, n: number) => String.fromCharCode(...new Uint8Array(wav, at, n));
    expect(text(0, 4)).toBe('RIFF');
    expect(text(8, 8)).toBe('WAVEfmt ');
    expect([view.getUint16(20, true), view.getUint16(22, true), view.getUint32(24, true), view.getUint16(34, true)]).toEqual([1, 1, 16_000, 16]);
    expect(text(36, 4)).toBe('data');
    expect(view.getUint32(40, true)).toBe(10);
    expect(wav.byteLength).toBe(54);
    // Loud samples are kept in range rather than wrapping round.
    expect([0, 1, 2, 3, 4].map((i) => view.getInt16(44 + i * 2, true))).toEqual([0, 32767, -32768, 16383, 32767]);
  });
});
