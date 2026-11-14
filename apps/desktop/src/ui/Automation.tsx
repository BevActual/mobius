import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { ARROW, clamp, useGraphDrag, type Handle } from './Instrument';
import type { ContentColor } from './Bits';

/**
 * AutomationLane: one setting's breakpoint line under a track, as wide as the arrangement (`beats` × `pxPerBeat`), so
 * its beats line up with the clips above it. Music first; Video's volume and effect lanes later.
 *
 * Click the lane to add a point and keep dragging to place it; drag a point to move it (across snaps to `grid`, hold
 * Alt to move freely); double-click a point or press Delete to remove it. The lane takes one Tab stop and the focus
 * roves between points: Left and Right move a point by one grid step, Up and Down change its value (Shift for more),
 * Ctrl or Cmd with Left and Right (or Home and End) move to another point, and Enter adds a point one grid step later.
 * A point never passes its neighbours, so the line always runs left to right. `onCommit` runs once a drag or key ends.
 */

export interface AutomationPoint { beat: number; value: number }

/** A beat (from 0) as bar.beat.sixteenth, the way an arrangement reads it: beat 5.25 in 4/4 is "2.2.2". */
export function beatLabel(beat: number, beatsPerBar = 4): string {
  const whole = Math.floor(beat + 1e-9);
  const sixteenth = Math.floor((beat - whole) * 4 + 1e-9) + 1;
  return `${Math.floor(whole / beatsPerBar) + 1}.${(whole % beatsPerBar) + 1}.${sixteenth}`;
}

/** The lane's value at a beat: flat before the first point and after the last, straight lines between. */
export function laneValueAt(points: readonly AutomationPoint[], beat: number, empty = 0): number {
  if (!points.length) return empty;
  if (beat <= points[0]!.beat) return points[0]!.value;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!;
    if (beat <= b.beat) return b.beat === a.beat ? b.value : a.value + ((beat - a.beat) / (b.beat - a.beat)) * (b.value - a.value);
  }
  return points[points.length - 1]!.value;
}

const roundBeat = (b: number) => Math.round(b * 1e4) / 1e4;
const roundValue = (v: number) => Math.round(clamp(v, 0, 1) * 1000) / 1000;
const pctLabel = (v: number) => `${Math.round(v * 100)}%`;

export function AutomationLane({ label, points, beats, pxPerBeat, onChange, onCommit, format = pctLabel, grid = 1, beatsPerBar = 4, empty = 0, color, head = true, disabled, className }: {
  /** The setting it automates, such as "Volume" or "Filter cutoff". */
  label: string;
  /** Sorted by beat. Values run 0 to 1; `format` turns one into words for the readout. */
  points: readonly AutomationPoint[];
  beats: number;
  pxPerBeat: number;
  onChange: (next: AutomationPoint[]) => void;
  onCommit?: (next: AutomationPoint[]) => void;
  format?: (value: number) => string;
  /** The step, in beats, that adding, dragging and Left/Right snap to. */
  grid?: number;
  beatsPerBar?: number;
  /** Where the line sits with no points (the setting's own value), drawn faint. */
  empty?: number;
  /** The track's content colour for the line and its fill (ink when left out). Points stay ink. */
  color?: ContentColor;
  /** The name and readout above the plot. Pass false when the app shows the name in its own track head: the place and
   * value of a point then show beside it only while it is dragged or focused. */
  head?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const [focus, setFocus] = useState(0);
  const [focusNext, setFocusNext] = useState<number | null>(null);
  const [tagged, setTagged] = useState(false);
  const plot = useRef<HTMLDivElement | null>(null);
  const latest = useRef<AutomationPoint[]>([...points]);
  latest.current = [...points];
  const f = clamp(focus, 0, Math.max(0, points.length - 1));

  // After a point is added or removed, move the keyboard focus to the point that now holds it.
  useEffect(() => {
    if (focusNext === null) return;
    plot.current?.querySelector<HTMLElement>(`[data-point="${focusNext}"]`)?.focus({ preventScroll: true });
    setFocusNext(null);
  }, [focusNext, points.length]);

  const snapBeat = (b: number, free: boolean) => clamp(roundBeat(free ? b : Math.round(b / grid) * grid), 0, beats);
  const room = (i: number, b: number) => clamp(b, points[i - 1]?.beat ?? 0, points[i + 1]?.beat ?? beats);
  const emit = (next: AutomationPoint[]) => { latest.current = next; onChange(next); };
  const move = (i: number, patch: Partial<AutomationPoint>) => {
    const p = points[i];
    if (!p) return;
    const next = points.map((q, j) => (j === i ? { beat: roundBeat(room(i, patch.beat ?? q.beat)), value: roundValue(patch.value ?? q.value) } : q));
    if (next[i]!.beat !== p.beat || next[i]!.value !== p.value) emit(next);
  };
  const remove = (i: number) => {
    if (!points[i]) return;
    const next = points.filter((_, j) => j !== i);
    emit(next);
    onCommit?.(next);
    setFocus(Math.max(0, i - 1));
    if (next.length) setFocusNext(Math.max(0, i - 1));
  };
  const insert = (beat: number, value: number) => {
    let i = points.findIndex((p) => p.beat > beat);
    if (i < 0) i = points.length;
    const next = [...points.slice(0, i), { beat, value: roundValue(value) }, ...points.slice(i)];
    emit(next);
    setFocus(i);
    return { i, next };
  };

  const keyOf = (i: number) => `p${i}` as const;
  const indexOf = (k: string) => Number(k.slice(1));
  const { held, grab, surfaceProps } = useGraphDrag<`p${number}`>(
    (k, x, y, e) => move(indexOf(k), { beat: snapBeat(x * beats, e.altKey), value: y }),
    () => onCommit?.(latest.current),
    (k) => remove(indexOf(k)),
  );

  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0 || (e.target as Element).closest('.ui-graph-handle')) return;
    const box = e.currentTarget.getBoundingClientRect();
    const beat = snapBeat(((e.clientX - box.left) / box.width) * beats, e.altKey);
    const value = 1 - (e.clientY - box.top) / box.height;
    const { i } = insert(beat, value);
    setFocusNext(i);
    grab(keyOf(i))(e);
  };

  const key = (k: `p${number}`, e: KeyboardEvent<HTMLSpanElement>) => {
    const i = indexOf(k);
    const p = points[i]!;
    const jump = e.ctrlKey || e.metaKey;
    const go = (to: number) => { e.preventDefault(); const n = clamp(to, 0, points.length - 1); setFocus(n); setFocusNext(n); };
    if (e.key === 'Home') return go(0);
    if (e.key === 'End') return go(points.length - 1);
    if (jump && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return go(i + ARROW[e.key]!);
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(i); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      const beat = snapBeat(p.beat + grid, false);
      if (beat <= p.beat || points[i + 1]?.beat === beat) return;
      const { i: at, next } = insert(beat, p.value);
      onCommit?.(next);
      setFocusNext(at);
      return;
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      move(i, { beat: p.beat + ARROW[e.key]! * (e.shiftKey ? beatsPerBar : grid) });
      return;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      move(i, { value: p.value + ARROW[e.key]! * (e.shiftKey ? 0.1 : 0.01) });
    }
  };
  const keyUp = (e: KeyboardEvent<HTMLDivElement>) => { if (ARROW[e.key] && !(e.ctrlKey || e.metaKey)) onCommit?.(latest.current); };

  const handles: Handle<`p${number}`>[] = points.map((p, i) => ({
    key: keyOf(i), x: beats ? p.beat / beats : 0, y: p.value,
    label: `${label} point ${i + 1} of ${points.length}`,
    text: `${beatLabel(p.beat, beatsPerBar)}, ${format(p.value)}`, now: p.value, min: 0, max: 1,
  }));
  const X = (b: number) => (beats ? (b / beats) * 100 : 0);
  const Y = (v: number) => 100 - v * 100;
  const line = points.length
    ? [`M 0 ${Y(points[0]!.value)}`, ...points.map((p) => `L ${X(p.beat)} ${Y(p.value)}`), `L 100 ${Y(points[points.length - 1]!.value)}`].join(' ')
    : `M 0 ${Y(empty)} L 100 ${Y(empty)}`;
  const bars = Array.from({ length: Math.max(0, Math.ceil(beats / beatsPerBar) - 1) }, (_, b) => X((b + 1) * beatsPerBar));
  const shown = points[held ? indexOf(held) : f];

  return (
    <div
      className={className ? `ui-lane ${className}` : 'ui-lane'}
      role="group"
      aria-label={`${label} automation`}
      data-disabled={disabled || undefined}
      data-empty={!points.length || undefined}
      data-headless={!head || undefined}
      data-color={color}
      style={{ width: `${beats * pxPerBeat}px` } as CSSProperties}
      onKeyUp={keyUp}
    >
      {head && (
        <div className="ui-lane-head" aria-hidden="true">
          <span className="ui-lane-name">{label}</span>
          <span className="ui-lane-value">{shown ? `${beatLabel(shown.beat, beatsPerBar)}  ${format(shown.value)}` : format(empty)}</span>
        </div>
      )}
      <div
        className="ui-lane-plot"
        data-held={held || undefined}
        {...surfaceProps}
        ref={(el) => { plot.current = el; (surfaceProps.ref as { current: HTMLDivElement | null }).current = el; }}
        onPointerDown={down}
        tabIndex={!disabled && !points.length ? 0 : undefined}
        aria-label={!points.length ? `${label}: no points. Click to add one, or press Enter` : undefined}
        onKeyDown={(e) => {
          if (disabled || points.length || e.target !== e.currentTarget || e.key !== 'Enter') return;
          e.preventDefault();
          const { next } = insert(0, empty);
          onCommit?.(next);
          setFocusNext(0);
        }}
      >
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {bars.map((x) => <line key={x} className="ui-graph-guide" x1={x} y1={0} x2={x} y2={100} />)}
          {points.length > 0 && <path className="ui-graph-area" d={`${line} L 100 100 L 0 100 Z`} />}
          <path className="ui-graph-line" data-ghost={!points.length || undefined} d={line} />
        </svg>
        {!head && shown && (held || tagged) && (
          <span className="ui-lane-tag" aria-hidden="true" style={{ left: `${X(shown.beat)}%`, top: `${Y(shown.value)}%` } as CSSProperties} data-low={shown.value < 0.5 || undefined}>
            {beatLabel(shown.beat, beatsPerBar)}  {format(shown.value)}
          </span>
        )}
        {handles.map((h, i) => (
          <span
            key={h.key}
            className="ui-graph-handle"
            data-point={i}
            role="slider"
            tabIndex={disabled ? -1 : i === f ? 0 : -1}
            aria-label={h.label}
            aria-valuemin={0}
            aria-valuemax={1}
            aria-valuenow={h.now}
            aria-valuetext={h.text}
            aria-disabled={disabled || undefined}
            data-held={held === h.key || undefined}
            style={{ left: `${h.x * 100}%`, top: `${(1 - h.y) * 100}%` } as CSSProperties}
            onPointerDown={disabled ? undefined : grab(h.key)}
            onKeyDown={(e) => { if (!disabled) key(h.key, e); }}
            onFocus={() => { setFocus(i); setTagged(true); }}
            onBlur={() => setTagged(false)}
          />
        ))}
      </div>
    </div>
  );
}
