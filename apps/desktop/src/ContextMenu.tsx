import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { morphOut, useMorphIn } from './motion';

/** The standard actions, each with one icon used everywhere: a row's hover buttons, its context menu, toolbars. */
export type ActionName = 'copy' | 'cut' | 'paste' | 'delete' | 'duplicate' | 'rename' | 'share' | 'pin' | 'unpin' | 'move' | 'open' | 'reveal' | 'undo';

/** One 20-unit glyph per action, drawn with a stroke, so every menu and button says the same thing the same way. */
export const ACTION_ICONS: Record<ActionName, ReactNode> = {
  copy: <><rect x="7" y="7" width="9.5" height="9.5" rx="2" /><path d="M13 7V5a1.5 1.5 0 0 0-1.5-1.5h-6A1.5 1.5 0 0 0 4 5v6a1.5 1.5 0 0 0 1.5 1.5H7" /></>,
  cut: <><circle cx="6" cy="14.5" r="2.2" /><circle cx="14" cy="14.5" r="2.2" /><path d="M7.6 13 14.5 3.5M12.4 13 5.5 3.5" /></>,
  paste: <><path d="M7.5 4h5v2.5h-5z" /><path d="M12.5 5H14a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 14 17H6a1.5 1.5 0 0 1-1.5-1.5v-9A1.5 1.5 0 0 1 6 5h1.5" /></>,
  delete: <path d="M4.5 6h11M8 6V4.5h4V6M6 6l.8 10h6.4L14 6M8.5 9v4.5M11.5 9v4.5" />,
  duplicate: <><rect x="4" y="4" width="9" height="9" rx="2" /><rect x="7" y="7" width="9" height="9" rx="2" /><path d="M11.5 9.5v4M9.5 11.5h4" /></>,
  rename: <path d="m4 16 1-4 8.5-8.5 3 3L8 15zM12 5l3 3" />,
  share: <><path d="M10 12V3.5M7 6.5l3-3 3 3" /><path d="M6.5 9H5.5A1.5 1.5 0 0 0 4 10.5v5A1.5 1.5 0 0 0 5.5 17h9a1.5 1.5 0 0 0 1.5-1.5v-5A1.5 1.5 0 0 0 14.5 9h-1" /></>,
  pin: <path d="M7 3h6M8 3v6l-3 4h10l-3-4V3M10 13v4" />,
  unpin: <path d="M7 3h6M8 3v6l-3 4h10l-3-4V3M10 13v4M3.5 3.5l13 13" />,
  move: <><path d="M3.5 6.5a1.5 1.5 0 0 1 1.5-1.5h3l1.5 1.5h5.5a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5z" /><path d="M8.5 10.5h5M11.5 8.5l2 2-2 2" /></>,
  open: <path d="M11 4h5v5M16 4l-7 7M14 11.5V15a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 4 15V8a1.5 1.5 0 0 1 1.5-1.5H9" />,
  reveal: <><path d="M3.5 6.5a1.5 1.5 0 0 1 1.5-1.5h3l1.5 1.5h5.5a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5z" /><circle cx="10" cy="11" r="1.6" /></>,
  undo: <path d="M7.5 5 4 8.5 7.5 12M4 8.5h7.5a4.5 4.5 0 0 1 0 9H9" />,
};

/** The words for each action, when an item does not give its own. */
export const ACTION_LABELS: Record<ActionName, string> = {
  copy: 'Copy', cut: 'Cut', paste: 'Paste', delete: 'Delete', duplicate: 'Duplicate', rename: 'Rename', share: 'Share',
  pin: 'Pin', unpin: 'Unpin', move: 'Move', open: 'Open', reveal: 'Show in Files', undo: 'Undo',
};

export function ActionIcon({ action }: { action: ActionName }) {
  return <svg className="action-icon" viewBox="0 0 20 20" aria-hidden="true">{ACTION_ICONS[action]}</svg>;
}

export interface ContextMenuItem {
  /** A standard action: its icon, and its words unless `label` gives others. */
  action?: ActionName;
  label?: string;
  run: () => void;
  /** Delete and the like: shown in red, and kept last. */
  danger?: boolean;
  disabled?: boolean;
  /** A line before this item. */
  separated?: boolean;
  /** Its keyboard shortcut, shown at the right, such as "Ctrl+D". */
  keys?: string;
}

/**
 * A row's context menu: glass, growing out of where it was asked for and going back there when it closes. Its first
 * items should be the row's own hover actions, in the same order, so the two never disagree. Escape, a click elsewhere
 * or choosing an item closes it; the arrow keys move between items.
 */
export function ContextMenu({ x, y, label, items, onClose }: { x: number; y: number; label: string; items: readonly ContextMenuItem[]; onClose: () => void }) {
  const menu = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState({ left: x, top: y });
  useMorphIn(menu, true, 'left');
  const closing = useRef(false);
  const close = (then?: () => void) => {
    if (closing.current) return;
    closing.current = true;
    if (menu.current) menu.current.style.pointerEvents = 'none';
    void morphOut(menu.current, 'left').then(() => { onClose(); then?.(); });
  };
  // Kept inside the window: it opens up or to the left where there is no room below or to the right.
  useLayoutEffect(() => {
    const box = menu.current?.getBoundingClientRect();
    if (!box) return;
    setPlace({ left: Math.max(8, Math.min(x, window.innerWidth - box.width - 8)), top: Math.max(8, y + box.height > window.innerHeight - 8 ? y - box.height : y) });
  }, [x, y]);
  useEffect(() => {
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
    const away = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node)) close(); };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const list = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])];
    const at = list.indexOf(document.activeElement as HTMLElement);
    list[(at + (event.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus();
  };
  return (
    <div ref={menu} className="context-menu glass" role="menu" aria-label={label} style={place} onKeyDown={onKeyDown} onContextMenu={(e) => e.preventDefault()}>
      {items.map((item, i) => (
        <button key={`${item.action ?? ''}-${item.label ?? ''}-${i}`} type="button" role="menuitem" className="context-menu-item" data-danger={item.danger || undefined} data-separated={item.separated || undefined} disabled={item.disabled} onClick={() => close(item.run)}>
          {item.action ? <ActionIcon action={item.action} /> : <span className="action-icon" aria-hidden="true" />}
          <span>{item.label ?? (item.action ? ACTION_LABELS[item.action] : '')}</span>
          {item.keys && <kbd className="context-menu-keys">{item.keys}</kbd>}
        </button>
      ))}
    </div>
  );
}
