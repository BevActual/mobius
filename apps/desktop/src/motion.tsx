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

/**
 * A panel that appears grows out of where it was asked for: a scale and fade of 250ms from the point that was clicked
 * (from its top corner on the side it opens from, when it was opened from the keyboard). None with reduced motion.
 */
export function useMorphIn(ref: RefObject<HTMLElement | null>, shown: boolean, side: 'left' | 'right' = 'right'): void {
  useLayoutEffect(() => {
    const node = ref.current;
    if (!shown || !node || typeof node.animate !== 'function') return;
    if (document.visibilityState === 'hidden' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const box = node.getBoundingClientRect();
    const fresh = lastPointer !== null && performance.now() - lastPointer.at < 1500;
    const clamp = (v: number, max: number) => Math.min(max, Math.max(0, v));
    const x = fresh ? clamp(lastPointer!.x - box.left, box.width) : side === 'right' ? box.width : 0;
    const y = fresh ? clamp(lastPointer!.y - box.top, box.height) : 0;
    const origin = `${Math.round(x)}px ${Math.round(y)}px`;
    node.animate([
      { opacity: 0, transform: 'scale(0.94)', transformOrigin: origin },
      { opacity: 1, transform: 'none', transformOrigin: origin },
    ], { duration: 250, easing: 'cubic-bezier(0.2, 0, 0, 1)' });
  }, [ref, shown, side]);
}
