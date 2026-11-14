import { Menu as Base } from '@base-ui/react/menu';
import { useCallback, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { growFrom, morphOut } from '../motion';
import { KeyCaps } from './Tooltip';

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
  /** A row that is on or off (a panel shown or hidden): a tick when on. */
  checked?: boolean;
  /** A grey line under the label on what it does ("Add effect" › "Echo: repeats that fade"); makes the row two lines. */
  detail?: string;
}

/**
 * A copy of a closing menu that fades where the menu was, so the menu itself can go at once: the row that was chosen
 * runs straight away and what the person types next reaches where it sends them, not the fading menu.
 */
function fadeCopy(node: HTMLElement | null) {
  if (!node || typeof document === 'undefined') return;
  const box = node.getBoundingClientRect();
  if (!box.width || !box.height) return;
  const copy = node.cloneNode(true) as HTMLElement;
  copy.removeAttribute('id');
  copy.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
  copy.setAttribute('aria-hidden', 'true');
  copy.inert = true;
  Object.assign(copy.style, { position: 'fixed', left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px`, margin: '0', pointerEvents: 'none', zIndex: '2147483000' });
  document.body.appendChild(copy);
  void morphOut(copy, 'left').then(() => copy.remove());
}

/**
 * Open state for a menu. Escape or a click elsewhere waits for the closing morph before the menu really goes; choosing
 * a row closes it at once (a copy fades in its place), then `onClosed` is called and the row runs.
 */
function useMorphingOpen(initial: boolean, onClosed?: () => void) {
  const [open, setOpen] = useState(initial);
  const popup = useRef<HTMLElement | null>(null);
  const closing = useRef(false);
  // When a row was chosen, focus is left where that row puts it (a field to rename, a button to confirm); otherwise
  // it goes back to what had it before the menu opened.
  const chose = useRef(false);
  const finalFocus = useCallback(() => !chose.current, []);
  const close = useCallback((after?: () => void) => {
    if (after) {
      if (chose.current) return;
      chose.current = true;
      closing.current = true;
      fadeCopy(popup.current);
      setOpen(false);
      onClosed?.();
      after();
      return;
    }
    if (closing.current) return;
    closing.current = true;
    if (popup.current) popup.current.style.pointerEvents = 'none';
    void morphOut(popup.current, 'left').then(() => {
      if (chose.current) return;
      setOpen(false);
      onClosed?.();
    });
  }, [onClosed]);
  const show = useCallback(() => { closing.current = false; chose.current = false; setOpen(true); }, []);
  // The popup mounts inside a portal a moment after the menu opens, so it grows when it arrives.
  const popupRef = useCallback((node: HTMLElement | null) => {
    popup.current = node;
    if (node) growFrom(node, 'left');
  }, []);
  return { open, show, close, popupRef, finalFocus };
}

const TICK = <svg className="ui-menu-icon ui-menu-tick" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" /></svg>;

/** The space at the left for icons and ticks, kept only when some row has one, so a plain command menu has no indent. */
const GAP = <span className="ui-menu-icon" aria-hidden="true" />;

function Rows({ entries, pick }: { entries: readonly MenuEntry[]; pick: (run: () => void) => void }) {
  const gutter = entries.some((e) => e.icon || e.checked !== undefined);
  return entries.map((entry, i) => entry.checked !== undefined ? (
    <Base.CheckboxItem
      key={`${entry.label}-${i}`}
      className="ui-menu-item"
      data-two-line={entry.detail ? true : undefined}
      label={entry.label}
      disabled={entry.disabled}
      closeOnClick={false}
      checked={entry.checked}
      data-separated={entry.separated || undefined}
      onClick={() => pick(entry.run)}
    >
      {entry.checked ? TICK : GAP}
      {entry.detail ? (
        <span className="ui-choice-text"><span className="ui-menu-label">{entry.label}</span><span className="ui-choice-meaning">{entry.detail}</span></span>
      ) : <span className="ui-menu-label">{entry.label}</span>}
      {entry.keys && <KeyCaps className="ui-menu-keys" keys={entry.keys} />}
    </Base.CheckboxItem>
  ) : (
    <Base.Item
      key={`${entry.label}-${i}`}
      className="ui-menu-item"
      data-two-line={entry.detail ? true : undefined}
      label={entry.label}
      disabled={entry.disabled}
      closeOnClick={false}
      data-danger={entry.danger || undefined}
      data-separated={entry.separated || undefined}
      onClick={() => pick(entry.run)}
    >
      {entry.icon ?? (gutter && GAP)}
      {entry.detail ? (
        <span className="ui-choice-text"><span className="ui-menu-label">{entry.label}</span><span className="ui-choice-meaning">{entry.detail}</span></span>
      ) : <span className="ui-menu-label">{entry.label}</span>}
      {entry.keys && <KeyCaps className="ui-menu-keys" keys={entry.keys} />}
    </Base.Item>
  ));
}

/**
 * A menu that opens at a point, such as a row's context menu. It is open while mounted; Escape, a click elsewhere or
 * choosing a row closes it, then `onClose` is called and the chosen row runs.
 */
export function PointMenu({ x, y, label, entries, onClose }: { x: number; y: number; label: string; entries: readonly MenuEntry[]; onClose: () => void }) {
  const { open, close, popupRef, finalFocus } = useMorphingOpen(true, onClose);
  const anchor = useMemo(() => ({ getBoundingClientRect: () => DOMRect.fromRect({ x, y, width: 0, height: 0 }) }), [x, y]);
  return (
    <Base.Root open={open} modal={false} onOpenChange={(next) => { if (!next) close(); }}>
      <Base.Portal>
        <Base.Positioner className="ui-menu-positioner" anchor={anchor} side="bottom" align="start" collisionPadding={8}>
          <Base.Popup ref={popupRef} finalFocus={finalFocus} className="ui-menu glass" aria-label={label} onContextMenu={(event) => event.preventDefault()}>
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
  const { open, show, close, popupRef, finalFocus } = useMorphingOpen(false);
  return (
    <Base.Root open={open} onOpenChange={(next) => { if (next) show(); else close(); }}>
      <Base.Trigger render={trigger} />
      <Base.Portal>
        <Base.Positioner className="ui-menu-positioner" side={side} align={align} sideOffset={4} collisionPadding={8}>
          <Base.Popup ref={popupRef} finalFocus={finalFocus} className="ui-menu glass" aria-label={label}>
            <Rows entries={entries} pick={(run) => close(run)} />
          </Base.Popup>
        </Base.Positioner>
      </Base.Portal>
    </Base.Root>
  );
}
