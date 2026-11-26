import { MotionConfig, MotionGlobalConfig } from 'motion/react';
import { useEffect, useLayoutEffect, type ReactNode, type RefObject } from 'react';

/** One feel for the whole interface: quick, a little springy, never bouncy. */
export const spring = { type: 'spring', stiffness: 520, damping: 42, mass: 0.8 } as const;
export const quick = { duration: 0.14, ease: [0.2, 0, 0, 1] } as const;

/**
 * Wraps the interface. People who ask their system for less motion get none, and while the window is not
 * shown (minimised, or hidden during automated runs) animations jump to their end so nothing waits on a frame that never comes.
 */
export function MotionRoot({ children }: { children: ReactNode }) {
  useEffect(() => {
    const sync = () => {
      MotionGlobalConfig.skipAnimations = document.visibilityState === 'hidden';
    };
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);
  return <MotionConfig reducedMotion="user" transition={spring}>{children}</MotionConfig>;
}

/** Where the pointer last went down, so a panel can grow out of what opened it. */
let lastPointer: { x: number; y: number; at: number } | null = null;
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', (event) => { lastPointer = { x: event.clientX, y: event.clientY, at: performance.now() }; }, { capture: true });
}

/** The one timing: what appears grows in at --dur-med's pace and leaves faster; Reduce Motion leaves a fade. */
export const GROW_MS = 250;
export const EXIT_MS = 150;
export const FADE_MS = 150;
const EASE = 'cubic-bezier(0.2, 0, 0, 1)';
const EASE_EXIT = 'cubic-bezier(0.4, 0, 1, 1)';

/** No motion while the window is not shown (nothing would see it), unless a test asks to watch it. */
const unseen = () => document.visibilityState === 'hidden' && !document.documentElement.hasAttribute('data-motion-always');
const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/** Where each panel grew from, so it can go back there. */
const origins = new WeakMap<HTMLElement, string>();

function originOf(node: HTMLElement, side: 'left' | 'right'): string {
  const fresh = lastPointer !== null && performance.now() - lastPointer.at < 1500;
  // Asked from the keyboard, the origin is a corner: no need to measure, which would lay out the whole new page early.
  if (!fresh) return side === 'right' ? '100% 0px' : '0px 0px';
  const box = node.getBoundingClientRect();
  const clamp = (v: number, max: number) => Math.min(max, Math.max(0, v));
  return `${Math.round(clamp(lastPointer!.x - box.left, box.width))}px ${Math.round(clamp(lastPointer!.y - box.top, box.height))}px`;
}

/** Grow a node in from where it was asked for (or fade it in, with Reduce Motion). */
export function growFrom(node: HTMLElement, side: 'left' | 'right' = 'right'): Animation | null {
  if (typeof node.animate !== 'function' || unseen()) return null;
  if (reduced()) return node.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS, easing: 'linear' });
  const origin = originOf(node, side);
  origins.set(node, origin);
  return node.animate([
    { opacity: 0, transform: 'scale(0.94)', transformOrigin: origin },
    { opacity: 1, transform: 'none', transformOrigin: origin },
  ], { duration: GROW_MS, easing: EASE });
}

/**
 * Send a node back where it came from before it goes: the grow reversed, toward the button that opened it, in 150ms
 * (a fade with Reduce Motion). Resolves when it is done, so the caller can then remove it.
 */
export function morphOut(node: HTMLElement | null, side: 'left' | 'right' = 'right'): Promise<void> {
  if (!node || typeof node.animate !== 'function' || unseen()) return Promise.resolve();
  const animation = reduced()
    ? node.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS, easing: 'linear', fill: 'forwards' })
    : (() => {
      const origin = origins.get(node) ?? originOf(node, side);
      return node.animate([
        { opacity: 1, transform: 'none', transformOrigin: origin },
        { opacity: 0, transform: 'scale(0.94)', transformOrigin: origin },
      ], { duration: EXIT_MS, easing: EASE_EXIT, fill: 'forwards' });
    })();
  // Settled even if the node is taken away mid-way and its animation never finishes.
  const settled = animation.finished.then(() => undefined, () => undefined);
  return Promise.race([settled, new Promise<void>((done) => { window.setTimeout(done, EXIT_MS + 100); })]);
}

/**
 * A panel that appears grows out of where it was asked for: a scale and fade of 250ms from the point that was clicked
 * (from its top corner on the side it opens from, when it was opened from the keyboard). A 150ms fade with Reduce Motion.
 */
export function useMorphIn(ref: RefObject<HTMLElement | null>, shown: boolean, side: 'left' | 'right' = 'right'): void {
  useLayoutEffect(() => {
    const node = ref.current;
    if (!shown || !node) return;
    growFrom(node, side);
  }, [ref, shown, side]);
}

/**
 * Changing app. Picked with the pointer (a tile, a row), the new app settles out of what was clicked: a fade from 98.5%
 * in 180ms, small enough that text never looks blown up. From the keyboard, done tens of times a day, it only lifts out
 * of a dim in 120ms, so a shortcut never waits on motion. A short fade with Reduce Motion.
 */
export const SWITCH_MS = 180;
export function switchIn(node: HTMLElement): Animation | null {
  if (typeof node.animate !== 'function' || unseen()) return null;
  node.getAnimations().forEach((a) => a.cancel());
  const fresh = lastPointer !== null && performance.now() - lastPointer.at < 1500;
  if (reduced() || !fresh) return node.animate([{ opacity: 0.55 }, { opacity: 1 }], { duration: 120, easing: EASE });
  const origin = originOf(node, 'left');
  return node.animate([
    // From 0.4, not 0: the first frames come while the new app is still drawing, and an empty frame reads as a flash.
    { opacity: 0.4, transform: 'scale(0.985)', transformOrigin: origin },
    { opacity: 1, transform: 'none', transformOrigin: origin },
  ], { duration: SWITCH_MS, easing: EASE });
}

/**
 * A dock of panels slides out of its window edge as it opens, and back into it as it closes: its width (height, at the
 * bottom) grows from nothing while the panels inside keep their full size, so they come in whole instead of being
 * squeezed, and the app beside it gives up its room smoothly. 200ms in, 150ms out; a fade with Reduce Motion.
 */
export const DOCK_MS = 200;
type DockSide = 'left' | 'right' | 'bottom';
/** The side of the dock that faces the app, whose gap to it also grows from nothing so the app never jumps. */
const INNER = { left: 'marginRight', right: 'marginLeft', bottom: 'marginTop' } as const;
/**
 * A page drawn natively above the window (the Browser's) cannot follow a sliding dock frame by frame: it lags opening and
 * runs ahead closing, over the dock. Beside one, a dock fades in and closes at once.
 */
const besideNativePage = (node: HTMLElement) => node.closest('.ui-panels')?.querySelector('.surface-slot') != null;

function dockMove(node: HTMLElement, side: DockSide, size: number, opening: boolean): Animation | null {
  node.getAnimations().forEach((a) => a.cancel());
  if (reduced() || besideNativePage(node)) {
    if (!opening && besideNativePage(node)) return null;
    const frames = [{ opacity: 0 }, { opacity: 1 }];
    return node.animate(opening ? frames : frames.reverse(), { duration: FADE_MS, easing: 'linear', fill: opening ? 'none' : 'forwards' });
  }
  const prop = side === 'bottom' ? 'height' : 'width';
  const parent = node.parentElement ? getComputedStyle(node.parentElement) : null;
  const gap = parseFloat((side === 'bottom' ? parent?.rowGap : parent?.columnGap) ?? '') || 0;
  node.style.setProperty('--dock-full', `${size}px`);
  node.dataset.moving = '';
  const frames = [
    { [prop]: '0px', [INNER[side]]: `${-gap}px`, opacity: 0.4 },
    { [prop]: `${size}px`, [INNER[side]]: '0px', opacity: 1 },
  ];
  // Leaving accelerates away, so it does not crawl over its last few pixels.
  const animation = node.animate(opening ? frames : frames.reverse(), opening
    ? { duration: DOCK_MS, easing: EASE }
    : { duration: EXIT_MS, easing: EASE_EXIT, fill: 'forwards' });
  void animation.finished.then(() => { if (opening) delete node.dataset.moving; }, () => undefined);
  return animation;
}

export function dockIn(node: HTMLElement, side: DockSide, size: number): void {
  if (typeof node.animate !== 'function' || unseen()) return;
  dockMove(node, side, size, true);
}

/** Whether a closing dock should stay drawn while it goes back into its edge (not beside a native page). */
export function dockLeaves(node: HTMLElement | null): boolean {
  return node !== null && typeof node.animate === 'function' && !unseen() && !besideNativePage(node);
}

/** Resolves once the dock has gone back into its edge, so the caller can then take it away. */
export function dockOut(node: HTMLElement, side: DockSide, size: number): Promise<void> {
  if (typeof node.animate !== 'function' || unseen()) return Promise.resolve();
  const animation = dockMove(node, side, size, false);
  if (!animation) return Promise.resolve();
  const settled = animation.finished.then(() => undefined, () => undefined);
  return Promise.race([settled, new Promise<void>((done) => { window.setTimeout(done, EXIT_MS + 100); })]);
}
