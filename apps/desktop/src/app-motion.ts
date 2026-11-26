import { EXIT_MS, FADE_MS, GROW_MS } from './motion';

/** Motion inside apps, on the shell's timing (motion.tsx): rows that fold away, views that slide the way you moved. */

/** The curves, as motion.tsx's: what comes in settles, what leaves speeds up as it goes. */
const EASE = 'cubic-bezier(0.2, 0, 0, 1)';
const EASE_EXIT = 'cubic-bezier(0.4, 0, 1, 1)';
const still = () => document.visibilityState === 'hidden' && !document.documentElement.hasAttribute('data-motion-always');
const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/**
 * A row that is done with folds away: it fades as its height closes, so the rows under it slide up into its place
 * instead of jumping. With Reduce Motion it only fades; with the window not shown it goes at once. While it folds it is
 * marked `data-leaving`, so keyboard moves skip it. Resolves when the row may be taken out.
 */
export function foldAway(row: HTMLElement | null): Promise<void> {
  if (!row || typeof row.animate !== 'function') return Promise.resolve();
  if (still()) return Promise.resolve();
  row.dataset.leaving = '';
  const reduce = reduced();
  const style = getComputedStyle(row);
  const from = { opacity: 1, height: `${row.getBoundingClientRect().height}px`, paddingTop: style.paddingTop, paddingBottom: style.paddingBottom, marginTop: style.marginTop, marginBottom: style.marginBottom };
  row.style.overflow = 'hidden';
  const frames = reduce ? [{ opacity: 1 }, { opacity: 0 }] : [from, { opacity: 0, height: '0px', paddingTop: '0px', paddingBottom: '0px', marginTop: '0px', marginBottom: '0px' }];
  const run = row.animate(frames, { duration: reduce ? FADE_MS : EXIT_MS, easing: reduce ? 'linear' : EASE_EXIT, fill: 'forwards' });
  return run.finished.then(() => undefined, () => undefined);
}

/**
 * A view moved on in time (Back, Forward, Today) slides in from the side it came from: later from the right, earlier from
 * the left, a short way, as Calendar apps turn their pages. With Reduce Motion it only fades in a little.
 */
export function slideIn(view: HTMLElement | null, later: boolean): void {
  if (!view || typeof view.animate !== 'function' || still()) return;
  if (reduced()) { view.animate([{ opacity: 0.6 }, { opacity: 1 }], { duration: FADE_MS, easing: 'linear' }); return; }
  view.animate([{ opacity: 0.4, transform: `translateX(${later ? 24 : -24}px)` }, { opacity: 1, transform: 'none' }], { duration: GROW_MS, easing: EASE });
}
