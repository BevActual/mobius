import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import type { ContentColor } from './Bits';

/**
 * A pad grid (Music's drum kit): named pads, four to a row. Pressing a pad plays it and chooses it; the chosen pad's
 * settings show under the grid (`children`). Keys: arrows move between pads, Space or Enter plays and chooses, and a
 * pad's own `key` (shown in its corner) plays it from anywhere in the grid. `lit` pads flash as they sound, so a
 * pattern playing shows on the pads. An empty pad has a dashed edge and says so.
 */

export interface Pad {
  id: string;
  name: string;
  /** Its colour strip, from the track or kit. */
  color?: ContentColor;
  /** A computer key that plays it ("Q"), shown in its corner. */
  key?: string;
  /** No sound loaded. */
  empty?: boolean;
  /** Mobius changed this pad's sound and it waits for Keep. */
  proposed?: boolean;
}

export function PadGrid({ label, pads, chosen, onChoose, onPlay, onRelease, lit = [], columns = 4, children, disabled, className }: {
  label: string;
  pads: readonly Pad[];
  /** The chosen pad's index. */
  chosen: number;
  onChoose: (index: number) => void;
  /** A pad was pressed, with how hard (0 to 1: higher on the pad is louder, as on a hardware pad). */
  onPlay?: (index: number, velocity: number) => void;
  /** The press ended (for sounds that hold while pressed). */
  onRelease?: (index: number) => void;
  /** Pads sounding right now. */
  lit?: readonly number[];
  columns?: number;
  /** The chosen pad's settings, shown under the grid. */
  children?: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  const grid = useRef<HTMLDivElement>(null);
  const [pressed, setPressed] = useState<number | null>(null);
  const focusPad = (i: number) => grid.current?.querySelector<HTMLButtonElement>(`[data-pad="${i}"]`)?.focus();
  const hit = (i: number, velocity: number) => {
    if (disabled || !pads[i]) return;
    onChoose(i);
    if (!pads[i]!.empty) onPlay?.(i, velocity);
  };
  const down = (i: number) => (e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    const box = e.currentTarget.getBoundingClientRect();
    // Higher on the pad plays louder; the bottom edge is still a clear hit.
    const velocity = Math.round((0.4 + 0.6 * (1 - (e.clientY - box.top) / box.height)) * 100) / 100;
    setPressed(i);
    hit(i, Math.min(1, Math.max(0.4, velocity)));
  };
  const up = (i: number) => () => { if (pressed === i) { setPressed(null); onRelease?.(i); } };
  const key = (i: number) => (e: KeyboardEvent<HTMLButtonElement>) => {
    const moves: Record<string, number> = { ArrowLeft: i - 1, ArrowRight: i + 1, ArrowUp: i - columns, ArrowDown: i + columns, Home: 0, End: pads.length - 1 };
    const to = moves[e.key];
    if (to !== undefined) {
      e.preventDefault();
      if (to >= 0 && to < pads.length) focusPad(to);
      return;
    }
    if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); setPressed(i); hit(i, 0.8); return; }
    const by = pads.findIndex((p) => p.key && p.key.toLowerCase() === e.key.toLowerCase());
    if (by >= 0 && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); setPressed(by); hit(by, 0.8); }
  };
  const keyUp = () => { if (pressed !== null) { onRelease?.(pressed); setPressed(null); } };
  const focusable = chosen >= 0 && chosen < pads.length ? chosen : 0;
  return (
    <div className={className ? `ui-pads ${className}` : 'ui-pads'} data-disabled={disabled || undefined}>
      <div ref={grid} className="ui-pads-grid" role="group" aria-label={label} style={{ '--pad-columns': columns } as CSSProperties}>
        {pads.map((pad, i) => (
          <button
            key={pad.id}
            type="button"
            className="ui-pad-cell"
            data-pad={i}
            data-color={pad.color}
            data-empty={pad.empty || undefined}
            data-chosen={i === chosen || undefined}
            data-lit={lit.includes(i) || pressed === i || undefined}
            data-proposed={pad.proposed || undefined}
            aria-pressed={i === chosen}
            aria-label={`${pad.name}${pad.empty ? ', empty' : ''}`}
            aria-keyshortcuts={pad.key}
            title={pad.empty ? `${pad.name}: no sound yet` : pad.key ? `Play ${pad.name} (${pad.key})` : `Play ${pad.name}`}
            tabIndex={i === focusable ? 0 : -1}
            disabled={disabled}
            onPointerDown={down(i)}
            onPointerUp={up(i)}
            onPointerLeave={up(i)}
            onKeyDown={key(i)}
            onKeyUp={keyUp}
          >
            {pad.key && <span className="ui-pad-key" aria-hidden="true">{pad.key}</span>}
            <span className="ui-pad-name">{pad.empty ? 'Empty' : pad.name}</span>
          </button>
        ))}
      </div>
      {children && pads[chosen] && (
        <section className="ui-pads-detail" aria-label={`${pads[chosen]!.name} settings`}>
          <h4 className="ui-pads-detail-name">{pads[chosen]!.name}</h4>
          {children}
        </section>
      )}
    </div>
  );
}
