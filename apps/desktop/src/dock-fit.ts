/** How wide the Mobius dock is drawn in a window this wide. The saved width stays as the person set it; on a narrow
 *  window the dock gives way, down to its minimum, so the content keeps room for its toolbar. */
export const EDGE_W = 52;
export const CONTENT_MIN = 500;
export const RIGHT_MIN = 280;

export function fitDocks(windowWidth: number, right: number, rightOn: boolean): { right: number } {
  if (!rightOn) return { right };
  const over = EDGE_W + right + CONTENT_MIN - windowWidth;
  return { right: over > 0 ? right - Math.min(over, Math.max(0, right - RIGHT_MIN)) : right };
}
