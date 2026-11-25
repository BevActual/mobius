/**
 * Listening on this computer takes a 16 kHz, one-channel, 16-bit WAV (crates/mobius-voice). The window records
 * webm/opus, so when the host answers `wav: true` the recording is decoded, mixed down and resampled here, then sent
 * again. The chat model's server and the others take a WAV as well, so a fallback still works with it.
 */
export const LISTENING_RATE = 16_000;

/** Samples between -1 and 1 as a PCM WAV file: one channel, 16 bits. */
export function encodeWav(samples: Float32Array, rate: number = LISTENING_RATE): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const text = (at: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i)); };
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // one channel
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

/** A recording in any format the window can play, as a 16 kHz WAV. */
export async function toListeningWav(audio: ArrayBuffer): Promise<ArrayBuffer> {
  const context = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await context.decodeAudioData(audio.slice(0));
  } finally {
    void context.close();
  }
  const length = Math.max(1, Math.ceil(decoded.duration * LISTENING_RATE));
  // One channel: the browser mixes the recording's channels down as it renders.
  const offline = new OfflineAudioContext(1, length, LISTENING_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  return encodeWav(rendered.getChannelData(0), LISTENING_RATE);
}
