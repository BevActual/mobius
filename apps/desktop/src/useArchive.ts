import { useCallback, useEffect, useState } from 'react';

/** Conversations put away. Absent (undefined) when the shell has no archive. */
export function useArchive(listVersion: unknown): { archived: string[]; archive: ((id: string, on: boolean) => void) | undefined } {
  const [archived, setArchived] = useState<string[]>([]);
  const supported = window.mobius.agent.archive !== undefined;
  useEffect(() => {
    let live = true;
    void window.mobius.agent.archived?.().then((ids) => { if (live) setArchived(ids); });
    return () => { live = false; };
  }, [listVersion]);
  const archive = useCallback((id: string, on: boolean) => {
    void window.mobius.agent.archive?.(id, on).then(setArchived);
  }, []);
  return { archived, archive: supported ? archive : undefined };
}
