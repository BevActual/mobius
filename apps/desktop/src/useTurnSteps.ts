import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { TurnStep } from '@mobius/shared';
import type { Item } from './conversation';
import { KEPT_EVENT } from './ReviewStrip';

/** The last turn's steps that changed files, by the conversation item that shows each, and putting one back. */
export interface TurnSteps {
  steps: ReadonlyMap<string, TurnStep>;
  /** Puts one step's files back; resolves with what went wrong, or null. */
  undo: (step: TurnStep) => Promise<string | null>;
}

const NONE: TurnSteps = { steps: new Map(), undo: async () => 'That step cannot be put back.' };
export const TurnStepsContext = createContext<TurnSteps>(NONE);
/** The step a tool row shows, by the row's item id, once the turn has ended. */
export const useTurnStep = (itemId: string): { step: TurnStep | undefined; undo: TurnSteps['undo'] } => {
  const { steps, undo } = useContext(TurnStepsContext);
  return { step: steps.get(itemId), undo };
};

/**
 * Each step the host listed, matched to the last turn's tool row that shows it: by call id and tool, and, where a
 * model gave two calls the same id (some number them afresh in each answer), by how many such calls came before.
 */
export function matchSteps(items: readonly Item[], steps: readonly TurnStep[]): Map<string, TurnStep> {
  const from = items.findLastIndex((i) => i.kind === 'user') + 1;
  const seen = new Map<string, number>();
  const out = new Map<string, TurnStep>();
  for (const item of items.slice(from)) {
    if (item.kind !== 'tool') continue;
    const key = `${item.callId}\u0000${item.name}`;
    const nth = seen.get(key) ?? 0;
    seen.set(key, nth + 1);
    const step = steps.find((s) => s.callId === item.callId && s.tool === item.name && s.nth === nth);
    if (step) out.set(item.id, step);
  }
  return out;
}

/** Read when a turn ends and when another conversation is shown; while a turn runs, its steps cannot be put back. */
export function useTurnSteps(conversation: string, busy: boolean, items: readonly Item[]): TurnSteps {
  const [listed, setListed] = useState<readonly TurnStep[]>([]);
  const reads = useRef(0);
  const load = useCallback(async () => {
    const n = ++reads.current;
    const result = await window.mobius.changes?.steps?.(conversation).catch(() => null);
    if (n !== reads.current) return;
    setListed(result && 'steps' in result && Array.isArray(result.steps) ? result.steps : []);
  }, [conversation]);
  useEffect(() => {
    if (busy) { reads.current++; setListed([]); } else void load();
  }, [busy, load]);
  const undo = useCallback(async (step: TurnStep): Promise<string | null> => {
    const result = await window.mobius.changes?.undoStep?.(conversation, step.callId, step.tool, step.nth).catch(() => null);
    if (!result) return 'That step could not be put back.';
    if (!result.ok) return result.error;
    await load();
    // What the turn left to review is read again everywhere: the step put back leaves the turn's summary and its app's bar.
    window.dispatchEvent(new CustomEvent(KEPT_EVENT));
    return null;
  }, [conversation, load]);
  const steps = useMemo(() => matchSteps(items, listed), [items, listed]);
  return useMemo(() => ({ steps, undo }), [steps, undo]);
}
