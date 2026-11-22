import { useEffect, useState } from 'react';

/** An audio file's waveform as the engine gives it: lowest and highest sample over each `per` frames at `rate`. */
export interface Peaks { rate: number; per: number; peaks: [number, number][] }

/**
 * The part of a waveform from `from` to `to` seconds as an SVG path in a box `width` wide and 2 high (−1 to 1, the
 * middle at 0): one column per point across, each from that stretch's lowest to its highest sample, as Live draws a
 * clip. Empty when there is nothing to draw.
 */
export function wavePath(p: Peaks, from: number, to: number, width: number): string {
  const columns = Math.max(0, Math.floor(width));
  if (!columns || to <= from || !p.peaks.length || p.rate <= 0 || p.per <= 0) return '';
  const perSec = p.rate / p.per;
  const parts: string[] = [];
  for (let x = 0; x < columns; x++) {
    const a = Math.floor((from + ((to - from) * x) / columns) * perSec);
    const b = Math.max(a + 1, Math.floor((from + ((to - from) * (x + 1)) / columns) * perSec));
    if (a >= p.peaks.length) break;
    let lo = 1;
    let hi = -1;
    for (let i = Math.max(0, a); i < Math.min(b, p.peaks.length); i++) { const [l, h] = p.peaks[i]!; if (l < lo) lo = l; if (h > hi) hi = h; }
    if (hi < lo) continue;
    // At least a hairline, so silence still reads as a line.
    const top = Math.max(-1, Math.min(1, -hi));
    const bottom = Math.max(top + 0.02, Math.min(1, -lo));
    parts.push(`M${x + 0.5} ${top.toFixed(3)}V${bottom.toFixed(3)}`);
  }
  return parts.join('');
}

const cache = new Map<string, Promise<Peaks | null>>();

/** A file's peaks from the engine, asked once per song and file; null when there is no engine or it couldn't read it. */
export function loadPeaks(songPath: string, file: string): Promise<Peaks | null> {
  const key = `${songPath}\u0000${file}`;
  let got = cache.get(key);
  if (!got) {
    const m = typeof window === 'undefined' ? undefined : window.mobius?.music;
    got = m?.peaks ? m.peaks(songPath, file).then((r) => (r.ok ? { rate: r.rate, per: r.per, peaks: r.peaks } : null), () => null) : Promise.resolve(null);
    cache.set(key, got);
    // A failed read is asked again next time (the file may arrive, as a take does once saved).
    void got.then((v) => { if (!v) cache.delete(key); });
  }
  return got;
}

/** An audio clip's sound, drawn from `offset` seconds for `seconds`; a flat band until (or unless) the peaks come. */
export function ClipWave({ songPath, file, offset, seconds, width }: { songPath: string; file: string; offset: number; seconds: number; width: number }) {
  const [peaks, setPeaks] = useState<Peaks | null>(null);
  useEffect(() => {
    let live = true;
    setPeaks(null);
    if (songPath) void loadPeaks(songPath, file).then((p) => { if (live) setPeaks(p); });
    return () => { live = false; };
  }, [songPath, file]);
  const cols = Math.min(2000, Math.max(1, Math.round(width)));
  const d = peaks ? wavePath(peaks, offset, offset + seconds, cols) : '';
  return (
    <span className="studio-clip-wave" data-drawn={d ? true : undefined} aria-hidden="true">
      {d && <svg viewBox={`0 -1 ${cols} 2`} preserveAspectRatio="none"><path d={d} /></svg>}
    </span>
  );
}
