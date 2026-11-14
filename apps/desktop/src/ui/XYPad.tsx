import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';

/**
 * The two-axis pad (Instrument, round 9): one point sets two values at once, such as Music's Dark to Bright and Calm to
 * Busy. A frame-grey surface with a quarter grid, an ink point with crosshair lines to the edges, and a hollow mark
 * where the point started (where Mobius first put it), which stays until the result is kept. Both ends of both axes
 * are named in words outside the pad, and the exact values read out under it in the mono face.
 *
 * Values run 0 to 1 on each axis (x left to right, y bottom to top). A click anywhere jumps the point; dragging moves it
 * (`onChange` as it moves, `onCommit` once on release, for a remake). Arrows nudge by `step`, Shift+arrows by ten
 * steps, Home or double-click goes back to `start`.
 */

export interface PadAxis {
  /** The axis's name in the readout ("Bright"). */
  name: string;
  /** Its two ends in words: low then high ("Dark", "Bright"). */
  ends: readonly [string, string];
  /** The value as read out. A whole percent unless given. */
  format?: (value: number) => string;
}

export interface PadPoint { x: number; y: number }

const clamp = (v: number) => Math.min(1, Math.max(0, v));
const pct = (v: number) => `${Math.round(v * 100)}%`;

export function XYPad({ label, x, y, value, start, onChange, onCommit, step = 0.01, disabled, hideReadout, className }: {
  /** The pad's name, for screen readers ("Feel"). */
  label: string;
  x: PadAxis;
  y: PadAxis;
  value: PadPoint;
  /** Where the point started; shown as a hollow mark, and where Home returns. */
  start?: PadPoint;
  onChange: (value: PadPoint) => void;
  onCommit?: (value: PadPoint) => void;
  step?: number;
  disabled?: boolean;
  hideReadout?: boolean;
  className?: string;
}) {
  const pad = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const fmtX = x.format ?? pct, fmtY = y.format ?? pct;

  const set = (next: PadPoint) => onChange({ x: clamp(next.x), y: clamp(next.y) });
  const fromPointer = (event: PointerEvent<HTMLDivElement>): PadPoint => {
    const box = pad.current!.getBoundingClientRect();
    return { x: clamp((event.clientX - box.left) / box.width), y: clamp(1 - (event.clientY - box.top) / box.height) };
  };
  const down = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus({ preventScroll: true });
    setDragging(true);
    set(fromPointer(event));
  };
  const move = (event: PointerEvent<HTMLDivElement>) => { if (dragging) set(fromPointer(event)); };
  const up = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setDragging(false);
    const at = fromPointer(event);
    set(at);
    onCommit?.({ x: clamp(at.x), y: clamp(at.y) });
  };
  const back = () => { if (start && !disabled) { set(start); onCommit?.(start); } };
  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const by = event.shiftKey ? step * 10 : step;
    const moves: Record<string, PadPoint> = {
      ArrowRight: { x: value.x + by, y: value.y }, ArrowLeft: { x: value.x - by, y: value.y },
      ArrowUp: { x: value.x, y: value.y + by }, ArrowDown: { x: value.x, y: value.y - by },
    };
    const next = moves[event.key];
    if (next) { event.preventDefault(); set(next); return; }
    if (event.key === 'Home' && start) { event.preventDefault(); back(); }
  };
  const keyUp = (event: KeyboardEvent<HTMLDivElement>) => { if (event.key.startsWith('Arrow')) onCommit?.(value); };

  const at = (p: PadPoint) => ({ left: `${p.x * 100}%`, top: `${(1 - p.y) * 100}%` }) as CSSProperties;
  const text = `${x.name} ${fmtX(value.x)}, ${y.name} ${fmtY(value.y)}`;
  return (
    <div className={className ? `ui-pad ${className}` : 'ui-pad'} data-disabled={disabled || undefined}>
      <div className="ui-pad-ends ui-pad-ends-y" aria-hidden="true"><span>{y.ends[0]}</span><span>{y.ends[1]}</span></div>
      <div
        ref={pad}
        className="ui-pad-surface"
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-roledescription="two-axis pad"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value.x * 100)}
        aria-valuetext={text}
        aria-disabled={disabled || undefined}
        aria-keyshortcuts={start ? 'Home' : undefined}
        data-dragging={dragging || undefined}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={() => setDragging(false)}
        onDoubleClick={back}
        onKeyDown={key}
        onKeyUp={keyUp}
      >
        <span className="ui-pad-line" data-axis="x" style={{ top: at(value).top }} />
        <span className="ui-pad-line" data-axis="y" style={{ left: at(value).left }} />
        {start && <span className="ui-pad-start" style={at(start)} />}
        <span className="ui-pad-point" style={at(value)} />
      </div>
      <div className="ui-pad-ends ui-pad-ends-x" aria-hidden="true"><span>{x.ends[0]}</span><span>{x.ends[1]}</span></div>
      {!hideReadout && (
        <div className="ui-pad-readout" aria-hidden="true">
          <span><small>{x.name}</small><b>{fmtX(value.x)}</b></span>
          <span><small>{y.name}</small><b>{fmtY(value.y)}</b></span>
        </div>
      )}
    </div>
  );
}
