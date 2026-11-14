import { createContext, useContext, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode, type WheelEvent } from 'react';
import { Switch } from './Switch';
import { fromPosition, logNudge, toPosition } from './Slider';
import { ARROW, HandleDot, clamp, hertzLabel, useGraphDrag, type Handle } from './Instrument';

/**
 * Devices: what an instrument or effect sits in, and the effects' own graphs (Music first).
 *
 * - `DeviceChain` and `DeviceFrame`: a row of titled blocks. Each has an on/off switch, a collapse, and a grip that
 *   drags it along the chain (or moves it with the arrow keys).
 * - `EqGraph`: three or four bands over one curve, a numbered dot per band: across is frequency, up is gain, and the
 *   wheel or Alt+drag sets Q.
 */

/* ---------------------------------------------------------------------------------------------------- Device chain */

const Chain = createContext<{ move: (from: number, to: number) => void; count: number; row: () => HTMLElement | null; vertical: boolean } | null>(null);

/**
 * A device chain: devices in the order sound passes through them, left to right, or top to bottom with
 * `orientation="vertical"` (a narrow side panel). `onMove(from, to)` reorders; the chain draws nothing of its own beyond
 * the row, and scrolls along its length when the devices don't fit.
 */
export function DeviceChain({ label, count, onMove, orientation = 'horizontal', children, className }: {
  label: string;
  /** Sideways (default) or stacked, for a panel too narrow for devices side by side. */
  orientation?: 'horizontal' | 'vertical';
  /** How many devices are in it (for the grips' keys and names). */
  count: number;
  onMove: (from: number, to: number) => void;
  children: ReactNode;
  className?: string;
}) {
  const row = useRef<HTMLDivElement>(null);
  return (
    <Chain.Provider value={{ move: onMove, count, row: () => row.current, vertical: orientation === 'vertical' }}>
      <div ref={row} className={className ? `ui-chain ${className}` : 'ui-chain'} role="list" aria-label={label} data-orientation={orientation === 'vertical' ? 'vertical' : undefined}>{children}</div>
    </Chain.Provider>
  );
}

/**
 * One device: its head (grip, on/off, name, collapse, then any `actions`) over its controls. Off dims the controls but
 * keeps them editable, as a bypassed device does. Collapsed shows the head alone.
 */
export function DeviceFrame({ title, index, on, onToggle, collapsed, onCollapse, lead, actions, proposed, children, className }: {
  title: string;
  /** Where it is in its chain, from 0. */
  index: number;
  on: boolean;
  onToggle: (on: boolean) => void;
  collapsed?: boolean;
  onCollapse?: (collapsed: boolean) => void;
  /** A control right after the title, such as the quiet Select that changes an instrument, so it stays in view on a wide device. */
  lead?: ReactNode;
  /** Small controls at the head's end (a preset menu, a ⋯). */
  actions?: ReactNode;
  /** Mobius added or changed it and it waits for Keep: a dashed indigo edge. */
  proposed?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const chain = useContext(Chain);
  const [dragging, setDragging] = useState(false);
  const target = useRef(index);
  // Where the pointer would drop it: past the middle of a neighbour (across, or down in a stacked chain) moves it there.
  const slot = (at: number) => {
    const row = chain?.row();
    if (!row) return index;
    const items = Array.from(row.children) as HTMLElement[];
    let to = 0;
    items.forEach((el, i) => {
      const box = el.getBoundingClientRect();
      const middle = chain?.vertical ? box.top + box.height / 2 : box.left + box.width / 2;
      if (i !== index && at > middle) to = i < index ? i + 1 : i;
    });
    return clamp(to, 0, items.length - 1);
  };
  const down = (e: PointerEvent<HTMLButtonElement>) => {
    if (!chain || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    target.current = index;
    setDragging(true);
  };
  const move = (e: PointerEvent<HTMLButtonElement>) => { if (dragging) target.current = slot(chain?.vertical ? e.clientY : e.clientX); };
  const up = () => {
    if (!dragging) return;
    setDragging(false);
    if (chain && target.current !== index) chain.move(index, target.current);
  };
  const key = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!chain) return;
    const by = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : 0;
    const to = e.key === 'Home' ? 0 : e.key === 'End' ? chain.count - 1 : index + by;
    if ((by || e.key === 'Home' || e.key === 'End') && to !== index && to >= 0 && to < chain.count) {
      e.preventDefault();
      chain.move(index, to);
      // Keep the grip in hand once the device has moved.
      requestAnimationFrame(() => chain.row()?.children[to]?.querySelector<HTMLButtonElement>('.ui-device-grip')?.focus());
    }
  };
  return (
    <section
      className={className ? `ui-device ${className}` : 'ui-device'}
      role="listitem"
      aria-label={title}
      data-off={!on || undefined}
      data-collapsed={collapsed || undefined}
      data-dragging={dragging || undefined}
      data-proposed={proposed || undefined}
    >
      <header className="ui-device-head">
        {chain && (
          <button
            type="button"
            className="ui-device-grip"
            aria-label={`Move ${title}`}
            title={`Drag, or use the arrow keys, to move ${title} along the chain`}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={() => setDragging(false)}
            onKeyDown={key}
          >
            <svg viewBox="0 0 8 14" aria-hidden="true"><circle cx="2" cy="3" r="1" /><circle cx="6" cy="3" r="1" /><circle cx="2" cy="7" r="1" /><circle cx="6" cy="7" r="1" /><circle cx="2" cy="11" r="1" /><circle cx="6" cy="11" r="1" /></svg>
          </button>
        )}
        <Switch label={`${title} on`} hideLabel checked={on} onChange={onToggle} />
        <h3 className="ui-device-title">{title}</h3>
        {lead && <span className="ui-device-lead">{lead}</span>}
        {actions && <span className="ui-device-actions">{actions}</span>}
        {onCollapse && (
          <button type="button" className="ui-device-fold" aria-expanded={!collapsed} aria-label={collapsed ? `Show ${title}` : `Fold ${title}`} title={collapsed ? 'Show' : 'Fold'} onClick={() => onCollapse(!collapsed)}>
            <svg viewBox="0 0 12 12" aria-hidden="true"><path d={collapsed ? 'M4.5 3 7.5 6l-3 3' : 'M3 4.5 6 7.5l3-3'} /></svg>
          </button>
        )}
      </header>
      {!collapsed && <div className="ui-device-body">{children}</div>}
    </section>
  );
}

/* --------------------------------------------------------------------------------------------------------------- EQ */

export type EqType = 'lowshelf' | 'peak' | 'highshelf';
export interface EqBand { type: EqType; freq: number; gain: number; q: number; on?: boolean }

const EQ_MIN = 20, EQ_MAX = 20000, EQ_DB = 18, Q_MIN = 0.3, Q_MAX = 12, RATE = 48000;
export const EQ_TYPE_NAMES: Record<EqType, string> = { lowshelf: 'Low shelf', peak: 'Bell', highshelf: 'High shelf' };

/** A band's level in dB at `hz`: the RBJ cookbook biquad at 48 kHz, as Web Audio's BiquadFilter draws it. */
export function bandLevel(band: EqBand, hz: number): number {
  if (band.on === false) return 0;
  const A = Math.pow(10, band.gain / 40);
  const w0 = (2 * Math.PI * band.freq) / RATE;
  const cos = Math.cos(w0), alpha = Math.sin(w0) / (2 * band.q), root = 2 * Math.sqrt(A) * alpha;
  let b: [number, number, number], a: [number, number, number];
  if (band.type === 'peak') {
    b = [1 + alpha * A, -2 * cos, 1 - alpha * A];
    a = [1 + alpha / A, -2 * cos, 1 - alpha / A];
  } else if (band.type === 'lowshelf') {
    b = [A * (A + 1 - (A - 1) * cos + root), 2 * A * (A - 1 - (A + 1) * cos), A * (A + 1 - (A - 1) * cos - root)];
    a = [A + 1 + (A - 1) * cos + root, -2 * (A - 1 + (A + 1) * cos), A + 1 + (A - 1) * cos - root];
  } else {
    b = [A * (A + 1 + (A - 1) * cos + root), -2 * A * (A - 1 + (A + 1) * cos), A * (A + 1 + (A - 1) * cos - root)];
    a = [A + 1 - (A - 1) * cos + root, 2 * (A - 1 - (A + 1) * cos), A + 1 - (A - 1) * cos - root];
  }
  const w = (2 * Math.PI * hz) / RATE;
  const c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
  const re = (k: number[]) => k[0]! + k[1]! * c1 + k[2]! * c2, im = (k: number[]) => -(k[1]! * s1 + k[2]! * s2);
  const mag = Math.hypot(re(b), im(b)) / Math.hypot(re(a), im(a));
  return 20 * Math.log10(mag);
}
/** The whole EQ's level in dB at `hz`: the bands add in dB. */
export const eqLevel = (bands: readonly EqBand[], hz: number) => bands.reduce((sum, band) => sum + bandLevel(band, hz), 0);

const gainY = (db: number) => clamp((db + EQ_DB) / (2 * EQ_DB), 0, 1);
const signed = (db: number) => `${db > 0 ? '+' : db < 0 ? '−' : ''}${Math.abs(db).toFixed(1)} dB`;

/**
 * An equaliser's curve across 20 Hz to 20 kHz (log) and ±18 dB, with a numbered dot per band. Drag a dot: across is
 * frequency, up is gain. The wheel over a dot, or Alt+drag, sets its Q (how wide a bell is, how steep a shelf). On a
 * focused dot: Left and Right move frequency a twelfth of an octave, Up and Down move gain half a dB (Shift: half an
 * octave, 3 dB), Alt+Up and Alt+Down set Q. Two quick presses on a dot, or Home, put it back to `reset`. The chosen
 * band's own shape shows under the whole curve, and every band's values read underneath.
 */
export function EqGraph({ label = 'EQ', bands, onChange, onCommit, reset, disabled, className }: {
  label?: string;
  bands: readonly EqBand[];
  onChange: (index: number, band: EqBand) => void;
  /** Called once a drag is let go. */
  onCommit?: (index: number, band: EqBand) => void;
  reset?: readonly EqBand[];
  disabled?: boolean;
  className?: string;
}) {
  const [chosen, setChosen] = useState(0);
  const alt = useRef<{ y: number; q: number } | null>(null);
  const tidy = (b: EqBand): EqBand => ({
    ...b,
    freq: Math.round(clamp(b.freq, EQ_MIN, EQ_MAX)),
    gain: Math.round(clamp(b.gain, -EQ_DB, EQ_DB) * 10) / 10,
    q: Math.round(clamp(b.q, Q_MIN, Q_MAX) * 100) / 100,
  });
  const set = (i: number, patch: Partial<EqBand>) => onChange(i, tidy({ ...bands[i]!, ...patch }));
  const back = (i: number) => { const r = reset?.[i]; if (r) { onChange(i, r); onCommit?.(i, r); } };
  const index = (key: string) => Number(key.slice(1));
  const { held, grab, surfaceProps } = useGraphDrag<`b${number}`>((key, x, y, e) => {
    const i = index(key);
    setChosen(i);
    if (e.altKey) {
      alt.current ??= { y, q: bands[i]!.q };
      set(i, { q: alt.current.q * Math.pow(2, (y - alt.current.y) * 6) });
      return;
    }
    alt.current = null;
    // A shelf's dot sits halfway up its step (where it crosses its corner), so its gain is twice the dot's height.
    const db = y * 2 * EQ_DB - EQ_DB;
    set(i, { freq: fromPosition(x, EQ_MIN, EQ_MAX, 'log'), gain: bands[i]!.type === 'peak' ? db : db * 2 });
  }, () => { alt.current = null; if (held) onCommit?.(index(held), bands[index(held)]!); }, (key) => back(index(key)));
  const key = (k: `b${number}`, e: KeyboardEvent<HTMLSpanElement>) => {
    const i = index(k), b = bands[i]!, by = ARROW[e.key];
    setChosen(i);
    if (by && e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); set(i, { q: b.q * Math.pow(2, by / (e.shiftKey ? 2 : 6)) }); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); set(i, { freq: logNudge(b.freq, by!, e.shiftKey ? 1 / 2 : 1 / 12, 1) }); }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); set(i, { gain: b.gain + by! * (e.shiftKey ? 3 : 0.5) }); }
    else if (e.key === 'Home') { e.preventDefault(); back(i); }
  };
  const wheel = (k: `b${number}`, e: WheelEvent<HTMLSpanElement>) => {
    const i = index(k);
    setChosen(i);
    set(i, { q: bands[i]!.q * Math.pow(2, (e.deltaY < 0 ? 1 : -1) / 6) });
  };
  const curve = (level: (hz: number) => number) => {
    const pts: string[] = [];
    for (let s = 0; s <= 120; s++) {
      const x = s / 120;
      pts.push(`${(x * 100).toFixed(2)} ${(100 - gainY(level(fromPosition(x, EQ_MIN, EQ_MAX, 'log'))) * 100).toFixed(2)}`);
    }
    return `M ${pts.join(' L ')}`;
  };
  const whole = curve((hz) => eqLevel(bands, hz));
  const one = bands[chosen] ? curve((hz) => bandLevel(bands[chosen]!, hz)) : '';
  const handles: Handle<`b${number}`>[] = bands.map((b, i) => ({
    key: `b${i}`, x: toPosition(b.freq, EQ_MIN, EQ_MAX, 'log'), y: gainY(b.type === 'peak' || b.on === false ? b.gain : b.gain / 2),
    label: `Band ${i + 1}, ${EQ_TYPE_NAMES[b.type]}`, text: `${hertzLabel(b.freq)}, ${signed(b.gain)}, Q ${b.q.toFixed(2)}${b.on === false ? ', off' : ''}`,
    now: b.freq, min: EQ_MIN, max: EQ_MAX, mark: String(i + 1),
  }));
  const zero = 100 - gainY(0) * 100;
  const changed = (i: number) => { const r = reset?.[i], b = bands[i]!; return !!r && (r.freq !== b.freq || r.gain !== b.gain || r.q !== b.q); };
  return (
    <div className={className ? `ui-graph ui-eq ${className}` : 'ui-graph ui-eq'} role="group" aria-label={label} data-disabled={disabled || undefined}>
      <div className="ui-graph-surface" data-held={held || undefined}>
        <div className="ui-graph-plot" {...surfaceProps}>
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {[100, 1000, 10000].map((f) => { const x = toPosition(f, EQ_MIN, EQ_MAX, 'log') * 100; return <line key={f} className="ui-graph-guide" x1={x} y1={0} x2={x} y2={100} />; })}
            {[-12, -6, 6, 12].map((db) => { const y = 100 - gainY(db) * 100; return <line key={db} className="ui-graph-guide" data-faint x1={0} y1={y} x2={100} y2={y} />; })}
            <line className="ui-graph-guide" x1={0} y1={zero} x2={100} y2={zero} />
            {one && <path className="ui-graph-line" data-ghost d={one} />}
            <path className="ui-graph-area" d={`${whole} L 100 ${zero} L 0 ${zero} Z`} />
            <path className="ui-graph-line" d={whole} />
          </svg>
          {[12, 0, -12].map((db) => <span key={db} className="ui-graph-axis" data-axis="y" aria-hidden="true" style={{ top: `${100 - gainY(db) * 100}%` }}>{db > 0 ? `+${db}` : db < 0 ? `−${-db}` : '0'}</span>)}
          {[[100, '100'], [1000, '1k'], [10000, '10k']].map(([f, t]) => <span key={t} className="ui-graph-axis" data-axis="x" aria-hidden="true" style={{ left: `${toPosition(f as number, EQ_MIN, EQ_MAX, 'log') * 100}%` }}>{t}</span>)}
          {handles.map((h, i) => (
            <HandleDot key={h.key} h={h} held={held} grab={grab} onKey={key} onWheel={wheel} selected={i === chosen} disabled={disabled} />
          ))}
        </div>
      </div>
      <dl className="ui-graph-readout ui-eq-readout">
        {bands.map((b, i) => (
          <div key={i} data-changed={changed(i) || undefined} data-chosen={i === chosen || undefined} data-off={b.on === false || undefined}>
            <dt>{i + 1} · {EQ_TYPE_NAMES[b.type]}</dt>
            <dd>{hertzLabel(b.freq)}</dd>
            <dd>{signed(b.gain)}</dd>
            <dd>Q {b.q.toFixed(2)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
