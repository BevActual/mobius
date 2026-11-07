import { useCallback, useEffect, useState } from 'react';

/** What the last agent turn changed, as note page paths and task list names, so Notes and Tasks can mark them. */
export interface TurnMarks { notes: ReadonlySet<string>; lists: ReadonlySet<string> }
const NONE: TurnMarks = { notes: new Set(), lists: new Set() };

export function marksOf(files: readonly string[]): TurnMarks {
  const notes = new Set<string>();
  const lists = new Set<string>();
  for (const file of files) {
    if (file.startsWith('notes/')) notes.add(file.slice('notes/'.length));
    else if (file.startsWith('tasks/') && file.endsWith('.md')) lists.add(file.slice('tasks/'.length, -'.md'.length));
  }
  return { notes, lists };
}

/** Read when a turn ends, when another conversation is shown, and after anything is put back. */
export function useTurnChanges(conversation: string, busy: boolean): TurnMarks {
  const [marks, setMarks] = useState<TurnMarks>(NONE);
  const load = useCallback(async () => {
    const result = await window.mobius.changes?.lastTurn(conversation).catch(() => null);
    setMarks(result && 'files' in result ? marksOf(result.files) : NONE);
  }, [conversation]);
  useEffect(() => { if (!busy) void load(); }, [busy, load]);
  useEffect(() => {
    const again = (change: { by: string }) => { if (change.by === 'person') void load(); };
    const offNotes = window.mobius.notes?.onChanged(again);
    const offTasks = window.mobius.tasks?.onChanged(again);
    return () => { offNotes?.(); offTasks?.(); };
  }, [load]);
  return marks;
}
