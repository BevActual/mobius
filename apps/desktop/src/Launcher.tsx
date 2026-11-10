import { useEffect, useMemo, useRef, useState } from 'react';
import type { BrowserTabState } from '@mobius/shared';
import { APPS, recentApps, type AppId } from './apps';
import { APP_ICONS } from './Rail';

export interface LauncherItem {
  id: string;
  kind: 'ask' | 'app' | 'tab' | 'command';
  label: string;
  detail?: string;
  disabled?: boolean;
  /** The app whose icon the row shows. */
  app?: AppId;
  run: () => void;
}

interface Props {
  open: boolean;
  onClose: () => void;
  tabs: BrowserTabState[];
  onNewTab: () => void;
  onActivateTab: (id: string) => void;
  onOpenApp: (id: AppId) => void;
  /** Hand what was typed to Mobius as a question. */
  onAsk?: (text: string) => void;
  /** Everything the menus can do now, to find by name. */
  commands?: readonly { id: string; label: string; detail?: string; run: () => void }[];
}

const SECTION: Record<LauncherItem['kind'], string> = { ask: 'Ask Mobius', app: 'Applications', tab: 'Open pages', command: 'Commands' };

/**
 * One centred surface for finding and opening things. Typing makes it one search for apps, open pages and commands,
 * with "Ask Mobius" always the first row. A modal dialog, so focus is trapped and Escape closes it.
 */
/** Apps in the order to offer them: recent first when nothing is typed, else names starting with the words first. */
export function rankApps<T extends { id: AppId; name: string }>(apps: readonly T[], q: string, recent: readonly AppId[] = recentApps(6)): T[] {
  const score = (a: T) => (q ? (a.name.toLowerCase().startsWith(q) ? 0 : 1) : (recent.includes(a.id) ? recent.indexOf(a.id) - 100 : 0));
  return apps.map((a, i) => ({ a, i, s: score(a) })).sort((x, y) => x.s - y.s || x.i - y.i).map((x) => x.a);
}

export function Launcher({ open, onClose, tabs, onNewTab, onActivateTab, onOpenApp, onAsk, commands = [] }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  // null: the default row (what was found, or Ask when nothing was). A number once the arrows or pointer chose.
  const [chosen, setSelected] = useState<number | null>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      setQuery('');
      setSelected(null);
      element.showModal();
      input.current?.focus();
    } else if (!open && element.open) {
      element.close();
    }
  }, [open]);

  const items = useMemo<LauncherItem[]>(() => {
    const q = query.trim().toLowerCase();
    const has = (text: string) => !q || text.toLowerCase().includes(q);
    const typed = query.trim();
    const list: LauncherItem[] = [
      ...(typed && onAsk ? [{ id: 'ask', kind: 'ask' as const, label: `Ask Mobius: “${typed.length > 60 ? `${typed.slice(0, 59)}…` : typed}”`, run: () => onAsk(typed) }] : []),
      // As in Spotlight and Raycast: with nothing typed the apps used last come first; typing puts names that start
      // with it before names that only contain it.
      ...rankApps(APPS.filter((app) => has(`${app.name} ${app.also ?? ''}`)), q).map<LauncherItem>((app) => ({
        id: `app-${app.id}`,
        kind: 'app',
        app: app.id,
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
      ...(commands.length > 0
        ? commands.filter((command) => q && has(`${command.label} ${command.detail ?? ''}`)).slice(0, 12).map<LauncherItem>((command) => ({ id: `cmd-${command.id}`, kind: 'command', label: command.label, detail: command.detail, run: command.run }))
        : [{ id: 'new-tab', label: 'New tab', detail: 'Ctrl+T' }]
          .filter((command) => has(command.label))
          .map<LauncherItem>((command) => ({ id: command.id, kind: 'command', label: command.label, detail: command.detail, run: onNewTab }))),
    ];
    return list;
  }, [query, tabs, onNewTab, onActivateTab, onOpenApp, onAsk, commands]);

  // Ask Mobius is always the first row, but Enter opens what was found when something was: typing "notes" and
  // pressing Enter opens Notes. With nothing found, Enter asks. Worked out as the list is drawn, so a quick Enter
  // right after typing gets the same row.
  const found = items.findIndex((item) => item.kind !== 'ask' && !item.disabled);
  const selected = chosen ?? (found > 0 ? found : 0);

  const activate = (item: LauncherItem | undefined) => {
    if (!item || item.disabled) return;
    onClose();
    item.run();
  };

  const move = (delta: number) => setSelected(items.length ? (selected + delta + items.length) % items.length : 0);
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
          onChange={(event) => { setQuery(event.target.value); setSelected(null); }}
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
                <span className="launcher-icon" data-kind={item.kind} aria-hidden="true">
                  {item.app ? <svg viewBox="0 0 20 20" data-app={item.app}>{APP_ICONS[item.app]}</svg> : item.kind === 'ask' ? <svg viewBox="0 0 20 20" data-app="agent">{APP_ICONS.agent}</svg> : item.kind === 'tab' ? <svg viewBox="0 0 20 20" data-app="browser">{APP_ICONS.browser}</svg> : <svg viewBox="0 0 20 20"><path d="M6 7l-3 3 3 3M9 14h8" /></svg>}
                </span>
                <span className="launcher-label">{item.label}</span>
                {item.detail && <span className="launcher-detail">{item.detail}</span>}
              </div>
            ))}
          </div>
        ))}
        {items.length === 0 && <div className="launcher-empty" role="status">No results for “{query.trim()}”.</div>}
      </div>
      <div className="launcher-foot" aria-hidden="true"><span><kbd>↵</kbd> Open</span><span><kbd>↑</kbd><kbd>↓</kbd> Move</span><span><kbd>Esc</kbd> Close</span></div>
    </dialog>
  );
}
