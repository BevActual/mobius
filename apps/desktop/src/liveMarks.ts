import { useEffect, useMemo, useState } from 'react';
import { TURN_FILES_EVENT, marksOf, type TurnFiles, type TurnMarks } from './useTurnChanges';

/**
 * The last turn's marks, with what the running turn has changed so far added in, so an app can draw Mobius's changes
 * dashed as each call lands rather than when the turn ends. What the turn said so far is let go once the marks are read
 * again (when the turn ends, or something is kept or put back), and when a new turn starts.
 */
export function useLiveMarks(conversation: string, busy: boolean, marks: TurnMarks): TurnMarks {
  const [files, setFiles] = useState<readonly string[]>([]);
  useEffect(() => { setFiles([]); }, [conversation, marks]);
  useEffect(() => { if (busy) setFiles([]); }, [busy]);
  useEffect(() => {
    const said = (e: Event) => {
      const d = (e as CustomEvent<TurnFiles>).detail;
      if (d.conversation === conversation) setFiles(d.files);
    };
    window.addEventListener(TURN_FILES_EVENT, said);
    return () => window.removeEventListener(TURN_FILES_EVENT, said);
  }, [conversation]);
  return useMemo(() => withLive(marks, files), [files, marks]);
}

/** The marks with the running turn's files so far added in; the same marks when it has said none. */
export function withLive(marks: TurnMarks, files: readonly string[]): TurnMarks {
  return files.length === 0 ? marks : marksOf([...new Set([...marks.files, ...files])]);
}

/** Calls `again` whenever the running turn of `conversation` says it has changed `file`. */
export function useTurnFileChanged(conversation: string | null, file: string | null, again: () => void): void {
  useEffect(() => {
    if (!conversation || !file) return undefined;
    const said = (e: Event) => {
      const d = (e as CustomEvent<TurnFiles>).detail;
      if (d.conversation === conversation && d.files.includes(file)) again();
    };
    window.addEventListener(TURN_FILES_EVENT, said);
    return () => window.removeEventListener(TURN_FILES_EVENT, said);
  }, [conversation, file]); // eslint-disable-line react-hooks/exhaustive-deps
}
