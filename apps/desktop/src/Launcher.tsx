import { useEffect, useMemo, useRef, useState } from 'react';
import type { BrowserTabState } from '@mobius/shared';
import { APPS, type AppId } from './apps';

export interface LauncherItem {
  id: string;
  kind: 'app' | 'tab' | 'command';
  label: string;
  detail?: string;
  disabled?: boolean;
  run: () => void;
}

interface Props {
  open: boolean;
  onClose: () => void;
  tabs: BrowserTabState[];
  onNewTab: () => void;
  onActivateTab: (id: string) => void;
  onOpenApp: (id: AppId) => void;
}

const SECTION: Record<LauncherItem['kind'], string> = { app: 'Applications', tab: 'Open pages', command: 'Commands' };

/** One centred surface for finding and opening things. A modal dialog, so focus is trapped and Escape closes it. */
export function Launcher({ open, onClose, tabs, onNewTab, onActivateTab, onOpenApp }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      setQuery('');
      setSelected(0);
      element.showModal();
      input.current?.focus();
    } else if (!open && element.open) {
      element.close();
    }
  }, [open]);

  const items = useMemo<LauncherItem[]>(() => {
    const q = query.trim().toLowerCase();
    const has = (text: string) => !q || text.toLowerCase().includes(q);
    const list: LauncherItem[] = [
      ...APPS.filter((app) => has(app.name)).map<LauncherItem>((app) => ({
        id: `app-${app.id}`,
        kind: 'app',
        label: app.name,
        detail: app.available ? undefined : 'Not built yet',
        disabled: !app.available,
        run: () => onOpenApp(app.id),
      })),
      ...tabs.filter((tab) => q && has(`${tab.title} ${tab.url}`)).map<LauncherItem>((tab) => ({
        id: `tab-${tab.id}`,
        kind: 'tab',
        label: tab.title,
        detail: tab.url,
        run: () => onActivateTab(tab.id),
      })),
      ...[{ id: 'new-tab', label: 'New tab', detail: 'Ctrl+T' }]
        .filter((command) => has(command.label))
        .map<LauncherItem>((command) => ({ id: command.id, kind: 'command', label: command.label, detail: command.detail, run: onNewTab })),
    ];
    return list;
  }, [query, tabs, onNewTab, onActivateTab, onOpenApp]);

  const activate = (item: LauncherItem | undefined) => {
    if (!item || item.disabled) return;
    onClose();
    item.run();
  };

  const move = (delta: number) => setSelected((index) => (items.length ? (index + delta + items.length) % items.length : 0));
  const activeId = items[selected] ? `launcher-option-${items[selected]!.id}` : undefined;
  const sections = (Object.keys(SECTION) as Array<LauncherItem['kind']>).filter((kind) => items.some((item) => item.kind === kind));

  return (
    <dialog ref={dialog} className="launcher" aria-label="Launcher" onCancel={(event) => { event.preventDefault(); onClose(); }} onClick={(event) => { if (event.target === dialog.current) onClose(); }}>
      <div className="launcher-search">
        <input
          ref={input}
          id="launcher-input"
          role="combobox"
          aria-expanded="true"
          aria-controls="launcher-list"
          aria-activedescendant={activeId}
          aria-autocomplete="list"
          aria-label="Find apps, pages and commands"
          placeholder="Find or open anything"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => { setQuery(event.target.value); setSelected(0); }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') { event.preventDefault(); move(1); }
            else if (event.key === 'ArrowUp') { event.preventDefault(); move(-1); }
            else if (event.key === 'Enter') { event.preventDefault(); activate(items[selected]); }
            else if (event.key === 'Escape') { event.preventDefault(); onClose(); }
          }}
        />
        <kbd>Esc</kbd>
      </div>
      <div id="launcher-list" role="listbox" aria-label="Results" className="launcher-list">
        {sections.map((kind) => (
          <div key={kind} role="group" aria-label={SECTION[kind]}>
            <div className="launcher-heading" aria-hidden="true">{SECTION[kind]}</div>
            {items.map((item, index) => item.kind === kind && (
              <div
                key={item.id}
                id={`launcher-option-${item.id}`}
                role="option"
                aria-selected={index === selected}
                aria-disabled={item.disabled || undefined}
                className="launcher-option"
                onPointerMove={() => setSelected(index)}
                onClick={() => activate(item)}
              >
                <span className="launcher-label">{item.label}</span>
                {item.detail && <span className="launcher-detail">{item.detail}</span>}
              </div>
            ))}
          </div>
        ))}
        {items.length === 0 && <div className="launcher-empty" role="status">No results for “{query.trim()}”.</div>}
      </div>
    </dialog>
  );
}
