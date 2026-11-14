import { AlertDialog as BaseAlert } from '@base-ui/react/alert-dialog';
import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import type { ReactNode } from 'react';
import { Button } from './Button';

/**
 * Sheets and dialogs (Instrument, "Things that float"): paper with 12px corners and the one soft shadow, over a dimmed
 * window. A title, one short sentence, and the buttons at the trailing end with the primary last. Behaviour is Base
 * UI's: focus goes in and stays in, Escape and a click on the dimmed window close it, focus goes back where it was.
 *
 * - `Dialog`: a small form or choice (rename, a few settings, an export). Pass the buttons as `actions`.
 * - `Confirm`: only for paying, sending, deleting for good and running commands. Its button names the action
 *   ("Delete 3 files"), and it says when it can't be undone. A click on the dimmed window doesn't close it; Cancel
 *   and Escape do.
 */

export function Dialog({ open, onOpenChange, title, description, children, actions, wide, className }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** One short sentence under the title. */
  description?: ReactNode;
  children?: ReactNode;
  /** The buttons, primary last: `<><Button onClick={close}>Cancel</Button><Button kind="primary">Export</Button></>`. */
  actions?: ReactNode;
  /** A wider sheet for a form with two columns. */
  wide?: boolean;
  className?: string;
}) {
  return (
    <BaseDialog.Root open={open} onOpenChange={(next) => onOpenChange(next)}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="ui-dialog-backdrop" />
        <BaseDialog.Popup className={className ? `ui-dialog ${className}` : 'ui-dialog'} data-wide={wide || undefined}>
          <BaseDialog.Title className="ui-dialog-title">{title}</BaseDialog.Title>
          {description && <BaseDialog.Description className="ui-dialog-text">{description}</BaseDialog.Description>}
          {children && <div className="ui-dialog-body">{children}</div>}
          {actions && <div className="ui-dialog-actions">{actions}</div>}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}

export function Confirm({ open, title, description, action, onConfirm, onCancel, cancelLabel = 'Cancel', permanent }: {
  open: boolean;
  /** A question about the action: "Delete 3 files?" */
  title: string;
  /** One short sentence on what happens. */
  description?: ReactNode;
  /** The button's words, naming the action: "Delete 3 files", "Send", "Pay £40". */
  action: string;
  onConfirm: () => void;
  onCancel: () => void;
  cancelLabel?: string;
  /** It can't be undone: says so under the description. */
  permanent?: boolean;
}) {
  return (
    <BaseAlert.Root open={open} onOpenChange={(next) => { if (!next) onCancel(); }}>
      <BaseAlert.Portal>
        <BaseAlert.Backdrop className="ui-dialog-backdrop" />
        <BaseAlert.Popup className="ui-dialog" data-confirm>
          <BaseAlert.Title className="ui-dialog-title">{title}</BaseAlert.Title>
          {(description || permanent) && (
            <BaseAlert.Description className="ui-dialog-text">
              {description}
              {permanent && <span className="ui-dialog-permanent">{description ? ' ' : ''}This can’t be undone.</span>}
            </BaseAlert.Description>
          )}
          <div className="ui-dialog-actions">
            <BaseAlert.Close render={<Button>{cancelLabel}</Button>} />
            <Button kind="primary" onClick={onConfirm}>{action}</Button>
          </div>
        </BaseAlert.Popup>
      </BaseAlert.Portal>
    </BaseAlert.Root>
  );
}
