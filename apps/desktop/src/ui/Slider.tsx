import { MobiusMark } from '../MobiusMark';
import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';

/**
 * Sliders, parameter cells and meters (Instrument, "Slider and meter", "Parameter cell"; the Adjust card's controls).
 *
 * The look is Photo's: a 6px grey track with an ink fill from the slider's origin (zero, or its lowest value) to the
 * value, a slim 4 by 16px ink tick for a thumb inside a 24px hit square, a 2px ink ring for keyboard focus only, and
 * the value in tabular figures at the trailing end, grey at the origin and ink once moved.
 *
 * Behaviour: arrows nudge by `step`, Shift+arrows by `bigStep`, Home and End go to the ends, and double-click puts it
 * back to `reset` (the origin unless given). `onChange` runs while it moves (Instant controls); `onCommit` runs once
 * when it is let go or a key is released (Remake controls, which call Mobius only then).
 */

export interface SliderProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  /** Called once with the final value when the pointer or key is let go. */
  onCommit?: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Shift+arrow step. Ten steps unless given. */
  bigStep?: number;
  /** Where the fill starts and what reads as "unchanged": zero when the range crosses it, else `min`. */
  origin?: number;
  /** What double-click returns to. The origin unless given (Adjust passes what Mobius first set). */
  reset?: number;
  /** `log` for ranges people hear or see logarithmically (a filter's cutoff, an envelope's time). */
  scale?: 'linear' | 'log';
  /** The value as shown and as screen readers hear it ("+12", "−3.0 dB", "440 Hz"). */
  format?: (value: number) => string;
  /** The two ends named in plain words ("Shorter", "Longer"), shown under the track. */
  ends?: readonly [string, string];
  /** A Remake control (Mobius makes the result again when it is let go): a small Mobius mark after the name. */
  remake?: boolean;
  hideLabel?: boolean;
  hideValue?: boolean;
  /** Mobius set this value and nobody has kept it yet: the value reads in indigo inside a dashed indigo edge. */
  proposed?: boolean;
  disabled?: boolean;
  className?: string;
}

const SPAN = 1000;

/**
 * The value to draw: the real value at once when this control set it (a drag, a key), and a 300 ms glide to it when it
 * changed from outside (Mobius turning a knob, an undo), so a viewer sees it move. Instant with reduced motion.
 * `own` holds the last value the control itself sent.
 */
export function useGlide(target: number, own: { current: number | null }, ms = 300): number {
  const [shown, setShown] = useState(target);
  const now = useRef(target);
  const frame = useRef(0);
  useEffect(() => {
    if (typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(frame.current);
    const still = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const mine = own.current !== null && Math.abs(own.current - target) < 1e-9;
    if (mine || still || typeof requestAnimationFrame === 'undefined' || now.current === target) {
      now.current = target;
      setShown(target);
      return;
    }
    const start = performance.now();
    const from = now.current;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / ms);
      const v = from + (target - from) * (1 - Math.pow(1 - k, 3));
      now.current = v;
      setShown(v);
      if (k < 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
  }, [target]); // eslint-disable-line react-hooks/exhaustive-deps
  return shown;
}

function clamp(v: number, lo: number, hi: number) { return Math.min(hi, Math.max(lo, v)); }
function snap(v: number, step: number, min: number) {
  const n = Math.round((v - min) / step) * step + min;
  // Keep 0.1 + 0.2 from showing as 0.30000000000000004.
  const digits = (String(step).split('.')[1] ?? '').length;
  return Number(n.toFixed(digits));
}

/** Position 0 to 1 along the track for a value, and back. A log scale needs a positive range. */
export function toPosition(value: number, min: number, max: number, scale: 'linear' | 'log' = 'linear'): number {
  if (max === min) return 0;
  if (scale === 'log' && min > 0) return clamp(Math.log(value / min) / Math.log(max / min), 0, 1);
  return clamp((value - min) / (max - min), 0, 1);
}
export function fromPosition(at: number, min: number, max: number, scale: 'linear' | 'log' = 'linear'): number {
  if (scale === 'log' && min > 0) return min * Math.pow(max / min, clamp(at, 0, 1));
  return min + clamp(at, 0, 1) * (max - min);
}

const RemakeMark = () => (
  <span className="ui-remake" title="Mobius makes it again when you let go"><MobiusMark size={12} /></span>
);

/** The range input itself, shared by Slider and ParamCell. */
/** A log-scale nudge: `octaves` of an octave up or down, moving at least one `step`. */
export function logNudge(value: number, by: number, octaves: number, step: number): number {
  const next = value * Math.pow(2, by * octaves);
  return by > 0 ? Math.max(next, value + step) : Math.min(next, value - step);
}

function Track({ id, label, value, display = value, onChange, onCommit, min, max, step, bigStep, origin, reset, scale, format, disabled, thin, describedBy }: Required<Pick<SliderProps, 'label' | 'value' | 'onChange' | 'min' | 'max' | 'step' | 'scale'>> & Pick<SliderProps, 'onCommit' | 'bigStep' | 'origin' | 'reset' | 'format' | 'disabled'> & { id: string; thin?: boolean; describedBy?: string; /** Where to draw it while it glides. */ display?: number }) {
  const zero = origin ?? (min < 0 && max > 0 ? 0 : min);
  const back = reset ?? zero;
  const at = toPosition(display, min, max, scale), from = toPosition(zero, min, max, scale);
  const last = useRef(value);
  const set = (next: number) => onChange(snap(clamp(next, min, max), step, min));
  const commit = () => { if (onCommit && last.current !== value) { last.current = value; onCommit(value); } };
  const key = (event: KeyboardEvent<HTMLInputElement>) => {
    const by = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 0;
    if (by && event.shiftKey) {
      event.preventDefault();
      set(scale === 'log' && bigStep === undefined ? logNudge(value, by, 1 / 2, step) : value + by * (bigStep ?? step * 10));
    } else if (by && scale === 'log') {
      // On a log scale a nudge is a twelfth of an octave (Shift above: half an octave), and at least one `step`.
      event.preventDefault();
      set(logNudge(value, by, 1 / 12, step));
    }
  };
  const style = { '--from': Math.min(at, from), '--to': Math.max(at, from) } as CSSProperties;
  const log = scale === 'log';
  return (
    <input
      id={id}
      type="range"
      className="ui-track"
      data-thin={thin || undefined}
      aria-label={label}
      aria-describedby={describedBy}
      aria-valuetext={format ? format(value) : undefined}
      min={log ? 0 : min}
      max={log ? SPAN : max}
      step={log ? 1 : step}
      value={log ? Math.round(at * SPAN) : display}
      disabled={disabled}
      style={style}
      onChange={(e) => set(log ? fromPosition(Number(e.target.value) / SPAN, min, max, scale) : Number(e.target.value))}
      onKeyDown={key}
      onKeyUp={commit}
      onPointerUp={commit}
      onDoubleClick={() => { onChange(back); if (onCommit) { last.current = back; onCommit(back); } }}
    />
  );
}

export function Slider({ label, value, onChange, onCommit, min = 0, max = 100, step = 1, bigStep, origin, reset, scale = 'linear', format, ends, remake, hideLabel, hideValue, proposed, disabled, className }: SliderProps) {
  const id = useId();
  const zero = origin ?? (min < 0 && max > 0 ? 0 : min);
  const own = useRef<number | null>(null);
  const send = (v: number) => { own.current = v; onChange(v); };
  const display = useGlide(value, own);
  const seen = display === value ? value : snap(display, step, min);
  const shown = format ? format(seen) : seen > 0 && min < 0 ? `+${seen}` : String(seen);
  const endsId = ends ? `${id}-ends` : undefined;
  return (
    <div className={className ? `ui-slider ${className}` : 'ui-slider'} data-changed={value !== zero || undefined} data-proposed={proposed || undefined} data-disabled={disabled || undefined} data-bare={hideLabel || undefined}>
      {!hideLabel && <label className="ui-slider-name" htmlFor={id}>{label}{remake && <RemakeMark />}</label>}
      <Track id={id} label={label} value={value} display={display} onChange={send} onCommit={onCommit} min={min} max={max} step={step} bigStep={bigStep} origin={origin} reset={reset} scale={scale} format={format} disabled={disabled} describedBy={endsId} />
      {!hideValue && <output className="ui-slider-value" htmlFor={id}>{shown}</output>}
      {ends && <div id={endsId} className="ui-slider-ends"><span>{ends[0]}</span><span>{ends[1]}</span></div>}
    </div>
  );
}

/**
 * A parameter cell for pro apps (Music's device, Video's clip): a small all-caps label, the value large in the mono face
 * with its unit, and a thin slider under it. `keyHint` is the letter or number in the corner that matches its key. Put
 * cells in a `ParamGrid`, two to a row.
 */
export function ParamCell({ label, unit, keyHint, wide, size, ...slider }: Omit<SliderProps, 'ends' | 'hideLabel' | 'hideValue' | 'remake'> & {
  unit?: string; keyHint?: string; /** Span the whole row of its grid. */ wide?: boolean;
  /** `compact` for a dense pro panel (Music's Device): a body-size mono value under a sentence-case name. */
  size?: 'regular' | 'compact';
}) {
  const id = useId();
  const { value, format, min = 0, max = 100, step = 1, scale = 'linear', className, disabled, proposed, onChange } = slider;
  const own = useRef<number | null>(null);
  const send = (v: number) => { own.current = v; onChange(v); };
  const display = useGlide(value, own);
  const seen = display === value ? value : snap(display, step, min);
  const shown = format ? format(seen) : String(seen);
  return (
    <div className={className ? `ui-param ${className}` : 'ui-param'} data-proposed={proposed || undefined} data-disabled={disabled || undefined} data-wide={wide || undefined} data-size={size === 'compact' ? 'compact' : undefined}>
      <label className="ui-param-name" htmlFor={id}>{label}</label>
      {keyHint && <span className="ui-param-key" aria-hidden="true">{keyHint}</span>}
      <output className="ui-param-value" htmlFor={id}>{shown}{unit && <span className="ui-param-unit">{unit}</span>}</output>
      <Track id={id} {...slider} display={display} onChange={send} min={min} max={max} step={step} scale={scale} label={label} format={format ? (v) => `${format(v)}${unit ? ` ${unit}` : ''}` : unit ? (v) => `${v} ${unit}` : undefined} thin />
    </div>
  );
}

export function ParamGrid({ label, columns = 2, children }: { label?: string; /** Cells to a row: 2 by default, 1 for a lone cell such as Volume, 4 for a row of knobs. */ columns?: 1 | 2 | 3 | 4; children: ReactNode }) {
  return <div className="ui-param-grid" role="group" aria-label={label} data-columns={columns === 2 ? undefined : columns}>{children}</div>;
}

/**
 * A meter shows a level that is not set here (a track's level, storage used): the same thin track with an ink fill, and
 * its value in tabular figures. With `threshold`, only the part past it is red (clipping, nearly full): red marks the
 * overage, never the whole reading.
 */
export function Meter({ label, value, min = 0, max = 1, format, threshold, hideLabel, className }: {
  label: string; value: number; min?: number; max?: number; format?: (value: number) => string; threshold?: number; hideLabel?: boolean; className?: string;
}) {
  const at = toPosition(value, min, max);
  const limit = threshold === undefined ? 1 : toPosition(threshold, min, max);
  const text = format ? format(value) : `${Math.round(at * 100)}%`;
  return (
    <div className={className ? `ui-meter ${className}` : 'ui-meter'} data-bare={hideLabel || undefined}>
      {!hideLabel && <span className="ui-meter-name">{label}</span>}
      <div className="ui-meter-track" role="meter" aria-label={label} aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} aria-valuetext={text} data-over={at > limit || undefined}>
        <div className="ui-meter-fill" style={{ width: `${Math.min(at, limit) * 100}%` }} />
        {at > limit && <div className="ui-meter-over" style={{ left: `${limit * 100}%`, width: `${(at - limit) * 100}%` }} />}
      </div>
      {!hideLabel && <span className="ui-meter-value">{text}</span>}
    </div>
  );
}

/** Known progress: a thin ink line. Mobius's own work uses the working indicator instead, and content never spins. */
export function Progress({ label, value, max = 1, className }: { label: string; value: number; max?: number; className?: string }) {
  return (
    <div className={className ? `ui-progress ${className}` : 'ui-progress'} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
      <div className="ui-progress-fill" style={{ width: `${toPosition(value, 0, max) * 100}%` }} />
    </div>
  );
}
