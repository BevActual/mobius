import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { describeCombo } from '@mobius/shared';
import type { Menu, MenuItem } from './menus';

type Item = Extract<MenuItem, { kind: 'item' }>;

/**
 * The menus, in the toolbar. With room they are titles (File, Edit, View, Go, the app's own, Help); in a narrow window
 * they fold into one button whose panel lists the menus on the left and the chosen one's items on the right.
 * Keyboard: arrows move, Enter chooses, Escape closes. An item runs after focus is back where it was, so Edit's
 * commands act on what you were typing in.
 */
export function MenuBar({ menus, compact, onOpenChange }: { menus: Menu[]; compact: boolean; onOpenChange?: (open: boolean) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  const before = useRef<HTMLElement | null>(null);
  const shown = menus.find((m) => m.id === open) ?? null;

  useEffect(() => onOpenChange?.(open !== null), [open, onOpenChange]);
  useEffect(() => {
    if (open === null) return undefined;
    const away = (event: PointerEvent) => { if (!bar.current?.contains(event.target as Node)) setOpen(null); };
    window.addEventListener('pointerdown', away, true);
    return () => window.removeEventListener('pointerdown', away, true);
  }, [open]);
  // Opening a menu puts the keyboard on its first item.
  useEffect(() => {
    if (open === null) return;
    bar.current?.querySelector<HTMLElement>('.menu-panel [role^="menuitem"]:not([aria-disabled="true"])')?.focus();
  }, [open]);

  const openMenu = (id: string) => {
    if (open === null) before.current = document.activeElement instanceof HTMLElement && !bar.current?.contains(document.activeElement) ? document.activeElement : null;
    setOpen(id);
  };
  const close = (restore = true) => {
    setOpen(null);
    if (restore) before.current?.focus();
  };
  const choose = (item: Item) => {
    if (item.disabled) return;
    close(true);
    // After focus is back, so Undo, Copy and the rest act on what you were in.
    requestAnimationFrame(() => item.run());
  };
  const step = (by: 1 | -1) => {
    const at = menus.findIndex((m) => m.id === open);
    const next = menus[(at + by + menus.length) % menus.length];
    if (next) setOpen(next.id);
  };
  const onPanelKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(event.currentTarget.querySelectorAll<HTMLElement>('.menu-items [role^="menuitem"]:not([aria-disabled="true"])'))];
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      items[(at + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      step(event.key === 'ArrowRight' ? 1 : -1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
    } else if (event.key === 'Tab') {
      close(false);
    }
  };

  const itemRow = (it: MenuItem, i: number) =>
    it.kind === 'separator' ? (
      <div key={`s${i}`} role="separator" className="menu-sep" />
    ) : (
      <div
        key={it.id}
        role={it.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
        aria-checked={it.checked === undefined ? undefined : it.checked}
        aria-disabled={it.disabled || undefined}
        tabIndex={-1}
        className="menu-item"
        onClick={() => choose(it)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(it); } }}
      >
        <span className="menu-check" aria-hidden="true">{it.checked ? '✓' : ''}</span>
        <span className="menu-label">{it.label}</span>
        {it.keys && describeCombo(it.keys, window.mobius.platform) && <kbd className="menu-keys">{describeCombo(it.keys, window.mobius.platform)}</kbd>}
      </div>
    );

  return (
    <div ref={bar} className="menubar" role="menubar" aria-label="Menus" data-compact={compact || undefined}>
      {compact ? (
        <button type="button" className="strip-btn menu-title" role="menuitem" aria-haspopup="menu" aria-expanded={open !== null} aria-label="Menu" title="Menu"
          onClick={() => (open === null ? openMenu((menus.find((m) => m.id === 'app') ?? menus[0])?.id ?? 'file') : close(true))}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="5" cy="10" r="1.3" /><circle cx="10" cy="10" r="1.3" /><circle cx="15" cy="10" r="1.3" /></svg>
        </button>
      ) : (
        menus.map((m) => (
          <button key={m.id} type="button" className="menu-title" role="menuitem" aria-haspopup="menu" aria-expanded={open === m.id}
            onClick={() => (open === m.id ? close(true) : openMenu(m.id))}
            // With one menu open, pointing at another title opens that one, as menu bars do.
            onPointerEnter={() => { if (open !== null && open !== m.id) setOpen(m.id); }}>
            {m.label}
          </button>
        ))
      )}
      {shown && (
        <div className="menu-panel" data-compact={compact || undefined} onKeyDown={onPanelKey}
          style={compact ? undefined : { left: (bar.current?.querySelector<HTMLElement>(`.menu-title[aria-expanded="true"]`)?.offsetLeft ?? 0) }}>
          {compact && (
            <div className="menu-names" role="presentation">
              {menus.map((m) => (
                <button key={m.id} type="button" className="menu-name" aria-current={m.id === shown.id || undefined} tabIndex={-1}
                  onPointerEnter={() => setOpen(m.id)} onClick={() => setOpen(m.id)}>{m.label}</button>
              ))}
            </div>
          )}
          <div className="menu-items" role="menu" aria-label={shown.label}>{shown.items.map(itemRow)}</div>
        </div>
      )}
    </div>
  );
}
