import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './ui/Button';

/**
 * The Glance and Result slots of the Mobius panel (Instrument, "The Mobius panel: slots"). Like the Actions slot, the
 * panel owns where they sit and the app only fills them, with <AppGlance> and <AppResult>. Where the panel has no
 * place for one now, the slot is null and the app shows nothing there. An empty slot is hidden.
 *
 * - Glance: one small card of live facts about what is open or selected, at the top of the resting panel and after a
 *   result. Three facts at most, each a grey label over its value, and at most one quiet button.
 * - Result: the app's own way to show what Mobius made, in the Done state, under the last reply. Built from shared
 *   elements, and it always ends in Keep or Discard.
 */
export const GlanceSlotContext = createContext<HTMLElement | null>(null);
export const ResultSlotContext = createContext<HTMLElement | null>(null);

/** Where an app's Glance goes now, or null when the panel shows none. */
export const useGlanceSlot = (): HTMLElement | null => useContext(GlanceSlotContext);
/** Where an app's Result goes now (the Done state), or null. */
export const useResultSlot = (): HTMLElement | null => useContext(ResultSlotContext);

export interface GlanceFact {
  label: string;
  value: ReactNode;
}

/** The most facts a Glance shows; more are left out rather than squeezed in. */
export const GLANCE_FACTS = 3;

/** The facts a Glance shows: the first three with something to say. */
export const glanceFacts = (facts: readonly GlanceFact[]): GlanceFact[] =>
  facts.filter((f) => f.value !== null && f.value !== undefined && f.value !== '').slice(0, GLANCE_FACTS);

/** The Glance card itself. It draws nothing when there are no facts to show. */
export function GlanceCard({ title, facts, action }: { title?: string; facts: readonly GlanceFact[]; action?: { label: string; run: () => void } }) {
  const shown = glanceFacts(facts);
  if (shown.length === 0) return null;
  return (
    <section className="glance" aria-label={title ?? 'At a glance'}>
      <dl className="glance-facts">
        {shown.map((f) => (
          <div key={f.label} className="glance-fact">
            <dt className="glance-label">{f.label}</dt>
            <dd className="glance-value">{f.value}</dd>
          </div>
        ))}
      </dl>
      {action && <Button kind="quiet" className="glance-action" onClick={action.run}>{action.label}</Button>}
    </section>
  );
}

/** An app's Glance, placed in the panel. */
export function AppGlance({ slot, ...card }: { slot: HTMLElement; title?: string; facts: readonly GlanceFact[]; action?: { label: string; run: () => void } }) {
  return createPortal(<GlanceCard {...card} />, slot);
}

/** The Result card: the app's view of what was made, then Discard and Keep (Keep is the one solid button). */
export function ResultCard({ title, children, onKeep, onDiscard, keepLabel = 'Keep' }: {
  title: string;
  children: ReactNode;
  onKeep: () => void;
  onDiscard: () => void;
  keepLabel?: string;
}) {
  return (
    <section className="result" aria-label={title}>
      <h3 className="result-title">{title}</h3>
      <div className="result-body">{children}</div>
      <div className="result-buttons">
        <Button kind="quiet" onClick={onDiscard} keys="Ctrl+Backspace">Discard</Button>
        <Button kind="primary" onClick={onKeep} keys="Ctrl+Enter">{keepLabel}</Button>
      </div>
    </section>
  );
}

/** An app's Result, placed under the last reply in the Done state. */
export function AppResult({ slot, ...card }: { slot: HTMLElement; title: string; children: ReactNode; onKeep: () => void; onDiscard: () => void; keepLabel?: string }) {
  return createPortal(<ResultCard {...card} />, slot);
}
