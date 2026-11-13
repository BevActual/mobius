import { useEffect, useRef, useState } from 'react';

export interface FromMobiusItem {
  key: string;
  name: string;
  /** Where it is ("P2 build"), when the app has places. */
  where?: string;
  current?: boolean;
  onOpen: () => void;
}

/**
 * "From Mobius": a quiet heading at the foot of a sidebar, and under it one row saying how many things Mobius made or
 * changed there in its last turn are left to review.
 * Pressed, the sidebar shows only those rows (the ones marked as changed, dashed until the turn is kept), rather than a
 * second list repeating rows the sidebar already has. Pressed again, or once nothing is left from Mobius, everything
 * shows again.
 */
export function FromMobius({ items }: { items: readonly FromMobiusItem[] }) {
  const [only, setOnly] = useState(false);
  const self = useRef<HTMLDivElement>(null);
  const on = only && items.length > 0;
  useEffect(() => {
    const side = self.current?.closest<HTMLElement>('.side, .rail-app, .dock.left');
    if (!side) return undefined;
    if (on) side.dataset.mobiusOnly = 'true';
    else delete side.dataset.mobiusOnly;
    return () => { delete side.dataset.mobiusOnly; };
  }, [on]);
  if (items.length === 0) return null;
  return (
    <div ref={self} className="from-mobius">
      <h3 className="side-title from-mobius-title">From Mobius</h3>
      <button type="button" className="from-mobius-filter" aria-pressed={on} aria-label={`From Mobius: ${items.length} to review`} title={on ? 'Show everything again' : 'Show only what Mobius made or changed'} onClick={() => setOnly((o) => !o)}>
        <span className="from-mobius-label">{on ? 'Showing only these' : 'Last turn'}</span>
        <span className="from-mobius-count">{items.length} to review</span>
      </button>
    </div>
  );
}
