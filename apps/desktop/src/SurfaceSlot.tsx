import { useEffect, useRef } from 'react';

/**
 * A native web view is drawn by the main process above this window's DOM, so the DOM cannot contain it.
 * This reserves the space and reports its rectangle. When `hidden` is true (an overlay is open) the view is
 * hidden immediately and synchronously: hiding must never wait for a rendering frame, because frames are
 * throttled when a window is occluded and the page would stay on top of the overlay.
 * The slot lives only while a pane shows the browser, so going away hides the view too: otherwise the page would
 * stay drawn over whichever app took the pane.
 */
export function SurfaceSlot({ hidden, beside = false }: { hidden: boolean; /** Split view: the second page's place, reported with setBesideBounds. */ beside?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const set = (b: { x: number; y: number; width: number; height: number } | null) => (beside ? window.mobius.surface.setBesideBounds?.(b) : window.mobius.surface.setBounds(b));
    if (hidden) {
      set(null);
      return;
    }
    const report = () => {
      const { x, y, width, height } = element.getBoundingClientRect();
      set({ x, y, width, height });
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(element);
    window.addEventListener('resize', report);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', report);
      set(null);
    };
  }, [hidden, beside]);

  return <div ref={ref} className="surface-slot" data-beside={beside || undefined} data-testid={beside ? 'surface-slot-beside' : 'surface-slot'} aria-hidden="true" />;
}
