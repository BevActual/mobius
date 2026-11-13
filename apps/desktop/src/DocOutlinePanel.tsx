import { useDocOutline } from './docs-outline';

/**
 * The open document's outline as a panel: its headings, the one in view marked, each a button to go there. Built to
 * sit in the right panel as the Outline tab beside Mobius (the frame's PanelTab, when it lands); the sidebar lists the
 * same headings under the document.
 */
export function DocOutlinePanel() {
  const outline = useDocOutline();
  if (!outline) return <p className="doc-outline-empty">Open a document to see its headings.</p>;
  if (outline.items.length === 0) return <p className="doc-outline-empty">Headings show here as you add them.</p>;
  return (
    <nav className="doc-outline-panel" aria-label="Outline">
      {outline.items.map((h, i) => (
        <button key={`${i}:${h.text}`} type="button" className="doc-outline-item" data-level={Math.min(h.level, 3)} aria-current={i === outline.current ? 'location' : undefined}
          onClick={() => outline.go(i)}>{h.text || 'Untitled'}</button>
      ))}
    </nav>
  );
}
