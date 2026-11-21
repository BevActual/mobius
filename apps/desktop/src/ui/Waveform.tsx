import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';

/**
 * A waveform view (Music's sampler: a person's own audio file). The file's shape in ink, start and end handles that
 * trim it (what is outside them greys out), and an optional loop region in a strip along the top whose two edges drag.
 * Click the strip where there is no loop to start one. Every edge is a slider: arrows move it 10 ms, Shift 100 ms,
 * Home and End go to the limits it can reach. `onCommit` runs once a drag is let go.
 *
 * With `warp`, a second strip under the loop strip holds warp markers, as Live's clip view does: each pins a moment of
 * the file to a beat, and the engine stretches the audio between them. Double-click the strip to add one (its beat is
 * read from its neighbours), drag one or use the arrows to move it in the file, and Delete removes it.
 */

export interface WaveRange { start: number; end: number; loop: { start: number; end: number } | null }
type Edge = 'start' | 'end' | 'loopStart' | 'loopEnd';

/** A warp marker: this moment of the file (`sample`, seconds) plays on this beat of the song. */
export interface WarpMarker { sample: number; beat: number }

/**
 * The beat a moment of the file falls on, read from the warp markers around it (straight between two, and on from the
 * nearest pair beyond them). With fewer than two markers, the file plays at `tempo`, from the one marker or from 0.
 */
export function warpBeatAt(markers: readonly WarpMarker[], seconds: number, tempo = 120): number {
  const list = [...markers].sort((a, b) => a.sample - b.sample);
  const perSecond = tempo / 60;
  if (list.length === 0) return seconds * perSecond;
  if (list.length === 1) return list[0]!.beat + (seconds - list[0]!.sample) * perSecond;
  let i = list.findIndex((m) => m.sample > seconds);
  if (i <= 0) i = i === 0 ? 1 : list.length - 1;
  const a = list[i - 1]!, b = list[i]!;
  return a.beat + ((seconds - a.sample) * (b.beat - a.beat)) / (b.sample - a.sample);
}

/** A beat as Live writes it in the warp strip: bar, beat and sixteenth from 1 ("3.2.1"), in 4/4 unless told. */
export function warpBeatLabel(beat: number, beatsPerBar = 4): string {
  const sixteenths = Math.round(Math.max(0, beat) * 4);
  const bar = Math.floor(sixteenths / (beatsPerBar * 4)) + 1;
  const inBar = sixteenths % (beatsPerBar * 4);
  return `${bar}.${Math.floor(inBar / 4) + 1}.${(inBar % 4) + 1}`;
}

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

export function WaveformView({ label, peaks, duration, value, onChange, onCommit, playhead, disabled, className, warp, onWarpChange, onWarpCommit, tempo = 120 }: {
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
  /** Warp markers, in the file's order. Leave out for a view with no warp strip. */
  warp?: readonly WarpMarker[];
  onWarpChange?: (next: WarpMarker[]) => void;
  /** Once a marker is let go, added or removed. */
  onWarpCommit?: (next: WarpMarker[]) => void;
  /** The song's tempo, for a marker's beat while there are fewer than two. */
  tempo?: number;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const [held, setHeld] = useState<Edge | null>(null);
  const [heldWarp, setHeldWarp] = useState<number | null>(null);
  const latest = useRef(value);
  latest.current = value;
  const latestWarp = useRef<WarpMarker[]>([...(warp ?? [])]);
  latestWarp.current = [...(warp ?? [])];
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
  // A marker moves in the file only between its neighbours, so the markers stay in order.
  const warpLimits = (i: number, list: readonly WarpMarker[]): [number, number] => [
    i > 0 ? list[i - 1]!.sample + MIN_GAP : 0,
    i < list.length - 1 ? list[i + 1]!.sample - MIN_GAP : duration,
  ];
  const placeWarp = (i: number, at: number) => {
    const list = latestWarp.current;
    const [lo, hi] = warpLimits(i, list);
    const next = list.map((m, j) => (j === i ? { ...m, sample: Math.round(clamp(at, lo, hi) * 1000) / 1000 } : m));
    latestWarp.current = next;
    onWarpChange?.(next);
    return next;
  };
  const grabWarp = (i: number) => (e: PointerEvent<HTMLElement>) => {
    if (disabled || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    surface.current!.setPointerCapture(e.pointerId);
    e.currentTarget.focus({ preventScroll: true });
    setHeldWarp(i);
  };
  const addWarp = (e: { clientX: number }) => {
    if (disabled || !warp) return;
    const box = surface.current!.getBoundingClientRect();
    const at = Math.round(clamp((e.clientX - box.left) / box.width, 0, 1) * duration * 1000) / 1000;
    const list = latestWarp.current;
    if (list.some((m) => Math.abs(m.sample - at) < MIN_GAP)) return;
    const next = [...list, { sample: at, beat: Math.round(warpBeatAt(list, at, tempo) * 1000) / 1000 }].sort((a, b) => a.sample - b.sample);
    latestWarp.current = next;
    onWarpChange?.(next);
    onWarpCommit?.(next);
  };
  const warpKey = (i: number) => (e: KeyboardEvent<HTMLSpanElement>) => {
    if (disabled) return;
    const list = latestWarp.current;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      const next = list.filter((_, j) => j !== i);
      latestWarp.current = next;
      onWarpChange?.(next);
      onWarpCommit?.(next);
      return;
    }
    const by = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
    const [lo, hi] = warpLimits(i, list);
    let to: number | null = null;
    if (by) to = list[i]!.sample + by * (e.shiftKey ? 0.1 : 0.01);
    else if (e.key === 'Home') to = lo;
    else if (e.key === 'End') to = hi;
    if (to === null) return;
    e.preventDefault();
    const moved = placeWarp(i, to);
    onWarpCommit?.(moved);
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (held) place(held, seconds(e));
    else if (heldWarp !== null) placeWarp(heldWarp, seconds(e));
  };
  const up = () => {
    if (held) { setHeld(null); onCommit?.(latest.current); }
    else if (heldWarp !== null) { setHeldWarp(null); onWarpCommit?.(latestWarp.current); }
  };
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
      <div ref={surface} className="ui-wave-surface" data-held={held ?? (heldWarp !== null ? 'warp' : undefined)} data-warp={warp ? true : undefined} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { setHeld(null); setHeldWarp(null); }}>
        <div className="ui-wave-strip" onPointerDown={strip} title={value.loop ? undefined : 'Press to add a loop'}>
          {value.loop && <span className="ui-wave-loop" style={{ left: at(value.loop.start), right: `calc(100% - ${at(value.loop.end)})` } as CSSProperties} />}
        </div>
        {warp && <div className="ui-wave-warp" onDoubleClick={addWarp} title={warp.length ? undefined : 'Double-click to add a warp marker'} />}
        <div className="ui-wave-body">
          <svg viewBox={`0 0 ${n - 1 || 1} 100`} preserveAspectRatio="none" aria-hidden="true"><line className="ui-wave-axis" x1={0} y1={50} x2={n} y2={50} /><path className="ui-wave-shape" d={shape} /></svg>
          {value.loop && <span className="ui-wave-loop-band" style={{ left: at(value.loop.start), right: `calc(100% - ${at(value.loop.end)})` } as CSSProperties} />}
          <span className="ui-wave-trim" data-side="start" style={{ width: at(value.start) }} />
          <span className="ui-wave-trim" data-side="end" style={{ left: at(value.end) }} />
          {warp?.map((m, i) => <span key={`line-${i}`} className="ui-wave-warp-line" data-held={heldWarp === i || undefined} style={{ left: at(m.sample) }} />)}
          {playhead !== undefined && <span className="ui-wave-playhead" style={{ left: at(playhead) }} />}
        </div>
        {warp?.map((m, i) => {
          const [lo, hi] = warpLimits(i, warp);
          return (
            <span
              key={`warp-${i}`}
              className="ui-wave-marker"
              data-held={heldWarp === i || undefined}
              role="slider"
              tabIndex={disabled ? -1 : 0}
              aria-label={`Warp marker ${i + 1}, beat ${warpBeatLabel(m.beat)}`}
              aria-valuemin={lo}
              aria-valuemax={hi}
              aria-valuenow={m.sample}
              aria-valuetext={`${sampleTime(m.sample)} on ${warpBeatLabel(m.beat)}`}
              aria-keyshortcuts="Delete"
              title={`${warpBeatLabel(m.beat)} · Delete removes it`}
              data-at={m.sample <= 0 ? 'first' : m.sample >= duration ? 'last' : undefined}
              style={{ left: at(m.sample) }}
              onPointerDown={grabWarp(i)}
              onKeyDown={warpKey(i)}
            />
          );
        })}
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
            data-at={(edge === 'start' || edge === 'end') && s <= 0 ? 'first' : (edge === 'start' || edge === 'end') && s >= duration ? 'last' : undefined}
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
