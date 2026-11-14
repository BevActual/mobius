import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { morphOut, useMorphIn } from '../motion';

interface Props {
  /** Names the button for people using a screen reader. */
  label: string;
  /** What the button shows. */
  trigger: ReactNode;
  className?: string;
  disabled?: boolean;
  title?: string;
  /** Called when the menu opens, for example to load what it lists. */
  onOpen?: () => void;
  /** The menu's items, given a function that closes it. Items are buttons with role menuitem or menuitemradio. */
  children: (close: () => void) => ReactNode;
}

/** A small menu that opens above its button. Escape and clicking elsewhere close it; the arrow keys move between items. */
export function PopMenu({ label, trigger, className = 'pill', disabled, title, onOpen, children }: Props) {
  const [open, setOpen] = useState(false);
  // The menu grows out of the button that opened it, and goes back into it when it closes.
  const list = useRef<HTMLDivElement>(null);
  useMorphIn(list, open, 'left');
  const leaving = useRef(false);
  // Each opening has its own number: an exit that finishes late closes only the opening it belongs to, never one made since.
  const opening = useRef(0);
  useEffect(() => { leaving.current = false; if (open) opening.current += 1; }, [open]);
  const shut = () => {
    const node = list.current;
    if (!node || leaving.current) { if (!node) setOpen(false); return; }
    leaving.current = true;
    node.style.pointerEvents = 'none';
    const mine = opening.current;
    void morphOut(node, 'left').then(() => { if (opening.current !== mine) return; leaving.current = false; setOpen(false); });
  };
  const root = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return undefined;
    const down = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) shut();
    };
    document.addEventListener('pointerdown', down, true);
    return () => document.removeEventListener('pointerdown', down, true);
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const close = () => {
    shut();
    button.current?.focus();
  };
  const items = () => [...(root.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([disabled])') ?? [])];
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const list = items();
    if (list.length === 0) return;
    event.preventDefault();
    const at = list.indexOf(document.activeElement as HTMLElement);
    const next = event.key === 'ArrowDown' ? (at + 1) % list.length : (at - 1 + list.length) % list.length;
    list[at < 0 ? (event.key === 'ArrowDown' ? 0 : list.length - 1) : next]?.focus();
  };

  return (
    <span className="popmenu" ref={root} onKeyDown={onKeyDown}>
      <button
        ref={button}
        type="button"
        className={className}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={label}
        title={title ?? label}
        disabled={disabled}
        onClick={() => {
          // Pressed again while the menu is going away: it stays, as if it had never started to close.
          if (open && leaving.current) {
            opening.current += 1;
            leaving.current = false;
            const node = list.current;
            if (node) { node.style.pointerEvents = ''; node.getAnimations?.().forEach((a) => a.cancel()); }
            return;
          }
          if (open) { shut(); return; }
          onOpen?.();
          setOpen(true);
        }}
      >
        {trigger}
      </button>
      {open && (
        <div ref={list} className="popmenu-list" id={id} role="menu" aria-label={label}>
          {children(close)}
        </div>
      )}
    </span>
  );
}
