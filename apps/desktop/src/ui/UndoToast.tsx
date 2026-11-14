import type { CSSProperties } from 'react';
/**
 * The one way an app offers to take back what just happened: "Deleted “Groceries”  Undo  ×".
 *
 * It sits bottom-centre of the app's page (the nearest positioned box), is opaque, and never takes focus, so the person
 * stays where they were and Ctrl+Z there still works. Undo and × are ordinary buttons, reachable with Tab. Screen readers
 * hear the line once, as a status.
 */
export function UndoToast({ text, onUndo, onDismiss, undoLabel = 'Undo', progress }: {
  /** One line on what changed, such as `Deleted “Groceries”`. Long lines are cut with an ellipsis. */
  text: string;
  /** Leave out for a line with no action (a finished or failed job): it shows only the text and ×. */
  onUndo?: () => void;
  onDismiss: () => void;
  /** The button's word, when "Undo" is not the right one (such as "Restore", "Cancel" or "Show in folder"). */
  undoLabel?: string;
  /** While something runs, 0 to 1: a mono percentage beside the text and a thin bar along the bottom edge. */
  progress?: number;
}) {
  const share = progress === undefined ? undefined : Math.round(Math.min(1, Math.max(0, progress)) * 100);
  return (
    <div className="ui-undo" role="status" data-progress={share !== undefined || undefined}>
      <span className="ui-undo-text">{text}</span>
      {share !== undefined && (
        <>
          <span className="ui-undo-share" aria-hidden="true">{share}%</span>
          <span className="ui-undo-bar" role="progressbar" aria-label={text} aria-valuemin={0} aria-valuemax={100} aria-valuenow={share} style={{ '--p': share / 100 } as CSSProperties} />
        </>
      )}
      {onUndo && <button type="button" className="ui-undo-btn" onClick={onUndo}>{undoLabel}</button>}
      <button type="button" className="ui-undo-x" aria-label="Dismiss" onClick={onDismiss}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 6l8 8M14 6l-8 8" /></svg>
      </button>
    </div>
  );
}
