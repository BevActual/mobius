/** How wide the docks are drawn in a window this wide. The saved widths stay as the person set them; on a narrow
 *  window the Mobius dock gives way first, then the sidebar, so the content keeps room for its toolbar. */
export const RAIL_W = 52;
export const CONTENT_MIN = 500;
export const RIGHT_MIN = 280;
export const LEFT_MIN = 180;

export function fitDocks(windowWidth: number, left: number, right: number, leftOn: boolean, rightOn: boolean): { left: number; right: number } {
  let l = leftOn ? left : 0;
  let r = rightOn ? right : 0;
  let over = RAIL_W + l + r + CONTENT_MIN - windowWidth;
  if (over > 0 && rightOn) {
    const give = Math.min(over, Math.max(0, r - RIGHT_MIN));
    r -= give;
    over -= give;
  }
  if (over > 0 && leftOn) {
    const give = Math.min(over, Math.max(0, l - LEFT_MIN));
    l -= give;
  }
  return { left: leftOn ? l : left, right: rightOn ? r : right };
}
