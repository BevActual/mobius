import { Menu as BaseMenu } from '@base-ui/react/menu';
import { Popover as BasePopover } from '@base-ui/react/popover';
import { useCallback, type ReactElement, type ReactNode } from 'react';
import { growFrom } from '../motion';
import { KeyCaps } from './Tooltip';

/**
 * Popovers and choice menus (Instrument, "Composer" in the build sheet). Both float on the raised surface with the
 * menu's corners and shadow, open from the button that shows them (upward from the composer, `side="top"`), and close on
 * Escape or a click elsewhere, giving focus back to the button. Behaviour is Base UI's.
 *
 * - `Popover`: any small panel of controls (the composer's plus menu: switches, a few rows, a link onward).
 * - `ChoiceMenu`: pick one of a few choices (Mode, Permission, model). The current one has a check, each shows its key,
 *   and a choice with a `meaning` is a two-line row: its name, then a grey line on what it means.
 */

type Side = 'top' | 'bottom' | 'left' | 'right';
type Align = 'start' | 'center' | 'end';

const useGrow = () => useCallback((node: HTMLElement | null) => { if (node) growFrom(node, 'left'); }, []);

export function Popover({ label, trigger, children, side = 'bottom', align = 'start', open, onOpenChange, className }: {
  /** The popover's name for screen readers ("More options"). */
  label: string;
  /** The button that opens it. */
  trigger: ReactElement;
  children: ReactNode;
  side?: Side;
  align?: Align;
  /** Controlled open state, when the caller needs to close it after an action. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}) {
  const grow = useGrow();
  return (
    <BasePopover.Root open={open} onOpenChange={onOpenChange ? (next) => onOpenChange(next) : undefined}>
      <BasePopover.Trigger render={trigger} />
      <BasePopover.Portal>
        <BasePopover.Positioner className="ui-menu-positioner" side={side} align={align} sideOffset={6} collisionPadding={8}>
          <BasePopover.Popup ref={grow} className={className ? `ui-popover glass ${className}` : 'ui-popover glass'} aria-label={label}>
            {children}
          </BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </BasePopover.Root>
  );
}

/** A heading inside a popover or choice menu ("Mode", "Models"). Sentence case. */
export function PopoverTitle({ children }: { children: ReactNode }) {
  return <div className="ui-popover-title">{children}</div>;
}

/** The way out of a popover ("Manage in Abilities"): a full row with a hairline above it and an arrow at the right. */
export function PopoverLink({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" className="ui-popover-link" onClick={onClick}>
      <span>{children}</span>
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" /></svg>
    </button>
  );
}

export interface Choice<T extends string> {
  value: T;
  label: string;
  /** A grey line on what it means, which makes the row two lines (Permission, model). */
  meaning?: string;
  /** Its shortcut, drawn as key caps at the right. */
  keys?: string;
  icon?: ReactNode;
  disabled?: boolean;
  /** A line before this choice. */
  separated?: boolean;
}

const CHECK = <svg className="ui-choice-check" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" /></svg>;

export function ChoiceMenu<T extends string>({ label, title, trigger, value, choices, onChange, side = 'top', align = 'start', footer }: {
  /** The menu's name for screen readers ("Mode"). */
  label: string;
  /** An optional heading at the top of the menu. */
  title?: string;
  trigger: ReactElement;
  value: T;
  choices: readonly Choice<T>[];
  onChange: (value: T) => void;
  side?: Side;
  align?: Align;
  /** Rows after the choices, such as "Manage in Abilities": plain `{ label, run }` actions. */
  footer?: readonly { label: string; run: () => void; keys?: string }[];
}) {
  const grow = useGrow();
  const two = choices.some((c) => c.meaning);
  return (
    <BaseMenu.Root>
      <BaseMenu.Trigger render={trigger} />
      <BaseMenu.Portal>
        <BaseMenu.Positioner className="ui-menu-positioner" side={side} align={align} sideOffset={6} collisionPadding={8}>
          <BaseMenu.Popup ref={grow} className="ui-menu ui-choices glass" aria-label={label} data-two-line={two || undefined}>
            {title && <div className="ui-popover-title">{title}</div>}
            <BaseMenu.RadioGroup value={value} onValueChange={(next) => onChange(next as T)}>
              {choices.map((c) => (
                <BaseMenu.RadioItem
                  key={c.value}
                  value={c.value}
                  label={c.label}
                  disabled={c.disabled}
                  closeOnClick
                  className="ui-menu-item ui-choice"
                  data-separated={c.separated || undefined}
                  data-two-line={c.meaning ? true : undefined}
                >
                  <BaseMenu.RadioItemIndicator className="ui-choice-mark" keepMounted>{CHECK}</BaseMenu.RadioItemIndicator>
                  {c.icon && <span className="ui-menu-icon" aria-hidden="true">{c.icon}</span>}
                  <span className="ui-choice-text">
                    <span className="ui-menu-label">{c.label}</span>
                    {c.meaning && <span className="ui-choice-meaning">{c.meaning}</span>}
                  </span>
                  {c.keys && <KeyCaps className="ui-menu-keys" keys={c.keys} />}
                </BaseMenu.RadioItem>
              ))}
            </BaseMenu.RadioGroup>
            {footer?.map((f, i) => (
              <BaseMenu.Item key={f.label} label={f.label} className="ui-menu-item ui-choice-footer" data-separated={i === 0 || undefined} onClick={f.run}>
                <span className="ui-choice-mark" aria-hidden="true" />
                <span className="ui-menu-label">{f.label}</span>
                {f.keys && <KeyCaps className="ui-menu-keys" keys={f.keys} />}
              </BaseMenu.Item>
            ))}
          </BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  );
}
