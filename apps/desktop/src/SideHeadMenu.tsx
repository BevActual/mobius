import { useEffect, useState } from 'react';
import { PointMenu, type MenuEntry } from './ui';

/**
 * A sidebar section header keeps its tools (float, refresh, +) out of sight until it is hovered or focused. So they are
 * never mouse-only, right-clicking the header (or the menu key, or Shift+F10, on it) offers the same tools as a menu.
 */
export function SideHeadMenu() {
  const [menu, setMenu] = useState<{ x: number; y: number; label: string; entries: MenuEntry[] } | null>(null);
  useEffect(() => {
    const open = (event: MouseEvent) => {
      const head = (event.target as Element | null)?.closest?.('.dock.left .side-head');
      if (!head) return;
      const tools = [...head.querySelectorAll<HTMLButtonElement>('.side-actions button')];
      if (tools.length === 0) return;
      event.preventDefault();
      const at = head.getBoundingClientRect();
      const label = head.querySelector('.side-title')?.textContent?.trim() || 'Section';
      setMenu({
        x: event.clientX || at.left + 8,
        y: event.clientY || at.bottom,
        label,
        entries: tools.map((tool) => ({ label: tool.getAttribute('aria-label') || tool.title || tool.textContent?.trim() || 'Action', disabled: tool.disabled, run: () => tool.click() })),
      });
    };
    document.addEventListener('contextmenu', open);
    return () => document.removeEventListener('contextmenu', open);
  }, []);
  return menu ? <PointMenu x={menu.x} y={menu.y} label={menu.label} entries={menu.entries} onClose={() => setMenu(null)} /> : null;
}
