import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type WheelEvent } from 'react';
import { fromPosition, logNudge, toPosition, useGlide, type SliderProps } from './Slider';
import { NumberField } from './Pro';

/**
 * Instrument controls: what a synth's or a drum kit's Device panel draws (Music first; Video's audio and any sound
 * preview later). Instrument, "Pro app readouts" and "Parameter cell" set the look: hairlines and ink on paper, values
 * in the mono face, grey until moved, a 2px ink ring for keyboard focus only.
 *
 * - `Knob`: a ParamCell as a dial, same props. For a dense row (pan, sends) where a slider is too wide.
 * - `EnvelopeGraph`: attack, decay, sustain and release as one shape with three handles to drag.
 * - `FilterGraph`: the filter's curve with one point: across is cutoff, up is resonance.
 * - `StepGrid`: drum rows by steps, velocity as each step's fill.
 *
 * Every one is keyboard-first: arrows nudge (a twelfth of an octave on a log scale), Shift nudges more, double-click
 * or Home puts it back, and `onCommit` runs once when a drag or a key is let go.
 */

export function clamp(v: number, lo: number, hi: number) { return Math.min(hi, Math.max(lo, v)); }
function snap(v: number, step: number, min: number) {
  const n = Math.round((v - min) / step) * step + min;
  const digits = (String(step).split('.')[1] ?? '').length;
  return Number(n.toFixed(digits));
}
export const ARROW: Record<string, 1 | -1> = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 };

/** Seconds as people read an envelope: "5 ms", "300 ms", "1.20 s". */
export function secondsLabel(seconds: number): string {
  if (seconds < 1) return `${Math.round(seconds * 1000)} ms`;
  return `${seconds.toFixed(2)} s`;
}
/** Hertz as people read a filter: "80 Hz", "950 Hz", "1.2 kHz", "12 kHz". */
export function hertzLabel(hz: number): string {
  if (hz < 1000) return `${Math.round(hz)} Hz`;
  return hz < 10000 ? `${(hz / 1000).toFixed(1)} kHz` : `${Math.round(hz / 1000)} kHz`;
}
/** Pan as a mixer reads it: "L 40", "C", "R 40" for -1 to +1. */
export function panLabel(pan: number): string {
  const n = Math.round(pan * 100);
  return n === 0 ? 'C' : n < 0 ? `L ${-n}` : `R ${n}`;
}
const pct = (v: number) => `${Math.round(v * 100)}%`;

/* ------------------------------------------------------------------------------------------------------------ Knob */

export type KnobProps = Omit<SliderProps, 'ends' | 'hideLabel' | 'hideValue' | 'remake'> & { unit?: string };

const KNOB_TRAVEL = 200; // pixels of vertical drag from one end to the other
const SWEEP = 270;

function arc(from: number, to: number) {
  // Angles in degrees, 0 at the top, clockwise; a circle of radius 12 around (16, 16).
  const at = (deg: number) => { const r = ((deg - 90) * Math.PI) / 180; return `${16 + 12 * Math.cos(r)} ${16 + 12 * Math.sin(r)}`; };
  const large = to - from > 180 ? 1 : 0;
  return `M ${at(from)} A 12 12 0 ${large} 1 ${at(to)}`;
}

/**
 * A dial with the same contract as ParamCell: the name above, the value under it in the mono face, and a 270° arc
 * filled in ink from the origin (zero, or the lowest value) to the value. Drag up or down to turn it (Shift for fine),
 * arrows nudge, Home and End go to the ends, double-click resets.
 */
export function Knob({ label, value, onChange: change, onCommit, min = 0, max = 100, step = 1, bigStep, origin, reset, scale = 'linear', format, unit, proposed, disabled, className }: KnobProps) {
  const id = useId();
  const zero = origin ?? (min < 0 && max > 0 ? 0 : min);
  const back = reset ?? zero;
  const own = useRef<number | null>(null);
  const onChange = (v: number) => { own.current = v; change(v); };
  const display = useGlide(value, own);
  const seen = display === value ? value : snap(display, step, min);
  const at = toPosition(value, min, max, scale), from = toPosition(zero, min, max, scale);
  const drawn = toPosition(display, min, max, scale);
  const drag = useRef<{ y: number; at: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const set = (next: number) => { const v = snap(clamp(next, min, max), step, min); if (v !== value) onChange(v); return v; };
  const shown = format ? format(seen) : String(seen);
  const text = `${format ? format(value) : String(value)}${unit ? ` ${unit}` : ''}`;

  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus({ preventScroll: true });
    drag.current = { y: e.clientY, at };
    setDragging(true);
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const fine = e.shiftKey ? 4 : 1;
    set(fromPosition(clamp(d.at + (d.y - e.clientY) / (KNOB_TRAVEL * fine), 0, 1), min, max, scale));
  };
  const up = () => { if (drag.current) { drag.current = null; setDragging(false); onCommit?.(value); } };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const by = ARROW[e.key] ?? (e.key === 'PageUp' ? 1 : e.key === 'PageDown' ? -1 : 0);
    const big = e.shiftKey || e.key.startsWith('Page');
    let next: number | null = null;
    if (by && scale === 'log') next = logNudge(value, by, big && bigStep === undefined ? 1 / 2 : 1 / 12, big && bigStep !== undefined ? bigStep : step);
    else if (by) next = value + by * (big ? bigStep ?? step * 10 : step);
    else if (e.key === 'Home') next = min;
    else if (e.key === 'End') next = max;
    if (next === null) return;
    e.preventDefault();
    set(next);
  };
  const a0 = -SWEEP / 2, lo = a0 + SWEEP * Math.min(drawn, from), hi = a0 + SWEEP * Math.max(drawn, from), now = a0 + SWEEP * drawn;
  const r = ((now - 90) * Math.PI) / 180;
  return (
    <div className={className ? `ui-knob ${className}` : 'ui-knob'} data-changed={value !== zero || undefined} data-proposed={proposed || undefined} data-disabled={disabled || undefined}>
      <span className="ui-knob-name" id={`${id}-name`}>{label}</span>
      <div
        className="ui-knob-dial"
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-labelledby={`${id}-name`}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={text}
        aria-disabled={disabled || undefined}
        aria-orientation="vertical"
        data-dragging={dragging || undefined}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onKeyDown={key}
        onKeyUp={(e) => { if (ARROW[e.key] || e.key.startsWith('Page') || e.key === 'Home' || e.key === 'End') onCommit?.(value); }}
        onDoubleClick={() => { if (!disabled) { onChange(back); onCommit?.(back); } }}
      >
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <path className="ui-knob-track" d={arc(a0, a0 + SWEEP)} />
          {hi - lo > 0.5 && <path className="ui-knob-fill" d={arc(lo, hi)} />}
          <line className="ui-knob-tick" x1={16 + 5 * Math.cos(r)} y1={16 + 5 * Math.sin(r)} x2={16 + 11 * Math.cos(r)} y2={16 + 11 * Math.sin(r)} />
        </svg>
      </div>
      <output className="ui-knob-value">{shown}{unit && <span className="ui-param-unit">{unit}</span>}</output>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------------- Graph bits */

export type Handle<K extends string> = { key: K; x: number; y: number; label: string; text: string; now: number; min: number; max: number; /** A short mark inside the handle (a band's number). */ mark?: string };

/** Shared drag for a graph: which handle is held, and the pointer as 0 to 1 across and up the surface. */
export function useGraphDrag<K extends string>(onMove: (key: K, x: number, y: number, event: PointerEvent) => void, onDone: () => void, onReset: (key: K) => void) {
  const surface = useRef<HTMLDivElement>(null);
  const [held, setHeld] = useState<K | null>(null);
  // The surface holds the pointer while dragging, so a handle never sees its own dblclick; two presses make one.
  const last = useRef<{ key: K; at: number } | null>(null);
  const where = (e: PointerEvent) => {
    const box = surface.current!.getBoundingClientRect();
    return { x: clamp((e.clientX - box.left) / box.width, 0, 1), y: clamp(1 - (e.clientY - box.top) / box.height, 0, 1) };
  };
  const grab = (key: K) => (e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const now = e.timeStamp;
    if (last.current && last.current.key === key && now - last.current.at < 400) { last.current = null; onReset(key); return; }
    last.current = { key, at: now };
    surface.current!.setPointerCapture(e.pointerId);
    e.currentTarget.focus({ preventScroll: true });
    setHeld(key);
  };
  const surfaceProps = {
    ref: surface,
    onPointerMove: (e: PointerEvent<HTMLDivElement>) => { if (held) { const p = where(e); onMove(held, p.x, p.y, e); } },
    onPointerUp: () => { if (held) { setHeld(null); onDone(); } },
    onPointerCancel: () => setHeld(null),
  };
  return { held, grab, surfaceProps };
}

export function HandleDot<K extends string>({ h, held, grab, onKey, onWheel, selected, disabled }: {
  h: Handle<K>; held: K | null; grab: (key: K) => (e: PointerEvent<HTMLElement>) => void;
  onKey: (key: K, e: KeyboardEvent<HTMLSpanElement>) => void; onWheel?: (key: K, e: WheelEvent<HTMLSpanElement>) => void;
  selected?: boolean; disabled?: boolean;
}) {
  // The wheel turns a handle (an EQ band's Q) instead of scrolling the page, so it needs a listener that can stop that.
  const dot = useRef<HTMLSpanElement>(null);
  const turn = useRef(onWheel);
  turn.current = onWheel;
  useEffect(() => {
    const el = dot.current;
    if (!el || !onWheel || disabled) return;
    const wheel = (e: globalThis.WheelEvent) => { e.preventDefault(); turn.current?.(h.key, e as unknown as WheelEvent<HTMLSpanElement>); };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [h.key, !!onWheel, disabled]);
  return (
    <span
      ref={dot}
      className="ui-graph-handle"
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={h.label}
      aria-valuemin={h.min}
      aria-valuemax={h.max}
      aria-valuenow={h.now}
      aria-valuetext={h.text}
      aria-disabled={disabled || undefined}
      data-held={held === h.key || undefined}
      data-selected={selected || undefined}
      data-mark={h.mark ? true : undefined}
      style={{ left: `${h.x * 100}%`, top: `${(1 - h.y) * 100}%` } as CSSProperties}
      onPointerDown={disabled ? undefined : grab(h.key)}
      onKeyDown={(e) => { if (!disabled) onKey(h.key, e); }}
    >{h.mark}</span>
  );
}

/* ------------------------------------------------------------------------------------------------------- Envelope */

export interface Envelope { attack: number; decay: number; sustain: number; release: number }
type Range = readonly [number, number];
export interface EnvelopeRanges { attack: Range; decay: Range; release: Range }
/** Music's ranges: attack 1 ms to 2 s, decay 10 ms to 4 s, release 20 ms to 4 s, all heard in ratios (log). */
export const ENVELOPE_RANGES: EnvelopeRanges = { attack: [0.001, 2], decay: [0.01, 4], release: [0.02, 4] };

// Each time takes up to a quarter of the width (a sliver at its shortest so its handle stays apart); sustain holds a fifth.
const SEG_MIN = 0.02, SEG_SPAN = 0.23, HOLD = 0.2;
const segOf = (seconds: number, r: Range) => SEG_MIN + SEG_SPAN * toPosition(seconds, r[0], r[1], 'log');
const secondsOf = (width: number, r: Range) => fromPosition((width - SEG_MIN) / SEG_SPAN, r[0], r[1], 'log');
const roundTime = (s: number) => Number(s.toPrecision(3));

/** Where the envelope's corners sit, 0 to 1 across and up. */
export function envelopePoints(env: Envelope, ranges: EnvelopeRanges = ENVELOPE_RANGES) {
  const a = segOf(env.attack, ranges.attack);
  const d = a + segOf(env.decay, ranges.decay);
  const s = d + HOLD;
  const r = s + segOf(env.release, ranges.release);
  return { a, d, s, r, level: clamp(env.sustain, 0, 1) };
}

type EnvKey = 'attack' | 'decay' | 'release';

/**
 * An ADSR envelope as one shape: up for the attack, down to the sustain level for the decay, held, then down for the
 * release. Three handles: the peak (attack across), the decay corner (decay across, sustain up), and the end (release
 * across). The four values read underneath. On a handle, arrows move it; on the decay corner, Up and Down move sustain.
 */
export function EnvelopeGraph({ label = 'Envelope', value, onChange, onCommit, reset, ranges = ENVELOPE_RANGES, disabled, className }: {
  label?: string;
  value: Envelope;
  onChange: (next: Envelope) => void;
  onCommit?: (next: Envelope) => void;
  /** What double-clicking a handle puts back (the instrument's own sound). */
  reset?: Envelope;
  ranges?: EnvelopeRanges;
  disabled?: boolean;
  className?: string;
}) {
  const p = envelopePoints(value, ranges);
  const set = (patch: Partial<Envelope>) => {
    const next = { ...value, ...patch };
    next.attack = roundTime(clamp(next.attack, ...ranges.attack));
    next.decay = roundTime(clamp(next.decay, ...ranges.decay));
    next.release = roundTime(clamp(next.release, ...ranges.release));
    next.sustain = Math.round(clamp(next.sustain, 0, 1) * 100) / 100;
    onChange(next);
  };
  const { held, grab, surfaceProps } = useGraphDrag<EnvKey>((key, x, y) => {
    if (key === 'attack') set({ attack: secondsOf(x, ranges.attack) });
    if (key === 'decay') set({ decay: secondsOf(x - p.a, ranges.decay), sustain: y });
    if (key === 'release') set({ release: secondsOf(x - p.s, ranges.release) });
  }, () => onCommit?.(value), (k) => back(k));
  const key = (k: EnvKey, e: KeyboardEvent<HTMLSpanElement>) => {
    const by = ARROW[e.key];
    if (k === 'decay' && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      set({ sustain: value.sustain + by! * (e.shiftKey ? 0.1 : 0.01) });
      return;
    }
    if (by) { e.preventDefault(); set({ [k]: logNudge(value[k], by, e.shiftKey ? 1 / 2 : 1 / 12, 0.001) }); return; }
    if (e.key === 'Home' && reset) { e.preventDefault(); back(k); }
  };
  const back = (k: EnvKey) => {
    if (!reset) return;
    const next = { ...value, [k]: reset[k], ...(k === 'decay' ? { sustain: reset.sustain } : {}) };
    onChange(next);
    onCommit?.(next);
  };
  const handles: Handle<EnvKey>[] = [
    { key: 'attack', x: p.a, y: 1, label: 'Attack', text: secondsLabel(value.attack), now: value.attack, min: ranges.attack[0], max: ranges.attack[1] },
    { key: 'decay', x: p.d, y: p.level, label: 'Decay and sustain', text: `Decay ${secondsLabel(value.decay)}, sustain ${pct(value.sustain)}`, now: value.decay, min: ranges.decay[0], max: ranges.decay[1] },
    { key: 'release', x: p.r, y: 0, label: 'Release', text: secondsLabel(value.release), now: value.release, min: ranges.release[0], max: ranges.release[1] },
  ];
  const y = (v: number) => 100 - v * 100;
  const shape = `M 0 100 L ${p.a * 100} 0 L ${p.d * 100} ${y(p.level)} L ${p.s * 100} ${y(p.level)} L ${p.r * 100} 100`;
  const changed = reset ? (['attack', 'decay', 'sustain', 'release'] as const).filter((k) => value[k] !== reset[k]) : [];
  return (
    <div className={className ? `ui-graph ${className}` : 'ui-graph'} role="group" aria-label={label} data-disabled={disabled || undefined}>
      <div className="ui-graph-surface" data-held={held || undefined}>
        <div className="ui-graph-plot" {...surfaceProps}>
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <path className="ui-graph-area" d={`${shape} Z`} />
            <path className="ui-graph-line" d={shape} />
            <line className="ui-graph-guide" x1={p.s * 100} y1={0} x2={p.s * 100} y2={100} />
          </svg>
          {handles.map((h) => <HandleDot key={h.key} h={h} held={held} grab={grab} onKey={key} disabled={disabled} />)}
        </div>
      </div>
      <dl className="ui-graph-readout">
        {(['attack', 'decay', 'sustain', 'release'] as const).map((k) => (
          <div key={k} data-changed={changed.includes(k) || undefined}>
            <dt>{k[0]!.toUpperCase() + k.slice(1)}</dt>
            <dd>{k === 'sustain' ? pct(value.sustain) : secondsLabel(value[k])}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/* --------------------------------------------------------------------------------------------------------- Filter */

export type FilterType = 'lowpass' | 'highpass' | 'bandpass';
export interface FilterValue { cutoff: number; resonance: number }
/** Music's mapping from resonance (0 to 1) to the filter's Q. */
export const musicQ = (resonance: number) => 0.7 + resonance * 14;

const DB_LO = -30, DB_HI = 24;
/** A two-pole filter's level in dB at `hz`. */
export function filterLevel(type: FilterType, hz: number, cutoff: number, q: number): number {
  const r = hz / cutoff;
  const base = Math.sqrt((1 - r * r) ** 2 + (r / q) ** 2);
  const gain = type === 'lowpass' ? 1 / base : type === 'highpass' ? (r * r) / base : r / q / base;
  return 20 * Math.log10(Math.max(gain, 1e-6));
}
const dbY = (db: number) => clamp((db - DB_LO) / (DB_HI - DB_LO), 0, 1);

/**
 * A filter's curve across the hearing range (log) with one point: across is cutoff, up is resonance (the point sits
 * on the curve's peak). `envAmount` and `envOctaves` add a thin muted curve where a note's envelope opens it to.
 * With `onEnvAmount`, the readout also shows Sweep (the envelope amount, 0 to 100%) as a drag-number field between
 * Resonance and Opens to, so the row reads Cutoff, Resonance, Sweep, Opens to and no separate knob is needed.
 * Arrows: Left and Right move cutoff a twelfth of an octave, Up and Down move resonance; Shift moves more.
 */
export function FilterGraph({ label = 'Filter', value, onChange, onCommit, reset, type = 'lowpass', min = 20, max = 20000, q = musicQ, envAmount, envOctaves = 4, onEnvAmount, onEnvAmountCommit, envAmountReset, disabled, className }: {
  label?: string;
  value: FilterValue;
  onChange: (next: FilterValue) => void;
  onCommit?: (next: FilterValue) => void;
  reset?: FilterValue;
  type?: FilterType;
  min?: number;
  max?: number;
  /** Resonance (0 to 1) to Q. Music's mapping unless given. */
  q?: (resonance: number) => number;
  /** How far, 0 to 1, a note's envelope opens the filter; drawn as a thin muted curve. */
  envAmount?: number;
  envOctaves?: number;
  /** Makes Sweep (envAmount) editable in the readout as a drag-number field, 0 to 100%. */
  onEnvAmount?: (next: number) => void;
  onEnvAmountCommit?: (next: number) => void;
  /** Sweep's default, 0 to 1; double-click puts it back. */
  envAmountReset?: number;
  disabled?: boolean;
  className?: string;
}) {
  const set = (next: FilterValue) => onChange({ cutoff: Math.round(clamp(next.cutoff, min, max)), resonance: Math.round(clamp(next.resonance, 0, 1) * 100) / 100 });
  const peak = (res: number) => (type === 'bandpass' ? res : dbY(filterLevel(type, value.cutoff, value.cutoff, q(res))));
  // The point sits on the peak; find the resonance for a height by halving (the peak rises with resonance).
  const resonanceAt = (height: number) => {
    let lo = 0, hi = 1;
    for (let i = 0; i < 20; i++) { const mid = (lo + hi) / 2; if (peak(mid) < height) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
  };
  const { held, grab, surfaceProps } = useGraphDrag<'point'>((_, x, y) => {
    set({ cutoff: fromPosition(x, min, max, 'log'), resonance: resonanceAt(y) });
  }, () => onCommit?.(value), () => back());
  const key = (_: 'point', e: KeyboardEvent<HTMLSpanElement>) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      set({ ...value, cutoff: logNudge(value.cutoff, ARROW[e.key]!, e.shiftKey ? 1 / 2 : 1 / 12, 1) });
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      set({ ...value, resonance: value.resonance + ARROW[e.key]! * (e.shiftKey ? 0.1 : 0.01) });
    } else if (e.key === 'Home' && reset) { e.preventDefault(); back(); }
  };
  const back = () => { if (reset) { onChange(reset); onCommit?.(reset); } };
  const curve = (cutoff: number) => {
    const qv = q(value.resonance);
    const pts: string[] = [];
    for (let i = 0; i <= 96; i++) {
      const x = i / 96;
      pts.push(`${(x * 100).toFixed(2)} ${(100 - dbY(filterLevel(type, fromPosition(x, min, max, 'log'), cutoff, qv)) * 100).toFixed(2)}`);
    }
    return `M ${pts.join(' L ')}`;
  };
  const line = curve(value.cutoff);
  const opened = envAmount ? Math.min(max, value.cutoff * Math.pow(2, envAmount * envOctaves)) : 0;
  const zero = 100 - dbY(0) * 100;
  const decades = [100, 1000, 10000].filter((f) => f > min && f < max);
  const handle: Handle<'point'> = {
    key: 'point', x: toPosition(value.cutoff, min, max, 'log'), y: peak(value.resonance), label: 'Cutoff and resonance',
    text: `Cutoff ${hertzLabel(value.cutoff)}, resonance ${pct(value.resonance)}`, now: value.cutoff, min, max,
  };
  return (
    <div className={className ? `ui-graph ${className}` : 'ui-graph'} role="group" aria-label={label} data-disabled={disabled || undefined}>
      <div className="ui-graph-surface" data-held={held || undefined}>
        <div className="ui-graph-plot" {...surfaceProps}>
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {decades.map((f) => { const x = toPosition(f, min, max, 'log') * 100; return <line key={f} className="ui-graph-guide" x1={x} y1={0} x2={x} y2={100} />; })}
            <line className="ui-graph-guide" x1={0} y1={zero} x2={100} y2={zero} />
            <path className="ui-graph-area" d={`${line} L 100 100 L 0 100 Z`} />
            {opened > value.cutoff && <path className="ui-graph-line" data-ghost d={curve(opened)} />}
            <path className="ui-graph-line" d={line} />
          </svg>
          <HandleDot h={handle} held={held} grab={grab} onKey={key} disabled={disabled} />
        </div>
      </div>
      <dl className="ui-graph-readout">
        <div data-changed={(reset && value.cutoff !== reset.cutoff) || undefined}><dt>Cutoff</dt><dd>{hertzLabel(value.cutoff)}</dd></div>
        <div data-changed={(reset && value.resonance !== reset.resonance) || undefined}><dt>Resonance</dt><dd>{pct(value.resonance)}</dd></div>
        {onEnvAmount && (
          <div data-changed={(envAmountReset !== undefined && (envAmount ?? 0) !== envAmountReset) || undefined}>
            <dt>Sweep</dt>
            <dd>
              <NumberField
                label="Sweep" hideLabel className="ui-graph-number" unit="%" min={0} max={100} width={3} disabled={disabled}
                value={Math.round((envAmount ?? 0) * 100)}
                reset={envAmountReset === undefined ? undefined : Math.round(envAmountReset * 100)}
                onChange={(v) => onEnvAmount(v / 100)}
                onCommit={onEnvAmountCommit && ((v) => onEnvAmountCommit(v / 100))}
              />
            </dd>
          </div>
        )}
        {(envAmount !== undefined || onEnvAmount) && <div><dt>Opens to</dt><dd>{hertzLabel(opened || value.cutoff)}</dd></div>}
      </dl>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------------- StepGrid */

export interface StepRow { id: string; name: string }

/**
 * A drum step grid: a row per sound, a cell per step, each beat's steps grouped. A step's fill is its velocity, so an
 * accent reads as a full cell. Click a step to switch it on (at `velocity`) or off; Shift+click for an accent; drag
 * across to paint. Keys: arrows move, Space or Enter switches, Shift+Enter accents, + and − change the velocity.
 * `cells[row][step]` is 0 for off, else the velocity (0 to 1). `now` is the step that is playing.
 */
export function StepGrid({ label = 'Steps', rows, cells, onChange, steps = 16, stepsPerBeat = 4, velocity = 0.7, accent = 1, now, fill, disabled, className }: {
  label?: string;
  rows: readonly StepRow[];
  cells: readonly (readonly number[])[];
  /** One step changed: its row, its step, and its velocity (0 is off). */
  onChange: (row: number, step: number, velocity: number) => void;
  steps?: number;
  stepsPerBeat?: number;
  velocity?: number;
  accent?: number;
  now?: number;
  /** Stretch the steps across the container's width (up to a wide cell each) instead of keeping them square. */
  fill?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const [focus, setFocus] = useState({ row: 0, step: 0 });
  const paint = useRef<number | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const vel = (r: number, s: number) => cells[r]?.[s] ?? 0;
  const put = (r: number, s: number, v: number) => { const next = Math.round(clamp(v, 0, 1) * 100) / 100; if (next !== vel(r, s)) onChange(r, s, next); };
  const toggled = (r: number, s: number, strong: boolean) => (vel(r, s) > 0 && !(strong && vel(r, s) < accent) ? 0 : strong ? accent : velocity);
  const moveTo = (row: number, step: number) => {
    const next = { row: clamp(row, 0, rows.length - 1), step: clamp(step, 0, steps - 1) };
    setFocus(next);
    grid.current?.querySelector<HTMLButtonElement>(`[data-cell="${next.row}-${next.step}"]`)?.focus();
  };
  const key = (r: number, s: number) => (e: KeyboardEvent<HTMLButtonElement>) => {
    const moves: Record<string, [number, number]> = { ArrowUp: [r - 1, s], ArrowDown: [r + 1, s], ArrowLeft: [r, s - 1], ArrowRight: [r, s + 1], Home: [r, 0], End: [r, steps - 1] };
    const to = moves[e.key];
    if (to) { e.preventDefault(); moveTo(...to); return; }
    if (disabled) return;
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); put(r, s, toggled(r, s, e.shiftKey)); }
    else if (e.key === '+' || e.key === '=') { e.preventDefault(); put(r, s, Math.max(vel(r, s), 0) + 0.1); }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); if (vel(r, s) > 0) put(r, s, Math.max(0.1, vel(r, s) - 0.1)); }
  };
  const down = (r: number, s: number) => (e: PointerEvent<HTMLButtonElement>) => {
    if (disabled || e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    const v = toggled(r, s, e.shiftKey);
    paint.current = v;
    setFocus({ row: r, step: s });
    e.currentTarget.focus({ preventScroll: true });
    put(r, s, v);
  };
  const over = (r: number, s: number) => () => { if (paint.current !== null) put(r, s, paint.current); };
  const stop = () => { paint.current = null; };
  return (
    <div
      ref={grid}
      className={className ? `ui-steps ${className}` : 'ui-steps'}
      role="group"
      aria-label={label}
      data-disabled={disabled || undefined}
      data-fill={fill || undefined}
      style={{ '--steps': steps } as CSSProperties}
      onPointerUp={stop}
      onPointerLeave={stop}
    >
      {rows.map((row, r) => (
        <div key={row.id} className="ui-steps-row" role="group" aria-label={row.name}>
          <span className="ui-steps-name" aria-hidden="true">{row.name}</span>
          {Array.from({ length: steps }, (_, s) => {
            const v = vel(r, s);
            return (
              <button
                key={s}
                type="button"
                className="ui-step"
                data-cell={`${r}-${s}`}
                data-on={v > 0 || undefined}
                data-accent={v >= accent || undefined}
                data-beat={Math.floor(s / stepsPerBeat) % 2 === 1 || undefined}
                data-now={now === s || undefined}
                aria-label={`${row.name}, step ${s + 1}${v > 0 ? `, velocity ${Math.round(v * 127)}${v >= accent ? ', accent' : ''}` : ''}`}
                aria-pressed={v > 0}
                tabIndex={focus.row === r && focus.step === s ? 0 : -1}
                disabled={disabled}
                style={{ '--vel': v } as CSSProperties}
                onPointerDown={down(r, s)}
                onPointerEnter={over(r, s)}
                onKeyDown={key(r, s)}
                onFocus={() => setFocus({ row: r, step: s })}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}
