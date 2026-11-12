import { useEffect, useRef, useState } from 'react';

export type WebSelectionAction = 'ask' | 'summarise' | 'explain' | 'task' | 'clip';
const ITEMS: { id: WebSelectionAction; label: string; hint: string }[] = [
  { id: 'ask', label: 'Ask about it', hint: 'Add it to the message box' },
  { id: 'summarise', label: 'Summarise it', hint: 'The agent sums it up' },
  { id: 'explain', label: 'Explain it', hint: 'In plain words' },
  { id: 'task', label: 'Make it a task', hint: 'Added to your first list' },
  { id: 'clip', label: 'Save to Notes', hint: 'On your Clippings page, with a link back' },
];

/** A page clippings can go to. */
export interface ClipPage { path: string; title: string; notebook: string }

/**
 * What to do with the text selected on a web page. It drops over the page, which is covered by its picture meanwhile.
 * `clipTo` names the page Save to Notes uses; "Save to another page" lists the rest, and the one chosen is kept for next time.
 */
export function SelectionMenu({ onChoose, onClose, clipTo = 'Clippings', pages = [], onClipTo }: { onChoose: (action: WebSelectionAction) => void; onClose: () => void; clipTo?: string; pages?: readonly ClipPage[]; onClipTo?: (path: string) => void }) {
  const menu = useRef<HTMLDivElement>(null);
  const [choosing, setChoosing] = useState(false);
  useEffect(() => { menu.current?.querySelector<HTMLButtonElement>('button')?.focus(); }, [choosing]);
  useEffect(() => {
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
      {choosing ? (
        <>
          <button type="button" role="menuitem" className="popmenu-item selection-back" onClick={() => setChoosing(false)}>
            <span>‹ Save to which page?</span>
          </button>
          <div className="selection-pages">
            {pages.map((page) => (
              <button key={page.path} type="button" role="menuitem" className="popmenu-item" onClick={() => onClipTo?.(page.path)}>
                <span>{page.title}</span>
                <span className="popmenu-hint">{page.notebook}</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          {ITEMS.map((item) => (
            <button key={item.id} type="button" role="menuitem" className="popmenu-item" onClick={() => onChoose(item.id)}>
              <span>{item.label}</span>
              <span className="popmenu-hint">{item.id === 'clip' ? `On ${clipTo}, with a link back` : item.hint}</span>
            </button>
          ))}
          {onClipTo && pages.length > 0 && (
            <button type="button" role="menuitem" className="popmenu-item" onClick={() => setChoosing(true)}>
              <span>Save to another page…</span>
              <span className="popmenu-hint">And keep saving there</span>
            </button>
          )}
        </>
      )}
    </div>
  );
}
