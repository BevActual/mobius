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
  // (min-height folds too, or a row with one would only fade and the rows under it would jump.)
  if (!row || typeof row.animate !== 'function') return Promise.resolve();
  if (still()) return Promise.resolve();
  row.dataset.leaving = '';
  const reduce = reduced();
  const style = getComputedStyle(row);
  const from = { opacity: 1, minHeight: style.minHeight, height: `${row.getBoundingClientRect().height}px`, paddingTop: style.paddingTop, paddingBottom: style.paddingBottom, marginTop: style.marginTop, marginBottom: style.marginBottom };
  row.style.overflow = 'hidden';
  const frames = reduce ? [{ opacity: 1 }, { opacity: 0 }] : [from, { opacity: 0, minHeight: '0px', height: '0px', paddingTop: '0px', paddingBottom: '0px', marginTop: '0px', marginBottom: '0px' }];
  const run = row.animate(frames, { duration: reduce ? FADE_MS : EXIT_MS, easing: reduce ? 'linear' : EASE_EXIT, fill: 'forwards' });
  return run.finished.then(() => undefined, () => undefined);
}

/**
 * A view moved on in time (Back, Forward, Today) slides in from the side it came from: later from the right, earlier from
 * the left, a short way, as Calendar apps turn their pages; another view in its place crossfades in. With Reduce Motion
 * it only fades in a little.
 */
export function slideIn(view: HTMLElement | null, later: boolean | null): void {
  if (!view || typeof view.animate !== 'function' || still()) return;
  // null: not moved in time but another view in its place, which only crossfades in.
  if (later === null) { view.animate([{ opacity: 0.4 }, { opacity: 1 }], { duration: FADE_MS, easing: EASE }); return; }
  if (reduced()) { view.animate([{ opacity: 0.6 }, { opacity: 1 }], { duration: FADE_MS, easing: 'linear' }); return; }
  view.animate([{ opacity: 0.4, transform: `translateX(${later ? 24 : -24}px)` }, { opacity: 1, transform: 'none' }], { duration: GROW_MS, easing: EASE });
}

/** Puts back a row that was folding away, when what it was for did not happen after all: it opens back out. */
export async function unfold(row: HTMLElement | null): Promise<void> {
  if (!row) return;
  for (const a of row.getAnimations?.() ?? []) a.cancel();
  delete row.dataset.leaving;
  if (typeof row.animate !== 'function' || still()) { row.style.overflow = ''; return; }
  // Measured as it stands now, back at full size, then opened out to that from nothing.
  const style = getComputedStyle(row);
  const open = { opacity: 1, minHeight: style.minHeight, height: `${row.getBoundingClientRect().height}px`, paddingTop: style.paddingTop, paddingBottom: style.paddingBottom, marginTop: style.marginTop, marginBottom: style.marginBottom };
  const shut = { opacity: 0, minHeight: '0px', height: '0px', paddingTop: '0px', paddingBottom: '0px', marginTop: '0px', marginBottom: '0px' };
  const run = reduced()
    ? row.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS, easing: 'linear' })
    : row.animate([shut, open], { duration: GROW_MS, easing: EASE });
  await run.finished.catch(() => undefined);
  row.style.overflow = '';
}

/**
 * Folds a row away while `work` takes it out of its list (Done, delete, set aside), so the rows under it slide up. When
 * the row is still on the page afterwards (the work failed, or the view keeps such rows), it opens back out.
 */
export async function foldWhile<T>(row: HTMLElement | null, work: () => Promise<T>): Promise<T> {
  await foldAway(row);
  try {
    return await work();
  } finally {
    requestAnimationFrame(() => { if (row?.isConnected && 'leaving' in row.dataset) void unfold(row); });
  }
}
