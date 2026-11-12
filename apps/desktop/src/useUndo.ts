import { useCallback, useEffect, useRef } from 'react';

const LIMIT = 100;

/**
 * Undo and redo for an editor that writes its whole file on each change (Canvas, Design): `record` is called with the
 * text before a change, `undo` and `redo` write the text back. When the file changes some other way (Mobius, another
 * program, a page opened), the history starts again, so undo never puts back what someone else did.
 */
export function useUndo(key: string | null, text: string, write: (text: string) => void) {
  const back = useRef<string[]>([]);
  const ahead = useRef<string[]>([]);
  /** The text this editor last wrote; anything else arriving means the history no longer fits. */
  const mine = useRef<string | null>(null);
  useEffect(() => { back.current = []; ahead.current = []; mine.current = null; }, [key]);
  useEffect(() => {
    if (mine.current !== null && text !== mine.current) { back.current = []; ahead.current = []; }
    mine.current = text;
  }, [text]);

  const record = useCallback((before: string, after: string) => {
    if (before === after) return;
    back.current = [...back.current, before].slice(-LIMIT);
    ahead.current = [];
    mine.current = after;
  }, []);
  const undo = useCallback(() => {
    const prev = back.current.pop();
    if (prev === undefined) return false;
    ahead.current.push(text);
    mine.current = prev;
    write(prev);
    return true;
  }, [text, write]);
  const redo = useCallback(() => {
    const next = ahead.current.pop();
    if (next === undefined) return false;
    back.current.push(text);
    mine.current = next;
    write(next);
    return true;
  }, [text, write]);
  return { record, undo, redo, canUndo: () => back.current.length > 0, canRedo: () => ahead.current.length > 0 };
}
