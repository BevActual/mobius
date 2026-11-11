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
 * "From Mobius": a filter at the foot of a sidebar, with how many things Mobius made or changed there in its last turn.
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
      <button type="button" className="from-mobius-filter" aria-pressed={on} title={on ? 'Show everything again' : 'Show only what Mobius made or changed'} onClick={() => setOnly((o) => !o)}>
        <span className="from-mobius-dot" aria-hidden="true" />
        <span className="from-mobius-label">From Mobius</span>
        <span className="list-count">{items.length}</span>
      </button>
    </div>
  );
}
