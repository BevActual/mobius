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
  const box = node.getBoundingClientRect();
  const fresh = lastPointer !== null && performance.now() - lastPointer.at < 1500;
  const clamp = (v: number, max: number) => Math.min(max, Math.max(0, v));
  const x = fresh ? clamp(lastPointer!.x - box.left, box.width) : side === 'right' ? box.width : 0;
  const y = fresh ? clamp(lastPointer!.y - box.top, box.height) : 0;
  return `${Math.round(x)}px ${Math.round(y)}px`;
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
