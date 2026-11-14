import { Checkbox as BaseCheckbox } from '@base-ui/react/checkbox';
import { Switch as BaseSwitch } from '@base-ui/react/switch';
import { useId, type ReactNode } from 'react';

/**
 * On and off (Instrument, "Controls"). A switch is ink when on and grey when off, and sits at the trailing end of its
 * row with the label at the leading end, so a settings list or an Adjust card reads down the left. A checkbox is a
 * rounded square, solid ink with a paper tick when checked; it leads its label. Behaviour (Space, focus, ARIA) is Base UI's.
 */

export function Switch({ label, hideLabel, checked, onChange, disabled, detail, className }: {
  /** What it turns on. Shown at the leading end of the row unless `hideLabel`; always its accessible name. */
  label: string;
  hideLabel?: boolean;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /** A grey line under the label. */
  detail?: ReactNode;
  className?: string;
}) {
  const id = useId();
  const control = (
    <BaseSwitch.Root
      id={id}
      className="ui-switch"
      checked={checked}
      disabled={disabled}
      aria-label={hideLabel ? label : undefined}
      onCheckedChange={(next) => onChange(next)}
    >
      <BaseSwitch.Thumb className="ui-switch-thumb" />
    </BaseSwitch.Root>
  );
  if (hideLabel) return control;
  return (
    <div className={className ? `ui-switch-row ${className}` : 'ui-switch-row'} data-disabled={disabled || undefined}>
      <label htmlFor={id} className="ui-switch-label">
        <span>{label}</span>
        {detail && <span className="ui-switch-detail">{detail}</span>}
      </label>
      {control}
    </div>
  );
}

export function Checkbox({ label, hideLabel, checked, onChange, disabled, indeterminate, className }: {
  label: string;
  hideLabel?: boolean;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Some but not all of a group: a dash instead of the tick. */
  indeterminate?: boolean;
  className?: string;
}) {
  return (
    <label className={className ? `ui-check ${className}` : 'ui-check'} data-disabled={disabled || undefined}>
      <BaseCheckbox.Root
        className="ui-check-box"
        checked={checked}
        indeterminate={indeterminate}
        disabled={disabled}
        aria-label={hideLabel ? label : undefined}
        onCheckedChange={(next) => onChange(next)}
      >
        <BaseCheckbox.Indicator className="ui-check-mark">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            {indeterminate ? <path d="M4 8h8" /> : <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />}
          </svg>
        </BaseCheckbox.Indicator>
      </BaseCheckbox.Root>
      {!hideLabel && <span className="ui-check-label">{label}</span>}
    </label>
  );
}
