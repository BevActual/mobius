import { useEffect, useRef } from 'react';

/**
 * A native web view is drawn by the main process above this window's DOM, so the DOM cannot contain it.
 * This reserves the space and reports its rectangle. When `hidden` is true (an overlay is open) the view is
 * hidden immediately and synchronously: hiding must never wait for a rendering frame, because frames are
 * throttled when a window is occluded and the page would stay on top of the overlay.
 */
export function SurfaceSlot({ hidden }: { hidden: boolean }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (hidden) {
      window.mobius.surface.setBounds(null);
      return;
    }
    const report = () => {
      const { x, y, width, height } = element.getBoundingClientRect();
      window.mobius.surface.setBounds({ x, y, width, height });
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(element);
    window.addEventListener('resize', report);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', report);
    };
  }, [hidden]);

  return <div ref={ref} className="surface-slot" data-testid="surface-slot" aria-hidden="true" />;
}
