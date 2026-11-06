import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

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
  const root = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return undefined;
    const down = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', down, true);
    return () => document.removeEventListener('pointerdown', down, true);
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const close = () => {
    setOpen(false);
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
          if (!open) onOpen?.();
          setOpen((was) => !was);
        }}
      >
        {trigger}
      </button>
      {open && (
        <div className="popmenu-list" id={id} role="menu" aria-label={label}>
          {children(close)}
        </div>
      )}
    </span>
  );
}
