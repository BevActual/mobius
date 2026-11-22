// The window's own renderer (studio-audio.ts), bundled for a headless browser by compare.cjs.
import { renderSong } from '../../../apps/desktop/src/studio-audio';
import { parseSong } from '../../../apps/desktop/src/song-format';

declare global {
  interface Window { renderInWindow(text: string, solo?: string): Promise<[string, string]> }
}

window.renderInWindow = async (text, solo) => {
  const parsed = parseSong(text);
  if ('error' in parsed) throw new Error(parsed.error);
  const song = parsed.song;
  if (solo) for (const t of song.tracks) t.muted = t.id !== solo;
  const buf = await renderSong(song, 44100);
  const encode = (a: Float32Array) => {
    const bytes = new Uint8Array(a.buffer.slice(0));
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };
  return [encode(buf.getChannelData(0)), encode(buf.getChannelData(1))];
};
