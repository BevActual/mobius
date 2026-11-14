import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';

/**
 * A waveform view (Music's sampler: a person's own audio file). The file's shape in ink, start and end handles that
 * trim it (what is outside them greys out), and an optional loop region in a strip along the top whose two edges drag.
 * Click the strip where there is no loop to start one. Every edge is a slider: arrows move it 10 ms, Shift 100 ms,
 * Home and End go to the limits it can reach. `onCommit` runs once a drag is let go.
 */

export interface WaveRange { start: number; end: number; loop: { start: number; end: number } | null }
type Edge = 'start' | 'end' | 'loopStart' | 'loopEnd';

const MIN_GAP = 0.01; // seconds between any two edges

function clamp(v: number, lo: number, hi: number) { return Math.min(hi, Math.max(lo, v)); }

/** Seconds as a sampler reads them: "0:01.250". */
export function sampleTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${m}:${rest.toFixed(3).padStart(6, '0')}`;
}

/** Peaks for drawing: the loudest sample (0 to 1) in each of `buckets` slices of a channel. */
export function peaksOf(samples: Float32Array | readonly number[], buckets: number): number[] {
  const out: number[] = [];
  const size = samples.length / buckets;
  for (let b = 0; b < buckets; b++) {
    let peak = 0;
    const from = Math.floor(b * size), to = Math.max(from + 1, Math.floor((b + 1) * size));
    for (let i = from; i < to && i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]!));
    out.push(Math.min(1, peak));
  }
  return out;
}

export function WaveformView({ label, peaks, duration, value, onChange, onCommit, playhead, disabled, className }: {
  label: string;
  /** The file's shape: one peak (0 to 1) per slice, from `peaksOf`. */
  peaks: readonly number[];
  /** The file's length in seconds. */
  duration: number;
  value: WaveRange;
  onChange: (next: WaveRange) => void;
  onCommit?: (next: WaveRange) => void;
  /** Where it is playing, in seconds. */
  playhead?: number;
  disabled?: boolean;
  className?: string;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const [held, setHeld] = useState<Edge | null>(null);
  const latest = useRef(value);
  latest.current = value;
  const at = (s: number) => `${(clamp(s, 0, duration) / duration) * 100}%`;

  // Each edge moves only as far as its neighbours allow, so the order start ≤ loop start < loop end ≤ end always holds.
  const limits = (edge: Edge, v: WaveRange): [number, number] => {
    const loop = v.loop;
    if (edge === 'start') return [0, (loop ? loop.start : v.end - MIN_GAP)];
    if (edge === 'end') return [loop ? loop.end : v.start + MIN_GAP, duration];
    if (edge === 'loopStart') return [v.start, loop!.end - MIN_GAP];
    return [loop!.start + MIN_GAP, v.end];
  };
  const place = (edge: Edge, seconds: number) => {
    const v = latest.current;
    const [lo, hi] = limits(edge, v);
    const s = Math.round(clamp(seconds, lo, hi) * 1000) / 1000;
    const next: WaveRange = edge === 'start' ? { ...v, start: s } : edge === 'end' ? { ...v, end: s }
      : edge === 'loopStart' ? { ...v, loop: { start: s, end: v.loop!.end } } : { ...v, loop: { start: v.loop!.start, end: s } };
    onChange(next);
    return next;
  };
  const seconds = (e: PointerEvent) => {
    const box = surface.current!.getBoundingClientRect();
    return clamp((e.clientX - box.left) / box.width, 0, 1) * duration;
  };
  const grab = (edge: Edge) => (e: PointerEvent<HTMLElement>) => {
    if (disabled || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    surface.current!.setPointerCapture(e.pointerId);
    e.currentTarget.focus({ preventScroll: true });
    setHeld(edge);
  };
  const move = (e: PointerEvent<HTMLDivElement>) => { if (held) place(held, seconds(e)); };
  const up = () => { if (held) { setHeld(null); onCommit?.(latest.current); } };
  // A press on the loop strip with no loop starts one there, a tenth of the trimmed length wide; drag to size it.
  const strip = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0 || value.loop) return;
    const s = clamp(seconds(e), value.start, value.end - MIN_GAP);
    const width = Math.max(MIN_GAP, Math.min((value.end - value.start) / 10, value.end - s));
    const next = { ...value, loop: { start: Math.round(s * 1000) / 1000, end: Math.round((s + width) * 1000) / 1000 } };
    latest.current = next;
    onChange(next);
    surface.current!.setPointerCapture(e.pointerId);
    setHeld('loopEnd');
  };
  const key = (edge: Edge) => (e: KeyboardEvent<HTMLSpanElement>) => {
    if (disabled) return;
    const v = value;
    const now = edge === 'start' ? v.start : edge === 'end' ? v.end : edge === 'loopStart' ? v.loop!.start : v.loop!.end;
    const by = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
    const [lo, hi] = limits(edge, v);
    let next: number | null = null;
    if (by) next = now + by * (e.shiftKey ? 0.1 : 0.01);
    else if (e.key === 'Home') next = lo;
    else if (e.key === 'End') next = hi;
    if (next === null) return;
    e.preventDefault();
    // Not onCommit?.(place(…)): with no onCommit, optional chaining would skip the move itself.
    const moved = place(edge, next);
    onCommit?.(moved);
  };
  const edges: { edge: Edge; at: number; name: string }[] = [
    { edge: 'start', at: value.start, name: 'Start' },
    { edge: 'end', at: value.end, name: 'End' },
    ...(value.loop ? [{ edge: 'loopStart' as const, at: value.loop.start, name: 'Loop start' }, { edge: 'loopEnd' as const, at: value.loop.end, name: 'Loop end' }] : []),
  ];
  const n = Math.max(1, peaks.length);
  const top = peaks.map((p, i) => `${i} ${(50 - clamp(p, 0, 1) * 48).toFixed(2)}`);
  const bottom = peaks.map((p, i) => `${i} ${(50 + clamp(p, 0, 1) * 48).toFixed(2)}`).reverse();
  const shape = peaks.length ? `M ${top.join(' L ')} L ${bottom.join(' L ')} Z` : '';
  return (
    <div className={className ? `ui-wave ${className}` : 'ui-wave'} role="group" aria-label={label} data-disabled={disabled || undefined}>
      <div ref={surface} className="ui-wave-surface" data-held={held || undefined} onPointerMove={move} onPointerUp={up} onPointerCancel={() => setHeld(null)}>
        <div className="ui-wave-strip" onPointerDown={strip} title={value.loop ? undefined : 'Press to add a loop'}>
          {value.loop && <span className="ui-wave-loop" style={{ left: at(value.loop.start), right: `calc(100% - ${at(value.loop.end)})` } as CSSProperties} />}
        </div>
        <div className="ui-wave-body">
          <svg viewBox={`0 0 ${n - 1 || 1} 100`} preserveAspectRatio="none" aria-hidden="true"><line className="ui-wave-axis" x1={0} y1={50} x2={n} y2={50} /><path className="ui-wave-shape" d={shape} /></svg>
          {value.loop && <span className="ui-wave-loop-band" style={{ left: at(value.loop.start), right: `calc(100% - ${at(value.loop.end)})` } as CSSProperties} />}
          <span className="ui-wave-trim" data-side="start" style={{ width: at(value.start) }} />
          <span className="ui-wave-trim" data-side="end" style={{ left: at(value.end) }} />
          {playhead !== undefined && <span className="ui-wave-playhead" style={{ left: at(playhead) }} />}
        </div>
        {edges.map(({ edge, at: s, name }) => (
          <span
            key={edge}
            className="ui-wave-edge"
            data-edge={edge}
            data-held={held === edge || undefined}
            role="slider"
            tabIndex={disabled ? -1 : 0}
            aria-label={name}
            aria-valuemin={limits(edge, value)[0]}
            aria-valuemax={limits(edge, value)[1]}
            aria-valuenow={s}
            aria-valuetext={sampleTime(s)}
            style={{ left: at(s) }}
            onPointerDown={grab(edge)}
            onKeyDown={key(edge)}
          />
        ))}
      </div>
      <dl className="ui-wave-readout">
        <div><dt>Start</dt><dd>{sampleTime(value.start)}</dd></div>
        <div><dt>End</dt><dd>{sampleTime(value.end)}</dd></div>
        <div><dt>Loop</dt><dd>{value.loop ? `${sampleTime(value.loop.start)}–${sampleTime(value.loop.end)}` : 'Off'}</dd></div>
        <div><dt>Length</dt><dd>{sampleTime(value.end - value.start)}</dd></div>
      </dl>
    </div>
  );
}
