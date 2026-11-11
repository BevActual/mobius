import { useEffect, useRef } from 'react';

/**
 * What is chosen in the open app right now: cells in a sheet (as "D2" or "B2:D9") or words in a note or document.
 * Words are remembered when the message box takes the focus, since the editor's own selection goes then.
 */
export function useStageSelection(resetKey: string | null): () => string | null {
  const words = useRef<string | null>(null);
  useEffect(() => { words.current = null; }, [resetKey]);
  useEffect(() => {
    const changed = () => {
      const selection = document.getSelection();
      const node = selection?.anchorNode ?? null;
      const element = node instanceof Element ? node : node?.parentElement ?? null;
      if (!element?.closest('.stage')) return;
      const text = selection?.toString().trim() ?? '';
      words.current = text || null;
    };
    document.addEventListener('selectionchange', changed);
    return () => document.removeEventListener('selectionchange', changed);
  }, []);
  return () => {
    const cells = document.querySelector('.stage [aria-label="Selected cell"]')?.textContent?.trim();
    return cells || words.current;
  };
}
