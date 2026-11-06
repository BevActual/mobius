import { useEffect, type RefObject } from 'react';

/**
 * A floating panel hides itself: when the pointer has been in it (or opened it by touching the screen edge) and then moves away
 * for a moment, unless something inside has the keyboard; when something outside it is clicked; and on Escape. Anything marked
 * `data-dock-toggle` is left alone, since it opens and closes the panel itself.
 *
 * `fromEdge.current` says the panel was opened by the pointer at the screen edge, so the pointer counts as being with it already.
 */
export function useAutoHide(floating: boolean, open: boolean, hide: () => void, panel: RefObject<HTMLElement | null>, fromEdge: RefObject<boolean>, delayMs = 350): void {
  useEffect(() => {
    const element = panel.current;
    if (!floating || !open || !element) return undefined;
    let engaged = fromEdge.current;
    fromEdge.current = false;
    let timer: number | undefined;
    const cancel = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = undefined;
    };
    const move = (event: PointerEvent) => {
      const box = element.getBoundingClientRect();
      const slack = 10;
      const inside = event.clientX >= box.left - slack && event.clientX <= box.right + slack && event.clientY >= box.top && event.clientY <= box.bottom;
      if (inside) {
        engaged = true;
        cancel();
      } else if (engaged && timer === undefined) {
        timer = window.setTimeout(() => {
          timer = undefined;
          if (!element.contains(document.activeElement)) hide();
        }, delayMs);
      }
    };
    const down = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target && (element.contains(target) || target.closest('[data-dock-toggle]'))) return;
      hide();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && element.contains(document.activeElement)) hide();
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('keydown', key);
    return () => {
      cancel();
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('keydown', key);
    };
  }, [floating, open, hide, panel, fromEdge, delayMs]);
}
