import { SIDEBAR_WIDTH } from '@mobius/shared';

/** The inspector's handle is on its left edge, like Mobius's: dragging left grows it. */
export type Side = 'left' | 'right' | 'inspector';

/** The width a drag gives: the left list grows when dragged right, the agent panel when dragged left. Always inside the side's range. */
export function draggedWidth(side: Side, startWidth: number, startX: number, x: number): number {
  const delta = side === 'left' ? x - startX : startX - x;
  return clampWidth(side, startWidth + delta);
}

export function clampWidth(side: Side, width: number): number {
  const { min, max } = SIDEBAR_WIDTH[side];
  if (!Number.isFinite(width)) return SIDEBAR_WIDTH[side].default;
  return Math.min(max, Math.max(min, Math.round(width)));
}

/** The width after an arrow key, or null when the key does nothing. Arrows point the way the edge moves; Shift takes bigger steps. */
export function keyedWidth(side: Side, width: number, key: string, shift: boolean): number | null {
  const step = shift ? 64 : 16;
  const { min, max } = SIDEBAR_WIDTH[side];
  // The handle sits on the inner edge: for the left list, right grows it; for the agent panel, left grows it.
  const grow = side === 'left' ? 'ArrowRight' : 'ArrowLeft';
  const shrink = side === 'left' ? 'ArrowLeft' : 'ArrowRight';
  if (key === grow) return clampWidth(side, width + step);
  if (key === shrink) return clampWidth(side, width - step);
  if (key === 'Home') return min;
  if (key === 'End') return max;
  return null;
}
