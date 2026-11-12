/**
 * How a proposal settles once it is answered, before the change is made: kept, its dashed edge and tint fade into the
 * page; discarded, it fades out. These are fades, so they stay under Reduce Motion, only quicker.
 */

const EASE = 'cubic-bezier(0.2, 0, 0, 1)';

function duration(el: Element): number {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return 150;
  const med = parseFloat(getComputedStyle(el).getPropertyValue('--dur-med')) || 200;
  return med * 1.25;
}

function run(el: Element | null | undefined, frames: Keyframe[]): Promise<void> {
  if (!el || typeof (el as HTMLElement).animate !== 'function' || document.visibilityState === 'hidden') return Promise.resolve();
  const a = (el as HTMLElement).animate(frames, { duration: duration(el), easing: EASE, fill: 'forwards' });
  // The fill holds the end while the change is made. If the element is still there a moment later (the change failed,
  // or it was redrawn in place), it comes back.
  a.addEventListener('finish', () => window.setTimeout(() => { if (a.playState === 'finished') a.cancel(); }, 1200));
  return a.finished.then(() => undefined, () => undefined);
}

/** Kept: the dashed edge and the tint fade away, leaving what was proposed as part of the page. */
export const settleKept = (el: Element | null | undefined) =>
  run(el, [{}, { borderColor: 'transparent', outlineColor: 'transparent', backgroundColor: 'transparent', opacity: 0 }]);

/** Discarded: what was proposed fades out. */
export const settleGone = (el: Element | null | undefined) => run(el, [{ opacity: 1 }, { opacity: 0 }]);

/** Waits for a CSS transition set by an attribute, such as a ghost event turning solid. */
export function settleBy(el: HTMLElement | null | undefined, attribute: string): Promise<void> {
  if (!el || document.visibilityState === 'hidden') return Promise.resolve();
  el.setAttribute(attribute, '');
  return new Promise((done) => window.setTimeout(done, duration(el)));
}

/** After a discard has put the old version back: it fades in where the proposal faded out. */
export function settleIn(el: Element | null | undefined): void {
  if (!el || typeof (el as HTMLElement).animate !== 'function') return;
  (el as HTMLElement).getAnimations().forEach((a) => a.cancel());
  (el as HTMLElement).animate([{ opacity: 0 }, { opacity: 1 }], { duration: duration(el), easing: EASE });
}
