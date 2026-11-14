import { Select as BaseSelect } from '@base-ui/react/select';
import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';

/**
 * Fields (Instrument, "Controls"): a text field and a pop-up. Paper with a hairline border; focus is an ink border, not
 * a glow. The unit or a hint sits grey at the trailing end. A problem shows under the field as a red dot and one plain
 * sentence (`error`), never as a red box or a banner.
 */

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'onChange'> {
  /** The field's name. Shown above it unless `hideLabel`, and always its accessible name. */
  label: string;
  hideLabel?: boolean;
  /** Grey text at the trailing end inside the field: a unit ("px", "dB") or a key hint ("/"). */
  unit?: ReactNode;
  /** One plain sentence on what is wrong and what to do. */
  error?: string;
  onChange?: (value: string) => void;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, hideLabel, unit, error, onChange, className, id, ...rest },
  ref,
) {
  const own = useId();
  const field = id ?? own;
  const problem = `${field}-error`;
  return (
    <div className={className ? `ui-field ${className}` : 'ui-field'} data-invalid={error ? true : undefined}>
      <label className="ui-field-label" htmlFor={field} data-hidden={hideLabel || undefined}>{label}</label>
      <div className="ui-field-box">
        <input
          ref={ref}
          id={field}
          className="ui-field-input"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? problem : undefined}
          onChange={onChange ? (e) => onChange(e.target.value) : undefined}
          {...rest}
        />
        {unit !== undefined && <span className="ui-field-unit" aria-hidden="true">{unit}</span>}
      </div>
      {error && <p id={problem} className="ui-field-error"><span className="ui-dot" data-tone="red" aria-hidden="true" />{error}</p>}
    </div>
  );
});

export interface SelectChoice<T extends string> { value: T; label: string; disabled?: boolean }

/**
 * A pop-up: looks like a field with up and down chevrons at the trailing end, and opens a menu of its choices with the
 * chosen one ticked. Built on Base UI's Select, so typing a letter jumps to a choice and arrows move as in any list box.
 */
export function Select<T extends string>({ label, hideLabel, inline, quiet, value, choices, onChange, disabled, className }: {
  label: string;
  hideLabel?: boolean;
  /** The name beside the box rather than above it, for toolbars and bars. */
  inline?: boolean;
  /** Text with its chevrons and no box until hovered or open, for a toolbar's sub line. */
  quiet?: boolean;
  value: T;
  choices: readonly SelectChoice<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  className?: string;
}) {
  const items = choices.map((c) => ({ value: c.value, label: c.label }));
  const labelId = useId();
  return (
    <div className={className ? `ui-field ${className}` : 'ui-field'} data-inline={inline || undefined}>
      <span id={labelId} className="ui-field-label" data-hidden={hideLabel || undefined}>{label}</span>
      <BaseSelect.Root items={items} value={value} disabled={disabled} onValueChange={(next) => { if (next !== null) onChange(next as T); }}>
        <BaseSelect.Trigger className="ui-select" data-quiet={quiet || undefined} aria-labelledby={labelId}>
          {inline ? (
            // Inline boxes sit in crowded bars: every choice is laid in the same cell, unseen, so the box holds the width of
            // its longest choice and never squeezes to an ellipsis or jumps when the choice changes.
            <span className="ui-select-fit">
              <BaseSelect.Value className="ui-select-value" />
              {choices.map((c) => <span key={c.value} className="ui-select-size" aria-hidden="true">{c.label}</span>)}
            </span>
          ) : <BaseSelect.Value className="ui-select-value" />}
          <BaseSelect.Icon className="ui-select-icon">
            <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3.5 4.75 6 2.5l2.5 2.25M3.5 7.25 6 9.5l2.5-2.25" /></svg>
          </BaseSelect.Icon>
        </BaseSelect.Trigger>
        <BaseSelect.Portal>
          <BaseSelect.Positioner className="ui-menu-positioner" sideOffset={4} alignItemWithTrigger={false}>
            <BaseSelect.Popup className="ui-menu ui-select-menu">
              {choices.map((c) => (
                <BaseSelect.Item key={c.value} value={c.value} disabled={c.disabled} className="ui-menu-item">
                  <BaseSelect.ItemIndicator className="ui-select-tick" keepMounted>
                    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5 6.5 11.5 12.5 4.5" /></svg>
                  </BaseSelect.ItemIndicator>
                  <BaseSelect.ItemText className="ui-menu-label">{c.label}</BaseSelect.ItemText>
                </BaseSelect.Item>
              ))}
            </BaseSelect.Popup>
          </BaseSelect.Positioner>
        </BaseSelect.Portal>
      </BaseSelect.Root>
    </div>
  );
}
