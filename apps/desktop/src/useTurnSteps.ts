import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { TurnStep } from '@mobius/shared';

/** The last turn's steps that changed files, by call, and putting one back. Given to each step row in the conversation. */
export interface TurnSteps {
  steps: ReadonlyMap<string, TurnStep>;
  /** Puts one step's files back; resolves with what went wrong, or null. */
  undo: (callId: string) => Promise<string | null>;
}

const NONE: TurnSteps = { steps: new Map(), undo: async () => 'That step cannot be put back.' };
export const TurnStepsContext = createContext<TurnSteps>(NONE);
export const useTurnStep = (callId: string): { step: TurnStep | undefined; undo: TurnSteps['undo'] } => {
  const { steps, undo } = useContext(TurnStepsContext);
  return { step: steps.get(callId), undo };
};

/** Read when a turn ends and when another conversation is shown; while a turn runs, its steps cannot be put back. */
export function useTurnSteps(conversation: string, busy: boolean): TurnSteps {
  const [steps, setSteps] = useState<ReadonlyMap<string, TurnStep>>(new Map());
  const reads = useRef(0);
  const load = useCallback(async () => {
    const n = ++reads.current;
    const result = await window.mobius.changes?.steps?.(conversation).catch(() => null);
    if (n !== reads.current) return;
    setSteps(new Map(result && 'steps' in result && Array.isArray(result.steps) ? result.steps.map((s) => [s.callId, s]) : []));
  }, [conversation]);
  useEffect(() => {
    if (busy) { reads.current++; setSteps(new Map()); } else void load();
  }, [busy, load]);
  const undo = useCallback(async (callId: string): Promise<string | null> => {
    const result = await window.mobius.changes?.undoStep?.(conversation, callId).catch(() => null);
    if (!result) return 'That step could not be put back.';
    if (!result.ok) return result.error;
    await load();
    return null;
  }, [conversation, load]);
  return { steps, undo };
}
