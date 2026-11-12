/** A way to start with Mobius: words put in the message box for the person to finish and send. */
export interface Start {
  label: string;
  prompt: string;
}

interface Props {
  /** "event", "list"…: the row reads "New event". */
  item: string;
  onNew: () => void;
  disabled?: boolean;
  title?: string;
  /** Mobius's starts under the row; nothing is sent until the person sends it. */
  starts?: readonly Start[];
  onStart?: (prompt: string) => void;
}

/**
 * The first row of an app's sidebar list: New. Mobius's starts are no longer drawn here (a sidebar holds places, not
 * suggestions): the panel's empty chat offers what is worth asking. `starts` and `onStart` are still accepted, so
 * sidebars that pass them need no change.
 */
export function SideNew({ item, onNew, disabled = false, title }: Props) {
  return (
    <div className="side-new">
      <button type="button" className="side-new-row" aria-label={`New ${item}`} title={title ?? `New ${item}`} disabled={disabled} onClick={onNew}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4.5v11M4.5 10h11" /></svg>
        <span>New {item}</span>
      </button>
    </div>
  );
}
