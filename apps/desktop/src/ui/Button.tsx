import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

/**
 * Buttons (Instrument, "Controls"). Three kinds, one height per density:
 *
 * - `primary`: solid ink with paper text. One per view at most, never indigo.
 * - `secondary` (the default): paper with a hairline border and ink text.
 * - `quiet`: text only, a grey fill on hover. For toolbars, rows and the plain Discard and Try another beside Keep.
 *
 * `keys` adds the shortcut to the tooltip (the shared tooltip draws it as key caps). `pressed` makes it a toggle
 * button: the grey selected fill while on.
 */
export type ButtonKind = 'primary' | 'secondary' | 'quiet';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  kind?: ButtonKind;
  /** A line icon before the label, drawn at 16px. */
  icon?: ReactNode;
  /** Its shortcut ("Ctrl+Enter"), added to the tooltip. */
  keys?: string;
  /** A toggle button that is on: the selected grey fill. */
  pressed?: boolean;
  /** Red text, for Delete and the like. Still never a red fill. */
  danger?: boolean;
  type?: 'button' | 'submit' | 'reset';
}

/** The tooltip text: the title (or, for an icon button, the name) with its shortcut in brackets. */
export function titleWithKeys(name: string | undefined, keys: string | undefined): string | undefined {
  if (!name) return undefined;
  return keys ? `${name} (${keys})` : name;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { kind = 'secondary', icon, keys, pressed, danger, type = 'button', className, title, children, ...rest },
  ref,
) {
  const tip = titleWithKeys(title ?? (keys && typeof children === 'string' ? children : undefined), keys);
  return (
    <button
      ref={ref}
      type={type}
      className={className ? `ui-button ${className}` : 'ui-button'}
      data-kind={kind}
      data-danger={danger || undefined}
      aria-pressed={pressed}
      data-keys={keys}
      title={tip}
      {...rest}
    >
      {icon && <span className="ui-button-icon" aria-hidden="true">{icon}</span>}
      {children}
    </button>
  );
});

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'children' | 'aria-label'> {
  /** Its name. Required: it is the accessible name and the tooltip. */
  label: string;
  /** The line icon, drawn at 18px. */
  icon: ReactNode;
  keys?: string;
  pressed?: boolean;
  danger?: boolean;
  /** The one ink icon button of its area (the composer's Send). */
  primary?: boolean;
}

/** A line icon with no border; a grey fill on hover. It always has a name, shown as its tooltip with its key. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, keys, pressed, danger, primary, className, title, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className={className ? `ui-icon-button ${className}` : 'ui-icon-button'}
      aria-label={label}
      aria-pressed={pressed}
      data-danger={danger || undefined}
      data-kind={primary ? 'primary' : undefined}
      data-keys={keys}
      title={titleWithKeys(title ?? label, keys)}
      {...rest}
    >
      <span className="ui-icon-button-icon" aria-hidden="true">{icon}</span>
    </button>
  );
});
