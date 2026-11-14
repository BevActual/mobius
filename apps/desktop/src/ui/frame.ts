/**
 * Runs `fn` once, after the next frame is drawn, or after `ms` if no frame comes first. A window that is covered,
 * minimised or not drawn (as the e2e window often is) gets no animation frames at all, so anything that must happen,
 * such as moving focus, selecting text, scrolling to a row or printing, never waits on a frame alone.
 * Returns a cancel function.
 */
export function afterPaint(fn: () => void, ms = 50): () => void {
  let done = false;
  const once = () => {
    if (done) return;
    done = true;
    if (frame !== null && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(frame);
    clearTimeout(timer);
    fn();
  };
  const frame = typeof requestAnimationFrame !== 'undefined' ? requestAnimationFrame(once) : null;
  const timer = setTimeout(once, ms);
  return () => {
    done = true;
    if (frame !== null && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(frame);
    clearTimeout(timer);
  };
}
