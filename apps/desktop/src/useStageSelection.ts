import { useEffect, useRef, useState } from 'react';

/** The selection's text, for reading as a message goes, and as it stands now, for the chip that shows it. */
export interface StageSelection {
  read: () => string | null;
  now: string | null;
}

const cellsNow = () => document.querySelector('.stage [aria-label="Selected cell"]')?.textContent?.trim() || null;

/**
 * What is chosen in the open app right now: cells in a sheet (as "D2" or "B2:D9") or words in a note or document.
 * Words are remembered when the message box takes the focus, since the editor's own selection goes then.
 */
export function useStageSelection(resetKey: string | null): StageSelection {
  const words = useRef<string | null>(null);
  const [now, setNow] = useState<string | null>(null);
  useEffect(() => { words.current = null; setNow(null); }, [resetKey]);
  useEffect(() => {
    const changed = () => {
      const selection = document.getSelection();
      const node = selection?.anchorNode ?? null;
      const element = node instanceof Element ? node : node?.parentElement ?? null;
      if (!element?.closest('.stage')) return;
      const text = selection?.toString().trim() ?? '';
      words.current = text || null;
      setNow(cellsNow() ?? words.current);
    };
    // Cells are chosen with the pointer and the arrow keys, which change no text selection: look again after each.
    // A drag's words are read again when it ends, in case its selectionchange came before the text was chosen.
    const settled = (event: Event) => {
      if (!(event.target instanceof Element) || !event.target.closest('.stage')) return;
      changed();
      setNow(cellsNow() ?? words.current);
    };
    // What was chosen before the panel opened (Ctrl+Shift+M after selecting) counts too.
    changed();
    setNow((was) => was ?? cellsNow());
    document.addEventListener('selectionchange', changed);
    document.addEventListener('pointerup', settled);
    document.addEventListener('keyup', settled);
    return () => {
      document.removeEventListener('selectionchange', changed);
      document.removeEventListener('pointerup', settled);
      document.removeEventListener('keyup', settled);
    };
  }, []);
  return { read: () => cellsNow() ?? words.current, now };
}
