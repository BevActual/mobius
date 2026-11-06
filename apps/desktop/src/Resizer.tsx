import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { SIDEBAR_WIDTH } from '@mobius/shared';
import { draggedWidth, keyedWidth, type Side } from './resize';

interface Props {
  side: Side;
  width: number;
  label: string;
  /** Called continuously while dragging, with the width so far. */
  onDrag: (width: number | null) => void;
  /** Called once with the width to keep. */
  onCommit: (width: number) => void;
  /** Whether the pointer is on the handle. */
  onHover?: (over: boolean) => void;
}

/** A thin handle on the inner edge of a sidebar. Drag it, or focus it and use the arrow keys; double-click puts the usual width back. */
export function Resizer({ side, width, label, onDrag, onCommit, onHover }: Props) {
  const start = useRef<{ x: number; width: number; id: number } | null>(null);
  const latest = useRef(width);
  const { min, max, default: usual } = SIDEBAR_WIDTH[side];

  const down = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Without capture the drag still works while the pointer stays over the handle.
    }
    start.current = { x: event.clientX, width, id: event.pointerId };
    latest.current = width;
    onDrag(width);
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    latest.current = draggedWidth(side, start.current.width, start.current.x, event.clientX);
    onDrag(latest.current);
  };
  const end = (event: PointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    const { id, width: before } = start.current;
    if (event.currentTarget.hasPointerCapture?.(id)) event.currentTarget.releasePointerCapture(id);
    start.current = null;
    onDrag(null);
    // While dragging, `width` is the live width, so compare with where the drag began.
    if (latest.current !== before) onCommit(latest.current);
  };
  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      onCommit(usual);
      return;
    }
    const next = keyedWidth(side, width, event.key, event.shiftKey);
    if (next === null) return;
    event.preventDefault();
    if (next !== width) onCommit(next);
  };

  return (
    <div
      className={`resizer ${side}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onPointerEnter={() => onHover?.(true)}
      onPointerLeave={() => onHover?.(false)}
      onDoubleClick={() => onCommit(usual)}
      onKeyDown={key}
    />
  );
}
