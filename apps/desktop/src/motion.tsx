import { MotionConfig, MotionGlobalConfig } from 'motion/react';
import { useEffect, type ReactNode } from 'react';

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
