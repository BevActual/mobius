/**
 * The one way an app offers to take back what just happened: "Deleted “Groceries”  Undo  ×".
 *
 * It sits bottom-centre of the app's page (the nearest positioned box), is opaque, and never takes focus, so the person
 * stays where they were and Ctrl+Z there still works. Undo and × are ordinary buttons, reachable with Tab. Screen readers
 * hear the line once, as a status.
 */
export function UndoToast({ text, onUndo, onDismiss, undoLabel = 'Undo' }: {
  /** One line on what changed, such as `Deleted “Groceries”`. Long lines are cut with an ellipsis. */
  text: string;
  onUndo: () => void;
  onDismiss: () => void;
  /** The button's word, when "Undo" is not the right one (such as "Restore"). */
  undoLabel?: string;
}) {
  return (
    <div className="ui-undo" role="status">
      <span className="ui-undo-text">{text}</span>
      <button type="button" className="ui-undo-btn" onClick={onUndo}>{undoLabel}</button>
      <button type="button" className="ui-undo-x" aria-label="Dismiss" onClick={onDismiss}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 6l8 8M14 6l-8 8" /></svg>
      </button>
    </div>
  );
}
