import { Menu as Base } from '@base-ui/react/menu';
import { useCallback, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { growFrom, morphOut } from '../motion';

/**
 * Menus for every app, built on Base UI so keyboard, focus, typeahead, screen readers and keeping inside the window
 * behave the same everywhere. They look like Mobius (ui.css) and move like the rest of it: they grow out of what
 * opened them and go back there when they close.
 */

/** One row of a menu. `icon` is drawn at the left; `keys` is its shortcut, shown at the right. */
export interface MenuEntry {
  label: string;
  run: () => void;
  icon?: ReactNode;
  keys?: string;
  /** Delete and the like: shown in red, and kept last. */
  danger?: boolean;
  disabled?: boolean;
  /** A line before this row. */
  separated?: boolean;
}

/** Open state that waits for the closing morph before the menu really goes, then runs what was chosen. */
function useMorphingOpen(initial: boolean, onClosed?: () => void) {
  const [open, setOpen] = useState(initial);
  const popup = useRef<HTMLElement | null>(null);
  const closing = useRef(false);
  const then = useRef<(() => void) | undefined>(undefined);
  const close = useCallback((after?: () => void) => {
    if (after) then.current = after;
    if (closing.current) return;
    closing.current = true;
    if (popup.current) popup.current.style.pointerEvents = 'none';
    void morphOut(popup.current, 'left').then(() => {
      setOpen(false);
      onClosed?.();
      const run = then.current;
      then.current = undefined;
      run?.();
    });
  }, [onClosed]);
  const show = useCallback(() => { closing.current = false; setOpen(true); }, []);
  // The popup mounts inside a portal a moment after the menu opens, so it grows when it arrives.
  const popupRef = useCallback((node: HTMLElement | null) => {
    popup.current = node;
    if (node) growFrom(node, 'left');
  }, []);
  return { open, show, close, popupRef };
}

function Rows({ entries, pick }: { entries: readonly MenuEntry[]; pick: (run: () => void) => void }) {
  return entries.map((entry, i) => (
    <Base.Item
      key={`${entry.label}-${i}`}
      className="ui-menu-item"
      label={entry.label}
      disabled={entry.disabled}
      closeOnClick={false}
      data-danger={entry.danger || undefined}
      data-separated={entry.separated || undefined}
      onClick={() => pick(entry.run)}
    >
      {entry.icon ?? <span className="ui-menu-icon" aria-hidden="true" />}
      <span className="ui-menu-label">{entry.label}</span>
      {entry.keys && <kbd className="ui-menu-keys">{entry.keys}</kbd>}
    </Base.Item>
  ));
}

/**
 * A menu that opens at a point, such as a row's context menu. It is open while mounted; Escape, a click elsewhere or
 * choosing a row closes it, then `onClose` is called and the chosen row runs.
 */
export function PointMenu({ x, y, label, entries, onClose }: { x: number; y: number; label: string; entries: readonly MenuEntry[]; onClose: () => void }) {
  const { open, close, popupRef } = useMorphingOpen(true, onClose);
  const anchor = useMemo(() => ({ getBoundingClientRect: () => DOMRect.fromRect({ x, y, width: 0, height: 0 }) }), [x, y]);
  return (
    <Base.Root open={open} modal={false} onOpenChange={(next) => { if (!next) close(); }}>
      <Base.Portal>
        <Base.Positioner className="ui-menu-positioner" anchor={anchor} side="bottom" align="start" collisionPadding={8}>
          <Base.Popup ref={popupRef} className="ui-menu glass" aria-label={label} onContextMenu={(event) => event.preventDefault()}>
            <Rows entries={entries} pick={(run) => close(run)} />
          </Base.Popup>
        </Base.Positioner>
      </Base.Portal>
    </Base.Root>
  );
}

/**
 * A menu that opens from a button. `trigger` is the button (its own label, icon and class); the menu is named `label`
 * for screen readers and placed below it, or wherever there is room.
 */
export function Menu({ label, entries, trigger, side = 'bottom', align = 'start' }: {
  label: string;
  entries: readonly MenuEntry[];
  trigger: ReactElement;
  side?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
}) {
  const { open, show, close, popupRef } = useMorphingOpen(false);
  return (
    <Base.Root open={open} onOpenChange={(next) => { if (next) show(); else close(); }}>
      <Base.Trigger render={trigger} />
      <Base.Portal>
        <Base.Positioner className="ui-menu-positioner" side={side} align={align} sideOffset={4} collisionPadding={8}>
          <Base.Popup ref={popupRef} className="ui-menu glass" aria-label={label}>
            <Rows entries={entries} pick={(run) => close(run)} />
          </Base.Popup>
        </Base.Positioner>
      </Base.Portal>
    </Base.Root>
  );
}
