export interface FromMobiusItem {
  key: string;
  name: string;
  /** Where it is ("P2 build"), when the app has places. */
  where?: string;
  current?: boolean;
  onOpen: () => void;
}

/**
 * "From Mobius": after a sidebar's own places, what Mobius made or changed there in its last turn, dashed until the turn
 * is kept. Each row opens the item where it is; the names say "from Mobius" so they are not mistaken for the places'
 * own rows.
 */
export function FromMobius({ items }: { items: readonly FromMobiusItem[] }) {
  if (items.length === 0) return null;
  return (
    <section className="from-mobius" aria-label="From Mobius">
      <h3 className="side-title from-mobius-title">From Mobius</h3>
      <ul role="list">
        {items.map((it) => (
          <li key={it.key}>
            <button type="button" className="note-row" data-proposed aria-current={it.current ? 'page' : undefined} aria-label={`${it.name}, from Mobius`} onClick={it.onOpen}>
              <span className="from-mobius-dot" aria-hidden="true" /><span className="note-title">{it.name}</span>
              {it.where && <span className="note-sub from-mobius-where">{it.where}</span>}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
