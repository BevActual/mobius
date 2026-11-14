import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { afterPaint } from './frame';

export interface SegmentChoice<T extends string> {
  value: T;
  /** Its name. With an `icon` and `iconOnly`, the name is the tooltip and accessible name. */
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
}

/**
 * A segmented control (Instrument, "Controls"): a grey track with the chosen segment on paper with a hairline, ink text.
 * For a small set of choices that are all worth seeing at once: List, Board, Calendar; Fit, Fill; Left, Centre, Right.
 * Arrow keys move the choice, as in any radio group. The toolbar's views use `ViewSwitch`, which looks the same.
 */
export function Segmented<T extends string>({ label, choices, value, onChange, iconOnly, wide, disabled, className }: {
  label: string;
  choices: readonly SegmentChoice<T>[];
  value: T;
  onChange: (value: T) => void;
  iconOnly?: boolean;
  /** Fill the width it is given, segments sharing it equally (a panel's full-width choice). */
  wide?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const group = useRef<HTMLDivElement>(null);
  const open = choices.filter((c) => !c.disabled);
  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    const by = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (!by || open.length === 0) return;
    event.preventDefault();
    const at = open.findIndex((c) => c.value === value);
    const next = open[(at + by + open.length) % open.length]!;
    onChange(next.value);
    afterPaint(() => group.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus());
  };
  return (
    <div ref={group} className={className ? `ui-segmented ${className}` : 'ui-segmented'} data-wide={wide || undefined} role="radiogroup" aria-label={label} aria-disabled={disabled || undefined} onKeyDown={disabled ? undefined : key}>
      {choices.map((c) => {
        const on = c.value === value;
        return (
          <button
            key={c.value}
            type="button"
            role="radio"
            className="ui-segment"
            aria-checked={on}
            aria-label={iconOnly ? c.label : undefined}
            title={iconOnly ? c.label : undefined}
            tabIndex={on ? 0 : -1}
            disabled={disabled || c.disabled}
            onClick={() => onChange(c.value)}
          >
            {c.icon && <span className="ui-segment-icon" aria-hidden="true">{c.icon}</span>}
            {!iconOnly && c.label}
          </button>
        );
      })}
    </div>
  );
}
