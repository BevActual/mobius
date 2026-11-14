import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { IconButton } from './Button';

/**
 * Pro controls (Instrument, "Controls" and "Pro app readouts"), with Music as their first user: a number field you can
 * drag, a fixed-width readout, a letter toggle (M, S, R), the transport group and a level meter fed outside React.
 * Readouts and number fields use the mono face with tabular figures, so live values never jitter.
 */

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export interface NumberFieldProps {
  label: string;
  hideLabel?: boolean;
  value: number;
  onChange: (value: number) => void;
  /** Called once a drag, a typed value or a key press is done (for undo). */
  onCommit?: (value: number) => void;
  min: number;
  max: number;
  /** Arrow step (1). Shift+arrow moves `bigStep` (10 times the step). */
  step?: number;
  bigStep?: number;
  /** Double-click goes back to this. */
  reset?: number;
  /** Grey after the value: "BPM", "st". */
  unit?: string;
  /** Show a + on positive values (transpose). */
  signed?: boolean;
  /** Digits after the point. Whole numbers by default. */
  decimals?: number;
  disabled?: boolean;
  /** Characters the value is sized for, so the field keeps its width as the value changes. */
  width?: number;
  className?: string;
}

/** Pixels of drag per step: coarse, and fine with Shift. */
const DRAG_PX = 3;
const FINE_PX = 12;

/**
 * A value you can type, nudge with the arrows (Shift for ten times), or drag up and down to scrub (Shift for fine).
 * Double-click resets; Enter or typing a figure opens it for typing, Escape cancels. Out-of-range values clamp and the
 * tooltip says so. A spinbutton to assistive tech.
 */
export function NumberField({
  label, hideLabel, value, onChange, onCommit, min, max, step = 1, bigStep, reset, unit, signed, decimals = 0, disabled, width, className,
}: NumberFieldProps) {
  const id = useId();
  const [typing, setTyping] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const drag = useRef<{ y: number; from: number; moved: boolean } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const big = bigStep ?? step * 10;
  const round = (v: number) => Number(clamp(Math.round(v / step) * step, min, max).toFixed(decimals));
  const text = (v: number) => `${signed && v > 0 ? '+' : ''}${v.toFixed(decimals)}`;
  const chars = width ?? Math.max(text(min).length, text(max).length);

  useEffect(() => { if (typing !== null) input.current?.select(); }, [typing !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (next: number, commit: boolean) => {
    const v = round(next);
    if (v !== value) onChange(v);
    if (commit) onCommit?.(v);
  };

  const finishTyping = () => {
    if (typing === null) return;
    const read = Number(typing.trim().replace(/^\+/, '').replace(',', '.'));
    setTyping(null);
    if (typing.trim() === '' || Number.isNaN(read)) { setNote(null); return; }
    const v = round(read);
    setNote(read < min ? `Kept to the lowest, ${text(min)}` : read > max ? `Kept to the highest, ${text(max)}` : null);
    set(v, true);
  };

  const key = (e: KeyboardEvent<HTMLElement>) => {
    if (typing !== null) {
      if (e.key === 'Enter') { e.preventDefault(); finishTyping(); }
      else if (e.key === 'Escape') { e.preventDefault(); setTyping(null); }
      return;
    }
    const by: Record<string, number> = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 };
    const dir = by[e.key];
    if (dir !== undefined) set(value + dir * (e.shiftKey ? big : step), true);
    else if (e.key === 'PageUp' || e.key === 'PageDown') set(value + (e.key === 'PageUp' ? big : -big), true);
    else if (e.key === 'Home') set(min, true);
    else if (e.key === 'End') set(max, true);
    else if (e.key === 'Enter') setTyping(text(value));
    else if (/^[0-9.+-]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) setTyping(e.key);
    else return;
    e.preventDefault();
  };

  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || typing !== null || e.button !== 0) return;
    drag.current = { y: e.clientY, from: value, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dy = d.y - e.clientY;
    if (!d.moved && Math.abs(dy) < 2) return;
    d.moved = true;
    set(d.from + Math.trunc(dy / (e.shiftKey ? FINE_PX : DRAG_PX)) * step, false);
  };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.moved) onCommit?.(value);
  };

  const tip = [label, note, reset !== undefined ? 'Double-click to reset' : null].filter(Boolean).join('. ');

  return (
    <div className={className ? `ui-number ${className}` : 'ui-number'} data-disabled={disabled || undefined}>
      <span id={`${id}-label`} className="ui-field-label" data-hidden={hideLabel || undefined}>{label}</span>
      <div
        className="ui-number-box"
        role="spinbutton"
        tabIndex={disabled ? -1 : 0}
        aria-labelledby={`${id}-label`}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={unit ? `${text(value)} ${unit}` : text(value)}
        aria-disabled={disabled || undefined}
        title={tip}
        data-typing={typing !== null || undefined}
        data-clamped={note ? true : undefined}
        style={{ ['--chars' as string]: chars }}
        onKeyDown={key}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onDoubleClick={() => { if (!disabled && reset !== undefined) { setNote(null); set(reset, true); } }}
      >
        {typing !== null ? (
          <input
            ref={input}
            className="ui-number-input"
            aria-label={label}
            inputMode="decimal"
            value={typing}
            onChange={(e) => setTyping(e.target.value)}
            onBlur={finishTyping}
            onKeyDown={(e) => { e.stopPropagation(); key(e); }}
          />
        ) : (
          <span className="ui-number-value">{text(value)}</span>
        )}
        {unit && <span className="ui-number-unit">{unit}</span>}
      </div>
    </div>
  );
}

/**
 * A read-only live value in the mono face, tabular and fixed width so it never jitters ("12 . 3 . 2"). With more than
 * one format, a click switches between them (bars, time); otherwise a click copies it, when `copy` is set.
 */
export function Readout({ label, formats, format: shown, onFormatChange, copy, width, size = 'md', className }: {
  label: string;
  /** The value in each format, first shown first: `[{ name: 'Bars', text: '12 . 3 . 2' }, { name: 'Time', text: '0:23.5' }]`. */
  formats: readonly { name: string; text: string }[];
  /** The format on show (controlled), by name. */
  format?: string;
  onFormatChange?: (name: string) => void;
  /** Copy the value on click (when there is only one format). */
  copy?: boolean;
  /** Characters to size for; by default the longest format. */
  width?: number;
  size?: 'md' | 'lg';
  className?: string;
}) {
  const [own, setOwn] = useState(formats[0]?.name ?? '');
  const name = shown ?? own;
  const at = Math.max(0, formats.findIndex((f) => f.name === name));
  const current = formats[at] ?? { name: '', text: '' };
  const [copied, setCopied] = useState(false);
  const chars = width ?? Math.max(...formats.map((f) => f.text.length), 1);
  const switches = formats.length > 1;
  const next = formats[(at + 1) % formats.length];

  const click = () => {
    if (switches && next) { setOwn(next.name); onFormatChange?.(next.name); return; }
    if (copy) {
      void navigator.clipboard?.writeText(current.text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }, () => {});
    }
  };

  const body = (
    <>
      <span className="ui-readout-value" aria-live="off">{current.text}</span>
      {switches && <span className="ui-readout-format">{current.name}</span>}
    </>
  );
  const style = { ['--chars' as string]: chars };
  const cls = className ? `ui-readout ${className}` : 'ui-readout';
  if (!switches && !copy) {
    return <span className={cls} data-size={size} role="status" aria-label={`${label}: ${current.text}`} style={style}>{body}</span>;
  }
  return (
    <button
      type="button"
      className={cls}
      data-size={size}
      style={style}
      aria-label={`${label}: ${current.text}`}
      title={switches && next ? `${label}. Click to show ${next.name.toLowerCase()}` : copied ? 'Copied' : `${label}. Click to copy`}
      onClick={click}
    >
      {body}
    </button>
  );
}

/**
 * A small square toggle with one letter: M mute, S solo, R record, and the same for lock and hide. Off is a hairline
 * square with a grey letter; on is an ink fill with a paper letter (red for an armed R). `dimmed` greys the letter of
 * a track another track's solo silences.
 */
export function LetterToggle({ letter, label, pressed, onChange, keys, armed, dimmed, disabled }: {
  letter: string;
  /** Its full name, the accessible name and tooltip: "Mute Drums". */
  label: string;
  pressed: boolean;
  onChange: (pressed: boolean) => void;
  keys?: string;
  /** Record: red when on. */
  armed?: boolean;
  dimmed?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="ui-letter"
      aria-label={label}
      aria-pressed={pressed}
      title={keys ? `${label} (${keys})` : label}
      data-armed={armed || undefined}
      data-dimmed={dimmed || undefined}
      disabled={disabled}
      onClick={() => onChange(!pressed)}
    >
      <span aria-hidden="true">{letter}</span>
    </button>
  );
}

const Svg = ({ d, fill }: { d: string; fill?: boolean }) => (
  <svg viewBox="0 0 16 16" aria-hidden="true" data-fill={fill || undefined}><path d={d} /></svg>
);
export const TRANSPORT_ICONS = {
  play: <Svg d="M5 3.5v9l7.5-4.5z" fill />,
  pause: <Svg d="M5 3.5h2v9H5zM9 3.5h2v9H9z" fill />,
  stop: <Svg d="M4.5 4.5h7v7h-7z" fill />,
  record: <Svg d="M8 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" fill />,
  loop: <Svg d="M4 6.5V6a2 2 0 0 1 2-2h6.5M10.5 2l2 2-2 2M12 9.5v.5a2 2 0 0 1-2 2H3.5M5.5 14l-2-2 2-2" />,
  metronome: <Svg d="M6.5 2.5h3l2.5 11h-8zM8 10.5l3.5-6M5 10.5h6" />,
};

/**
 * The transport: Play/Pause, Stop, then the latching Record, Loop and Metronome, as one group of icon buttons with
 * their keys in the tooltips. Latched buttons show the pressed grey fill (Record is red only while armed). The app
 * owns the keys themselves; pass what it binds so the tooltips match.
 */
export function Transport({ playing, onPlay, onStop, recording, onRecord, loop, onLoop, metronome, onMetronome, keys = {}, label = 'Transport' }: {
  playing: boolean;
  onPlay: () => void;
  onStop: () => void;
  recording?: boolean;
  onRecord?: () => void;
  loop?: boolean;
  onLoop?: () => void;
  metronome?: boolean;
  onMetronome?: () => void;
  keys?: { play?: string; stop?: string; record?: string; loop?: string; metronome?: string };
  label?: string;
}) {
  return (
    <div className="ui-transport" role="group" aria-label={label}>
      <IconButton label={playing ? 'Pause' : 'Play'} keys={keys.play ?? 'Space'} icon={playing ? TRANSPORT_ICONS.pause : TRANSPORT_ICONS.play} onClick={onPlay} />
      <IconButton label="Stop" keys={keys.stop ?? 'Enter'} icon={TRANSPORT_ICONS.stop} onClick={onStop} />
      {onRecord && <IconButton className="ui-transport-record" label="Record" keys={keys.record ?? 'R'} pressed={!!recording} icon={TRANSPORT_ICONS.record} onClick={onRecord} />}
      {onLoop && <IconButton label="Loop" keys={keys.loop ?? 'L'} pressed={!!loop} icon={TRANSPORT_ICONS.loop} onClick={onLoop} />}
      {onMetronome && <IconButton label="Metronome" keys={keys.metronome ?? 'K'} pressed={!!metronome} icon={TRANSPORT_ICONS.metronome} onClick={onMetronome} />}
    </div>
  );
}

/** Where a level in dB sits on a meter from `floor` to `ceiling` dB, 0 to 1 (linear in dB). */
export const levelPosition = (db: number, floor = -60, ceiling = 6): number => clamp((db - floor) / (ceiling - floor), 0, 1);

/** Feed for a LevelMeter: call `set` with each channel's level in dB, as often as audio gives it (about 30 a second). */
export interface LevelFeed {
  set: (...db: number[]) => void;
  /** Clear the peaks and the clip light. */
  reset: () => void;
}

const HOLD_MS = 1500;
const FALL_DB_PER_S = 20;

/**
 * A vertical level meter, one bar per channel (stereo by default), from -60 to +6 dB. Levels come through a ref
 * (`ref.current.set(left, right)`), written straight to the bars, so feeding it 30 times a second doesn't re-render
 * anything. The peak line holds for 1.5 seconds and then falls; only the part over 0 dB is red, and the clip light
 * above stays lit until clicked.
 */
export interface LevelMeterProps {
  label: string;
  channels?: number;
  floor?: number;
  ceiling?: number;
  className?: string;
  /**
   * A compressor's or gate's threshold in dB, drawn as a line across the bars with a tab at the right to drag. Up and
   * Down move it a decibel, Shift six; Home or two quick presses put it back to `thresholdReset`.
   */
  threshold?: number;
  onThreshold?: (db: number) => void;
  /** Called once when a drag or a key is done (for undo). */
  onThresholdCommit?: (db: number) => void;
  thresholdReset?: number;
}

export const LevelMeter = forwardRef<LevelFeed, LevelMeterProps>(function LevelMeter(
  { label, channels = 2, floor = -60, ceiling = 6, className, threshold, onThreshold, onThresholdCommit, thresholdReset = 0 },
  ref,
) {
  const root = useRef<HTMLDivElement>(null);
  const peaks = useRef<{ db: number; at: number }[]>([]);
  const [clipped, setClipped] = useState(false);
  const clipRef = useRef(false);
  const zero = levelPosition(0, floor, ceiling);

  const set = useCallback((...db: number[]) => {
    const el = root.current;
    if (!el) return;
    const now = performance.now();
    const bars = el.querySelectorAll<HTMLElement>('.ui-level-bar');
    let loudest = -Infinity;
    bars.forEach((bar, i) => {
      const level = db[i] ?? db[0] ?? -Infinity;
      loudest = Math.max(loudest, level);
      const held = peaks.current[i] ?? { db: -Infinity, at: now };
      const age = now - held.at;
      const fallen = age > HOLD_MS ? held.db - ((age - HOLD_MS) / 1000) * FALL_DB_PER_S : held.db;
      const peak = level >= fallen ? { db: level, at: now } : { db: fallen, at: held.at };
      peaks.current[i] = level >= fallen ? peak : held;
      bar.style.setProperty('--level', String(levelPosition(level, floor, ceiling)));
      bar.style.setProperty('--peak', String(levelPosition(peak.db, floor, ceiling)));
    });
    el.setAttribute('aria-valuenow', String(Number.isFinite(loudest) ? Math.round(loudest) : floor));
    if (loudest > 0 && !clipRef.current) { clipRef.current = true; setClipped(true); }
  }, [floor, ceiling]);

  const reset = useCallback(() => {
    peaks.current = [];
    clipRef.current = false;
    setClipped(false);
    root.current?.querySelectorAll<HTMLElement>('.ui-level-bar').forEach((bar) => bar.style.setProperty('--peak', '0'));
  }, []);

  useImperativeHandle(ref, () => ({ set, reset }), [set, reset]);

  return (
    <div className={className ? `ui-level ${className}` : 'ui-level'} style={{ ['--zero' as string]: zero }}>
      <button type="button" className="ui-level-clip" data-on={clipped || undefined} aria-label={clipped ? `${label} clipped. Clear` : `${label} has not clipped`} title={clipped ? 'Clipped. Click to clear' : 'Clip'} onClick={reset} />
      <div ref={root} className="ui-level-bars" role="meter" aria-label={label} aria-valuemin={floor} aria-valuemax={ceiling} aria-valuenow={floor}>
        {Array.from({ length: channels }, (_, i) => (
          <div key={i} className="ui-level-bar">
            <div className="ui-level-fill" />
            <div className="ui-level-over" />
            <div className="ui-level-peak" />
          </div>
        ))}
        {threshold !== undefined && (
          <Threshold label={`${label} threshold`} value={threshold} floor={floor} ceiling={ceiling} reset={thresholdReset} onChange={onThreshold} onCommit={onThresholdCommit} />
        )}
      </div>
    </div>
  );
});

/** "−18 dB", with a true minus. */
export const decibelLabel = (db: number, digits = 0): string => `${db < 0 ? '\u2212' : ''}${Math.abs(db).toFixed(digits)} dB`;

const RESET_MS = 400;

/** The threshold line on a level meter: a slider across the bars, dragged by its tab. */
function Threshold({ label, value, floor, ceiling, reset, onChange, onCommit }: {
  label: string; value: number; floor: number; ceiling: number; reset: number;
  onChange?: (db: number) => void; onCommit?: (db: number) => void;
}) {
  const last = useRef(0);
  const moved = useRef(value);
  const put = (db: number) => { const next = Math.round(clamp(db, floor, ceiling) * 10) / 10; moved.current = next; onChange?.(next); return next; };
  const fromY = (el: HTMLElement, y: number) => {
    const box = (el.parentElement ?? el).getBoundingClientRect();
    return floor + (1 - (y - box.top) / box.height) * (ceiling - floor);
  };
  const twice = () => { const now = performance.now(); const yes = now - last.current < RESET_MS; last.current = yes ? 0 : now; return yes; };
  const down = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const el = event.currentTarget;
    el.focus();
    if (twice()) { const back = put(reset); onCommit?.(back); return; }
    el.setPointerCapture(event.pointerId);
    put(fromY(el, event.clientY));
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) put(fromY(event.currentTarget, event.clientY));
  };
  const up = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    onCommit?.(moved.current);
  };
  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    const by = event.shiftKey ? 6 : 1;
    const to = event.key === 'ArrowUp' || event.key === 'ArrowRight' ? value + by
      : event.key === 'ArrowDown' || event.key === 'ArrowLeft' ? value - by
      : event.key === 'PageUp' ? value + 6 : event.key === 'PageDown' ? value - 6
      : event.key === 'Home' ? reset : event.key === 'End' ? floor : undefined;
    if (to === undefined) return;
    event.preventDefault();
    const next = put(to);
    onCommit?.(next);
  };
  return (
    <div
      className="ui-level-threshold"
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={floor}
      aria-valuemax={ceiling}
      aria-valuenow={value}
      aria-valuetext={decibelLabel(value, Number.isInteger(value) ? 0 : 1)}
      title={`${decibelLabel(value, Number.isInteger(value) ? 0 : 1)}. Drag to set; double-click to reset`}
      style={{ ['--at' as string]: levelPosition(value, floor, ceiling) }}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onKeyDown={key}
    >
      <span className="ui-level-threshold-tab" aria-hidden="true" />
    </div>
  );
}

/** Feed for a GainReductionMeter: call `set` with how many dB the compressor is taking off now (0 or more). */
export interface ReductionFeed {
  set: (db: number) => void;
  reset: () => void;
}

/**
 * How much a compressor, limiter or gate is turning the sound down, as one bar that fills down from the top (0 dB) to
 * `range` dB. Fed through a ref like LevelMeter, so it never re-renders; the most it took off holds for 1.5 seconds as
 * a line, and `readout` shows that figure underneath in mono ("−4.2"), which a click clears.
 */
export const GainReductionMeter = forwardRef<ReductionFeed, { label: string; range?: number; readout?: boolean; className?: string }>(function GainReductionMeter(
  { label, range = 24, readout = true, className },
  ref,
) {
  const bar = useRef<HTMLDivElement>(null);
  const figure = useRef<HTMLButtonElement>(null);
  const held = useRef({ db: 0, at: 0 });
  const most = useRef(0);

  const set = useCallback((db: number) => {
    const el = bar.current;
    if (!el) return;
    const now = performance.now();
    const amount = clamp(Number.isFinite(db) ? Math.abs(db) : 0, 0, range);
    const age = now - held.current.at;
    const fallen = age > HOLD_MS ? Math.max(0, held.current.db - ((age - HOLD_MS) / 1000) * FALL_DB_PER_S) : held.current.db;
    if (amount >= fallen) held.current = { db: amount, at: now };
    el.style.setProperty('--reduce', String(amount / range));
    el.style.setProperty('--hold', String(Math.max(amount, fallen) / range));
    el.setAttribute('aria-valuenow', String(Math.round(amount * 10) / 10));
    if (amount > most.current) {
      most.current = amount;
      if (figure.current) figure.current.textContent = amount >= 0.05 ? `\u2212${amount.toFixed(1)}` : '0.0';
    }
  }, [range]);

  const reset = useCallback(() => {
    held.current = { db: 0, at: 0 };
    most.current = 0;
    bar.current?.style.setProperty('--hold', '0');
    if (figure.current) figure.current.textContent = '0.0';
  }, []);

  useImperativeHandle(ref, () => ({ set, reset }), [set, reset]);

  return (
    <div className={className ? `ui-reduce ${className}` : 'ui-reduce'}>
      <div ref={bar} className="ui-reduce-bar" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={range} aria-valuenow={0} aria-valuetext="dB of gain reduction">
        <div className="ui-reduce-fill" />
        <div className="ui-reduce-hold" />
      </div>
      {readout && (
        <button ref={figure} type="button" className="ui-reduce-figure" aria-label={`${label}, most taken off. Clear`} title="Most taken off. Click to clear" onClick={reset}>0.0</button>
      )}
    </div>
  );
});

/** "12 . 3 . 2": bars, beats and sixteenths, counted from 1, from a position in beats. */
export function barsLabel(beats: number, beatsPerBar = 4, ticksPerBeat = 4): string {
  const whole = Math.max(0, beats);
  const bar = Math.floor(whole / beatsPerBar) + 1;
  const beat = Math.floor(whole % beatsPerBar) + 1;
  const tick = Math.floor((whole % 1) * ticksPerBeat) + 1;
  return `${bar} . ${beat} . ${tick}`;
}

/** "1:05.3": minutes, seconds and tenths. */
export function clockLabel(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${m}:${rest < 10 ? '0' : ''}${rest.toFixed(1)}`;
}
