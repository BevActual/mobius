import { useEffect, useRef } from 'react';

export type WebSelectionAction = 'ask' | 'summarise' | 'explain' | 'task';
const ITEMS: { id: WebSelectionAction; label: string; hint: string }[] = [
  { id: 'ask', label: 'Ask about it', hint: 'Add it to the message box' },
  { id: 'summarise', label: 'Summarise it', hint: 'The agent sums it up' },
  { id: 'explain', label: 'Explain it', hint: 'In plain words' },
  { id: 'task', label: 'Make it a task', hint: 'Added to your first list' },
];

/** What to do with the text selected on a web page. It drops over the page, which is covered by its picture meanwhile. */
export function SelectionMenu({ onChoose, onClose }: { onChoose: (action: WebSelectionAction) => void; onClose: () => void }) {
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    menu.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const away = (event: PointerEvent) => {
      const wrap = menu.current?.parentElement;
      if (wrap && !wrap.contains(event.target as Node)) onClose();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const buttons = [...(menu.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
        const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
        buttons[(at + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus();
      }
    };
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('pointerdown', away, true); window.removeEventListener('keydown', key); };
  }, [onClose]);
  return (
    <div ref={menu} className="selection-menu" role="menu" aria-label="Selected text">
      {ITEMS.map((item) => (
        <button key={item.id} type="button" role="menuitem" className="popmenu-item" onClick={() => onChoose(item.id)}>
          <span>{item.label}</span>
          <span className="popmenu-hint">{item.hint}</span>
        </button>
      ))}
    </div>
  );
}
